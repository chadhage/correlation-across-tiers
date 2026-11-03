import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enterWindow, restoreWindow, validatePlan, validateProductionRestoreAck, validateDrainAck, assertActivationBeforeDrain, isDrainComplete } from '../../tools/observability/sampling-controller.mjs';
import { GUARD_POLICY, GUARD_ARTIFACT_VERSION, sha256 } from '../../tools/observability/telemetry-contract.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const wait = delay => new Promise(done => setTimeout(done, delay));
async function progressBefore(deadline, message, statePath, child = null) {
  if (Date.now() < deadline && (!child || child.exitCode === null)) return;
  const state = JSON.parse(await readFile(statePath, 'utf8').catch(() => '{}'));
  const heartbeat = JSON.parse(await readFile(join(dirname(statePath), 'watchdog.json'), 'utf8').catch(() => '{}'));
  let watchdogAlive = false;
  if (Number.isInteger(state.watchdogPid)) {
    try { process.kill(state.watchdogPid, 0); watchdogAlive = true; } catch { }
  }
  assert.fail(`${message}: ${JSON.stringify({
    status: state.status ?? null, errorCategory: state.errorCategory ?? null,
    restoreReason: state.restoreReason ?? null, watchdogAlive,
    heartbeatAtUtc: heartbeat.observedAtUtc ?? null, childExitCode: child?.exitCode ?? null,
    restoreDeadlineMissed: state.restoreDeadlineMissed ?? null
  })}`);
}
async function fixture(layers = ['jvm'], seconds = 20) {
  const runId = randomUUID();
  const folder = join(project, '.cache', 'r7', 'test-controller', runId);
  await mkdir(folder, { recursive: true });
  const participants = [];
  for (const layer of layers) {
    const path = join(folder, `${layer}.json`);
    const object = layer === 'jvm' ? { sampling: { percentage: 10, requestsPerSecond: 5 },
      security: { epoch: 'keep-current' } } : {};
    await writeFile(path, JSON.stringify(object));
    participants.push({ id: `contoso-${layer}`, role: 'contoso-orders-api', layer,
      adapter: { kind: 'json-file', path } });
  }
  return { folder, plan: {
    schema: 'contoso.sampling-window.v1', runId, mode: 'LocalValidate',
    target: { subscriptionId: '474c40eb-d385-40d8-baa2-06883dbdca2d', location: 'centralus', workload: 'contoso-corr', environment: 'poc' },
    startsAtUtc: new Date(Date.now() - 1000).toISOString(),
    expiresAtUtc: new Date(Date.now() + seconds * 1000).toISOString(),
    restoreDeadlineSeconds: 5, inventoryParticipantIds: participants.map(value => value.id), participants,
    approvals: { localConfigurationWrites: true, trafficApprovalRef: null, azureWriteApprovalRef: null }
  } };
}

async function clean(value) {
  await rm(value.folder, { recursive: true, force: true });
  await rm(join(project, '.cache', 'r7', 'controller', value.plan.runId), { recursive: true, force: true });
}

test('production restoration reuses complete acknowledgement safety validation', () => {
  const hash = 'a'.repeat(64);
  const participant = { id: 'contoso-orders', layer: 'jvm' };
  const snapshot = { beforeHash: hash };
  const ack = { schema: 'contoso.sampling-control-ack.v1', layerId: participant.id, revision: 'production',
    configSha256: hash, sourceKind: 'trusted-runtime-observation',
    guardPresent: true, guardSha256: hash, percentage: 10, requestsPerSecond: null,
    guardPolicy: GUARD_POLICY, guardArtifactVersion: GUARD_ARTIFACT_VERSION,
    privacyChanged: false, secretsIncluded: false, providerConstruction: false, extraExporter: false };
  assert.equal(validateProductionRestoreAck(ack, participant, snapshot, { sha256: hash }), ack);
  for (const field of ['privacyChanged', 'secretsIncluded', 'providerConstruction', 'extraExporter']) {
    assert.throws(() => validateProductionRestoreAck({ ...ack, [field]: true }, participant, snapshot, { sha256: hash }));
    const incomplete = { ...ack };
    delete incomplete[field];
    assert.throws(() => validateProductionRestoreAck(incomplete, participant, snapshot, { sha256: hash }));
  }
  assert.throws(() => validateProductionRestoreAck({ ...ack, layerId: 'contoso-other' }, participant, snapshot, { sha256: hash }));
});

