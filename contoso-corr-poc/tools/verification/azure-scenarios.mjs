import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { parseTraceparent, scanSource } from '../protocol.mjs';
import { assertRetry, assertReplay, assertBatch, assertLinkedAggregation } from '../messaging/async-honesty.mjs';
import { nativeLinks, UUID } from '../observability/telemetry-contract.mjs';
import { percentile } from '../observability/load.mjs';
import { exampleFailure, pollExample } from './adapters/azure-operator.mjs';
import { readBoundFile } from './files.mjs';
import { scanGraphIntake } from '../security/telemetry.mjs';

const fail = code => { throw exampleFailure(code); };
const carrier = sampled => `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-${sampled ? '01' : '00'}`;
const success = response => {
  if (response.status < 200 || response.status >= 300) fail('AZURE_EXAMPLE_BUSINESS_REQUEST_FAILED');
  return response;
};

export async function executeAzureScenario(context) {
  const { id, client, run, metadata, signal } = context;
  const evidence = { id, calls: [], inputs: [], assertions: [], browser: null };
  const post = (action, body = {}) => client.post(`/runs/${run.runId}/${action}`, body, { signal });
  const observations = () => post('observations');
  async function gateway(method, route, body = null, headers = {}) {
    const response = await post('gateway', { method, route, body, headers });
    evidence.calls.push(response);
    return response;
  }
  async function create(scenario = null, failures = 0, headers = {}) {
    const type = scenario === null ? 'ORDER' : 'RUN';
    const { workflowId } = await post('allocate', { type });
    if (!UUID.test(workflowId ?? '')) fail('AZURE_EXAMPLE_ALLOCATION_INVALID');
    const body = scenario === null
      ? { schemaVersion: 1, orderId: workflowId, sku: 'CONTOSO-001', quantity: 1 }
      : { schemaVersion: 1, runId: workflowId, demoId: Number(id), scenario, failureBudget: failures };
    const response = success(await gateway('POST', scenario === null ? '/orders' : '/demo-runs', body, headers));
    if (response.body.id !== workflowId || !UUID.test(response.invocationId ?? '')) fail('AZURE_EXAMPLE_WORKFLOW_RESPONSE_INVALID');
    return { workflowId, invocationId: response.invocationId, type };
  }
  const awaitComplete = work => pollExample(
    () => gateway('GET', `/${work.type === 'ORDER' ? 'orders' : 'demo-runs'}/${work.workflowId}`),
    response => response.status === 200 && response.body.state === 'COMPLETED',
    { seconds: client.config.waitSeconds, signal });
  evidence.fromUtc = new Date().toISOString();
  switch (id) {
    case '01':
    case '02': {
      if (!context.browser || context.browser.ready.apiOrigin !== new URL(metadata.gatewayUrl).origin) {
        fail('AZURE_EXAMPLE_AUTHENTICATED_BROWSER_REQUIRED');
      }
      const { workflowId } = await post('allocate', { type: 'ORDER' });
      evidence.browser = await context.browser.drive(workflowId, id);
      if (evidence.browser.outcome !== 'staged' || evidence.browser.backendId !== workflowId ||
          evidence.browser.executionMode !== 'live') fail('AZURE_EXAMPLE_BROWSER_ACTION_FAILED');
      if (id === '01' && (evidence.browser.backendState !== 'QUEUED' ||
          !Array.isArray(evidence.browser.observations) || evidence.browser.observations.length !== 1 ||
          evidence.browser.observations[0]?.method !== 'POST' ||
          evidence.browser.observations[0].path !== '/contoso/v1/orders' ||
          evidence.browser.observations[0].status !== 202)) {
        fail('AZURE_EXAMPLE_ORDER_NOT_STAGED');
      }
      await post('attach', { workflowId });
      if (id === '01') {
        const stored = success(await gateway('GET', `/orders/${workflowId}`));
        if (stored.status !== 200 || stored.body?.id !== workflowId ||
            !UUID.test(evidence.browser.businessInvocationId ?? '') ||
            stored.body.businessInvocationId !== evidence.browser.businessInvocationId ||
            !/^[A-Z_]{1,32}$/.test(stored.body.state ?? '')) {
          fail('AZURE_EXAMPLE_DURABLE_ORDER_IDENTITY_MISMATCH');
        }
      } else {
        await awaitComplete({ workflowId, type: 'ORDER' });
      }
      break;
    }
    case '03': {
      const cases = [
        { caseId: 'valid-sampled', headers: { traceparent: carrier(true) } },
        { caseId: 'absent', headers: {} },
        { caseId: 'invalid-zero-trace', headers: { traceparent: `00-${'0'.repeat(32)}-${'1'.repeat(16)}-01` } },
        { caseId: 'valid-unsampled', headers: { traceparent: carrier(false) } }
      ];
      for (const vector of cases) {
        const work = await create(null, 0, vector.headers);
        evidence.inputs.push({ ...vector, invocationId: work.invocationId });
        await awaitComplete(work);
      }
      const negative = scanSource((await readBoundFile('tests\\apim\\fixtures\\flag-rewrite.xml')).toString('utf8'), 'isolated-test-fixture.xml');
      if (!negative.some(finding => finding.code === 'SAMPLED_FLAG_SURGERY')) fail('AZURE_EXAMPLE_PROTOCOL_NEGATIVE_FAILED');
      evidence.assertions.push('isolated forbidden-source guard rejected the seeded rewrite');
      break;
    }
    case '04': {
      const supplied = randomUUID();
      const untrusted = await client.userRequest(metadata.gatewayUrl, '/me', {
        headers: { 'x-business-invocation-id': supplied }, signal
      });
      if (untrusted.status !== 200 || untrusted.invocationId === supplied) fail('AZURE_EXAMPLE_UNTRUSTED_ID_NOT_REPLACED');
      const malformed = success(await gateway('GET', '/me', null, { 'x-business-invocation-id': 'not-an-invocation-id' }));
      if (!UUID.test(malformed.invocationId ?? '')) fail('AZURE_EXAMPLE_MALFORMED_ID_NOT_REPLACED');
      const trusted = randomUUID();
      const work = await create('RETRY', 1, { 'x-business-invocation-id': trusted });
      if (work.invocationId !== trusted) fail('AZURE_EXAMPLE_TRUSTED_ID_NOT_PRESERVED');
      await awaitComplete(work);
      evidence.inputs.push({ caseId: 'untrusted', inputId: supplied, observedId: untrusted.invocationId },
        { caseId: 'malformed', observedId: malformed.invocationId },
        { caseId: 'trusted-valid', inputId: trusted, observedId: work.invocationId });
      break;
    }
    case '05': {
      for (const mode of ['INVENTORY_TIMEOUT', 'POSTGRES_ERROR']) {
        await post('fault', { mode });
        const { workflowId } = await post('allocate', { type: 'ORDER' });
        let response;
        try {
          response = await gateway('POST', '/orders', { schemaVersion: 1, orderId: workflowId, sku: 'CONTOSO-001', quantity: 1 });
        } finally { await post('fault', { mode: 'NONE' }); }
        if (response.status < 500 || response.status >= 600) fail('AZURE_EXAMPLE_FAULT_DID_NOT_AFFECT_REQUEST');
        evidence.inputs.push({ caseId: mode, status: response.status });
      }
      break;
    }
    case '06': {
      const work = await create('RETRY', 2);
      await awaitComplete(work);
      evidence.retryFailures = 2;
      break;
    }
    case '07': {
      const work = await create('DLQ', 2);
      await pollExample(observations, value => ['FULFILLMENT', 'NOTIFY'].every(branch =>
        value.attempts.some(attempt => attempt.branch === branch && attempt.outcome === 'DEAD_LETTERED')),
      { seconds: client.config.waitSeconds, signal });
      for (const target of ['FULFILLMENT', 'NOTIFY']) {
        success(await gateway('POST', `/demo-runs/${work.workflowId}/controls`, {
          schemaVersion: 1, action: 'REPLAY', target, failureBudget: 0
        }));
      }
      await pollExample(observations, value => ['FULFILLMENT', 'NOTIFY'].every(branch =>
        value.attempts.some(attempt => attempt.branch === branch && attempt.outcome === 'SUCCESS')),
      { seconds: client.config.waitSeconds, signal });
      await awaitComplete(work);
      break;
    }
    case '08':
      await awaitComplete(await create('FAN_OUT'));
      break;
    case '09':
      await awaitComplete(await create('BATCH'));
      break;
    case '10':
      for (const scenario of ['EVENT_GRID', 'STORAGE_QUEUE']) {
        const work = await create(scenario);
        await awaitComplete(work);
        await post('redeliver', { destination: scenario });
      }
      await pollExample(observations, value => ['EVENT_GRID', 'STORAGE_QUEUE'].every(branch =>
        value.attempts.some(attempt => attempt.branch === branch && attempt.outcome === 'DUPLICATE')),
      { seconds: client.config.waitSeconds, signal });
      break;
    case '11': {
      const sent = [];
      for (const kind of ['SPOOF', 'INVALID_CONTEXT', 'OVERSIZE']) sent.push(await post('inject', { kind }));
      evidence.rejections = await pollExample(() => post('rejections'), value =>
        sent.every(message => value.some(row => row.messageId === message.messageId)),
      { seconds: client.config.waitSeconds, signal });
      break;
    }
    case '12': {
      await post('fault', { mode: 'DATA_CANARY' });
      try { await awaitComplete(await create()); }
      finally { await post('fault', { mode: 'NONE' }); }
      break;
    }
    case '13': {
      evidence.identity = await client.userRequest(metadata.gatewayUrl, '/me', { signal });
      const rejected = await client.userRequest(metadata.gatewayUrl, '/me', { invalidToken: true, signal });
      if (evidence.identity.status !== 200 || !evidence.identity.pseudonymObserved || ![401, 403].includes(rejected.status)) {
        fail('AZURE_EXAMPLE_IDENTITY_CONTROL_FAILED');
      }
      evidence.identityRejectionStatus = rejected.status;
      break;
    }
    case '14':
      await awaitComplete(await create());
      break;
    case '15': {
      const started = Date.now(), receipts = [];
      const count = client.config.load.requestsPerSecond * client.config.load.durationSeconds;
      for (let index = 0; index < count; index++) {
        const due = started + index * 1000 / client.config.load.requestsPerSecond;
        if (due > Date.now()) await wait(due - Date.now(), undefined, { signal });
        receipts.push(gateway('GET', '/me').then(value => ({ status: value.status, durationMs: value.durationMs })));
      }
      evidence.load = { receipts: await Promise.all(receipts), requestedRequests: count,
        requestedSeconds: client.config.load.durationSeconds };
      await post('sampling-off');
      break;
    }
    default: fail('AZURE_EXAMPLE_UNKNOWN_SCENARIO');
  }
  evidence.toUtc = new Date().toISOString();
  evidence.observations = await observations();
  return evidence;
}

