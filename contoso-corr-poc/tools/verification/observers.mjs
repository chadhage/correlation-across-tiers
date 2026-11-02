import { canonicalSpanId, HASH, TRACE, SPAN, requireUtc } from '../observability/telemetry-contract.mjs';
import { nativeEvidenceHash, relativeFile } from './files.mjs';
import { readBoundFile, sha256 } from './files.mjs';
import { VerificationFailure } from './invariants.mjs';
import * as rawSource from '../observability/raw-query.mjs';

const fail = (code, detail) => { throw new VerificationFailure(code, detail); };
const verifiedReceipts = new WeakMap();

export function immutableReceiptMetadata(value) {
  const copy = JSON.parse(JSON.stringify(value));
  const freeze = item => {
    if (item && typeof item === 'object') {
      Object.values(item).forEach(freeze);
      Object.freeze(item);
    }
    return item;
  };
  return freeze(copy);
}

function receiptCapability(value) {
  const result = immutableReceiptMetadata(value);
  verifiedReceipts.set(result, immutableReceiptMetadata(value));
  return result;
}

export function requireVerifiedQueryReceiptIdentity(result, { phase, querySha256, scope } = {}) {
  const identity = verifiedReceipts.get(result);
  if (!identity || identity.verified !== true || phase && identity.phase !== phase) fail('E_OBSERVER_CAPABILITY', 'Caller JSON/flags/hashes cannot mint a verified observer receipt');
  if (querySha256 && identity.querySha256 !== querySha256 ||
      scope && (identity.scope.workspaceId !== scope.workspaceId || identity.scope.resourceId !== scope.resourceId)) fail('E_OBSERVER_CAPABILITY', 'Verified source capability belongs to a different actual query/scope');
  return immutableReceiptMetadata(identity);
}

export function validateObserverSourceClosure(receipt, observer, currentSources) {
  if (!Array.isArray(receipt.codeFiles) || !receipt.codeFiles.length ||
      !Array.isArray(observer.codeFiles) || receipt.codeFiles.length !== observer.codeFiles.length) fail('E_OBSERVER_SOURCE', 'Exact authoritative observer/collector source closure required');
  const actual = new Map();
  const approved = new Map();
  for (const [list, destination] of [[receipt.codeFiles, actual], [observer.codeFiles, approved]]) {
    for (const source of list) {
      const file = relativeFile(source.path);
      if (!HASH.test(source.sha256 ?? '') || destination.has(file)) fail('E_OBSERVER_SOURCE', 'Duplicate/invalid source closure entry');
      destination.set(file, source.sha256);
    }
  }
  const current = new Map(currentSources.map(source => [relativeFile(source.path), source.sha256]));
  for (const [file, digest] of approved) {
    if (actual.get(file) !== digest || current.get(file) !== digest) fail('E_OBSERVER_SOURCE', 'Authoritative source omitted, changed or not actually checked');
  }
  return { scope: 'STRUCTURAL ONLY', sourceAcceptanceIsCertification: false };
}

export function validateNativeResponseBindings(identities, { scope, queries, nowUtc = new Date().toISOString() }) {
  if (!Array.isArray(identities) || !identities.length || !Array.isArray(queries) || queries.length !== identities.length) fail('E_NATIVE_BINDING', 'Every actual executed query needs its own native response');
  const expected = new Map();
  for (const query of queries) {
    if (!HASH.test(query.querySha256 ?? '')) fail('E_NATIVE_BINDING', 'Actual query text SHA required');
    expected.set(query.querySha256, (expected.get(query.querySha256) ?? 0) + 1);
  }
  for (const identity of identities) {
    let observed;
    try { observed = Date.parse(requireUtc(identity.observedAtUtc, 'actual native response time')); }
    catch { fail('E_NATIVE_BINDING', 'Actual native response timestamp missing'); }
    const now = Date.parse(requireUtc(nowUtc, 'response verification time'));
    if (observed > now || now - observed > 240000) fail('E_NATIVE_BINDING', 'Actual native response is outside the bounded verification window');
    if (identity.workspaceId !== scope.workspaceId || identity.resourceId !== scope.resourceId ||
        identity.sourceKind !== 'azure-monitor-logs' || identity.transport !== 'pinned-azure-cli-native-stdout' ||
        !HASH.test(identity.responseSha256 ?? '') || !(expected.get(identity.querySha256) > 0)) fail('E_NATIVE_BINDING', 'Actual private native response query/scope/content differs from the executed manifest');
    expected.set(identity.querySha256, expected.get(identity.querySha256) - 1);
  }
  if ([...expected.values()].some(count => count !== 0)) fail('E_NATIVE_BINDING', 'Unmatched/missing native query response');
  return { scope: 'STRUCTURAL ONLY', sourceAcceptanceIsCertification: false };
}