test('drain acknowledgement requires no in-flight work and safe native source', () => {
  const participant = { id: 'contoso-orders' };
  const runId = randomUUID();
  const ack = { schema: 'contoso.sampling-drain-ack.v1', layerId: participant.id, runId,
    sourceKind: 'trusted-runtime-observation', newSyntheticTrafficStopped: true, inFlightRemaining: 0,
    privacyChanged: false, secretsIncluded: false, providerConstruction: false, extraExporter: false };
  assert.equal(validateDrainAck(ack, participant, runId), ack);
  assert.throws(() => validateDrainAck({ ...ack, inFlightRemaining: 1 }, participant, runId));
  assert.throws(() => validateDrainAck({ ...ack, sourceKind: 'local-config' }, participant, runId));
  assert.throws(() => validateDrainAck({ ...ack, secretsIncluded: true }, participant, runId));
});

test('an attempted/partially acknowledged native drain cannot satisfy completion', () => {
  const runId = randomUUID();
  const participants = ['contoso-orders', 'contoso-inventory'].map(id => ({
    id, layer: 'jvm', adapter: { kind: 'command', stopTraffic: {} }
  }));
  const ack = id => ({ schema: 'contoso.sampling-drain-ack.v1', layerId: id, runId,
    sourceKind: 'trusted-runtime-observation', newSyntheticTrafficStopped: true, inFlightRemaining: 0,
    privacyChanged: false, secretsIncluded: false, providerConstruction: false, extraExporter: false });
  const state = { runId, mode: 'Certify', drainAttempted: true, drainFailures: [],
    drainParticipants: [{ id: participants[0].id, drainStatus: 'native-drained', drainAcknowledgement: ack(participants[0].id) }] };
  assert.equal(isDrainComplete(state, { participants }), false);
  state.drainCompletedAtUtc = new Date().toISOString();
  assert.equal(isDrainComplete(state, { participants }), false);
  state.drainParticipants.push({ id: participants[1].id, drainStatus: 'native-drained', drainAcknowledgement: ack(participants[1].id) });
  assert.equal(isDrainComplete(state, { participants }), true);
  state.drainParticipants[1].drainAcknowledgement.inFlightRemaining = 1;
  assert.equal(isDrainComplete(state, { participants }), false);
});

test('activation completion cannot report active at drain-start or after expiry', () => {
  const state = { drainAtUtc: '2026-10-31T21:02:00Z', expiresAtUtc: '2026-10-31T21:04:00Z' };
  assert.doesNotThrow(() => assertActivationBeforeDrain(state, Date.parse('2026-10-31T21:01:59Z')));
  assert.throws(() => assertActivationBeforeDrain(state, Date.parse(state.drainAtUtc)));
  assert.throws(() => assertActivationBeforeDrain(state, Date.parse('2026-10-31T21:05:00Z')));
});

test('SSR keeps R2 configured production base below100 while the window derives eligible100', async () => {
  const data = await fixture(['ssr']);
  try {
    const path = data.plan.participants[0].adapter.path;
    await writeFile(path, JSON.stringify({ CONTOSO_SERVER_SAMPLING_PERCENTAGE: '25', CONTOSO_BROWSER_SAMPLING_PERCENTAGE: '20' }));
    const entered = await enterWindow(data.plan, { startWatchdog: false });
    const active = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(active.CONTOSO_SERVER_SAMPLING_PERCENTAGE, '25');
    assert.equal(active.CONTOSO_BROWSER_SAMPLING_PERCENTAGE, '20');
    assert.equal(active.CONTOSO_CERT_WINDOW_ID, data.plan.runId);
    assert.equal(active.CONTOSO_CERT_END, data.plan.expiresAtUtc);
    const restored = await restoreWindow(entered.statePath);
    assert.equal(restored.status, 'restored');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).CONTOSO_SERVER_SAMPLING_PERCENTAGE, '25');
  } finally { await clean(data); }
});

