import { normalizeTelemetryRows } from '../observability/telemetry-contract.mjs';
import * as rawSource from '../observability/raw-query.mjs';
import { scanGraphIntake } from '../security/telemetry.mjs';
import { assertAsyncStructure } from '../messaging/async-honesty.mjs';
import { assertEvidenceCoverage, bindObservedProofs } from './evidence.mjs';
import { assertInvariants, VerificationFailure } from './invariants.mjs';
import { assertScenario, observedReplayPairs } from './scenarios.mjs';
import { immutableReceiptMetadata, verifyObservedAssignments, verifyCapturedQueryCapabilities } from './observers.mjs';
import { selectNativeCohort } from './raw-intake.mjs';
import { classifyVerifiedTrustRoots, requireClassifiedTrustRootBindings } from './trust-roots.mjs';
import { requireLocalConditionalCapture } from './conditional-observer.mjs';
import { snapshotQualificationMetadata } from './sampling-qualification.mjs';

const sessions = new WeakMap();
const fail = (code, detail) => { throw new VerificationFailure(code, detail); };
const spanKey = item => `${item.traceId}:${item.spanId}`;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function originalRowsMatch(tables, rawRows) {
  for (const table of tables) {
    const native = rawRows.filter(row => row.nativeTable === table.name);
    const columns = table.columns.map(column => typeof column === 'string' ? column : column.name);
    if (native.length !== table.rows.length) fail('E_RAW_CORRESPONDENCE', 'Raw assertion rows differ from the original scanned table count');
    table.rows.forEach((row, index) => {
      const original = Array.isArray(row) ? Object.fromEntries(columns.map((column, ordinal) => [column, row[ordinal]])) : row;
      if (columns.some(column => JSON.stringify(original[column]) !== JSON.stringify(native[index][column])) ||
          Object.keys(native[index]).some(column => !columns.includes(column) && !['nativeTable', 'ingestedAtUtc'].includes(column))) {
        fail('E_RAW_CORRESPONDENCE', 'Filtering or injecting unscanned native columns cannot mint evidence');
      }
    });
  }
}

function nativeAsync(span, rows) {
  const props = span.nativeProperties;
  return {
    traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId,
    operation: span.semanticKind === 'CONSUMER' ? 'PROCESS' : props['messaging.operation.name'],
    attempt: Number(props['contoso.process.attempt']),
    businessInvocationId: span.businessInvocationId ?? props['business.invocation_id'],
    messageId: props['contoso.message.id'] ?? props['messaging.message.id'],
    originalMessageId: props['contoso.original.message.id'], outcome: props['contoso.outcome'],
    links: rows.filter(row => row.recordKind === 'link' && row.sourceTraceId === span.traceId && row.sourceSpanId === span.spanId)
      .map(row => ({ traceId: row.targetTraceId, spanId: row.targetSpanId }))
  };
}

function asyncStructure(spec, data) {
  const spans = data.rows.filter(row => row.recordKind === 'span');
  const at = boundary => spans.filter(span => data.assignments.some(item => item.boundaryId === boundary && spanKey(item) === spanKey(span)));
  const structure = { maxLinks: data.map.linkLimit, retries: [], replays: [], aggregates: [], batches: [] };
  if (spec.assertion === 'retry') {
    const plan = data.execution.nativeFacts.find(item => item.type === 'retry-plan');
    if (!plan) fail('D_RETRY_DECLARATION', 'Actual source-bound retry plan missing');
    structure.retries.push({
      attempts: at('fulfillment.process').map(span => nativeAsync(span, data.rows))
        .filter(item => item.messageId === plan.expected.messageId),
      expected: { ...plan.expected, injectedFailures: plan.injectedFailures }
    });
  }
  if (spec.assertion === 'replay') {
    for (const { send, original } of observedReplayPairs(spec, data)) {
      structure.replays.push({ observed: nativeAsync(send, data.rows), original: nativeAsync(original, data.rows) });
    }
  }
  if (spec.assertion === 'batch') {
    for (const span of at('aggregator.batch')) {
      const ledger = data.execution.expectation.linkCoverage.find(item => item.sourceTraceId === span.traceId && item.sourceSpanId === span.spanId);
      if (!ledger) fail('D_BATCH', 'Actual complete contributor ledger missing');
      structure.batches.push({ observed: nativeAsync(span, data.rows), contributors: ledger.contributors });
    }
  }
  if (spec.assertion === 'fanin') {
    for (const span of at('aggregator.fanin')) {
      const ledger = data.execution.expectation.linkCoverage.find(item => item.sourceTraceId === span.traceId && item.sourceSpanId === span.spanId);
      if (!ledger) fail('D_FANIN', 'Actual complete aggregation contributor ledger missing');
      structure.aggregates.push({ observed: nativeAsync(span, data.rows), persistedContributors: ledger.contributors });
    }
  }
  if (['retry', 'replay', 'fanin', 'batch'].includes(spec.assertion)) assertAsyncStructure(structure);
  return structure;
}