export function verifyCapturedQueryCapabilities(capabilities, { scope, queries }) {
  if (!Array.isArray(capabilities) || !capabilities.length || !Array.isArray(queries) ||
      capabilities.length !== queries.length || new Set(capabilities).size !== capabilities.length) {
    fail('E_OBSERVER_CAPABILITY', 'Each actual captured query requires its original unique post-verification capability');
  }
  const remaining = new Map();
  for (const query of queries) remaining.set(query.querySha256, (remaining.get(query.querySha256) ?? 0) + 1);
  const identities = capabilities.map(capability => {
    const identity = requireVerifiedQueryReceiptIdentity(capability, { phase: 'post-query', scope });
    if (!identity.nativeResponseVerified || !identity.sourceOriginVerified || !(remaining.get(identity.querySha256) > 0)) {
      fail('E_OBSERVER_CAPABILITY', 'Original post-verification capability differs from the actual captured query manifest');
    }
    remaining.set(identity.querySha256, remaining.get(identity.querySha256) - 1);
    return identity;
  });
  if ([...remaining.values()].some(count => count !== 0)) fail('E_OBSERVER_CAPABILITY', 'Missing original post-verification query capability');
  return {
    authenticatedPeerVerified: identities.every(identity => identity.authenticatedPeerVerified === true),
    originalCapabilities: capabilities, scope, sourceAcceptanceIsCertification: false
  };
}

export async function verifyQueryExecutorReceipt(receipt, { mode, scope, phase = 'post-query', nativeResponses, querySha256, queries } = {}) {
  if (mode === 'LocalValidate' && receipt?.sourceKind !== 'azure-monitor-logs') {
    return { result: 'LOCAL ONLY', verified: false, certificationEligible: false, sourceAcceptanceIsCertification: false };
  }
  const registry = JSON.parse((await readBoundFile('contracts\\verification-observer-registry.v1.json')).toString('utf8'));
  if (registry?.schema !== 'contoso.verification-observer-registry.v1' ||
      registry.sourceAcceptanceIsCertification !== false || !Array.isArray(registry.observers)) fail('E_OBSERVER_REGISTRY', 'Independent observer registry required');
  const observer = registry.observers.find(item => item.id === receipt?.observerId);
  if (!observer) fail('E_UNTRUSTED_OBSERVER', 'No independently approved actual Azure observer; source/executable hashes alone cannot certify provenance');
  if (receipt.schema !== 'contoso.query-executor-code-receipt.v1' || receipt.sourceKind !== 'azure-monitor-logs' ||
      receipt.transport !== 'azure-cli-rest-logs-query' || receipt.workspaceId !== scope.workspaceId ||
      receipt.resourceId !== scope.resourceId || observer.workspaceId !== scope.workspaceId ||
      observer.resourceId !== scope.resourceId || !HASH.test(observer.authorizationReceiptSha256 ?? '') ||
      observer.authorizationObserved !== true || observer.nativeSourceObserved !== true ||
      receipt.azureCliExecutableSha256 !== observer.azureCliExecutableSha256) fail('E_OBSERVER_SCOPE', 'Actual approved tool/authentication/read scope does not match');
  const currentSources = await Promise.all((observer.codeFiles ?? []).map(async source => ({
    path: source.path, sha256: sha256(await readBoundFile(source.path))
  })));
  validateObserverSourceClosure(receipt, observer, currentSources);
  if (phase === 'pre-query' && !HASH.test(querySha256 ?? '')) fail('E_NATIVE_BINDING', 'Pre-query capability must bind the actual request SHA');
  if (phase === 'pre-query') return receiptCapability({ result: 'PASS', verified: true, phase, provenanceVerified: false,
    nativeResponseVerified: false, certificationEligible: false, sourceAcceptanceIsCertification: false,
    observerId: observer.id, scope, querySha256, issuedAtUtc: new Date().toISOString() });
  if (!Array.isArray(nativeResponses) || !nativeResponses.length || typeof rawSource.requireNativeQueryResponseIdentity !== 'function') fail('E_NATIVE_TRANSPORT', 'Actual registered native query responses required; a caller transport receipt is not authority');
  if (new Set(nativeResponses).size !== nativeResponses.length) fail('E_NATIVE_BINDING', 'One response object cannot satisfy multiple executed requests');
  const identities = nativeResponses.map(response => rawSource.requireNativeQueryResponseIdentity(response));
  validateNativeResponseBindings(identities, { scope, queries: queries ?? [{ querySha256 }] });
  const authenticated = identities.every(identity => identity.authenticatedPeerVerified === true);
  return receiptCapability({ result: 'PASS', verified: true, phase, certificationEligible: false, sourceAcceptanceIsCertification: false,
    observerId: observer.id, provenanceVerified: authenticated, authenticatedPeerVerified: authenticated,
    sourceOriginVerified: true, nativeResponseVerified: true, nativeHttpStatus: null, nativeRequestId: null,
    querySha256: querySha256 ?? null, queryManifestSha256: queries ? nativeEvidenceHash(queries) : null,
    observedFromUtc: identities.map(identity => identity.observedAtUtc).sort()[0],
    observedToUtc: identities.map(identity => identity.observedAtUtc).sort().at(-1),
    issuedAtUtc: new Date().toISOString(), scope });
}

