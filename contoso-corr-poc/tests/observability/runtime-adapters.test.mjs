import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ownerControlRequest, samplingAckFromRuntimeObservation, drainAckFromRuntimeObservation } from '../../tools/observability/runtime-adapters.mjs';
import { ownedConfigurationHash } from '../../tools/observability/telemetry-contract.mjs';
import { validateRuntimeLease } from '../../tools/observability/runtime-lease.mjs';

const runId = randomUUID();
const owned = { CONTOSO_CERT_START: '2026-11-01T04:00:00Z', CONTOSO_CERT_END: '2026-11-01T04:04:00Z', CONTOSO_CERT_WINDOW_ID: runId };
const request = {
  schema: 'contoso.sampling-adapter-request.v1', layerId: 'contoso-portal-ssr', role: 'contoso-portal-ssr', layer: 'ssr',
  operation: 'observe', revision: `cert-${runId}`, issuedAtUtc: '2026-11-01T04:00:00Z',
  authorizationFromCertificationFlag: false, secretsIncluded: false, ownedPatch: owned,
  lease: { schema: 'contoso.sampling-runtime-lease.v1', runId, layerId: 'contoso-portal-ssr', revision: `cert-${runId}`,
    startsAtUtc: '2026-11-01T04:00:00Z', drainAtUtc: '2026-11-01T04:02:00Z', expiresAtUtc: '2026-11-01T04:04:00Z',
    restoreDeadlineUtc: '2026-11-01T04:06:00Z', ownedConfiguration: owned, ownedConfigSha256: ownedConfigurationHash(owned),
    baselineOwnedConfigSha256: 'a'.repeat(64), hashAlgorithm: 'contoso.canonical-json.sha256.v1', guard: null }
};
const state = {
  schema: 'contoso.sampling-runtime-observation.v1', sourceKind: 'contoso-node-sdk-runtime',
  serviceName: request.role,
  runtimeInstanceId: 'fixture-observer-no-live-authority', actualRevision: request.revision, activeLeaseId: runId,
  observedAtUtc: '2026-11-01T04:01:00Z', nativeStateAvailable: true, ready: true,
  ownedConfiguration: owned, effectiveSamplingPercentage: 100, requestsPerSecond: null,
  providerCount: null, exporterCount: null, ownershipPending: true, certificationEligible: false
};

test('owner control projection never sends hashes/configuration or authentication values to web state API', () => {
  assert.deepEqual(ownerControlRequest(request, { node: true }), { schemaVersion: 1, runId, revision: request.revision });
  assert.deepEqual(ownerControlRequest({ ...request, revision: 'production' }), { runId, revision: request.revision });
});

test('stale/requested-only/file observations cannot become native runtime acknowledgements', () => {
  assert.throws(() => samplingAckFromRuntimeObservation(request, state), /outside its bounded/);
  assert.throws(() => samplingAckFromRuntimeObservation(request, { ...state, actualRevision: 'production', requestedRevision: request.revision }),
    /Requested revision/);
  assert.throws(() => samplingAckFromRuntimeObservation(request, { ...state, sourceKind: 'local-config' }), /File\/management/);
  assert.throws(() => samplingAckFromRuntimeObservation(request, { ...state, observedAtUtc: '2026-11-01T03:59:00Z' }), /predates/);
});

test('unknown admission and nonzero in-flight work never manufacture drain completion', () => {
  assert.throws(() => drainAckFromRuntimeObservation(request, { ...state, inFlightRemaining: 0 }), /has not completed/);
  assert.throws(() => drainAckFromRuntimeObservation(request, { ...state, admitting: false, inFlightRemaining: 1 }), /has not completed/);
  const ack = drainAckFromRuntimeObservation(request, { ...state, admitting: false, inFlightRemaining: 0 });
  assert.equal(ack.inFlightRemaining, 0);
  assert.equal(ack.runtimeInstanceId, state.runtimeInstanceId);
});

