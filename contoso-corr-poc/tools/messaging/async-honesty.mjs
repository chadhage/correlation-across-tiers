import assert from 'node:assert/strict';

const trace = /^[0-9a-f]{32}$/;
const span = /^[0-9a-f]{16}$/;
const key = context => `${context.traceId}:${context.spanId}`;
const root = value => !value || /^0+$/.test(value);

function context(value) {
  assert.ok(value && trace.test(value.traceId) && !root(value.traceId), 'invalid trace identity');
  assert.ok(span.test(value.spanId) && !root(value.spanId), 'invalid span identity');
}

function processing(value) {
  context(value);
  assert.equal(value.operation, 'PROCESS', 'not an observed PROCESS boundary');
  assert.ok(Number.isInteger(value.attempt) && value.attempt > 0, 'missing attempt count');
}

function boundedLinks(value, maxLinks) {
  assert.ok(Number.isInteger(maxLinks) && maxLinks > 0 && maxLinks <= 32, 'invalid link bound');
  const links = value.links ?? [];
  assert.ok(Array.isArray(links) && links.length <= maxLinks, 'unbounded native links');
  links.forEach(context);
  assert.equal(new Set(links.map(key)).size, links.length, 'duplicate native links');
  assert.ok(links.every(link => key(link) !== key(value)), 'self-linked PROCESS span');
  return links;
}

export function assertRetry(attempts, expected) {
  assert.equal(attempts.length, expected.expectedAttempts, 'unexpected delivery attempts');
  const ordered = [...attempts].sort((left, right) => left.attempt - right.attempt);
  if (expected.injectedFailures !== undefined && expected.terminalOutcome === 'SUCCESS') {
    assert.equal(expected.expectedAttempts, expected.injectedFailures + 1, 'N failures require N+1 deliveries');
  }
  const identities = new Set();
  for (const [index, value] of ordered.entries()) {
    processing(value);
    assert.equal(value.attempt, index + 1, 'noncontiguous attempt count');
    assert.equal(value.businessInvocationId, expected.businessInvocationId);
    assert.equal(value.messageId, expected.messageId);
    assert.equal(value.traceId, expected.traceId);
    assert.equal(value.parentSpanId, expected.parentSpanId);
    assert.ok(!identities.has(value.spanId), 'reused PROCESS span');
    assert.notEqual(value.spanId, expected.parentSpanId, 'reused producer span');
    identities.add(value.spanId);
  }
  if (expected.terminalOutcome) assert.equal(ordered.at(-1)?.outcome, expected.terminalOutcome);
  if (expected.injectedFailures !== undefined && expected.terminalOutcome === 'SUCCESS') {
    assert.ok(ordered.slice(0, -1).every(value => ['RETRY', 'TRANSIENT_FAILURE'].includes(value.outcome)),
      'injected failures did not precede one terminal success');
  }
  return true;
}

export function assertReplay(value, original, maxLinks = 32) {
  context(value);
  context(original);
  assert.ok(root(value.parentSpanId), 'replay continued an old parent');
  assert.notEqual(value.traceId, original.traceId, 'replay did not start linked work');
  assert.equal(value.businessInvocationId, original.businessInvocationId);
  assert.equal(value.originalMessageId, original.messageId);
  assert.notEqual(value.messageId, original.messageId, 'replay reused broker identity');
  assert.ok(boundedLinks(value, maxLinks).some(link => key(link) === key(original)), 'missing original replay link');
  return true;
}

export function assertLinkedProcessing(value, contributors, maxLinks = 32) {
  processing(value);
  return assertLinkedAggregation(value, contributors, maxLinks);
}

export function assertLinkedAggregation(value, contributors, maxLinks = 32) {
  context(value);
  assert.ok(root(value.parentSpanId), 'arbitrary contributor selected as parent');
  assert.ok(contributors.length > 0 && contributors.length <= maxLinks, 'unbounded contributors');
  contributors.forEach(context);
  assert.ok(contributors.every(contributor => key(contributor) !== key(value)), 'reused contributor PROCESS span');
  const expected = new Set(contributors.map(key));
  const actual = boundedLinks(value, maxLinks);
  assert.deepEqual(new Set(actual.map(key)), expected, 'missing or invented contributor links');
  return true;
}

export function assertBatch(value, contributors, maxLinks = 32) {
  assert.ok(new Set(contributors.map(item => item.traceId)).size > 1, 'not a mixed-context batch');
  return assertLinkedProcessing(value, contributors, maxLinks);
}

// Structural checks do not establish origin. R9 must validate actual source-bound
// carrier/state/native evidence before using this helper in an acceptance wrapper.
export function assertAsyncStructure(value) {
  assert.ok(value && typeof value === 'object', 'missing structural input');
  for (const retry of value.retries ?? []) assertRetry(retry.attempts, retry.expected);
  for (const replay of value.replays ?? []) assertReplay(replay.observed, replay.original, value.maxLinks);
  for (const aggregate of value.aggregates ?? []) {
    assertLinkedAggregation(aggregate.observed, aggregate.persistedContributors, value.maxLinks);
  }
  for (const batch of value.batches ?? []) assertBatch(batch.observed, batch.contributors, value.maxLinks);
  assert.ok((value.retries?.length ?? 0) + (value.replays?.length ?? 0) +
    (value.aggregates?.length ?? 0) + (value.batches?.length ?? 0) > 0, 'empty evidence');
  return true;
}

export function assertAsyncEvidence() {
  throw new Error('standalone evidence-origin acceptance is disabled; use the trusted R9 verifier, then assertAsyncStructure');
}
