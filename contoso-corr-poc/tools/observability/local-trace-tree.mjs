import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTraceparent } from '../protocol.mjs';
import { parseNativeCaptureInput } from '../security/native-payload.mjs';
import { forbiddenField, forbiddenString } from '../security/values.mjs';
import { assertInvariants, VerificationFailure } from '../verification/invariants.mjs';
import { createBoundDirectory, projectRoot, readBoundFile } from '../verification/files.mjs';
import { openSamplerNativeReceiver } from './sampler-native-intake.mjs';
import { canonicalSpanId, ownedConfigurationHash, requireUtc, sha256, SPAN, TRACE, UUID,
  validateBoundaryMap } from './telemetry-contract.mjs';

export const LOCAL_REHEARSAL_PROFILE = 'LOCAL_REHEARSAL';
export const FULL_CHAIN_PROFILE = 'FULL_CHAIN';
export const EXPECTED_REMOTE_BOUNDARIES = Object.freeze(['gateway.request', 'gateway.backend']);
const sourceFile = fileURLToPath(import.meta.url);
export const LOCAL_TRACE_TREE_SOURCE_SHA256 = sha256(await readFile(sourceFile));
const MAX_FILE_BYTES = 16_777_216;
const MAX_ENVELOPES = 8192;
const liveCaptures = new WeakSet();
const fail = (code, detail) => { throw new VerificationFailure(code, detail); };
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

function checkSavedValues(value, depth = 0, budget = { nodes: 0 }) {
  if (depth > 32 || ++budget.nodes > 131072) fail('LOCAL_CAPTURE_BOUND', 'Local input exceeds its structural bound');
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > 4096 || forbiddenString(value)) fail('LOCAL_CAPTURE_PRIVACY', 'Unsafe local input is not projected');
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (Buffer.byteLength(key) > 128 || forbiddenField(key) ||
          /^(?:__proto__|prototype|constructor|iKey|connectionString|token)$/i.test(key)) {
        fail('LOCAL_CAPTURE_PRIVACY', 'Unsafe local input is not projected');
      }
      checkSavedValues(child, depth + 1, budget);
    }
  }
}

export function rehearsalBoundaryProfile(map, profile = LOCAL_REHEARSAL_PROFILE) {
  validateBoundaryMap(map);
  if (![LOCAL_REHEARSAL_PROFILE, FULL_CHAIN_PROFILE].includes(profile)) {
    fail('LOCAL_PROFILE', 'Choose LOCAL_REHEARSAL or FULL_CHAIN explicitly');
  }
  const projected = structuredClone(map);
  const remote = profile === LOCAL_REHEARSAL_PROFILE ? [...EXPECTED_REMOTE_BOUNDARIES] : [];
  if (remote.length) {
    projected.edges = projected.edges.filter(edge => !remote.includes(edge.from) && !remote.includes(edge.to));
    projected.edges.push({ from: 'storefront.http', to: 'orders.request', type: 'parent', path: 'sync' });
  }
  return freeze({
    name: profile, label: 'LOCAL REHEARSAL', map: projected,
    requiredBoundaries: map.coreSynchronousBoundaries.filter(boundary => !remote.includes(boundary)),
    expectedRemoteBoundaries: remote,
    fullChainCoverage: false, certificationEligible: false,
    sourceMapSha256: ownedConfigurationHash(map),
    profileSha256: ownedConfigurationHash({ name: profile, remote, edges: projected.edges,
      requiredBoundaries: map.coreSynchronousBoundaries.filter(boundary => !remote.includes(boundary)) })
  });
}

export async function openLocalTraceReceiver(options) {
  const receiver = await openSamplerNativeReceiver(options);
  let captured;
  return Object.freeze({
    endpoint: receiver.endpoint,
    diagnostics: receiver.diagnostics,
    async finish() {
      if (!captured) {
        const intake = await receiver.finish();
        captured = freeze({
          schema: 'contoso.local-rehearsal-capture.v1', label: 'LOCAL REHEARSAL',
          nativeEvidence: false, certificationEligible: false,
          envelopes: intake.observations.map(value => value.envelope),
          originalPrivacyCapture: intake.originalPrivacyCapture,
          receiverDiagnostics: intake.receiverDiagnostics
        });
        liveCaptures.add(captured);
      }
      return captured;
    },
    stop: receiver.stop
  });
}

