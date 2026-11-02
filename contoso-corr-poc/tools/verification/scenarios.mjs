import { TRACE, SPAN, HASH, UUID } from '../observability/telemetry-contract.mjs';
import { assertRetry, assertReplay, assertBatch } from '../messaging/async-honesty.mjs';
import { VerificationFailure } from './invariants.mjs';

const fail = (code, detail) => { throw new VerificationFailure(code, detail); };
const spanKey = item => `${item.traceId}:${item.spanId}`;
const carrier = value => {
  const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/.exec(value ?? '');
  if (!match || !TRACE.test(match[1]) || !SPAN.test(match[2])) fail('D_CARRIER', 'A native compliant W3C v00 test-point carrier is required');
  return { traceId: match[1], spanId: match[2], flags: match[3] };
};

function boundFacts(execution, type) {
  const facts = execution.nativeFacts?.filter(item => item.type === type) ?? [];
  if (!facts.length || facts.some(item => item.observed !== true || !HASH.test(item.evidenceSha256 ?? ''))) {
    fail('D_MISSING_ADAPTER', `Missing source-bound native ${type} effect/observation adapter`);
  }
  return facts;
}

function nativeAsync(span, rows) {
  const props = span.nativeProperties;
  return {
    traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId,
    operation: span.semanticKind === 'CONSUMER' ? 'PROCESS' : props['messaging.operation.name'],
    attempt: Number(props['contoso.process.attempt']),
    businessInvocationId: span.businessInvocationId ?? props['business.invocation_id'],
    messageId: props['contoso.message.id'] ?? props['messaging.message.id'],
    originalMessageId: props['contoso.original.message.id'],
    outcome: props['contoso.outcome'],
    links: rows.filter(row => row.recordKind === 'link' && row.sourceTraceId === span.traceId && row.sourceSpanId === span.spanId)
      .map(row => ({ traceId: row.targetTraceId, spanId: row.targetSpanId }))
  };
}

export function observedReplayPairs(spec, { rows, assignments, execution }) {
  const facts = boundFacts(execution, 'dead-letter');
  if (facts.some(fact => !fact.safeReason || !UUID.test(fact.businessInvocationId ?? ''))) {
    fail('D_DLQ', 'Observed safe DLQ identity/reason required');
  }
  const spans = rows.filter(row => row.recordKind === 'span');
  const at = id => spans.filter(span => assignments.some(binding =>
    binding.boundaryId === id && spanKey(binding) === spanKey(span)));
  const linkedTo = (source, target) => rows.some(row => row.recordKind === 'link' &&
    row.sourceTraceId === source.traceId && row.sourceSpanId === source.spanId &&
    row.targetTraceId === target.traceId && row.targetSpanId === target.spanId);
  const actors = spec.replayActors ?? ['fulfillment', 'notify'];
  if (!Array.isArray(actors) || !actors.length || new Set(actors).size !== actors.length ||
      actors.some(actor => !['fulfillment', 'notify'].includes(actor))) {
    fail('D_REPLAY', 'Exact source-supported Fulfillment/Notify replay actors required');
  }
  const pairs = [];
  for (const actor of actors) {
    const actorPairs = [];
    const processes = at(`${actor}.replay.process`);
    const sends = at(`${actor}.replay.send`);
    if (!processes.length || !sends.length) fail('D_REPLAY', 'Both actual actor replay PROCESS and SEND roots required');
    for (const send of sends) {
      const originals = at('orders.servicebus.send').filter(original => linkedTo(send, original) &&
        facts.some(fact => fact.originalTraceId === original.traceId && fact.originalSpanId === original.spanId));
      if (originals.length !== 1 || !processes.some(process => linkedTo(process, originals[0]))) {
        fail('D_REPLAY', 'Replay PROCESS/SEND must link the uniquely observed original producer, not one another');
      }
      actorPairs.push({ send, original: originals[0] });
    }
    if (processes.some(process => process.parentSpanId !== null ||
        !actorPairs.some(pair => linkedTo(process, pair.original)))) {
      fail('D_REPLAY', 'Every observed replay PROCESS must be new root work linked to its actual original');
    }
    pairs.push(...actorPairs);
  }
  return pairs;
}

