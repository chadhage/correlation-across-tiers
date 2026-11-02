import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('../../contracts/message-envelope.v1.json', import.meta.url), 'utf8'));
test('published v1 envelope is bounded, exact-named and version-invalidating', () => {
  assert.equal(schema.properties.schemaVersion.const, 1);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema['x-contoso-max-utf8-bytes'], 32768);
  assert.equal(schema.properties.traceparent.maxLength, 512);
  assert.equal(schema.properties.tracestate.maxLength, 512);
  for (const key of ['business.invocation_id', 'messageId', 'causationId', 'workflowId', 'replayOf']) {
    assert.ok(schema.required.includes(key));
  }
  assert.ok(!JSON.stringify(schema).includes('business.correlation_id'));
  assert.ok(!Object.keys(schema.properties).some(key => /producer|password|secret|token/i.test(key)));
});

test('synthetic payload and UUIDs have explicit immutable bounds', () => {
  const payload = schema.properties.payload;
  assert.equal(payload.additionalProperties, false);
  assert.equal(payload.properties.quantity.maximum, 100);
  const id = new RegExp(schema.$defs.id.pattern);
  assert.ok(id.test('77bcd992-62da-46f4-b3bd-46201b03b6df'));
  assert.ok(!id.test('00000000-0000-0000-0000-000000000000'));
  assert.ok(!id.test('12345678901234567890123456789012'));
  assert.equal(payload.properties.contributor.enum.length, 3);
  assert.deepEqual(schema.properties.kind.enum, ['ORDER', 'RESULT', 'BATCH']);
});