test('all layer local activation and restoration preserve unrelated security fields', async () => {
  const data = await fixture(['browser', 'ssr', 'apim', 'jvm', 'functions-host', 'backend', 'collector']);
  try {
    const entered = await enterWindow(data.plan, { startWatchdog: false });
    assert.equal(entered.state.status, 'active-local');
    assert.equal(entered.state.certificationEligible, false);
    const participant = data.plan.participants.find(value => value.layer === 'jvm');
    const active = JSON.parse(await readFile(participant.adapter.path, 'utf8'));
    assert.equal(active.sampling.percentage, 100);
    assert(!Object.hasOwn(active.sampling, 'requestsPerSecond'));
    active.security.epoch = 'approved-new-epoch';
    await writeFile(participant.adapter.path, JSON.stringify(active));
    const restored = await restoreWindow(entered.statePath);
    assert.equal(restored.status, 'restored');
    assert(restored.participants.every(value => value.status === 'production-restored'));
    const final = JSON.parse(await readFile(participant.adapter.path, 'utf8'));
    assert.equal(final.sampling.percentage, 10);
    assert.equal(final.sampling.requestsPerSecond, 5);
    assert.equal(final.security.epoch, 'approved-new-epoch');
    const lock = JSON.parse(await readFile(join(project, 'config', 'versions.lock.json'), 'utf8'));
    assert.equal(restored.guard.sha256, lock.extensions[0].sha256);
  } finally { await clean(data); }
});

test('owned sampling revision conflict fails instead of overwriting a concurrent change', async () => {
  const data = await fixture();
  try {
    const entered = await enterWindow(data.plan, { startWatchdog: false });
    const path = data.plan.participants[0].adapter.path;
    const current = JSON.parse(await readFile(path, 'utf8'));
    current.sampling.percentage = 25;
    await writeFile(path, JSON.stringify(current));
    const restored = await restoreWindow(entered.statePath);
    assert.equal(restored.status, 'restore-failed');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).sampling.percentage, 25);
  } finally { await clean(data); }
});

test('expired/incomplete inventory, live file acknowledgements and path escape are nonpassing', async () => {
  const data = await fixture();
  try {
    await assert.rejects(validatePlan({ ...data.plan, expiresAtUtc: new Date(0).toISOString() }));
    await assert.rejects(validatePlan({ ...data.plan, inventoryParticipantIds: [] }));
    await assert.rejects(validatePlan({ ...data.plan, mode: 'Certify', approvals: { ...data.plan.approvals, trafficApprovalRef: 'approved' } }));
    await assert.rejects(validatePlan({ ...data.plan, unapprovedExtra: true }));
    await assert.rejects(validatePlan({ ...data.plan, target: { ...data.plan.target, location: 'eastus' } }));
    const bad = structuredClone(data.plan);
    bad.participants[0].adapter.path = join(project, 'config', 'versions.lock.json');
    await assert.rejects(validatePlan(bad));
  } finally { await clean(data); }
});

