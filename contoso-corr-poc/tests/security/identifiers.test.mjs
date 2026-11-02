import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { scanIdentifiers, scanAuthorizationIdentifierUse } from '../../tools/security/identifiers.mjs';

function row() {
  return { table: 'AppRequests', OperationId: randomBytes(16).toString('hex'), Id: randomBytes(8).toString('hex'),
    ParentId: '', Properties: { 'business.invocation_id': randomUUID() } };
}

test('real-format distinct business/trace/span IDs pass identifier guard', () => {
  assert.equal(scanIdentifiers([row()]).result, 'PASS');
  assert.equal(scanIdentifiers([]).result, 'FAIL');
});

test('each foreign carrier identifier is forbidden as W3C identity even across rows', () => {
  for (const key of ['business.invocation_id', 'cloudEventId', 'messageId', 'apim.request_id',
    'security.entra.request_id', 'security.entra.correlation_id']) {
    const source = row(), collided = row(), foreign = randomUUID();
    source.Properties[key] = foreign;
    collided.OperationId = foreign.replaceAll('-', '');
    const result = scanIdentifiers([source, collided]);
    assert.equal(result.result, 'FAIL');
    assert(result.findings.some(finding => finding.code === 'TRACE_AUTH_BUSINESS_CONFLATION'));
  }
});

test('nonopaque business IDs/raw Entra namespaces/high-cardinality metrics fail', () => {
  for (const value of ['customer-order-42', 'a'.repeat(32), '00000000-0000-1000-8000-000000000000']) {
    const source = row();
    source.Properties['business.invocation_id'] = value;
    assert.equal(scanIdentifiers([source]).result, 'FAIL');
  }
  const entra = row();
  entra.Properties['entra.request_id'] = randomUUID();
  assert.equal(scanIdentifiers([entra]).result, 'FAIL');
  const metric = row();
  metric.table = 'AppMetrics';
  assert.equal(scanIdentifiers([metric]).result, 'FAIL');
});

test('business IDs cannot enter authorization method or metric dimensions', () => {
  const unsafe = "boolean authorize(Request request) { return request.header('x-business-invocation-id') != null; }";
  assert.equal(scanAuthorizationIdentifierUse(unsafe).result, 'FAIL');
  assert.equal(scanAuthorizationIdentifierUse('void record() { counter.add(1, "business.invocation_id", invocation); }').result, 'FAIL');
  assert.equal(scanAuthorizationIdentifierUse('Caller authenticate(String jwt, String gatewayJwt) { return verify(jwt, gatewayJwt); }').result, 'PASS');
});

test('view IDs remain opaque display identity; nested repeated identifiers are never omitted', () => {
  const view = row();
  view.table = 'AppPageViews';
  view.Id = randomUUID();
  assert.equal(scanIdentifiers([view]).result, 'PASS');
  view.Id = view.Properties['business.invocation_id'];
  assert.equal(scanIdentifiers([view]).result, 'FAIL');
  const repeated = row();
  const foreign = randomUUID();
  repeated.Properties.nested = [{ 'contoso.original.message.id': foreign }, { 'contoso.original.message.id': randomUUID() }];
  repeated.OperationId = foreign.replaceAll('-', '');
  assert.equal(scanIdentifiers([repeated]).result, 'FAIL');
});
