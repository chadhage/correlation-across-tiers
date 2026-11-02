import { HASH, UUID, ownedConfigurationHash, requireUtc, validateSamplingControlAck } from './telemetry-contract.mjs';
import { validateRuntimeLease } from './runtime-lease.mjs';
import { validateDrainAck } from './sampling-controller.mjs';

function runIdOf(request) {
  const runId = request.lease?.runId ?? request.ownedPatch?.runId;
  if (request.schema !== 'contoso.sampling-adapter-request.v1' || !UUID.test(runId ?? '') ||
      request.authorizationFromCertificationFlag !== false || request.secretsIncluded !== false) {
    throw new TypeError('A bounded controller request, not caller authentication metadata, is required');
  }
  return runId;
}

export function ownerControlRequest(request, { node = false } = {}) {
  const runId = runIdOf(request);
  return { ...(node ? { schemaVersion: 1 } : {}), runId, revision: `cert-${runId}` };
}

function runtimeObservationIdentity(observation, request) {
  const runId = runIdOf(request);
  if (observation?.schema !== 'contoso.sampling-runtime-observation.v1' ||
      typeof observation.runtimeInstanceId !== 'string' || !observation.runtimeInstanceId.trim() ||
      observation.certificationEligible !== undefined && observation.certificationEligible !== false ||
      observation.ownershipPending !== undefined && observation.ownershipPending !== true ||
      ['privacyChanged', 'secretsIncluded', 'providerConstruction', 'extraExporter']
        .some(key => observation[key] !== undefined && observation[key] !== false)) {
    throw new TypeError('Actual independently instantiated runtime observation is unavailable');
  }
  const expectedSource = {
    browser: 'contoso-js-sdk-runtime', ssr: 'contoso-node-sdk-runtime', jvm: 'jdk-jmx-in-memory'
  }[request.layer];
  if (observation.sourceKind !== undefined &&
      (!expectedSource || observation.sourceKind !== expectedSource)) {
    throw new TypeError('File/management-plane observations are not runtime acknowledgements');
  }
  if (observation.sourceKind === undefined && (request.layer !== 'jvm' ||
      observation.startupMechanism !== 'controlled-process-restart' || observation.nativeObservationAvailable !== true)) {
    throw new TypeError('Unknown runtime observation source');
  }
  const observedAtUtc = requireUtc(observation.observedAtUtc, 'runtime observedAtUtc');
  if (Date.parse(observedAtUtc) < Date.parse(requireUtc(request.issuedAtUtc, 'request issuedAtUtc'))) {
    throw new TypeError('Runtime observation predates this request');
  }
  for (const key of ['serviceName', 'roleName']) {
    if (observation[key] !== undefined && (typeof observation[key] !== 'string' ||
        observation[key] !== (request.role ?? request.layerId))) {
      throw new TypeError('Observed runtime role does not match the frozen participant');
    }
  }
  return { observedAtUtc, runId };
}

function actualRuntime(observation, request, { active = true } = {}) {
  const { observedAtUtc, runId } = runtimeObservationIdentity(observation, request);
  const available = observation.nativeStateAvailable ?? observation.nativeObservationAvailable;
  if (available !== true || observation.ready === false) throw new TypeError('Runtime sampler is unavailable/inactive');
  let actualRevision = observation.actualRevision ?? observation.revision;
  if (actualRevision === 'production-or-inactive' && observation.ready === true && observation.activeLeaseId === null) {
    actualRevision = 'production';
  }
  if (actualRevision !== request.revision ||
      observation.activeLeaseId !== (request.revision === 'production' ? null : runId)) {
    throw new TypeError('Requested revision cannot replace actual runtime lease/revision');
  }
  if (request.lease) validateRuntimeLease(request.lease, { layerId: request.layerId, active });
  if (ownedConfigurationHash(observation.ownedConfiguration) !== ownedConfigurationHash(request.ownedPatch)) {
    throw new TypeError('Runtime observation does not match the actual owned configuration');
  }
  return { observedAtUtc, actualRevision, runId };
}

