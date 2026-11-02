import { types } from 'node:util';
import { HASH, TRACE, SPAN } from '../observability/telemetry-contract.mjs';
import { nativeEvidenceHash } from './files.mjs';
import { immutableReceiptMetadata, requireVerifiedQueryReceiptIdentity } from './observers.mjs';
import { snapshotQualificationMetadata } from './sampling-qualification.mjs';
import { requireLocalConditionalEvidence } from './conditional-observer.mjs';

const classifications = new WeakMap();
const key = root => `${root.traceId}:${root.spanId}`;
const fail = message => { throw Object.assign(new Error(message), { code: 'E_TRUST_ROOT' }); };
function normalizedSnapshot(value, visiting = new WeakSet()) {
  if (!value || typeof value !== 'object') return value;
  if (types.isProxy(value) || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(value)) ||
      visiting.has(value)) fail('Normalized evidence must be plain data without proxies, accessors or cycles');
  visiting.add(value);
  const result = Array.isArray(value) ? [] : Object.create(null);
  for (const name of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && name === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (typeof name !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('Normalized evidence accessors/hidden fields cannot supply original data');
    }
    // Optional normalized fields remain absent, never backfilled as observed facts.
    if (descriptor.value === undefined && !Array.isArray(value)) continue;
    result[name] = normalizedSnapshot(descriptor.value, visiting);
  }
  visiting.delete(value);
  return result;
}

