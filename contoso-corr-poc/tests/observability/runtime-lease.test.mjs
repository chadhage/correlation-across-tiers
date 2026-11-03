import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GUARD_POLICY, GUARD_ARTIFACT_VERSION, canonicalJson, ownedConfigurationHash, validateSamplingControlAck } from '../../tools/observability/telemetry-contract.mjs';
import { validateRuntimeLease } from '../../tools/observability/runtime-lease.mjs';

const hash = 'a'.repeat(64);
const runId = randomUUID();
const ownedConfiguration = { 'sampling.percentage': 100, 'sampling.requestsPerSecond': { $contosoAbsent: true }, 'sampling.overrides': [] };
const lease = {
  schema: 'contoso.sampling-runtime-lease.v1', runId, layerId: 'contoso-orders-api', revision: `cert-${runId}`,
  startsAtUtc: '2026-11-01T04:00:00Z', drainAtUtc: '2026-11-01T04:02:00Z',
  expiresAtUtc: '2026-11-01T04:04:00Z', restoreDeadlineUtc: '2026-11-01T04:06:00Z',
  ownedConfigSha256: ownedConfigurationHash(ownedConfiguration), baselineOwnedConfigSha256: hash,
  hashAlgorithm: 'contoso.canonical-json.sha256.v1', ownedConfiguration,
  guard: { sha256: hash, sdkAbi: '1.65.0', providerClass: 'com.contoso.correlation.sampling.ParentSafeSamplerCustomizer',
    policy: GUARD_POLICY, version: GUARD_ARTIFACT_VERSION }
};

test('cross-owner canonical hash ignores object insertion order but preserves absence and array order', () => {
  assert.equal(canonicalJson({ z: [], a: { y: true, x: null } }), '{"a":{"x":null,"y":true},"z":[]}');
  assert.equal(ownedConfigurationHash(ownedConfiguration), ownedConfigurationHash(Object.fromEntries(Object.entries(ownedConfiguration).reverse())));
  assert.notEqual(ownedConfigurationHash({ value: null }), ownedConfigurationHash({ value: { $contosoAbsent: true } }));
  assert.notEqual(ownedConfigurationHash([1, 2]), ownedConfigurationHash([2, 1]));
  assert.throws(() => ownedConfigurationHash({ unresolved: undefined }));
  assert.throws(() => ownedConfigurationHash({ invalid: Infinity }));
});

test('immutable runtime lease binds actual owned configuration and absolute admission/drain deadlines', () => {
  assert.equal(validateRuntimeLease(lease, { now: Date.parse('2026-11-01T04:01:00Z') }), lease);
  assert.throws(() => validateRuntimeLease(lease, { now: Date.parse(lease.drainAtUtc) }));
  assert.throws(() => validateRuntimeLease({ ...lease, ownedConfigSha256: hash }, { active: false }));
  assert.throws(() => validateRuntimeLease({ ...lease, restoreDeadlineUtc: '2026-11-01T04:07:00Z' }, { active: false }));
  assert.throws(() => validateRuntimeLease({ ...lease, revision: 'production' }, { active: false }));
  assert.throws(() => validateRuntimeLease({ ...lease, guard: { ...lease.guard, policy: 'DROP_VALID_UNSAMPLED_PARENT' } }, { active: false }));
  assert.throws(() => validateRuntimeLease({ ...lease, guard: { ...lease.guard, version: '1.0.0' } }, { active: false }));
});

test('runtime acknowledgement rejects stale leases, file echoes and unproven independent ownership', () => {
  const expected = { layerId: lease.layerId, revision: lease.revision, runId, activeLeaseId: runId,
    observedNotBeforeUtc: lease.startsAtUtc, guardRequired: true, guardSha256: hash,
    independentProvider: true, eligibleFull: true };
  expected.guardPolicy = GUARD_POLICY;
  expected.guardArtifactVersion = GUARD_ARTIFACT_VERSION;
  const ack = { schema: 'contoso.sampling-control-ack.v1', layerId: lease.layerId, revision: lease.revision,
    runId, activeLeaseId: runId, observedAtUtc: '2026-11-01T04:01:00Z', runtimeInstanceId: 'fixture-observer',
    ownedConfiguration, configSha256: lease.ownedConfigSha256, sourceKind: 'trusted-runtime-observation',
    guardPresent: true, guardSha256: hash, percentage: 100, requestsPerSecond: null,
    guardPolicy: GUARD_POLICY, guardArtifactVersion: GUARD_ARTIFACT_VERSION,
    providerCount: 1, exporterCount: 1, privacyChanged: false, secretsIncluded: false, providerConstruction: false, extraExporter: false };
  assert.equal(validateSamplingControlAck(ack, expected), ack);
  for (const patch of [{ runId: randomUUID() }, { activeLeaseId: null }, { sourceKind: 'local-config' },
    { observedAtUtc: '2026-11-01T03:59:00Z' }, { providerCount: null }, { exporterCount: 2 },
    { ownedConfiguration: { ...ownedConfiguration, 'sampling.percentage': 10 } },
    { guardPolicy: 'DROP_VALID_UNSAMPLED_PARENT' }, { guardArtifactVersion: '1.0.0' }]) {
    assert.throws(() => validateSamplingControlAck({ ...ack, ...patch }, expected));
  }
});