function nativeAsync(span) {
  const props = span.nativeProperties;
  return { traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId, kind: span.semanticKind,
    operation: span.semanticKind === 'CONSUMER' ? 'PROCESS' : props['messaging.operation.name'],
    attempt: Number(props['contoso.process.attempt']), outcome: props['contoso.outcome'],
    businessInvocationId: span.businessInvocationId, messageId: props['contoso.message.id'],
    originalMessageId: props['contoso.original.message.id'],
    links: nativeLinks(span.nativeLinksJson).map(link => ({ traceId: link.targetTraceId, spanId: link.targetSpanId })) };
}
const contextOf = parent => {
  const parsed = parseTraceparent(parent);
  if (!parsed.valid) fail('AZURE_EXAMPLE_PERSISTED_CONTEXT_INVALID');
  return { traceId: parsed.traceId, spanId: parsed.parentId };
};

export function assertObservedHttpPath(spans, { browser = null, ssr = false } = {}) {
  const one = (values, code) => {
    if (values.length !== 1) fail(code);
    return values[0];
  };
  const server = role => one(spans.filter(span => span.roleName === role && span.nativeTable === 'AppRequests'),
    'AZURE_EXAMPLE_HTTP_SERVER_AMBIGUOUS');
  const gateway = server('contoso-corr-poc-apim');
  const orders = server('contoso-orders-api');
  const inventory = server('contoso-inventory-api');
  const dependency = (role, parent, child) => one(spans.filter(span => span.roleName === role &&
    span.nativeTable === 'AppDependencies' && span.traceId === child.traceId &&
    span.parentSpanId === parent.spanId && span.spanId === child.parentSpanId &&
    span.traceId === parent.traceId), 'AZURE_EXAMPLE_HTTP_PARENT_CHAIN_BROKEN');
  dependency('contoso-corr-poc-apim', gateway, orders);
  dependency('contoso-orders-api', orders, inventory);
  for (const system of ['postgresql', 'redis']) {
    if (!spans.some(span => span.semanticKind === 'CLIENT' && span.nativeProperties['db.system'] === system &&
        span.traceId === inventory.traceId && span.parentSpanId === inventory.spanId && span.durationMs > 0)) {
      fail('AZURE_EXAMPLE_DATA_PARENT_CHAIN_BROKEN');
    }
  }
  if (browser && (!spans.some(span => span.roleName === 'contoso-storefront-spa' &&
      span.nativeTable === 'AppDependencies' && span.spanId === browser.spanId && span.traceId === browser.traceId) ||
      gateway.parentSpanId !== browser.spanId || gateway.traceId !== browser.traceId)) {
    fail('AZURE_EXAMPLE_BROWSER_GATEWAY_PARENT_MISSING');
  }
  if (ssr) {
    const portal = server('contoso-portal-ssr');
    if (portal.parentSpanId !== null) fail('AZURE_EXAMPLE_SSR_ROOT_NOT_OBSERVED');
    dependency('contoso-portal-ssr', portal, gateway);
  }
}

