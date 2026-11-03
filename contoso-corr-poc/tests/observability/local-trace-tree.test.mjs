import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join, relative } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_REMOTE_BOUNDARIES, FULL_CHAIN_PROFILE, LOCAL_REHEARSAL_PROFILE,
  checkSeededLocalFailures, mergeLocalTraceTree, openLocalTraceReceiver, rehearsalBoundaryProfile
} from '../../tools/observability/local-trace-tree.mjs';
import { ownedConfigurationHash } from '../../tools/observability/telemetry-contract.mjs';
import { projectRoot } from '../../tools/verification/files.mjs';
import { assertInvariants } from '../../tools/verification/invariants.mjs';

const execute = promisify(execFile);
const map = JSON.parse(await readFile(new URL('../../contracts/expected-boundary-map.v1.json', import.meta.url), 'utf8'));
const traceId = '1'.repeat(32);
const otherTrace = '2'.repeat(32);
const id = value => value.toString(16).padStart(16, '0');
const time = '2026-11-02T20:00:00.000Z';

function fixture({ gateway = false, composite = false } = {}) {
  const businessInvocationId = randomUUID(), runId = randomUUID();
  const envelope = (span, parent, role, name, kind, baseType) => ({
    name: `Microsoft.ApplicationInsights.${baseType}`, time,
    tags: { 'ai.operation.id': traceId, 'ai.operation.parentId': parent, 'ai.cloud.role': role },
    data: { baseType, baseData: { id: span, name, duration: '00:00:00.0010000', success: true,
      properties: { 'business.invocation_id': businessInvocationId, 'contoso.span.kind': kind } } }
  });
  const browser = envelope(composite ? `|${traceId}.${id(1)}.` : id(1), id(100),
    'contoso-storefront-spa', 'POST /contoso/v1/orders', 'CLIENT', 'RemoteDependencyData');
  const jvmEnvelopes = [
    envelope(id(3), gateway ? id(8) : id(1), 'contoso-orders-api', 'POST /api/orders', 'SERVER', 'RequestData'),
    envelope(id(4), id(3), 'contoso-orders-api', 'GET /api/inventory/CONTOSO-001', 'CLIENT', 'RemoteDependencyData'),
    envelope(id(5), id(4), 'contoso-inventory-api', 'GET /api/inventory/CONTOSO-001', 'SERVER', 'RequestData'),
    envelope(id(6), id(5), 'contoso-inventory-api', 'contoso.pg.select', 'CLIENT', 'RemoteDependencyData'),
    envelope(id(7), id(5), 'contoso-inventory-api', 'contoso.redis.get', 'CLIENT', 'RemoteDependencyData')
  ];
  if (gateway) jvmEnvelopes.push(
    envelope(id(2), id(1), 'contoso-corr-poc-apim', 'POST /contoso/v1/orders', 'SERVER', 'RequestData'),
    envelope(id(8), id(2), 'contoso-corr-poc-apim', 'POST /api/orders', 'CLIENT', 'RemoteDependencyData')
  );
  const browserEvidence = {
    schemaVersion: 1, executionMode: 'fixture', evidenceKind: 'synthetic-parser-input-not-live-evidence',
    runId, invocationVersion: 1, demoId: 1, sdkVersion: '3.4.5',
    driverKind: 'browser-spa', outcome: 'staged', businessInvocationId,
    observations: [{ method: 'POST', origin: 'http://127.0.0.1:19340', path: '/contoso/v1/orders',
      status: 201, traceparent: `00-${traceId}-${id(1)}-01`, businessInvocationId }],
    dependencies: [{ traceId, spanId: id(1), dependencyId: browser.data.baseData.id, runId,
      invocationVersion: 1, businessInvocationId }],
    browserContexts: [{ schemaVersion: 1, sdkVersion: '3.4.5', identityKind: 'sdk-browser-context-not-span',
      pageInstanceId: randomUUID(), traceId, contextSpanId: id(100), observedAtUtc: time }]
  };
  return { map, browserEvidence, browserEnvelopes: [browser], jvmEnvelopes, businessInvocationId };
}

