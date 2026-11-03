import { TRACE, SPAN, HASH, requireUtc, validateBoundaryMap } from '../observability/telemetry-contract.mjs';
import { isVerifiedTrustRoot } from './trust-roots.mjs';

export class VerificationFailure extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = 'VerificationFailure';
    this.code = code;
  }
}
const fail = (code, detail) => { throw new VerificationFailure(code, detail); };
const key = (trace, span) => `${trace}:${span}`;
const asSet = values => new Set(values);
const tableKind = table => ['AppRequests', 'requests'].includes(table) ? 'SERVER'
  : ['AppDependencies', 'dependencies'].includes(table) ? 'CLIENT' : null;

function validateExpectation(expectation, map) {
  if (!expectation || !Array.isArray(expectation.traceIds) || !expectation.traceIds.length ||
      expectation.traceIds.some(trace => !TRACE.test(trace)) ||
      asSet(expectation.traceIds).size !== expectation.traceIds.length ||
      !Array.isArray(expectation.paths) || !expectation.paths.length) fail('A_EXPECTATION', 'Observed traffic trace list and selected paths required');
  for (const root of expectation.trustRoots ?? []) {
    if (!TRACE.test(root.traceId ?? '') || !SPAN.test(root.spanId ?? '') ||
        ![...map.deliberateRoots, ...(map.conditionalRoots ?? [])].some(item => item.boundary === root.boundaryId) ||
        !HASH.test(root.evidenceSha256 ?? '') || !root.reason ||
        root.observed !== true) fail('A_TRUST_ROOT', 'Documented and independently observed trust-root receipt required');
  }
  if (expectation.traceIds.length > 1 && !(expectation.trustRoots?.length || expectation.independentCohorts?.length)) {
    fail('A_SPLIT_TRACE', 'Multiple trace IDs need observed separate cohorts or trust-boundary proof');
  }
  for (const cohort of expectation.independentCohorts ?? []) {
    if (!expectation.traceIds.includes(cohort.traceId) || !HASH.test(cohort.evidenceSha256 ?? '') ||
        cohort.observed !== true || !cohort.reason) fail('A_COHORT', 'Independent roots require a native observation, not map expectations');
  }
  const declared = asSet([...(expectation.trustRoots ?? []).map(value => value.traceId),
    ...(expectation.independentCohorts ?? []).map(value => value.traceId)]);
  if (expectation.traceIds.length > 1 && expectation.traceIds.some(trace => !declared.has(trace))) {
    fail('A_SPLIT_TRACE', 'Every independent trace must have observed root authority');
  }
}

function forbidIdentitySubstitution(rows, identifiers) {
  const forbidden = new Set(identifiers.filter(value => typeof value === 'string' && value.length <= 128)
    .flatMap(value => [value.toLowerCase(), value.replaceAll('-', '').toLowerCase()]));
  for (const row of rows) {
    for (const value of [row.traceId, row.spanId, row.parentSpanId, row.associatedSpanId, row.nativeId, row.nativeParentId]) {
      if (typeof value === 'string' && forbidden.has(value.toLowerCase())) fail('C_IDENTIFIER_SUBSTITUTION', 'Non-W3C identifier used as trace/span identity');
    }
  }
}

