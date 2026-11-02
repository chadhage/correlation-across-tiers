import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRetry, assertReplay, assertLinkedProcessing, assertLinkedAggregation, assertBatch, assertAsyncEvidence, assertAsyncStructure }
  from '../../tools/messaging/async-honesty.mjs';

const businessInvocationId = 'e66e3001-984a-4973-ae5e-83214b235730';
const messageId = 'e9e8c521-c4d2-41ad-b2ea-c516cd5e6c86';
const original = {
  traceId: '12345678901234567890123456789012', spanId: '1111111111111111',
  businessInvocationId, messageId
};
const second = { ...original, traceId: '22345678901234567890123456789012', spanId: '2222222222222222' };
const process = (attempt, overrides = {}) => ({
  ...original, spanId: `${attempt + 3}`.repeat(16), parentSpanId: original.spanId,
  operation: 'PROCESS', attempt, outcome: 'SUCCESS', ...overrides
});
const linked = { ...process(1), parentSpanId: null, links: [original, second] };

test('retry checks N failures followed by success as N+1 actual deliveries', () => {
  const expected = { ...original, parentSpanId: original.spanId, injectedFailures: 2, expectedAttempts: 3, terminalOutcome: 'SUCCESS' };
  assertRetry([process(1, { outcome: 'RETRY' }), process(2, { outcome: 'RETRY' }), process(3)], expected);
  for (const bad of [
    [process(2), process(2), process(3)],
    [process(2), process(3), process(4, { messageId: businessInvocationId })],
    [process(2), process(3), process(4, { traceId: second.traceId })],
    [process(1), process(2)],
    [process(1, { outcome: 'RETRY' }), process(3, { outcome: 'RETRY' }), process(4)]
  ]) assert.throws(() => assertRetry(bad, expected));
});

test('replay must be fresh linked work with preserved business and original identity', () => {
  const replay = {
    ...second, parentSpanId: null, originalMessageId: messageId,
    messageId: 'fa72fe2d-4243-4bce-8858-3cb8050a4e26', links: [original]
  };
  assertReplay(replay, original);
  for (const overrides of [
    { parentSpanId: original.spanId }, { traceId: original.traceId }, { links: [] },
    { businessInvocationId: replay.messageId }, { messageId },
    { links: Array(33).fill(original) }, { links: [original, original] },
    { links: [original, { ...second, traceId: '0'.repeat(32) }] },
    { links: [original, replay] }
  ]) assert.throws(() => assertReplay({ ...replay, ...overrides }, original));
});

test('fan-in rejects arbitrary parents, missing/invented contributors and unbounded links', () => {
  assertLinkedProcessing(linked, [original, second], 2);
  for (const overrides of [
    { parentSpanId: original.spanId }, { links: [original] },
    { links: [original, second, { ...second, spanId: '3333333333333333' }] },
    { links: Array(33).fill(original) },
    { traceId: original.traceId, spanId: original.spanId }
  ]) assert.throws(() => assertLinkedProcessing({ ...linked, ...overrides }, [original, second], 2));
});

test('mixed-context batch is root-with-bounded-links, never first-message-parent', () => {
  assertBatch(linked, [original, second], 2);
  assert.throws(() => assertBatch({ ...linked, parentSpanId: original.spanId }, [original, second], 2));
  assert.throws(() => assertBatch(linked, [original, { ...second, traceId: original.traceId }], 2));
});

test('INTERNAL aggregation validates native causality without inventing consumer attempts', () => {
  const internal = { ...linked, kind: 'INTERNAL' };
  delete internal.operation;
  delete internal.attempt;
  assertLinkedAggregation(internal, [original, second], 2);
  assert.throws(() => assertLinkedAggregation({ ...internal, spanId: original.spanId, traceId: original.traceId }, [original, second], 2));
});

test('synthetic vectors are negative controls, never certification evidence', () => {
  assert.throws(() => assertAsyncEvidence({ evidenceKind: 'fixture', batches: [{ observed: linked, contributors: [original, second] }] }));
  assert.throws(() => assertAsyncEvidence({ evidenceKind: 'live-azure' }));
  const structure = { batches: [{ observed: linked, contributors: [original, second] }], maxLinks: 2 };
  assertAsyncStructure({ ...structure, evidenceKind: 'fixture' });
  assert.throws(() => assertAsyncEvidence({ ...structure, evidenceKind: 'live-azure' }));
  assert.throws(() => assertAsyncStructure({}));
});