test('complete local checker renders one six-span tree and A/B/C PASS only under the named rehearsal profile', () => {
  const value = fixture();
  const result = mergeLocalTraceTree(value);
  assert.equal(result.result, 'PASS');
  assert.equal(result.label, 'LOCAL REHEARSAL');
  assert.equal(result.profile, LOCAL_REHEARSAL_PROFILE);
  assert.equal(result.sourceAuthority, 'SAVED_CAPTURE_STRUCTURAL_CHECK_ONLY');
  assert.equal(result.nativeEvidence, false);
  assert.equal(result.certificationEligible, false);
  assert.deepEqual(result.expectedRemoteBoundaries, ['gateway.request', 'gateway.backend']);
  assert.deepEqual(result.invariants.invariants, ['A', 'B', 'C']);
  assert.equal(result.counts.spans, 6);
  assert.equal(result.counts.trees, 1);
  assert.match(result.tree, /\nstorefront\.http \[CLIENT\]/);
  assert.match(result.tree, /\n  orders\.request \[SERVER\]/);
  assert.match(result.tree, /\n    orders\.inventory \[CLIENT\]/);
  assert.match(result.tree, /\n      inventory\.request \[SERVER\]/);
  assert.match(result.tree, /\n        postgres\.logical \[CLIENT\]/);
  assert.match(result.tree, /FULL_CHAIN C FAIL C_MISSING_HOP/);
  assert.equal(result.fullChain.result, 'FAIL');
  assert.throws(() => { result.expectedRemoteBoundaries.push('postgres.logical'); }, TypeError);
});

test('rehearsal projection never mutates the immutable root map and excludes exactly the two Gateway hops', () => {
  const before = ownedConfigurationHash(map);
  const profile = rehearsalBoundaryProfile(map);
  assert.equal(ownedConfigurationHash(map), before);
  assert.equal(profile.sourceMapSha256, before);
  assert.deepEqual(profile.expectedRemoteBoundaries, EXPECTED_REMOTE_BOUNDARIES);
  assert.equal(profile.requiredBoundaries.length, map.coreSynchronousBoundaries.length - 2);
  assert(profile.map.edges.some(edge => edge.from === 'storefront.http' && edge.to === 'orders.request'));
  assert(!map.edges.some(edge => edge.from === 'storefront.http' && edge.to === 'orders.request'));
  assert.throws(() => rehearsalBoundaryProfile(map, 'CERTIFY'), error => error.code === 'LOCAL_PROFILE');
});

test('untouched full-chain assertion rejects Gateway-free rows even after local A/B/C passed', () => {
  const value = fixture(), result = mergeLocalTraceTree(value);
  assert.throws(() => assertInvariants({ map, rows: result.rows, assignments: result.assignments,
    expectation: { traceIds: [traceId], paths: ['spa', 'sync'], businessInvocationId: value.businessInvocationId },
    fromUtc: result.fromUtc, toUtc: result.toUtc }),
  error => error.code === 'C_MISSING_HOP' && error.message.includes('gateway.request'));
  assert.throws(() => mergeLocalTraceTree({ ...value, profile: FULL_CHAIN_PROFILE }),
    error => error.code === 'C_MISSING_HOP' && error.message.includes('storefront.http -> gateway.request'));
});

test('full-chain checker needs actual Gateway spans, and the rehearsal profile refuses to hide captured Gateway spans', () => {
  const value = fixture({ gateway: true });
  assert.throws(() => mergeLocalTraceTree(value), error => error.code === 'LOCAL_PROFILE_REMOTE_SPAN');
  const result = mergeLocalTraceTree({ ...value, profile: FULL_CHAIN_PROFILE });
  assert.equal(result.counts.spans, 8);
  assert.equal(result.invariants.result, 'PASS');
  assert.deepEqual(result.expectedRemoteBoundaries, []);
  assert.equal(result.certificationEligible, false);
});

test('split trace is not filtered out of the same invocation or silently joined', () => {
  const value = fixture();
  value.jvmEnvelopes[2].tags['ai.operation.id'] = otherTrace;
  assert.throws(() => mergeLocalTraceTree(value),
    error => error.code === 'A_SPLIT_TRACE' && error.message.includes('orders.inventory -> inventory.request'));
});