function rowSnapshot(rows) {
  if (!Array.isArray(rows) || types.isProxy(rows) || rows.length > 20000) fail('Bounded plain original row array required');
  const result = [];
  for (let index = 0; index < rows.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(rows, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('Row accessors/sparse arrays cannot supply original evidence');
    result.push(snapshotQualificationMetadata(normalizedSnapshot(descriptor.value)));
  }
  return immutableReceiptMetadata(result);
}
const rowIdentity = rows => nativeEvidenceHash(rowSnapshot(rows));

export function classifyVerifiedTrustRoots({ map, rows, requests, proofArtifacts, mode, observerCapability, localObserverCapability }) {
  if (!['LocalValidate', 'BootstrapValidate', 'Certify'].includes(mode)) fail('Exact verification mode required');
  let actualSourceVerified = false;
  if (localObserverCapability) {
    requireLocalConditionalEvidence(localObserverCapability, { map, rows, requests, proofArtifacts, mode });
    actualSourceVerified = true;
  } else if (mode !== 'LocalValidate') {
    requireVerifiedQueryReceiptIdentity(observerCapability, { phase: 'post-query' });
    // No runtime/carrier trust-root observer is enrolled during preparation.
    if (requests?.length) fail('No enrolled native runtime/carrier root proof; even a genuine query cannot authenticate caller proof JSON');
  }
  map = snapshotQualificationMetadata(map);
  rows = rowSnapshot(rows);
  requests = rowSnapshot(requests ?? []);
  proofArtifacts = rowSnapshot(proofArtifacts ?? []);
  const accepted = new Set();
  const bindings = [];
  for (const root of requests ?? []) {
    const rule = map.conditionalRoots?.find(item => item.boundary === root.boundaryId);
    if (!rule || !Array.isArray(rule.allowedDispositions) || !rule.policyRef ||
        !rule.allowedDispositions.includes(root.disposition) ||
        ['valid', 'NONE', 'accepted'].includes(root.disposition) ||
        !TRACE.test(root.traceId ?? '') || !SPAN.test(root.spanId ?? '') ||
        !HASH.test(root.evidenceSha256 ?? '') || root.observed !== true) fail('Exact source-defined conditional disposition and actual root receipt required');
    const artifact = proofArtifacts.find(item => item.sha256 === root.evidenceSha256 &&
      item.kind === 'native-runtime' && nativeEvidenceHash(item.value) === item.sha256);
    const receipt = artifact?.value;
    const span = rows.find(item => item.recordKind === 'span' && key(item) === key(root));
    if (!span || span.parentSpanId !== null || receipt?.schema !== 'contoso.native-trust-root.v1' ||
        receipt.boundaryId !== root.boundaryId || receipt.traceId !== root.traceId || receipt.spanId !== root.spanId ||
        receipt.parentSpanId !== null || receipt.disposition !== root.disposition ||
        receipt.policyRef !== rule.policyRef || receipt.technicalContextRestarted !== true ||
        receipt.invalidTracestateOnly !== false || !HASH.test(receipt.carrierEvidenceSha256 ?? '')) {
      fail('Missing/forged native trust-root receipt cannot waive an actual parent edge');
    }
    const wire = proofArtifacts.find(item => item.sha256 === receipt.carrierEvidenceSha256 &&
      item.kind === 'native-wire' && nativeEvidenceHash(item.value) === item.sha256)?.value;
    if (wire?.schema !== 'contoso.native-carrier-disposition.v1' || wire.disposition !== root.disposition ||
        wire.traceId !== root.traceId || wire.spanId !== root.spanId || wire.validTrustedParent === true ||
        ['absent', 'ABSENT'].includes(root.disposition) && wire.traceparentFieldCount !== 0 ||
        root.disposition === 'duplicate' && !(wire.traceparentFieldCount > 1 || wire.combinedParentCount > 1) ||
        ['invalid', 'INVALID_CONTEXT'].includes(root.disposition) && wire.validTraceparent !== false) {
      fail('Actual native carrier disposition must justify the precise conditional root');
    }
    if (accepted.has(key(root))) fail('Duplicate native trust-root classification');
    accepted.add(key(root));
    const locator = span.recordLocator;
    if (!locator || typeof locator.captureId !== 'string' || !locator.captureId ||
        typeof locator.nativeTable !== 'string' || !locator.nativeTable ||
        !Number.isSafeInteger(locator.rowOrdinal) || locator.rowOrdinal < 0) {
      fail('Exact original root span source locator required');
    }
    bindings.push(snapshotQualificationMetadata({
      boundaryId: root.boundaryId, traceId: span.traceId, spanId: span.spanId, parentSpanId: null,
      roleName: span.roleName, disposition: receipt.disposition, policyRef: receipt.policyRef,
      rootEvidenceSha256: root.evidenceSha256, carrierEvidenceSha256: receipt.carrierEvidenceSha256,
      sourceLocator: locator, nativeRowSha256: nativeEvidenceHash(span)
    }));
  }
  const capability = Object.freeze(Object.create(null));
  classifications.set(capability, {
    mode, accepted, mapSha256: nativeEvidenceHash(map), rowsSha256: rowIdentity(rows),
    bindings: immutableReceiptMetadata(bindings), checkerOnly: !actualSourceVerified && mode === 'LocalValidate',
    actualSourceVerified
  });
  return capability;
}

export function isVerifiedTrustRoot(capability, span, rows, mode, map) {
  const state = classifications.get(capability);
  return Boolean(state && state.mode === mode && state.accepted.has(key(span)) &&
    state.rowsSha256 === rowIdentity(rows) && map &&
    state.mapSha256 === nativeEvidenceHash(snapshotQualificationMetadata(map)));
}

export function requireClassifiedTrustRootBindings(capability, { map, rows, mode }) {
  const state = classifications.get(capability);
  if (!state || state.mode !== mode ||
      state.mapSha256 !== nativeEvidenceHash(snapshotQualificationMetadata(map)) ||
      state.rowsSha256 !== rowIdentity(rows)) {
    fail('Private original classification/map/rows/mode required; copies and drift cannot provide root bindings');
  }
  return immutableReceiptMetadata({
    schema: 'contoso.verified-trust-root-bindings.v1', mode,
    mapSha256: state.mapSha256, rowsSha256: state.rowsSha256, checkerOnly: state.checkerOnly,
    actualSourceVerified: state.actualSourceVerified, sourceAcceptanceIsCertification: false,
    nativeRuntimeCarrierObserverEnrolled: state.actualSourceVerified, roots: state.bindings
  });
}