function browserCarrier(browser, businessInvocationId) {
  if (browser?.schemaVersion !== 1 || !['local', 'fixture'].includes(browser.executionMode) ||
      browser.driverKind !== 'browser-spa' || browser.sdkVersion !== '3.4.5' ||
      browser.demoId !== 1 || browser.outcome !== 'staged' || !UUID.test(browser.runId ?? '') ||
      !Number.isSafeInteger(browser.invocationVersion) || browser.invocationVersion < 1 ||
      browser.businessInvocationId !== businessInvocationId ||
      !Array.isArray(browser.observations) || !Array.isArray(browser.dependencies) ||
      !Array.isArray(browser.browserContexts)) fail('LOCAL_BROWSER_CAPTURE', 'Current local browser capture is required');
  const matches = browser.observations.filter(value => value.method === 'POST' && /\/orders$/.test(value.path ?? '') &&
    value.status >= 200 && value.status < 300 && value.businessInvocationId === businessInvocationId &&
    value.contextRedacted !== true);
  if (matches.length !== 1) fail('LOCAL_BROWSER_CARRIER', 'One successful local POST /orders carrier is required');
  const carrier = parseTraceparent(matches[0].traceparent);
  if (!carrier.valid || !carrier.sampled) fail('LOCAL_BROWSER_CARRIER', 'One valid sampled browser carrier is required');
  const dependencies = browser.dependencies.filter(value => value.traceId === carrier.traceId && value.spanId === carrier.parentId &&
    value.runId === browser.runId && value.invocationVersion === browser.invocationVersion &&
    (!value.businessInvocationId || value.businessInvocationId === businessInvocationId));
  if (dependencies.length !== 1) fail('LOCAL_BROWSER_DEPENDENCY', 'Carrier must equal the actual browser SDK dependency identity');
  try {
    if (canonicalSpanId(dependencies[0].dependencyId, carrier.traceId,
      { format: 'ai-composite', evidenceSha256: ownedConfigurationHash(browser) }) !== carrier.parentId) {
      fail('LOCAL_BROWSER_DEPENDENCY', 'The original browser dependency ID must agree with the carrier');
    }
  } catch { fail('LOCAL_BROWSER_DEPENDENCY', 'The original browser dependency ID must agree with the carrier'); }
  return carrier;
}

function normalizeEnvelope(envelope, ordinal, captureId, sourceKind) {
  const data = envelope.data.baseData;
  const traceId = envelope.tags?.['ai.operation.id'];
  if (!TRACE.test(traceId ?? '')) fail('A_SPLIT_TRACE', 'Missing or invalid local OperationId');
  const serialization = { format: 'ai-composite', evidenceSha256: ownedConfigurationHash(envelope) };
  let spanId, parentSpanId;
  try {
    spanId = canonicalSpanId(data.id, traceId, serialization);
    parentSpanId = canonicalSpanId(envelope.tags?.['ai.operation.parentId'], traceId, serialization);
  } catch { fail('B_SPAN_ID', 'Invalid local span or parent serialization'); }
  if (!spanId) fail('B_SPAN_ID', 'Local spans require an actual nonzero ID');
  let timeGeneratedUtc;
  try { timeGeneratedUtc = requireUtc(envelope.time, 'local span time'); }
  catch { fail('LOCAL_CAPTURE_TIME', 'Actual UTC envelope time is required'); }
  const nativeTable = envelope.data.baseType === 'RequestData' ? 'AppRequests' : 'AppDependencies';
  const properties = data.properties ?? {};
  const semanticKind = properties['contoso.span.kind'] ?? (nativeTable === 'AppRequests' ? 'SERVER' : 'CLIENT');
  if (!['SERVER', 'CLIENT', 'INTERNAL', 'PRODUCER', 'CONSUMER'].includes(semanticKind)) {
    fail('C_KIND', 'Local spans require an observed supported span kind');
  }
  return {
    schemaVersion: 'contoso.telemetry-evidence.v1', recordKind: 'span', sourceKind,
    certificationEligible: false, nativeTable, timeGeneratedUtc,
    recordLocator: { captureId, nativeTable, rowOrdinal: ordinal },
    traceId, spanId, parentSpanId, nativeOperationId: traceId,
    nativeId: data.id, nativeParentId: envelope.tags?.['ai.operation.parentId'] ?? null,
    roleName: envelope.tags?.['ai.cloud.role'] ?? '',
    semanticKind,
    operationName: data.name ?? '', nativeProperties: properties,
    businessInvocationId: properties['business.invocation_id'] ?? null,
    evidenceSha256: ownedConfigurationHash(envelope)
  };
}