test('physical duplicate span exports are not deduplicated', () => {
  const value = fixture();
  value.jvmEnvelopes.push(structuredClone(value.jvmEnvelopes[0]));
  assert.throws(() => mergeLocalTraceTree(value),
    error => error.code === 'B_DUPLICATE_SPAN' && error.message.includes('storefront.http -> orders.request'));
});

test('span ID reuse across different logical operations fails B', () => {
  const value = fixture();
  value.jvmEnvelopes[4].data.baseData.id = value.jvmEnvelopes[3].data.baseData.id;
  assert.throws(() => mergeLocalTraceTree(value), error => error.code === 'B_DUPLICATE_SPAN');
});

test('wrong Inventory ParentId fails naming the actual intended edge', () => {
  const value = fixture();
  value.jvmEnvelopes[2].tags['ai.operation.parentId'] = id(3);
  assert.throws(() => mergeLocalTraceTree(value),
    error => error.code === 'B_WRONG_EDGE' && error.message.includes('orders.inventory -> inventory.request'));
});

test('wrong Orders ParentId cannot be excused as the omitted Gateway boundary', () => {
  const value = fixture();
  value.jvmEnvelopes[0].tags['ai.operation.parentId'] = id(99);
  assert.throws(() => mergeLocalTraceTree(value),
    error => error.code === 'B_WRONG_EDGE' && error.message.includes('storefront.http -> orders.request'));
});

for (const [boundary, index] of [['orders.request', 0], ['orders.inventory', 1], ['inventory.request', 2],
  ['postgres.logical', 3], ['redis.logical', 4]]) {
  test(`missing ${boundary} fails C naming the missing edge, never expected-remote`, () => {
    const value = fixture();
    value.jvmEnvelopes.splice(index, 1);
    assert.throws(() => mergeLocalTraceTree(value),
      error => error.code === 'C_MISSING_HOP' && error.message.includes(` -> ${boundary}`));
  });
}

test('the browser dependency is mandatory and a carrier/context alone is not a span', () => {
  const value = fixture();
  value.browserEnvelopes = [];
  assert.throws(() => mergeLocalTraceTree(value),
    error => error.code === 'C_MISSING_HOP' && error.message.includes('storefront.http'));
});

test('a different browser SDK dependency identity cannot stand in for the actual wire carrier', () => {
  const value = fixture();
  value.browserEvidence.dependencies[0].spanId = id(99);
  assert.throws(() => mergeLocalTraceTree(value), error => error.code === 'LOCAL_BROWSER_DEPENDENCY');
  const raw = fixture();
  raw.browserEvidence.dependencies[0].dependencyId = id(99);
  assert.throws(() => mergeLocalTraceTree(raw), error => error.code === 'LOCAL_BROWSER_DEPENDENCY');
});

test('a second distinct HTTP server span cannot mask duplicate instrumentation within the one browser invocation', () => {
  const value = fixture(), extra = structuredClone(value.jvmEnvelopes[0]);
  extra.data.baseData.id = id(99);
  value.jvmEnvelopes.push(extra);
  assert.throws(() => mergeLocalTraceTree(value),
    error => error.code === 'C_CARDINALITY' && error.message.includes('orders.request'));
});

test('an unproven browser SDK context cannot waive a missing parent', () => {
  const value = fixture();
  value.browserEvidence.browserContexts = [];
  assert.throws(() => mergeLocalTraceTree(value),
    error => error.code === 'B_MISSING_PARENT' && error.message.includes('storefront.http'));
});

test('composite browser serialization retains the original ID while joining exact canonical span IDs', () => {
  const value = fixture({ composite: true }), result = mergeLocalTraceTree(value);
  assert.equal(result.rows[0].nativeId, `|${traceId}.${id(1)}.`);
  assert.equal(result.rows[0].spanId, id(1));
  assert.equal(result.rows[0].nativeParentId, id(100));
});