export function samplingAckFromRuntimeObservation(request, observation, { source = 'owner-runtime-api' } = {}) {
  const { observedAtUtc, actualRevision, runId } = actualRuntime(observation, request, {
    active: request.revision !== 'production'
  });
  const guardRequired = request.layer === 'jvm';
  const guard = observation.guard;
  if (guardRequired && (!HASH.test(guard?.sha256 ?? '') || guard.sha256 !== request.lease.guard?.sha256 ||
      guard.providerClass !== request.lease.guard?.providerClass || guard.sdkAbi !== request.lease.guard?.sdkAbi ||
      guard.version !== request.lease.guard?.version || guard.policy !== request.lease.guard?.policy ||
      observation.guardLoadedCount !== 1)) throw new TypeError('Observed guard/loader does not match the actual frozen JVM');
  const ack = {
    schema: 'contoso.sampling-control-ack.v1', layerId: request.layerId, revision: actualRevision,
    runId, activeLeaseId: observation.activeLeaseId, observedAtUtc, runtimeInstanceId: observation.runtimeInstanceId,
    ownedConfiguration: observation.ownedConfiguration, configSha256: ownedConfigurationHash(observation.ownedConfiguration),
    sourceKind: 'trusted-runtime-observation', runtimeEvidenceRef: null,
    percentage: observation.effectiveSamplingPercentage, requestsPerSecond: observation.requestsPerSecond,
    guardPresent: guardRequired, guardSha256: guardRequired ? guard.sha256 : null,
    guardPolicy: guardRequired ? guard.policy : null, guardArtifactVersion: guardRequired ? guard.version : null,
    providerCount: observation.providerCount ?? null, exporterCount: observation.exporterCount ?? null,
    privacyChanged: false, secretsIncluded: false, providerConstruction: false, extraExporter: false,
    ownershipPending: true, certificationEligible: false, runtimeObservationSource: source
  };
  validateSamplingControlAck(ack, { layerId: request.layerId, revision: request.revision,
    guardRequired, guardSha256: guardRequired ? request.lease.guard.sha256 : null,
    ...(guardRequired ? { guardPolicy: request.lease.guard.policy, guardArtifactVersion: request.lease.guard.version } : {}),
    eligibleFull: request.revision !== 'production', runId, activeLeaseId: observation.activeLeaseId,
    observedNotBeforeUtc: request.issuedAtUtc, independentProvider: false });
  return ack;
}

export function drainAckFromRuntimeObservation(request, observation) {
  const { observedAtUtc, runId } = runtimeObservationIdentity(observation, request);
  if (request.lease) validateRuntimeLease(request.lease, { layerId: request.layerId, active: false });
  const state = observation?.admission?.state;
  const admitting = observation?.admitting ?? (['active', 'quiesced', 'draining', 'drained', 'expired'].includes(state) ? state === 'active' : null);
  if (admitting !== false ||
      (observation.inFlightRemaining ?? observation.inFlight ?? observation.admission?.inFlight) !== 0) {
    throw new TypeError('Actual bounded runtime admission/drain has not completed');
  }
  if (observation.activeLeaseId !== null && observation.activeLeaseId !== runId) throw new TypeError('Foreign runtime lease cannot acknowledge this drain');
  return validateDrainAck({
    schema: 'contoso.sampling-drain-ack.v1', runId, layerId: request.layerId,
    sourceKind: 'trusted-runtime-observation', runtimeInstanceId: observation.runtimeInstanceId, observedAtUtc,
    newSyntheticTrafficStopped: true, inFlightRemaining: 0,
    privacyChanged: false, secretsIncluded: false, providerConstruction: false, extraExporter: false
  }, { id: request.layerId }, runId);
}

export function createRestartRuntimeHooks({ applyRuntime, observeRuntime, restoreRuntime, stopTrafficRuntime, drainRuntime,
  node = false, source = 'owner-runtime-api' }) {
  if ([applyRuntime, observeRuntime, restoreRuntime, stopTrafficRuntime, drainRuntime].some(value => typeof value !== 'function')) {
    throw new TypeError('Real restart/reload, observation and drain owner interfaces are mandatory');
  }
  const observe = request => observeRuntime(ownerControlRequest(request, { node }));
  return {
    async apply(request) {
      validateRuntimeLease(request.lease, { layerId: request.layerId });
      const before = await observe(request);
      if ((before.nativeStateAvailable ?? before.nativeObservationAvailable) !== true || before.ready === false ||
          !before.runtimeInstanceId || before.activeLeaseId !== null) {
        throw new TypeError('Actual production runtime baseline is unavailable or has a foreign active lease');
      }
      if (ownedConfigurationHash(before.ownedConfiguration) !== request.expectedOwnedConfigSha256) {
        throw new TypeError('Actual runtime baseline CAS conflict');
      }
      await applyRuntime(request);
      const after = await observe(request);
      if (before.runtimeInstanceId === after.runtimeInstanceId) throw new TypeError('A documented process restart/document reload did not occur');
      return samplingAckFromRuntimeObservation(request, after, { source });
    },
    async observe(request) { return samplingAckFromRuntimeObservation(request, await observe(request), { source }); },
    async drain(request) {
      const body = ownerControlRequest(request, { node });
      await stopTrafficRuntime(body);
      await drainRuntime(body);
      return drainAckFromRuntimeObservation(request, await observe(request));
    },
    async restore(request) {
      validateRuntimeLease(request.lease, { layerId: request.layerId, active: false });
      await restoreRuntime(request);
      return samplingAckFromRuntimeObservation(request, await observe(request), { source });
    },
    implementation: 'owner-controlled-restart-or-document-reload',
    sourceAcceptanceIsCertification: false
  };
}
