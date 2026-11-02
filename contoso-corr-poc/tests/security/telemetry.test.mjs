import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { scanRawTelemetry, scanGraphIntake, scanPrivacy, lintTelemetryCapture } from '../../tools/security/telemetry.mjs';
import { fakeJwt, rawFixture } from './fixtures.mjs';

test('all raw classified columns are scanned; verdict contains no raw metadata or identity', () => {
  const fixture = rawFixture();
  const result = scanRawTelemetry(fixture);
  assert.equal(result.result, 'PASS');
  assert.equal(result.scannedAllColumns, true);
  assert.equal(result.scannedRawRecords, 1);
  assert.equal(result.tablesScanned.length, 10);
  assert.equal(result.assessmentScope, 'all-telemetry');
  assert.equal(result.sourceAcceptanceIsCertification, false);
  assert.equal(result.globalTelemetrySafetyVerified, false);
  assert.equal(result.gateEligible, false);
  assert.equal(JSON.stringify(result).includes(fixture.tables.find(t => t.name === 'AppRequests').rows[0][5]), false);
});

test('JWT/cookie/body/PII/raw object ID/SQL/Redis negative controls fail without leaking values', () => {
  const seeds = [
    ['unapproved.capture', fakeJwt()],
    ['unapproved.capture', 'Authorization: ' + 'Bearer ' + fakeJwt()],
    ['unapproved.capture', 'Cookie: session=' + 'canary-value-only'],
    ['http.request.body', { value: 'canary-body' }],
    ['unapproved.capture', 'privacy.canary' + '@' + 'example.invalid'],
    ['oid', randomUUID()],
    ['db.statement', ['SELECT canary ', 'FROM canary_table WHERE identity = ', "'never-exported'"].join('')],
    ['db.query.parameters', { value: 'canary-parameter' }],
    ['redis.key', 'canary-key'], ['redis.value', 'canary-value'], ['redis.script', 'canary-script'],
    ['redis.arguments', ['canary-argument']]
  ];
  for (const [key, value] of seeds) {
    const fixture = rawFixture();
    fixture.tables.find(table => table.name === 'AppRequests').rows[0][7][key] = value;
    const result = scanRawTelemetry(fixture);
    assert.equal(result.result, 'FAIL');
    assert.equal(result.scannedAllColumns, false);
    if (typeof value === 'string') assert.equal(JSON.stringify(result).includes(value), false);
  }
});

test('unclassified raw top-level/dynamic fields fail even when normalization would drop them', () => {
  const fixture = rawFixture();
  const requests = fixture.tables.find(table => table.name === 'AppRequests');
  requests.columns.push({ name: 'UnknownRawColumn', type: 'dynamic' });
  requests.rows[0].push({ nested: { forbidden: fakeJwt() } });
  const result = scanRawTelemetry(fixture);
  assert.equal(result.result, 'FAIL');
  assert(result.findings.some(finding => finding.code === 'UNCLASSIFIED_COLUMN'));
  assert(result.findings.some(finding => finding.code === 'JWT_VALUE'));
});

test('missing table inventory/pagination/canary/schema/count fails closed', () => {
  const mutations = [
    fixture => { fixture.receipt.tableInventoryComplete = false; },
    fixture => { fixture.receipt.paginationComplete = false; },
    fixture => { fixture.canaryDisposition = 'UNPROVED'; },
    fixture => { fixture.receipt.tables[0].count = 1; },
    fixture => { fixture.tables.pop(); },
    fixture => { fixture.receipt.rowCount = 2; },
    fixture => { fixture.receipt.warnings.push('bounded-safe-warning'); }
  ];
  for (const mutate of mutations) {
    const fixture = rawFixture();
    mutate(fixture);
    assert.equal(scanRawTelemetry(fixture).result, 'FAIL');
  }
  assert.equal(scanRawTelemetry().result, 'FAIL');
});

test('scoped six-table graph intake can pass without claiming global privacy or changing receipt', () => {
  const fixture = rawFixture();
  const names = ['AppRequests', 'AppDependencies', 'AppPageViews', 'AppTraces', 'AppExceptions', 'AppEvents'];
  fixture.tables = fixture.tables.filter(table => names.includes(table.name));
  fixture.receipt.tables = fixture.receipt.tables.filter(table => names.includes(table.name));
  fixture.receipt.tableInventoryComplete = false;
  fixture.canaryDisposition = 'UNPROVED';
  assert.equal(scanRawTelemetry(fixture).result, 'FAIL');
  const result = scanGraphIntake(fixture);
  assert.equal(result.result, 'PASS');
  assert.equal(result.assessmentScope, 'graph-intake');
  assert.equal(result.fullScopeScanned, false);
  assert.equal(result.globalTelemetrySafetyVerified, false);
  assert.equal(result.sourceAcceptanceIsCertification, false);
  assert.equal(fixture.receipt.tableInventoryComplete, false);
  const rows = fixture.tables.flatMap(table => table.rows.map(values => ({ table: table.name, values })));
  const adapter = scanPrivacy(rows, { ...fixture, scope: 'graph-intake' });
  assert.equal(adapter.result, 'PASS');
});