test('actual SDK-shaped absent browser parent and page-view display ID stay context-only without an invented span', () => {
  const value = fixture({ composite: true });
  delete value.browserEnvelopes[0].tags['ai.operation.parentId'];
  value.browserEnvelopes[0].data.baseData.id = `|${traceId}.${id(1)}`;
  value.browserEvidence.dependencies[0].dependencyId = `|${traceId}.${id(1)}`;
  delete value.browserEvidence.browserContexts[0].contextSpanId;
  const pageView = structuredClone(value.browserEnvelopes[0]);
  pageView.data.baseType = 'PageviewData';
  pageView.data.baseData.id = traceId;
  pageView.data.baseData.name = 'Contoso Orders';
  value.browserEnvelopes.unshift(pageView);
  const result = mergeLocalTraceTree(value);
  assert.equal(result.rows[0].parentSpanId, null);
  assert.equal(result.rows[0].nativeParentId, null);
  assert.equal(result.counts.spans, 6);
  assert.equal(result.counts.contextOnlyPageViews, 1);
  assert.equal(result.browserContextRecords[0].viewId, traceId);
  assert.equal(result.browserContextRecords[0].renderedAsSpan, false);
  assert(!result.rows.some(row => row.spanId === traceId));
});

test('data server-continuation substitution and wrong business identity fail', () => {
  const value = fixture();
  value.jvmEnvelopes[3].data.baseData.properties['contoso.span.kind'] = 'SERVER';
  assert.throws(() => mergeLocalTraceTree(value), error => error.code === 'C_KIND');
  const other = fixture();
  other.jvmEnvelopes[0].data.baseData.properties['business.invocation_id'] = randomUUID();
  assert.throws(() => mergeLocalTraceTree(other), error => error.code === 'A_BUSINESS_ID');
});

test('extra disconnected roots and cycles cannot print an apparently complete single tree', () => {
  for (const cyclic of [false, true]) {
    const value = fixture(), extra = structuredClone(value.jvmEnvelopes[3]);
    extra.data.baseData.id = id(99);
    extra.data.baseData.name = 'unclassified.safe.operation';
    extra.tags['ai.operation.parentId'] = cyclic ? id(99) : '';
    value.jvmEnvelopes.push(extra);
    assert.throws(() => mergeLocalTraceTree(value), error => error.code === 'B_LOCAL_TREE');
  }
});

test('unsafe non-span originals cannot disappear behind span filtering', () => {
  const value = fixture(), unsafe = structuredClone(value.jvmEnvelopes[0]);
  unsafe.data.baseType = 'MetricData';
  unsafe.extra = 'Bearer synthetic-sensitive-fixture-value';
  value.jvmEnvelopes.push(unsafe);
  assert.throws(() => mergeLocalTraceTree(value), error => error.code === 'LOCAL_CAPTURE_PRIVACY');
});

test('saved publisher credentials and live browser labels cannot enroll a local or native observer', () => {
  const value = fixture();
  value.jvmEnvelopes[0].iKey = randomUUID();
  assert.throws(() => mergeLocalTraceTree(value), error => error.code === 'LOCAL_CAPTURE_PRIVACY');
  const live = fixture();
  live.browserEvidence.executionMode = 'live';
  assert.throws(() => mergeLocalTraceTree(live), error => error.code === 'LOCAL_BROWSER_CAPTURE');
});

test('seeded split, duplicate, parent and every missing-hop control fail without modifying original captures', () => {
  const value = fixture(), before = ownedConfigurationHash(value);
  const controls = checkSeededLocalFailures(value);
  assert.equal(controls.length, 9);
  assert.equal(ownedConfigurationHash(value), before);
  assert(controls.every(control => control.result === 'EXPECTED_FAILURE' && control.nativeEvidence === false));
  assert.deepEqual(controls.slice(0, 3).map(control => control.failureCode),
    ['A_SPLIT_TRACE', 'B_DUPLICATE_SPAN', 'B_WRONG_EDGE']);
  assert(controls.slice(3).every(control => control.failureCode === 'C_MISSING_HOP'));
});