export function assertAzureScenario(evidence, capture) {
  const allSpans = capture.rows.filter(row => row.recordKind === 'span');
  const invocations = new Set(evidence.observations.workflows.map(row => row.invocation_id));
  evidence.calls.forEach(call => { if (UUID.test(call.invocationId ?? '')) invocations.add(call.invocationId); });
  if (evidence.identity?.invocationId) invocations.add(evidence.identity.invocationId);
  const traces = new Set(allSpans.filter(row => invocations.has(row.businessInvocationId)).map(row => row.traceId));
  if (evidence.browser) evidence.browser.dependencies.forEach(row => traces.add(row.traceId));
  const spans = allSpans.filter(row => traces.has(row.traceId));
  if (!spans.length && evidence.id !== '11') fail('AZURE_EXAMPLE_NATIVE_SPANS_MISSING');
  const keys = new Set();
  for (const span of spans) {
    const key = `${span.traceId}:${span.spanId}`;
    if (keys.has(key)) fail('AZURE_EXAMPLE_DUPLICATE_NATIVE_SPAN');
    keys.add(key);
    if (span.nativeItemCount !== null && span.nativeItemCount !== 1) fail('AZURE_EXAMPLE_WEIGHTED_ROWS_NOT_FULL_FIDELITY');
  }
  const named = name => spans.filter(span => span.operationName === name);
  const assertions = [...evidence.assertions];
  switch (evidence.id) {
    case '01':
    case '02':
    case '12': {
      for (const system of ['postgresql', 'redis']) {
        if (!spans.some(span => span.semanticKind === 'CLIENT' && span.nativeProperties['db.system'] === system &&
            span.durationMs > 0 && span.nativeProperties['db.operation.name'])) fail('AZURE_EXAMPLE_DATA_CLIENT_MISSING');
      }
      if (evidence.id === '01') {
        const browser = evidence.browser.dependencies[0];
        if (!browser) fail('AZURE_EXAMPLE_BROWSER_GATEWAY_PARENT_MISSING');
        assertObservedHttpPath(spans.filter(span => span.traceId === browser.traceId), { browser });
      }
      if (evidence.id === '02' && (!spans.some(span => span.roleName === 'contoso-portal-ssr') ||
          !capture.rows.some(row => row.recordKind === 'view' &&
            spans.some(span => span.roleName === 'contoso-portal-ssr' && span.traceId !== row.traceId)))) {
        fail('AZURE_EXAMPLE_SSR_ROOT_EVIDENCE_MISSING');
      }
      if (evidence.id === '02') {
        const trace = evidence.observations.publications[0]?.envelope_json.traceparent?.split('-')[1];
        if (!trace) fail('AZURE_EXAMPLE_SSR_WORKFLOW_TRACE_MISSING');
        assertObservedHttpPath(spans.filter(span => span.traceId === trace), { ssr: true });
      }
      assertions.push('observed native timed PostgreSQL and Redis CLIENT operations');
      if (evidence.id === '12') {
        if (!evidence.observations.events.some(row => row.kind === 'DATA_CANARIES' &&
            row.facts_json.sqlLiteralAndParameterExecuted === true &&
            row.facts_json.redisKeyValueScriptAndArgumentExecuted === true)) fail('AZURE_EXAMPLE_DATA_CANARIES_NOT_EXECUTED');
        const tables = ['AppRequests', 'AppDependencies', 'AppTraces', 'AppExceptions', 'AppEvents', 'AppPageViews']
          .map(name => ({ name, columns: [{ name: 'Properties', type: 'dynamic' }],
            rows: name === 'AppDependencies' ? [[{ 'db.statement': "SELECT 'SQL_LITERAL_CANARY'" }]] : [] }));
        const negative = scanGraphIntake({ tables, receipt: { complete: true, paginationComplete: true, warnings: [],
          tables: tables.map(table => ({ name: table.name, count: table.rows.length, complete: true })) } });
        if (!negative.findings.some(finding => finding.code === 'PROHIBITED_FIELD')) fail('AZURE_EXAMPLE_DATA_SCANNER_NEGATIVE_FAILED');
        assertions.push('actual read-only SQL/Redis canaries executed; the isolated forbidden-field scanner control rejected');
      }
      break;
    }
    case '03': {
      const sdk = evidence.observations.events.filter(row => row.kind === 'INVENTORY_SDK').map(row => row.facts_json);
      for (const input of evidence.inputs) {
        const actual = sdk.filter(row => row.businessInvocationId === input.invocationId);
        if (!actual.length) fail('AZURE_EXAMPLE_SDK_OBSERVATION_MISSING');
        if (input.caseId === 'valid-unsampled' && actual.some(row => row.sdkSampled !== false || row.sdkRecording !== false)) {
          fail('AZURE_EXAMPLE_UNSAMPLED_CONTEXT_PROMOTED');
        }
        if (input.caseId === 'valid-sampled' || input.caseId === 'valid-unsampled') {
          if (actual.some(row => row.traceId !== parseTraceparent(input.headers.traceparent).traceId)) {
            fail('AZURE_EXAMPLE_TRACE_CONTINUATION_BROKEN');
          }
        }
        if (input.caseId === 'valid-unsampled') {
          if (allSpans.some(span => span.traceId === parseTraceparent(input.headers.traceparent).traceId)) {
            fail('AZURE_EXAMPLE_UNSAMPLED_SPAN_EXPORTED');
          }
        } else {
          const traceIds = new Set(actual.map(row => row.traceId));
          const gateway = allSpans.filter(span => traceIds.has(span.traceId) &&
            span.roleName === 'contoso-corr-poc-apim' && span.nativeTable === 'AppRequests');
          if (gateway.length !== 1) fail('AZURE_EXAMPLE_GATEWAY_REQUEST_AMBIGUOUS');
          if (input.caseId === 'valid-sampled') {
            if (gateway[0].parentSpanId !== parseTraceparent(input.headers.traceparent).parentId) fail('AZURE_EXAMPLE_GATEWAY_PARENT_CHANGED');
          } else if (gateway[0].parentSpanId !== null) fail('AZURE_EXAMPLE_GATEWAY_NEW_ROOT_NOT_OBSERVED');
        }
      }
      assertions.push('actual Inventory SDK sampled/recording state checked for all four Gateway inputs');
      break;
    }
    case '04':
      assertions.push('actual public untrusted/malformed replacement and trusted workload preservation checked');
      break;
    case '05':
      for (const mode of ['INVENTORY_TIMEOUT', 'POSTGRES_ERROR']) {
        if (!evidence.observations.events.some(row => row.kind === 'INVENTORY_SDK' && row.facts_json.fault === mode)) {
          fail('AZURE_EXAMPLE_FAULT_EFFECT_NOT_OBSERVED');
        }
      }
      if (!capture.rows.some(row => row.recordKind === 'exception' && traces.has(row.traceId))) {
        fail('AZURE_EXAMPLE_ASSOCIATED_EXCEPTION_MISSING');
      }
      assertions.push('real isolated Inventory delay and PostgreSQL division error affected Orders');
      break;
    case '06': {
      const publications = evidence.observations.publications.filter(row => row.destination === 'SERVICE_BUS_ORDER');
      if (publications.length !== 1) fail('AZURE_EXAMPLE_RETRY_PRODUCER_AMBIGUOUS');
      const envelope = publications[0].envelope_json, producer = contextOf(envelope.traceparent);
      assertRetry(named('contoso.fulfillment.process').map(nativeAsync), {
        ...producer, parentSpanId: producer.spanId, businessInvocationId: envelope['business.invocation_id'],
        messageId: envelope.messageId, injectedFailures: evidence.retryFailures,
        expectedAttempts: evidence.retryFailures + 1, terminalOutcome: 'SUCCESS'
      });
      assertions.push('all N+1 native PROCESS attempts retain the persisted producer and distinct span identities');
      break;
    }
    case '07': {
      const originals = evidence.observations.publications.filter(row => row.destination === 'SERVICE_BUS_TOPIC' &&
        row.envelope_json.replayOf === null);
      if (originals.length !== 1) fail('AZURE_EXAMPLE_ORIGINAL_DLQ_PUBLICATION_MISSING_OR_AMBIGUOUS');
      const original = originals[0].envelope_json;
      for (const role of ['contoso-fulfillment-worker', 'contoso-notify-worker']) {
        const sends = named('contoso.replay.send').filter(span => span.roleName === role);
        if (!sends.length) fail('AZURE_EXAMPLE_REPLAY_ACTOR_MISSING');
        for (const send of sends) assertReplay(nativeAsync(send), {
          ...contextOf(original.traceparent), businessInvocationId: original['business.invocation_id'], messageId: original.messageId
        });
      }
      assertions.push('both workers emitted native linked replay SEND roots');
      break;
    }
    case '08': {
      const ledger = evidence.observations.contributors;
      if (ledger.length !== 2 || new Set(ledger.map(row => row.branch)).size !== 2) fail('AZURE_EXAMPLE_CONTRIBUTORS_INCOMPLETE');
      const contributors = ledger.flatMap(row => {
        if (!row.result_traceparent) fail('AZURE_EXAMPLE_RESULT_PUBLICATION_MISSING');
        return [contextOf(row.process_traceparent), contextOf(row.result_traceparent)];
      });
      const aggregates = named('contoso.fanin.process');
      if (aggregates.length !== 1) fail('AZURE_EXAMPLE_FANIN_MISSING_OR_DUPLICATED');
      assertLinkedAggregation(nativeAsync(aggregates[0]), contributors, 4);
      assertions.push('one native INTERNAL root links the four persisted PROCESS/SEND contributors');
      break;
    }
    case '09': {
      const producers = evidence.observations.publications.filter(row => row.destination === 'EVENT_HUBS')
        .map(row => contextOf(row.envelope_json.traceparent));
      if (producers.length !== 2 || new Set(producers.map(row => row.traceId)).size !== 2) fail('AZURE_EXAMPLE_BATCH_NOT_MIXED');
      const batches = named('contoso.eventhubs.batch.process').filter(span => nativeLinks(span.nativeLinksJson).length === 2);
      if (batches.length !== 1) fail('AZURE_EXAMPLE_MIXED_BATCH_NOT_OBSERVED');
      assertBatch(nativeAsync(batches[0]), producers, 2);
      assertions.push('the native mixed batch has no arbitrary parent and links both actual producers');
      break;
    }
    case '10':
      assertions.push('actual Event Grid and Storage Queue redelivery produced durable DUPLICATE observations');
      break;
    case '11':
      if (evidence.rejections.length !== 3 ||
          !evidence.rejections.some(row => row.reason === 'ENVELOPE_TOO_LARGE') ||
          !evidence.rejections.some(row => row.reason === 'UNTRUSTED_PUBLICATION')) fail('AZURE_EXAMPLE_REJECTION_GUARDS_MISSING');
      assertions.push('broker DLQ observations identify all three run-owned malformed/untrusted inputs');
      break;
    case '13':
      if (!spans.some(span => /^h1:[a-f0-9]{32}:[A-Za-z0-9_-]{43}$/.test(span.nativeProperties['user.pseudonym'] ?? ''))) {
        fail('AZURE_EXAMPLE_NATIVE_PSEUDONYM_MISSING');
      }
      assertions.push('actual human pseudonym and rejected invalid bearer observed without persisting either token');
      break;
    case '14':
      assertions.push('native orphan candidates are queried separately; unexplained candidates remain defects');
      break;
    case '15': {
      const durations = evidence.load.receipts.map(row => row.durationMs);
      if (durations.some(value => !Number.isFinite(value) || value < 0)) fail('AZURE_EXAMPLE_NATIVE_LATENCY_UNAVAILABLE');
      evidence.load.p95Ms = percentile(durations, 95); evidence.load.p99Ms = percentile(durations, 99);
      evidence.load.unexpectedErrorPercent = 100 * evidence.load.receipts.filter(row => row.status >= 400).length / durations.length;
      evidence.load.instrumentationOverheadPercent = null;
      evidence.load.overheadStatus = 'UNVERIFIED: no independently qualified equivalent uninstrumented deployment';
      assertions.push('bounded live Gateway request latency measured; overhead and zero-loss remain unverified');
      break;
    }
    default: fail('AZURE_EXAMPLE_UNKNOWN_SCENARIO');
  }
  return { result: 'OBSERVED', assertions, formalAcceptance: false, certificationStatus: 'NOT CERTIFIED',
    gaps: ['independently enrolled full-path observer and complete emission ledger',
      'global all-table privacy and accountable owner acceptance',
      ...(evidence.id === '03' ? ['independent Gateway outbound-wire and native null-parent root receipts'] : []),
      ...(evidence.id === '15' ? ['qualified overhead baseline, exporter backpressure and complete loss accounting'] : [])] };
}