function boundaryOf(row, carrier) {
  const name = row.operationName;
  if (row.roleName === 'contoso-storefront-spa' && row.nativeTable === 'AppDependencies' &&
      row.traceId === carrier.traceId && row.spanId === carrier.parentId) return 'storefront.http';
  if (row.roleName === 'contoso-corr-poc-apim') {
    return row.nativeTable === 'AppRequests' ? 'gateway.request' : 'gateway.backend';
  }
  if (row.roleName === 'contoso-orders-api') {
    if (row.nativeTable === 'AppRequests' && /^POST \/api\/orders$/.test(name)) return 'orders.request';
    if (row.nativeTable === 'AppDependencies' && /^GET \/api\/inventory\/[^/?\s]+$/.test(name)) return 'orders.inventory';
    if (name === 'contoso.orders.validate') return 'orders.validation';
  }
  if (row.roleName === 'contoso-inventory-api') {
    if (row.nativeTable === 'AppRequests' && /^GET \/api\/inventory\/[^/?\s]+$/.test(name)) return 'inventory.request';
    if (row.nativeTable === 'AppDependencies' && /^contoso\.pg\.[a-z]+$/.test(name)) return 'postgres.logical';
    if (row.nativeTable === 'AppDependencies' && /^contoso\.redis\.[a-z]+$/.test(name)) return 'redis.logical';
  }
  return null;
}

function printTree(rows, assignments) {
  const byId = new Map(rows.map(row => [row.spanId, row]));
  const boundaries = new Map(assignments.map(value => [value.spanId, value.boundaryId]));
  const roots = rows.filter(row => !byId.has(row.parentSpanId));
  if (roots.length !== 1 || boundaries.get(roots[0].spanId) !== 'storefront.http') {
    fail('B_LOCAL_TREE', 'One connected tree rooted at storefront.http is required');
  }
  const children = new Map(), seen = new Set(), lines = [];
  for (const row of rows) {
    const siblings = children.get(row.parentSpanId) ?? [];
    siblings.push(row);
    children.set(row.parentSpanId, siblings);
  }
  const pending = [{ row: roots[0], depth: 0 }];
  while (pending.length) {
    const { row, depth } = pending.pop();
    if (depth > 64) fail('B_LOCAL_TREE', 'Local tree exceeds its bounded rendering depth');
    if (seen.has(row.spanId)) fail('B_LOCAL_TREE', 'Cycle or repeated child in local tree');
    seen.add(row.spanId);
    lines.push(`${'  '.repeat(depth)}${boundaries.get(row.spanId) ?? 'unclassified'} [${row.semanticKind}] ${row.spanId}`);
    for (const child of (children.get(row.spanId) ?? []).sort((a, b) => b.spanId.localeCompare(a.spanId))) {
      pending.push({ row: child, depth: depth + 1 });
    }
  }
  if (seen.size !== rows.length) fail('B_LOCAL_TREE', 'Disconnected or cyclic local spans are not one tree');
  return lines;
}

