import { HASH, UUID, GUARD_POLICY, GUARD_ARTIFACT_VERSION, requireUtc, ownedConfigurationHash } from './telemetry-contract.mjs';

export function validateRuntimeLease(lease, { layerId, now = Date.now(), active = true } = {}) {
  const keys = ['schema', 'runId', 'layerId', 'revision', 'startsAtUtc', 'expiresAtUtc', 'drainAtUtc',
    'restoreDeadlineUtc', 'ownedConfigSha256', 'baselineOwnedConfigSha256', 'hashAlgorithm',
    'ownedConfiguration', 'guard'];
  if (!lease || Object.keys(lease).some(key => !keys.includes(key)) ||
      keys.some(key => !Object.hasOwn(lease, key)) ||
      lease.schema !== 'contoso.sampling-runtime-lease.v1' || !UUID.test(lease.runId ?? '') ||
      !/^contoso-[a-z0-9-]+$/.test(lease.layerId ?? '') || (layerId && lease.layerId !== layerId) ||
      lease.revision !== `cert-${lease.runId}` || lease.hashAlgorithm !== 'contoso.canonical-json.sha256.v1' ||
      !HASH.test(lease.ownedConfigSha256 ?? '') || !HASH.test(lease.baselineOwnedConfigSha256 ?? '') ||
      ownedConfigurationHash(lease.ownedConfiguration) !== lease.ownedConfigSha256) {
    throw new TypeError('Invalid/unbound immutable runtime lease');
  }
  const start = Date.parse(requireUtc(lease.startsAtUtc, 'startsAtUtc'));
  const expiry = Date.parse(requireUtc(lease.expiresAtUtc, 'expiresAtUtc'));
  const drain = Date.parse(requireUtc(lease.drainAtUtc, 'drainAtUtc'));
  const restore = Date.parse(requireUtc(lease.restoreDeadlineUtc, 'restoreDeadlineUtc'));
  if (expiry <= start || expiry - start > 7200000 || drain <= start || drain > expiry ||
      expiry - drain > 120000 || restore <= expiry || restore - expiry > 120000 ||
      (active && (now < start || now >= drain))) throw new TypeError('Runtime lease is outside its bounded admission interval');
  if (lease.guard !== null && (!HASH.test(lease.guard?.sha256 ?? '') ||
      lease.guard.sdkAbi !== '1.65.0' ||
      lease.guard.version !== GUARD_ARTIFACT_VERSION || lease.guard.policy !== GUARD_POLICY ||
      lease.guard.providerClass !== 'com.contoso.correlation.sampling.ParentSafeSamplerCustomizer')) {
    throw new TypeError('Unfrozen runtime parent/link guard');
  }
  return lease;
}

export function createRuntimeLease(state, participant, snapshot, ownedConfiguration) {
  return validateRuntimeLease({
    schema: 'contoso.sampling-runtime-lease.v1', runId: state.runId, layerId: participant.id,
    revision: state.revision, startsAtUtc: state.startsAtUtc, expiresAtUtc: state.expiresAtUtc,
    drainAtUtc: state.drainAtUtc,
    restoreDeadlineUtc: new Date(Date.parse(state.expiresAtUtc) + state.restoreDeadlineSeconds * 1000).toISOString(),
    ownedConfigSha256: ownedConfigurationHash(ownedConfiguration),
    baselineOwnedConfigSha256: snapshot.beforeHash, hashAlgorithm: 'contoso.canonical-json.sha256.v1',
    ownedConfiguration, guard: participant.layer === 'jvm' ? state.guard : null
  }, { active: false });
}