export async function verifyGraphIntake({ map, spec, capture, execution, mode, localObserverCapability }) {
  if (localObserverCapability) {
    const local = requireLocalConditionalCapture(localObserverCapability);
    const localMap = snapshotQualificationMetadata(map);
    const localSpec = snapshotQualificationMetadata(spec);
    if (mode !== 'LocalValidate' || localSpec.assertion !== 'conditional-native' ||
        JSON.stringify(localMap) !== JSON.stringify(local.map)) {
      fail('E_ORIGIN', 'Local conditional observer cannot satisfy a different map/demo/Azure/full-graph scope');
    }
    const trustRootClassification = classifyVerifiedTrustRoots({
      map: local.map, rows: local.rows, requests: local.requests, proofArtifacts: local.proofArtifacts,
      mode, localObserverCapability
    });
    const capability = Object.freeze(Object.create(null));
    sessions.set(capability, { kind: 'direct-local-conditional-only', trustRootClassification,
      data: immutableReceiptMetadata({
        map: local.map, rows: local.rows, spec: localSpec, execution: local.execution,
        originScope: local.originScope, coverage: { boundedFullPathEvidence: false, fullGraphVerified: false },
        invariants: { result: 'NOT_FULL_GRAPH', sourceAcceptanceIsCertification: false }
      }) });
    return capability;
  }
  if (!['LocalValidate', 'BootstrapValidate', 'Certify'].includes(mode) || !capture?.receipt) fail('E_ORIGIN', 'Missing source-bound native intake');
  const sourceKind = capture.receipt.sourceKind;
  let originScope;
  let observerCapability;
  if (sourceKind === 'fixture-check') {
    if (mode !== 'LocalValidate') fail('E_ORIGIN', 'Caller fixture/origin labels cannot grant native or certification authority');
    originScope = 'CHECKER FIXTURE ONLY';
  } else {
    if (sourceKind !== 'azure-monitor-logs' || typeof rawSource.requireNativeCaptureIdentity !== 'function') fail('E_ORIGIN', 'No actual registered native capture source');
    try { rawSource.requireNativeCaptureIdentity(capture.originalCapture ?? capture); }
    catch { fail('E_ORIGIN', 'No actual registered native capture; clones, fixture objects and labels are not source authority'); }
    const postVerification = verifyCapturedQueryCapabilities(capture.originalCapture?.verifiedQueryCapabilities, {
      scope: capture.receipt.scope, queries: capture.receipt.executedQueries
    });
    if (postVerification.authenticatedPeerVerified !== true) fail('E_NATIVE_AUTH', 'Native stdout origin is not independently verified authenticated peer/transport authority');
    observerCapability = postVerification.originalCapabilities[0];
    originScope = 'APPROVED NATIVE AZURE SLICE — NOT CERTIFIED';
  }
  const original = capture.originalCapture ?? capture;
  if (!Array.isArray(original.rawTables) || !original.rawTables.length || !original.scanReceipt) fail('E_PRIVACY', 'All original table columns/rows and native scan coverage must be available to the trusted R8 scanner');
  const privacy = scanGraphIntake({ tables: original.rawTables, receipt: original.scanReceipt });
  if (privacy.result !== 'PASS' || privacy.scannedAllColumns !== true) {
    const error = new VerificationFailure('E_PRIVACY', 'Trusted original-column classification failed; caller PASS/hash cannot bypass it');
    error.safeFindings = privacy.findings;
    throw error;
  }
  originalRowsMatch(original.rawTables, capture.rawRows);
  const normalizedRows = normalizeTelemetryRows(capture.rawRows, {
    schema: 'workspace', scope: capture.receipt.scope, captureId: capture.receipt.captureId,
    capturedAtUtc: capture.receipt.capturedAtUtc, privacyDisposition: privacy,
    serializationByRole: capture.serializationByRole ?? {}, sourceKind
  });
  verifyObservedAssignments(capture.assignments, {
    rawRows: capture.rawRows, normalizedRows, receipt: capture.receipt,
    proofArtifacts: capture.proofArtifacts, serializationByRole: capture.serializationByRole
  });
  const rows = selectNativeCohort(normalizedRows, {
    traceIds: execution.expectation.traceIds, businessInvocationId: execution.businessInvocationId
  });
  bindObservedProofs([
    ...capture.assignments, ...(execution.expectation.trustRoots ?? []),
    ...(execution.expectation.independentCohorts ?? []), ...(execution.expectation.remoteParents ?? []),
    ...(execution.expectation.linkCoverage ?? []), ...(execution.nativeFacts ?? []),
    ...(execution.expectation.browserContexts ?? []),
    ...(execution.trafficLedger?.spans ?? []), ...(execution.trafficLedger?.canaries ?? [])
  ], capture.proofArtifacts);
  const coverage = assertEvidenceCoverage({
    receipt: capture.receipt, rawPages: capture.rawPages, rawRows: capture.rawRows,
    queryText: capture.queryText, privacy, rows, trafficLedger: execution.trafficLedger,
    requiredBoundaries: spec.requiredBoundaries, mode
  });
  const expectation = { ...execution.expectation, paths: spec.paths, requiredBoundaries: spec.requiredBoundaries };
  const conditionalRequests = (execution.expectation.trustRoots ?? []).filter(root =>
    map.conditionalRoots?.some(rule => rule.boundary === root.boundaryId));
  const trustRootClassification = classifyVerifiedTrustRoots({
    map, rows, requests: conditionalRequests, proofArtifacts: capture.proofArtifacts, mode, observerCapability
  });
  const invariants = assertInvariants({
    map, rows, assignments: capture.assignments, expectation,
    fromUtc: execution.fromUtc, toUtc: execution.toUtc, mode, trustRootClassification
  });
  const capability = Object.freeze(Object.create(null));
  sessions.set(capability, {
    data: immutableReceiptMetadata(clone({ map, spec, rows, assignments: capture.assignments, execution,
      privacy, coverage, invariants, originScope })),
    trustRootClassification
  });
  return capability;
}