export function mergeLocalTraceTree({ map, browserEvidence, jvmEnvelopes = [], browserEnvelopes = [],
  capture, businessInvocationId, profile = LOCAL_REHEARSAL_PROFILE, fromUtc, toUtc }) {
  if (!UUID.test(businessInvocationId ?? '')) fail('A_BUSINESS_ID', 'One UUIDv4 invocation is required');
  const selectedProfile = rehearsalBoundaryProfile(map, profile);
  const callerEnvelopes = [...browserEnvelopes, ...jvmEnvelopes];
  const originalLoopbackOnly = liveCaptures.has(capture) && callerEnvelopes.length === 0;
  const sourceKind = originalLoopbackOnly ? 'real-local-agent-loopback' : 'fixture-check';
  const envelopes = [...callerEnvelopes, ...(capture?.envelopes ?? [])];
  if (!envelopes.length || envelopes.length > MAX_ENVELOPES) fail('A_ABSENCE', 'A bounded actual span capture is required');
  checkSavedValues({ browserEvidence, envelopes });
  const carrier = browserCarrier(browserEvidence, businessInvocationId);
  const captureId = ownedConfigurationHash(envelopes);
  const browserContextRecords = envelopes.flatMap((value, ordinal) => value.data?.baseType === 'PageviewData' &&
    value.tags?.['ai.cloud.role'] === 'contoso-storefront-spa' && value.tags?.['ai.operation.id'] === carrier.traceId
    ? [{ recordKind: 'view', identityKind: 'sdk-page-view-display-id-not-span', renderedAsSpan: false,
      traceId: value.tags['ai.operation.id'], viewId: value.data.baseData?.id ?? null,
      sourceEnvelopeOrdinal: ordinal, observedAtUtc: value.time ?? null }] : []);
  const spanEnvelopes = envelopes.map((value, ordinal) => ({ value, ordinal }))
    .filter(({ value }) => ['RequestData', 'RemoteDependencyData'].includes(value?.data?.baseType));
  const cohort = spanEnvelopes.filter(({ value }) => value.tags?.['ai.operation.id'] === carrier.traceId ||
    value.data.baseData?.properties?.['business.invocation_id'] === businessInvocationId);
  const rows = cohort.map(({ value, ordinal }) => normalizeEnvelope(value, ordinal, captureId, sourceKind));
  const assignments = rows.flatMap(row => {
    const boundaryId = boundaryOf(row, carrier);
    return boundaryId ? [{ traceId: row.traceId, spanId: row.spanId, boundaryId,
      observed: true, evidenceSha256: row.evidenceSha256 }] : [];
  });
  if (selectedProfile.expectedRemoteBoundaries.some(boundary => assignments.some(value => value.boundaryId === boundary))) {
    fail('LOCAL_PROFILE_REMOTE_SPAN', 'Captured Gateway spans require the untouched FULL_CHAIN profile');
  }
  const contexts = browserEvidence.browserContexts.filter(value => value.traceId === carrier.traceId &&
    value.identityKind === 'sdk-browser-context-not-span' && SPAN.test(value.contextSpanId ?? ''))
    .map(value => ({ traceId: value.traceId, contextSpanId: value.contextSpanId,
      identityKind: value.identityKind, roleName: 'contoso-storefront-spa',
      observed: true, evidenceSha256: ownedConfigurationHash(value) }));
  const times = rows.map(row => Date.parse(row.timeGeneratedUtc));
  const start = fromUtc ?? (times.length ? new Date(Math.min(...times)).toISOString() : '');
  const end = toUtc ?? (times.length ? new Date(Math.max(...times) + 1).toISOString() : '');
  let invariants;
  const boundaryCounts = Object.fromEntries(['storefront.http', 'orders.request', 'orders.inventory', 'inventory.request',
    ...(profile === FULL_CHAIN_PROFILE ? EXPECTED_REMOTE_BOUNDARIES : [])].map(boundary => [boundary, 1]));
  try {
    invariants = assertInvariants({ map: selectedProfile.map, rows, assignments,
      expectation: { traceIds: [carrier.traceId], paths: ['spa', 'sync'], businessInvocationId,
        requiredBoundaries: selectedProfile.requiredBoundaries, browserContexts: contexts, boundaryCounts },
      fromUtc: start, toUtc: end, mode: 'LocalValidate' });
  } catch (error) {
    const edge = boundary => {
      const parents = selectedProfile.map.edges.filter(value => value.to === boundary && value.type === 'parent' &&
        ['spa', 'sync'].includes(value.path)).map(value => value.from);
      return `${parents.join('|') || 'browser context'} -> ${boundary ?? 'unclassified span'}`;
    };
    if (error.code === 'C_MISSING_HOP') {
      const missing = selectedProfile.requiredBoundaries.find(value => error.message.endsWith(` ${value}`));
      fail(error.code, `Missing observed edge ${edge(missing)}`);
    }
    if (error.code === 'A_SPLIT_TRACE') {
      const split = rows.find(row => row.traceId !== carrier.traceId);
      fail(error.code, `Split invocation trace at ${edge(split && boundaryOf(split, carrier))}`);
    }
    if (error.code === 'B_DUPLICATE_SPAN') {
      const repeated = rows.find((row, index) => rows.findIndex(value => value.spanId === row.spanId) !== index);
      fail(error.code, `Repeated actual span ID at ${edge(repeated && boundaryOf(repeated, carrier))}`);
    }
    throw error;
  }
  const lines = printTree(rows, assignments);
  const fullChain = { result: 'NOT_RUN', code: null };
  if (profile === LOCAL_REHEARSAL_PROFILE) {
    try {
      assertInvariants({ map, rows, assignments,
        expectation: { traceIds: [carrier.traceId], paths: ['spa', 'sync'], businessInvocationId, browserContexts: contexts },
        fromUtc: start, toUtc: end, mode: 'LocalValidate' });
      fail('LOCAL_PROFILE_LEAK', 'A Gateway-free rehearsal unexpectedly passed the full-chain invariant');
    } catch (error) {
      if (error.code !== 'C_MISSING_HOP') throw error;
      fullChain.result = 'FAIL';
      fullChain.code = error.code;
      fullChain.missingBoundaries = [...EXPECTED_REMOTE_BOUNDARIES];
    }
  }
  const header = `LOCAL REHEARSAL | ${profile} | trace ${carrier.traceId}`;
  return freeze({
    schema: 'contoso.local-trace-tree.v1', result: 'PASS', label: 'LOCAL REHEARSAL',
    profile, profileSha256: selectedProfile.profileSha256,
    sourceMapSha256: selectedProfile.sourceMapSha256,
    collectorSourceSha256: LOCAL_TRACE_TREE_SOURCE_SHA256,
    nativeEvidence: false, certificationEligible: false, sourceAcceptanceIsCertification: false,
    sourceAuthority: originalLoopbackOnly ? 'IN_PROCESS_LOOPBACK_LOCAL_ONLY' : 'SAVED_CAPTURE_STRUCTURAL_CHECK_ONLY',
    expectedRemoteBoundaries: selectedProfile.expectedRemoteBoundaries,
    omittedBoundaries: selectedProfile.expectedRemoteBoundaries,
    businessInvocationId, traceId: carrier.traceId, fromUtc: start, toUtc: end,
    counts: { inputEnvelopes: envelopes.length, ignoredNonSpans: envelopes.length - spanEnvelopes.length,
      outsideInvocation: spanEnvelopes.length - cohort.length, contextOnlyPageViews: browserContextRecords.length,
      spans: rows.length, trees: 1 },
    invariants, fullChain, rows, assignments, browserContextRecords,
    tree: `${header}\nExpected remote: ${selectedProfile.expectedRemoteBoundaries.join(', ') || 'none'}\n` +
      `${lines.join('\n')}\nA PASS | B PASS | C PASS (${profile} only)\n` +
      (profile === LOCAL_REHEARSAL_PROFILE ? `FULL_CHAIN C FAIL ${fullChain.code}: ${EXPECTED_REMOTE_BOUNDARIES.join(', ')}\n` : '')
  });
}