test('raw client IP and plain authentication identifiers are rejected; approved HMAC is accepted', () => {
  for (const value of ['192.0.2.45', '2001:db8::1']) {
    const fixture = rawFixture();
    fixture.tables.find(table => table.name === 'AppRequests').rows[0][6] = value;
    assert.equal(scanRawTelemetry(fixture).result, 'FAIL');
  }
  const fixture = rawFixture();
  const attributes = fixture.tables.find(table => table.name === 'AppRequests').rows[0][7];
  attributes['user.pseudonym'] = 'h1:' + '1'.repeat(32) + ':' + Buffer.alloc(32, 7).toString('base64url');
  assert.equal(scanRawTelemetry(fixture).result, 'PASS');
  attributes['user.pseudonym'] = '1'.repeat(64);
  assert.equal(scanRawTelemetry(fixture).result, 'FAIL');
});

test('business/user/message identifiers are not approved metric dimensions', () => {
  const fixture = rawFixture();
  const metrics = fixture.tables.find(table => table.name === 'AppMetrics');
  metrics.columns = [{ name: 'Name', type: 'string' }, { name: 'Properties', type: 'dynamic' }];
  metrics.rows = [['contoso.duration', { 'business.invocation_id': randomUUID() }]];
  fixture.receipt.rowCount++;
  fixture.receipt.tables.find(table => table.name === 'AppMetrics').count++;
  const result = scanRawTelemetry(fixture);
  assert.equal(result.result, 'FAIL');
  assert(result.findings.some(finding => finding.code === 'UNAPPROVED_METRIC_DIMENSION'));
});

test('APIM header/body and automatic data collection settings are fail closed', () => {
  const side = { request: { headers: [], body: { bytes: 0 } }, response: { headers: [], body: { bytes: 0 } } };
  const clean = {
    apimDiagnostics: { frontend: structuredClone(side), backend: structuredClone(side) },
    javaAgent: { instrumentation: { jdbc: { enabled: false }, redis: { enabled: false } } }
  };
  assert.equal(lintTelemetryCapture(clean).result, 'PASS');
  const body = structuredClone(clean);
  body.apimDiagnostics.backend.request.body.bytes = 1;
  assert.equal(lintTelemetryCapture(body).result, 'FAIL');
  const auth = structuredClone(clean);
  auth.apimDiagnostics.frontend.request.headers = ['Authorization'];
  assert.equal(lintTelemetryCapture(auth).result, 'FAIL');
  const jdbc = structuredClone(clean);
  jdbc.javaAgent.instrumentation.jdbc.enabled = true;
  assert.equal(lintTelemetryCapture(jdbc).result, 'FAIL');
});

test('source-backed async scalar fields are bounded and prototype keys cannot become classifications', () => {
  const fixture = rawFixture();
  const attributes = fixture.tables.find(table => table.name === 'AppRequests').rows[0][7];
  Object.assign(attributes, {
    'contoso.context.rejection': 'NONE', 'contoso.link.count': 2,
    'messaging.destination.partition.id': '0', 'messaging.eventhubs.message.offset': '9223372036854775807',
    'contoso.original.message.id': randomUUID(), 'contoso.causation.id': randomUUID(), 'error.type': 'RETRY'
  });
  assert.equal(scanRawTelemetry(fixture).result, 'PASS');
  attributes['messaging.destination.partition.id'] = '1000000000';
  assert.equal(scanRawTelemetry(fixture).result, 'FAIL');
  attributes['messaging.destination.partition.id'] = '0';
  attributes['messaging.eventhubs.message.offset'] = '9223372036854775808';
  assert.equal(scanRawTelemetry(fixture).result, 'FAIL');
  attributes['messaging.eventhubs.message.offset'] = '1';
  attributes.toString = { value: fakeJwt() };
  const result = scanRawTelemetry(fixture);
  assert.equal(result.result, 'FAIL');
  assert(result.findings.every(finding => typeof finding.classification === 'string'));
});

test('AppPageViews display ID is opaque metadata and never classified as an actual span', () => {
  const fixture = rawFixture();
  const views = fixture.tables.find(table => table.name === 'AppPageViews');
  views.columns = [{ name: 'Id', type: 'string' }];
  views.rows = [[randomUUID()]];
  fixture.receipt.rowCount++;
  fixture.receipt.tables.find(table => table.name === 'AppPageViews').count++;
  assert.equal(scanRawTelemetry(fixture).result, 'PASS');
});