test('finite actual-control envelope preserves unknown ownership instead of inventing global counts', () => {
  const start = new Date(Date.now() - 1000).toISOString();
  const expiry = new Date(Date.now() + 240000).toISOString();
  const currentOwned = { ...owned, CONTOSO_CERT_START: start, CONTOSO_CERT_END: expiry };
  const currentRequest = { ...request, issuedAtUtc: start, ownedPatch: currentOwned,
    lease: { ...request.lease, startsAtUtc: start, expiresAtUtc: expiry,
      drainAtUtc: new Date(Date.now() + 120000).toISOString(),
      restoreDeadlineUtc: new Date(Date.now() + 300000).toISOString(),
      ownedConfiguration: currentOwned, ownedConfigSha256: ownedConfigurationHash(currentOwned) } };
  const ack = samplingAckFromRuntimeObservation(currentRequest, {
    ...state, ownedConfiguration: currentOwned, observedAtUtc: new Date().toISOString()
  });
  assert.equal(ack.providerCount, null);
  assert.equal(ack.exporterCount, null);
  assert.equal(ack.ownershipPending, true);
  assert.equal(ack.certificationEligible, false);
});

function expiredDrain() {
  const now = Date.now();
  const at = offset => new Date(now + offset).toISOString();
  const currentOwned = { ...owned, CONTOSO_CERT_START: at(-240000), CONTOSO_CERT_END: at(-60000) };
  const currentRequest = { ...request, operation: 'drain', issuedAtUtc: at(-30000), ownedPatch: currentOwned,
    lease: { ...request.lease, startsAtUtc: at(-240000), drainAtUtc: at(-120000), expiresAtUtc: at(-60000),
      restoreDeadlineUtc: at(60000), ownedConfiguration: currentOwned,
      ownedConfigSha256: ownedConfigurationHash(currentOwned) } };
  validateRuntimeLease(currentRequest.lease, { layerId: currentRequest.layerId, active: false });
  return { request: currentRequest, observation: { ...state, observedAtUtc: at(0), activeLeaseId: null,
    actualRevision: 'production-or-inactive', nativeStateAvailable: false, ready: false,
    admitting: false, inFlightRemaining: 0, ownedConfiguration: { CONTOSO_CERT_WINDOW_ID: { $contosoAbsent: true } },
    admission: { state: 'expired', inFlight: 0 } } };
}

test('valid expired and restored runtime drains do not require active sampling or the leased patch', () => {
  const value = expiredDrain();
  for (const activeLeaseId of [null, runId]) {
    const ack = drainAckFromRuntimeObservation(value.request, { ...value.observation, activeLeaseId });
    assert.equal(ack.runtimeInstanceId, state.runtimeInstanceId);
    assert.equal(ack.newSyntheticTrafficStopped, true);
    assert.equal(ack.inFlightRemaining, 0);
  }
  const withoutService = { ...value.observation };
  delete withoutService.serviceName;
  assert.equal(drainAckFromRuntimeObservation(value.request, withoutService).inFlightRemaining, 0);
});

test('expired leases cannot promote file, management, missing or wrong-layer sources into drain evidence', () => {
  const value = expiredDrain();
  for (const sourceKind of ['local-config', 'azure-resource-manager-read', 'file-fixture',
    'trusted-runtime-observation', 'contoso-js-sdk-runtime', 'jdk-jmx-in-memory', undefined]) {
    assert.throws(() => drainAckFromRuntimeObservation(value.request, { ...value.observation, sourceKind }),
      /File\/management|Unknown runtime/);
  }
});

test('drain observations reject foreign roles, invalid instances and contradictory ownership claims', () => {
  const value = expiredDrain();
  for (const patch of [
    { serviceName: 'contoso-foreign-service' }, { roleName: 'contoso-foreign-service' },
    { serviceName: null }, { roleName: '' }, { runtimeInstanceId: 123 }, { runtimeInstanceId: ' ' },
    { certificationEligible: true }, { certificationEligible: 'false' },
    { ownershipPending: false }, { ownershipPending: 'true' }, { privacyChanged: true },
    { secretsIncluded: true }, { providerConstruction: true }, { extraExporter: true }
  ]) {
    assert.throws(() => drainAckFromRuntimeObservation(value.request, { ...value.observation, ...patch }),
      /runtime observation|runtime role/);
  }
});