export function checkSeededLocalFailures(input) {
  const positive = mergeLocalTraceTree(input);
  if (positive.profile !== LOCAL_REHEARSAL_PROFILE) fail('LOCAL_PROFILE', 'Seeded local controls require LOCAL_REHEARSAL');
  const original = [...(input.browserEnvelopes ?? []), ...(input.jvmEnvelopes ?? []), ...(input.capture?.envelopes ?? [])];
  const ordinal = boundary => positive.rows.find(row => positive.assignments.some(binding =>
    binding.spanId === row.spanId && binding.boundaryId === boundary))?.recordLocator.rowOrdinal;
  const inventory = ordinal('inventory.request'), orders = ordinal('orders.request');
  const controls = [
    { name: 'split-trace', expectedCode: 'A_SPLIT_TRACE', mutate(envelopes) {
      const target = envelopes[inventory];
      target.tags['ai.operation.id'] = positive.traceId === 'f'.repeat(32) ? 'e'.repeat(32) : 'f'.repeat(32);
      target.data.baseData.properties ??= {};
      target.data.baseData.properties['business.invocation_id'] = input.businessInvocationId;
    } },
    { name: 'duplicate-span', expectedCode: 'B_DUPLICATE_SPAN', mutate(envelopes) {
      envelopes.push(structuredClone(envelopes[orders]));
    } },
    { name: 'wrong-parent', expectedCode: 'B_WRONG_EDGE', mutate(envelopes) {
      envelopes[inventory].tags['ai.operation.parentId'] = positive.rows.find(row =>
        positive.assignments.some(binding => binding.spanId === row.spanId && binding.boundaryId === 'orders.request')).spanId;
    } },
    ...rehearsalBoundaryProfile(input.map).requiredBoundaries.map(boundary => ({
      name: `missing:${boundary}`, expectedCode: 'C_MISSING_HOP', mutate(envelopes) {
        const ordinals = new Set(positive.rows.filter(row => positive.assignments.some(binding =>
          binding.spanId === row.spanId && binding.boundaryId === boundary)).map(row => row.recordLocator.rowOrdinal));
        for (const index of [...ordinals].sort((a, b) => b - a)) envelopes.splice(index, 1);
      }
    }))
  ];
  return freeze(controls.map(control => {
    const envelopes = structuredClone(original);
    control.mutate(envelopes);
    let failure;
    try {
      mergeLocalTraceTree({ map: input.map, browserEvidence: structuredClone(input.browserEvidence),
        browserEnvelopes: envelopes, businessInvocationId: input.businessInvocationId,
        profile: LOCAL_REHEARSAL_PROFILE, fromUtc: input.fromUtc, toUtc: input.toUtc });
    } catch (error) { failure = error; }
    if (failure?.code !== control.expectedCode) fail('LOCAL_CONTROL_NOT_REJECTED', `Seeded ${control.name} did not fail as required`);
    return {
      name: control.name, result: 'EXPECTED_FAILURE', failureCode: failure.code, detail: failure.message,
      sourceScope: 'SEEDED_CHECKER_MUTATION_NOT_RUNTIME_FAULT_INJECTION', nativeEvidence: false
    };
  }));
}