export function assertVerifiedScenario(capability) {
  const session = sessions.get(capability);
  if (!session) fail('E_CAPABILITY', 'Only the independently checked R9 intake can invoke the evidence path; caller JSON/flags/hashes are not authority');
  const data = session.data;
  if (session.kind === 'direct-local-conditional-only') {
    return {
      assertion: { result: 'LOCAL_SELECTED_CASES_VERIFIED', sourceAcceptanceIsCertification: false },
      rows: data.rows, originScope: data.originScope, coverage: data.coverage, invariants: data.invariants,
      sourceAcceptanceIsCertification: false, certificationStatus: 'NOT CERTIFIED'
    };
  }
  const assertion = assertScenario(data.spec, data);
  const structure = asyncStructure(data.spec, data);
  return {
    assertion, asyncStructure: structure, coverage: data.coverage, invariants: data.invariants,
    privacy: data.privacy, rows: data.rows, originScope: data.originScope,
    sourceAcceptanceIsCertification: false, certificationStatus: 'NOT CERTIFIED'
  };
}

export function requireVerifiedTrustRootBindings(capability, { map, rows, mode }) {
  const session = sessions.get(capability);
  if (!session) fail('E_CAPABILITY', 'Only the private verified graph session can return source-bound trust-root bindings');
  const bindings = requireClassifiedTrustRootBindings(session.trustRootClassification, { map, rows, mode });
  if (!bindings.checkerOnly && bindings.roots.length && bindings.actualSourceVerified !== true) {
    fail('E_TRUST_ROOT', 'Native root cases remain unverified without enrolled runtime/carrier source authority');
  }
  return immutableReceiptMetadata({ ...bindings, originScope: session.data.originScope });
}