export function assertInvariants({ map, rows, assignments, expectation, fromUtc, toUtc, mode = 'LocalValidate', trustRootClassification }) {
  validateBoundaryMap(map);
  validateExpectation(expectation, map);
  const from = Date.parse(requireUtc(fromUtc, 'fromUtc'));
  const to = Date.parse(requireUtc(toUtc, 'toUtc'));
  if (!(to > from) || to - from > 7_200_000) fail('E_WINDOW', 'Positive bounded event window required');
  if (!Array.isArray(rows) || !rows.length) fail('A_ABSENCE', 'No native telemetry; absence is not a pass');
  if (!Array.isArray(assignments)) fail('C_ASSIGNMENTS', 'Observed boundary classifications required');
  const allowed = asSet(expectation.traceIds);
  const spans = new Map();
  const spanIds = new Set();
  const records = new Set();
  const links = [];
  let associated = 0;
  for (const row of rows) {
    if (row.schemaVersion !== 'contoso.telemetry-evidence.v1' ||
        !['span', 'link', 'log', 'exception', 'event', 'view'].includes(row.recordKind)) fail('E_NATIVE_SCHEMA', 'Native normalization contract required');
    if (mode !== 'LocalValidate' && row.sourceKind !== 'azure-monitor-logs') fail('E_FIXTURE', 'Certification/bootstrap assertions cannot consume fixture or local rows');
    if (mode === 'LocalValidate' && !['real-local-agent-loopback', 'azure-monitor-logs', 'fixture-check'].includes(row.sourceKind)) fail('E_PROVENANCE', 'Unknown telemetry source');
    if (!TRACE.test(row.traceId ?? '') || !allowed.has(row.traceId)) fail('A_SPLIT_TRACE', 'Unexpected/missing nonzero native OperationId');
    const timestamp = Date.parse(requireUtc(row.timeGeneratedUtc, 'native event time'));
    if (timestamp < from || timestamp >= to) fail('E_WINDOW', 'Row outside the declared event window');
    const locator = row.recordLocator;
    if (!locator?.nativeTable || !locator.captureId || !Number.isInteger(locator.rowOrdinal) || locator.rowOrdinal < 0) fail('E_LOCATOR', 'Native source row locator required');
    const recordKey = `${locator.captureId}:${locator.nativeTable}:${locator.rowOrdinal}:${row.recordKind}:${row.linkIndex ?? ''}`;
    if (records.has(recordKey)) fail('B_DUPLICATE_RECORD', 'Duplicate emitted/source record was not silently deduplicated');
    records.add(recordKey);
    if (row.recordKind === 'span') {
      if (!SPAN.test(row.spanId ?? '') || !['AppRequests', 'AppDependencies', 'requests', 'dependencies'].includes(row.nativeTable)) fail('B_SPAN_ID', 'Actual request/dependency span requires a native nonzero ID');
      if (spanIds.has(row.spanId)) fail('B_DUPLICATE_SPAN', 'Repeated actual span ID, including duplicate exports and cross-trace reuse');
      spanIds.add(row.spanId);
      if (row.parentSpanId !== null && !SPAN.test(row.parentSpanId ?? '')) fail('B_PARENT_ID', 'Invalid/multiple native parent');
      spans.set(key(row.traceId, row.spanId), row);
    } else if (row.recordKind === 'link') links.push(row);
    else if (['log', 'exception', 'event'].includes(row.recordKind)) associated++;
    const invocation = row.businessInvocationId ?? row.nativeProperties?.['business.invocation_id'];
    if (expectation.businessInvocationId && invocation && invocation !== expectation.businessInvocationId) fail('A_BUSINESS_ID', 'Unexpected business identity in the captured cohort');
    if (expectation.requireBusinessOnSpans && row.recordKind === 'span' && invocation !== expectation.businessInvocationId) fail('A_BUSINESS_ID', 'Missing durable identity on an intended actual span');
  }
  if (!spans.size) fail('A_ABSENCE', 'Logs, views or fixture expectations alone are not actual spans');
  if (expectation.traceIds.some(trace => !rows.some(row => row.traceId === trace))) fail('A_MISSING_TRACE', 'Traffic ledger trace missing from native capture');
  forbidIdentitySubstitution(rows, [...(expectation.forbiddenIdentifiers ?? []), expectation.businessInvocationId].filter(Boolean));
  const byBoundary = new Map();
  const classification = new Map();
  for (const binding of assignments) {
    const spanKey = key(binding.traceId, binding.spanId);
    const span = spans.get(spanKey);
    const boundary = map.spans.find(item => item.id === binding.boundaryId);
    if (!span || !boundary || !HASH.test(binding.evidenceSha256 ?? '') || classification.has(spanKey) ||
        binding.observed !== true) fail('C_ASSIGNMENTS', 'Ambiguous/unobserved/non-native boundary classification');
    if (span.roleName !== boundary.roleName) fail('C_ROLE', `Native role does not match ${boundary.id}`);
    const actualKind = span.semanticKind ?? tableKind(span.nativeTable);
    if (actualKind !== boundary.semanticKind) fail('C_KIND', `Native kind does not match ${boundary.id}; expected kind cannot be substituted`);
    if ((boundary.id === 'postgres.logical' || boundary.id === 'redis.logical') &&
        (actualKind !== 'CLIENT' || !['AppDependencies', 'dependencies'].includes(span.nativeTable) || boundary.serverContinuation !== false)) {
      fail('C_DATA_SERVER', 'Data telemetry must be actual client dependency spans, never database server continuation');
    }
    classification.set(spanKey, boundary.id);
    const group = byBoundary.get(boundary.id) ?? [];
    group.push(span);
    byBoundary.set(boundary.id, group);
  }
  const mandatory = expectation.requiredBoundaries ?? (expectation.paths.includes('spa') ? map.coreSynchronousBoundaries : []);
  if (!mandatory.length) fail('C_ABSENCE', 'A nonempty declared scenario coverage set is required');
  for (const boundary of mandatory) {
    if (!map.spans.some(item => item.id === boundary)) fail('C_EXPECTATION', 'Scenario references an unknown boundary');
    const count = byBoundary.get(boundary)?.length ?? 0;
    if (!count) fail('C_MISSING_HOP', `Missing observed boundary ${boundary}`);
    const expectedCount = expectation.boundaryCounts?.[boundary];
    if (expectedCount !== undefined && (!Number.isInteger(expectedCount) || expectedCount < 1 || count !== expectedCount)) {
      fail('C_CARDINALITY', `Observed cardinality differs for ${boundary}`);
    }
  }
  const edges = map.edges.filter(edge => expectation.paths.includes(edge.path) && edge.type === 'parent');
  for (const span of spans.values()) {
    const spanKey = key(span.traceId, span.spanId);
    const boundary = classification.get(spanKey);
    const strict = edges.filter(edge => edge.to === boundary);
    const actualTrustRoot = isVerifiedTrustRoot(trustRootClassification, span, rows, mode, map);
    if (strict.length && !actualTrustRoot) {
      const parent = spans.get(key(span.traceId, span.parentSpanId));
      const parentBoundary = parent && classification.get(key(parent.traceId, parent.spanId));
      if (!parent || !strict.some(edge => edge.from === parentBoundary)) {
        fail('B_WRONG_EDGE', `Broken actual parent edge ${strict.map(edge => edge.from).join('|')} -> ${boundary}`);
      }
    } else if (span.parentSpanId && !spans.has(key(span.traceId, span.parentSpanId))) {
      const browser = (expectation.browserContexts ?? []).find(item => item.traceId === span.traceId &&
        item.contextSpanId === span.parentSpanId && item.identityKind === 'sdk-browser-context-not-span' &&
        item.roleName === span.roleName && item.observed === true && HASH.test(item.evidenceSha256 ?? ''));
      const proof = (expectation.remoteParents ?? []).find(item => item.childTraceId === span.traceId &&
        item.childSpanId === span.spanId && item.targetTraceId === span.traceId && item.targetSpanId === span.parentSpanId);
      if (!browser && (!proof || proof.observed !== true || !HASH.test(proof.evidenceSha256 ?? '') ||
          !map.expectedRemoteBoundaries.some(item => item.id === proof.remoteBoundaryId))) fail('B_MISSING_PARENT', `Unproven remote parent for ${boundary ?? 'unclassified span'}`);
    }
    if ((expectation.trustRoots ?? []).some(root => root.traceId === span.traceId && root.spanId === span.spanId) && span.parentSpanId !== null) fail('A_TRUST_ROOT', 'A declared new root still has an old parent');
    if (mandatory.includes(boundary) && !classification.has(spanKey)) fail('C_ASSIGNMENTS', 'Mandatory span lacks native classification');
  }
  for (const row of rows.filter(item => ['log', 'exception', 'event'].includes(item.recordKind))) {
    if (!SPAN.test(row.associatedSpanId ?? '') || !spans.has(key(row.traceId, row.associatedSpanId))) {
      const contextOnly = !row.associatedSpanId && row.roleName === 'contoso-storefront-spa' &&
        (expectation.browserContexts ?? []).some(item => item.traceId === row.traceId && item.contextSpanId === null &&
          item.identityKind === 'sdk-browser-context-not-span' && item.roleName === row.roleName &&
          item.observed === true && HASH.test(item.evidenceSha256 ?? ''));
      if (!contextOnly) fail('B_ASSOCIATION', 'Log/event/exception lacks an observed active span or separately proven context-only browser disposition');
    }
  }
  const linkGroups = new Map();
  const linkKeys = new Set();
  for (const link of links) {
    const source = key(link.sourceTraceId, link.sourceSpanId);
    const target = key(link.targetTraceId, link.targetSpanId);
    if (!spans.has(source) || !TRACE.test(link.targetTraceId ?? '') || !SPAN.test(link.targetSpanId ?? '') ||
        !Number.isInteger(link.linkIndex) || link.linkIndex < 0) fail('C_LINK', 'Invalid native link source/context');
    if (linkKeys.has(`${source}->${target}`)) fail('C_DUPLICATE_LINK', 'Duplicate contributor link');
    linkKeys.add(`${source}->${target}`);
    const group = linkGroups.get(source) ?? [];
    group.push(target);
    linkGroups.set(source, group);
    if (group.length > map.linkLimit) fail('C_LINK_BOUND', 'Native link count exceeds the configured bound');
    if (!spans.has(target)) fail('C_MISSING_CONTRIBUTOR', 'Native linked contributor missing from bounded capture');
  }
  for (const span of spans.values()) {
    const source = key(span.traceId, span.spanId);
    const boundary = classification.get(source);
    const actual = linkGroups.get(source) ?? [];
    if (actual.length || map.edges.some(edge => edge.type === 'link' && edge.to === boundary &&
        expectation.paths.includes(edge.path))) {
      const coverage = (expectation.linkCoverage ?? []).find(item => item.sourceTraceId === span.traceId && item.sourceSpanId === span.spanId);
      if (!coverage || coverage.observed !== true || !HASH.test(coverage.evidenceSha256 ?? '') ||
          !Array.isArray(coverage.contributors) || !coverage.contributors.length || coverage.contributors.length > map.linkLimit ||
          coverage.dropped !== 0) fail('C_LINK_COVERAGE', 'Observed complete contributor ledger with zero dropped links required');
      const wanted = coverage.contributors.map(item => key(item.traceId, item.spanId));
      if (asSet(wanted).size !== wanted.length || wanted.some(item => !actual.includes(item)) || actual.some(item => !wanted.includes(item))) fail('C_LINK_COVERAGE', 'Native links do not equal every observed contributor');
      if (span.parentSpanId && wanted.includes(key(span.traceId, span.parentSpanId))) fail('C_ARBITRARY_PARENT', 'Replay/fan-in/batch uses an old or arbitrary contributor as parent');
    }
    const declared = span.nativeProperties?.['contoso.link.count'];
    if (declared !== undefined && Number(declared) !== actual.length) fail('C_LINK_TRUNCATION', 'Declared/native link count mismatch');
  }
  return {
    schema: 'contoso.invariant-result.v1', result: 'PASS', sourceAcceptanceIsCertification: false,
    invariants: ['A', 'B', 'C'], spans: spans.size, associatedRecords: associated,
    scope: 'STRUCTURAL CHECK ONLY',
    pageViews: rows.filter(row => row.recordKind === 'view').length, links: links.length,
    traceIds: [...allowed], boundaries: Object.fromEntries([...byBoundary].map(([id, values]) => [id, values.length]))
  };
}
