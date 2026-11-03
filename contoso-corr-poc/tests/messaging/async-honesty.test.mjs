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

test('fixture-only retry controls require N failures followed by success as N+1 unfiltered deliveries', () => {
  const expected = { ...original, parentSpanId: original.spanId, injectedFailures: 2, expectedAttempts: 3, terminalOutcome: 'SUCCESS' };
  const attempts = [process(1, { outcome: 'RETRY' }), process(2, { outcome: 'RETRY' }), process(3)];
  assertRetry(attempts, expected);
  assertRetry([...attempts].reverse(), expected);
  assertRetry([process(1)], { ...expected, injectedFailures: 0, expectedAttempts: 1 });
  assert.throws(() => assertRetry(attempts, { ...expected, injectedFailures: 1 }), /N failures require N\+1 deliveries/);
  for (const [bad, error] of [
    [[attempts[0], { ...attempts[1], attempt: 1 }, attempts[2]], /noncontiguous attempt count/],
    [[attempts[0], { ...attempts[1], attempt: 3 }, { ...attempts[2], attempt: 4 }], /noncontiguous attempt count/],
    [attempts.slice(0, -1), /unexpected delivery attempts/],
    [[...attempts, process(4, { outcome: 'DUPLICATE' })], /unexpected delivery attempts/],
    [[process(1), attempts[1], attempts[2]], /injected failures did not precede one terminal success/],
    [[attempts[0], attempts[1], process(3, { outcome: 'RETRY' })], { actual: 'RETRY', expected: 'SUCCESS' }]
  ]) assert.throws(() => assertRetry(bad, expected), error);
});

test('retry identity controls keep valid ordinals so each identity assertion must reject its own mutation', () => {
  const expected = { ...original, parentSpanId: original.spanId, injectedFailures: 2, expectedAttempts: 3, terminalOutcome: 'SUCCESS' };
  const attempts = [process(1, { outcome: 'RETRY' }), process(2, { outcome: 'RETRY' }), process(3)];
  for (const [field, invalid] of [
    ['businessInvocationId', messageId], ['messageId', businessInvocationId],
    ['traceId', second.traceId], ['parentSpanId', second.spanId]
  ]) {
    const changed = attempts.map((value, index) => index === 1 ? { ...value, [field]: invalid } : value);
    assert.throws(() => assertRetry(changed, expected),
      { code: 'ERR_ASSERTION', actual: invalid, expected: expected[field] });
  }
  assert.throws(() => assertRetry([attempts[0], { ...attempts[1], spanId: attempts[0].spanId }, attempts[2]], expected),
    /reused PROCESS span/);
  assert.throws(() => assertRetry([{ ...attempts[0], spanId: original.spanId }, attempts[1], attempts[2]], expected),
    /reused producer span/);
});

test('replay must be fresh linked work with preserved business and original identity', () => {
  const replay = {
    ...second, parentSpanId: null, originalMessageId: messageId,
    messageId: 'fa72fe2d-4243-4bce-8858-3cb8050a4e26', links: [original]
  };
  assertReplay(replay, original);
  assert.throws(() => assertReplay({ ...replay, originalMessageId: businessInvocationId }, original),
    { code: 'ERR_ASSERTION', actual: businessInvocationId, expected: messageId });
  assert.throws(() => assertReplay({ ...replay, links: [process(1)] }, original), /missing original replay link/);
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

test('fixture-only four-context fan-in requires every branch PROCESS and result SEND link', () => {
  const contributors = [process(1), original, process(2), second];
  const internal = { ...process(3), kind: 'INTERNAL', parentSpanId: null, links: contributors };
  delete internal.operation;
  delete internal.attempt;
  assertLinkedAggregation(internal, contributors, 4);
  for (let missing = 0; missing < contributors.length; missing++) {
    assert.throws(() => assertLinkedAggregation({
      ...internal, links: contributors.filter((_, index) => index !== missing)
    }, contributors, 4), /missing or invented contributor links/);
  }
  assert.throws(() => assertLinkedAggregation(internal, contributors, 3), /unbounded contributors/);
});

test('synthetic vectors are negative controls, never certification evidence', () => {
  assert.throws(() => assertAsyncEvidence({ evidenceKind: 'fixture', batches: [{ observed: linked, contributors: [original, second] }] }));
  assert.throws(() => assertAsyncEvidence({ evidenceKind: 'live-azure' }));
  const structure = { batches: [{ observed: linked, contributors: [original, second] }], maxLinks: 2 };
  assertAsyncStructure({ ...structure, evidenceKind: 'fixture' });
  assert.throws(() => assertAsyncEvidence({ ...structure, evidenceKind: 'live-azure' }));
  assert.throws(() => assertAsyncStructure({}));
});