async function savedFile(file, ndjson = false) {
  const absolute = resolve(projectRoot, file);
  if ((await stat(absolute)).size > MAX_FILE_BYTES) fail('LOCAL_CAPTURE_BOUND', 'Local capture file exceeds 16 MiB');
  const bytes = await readBoundFile(relative(projectRoot, absolute));
  let value;
  try {
    value = ndjson ? bytes.toString('utf8').split(/\r?\n/).filter(line => line.trim())
      .map(line => parseNativeCaptureInput(Buffer.from(line))) : parseNativeCaptureInput(bytes);
  } catch { fail('LOCAL_CAPTURE_JSON', 'Bounded strict local JSON is required'); }
  return { value, source: { path: relative(projectRoot, absolute), sha256: sha256(bytes), bytes: bytes.length } };
}

async function main(args) {
  const options = {};
  const allowed = new Set(['browser', 'browser-telemetry', 'jvm', 'invocation', 'profile', 'controls', 'output-directory']);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.slice(2);
    if (!args[index]?.startsWith('--') || !allowed.has(key) || !args[index + 1] || Object.hasOwn(options, key)) {
      fail('LOCAL_ARGUMENTS', 'Use --browser, --browser-telemetry, --jvm, --invocation, --profile, --controls and --output-directory');
    }
    options[key] = args[index + 1];
  }
  if (!options.browser || !options.jvm || !options.invocation) fail('LOCAL_ARGUMENTS', 'Browser, JVM captures and invocation are required');
  if (options.controls !== undefined && options.controls !== 'seeded') fail('LOCAL_ARGUMENTS', 'The supported controls are --controls seeded');
  const [browser, jvm, browserTelemetry, boundaryMap] = await Promise.all([
    savedFile(options.browser), savedFile(options.jvm, true),
    options['browser-telemetry'] ? savedFile(options['browser-telemetry'], true) : null,
    savedFile('contracts\\expected-boundary-map.v1.json')
  ]);
  const input = {
    map: boundaryMap.value, browserEvidence: browser.value, jvmEnvelopes: jvm.value,
    browserEnvelopes: browserTelemetry?.value ?? [], businessInvocationId: options.invocation,
    profile: options.profile ?? LOCAL_REHEARSAL_PROFILE
  };
  const result = mergeLocalTraceTree(input);
  const seededFailureControls = options.controls ? checkSeededLocalFailures(input) : [];
  const receipt = { ...result, inputFiles: [browser.source, jvm.source, boundaryMap.source,
    ...(browserTelemetry ? [browserTelemetry.source] : [])], nativeQueriesExecuted: 0, seededFailureControls };
  if (options['output-directory']) {
    const directory = await createBoundDirectory(resolve(projectRoot, options['output-directory']));
    await writeFile(join(directory, 'local-trace-tree.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    await writeFile(join(directory, 'local-trace-tree.txt'), result.tree, { flag: 'wx' });
  }
  process.stdout.write(result.tree);
  for (const control of seededFailureControls) process.stdout.write(`SEEDED CHECKER CONTROL ${control.name}: EXPECTED FAIL ${control.failureCode}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === sourceFile) {
  try { await main(process.argv.slice(2)); }
  catch (error) {
    const detail = error instanceof VerificationFailure ? error.message : 'LOCAL_CAPTURE_IO: Local capture could not be read or written';
    process.stderr.write(`LOCAL REHEARSAL FAIL ${detail}\n`);
    process.exitCode = 1;
  }
}