export function assertScenario(spec, { rows, assignments, execution, privacy }) {
  const spans = rows.filter(row => row.recordKind === 'span');
  const at = id => spans.filter(span => assignments.some(binding => binding.boundaryId === id && spanKey(binding) === spanKey(span)));
  switch (spec.assertion) {
    case 'sync':
      if (!rows.some(row => row.recordKind === 'log')) fail('D_LOGS', 'Native active-span structured log evidence required');
      break;
    case 'ssr': {
      const portal = at('portal.request');
      const views = rows.filter(row => row.recordKind === 'view');
      if (!portal.length || !views.length || !views.some(view => portal.every(span => span.traceId !== view.traceId))) {
        fail('D_SSR_ROOT', 'Actual separate SSR/browser roots and page views required');
      }
      break;
    }
    case 'gateway': {
      const facts = boundFacts(execution, 'gateway-wire');
      for (const id of ['valid-sampled', 'absent', 'invalid-zero-trace', 'valid-unsampled']) {
        const fact = facts.find(item => item.caseId === id);
        if (!fact) fail('D_GATEWAY_CASE', 'Missing one of the four required native Gateway cases');
        const outbound = carrier(fact.outboundTraceparent);
        if (id === 'valid-sampled' || id === 'valid-unsampled') {
          const inbound = carrier(fact.inboundTraceparent);
          if (outbound.traceId !== inbound.traceId || outbound.flags !== inbound.flags) fail('D_FLAG_REWRITE', 'Native wire trace/flags were falsified');
        }
        if (id === 'valid-unsampled' &&
            (fact.nativeSdkSampled !== false || fact.nativeSdkRecording !== false || !HASH.test(fact.sdkStateEvidenceSha256 ?? ''))) {
          fail('D_UNSAMPLED_ORACLE', 'Unsampled export absence/settings alone cannot prove SDK drop or no promotion');
        }
        if (id !== 'valid-unsampled' && !at('gateway.backend').some(span => span.traceId === outbound.traceId && span.spanId === outbound.spanId)) {
          fail('D_GATEWAY_BACKEND', 'Outbound wire parent does not equal an actual Gateway backend dependency');
        }
      }
      const control = boundFacts(execution, 'protocol-negative-control');
      if (!control.some(item => item.guardResult === 'REJECTED' && item.deployable === false)) fail('D_NEGATIVE_CONTROL', 'The isolated protocol guard must actually fire');
      break;
    }
    case 'business': {
      const facts = boundFacts(execution, 'business-edge');
      for (const caseId of ['untrusted', 'malformed', 'trusted-valid']) {
        const fact = facts.find(item => item.caseId === caseId);
        if (!fact || !UUID.test(fact.observedId ?? '') ||
            (caseId === 'trusted-valid' ? fact.observedId !== fact.inputId : fact.observedId === fact.inputId)) fail('D_BUSINESS_EDGE', 'Native trusted/replaced business identity cases incomplete');
      }
      const lookup = boundFacts(execution, 'business-lookup')[0];
      const wanted = new Set(execution.expectation.traceIds);
      if (!Array.isArray(lookup.traceIds) || new Set(lookup.traceIds).size !== wanted.size ||
          lookup.traceIds.some(id => !wanted.has(id))) fail('D_LOOKUP', 'Business query is missing intended traces or contains extras');
      break;
    }
    case 'errors':
      if (!rows.some(row => row.recordKind === 'exception')) fail('D_EXCEPTION', 'Native error-to-active-span exception evidence missing');
      for (const category of ['INVENTORY_TIMEOUT', 'POSTGRES_ERROR']) {
        if (!boundFacts(execution, 'error-injection').some(item => item.category === category && item.effectObserved === true)) fail('D_ERROR_INJECTION', 'Both approved error effects must actually execute');
      }
      break;
    case 'retry': {
      const fact = boundFacts(execution, 'retry-plan')[0];
      const expected = fact.expected;
      if (!Number.isInteger(fact.injectedFailures) || fact.injectedFailures < 0 ||
          expected?.expectedAttempts !== fact.injectedFailures + (fact.successAfterFailures === true ? 1 : 0)) {
        fail('D_RETRY_DECLARATION', 'Declare N+1 after-success attempts versus N failed-only attempts');
      }
      const attempts = at('fulfillment.process').map(span => nativeAsync(span, rows))
        .filter(item => item.messageId === expected.messageId).sort((a, b) => a.attempt - b.attempt);
      assertRetry(attempts, expected);
      break;
    }
    case 'replay': {
      for (const { send, original } of observedReplayPairs(spec, { rows, assignments, execution })) {
        assertReplay(nativeAsync(send, rows), nativeAsync(original, rows));
      }
      break;
    }
    case 'fanin':
      if (!at('fulfillment.process').length || !at('notify.process').length || !at('aggregator.fanin').length) fail('D_FANIN', 'Both native PROCESS contributors and actual aggregation required');
      break;
    case 'batch': {
      for (const batch of at('aggregator.batch')) {
        const ledger = execution.expectation.linkCoverage?.find(item => item.sourceTraceId === batch.traceId && item.sourceSpanId === batch.spanId);
        if (!ledger) fail('D_BATCH', 'Actual persisted mixed-context contributors missing');
        assertBatch(nativeAsync(batch, rows), ledger.contributors);
      }
      break;
    }
    case 'envelopes': {
      const facts = boundFacts(execution, 'message-envelope');
      for (const transport of ['eventgrid', 'storage']) {
        const fact = facts.find(item => item.transport === transport);
        if (!fact || fact.schemaVersion !== 1 || !UUID.test(fact.businessInvocationId ?? '') ||
            !Number.isInteger(fact.bytes) || fact.bytes < 1 || fact.bytes > fact.maximumBytes ||
            fact.eventId === carrier(fact.traceparent).traceId || fact.duplicateHandled !== true ||
            fact.invalidRejected !== true || fact.oversizedRejected !== true) fail('D_ENVELOPE', 'Native transport continuity, limits and duplicate/rejection effects incomplete');
      }
      break;
    }
    case 'spoofing':
      if (!boundFacts(execution, 'message-rejection').some(item => item.category === 'UNTRUSTED_CONTEXT' && item.newRootObserved === true)) fail('D_SPOOFING', 'Spoofed context must be observably refused, not merely absent from a sample');
      break;
    case 'data':
      for (const boundary of ['postgres.logical', 'redis.logical']) {
        if (!at(boundary).some(span => span.semanticKind === 'CLIENT' && span.durationMs > 0 &&
            span.nativeProperties['db.operation.name'])) fail('D_DATA_OPERATION', 'Actual timed logical CLIENT operation missing');
      }
      if (privacy.result !== 'PASS' || !boundFacts(execution, 'data-negative-control').some(item => item.effectObserved === true && item.guardResult === 'REJECTED_OR_NOT_CAPTURED')) fail('D_DATA_PRIVACY', 'Source-bound raw privacy and actual negative effects required');
      break;
    case 'identity':
      if (!spans.some(span => /^h1:[a-f0-9]{32}:[A-Za-z0-9_-]{43}$/.test(span.nativeProperties['user.pseudonym'] ?? '') &&
          /^[A-Z_]{1,32}$/.test(span.nativeProperties['auth.outcome'] ?? ''))) fail('D_IDENTITY', 'Native pseudonym/auth-outcome evidence missing');
      if (!boundFacts(execution, 'identity-negative-control').some(item => item.guardResult === 'REJECTED_OR_REDACTED')) fail('D_IDENTITY_PRIVACY', 'Actual forbidden-header negative effect missing');
      break;
    case 'orphans': {
      const fact = boundFacts(execution, 'orphan-query')[0];
      if (!Array.isArray(fact.candidates) || fact.candidates.some(item => !['expected-remote', 'cross-resource', 'sampled', 'delayed'].includes(item.classification) ||
          !HASH.test(item.evidenceSha256 ?? '') || !item.justification)) fail('D_ORPHAN_DEFECT', 'Every candidate needs justified evidence; unexplained is a defect');
      break;
    }
    case 'sampling': {
      const fact = boundFacts(execution, 'load-report')[0];
      for (const metric of ['latencyMs', 'cpuPercent', 'memoryBytes', 'throughputPerSecond', 'ingestionBytes', 'costUsd', 'exporterBackpressure']) {
        if (!Number.isFinite(fact.metrics?.[metric]) || fact.metrics[metric] < 0) fail('D_LOAD', 'Real native process/backend measurements required; proxy or missing values do not pass');
      }
      if (fact.thresholdsApproved !== true || !HASH.test(fact.thresholdApprovalSha256 ?? '') ||
          fact.withinApprovedThresholds !== true || fact.restoreObserved !== true || fact.rollbackObserved !== true) fail('D_LOAD_APPROVAL', 'Accountable thresholds and actual restore/rollback evidence missing');
      break;
    }
    default: fail('D_MISSING_ADAPTER', 'Unknown scenario assertion');
  }
  return { schema: 'contoso.demo-assertion.v1', result: 'PASS', demoId: spec.id,
    brief: spec.brief, criteria: spec.criteria, scope: 'STRUCTURAL CHECK ONLY', sourceAcceptanceIsCertification: false };
}
