import assert from 'node:assert/strict';
import test from 'node:test';
import { assertScenario, observedReplayPairs } from '../../tools/verification/scenarios.mjs';

const spec = { assertion: 'replay', replayActors: ['fulfillment', 'notify'] };
const bid = '10000000-0000-4000-8000-000000000001';
function fixture() {
  const original = { recordKind: 'span', traceId: 'a'.repeat(32), spanId: '1'.repeat(16), parentSpanId: null,
    semanticKind: 'PRODUCER', nativeProperties: { 'contoso.message.id': 'original', 'business.invocation_id': bid } };
  const assignments = [{ boundaryId: 'orders.servicebus.send', traceId: original.traceId, spanId: original.spanId }];
  const rows = [original];
  for (const [actor, processDigit, sendDigit] of [['fulfillment', '2', '3'], ['notify', '4', '5']]) {
    for (const [operation, digit] of [['process', processDigit], ['send', sendDigit]]) {
      const row = { recordKind: 'span', traceId: digit.repeat(32), spanId: digit.repeat(16), parentSpanId: null,
        semanticKind: operation === 'process' ? 'CONSUMER' : 'PRODUCER',
        nativeProperties: { 'contoso.message.id': `new-${actor}`, 'contoso.original.message.id': 'original',
          'business.invocation_id': bid, 'messaging.operation.name': operation } };
      rows.push(row, { recordKind: 'link', sourceTraceId: row.traceId, sourceSpanId: row.spanId,
        targetTraceId: original.traceId, targetSpanId: original.spanId });
      assignments.push({ boundaryId: `${actor}.replay.${operation}`, traceId: row.traceId, spanId: row.spanId });
    }
  }
  return { rows, assignments, execution: { nativeFacts: [{ type: 'dead-letter', observed: true,
    evidenceSha256: 'a'.repeat(64), safeReason: 'TRANSIENT_FAILURE_LIMIT', businessInvocationId: bid,
    originalTraceId: original.traceId, originalSpanId: original.spanId }] }, privacy: {} };
}

test('checker-only replay fixture uses actual actor assignments and original-producer links', () => {
  const data = fixture();
  assert.equal(observedReplayPairs(spec, data).length, 2);
  assert.doesNotThrow(() => assertScenario(spec, data));
});

test('missing actor and retired Orders/Aggregator replay aliases fail rather than selecting the first SEND', () => {
  const data = fixture();
  data.assignments = data.assignments.filter(binding => binding.boundaryId !== 'notify.replay.send');
  assert.throws(() => assertScenario(spec, data), /Both actual actor/);
  assert.throws(() => observedReplayPairs({ ...spec, replayActors: ['orders'] }, fixture()), /source-supported/);
});

test('fictional PROCESS-to-SEND links or continued process parents do not replace original producer linkage', () => {
  const data = fixture();
  const process = data.rows.find(row => row.recordKind === 'span' && row.spanId === '2'.repeat(16));
  const sendLink = data.rows.find(row => row.recordKind === 'link' && row.sourceSpanId === '3'.repeat(16));
  sendLink.targetTraceId = process.traceId;
  sendLink.targetSpanId = process.spanId;
  assert.throws(() => assertScenario(spec, data), /original producer/);
  const continued = fixture();
  continued.rows.find(row => row.recordKind === 'span' && row.spanId === '2'.repeat(16)).parentSpanId = '1'.repeat(16);
  assert.throws(() => assertScenario(spec, continued), /Every observed replay PROCESS/);
});

test('ambiguous original IDs and old-parent SEND fail without deduplicating or minting missing context', () => {
  const data = fixture();
  data.rows.push({ ...data.rows[0] });
  assert.throws(() => assertScenario(spec, data), /uniquely observed/);
  const continued = fixture();
  continued.rows.find(row => row.recordKind === 'span' && row.spanId === '3'.repeat(16)).parentSpanId = '1'.repeat(16);
  assert.throws(() => assertScenario(spec, continued), /old parent/);
});