test('independent watchdog restores after controller interruption', { timeout: 20000 }, async () => {
  const data = await fixture(['jvm'], 10);
  const planPath = join(data.folder, 'plan.json');
  await writeFile(planPath, JSON.stringify(data.plan));
  const child = spawn(process.execPath, [join(project, 'tools', 'observability', 'sampling-controller.mjs'), 'enter', planPath],
    { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.resume();
  child.stderr.resume();
  const statePath = join(project, '.cache', 'r7', 'controller', data.plan.runId, 'state.json');
  let watchdogPid;
  try {
    const deadline = Date.now() + 8000;
    for (;;) {
      let state;
      try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
      if (state?.status === 'active-local') { watchdogPid = state.watchdogPid; break; }
      await progressBefore(deadline, 'Controller activation did not finish', statePath, child);
      await wait(50);
    }
    assert(watchdogPid && watchdogPid !== child.pid);
    child.kill();
    for (;;) {
      const state = JSON.parse(await readFile(statePath, 'utf8'));
      if (state.status === 'restored') {
        assert.equal(state.restoreReason, 'owner-interrupted');
        assert.equal(JSON.parse(await readFile(data.plan.participants[0].adapter.path, 'utf8')).sampling.percentage, 10);
        break;
      }
      await progressBefore(deadline + 5000, 'Independent watchdog did not restore', statePath);
      await wait(100);
    }
    await wait(600);
  } finally {
    if (child.exitCode === null) child.kill();
    if (watchdogPid) {
      try { process.kill(watchdogPid, 0); process.kill(watchdogPid); } catch { }
    }
    await clean(data);
  }
});

test('independent watchdog enforces expiry even while the owner stays alive', { timeout: 15000 }, async () => {
  const data = await fixture(['jvm'], 2);
  let watchdogPid;
  try {
    const entered = await enterWindow(data.plan);
    watchdogPid = entered.state.watchdogPid;
    const deadline = Date.now() + 7000;
    for (;;) {
      const state = JSON.parse(await readFile(entered.statePath, 'utf8'));
      if (state.status === 'restored') {
        assert.equal(state.restoreReason, 'expired');
        assert.equal(JSON.parse(await readFile(data.plan.participants[0].adapter.path, 'utf8')).sampling.percentage, 10);
        break;
      }
      await progressBefore(deadline, 'Expiry watchdog did not restore', entered.statePath);
      await wait(100);
    }
    await wait(600);
  } finally {
    if (watchdogPid) { try { process.kill(watchdogPid, 0); process.kill(watchdogPid); } catch { } }
    await clean(data);
  }
});

test('partial activation failure restores the write-ahead baseline', async () => {
  const data = await fixture();
  try {
    data.plan.participants.push({ id: 'contoso-missing-jvm', role: 'contoso-inventory-api', layer: 'jvm',
      adapter: { kind: 'json-file', path: join(data.folder, 'missing.json') } });
    data.plan.inventoryParticipantIds.push('contoso-missing-jvm');
    await assert.rejects(enterWindow(data.plan, { startWatchdog: false }));
    const state = JSON.parse(await readFile(join(project, '.cache', 'r7', 'controller', data.plan.runId, 'state.json'), 'utf8'));
    assert.equal(state.status, 'restored');
    assert.equal(state.restoreReason, 'partial-activation-failure');
    assert.equal(JSON.parse(await readFile(data.plan.participants[0].adapter.path, 'utf8')).sampling.percentage, 10);
  } finally { await clean(data); }
});

test('watchdog starts drain before expiry without changing the full sampling profile early', { timeout: 15000 }, async () => {
  const data = await fixture(['jvm'], 4);
  data.plan.drainSeconds = 2;
  let watchdogPid;
  try {
    const entered = await enterWindow(data.plan);
    watchdogPid = entered.state.watchdogPid;
    assert.equal(entered.state.drainSeconds, 2);
    const deadline = Date.now() + 7000;
    let draining;
    for (;;) {
      const state = JSON.parse(await readFile(entered.statePath, 'utf8'));
      if (state.drainCompletedAtUtc) { draining = state; break; }
      await progressBefore(deadline, 'Scheduled pre-expiry drain did not occur', entered.statePath);
      await wait(50);
    }
    assert.equal(draining.status, 'draining');
    assert(Date.parse(draining.drainStartedAtUtc) < Date.parse(draining.expiresAtUtc));
    assert.equal(draining.participants[0].drainStatus, 'local-config-only-no-live-drain-proof');
    assert.equal(JSON.parse(await readFile(data.plan.participants[0].adapter.path, 'utf8')).sampling.percentage, 100);
    for (;;) {
      const state = JSON.parse(await readFile(entered.statePath, 'utf8'));
      if (state.status === 'restored') break;
      await progressBefore(deadline, 'Final restoration did not finish', entered.statePath);
      await wait(100);
    }
    await wait(600);
  } finally {
    if (watchdogPid) { try { process.kill(watchdogPid, 0); process.kill(watchdogPid); } catch { } }
    await clean(data);
  }
});

test('late recovery restores best-effort but fails the absolute expiry-plus-budget cutoff', { timeout: 10000 }, async () => {
  const data = await fixture(['jvm'], 1);
  data.plan.restoreDeadlineSeconds = 1;
  try {
    const entered = await enterWindow(data.plan, { startWatchdog: false });
    await wait(2200);
    const result = await restoreWindow(entered.statePath, { reason: 'late-owner' });
    assert.equal(result.status, 'restore-failed');
    assert.equal(result.restoreDeadlineMissed, true);
    assert.equal(Date.parse(result.restoreDeadlineUtc), Date.parse(data.plan.expiresAtUtc) + 1000);
    assert.equal(JSON.parse(await readFile(data.plan.participants[0].adapter.path, 'utf8')).sampling.percentage, 10);
  } finally { await clean(data); }
});

test('recovery resumes an interrupted persisted mid-drain journal instead of trusting attempted', async () => {
  const data = await fixture(['jvm', 'ssr']);
  try {
    const entered = await enterWindow(data.plan, { startWatchdog: false });
    const state = JSON.parse(await readFile(entered.statePath, 'utf8'));
    state.drainAttempted = true;
    state.drainStartedAtUtc = new Date().toISOString();
    state.status = 'draining';
    state.drainFailures = [];
    state.drainParticipants = [{
      id: data.plan.participants[0].id, layer: 'jvm', drainStatus: 'local-config-only-no-live-drain-proof'
    }];
    delete state.drainCompletedAtUtc;
    await writeFile(entered.statePath, JSON.stringify(state));
    const recovered = await restoreWindow(entered.statePath, { reason: 'interrupted-mid-drain' });
    assert.equal(recovered.status, 'restored');
    assert.equal(recovered.completeDrainVerified, true);
    assert.equal(recovered.drainParticipants.length, data.plan.participants.length);
    assert(recovered.drainResumedAtUtc);
    assert(recovered.drainCompletedAtUtc);
    assert(isDrainComplete(recovered, data.plan));
  } finally { await clean(data); }
});

test('duplicate lease entry preserves the original write-ahead journal and rollback', async () => {
  const data = await fixture();
  try {
    const entered = await enterWindow(data.plan, { startWatchdog: false });
    const before = await readFile(entered.statePath, 'utf8');
    await assert.rejects(enterWindow(data.plan, { startWatchdog: false }), /already exists/);
    assert.equal(await readFile(entered.statePath, 'utf8'), before);
    const restored = await restoreWindow(entered.statePath);
    assert.equal(restored.status, 'restored');
    assert.equal(JSON.parse(await readFile(data.plan.participants[0].adapter.path, 'utf8')).sampling.percentage, 10);
  } finally { await clean(data); }
});

test('interpreter executable hash alone cannot approve mutable hook code or inline evaluation', async () => {
  const data = await fixture();
  try {
    const script = join(project, 'tools', 'observability', 'state-io.mjs');
    const command = { executable: process.execPath, sha256: sha256(await readFile(process.execPath)),
      arguments: [script], capability: 'local-write' };
    data.plan.participants[0].adapter = { kind: 'command', path: data.plan.participants[0].adapter.path,
      apply: command, restore: command, observe: { ...command, capability: 'read-only' } };
    await assert.rejects(validatePlan(data.plan), /pinned entry-point/);
    const pinned = { ...command, codeFiles: [{ path: script, sha256: sha256(await readFile(script)) }] };
    data.plan.participants[0].adapter.apply = pinned;
    data.plan.participants[0].adapter.restore = pinned;
    data.plan.participants[0].adapter.observe = { ...pinned, capability: 'read-only' };
    await assert.doesNotReject(validatePlan(data.plan));
    data.plan.participants[0].adapter.apply = { ...pinned, arguments: ['--eval', 'console.log("{}")'] };
    await assert.rejects(validatePlan(data.plan), /Inline executable/);
    data.plan.participants[0].adapter.apply = { ...pinned, codeFiles: [{ path: script, sha256: 'a'.repeat(64) }] };
    await assert.rejects(validatePlan(data.plan), /source drift/);
  } finally { await clean(data); }
});