export function verifyObservedAssignments(assignments, { rawRows, normalizedRows, receipt, proofArtifacts, serializationByRole = {} }) {
  if (!Array.isArray(assignments) || !assignments.length || !Array.isArray(rawRows) ||
      !Array.isArray(normalizedRows) || !Array.isArray(proofArtifacts)) fail('E_ASSIGNMENT_BINDING', 'Native row classification inventory required');
  const identities = new Set();
  for (const assignment of assignments) {
    const locator = assignment.sourceLocator;
    if (!locator || locator.captureId !== receipt.captureId || !Number.isInteger(locator.rowOrdinal) ||
        locator.rowOrdinal < 0 || locator.rowOrdinal >= rawRows.length || !TRACE.test(assignment.traceId ?? '') ||
        !SPAN.test(assignment.spanId ?? '') || assignment.observed !== true) fail('E_ASSIGNMENT_BINDING', 'Observed native source locator/context required');
    const raw = rawRows[locator.rowOrdinal];
    const table = raw.nativeTable ?? raw.SourceTable ?? raw.Type;
    const normalized = normalizedRows.find(row => row.recordKind === 'span' && row.recordLocator?.captureId === locator.captureId &&
      row.recordLocator.rowOrdinal === locator.rowOrdinal && row.nativeTable === table);
    const digest = nativeEvidenceHash(raw);
    if (table !== locator.nativeTable || !normalized || normalized.traceId !== assignment.traceId ||
        normalized.spanId !== assignment.spanId || assignment.evidenceSha256 !== digest ||
        !proofArtifacts.some(item => item.kind === 'native-row' && item.sha256 === digest &&
          nativeEvidenceHash(item.value) === digest && item.sourceKind === receipt.sourceKind)) {
      fail('E_ASSIGNMENT_BINDING', 'Expected/query values cannot replace the actual classified native row');
    }
    const nativeTrace = raw.OperationId ?? raw.operation_Id;
    const role = raw.AppRoleName ?? raw.cloud_RoleName;
    if (nativeTrace !== assignment.traceId ||
        canonicalSpanId(raw.Id ?? raw.id, nativeTrace, serializationByRole[role]) !== assignment.spanId) fail('E_ASSIGNMENT_BINDING', 'Native trace/span serialization does not match the classification');
    const key = `${assignment.traceId}:${assignment.spanId}`;
    if (identities.has(key)) fail('E_ASSIGNMENT_BINDING', 'Duplicate observed boundary assignment');
    identities.add(key);
  }
  return true;
}