test('expired source-bound JVM drain preserves supported JMX shape without global ownership flags', () => {
  const value = expiredDrain();
  const jvmRequest = { ...value.request, layer: 'jvm', role: 'contoso-orders-api', layerId: 'contoso-orders-api',
    lease: { ...value.request.lease, layerId: 'contoso-orders-api' } };
  const observation = { ...value.observation, sourceKind: undefined, serviceName: jvmRequest.role,
    startupMechanism: 'controlled-process-restart', nativeObservationAvailable: true,
    admitting: undefined, inFlightRemaining: undefined, admission: { state: 'expired', inFlight: 0 } };
  delete observation.ownershipPending;
  delete observation.certificationEligible;
  assert.equal(drainAckFromRuntimeObservation(jvmRequest, observation).inFlightRemaining, 0);
  assert.equal(drainAckFromRuntimeObservation(jvmRequest, {
    ...observation, sourceKind: 'jdk-jmx-in-memory', nativeObservationAvailable: false
  }).inFlightRemaining, 0);
  assert.throws(() => drainAckFromRuntimeObservation(jvmRequest, {
    ...observation, nativeObservationAvailable: false
  }), /Unknown runtime/);
});

test('drain freshness, lease ownership and immutable lease validation remain fail closed after expiry', () => {
  const value = expiredDrain();
  assert.throws(() => drainAckFromRuntimeObservation(value.request, {
    ...value.observation, activeLeaseId: randomUUID()
  }), /Foreign runtime lease/);
  assert.throws(() => drainAckFromRuntimeObservation(value.request, {
    ...value.observation, observedAtUtc: value.request.lease.startsAtUtc
  }), /predates/);
  assert.throws(() => drainAckFromRuntimeObservation({ ...value.request, issuedAtUtc: 'invalid' },
    value.observation), /issuedAtUtc/);
  assert.throws(() => drainAckFromRuntimeObservation({ ...value.request, lease: {
    ...value.request.lease, ownedConfigSha256: 'b'.repeat(64)
  } }, value.observation), /Invalid\/unbound/);
});

test('published browser layer accepts real SDK activation and source-bound expired drain', () => {
  const now = Date.now();
  const at = offset => new Date(now + offset).toISOString();
  const browserOwned = { 'telemetry.samplingPercentage': 100, 'telemetry.tracingMode': 'W3C_TRACE',
    'certification.enabled': true, 'certification.startsAtUtc': at(-1000),
    'certification.endsAtUtc': at(240000), 'certification.windowId': runId, 'demos.enabled': true };
  const browserRequest = { ...request, layer: 'browser', role: 'contoso-storefront-spa', layerId: 'contoso-storefront-spa',
    issuedAtUtc: at(-1000), ownedPatch: browserOwned,
    lease: { ...request.lease, layerId: 'contoso-storefront-spa', startsAtUtc: at(-1000),
      drainAtUtc: at(120000), expiresAtUtc: at(240000), restoreDeadlineUtc: at(300000),
      ownedConfiguration: browserOwned, ownedConfigSha256: ownedConfigurationHash(browserOwned) } };
  const browserState = { ...state, serviceName: undefined, sourceKind: 'contoso-js-sdk-runtime',
    observedAtUtc: at(0), ownedConfiguration: browserOwned };
  assert.equal(samplingAckFromRuntimeObservation(browserRequest, browserState).percentage, 100);
  const expired = expiredDrain();
  const drainedRequest = { ...expired.request, layer: 'browser', role: browserRequest.role, layerId: browserRequest.layerId,
    lease: { ...expired.request.lease, layerId: browserRequest.layerId } };
  const drainedState = { ...expired.observation, serviceName: undefined, sourceKind: 'contoso-js-sdk-runtime' };
  assert.equal(drainAckFromRuntimeObservation(drainedRequest, drainedState).inFlightRemaining, 0);
  for (const sourceKind of ['local-config', 'contoso-node-sdk-runtime', 'jdk-jmx-in-memory']) {
    assert.throws(() => drainAckFromRuntimeObservation(drainedRequest, { ...drainedState, sourceKind }),
      /File\/management/);
    assert.throws(() => samplingAckFromRuntimeObservation(browserRequest, { ...browserState, sourceKind }),
      /File\/management/);
  }
  assert.throws(() => drainAckFromRuntimeObservation({ ...drainedRequest, layer: 'spa' }, drainedState),
    /File\/management/);
});