test('original envelope ordinals survive non-span filtering and unrelated invocation records', () => {
  const value = fixture(), unrelated = structuredClone(value.jvmEnvelopes[0]);
  unrelated.tags['ai.operation.id'] = otherTrace;
  unrelated.data.baseData.properties['business.invocation_id'] = randomUUID();
  const metric = structuredClone(unrelated);
  metric.data.baseType = 'MetricData';
  value.browserEnvelopes.unshift(metric, unrelated);
  const result = mergeLocalTraceTree(value);
  assert.equal(result.rows[0].recordLocator.rowOrdinal, 2);
  assert.equal(result.counts.ignoredNonSpans, 1);
  assert.equal(result.counts.outsideInvocation, 1);
  assert.equal(checkSeededLocalFailures(value).length, 9);
});

function post(endpoint, envelopes) {
  return new Promise((done, reject) => {
    const bytes = Buffer.from(JSON.stringify(envelopes));
    const outgoing = request(`${endpoint}/v2.1/track`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'content-length': bytes.length },
      timeout: 5000
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => {
        try {
          const text = Buffer.concat(chunks).toString();
          done({ status: response.statusCode, body: text ? JSON.parse(text) : null });
        } catch (error) { reject(error); }
      });
    });
    outgoing.once('error', reject);
    outgoing.once('timeout', () => outgoing.destroy(new Error('LOCAL_TEST_POST_TIMEOUT')));
    outgoing.end(bytes);
  });
}

test('actual loopback HTTP intake scans before projection, merges one tree, closes the receiver and grants local-only provenance', async () => {
  const value = fixture(), publisher = randomUUID();
  const receiver = await openLocalTraceReceiver({ publisherKeys: [publisher], forbiddenValues: [] });
  try {
    const envelopes = [...value.browserEnvelopes, ...value.jvmEnvelopes].map(envelope => ({ ...envelope, iKey: publisher }));
    const response = await post(receiver.endpoint, envelopes);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { itemsReceived: 6, itemsAccepted: 6, errors: [] });
    const capture = await receiver.finish();
    assert.equal(capture.originalPrivacyCapture.actualCounts.envelopes, 6);
    assert.equal(capture.originalPrivacyCapture.payloadReceipts[0].scannedAllOriginalValues, true);
    assert.equal(capture.receiverDiagnostics.transportPhase, 'closed');
    const result = mergeLocalTraceTree({ ...value, browserEnvelopes: [], jvmEnvelopes: [], capture });
    assert.equal(result.sourceAuthority, 'IN_PROCESS_LOOPBACK_LOCAL_ONLY');
    assert(result.rows.every(row => row.sourceKind === 'real-local-agent-loopback'));
    assert.equal(result.nativeEvidence, false);
    const clone = mergeLocalTraceTree({ ...value, browserEnvelopes: [], jvmEnvelopes: [], capture: structuredClone(capture) });
    assert.equal(clone.sourceAuthority, 'SAVED_CAPTURE_STRUCTURAL_CHECK_ONLY');
    assert(clone.rows.every(row => row.sourceKind === 'fixture-check'));
  } finally { await receiver.stop(); }
});

test('mixed caller envelopes cannot inherit an original loopback capture provenance', async () => {
  const value = fixture(), publisher = randomUUID();
  const receiver = await openLocalTraceReceiver({ publisherKeys: [publisher], forbiddenValues: [] });
  try {
    const sent = [...value.browserEnvelopes, ...value.jvmEnvelopes].map(envelope => ({ ...envelope, iKey: publisher }));
    assert.equal((await post(receiver.endpoint, sent)).status, 200);
    const capture = await receiver.finish();
    const extra = structuredClone(value.jvmEnvelopes[3]);
    extra.data.baseData.id = id(99);
    extra.data.baseData.name = 'contoso.pg.transaction';
    const result = mergeLocalTraceTree({ ...value, browserEnvelopes: [], jvmEnvelopes: [extra], capture });
    assert.equal(capture.envelopes.length, 6);
    assert.equal(result.counts.spans, 7);
    assert.equal(result.sourceAuthority, 'SAVED_CAPTURE_STRUCTURAL_CHECK_ONLY');
    assert(result.rows.every(row => row.sourceKind === 'fixture-check'));
    assert.equal(result.nativeEvidence, false);
    const pure = mergeLocalTraceTree({ ...value, browserEnvelopes: [], jvmEnvelopes: [], capture });
    assert.equal(pure.sourceAuthority, 'IN_PROCESS_LOOPBACK_LOCAL_ONLY');
    assert(pure.rows.every(row => row.sourceKind === 'real-local-agent-loopback'));
  } finally { await receiver.stop(); }
});

test('an empty original loopback capture cannot lend provenance to caller-only spans', async () => {
  const value = fixture();
  const receiver = await openLocalTraceReceiver({ publisherKeys: [randomUUID()], forbiddenValues: [] });
  try {
    const capture = await receiver.finish();
    assert.equal(capture.envelopes.length, 0);
    assert.equal(capture.originalPrivacyCapture.verified, false);
    const result = mergeLocalTraceTree({ ...value, capture });
    assert.equal(result.counts.spans, 6);
    assert.equal(result.sourceAuthority, 'SAVED_CAPTURE_STRUCTURAL_CHECK_ONLY');
    assert(result.rows.every(row => row.sourceKind === 'fixture-check'));
    assert.equal(result.certificationEligible, false);
  } finally { await receiver.stop(); }
});

test('a later unsafe loopback original poisons the capture instead of yielding a partial successful tree', async () => {
  const value = fixture(), publisher = randomUUID();
  const receiver = await openLocalTraceReceiver({ publisherKeys: [publisher], forbiddenValues: [] });
  try {
    assert.equal((await post(receiver.endpoint, value.jvmEnvelopes.map(envelope => ({ ...envelope, iKey: publisher })))).status, 200);
    const unsafe = { ...structuredClone(value.jvmEnvelopes[0]), iKey: publisher,
      extra: 'Bearer synthetic-sensitive-fixture-value' };
    assert.equal((await post(receiver.endpoint, [unsafe])).status, 400);
    await assert.rejects(receiver.finish(), /NATIVE_PRIVACY_UNSAFE/);
    assert.equal(receiver.diagnostics().poisoned, true);
  } finally { await receiver.stop(); }
});

test('one CLI command prints the labelled tree and persists only hash-bound local structural results', async () => {
  const value = fixture();
  const directory = join(projectRoot, '.cache', 'r7', 'local-trace-tests', randomUUID());
  await mkdir(directory, { recursive: true });
  try {
    await Promise.all([
      writeFile(join(directory, 'browser.json'), JSON.stringify(value.browserEvidence)),
      writeFile(join(directory, 'browser.ndjson'), value.browserEnvelopes.map(envelope => JSON.stringify(envelope)).join('\n')),
      writeFile(join(directory, 'jvm.ndjson'), value.jvmEnvelopes.map(envelope => JSON.stringify(envelope)).join('\n'))
    ]);
    const { stdout, stderr } = await execute(process.execPath, [
      fileURLToPath(new URL('../../tools/observability/local-trace-tree.mjs', import.meta.url)),
      '--browser', relative(projectRoot, join(directory, 'browser.json')),
      '--browser-telemetry', relative(projectRoot, join(directory, 'browser.ndjson')),
      '--jvm', relative(projectRoot, join(directory, 'jvm.ndjson')),
      '--invocation', value.businessInvocationId, '--profile', LOCAL_REHEARSAL_PROFILE, '--controls', 'seeded',
      '--output-directory', relative(projectRoot, join(directory, 'result'))
    ], { cwd: projectRoot, timeout: 10000 });
    assert.equal(stderr, '');
    assert.match(stdout, /LOCAL REHEARSAL/);
    assert.match(stdout, /A PASS \| B PASS \| C PASS \(LOCAL_REHEARSAL only\)/);
    const receipt = JSON.parse(await readFile(join(directory, 'result', 'local-trace-tree.json'), 'utf8'));
    assert.equal(receipt.inputFiles.length, 4);
    assert(receipt.inputFiles.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
    assert.equal(receipt.nativeQueriesExecuted, 0);
    assert.equal(receipt.seededFailureControls.length, 9);
    assert.equal(receipt.sourceAuthority, 'SAVED_CAPTURE_STRUCTURAL_CHECK_ONLY');
    assert.deepEqual((await readdir(join(directory, 'result'))).sort(), ['local-trace-tree.json', 'local-trace-tree.txt']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
