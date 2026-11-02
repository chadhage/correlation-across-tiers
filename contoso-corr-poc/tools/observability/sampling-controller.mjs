import { spawn, execFile } from 'node:child_process';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { basename, dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { HASH, UUID, GUARD_POLICY, GUARD_ARTIFACT_VERSION, sha256, requireUtc, validateSamplingControlAck, ownedConfigurationHash } from './telemetry-contract.mjs';
import { acquireControllerLock as acquire, readStateJson, writeStateJson as atomic } from './state-io.mjs';
import { createRuntimeLease } from './runtime-lease.mjs';

const execute = promisify(execFile);
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const profilesPath = join(project, 'config', 'sampling-profiles.v1.json');
const OMIT = { $contosoAbsent: true };
const layers = new Set(['browser', 'ssr', 'apim', 'jvm', 'functions-host', 'backend', 'collector']);
const pause = delay => new Promise(done => setTimeout(done, delay));
function exactKeys(value, permitted, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !permitted.includes(key))) {
    throw new TypeError(`Unknown ${label} fields`);
  }
}

function belowRoot(path) {
  const full = resolve(project, path);
  const rel = relative(project, full);
  if (rel.startsWith('..') || isAbsolute(rel) || !/^(?:\.cache|config[\\/]runtime|evidence[\\/]runtime)[\\/]/.test(rel)) {
    throw new TypeError('Controller target must be an approved runtime path inside the project');
  }
  return full;
}

function get(object, path) {
  let current = object;
  for (const part of path.split('.')) {
    if (!current || !Object.hasOwn(current, part)) return OMIT;
    current = current[part];
  }
  return current;
}

function set(object, path, value) {
  const parts = path.split('.');
  let current = object;
  for (const key of parts.slice(0, -1)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new TypeError('Unsafe property path');
    if (current[key] === undefined) current[key] = {};
    if (typeof current[key] !== 'object' || current[key] === null || Array.isArray(current[key])) throw new TypeError('Native config path is not an object');
    current = current[key];
  }
  const last = parts.at(-1);
  if (['__proto__', 'prototype', 'constructor'].includes(last)) throw new TypeError('Unsafe property path');
  if (value?.$contosoAbsent === true) delete current[last];
  else current[last] = structuredClone(value);
}

const captureOwned = (object, keys) => Object.fromEntries(keys.map(key => [key, get(object, key)]));
const ownedHash = ownedConfigurationHash;
async function validateCommandSources(command, cache = null) {
  const interpreter = /^(?:node|pwsh|powershell|python|java|cmd)(?:\.exe)?$/i.test(basename(command.executable));
  if (!Array.isArray(command.codeFiles ?? []) || (interpreter && !command.codeFiles?.length)) {
    throw new TypeError('Interpreter hooks require pinned entry-point/dependency code, not just an executable hash');
  }
  if (command.arguments.some(argument => /^(?:-e|--eval|-p|--print|-command|-encodedcommand)$/i.test(argument))) {
    throw new TypeError('Inline executable hook code is not a frozen source artifact');
  }
  const files = [{ path: command.executable, sha256: command.sha256 }, ...(command.codeFiles ?? [])];
  for (const file of files) {
    exactKeys(file, ['path', 'sha256'], 'command source');
    if (!file.path || !HASH.test(file.sha256 ?? '')) throw new TypeError('Invalid command source freeze');
    const path = resolve(project, file.path);
    let digest = cache?.get(path);
    if (!digest) {
      digest = sha256(await readFile(path));
      cache?.set(path, digest);
    }
    if (digest !== file.sha256) throw new TypeError('Command executable/entry-point source drift');
  }
  if (/^(?:node|pwsh|powershell)(?:\.exe)?$/i.test(basename(command.executable))) {
    const entries = command.arguments.filter(argument => /\.(?:mjs|js|ps1)$/i.test(argument)).map(argument => resolve(project, argument));
    if (!entries.length || entries.some(path => !command.codeFiles.some(file => resolve(project, file.path) === path))) {
      throw new TypeError('Every interpreted entry-point script must be hash-pinned');
    }
  }
}

export function validateProductionRestoreAck(ack, participant, snapshot, guard, request = null) {
  validateSamplingControlAck(ack, {
    layerId: participant.id, revision: 'production',
    guardRequired: participant.layer === 'jvm',
    guardSha256: participant.layer === 'jvm' ? guard.sha256 : null,
    ...(participant.layer === 'jvm' && guard.policy ? { guardPolicy: guard.policy, guardArtifactVersion: guard.version } : {}),
    eligibleFull: false, ...(request ? {
      runId: request.lease.runId, activeLeaseId: null, observedNotBeforeUtc: request.issuedAtUtc,
      independentProvider: false
    } : {})
  });
  if (ack.sourceKind !== 'trusted-runtime-observation' || ack.configSha256 !== snapshot.beforeHash) {
    throw new TypeError('Production native acknowledgement failed');
  }

  return ack;
}

export function assertActivationBeforeDrain(state, now = Date.now()) {
  if (now >= Date.parse(state.expiresAtUtc) || now >= Date.parse(state.drainAtUtc)) {
    throw new TypeError('Activation completed outside the active traffic interval');
  }
}

function patchFor(layer, profile, plan) {
  if (layer === 'jvm') return {
    'sampling.percentage': profile.javaPercentage, 'sampling.requestsPerSecond': OMIT, 'sampling.overrides': []
  };
  if (layer === 'browser') return {
    'telemetry.samplingPercentage': profile.browserPercentage, 'telemetry.tracingMode': 'W3C_TRACE',
    'certification.enabled': true, 'certification.startsAtUtc': plan.startsAtUtc,
    'certification.endsAtUtc': plan.expiresAtUtc, 'certification.windowId': plan.runId, 'demos.enabled': true
  };
  if (layer === 'ssr') return {
    CONTOSO_CERT_START: plan.startsAtUtc, CONTOSO_CERT_END: plan.expiresAtUtc, CONTOSO_CERT_WINDOW_ID: plan.runId
  };
  if (layer === 'apim') return {
    'properties.sampling.samplingType': 'fixed', 'properties.sampling.percentage': profile.apimPercentage,
    'properties.httpCorrelationProtocol': 'W3C', 'properties.alwaysLog': 'allErrors',
    'properties.frontend.request.body.bytes': 0, 'properties.frontend.response.body.bytes': 0,
    'properties.backend.request.body.bytes': 0, 'properties.backend.response.body.bytes': 0,
    'properties.frontend.request.headers': [], 'properties.frontend.response.headers': [],
    'properties.backend.request.headers': [], 'properties.backend.response.headers': []
  };
  if (layer === 'functions-host') return { eligibleCollectionPolicy: 'full-eligible',
    workerJavaGuardRequired: true, noDuplicateHostWorkerLogsRequired: true };
  if (layer === 'backend') return { ingestionSamplingPercentage: 100, dropTransforms: false, tablePlan: 'Analytics' };
  return { enabled: false };
}

export async function validatePlan(plan, { allowAzureWrites = false, now = Date.now(), verifyCertificationPrerequisites = null } = {}) {
  exactKeys(plan, ['schema', 'runId', 'mode', 'target', 'startsAtUtc', 'expiresAtUtc', 'drainSeconds', 'restoreDeadlineSeconds',
    'inventoryParticipantIds', 'participants', 'approvals'], 'sampling plan');
  exactKeys(plan.target, ['subscriptionId', 'location', 'workload', 'environment'], 'target');
  if (plan.target.subscriptionId !== '474c40eb-d385-40d8-baa2-06883dbdca2d' || plan.target.location !== 'centralus' ||
      plan.target.workload !== 'contoso-corr' || plan.target.environment !== 'poc') throw new TypeError('Unapproved controller target');
  exactKeys(plan.approvals, ['localConfigurationWrites', 'trafficApprovalRef', 'azureWriteApprovalRef'], 'approval');
  if (plan?.schema !== 'contoso.sampling-window.v1' || !UUID.test(plan.runId ?? '') ||
      !['LocalValidate', 'BootstrapValidate', 'Certify'].includes(plan.mode) ||
      !Array.isArray(plan.participants) || plan.participants.length === 0 ||
      plan.approvals?.localConfigurationWrites !== true) throw new TypeError('Approved sampling-window plan required');
  const start = Date.parse(requireUtc(plan.startsAtUtc, 'startsAtUtc'));
  const end = Date.parse(requireUtc(plan.expiresAtUtc, 'expiresAtUtc'));
  const profiles = await readStateJson(profilesPath);
  const drainSeconds = plan.drainSeconds ?? (plan.mode === 'LocalValidate' ? 0 : profiles.windowLimits.drainSeconds);
  if (!Number.isInteger(drainSeconds) || drainSeconds < 0 || drainSeconds > 120 ||
      drainSeconds * 1000 >= end - start ||
      (plan.mode !== 'LocalValidate' && drainSeconds !== profiles.windowLimits.drainSeconds)) {
    throw new TypeError('Approved pre-expiry drain reserve required; traffic window must end before lease expiry');
  }
  if (end <= start || end - start > 7200000 || now < start || now >= end ||
      !Number.isInteger(plan.restoreDeadlineSeconds) || plan.restoreDeadlineSeconds < 1 || plan.restoreDeadlineSeconds > 120) {
    throw new TypeError('Invalid/expired bounded window');
  }
  const ids = new Set();
  const commandDigests = new Map();
  for (const participant of plan.participants) {
    exactKeys(participant, ['id', 'layer', 'role', 'adapter'], 'participant');
    exactKeys(participant.adapter, ['kind', 'path', 'apply', 'observe', 'restore', 'stopTraffic'], 'adapter');
    if (!/^contoso-[a-z0-9-]+$/.test(participant.id ?? '') || ids.has(participant.id) ||
        !layers.has(participant.layer) || !/^contoso-[a-z0-9-]+$/.test(participant.role ?? '') ||
        !['json-file', 'command'].includes(participant.adapter?.kind)) throw new TypeError('Invalid participant');
    ids.add(participant.id);
    belowRoot(participant.adapter.path);
    if (plan.mode !== 'LocalValidate' && participant.adapter.kind !== 'command') {
      throw new TypeError('File mutation cannot acknowledge a live runtime');
    }
    if (participant.adapter.kind === 'command' && (!participant.adapter.apply || !participant.adapter.observe || !participant.adapter.restore)) {
      throw new TypeError('Complete apply/observe/restore hooks required');
    }
    if (plan.mode !== 'LocalValidate' && ['browser', 'ssr', 'apim', 'jvm', 'functions-host'].includes(participant.layer) &&
        !participant.adapter.stopTraffic) throw new TypeError('Native synthetic-traffic drain hook required');
    for (const command of [participant.adapter.apply, participant.adapter.observe, participant.adapter.restore, participant.adapter.stopTraffic].filter(Boolean)) {
      exactKeys(command, ['executable', 'sha256', 'arguments', 'capability', 'codeFiles'], 'command');
      if (!HASH.test(command.sha256 ?? '') || !Array.isArray(command.arguments) ||
          !['read-only', 'local-write', 'azure-write'].includes(command.capability) ||
          command.arguments.some(arg => typeof arg !== 'string' || /Bearer |InstrumentationKey=|password=|client_secret=/i.test(arg))) {
        throw new TypeError('Unsafe command capability/arguments');
      }
      if (command.capability === 'azure-write' && (!allowAzureWrites || !plan.approvals.azureWriteApprovalRef)) {
        throw new TypeError('Azure writes are not authorized');
      }
      await validateCommandSources(command, commandDigests);
    }
    if (participant.adapter.observe && participant.adapter.observe.capability !== 'read-only') throw new TypeError('Observe hook must be read-only');
  }
  if (!Array.isArray(plan.inventoryParticipantIds) || ids.size !== plan.inventoryParticipantIds.length ||
      plan.inventoryParticipantIds.some(id => !ids.has(id))) throw new TypeError('Every inventoried participant must be present exactly once');
  if (plan.mode !== 'LocalValidate' && !plan.approvals.trafficApprovalRef) throw new TypeError('Live traffic approval required');
  if (plan.mode !== 'LocalValidate' && [...layers].some(layer => !plan.participants.some(value => value.layer === layer))) {
    throw new TypeError('Every producer/host/backend/collector-absence layer requires acknowledgement');
  }
  const text = JSON.stringify(plan);
  if (/InstrumentationKey=|Bearer |client_secret=|password=/i.test(text)) throw new TypeError('Plan/evidence cannot contain credentials');
  if (plan.mode === 'Certify') {
    if (typeof verifyCertificationPrerequisites !== 'function') {
      throw new TypeError('Certify requires independently verified actual roster, provider ownership and current full-path gate evidence');
    }
    const prerequisites = await verifyCertificationPrerequisites(plan);
    if (prerequisites?.verified !== true || !HASH.test(prerequisites.receiptSha256 ?? '')) {
      throw new TypeError('Unverified certification prerequisites; hashes or caller flags alone do not establish ownership');
    }
  }
  return plan;
}

async function frozenGuard() {
  const lock = await readStateJson(join(project, 'config', 'versions.lock.json'));
  if (!Array.isArray(lock.extensions) || lock.extensions.length !== 1) throw new TypeError('Exactly one frozen extension required');
  const extension = lock.extensions[0];
  const profiles = await readStateJson(profilesPath);
  if (!extension || !HASH.test(extension.sha256 ?? '') || extension.sdkAbi !== '1.65.0' ||
      extension.version !== GUARD_ARTIFACT_VERSION || profiles.guardPolicy !== GUARD_POLICY ||
      extension.providerClass !== 'com.contoso.correlation.sampling.ParentSafeSamplerCustomizer') throw new TypeError('Hash-frozen parent guard required');
  const path = join(project, 'extensions', 'parent-safe-sampler', 'target', extension.file.split(/[\\/]/).at(-1));
  if (sha256(await readFile(path)) !== extension.sha256) throw new TypeError('Parent guard artifact drift');
  return { sha256: extension.sha256, providerClass: extension.providerClass, sdkAbi: extension.sdkAbi,
    version: extension.version, policy: profiles.guardPolicy };
}

async function hook(command, requestPath, timeout) {
  await validateCommandSources(command);
  const env = { ...process.env };
  for (const key of ['NODE_OPTIONS', 'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS']) delete env[key];
  let stdout, stderr;
  try {
    ({ stdout, stderr } = await execute(command.executable, [...command.arguments, requestPath], {
      cwd: project, env, shell: false, timeout, maxBuffer: 262144, windowsHide: true
    }));
  } catch {
    throw Object.assign(new Error('Native adapter command failed; output not persisted'), { code: 'E_NATIVE_HOOK_EXECUTION' });
  }
  if (/Bearer |InstrumentationKey=|client_secret=|password=/i.test(stdout + stderr)) throw new TypeError('Unsafe hook output');
  return stdout.trim() ? JSON.parse(stdout) : null;
}

async function mutateFile(participant, patch, { expectedHash = null } = {}) {
  if (Object.values(patch).some(value => value === undefined)) throw new TypeError('Unresolved native profile value');
  const path = belowRoot(participant.adapter.path);
  const object = await readStateJson(path);
  const keys = Object.keys(patch);
  const current = captureOwned(object, keys);
  if (expectedHash && ownedHash(current) !== expectedHash) throw new TypeError(`Owned-field revision conflict: ${participant.id}`);
  for (const [key, value] of Object.entries(patch)) set(object, key, value);
  await atomic(path, object);
  const observed = captureOwned(await readStateJson(path), keys);
  if (ownedHash(observed) !== ownedHash(patch)) throw new TypeError(`Configuration readback failed: ${participant.id}`);
  return { before: current, afterHash: ownedHash(observed), path };
}

async function commandRequest(directory, participant, operation, patch, revision, state, snapshot = null) {
  const path = join(directory, 'requests', `${participant.id}-${operation}.json`);
  const lease = snapshot?.lease ?? null;
  const leaseFile = lease ? `${belowRoot(participant.adapter.path)}.${state.runId}.lease.json` : null;
  if (lease) {
    try { await writeFile(leaseFile, JSON.stringify(lease, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (failure) {
      if (failure.code !== 'EEXIST' || ownedHash(await readStateJson(leaseFile)) !== ownedHash(lease)) throw failure;
    }
  }
  await atomic(path, { schema: 'contoso.sampling-adapter-request.v1', layerId: participant.id, layer: participant.layer, role: participant.role,
    operation, revision, issuedAtUtc: new Date().toISOString(),
    target: belowRoot(participant.adapter.path), ownedPatch: patch, guard: state.guard, lease, leaseFile,
    expectedOwnedConfigSha256: operation === 'apply' ? snapshot?.beforeHash ?? null : snapshot?.expectedHash ?? null,
    baselineOwnedConfiguration: snapshot?.before ?? null,
    authorizationFromCertificationFlag: false, secretsIncluded: false });
  return path;
}

export async function enterWindow(plan, { startWatchdog = true, ownerPid = process.pid, allowAzureWrites = false,
  verifyCertificationPrerequisites = null } = {}) {
  await validatePlan(plan, { allowAzureWrites, verifyCertificationPrerequisites });
  if (!startWatchdog && plan.mode !== 'LocalValidate') throw new TypeError('Independent watchdog required');
  const guard = await frozenGuard();
  const profiles = await readStateJson(profilesPath);
  const drainSeconds = plan.drainSeconds ?? (plan.mode === 'LocalValidate' ? 0 : profiles.windowLimits.drainSeconds);
  const directory = join(project, '.cache', 'r7', 'controller', plan.runId);
  await mkdir(directory, { recursive: true });
  const release = await acquire(directory);
  const statePath = join(directory, 'state.json');
  let state = { schema: 'contoso.sampling-controller-state.v1', runId: plan.runId,
    mode: plan.mode, revision: `cert-${plan.runId}`, status: 'enabling', ownerPid, watchdogPid: null,
    startsAtUtc: plan.startsAtUtc, expiresAtUtc: plan.expiresAtUtc, restoreDeadlineSeconds: plan.restoreDeadlineSeconds,
    drainSeconds, drainAtUtc: new Date(Date.parse(plan.expiresAtUtc) - drainSeconds * 1000).toISOString(),
    drainAttempted: false, drainFailures: [],
    guard, participants: [], certificationEligible: false, azureRuntimeState: 'To Do',
    ownershipPending: true, providerOwnershipState: 'independent-source-and-runtime-evidence-required',
    azureWritesAuthorized: allowAzureWrites && Boolean(plan.approvals.azureWriteApprovalRef) };
  let ownsJournal = false;
  try {
    try { await access(statePath); throw new TypeError('Window state already exists'); } catch (failure) {
      if (failure.code !== 'ENOENT') throw failure;
    }
    await atomic(join(directory, 'plan.json'), plan);
    await atomic(statePath, state);
    ownsJournal = true;
    if (startWatchdog) {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'watchdog', statePath], {
        detached: true, stdio: 'ignore', windowsHide: true, cwd: project
      });
      let spawnFailure;
      child.on('error', failure => { spawnFailure = failure; });
      child.unref();
      state.watchdogPid = child.pid;
      await atomic(statePath, state);
      const readyDeadline = Date.now() + 5000;
      for (;;) {
        if (spawnFailure) throw spawnFailure;
        try {
          const heartbeat = await readStateJson(join(directory, 'watchdog.json'));
          if (heartbeat.pid === child.pid && alive(child.pid)) break;
        } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
        if (Date.now() >= readyDeadline) throw new Error('Watchdog did not become responsive');
        await pause(50);
      }
    }
    for (const participant of plan.participants) {
      assertActivationBeforeDrain(state);
      const patch = patchFor(participant.layer, profiles.certification, plan);
      const original = await readStateJson(belowRoot(participant.adapter.path));
      if (participant.layer === 'ssr') {
        for (const key of ['CONTOSO_SERVER_SAMPLING_PERCENTAGE', 'CONTOSO_BROWSER_SAMPLING_PERCENTAGE']) {
          const base = Number(original[key] ?? 10);
          if (!Number.isFinite(base) || base <= 0 || base >= 100) {
            throw new TypeError('SSR production base must stay below100; the validated window derives effective100');
          }
        }
      }
      const before = captureOwned(original, Object.keys(patch));
      const snapshot = { id: participant.id, layer: participant.layer, role: participant.role,
        before, beforeHash: ownedHash(before), expectedHash: ownedHash(patch), status: 'pending-apply',
        nativeRuntimeAcknowledgement: null };
      snapshot.lease = createRuntimeLease(state, participant, snapshot, patch);
      state.participants.push(snapshot);
      await atomic(statePath, state);
      await mutateFile(participant, patch, { expectedHash: snapshot.beforeHash });
      snapshot.status = 'local-config-observed';
      await atomic(statePath, state);
      if (participant.adapter.kind === 'command') {
        const request = await commandRequest(directory, participant, 'apply', patch, state.revision, state, snapshot);
        await hook(participant.adapter.apply, request, 10000);
        const observe = await commandRequest(directory, participant, 'observe', patch, state.revision, state, snapshot);
        const observationRequest = await readStateJson(observe);
        const ack = await hook(participant.adapter.observe, observe, 10000);
        validateSamplingControlAck(ack, { layerId: participant.id, revision: state.revision,
          guardRequired: participant.layer === 'jvm', guardSha256: participant.layer === 'jvm' ? guard.sha256 : null,
          ...(participant.layer === 'jvm' ? { guardPolicy: guard.policy, guardArtifactVersion: guard.version } : {}),
          eligibleFull: ['jvm', 'browser', 'ssr', 'apim'].includes(participant.layer),
          runId: state.runId, activeLeaseId: ['jvm', 'ssr', 'browser'].includes(participant.layer) ? state.runId : null,
          observedNotBeforeUtc: observationRequest.issuedAtUtc,
          independentProvider: false });
        if (ack.sourceKind !== 'trusted-runtime-observation') throw new TypeError('Native runtime acknowledgement required');
        if (ack.configSha256 !== snapshot.expectedHash) throw new TypeError('Native owned-configuration hash mismatch');
        snapshot.nativeRuntimeAcknowledgement = ack;
        snapshot.status = 'runtime-observed';
        await atomic(statePath, state);
      }
    }
    assertActivationBeforeDrain(state);
    state.status = plan.mode === 'LocalValidate' ? 'active-local' : 'active-observed';
    state.activatedAtUtc = new Date().toISOString();
    await atomic(statePath, state);
    assertActivationBeforeDrain(state);
    return { statePath, state };
  } catch (failure) {
    if (!ownsJournal) throw failure;
    state.status = 'activation-failed';
    state.errorCategory = failure.name;
    await atomic(statePath, state);
    await release();
    await restoreWindow(statePath, { reason: 'partial-activation-failure', allowAzureWrites });
    throw failure;
  } finally {
    await release();
  }
}

export function validateDrainAck(ack, participant, runId) {
  if (ack?.schema !== 'contoso.sampling-drain-ack.v1' || ack.runId !== runId || ack.layerId !== participant.id ||
      ack.sourceKind !== 'trusted-runtime-observation' || ack.newSyntheticTrafficStopped !== true ||
      ack.inFlightRemaining !== 0 || ack.secretsIncluded !== false || ack.providerConstruction !== false ||
      ack.extraExporter !== false || ack.privacyChanged !== false) {
    throw new TypeError('Native bounded drain acknowledgement failed');
  }
  return ack;
}

function participantDrainComplete(record, participant, state) {
  if (!record || record.id !== participant.id) return false;
  if (record.drainStatus === 'native-drained') {
    try { validateDrainAck(record.drainAcknowledgement, participant, state.runId); return true; }
    catch { return false; }
  }
  if (state.mode === 'LocalValidate' && participant.adapter.kind === 'json-file') {
    return record.drainStatus === 'local-config-only-no-live-drain-proof';
  }
  return !participant.adapter.stopTraffic && ['backend', 'collector'].includes(participant.layer) &&
    record.drainStatus === 'not-a-synthetic-traffic-owner';
}

export function isDrainComplete(state, plan) {
  if (!state.drainCompletedAtUtc || !Array.isArray(state.drainParticipants) ||
      state.drainParticipants.length !== plan.participants.length) return false;
  const ids = new Set(state.drainParticipants.map(record => record.id));
  if (ids.size !== plan.participants.length) return false;
  return plan.participants.every(participant => participantDrainComplete(
    state.drainParticipants.find(record => record.id === participant.id), participant, state));
}

export async function drainWindow(statePath, { reason = 'pre-expiry', allowAzureWrites = false } = {}) {
  statePath = belowRoot(statePath);
  const directory = dirname(statePath);
  const release = await acquire(directory);
  try {
    const state = await readStateJson(statePath);
    const plan = await readStateJson(join(directory, 'plan.json'));
    if (isDrainComplete(state, plan)) return state;
    const existing = state.drainParticipants ?? [];
    if (new Set(existing.map(record => record.id)).size !== existing.length ||
        existing.some(record => !plan.participants.some(participant => participant.id === record.id))) {
      throw new TypeError('Drain journal participant mismatch');
    }
    state.drainParticipants = plan.participants.map(participant =>
      existing.find(record => record.id === participant.id) ?? { id: participant.id, layer: participant.layer, drainStatus: 'pending-drain' });
    state.drainFailures = [];
    delete state.drainCompletedAtUtc;
    if (state.drainAttempted) state.drainResumedAtUtc = new Date().toISOString();
    state.drainAttempted = true;
    state.drainStartedAtUtc ??= new Date().toISOString();
    state.drainReason = reason;
    state.status = 'draining';
    await atomic(statePath, state);
    const deadline = Math.max(Date.now() + 1000, Date.parse(state.expiresAtUtc));
    for (const participant of plan.participants) {
      const record = state.drainParticipants.find(value => value.id === participant.id);
      if (participantDrainComplete(record, participant, state)) continue;
      record.drainStatus = 'pending-drain';
      await atomic(statePath, state);
      try {
        if (participant.adapter.stopTraffic) {
          const command = participant.adapter.stopTraffic;
          if (command.capability === 'azure-write' && (!allowAzureWrites || !plan.approvals.azureWriteApprovalRef)) {
            throw new TypeError('Azure drain is not authorized');
          }
          const snapshot = state.participants.find(value => value.id === participant.id);
          const request = await commandRequest(directory, participant, 'drain', {
            runId: state.runId, stopNewSyntheticTraffic: true, drainUntilUtc: state.expiresAtUtc
          }, state.revision, state, snapshot);
          const ack = await hook(command, request, Math.max(1, Math.min(10000, deadline - Date.now())));
          validateDrainAck(ack, participant, state.runId);
          record.drainAcknowledgement = ack;
          record.drainStatus = 'native-drained';
        } else if (state.mode === 'LocalValidate') {
          record.drainStatus = 'local-config-only-no-live-drain-proof';
        } else if (['backend', 'collector'].includes(participant.layer)) {
          record.drainStatus = 'not-a-synthetic-traffic-owner';
        } else throw new TypeError('Required traffic-owner drain hook is absent');
      } catch (failure) {
        record.drainStatus = 'drain-failed';
        state.drainFailures.push({ layerId: participant.id, errorCategory: failure.name });
      }
      const snapshot = state.participants.find(value => value.id === participant.id);
      if (snapshot) {
        snapshot.drainStatus = record.drainStatus;
        snapshot.drainAcknowledgement = record.drainAcknowledgement ?? null;
      }
      await atomic(statePath, state);
    }
    if (state.drainFailures.length === 0 && plan.participants.every(participant =>
        participantDrainComplete(state.drainParticipants.find(record => record.id === participant.id), participant, state))) {
      state.drainCompletedAtUtc = new Date().toISOString();
    }
    await atomic(statePath, state);
    return state;
  } finally { await release(); }
}

export async function restoreWindow(statePath, { reason = 'requested', allowAzureWrites = false } = {}) {
  statePath = belowRoot(statePath);
  const directory = dirname(statePath);
  const prior = await readStateJson(statePath);
  const priorPlan = await readStateJson(join(directory, 'plan.json'));
  if (!isDrainComplete(prior, priorPlan)) {
    await drainWindow(statePath, { reason: `before-restore-${reason}`, allowAzureWrites });
  }
  const release = await acquire(directory);
  try {
    const state = await readStateJson(statePath);
    const plan = await readStateJson(join(directory, 'plan.json'));
    if (state.status === 'restored' && isDrainComplete(state, plan)) return state;
    state.status = 'reverting';
    state.restoreReason = reason;
    await atomic(statePath, state);
    const absoluteCutoff = Date.parse(state.expiresAtUtc) + state.restoreDeadlineSeconds * 1000;
    state.restoreDeadlineUtc = new Date(absoluteCutoff).toISOString();
    state.restoreDeadlineMissed = Date.now() > absoluteCutoff;
    // Late recovery stays bounded and best-effort, but cannot satisfy the lease's absolute cutoff.
    const deadline = state.restoreDeadlineMissed
      ? Date.now() + state.restoreDeadlineSeconds * 1000
      : Math.min(Date.now() + state.restoreDeadlineSeconds * 1000, absoluteCutoff);
    state.recoveryOperationDeadlineUtc = new Date(deadline).toISOString();
    for (const snapshot of [...state.participants].reverse()) {
      const participant = plan.participants.find(value => value.id === snapshot.id);
      try {
        if (Date.now() >= deadline) throw new Error('Reversion deadline');
        const current = await readStateJson(belowRoot(participant.adapter.path));
        const currentHash = ownedHash(captureOwned(current, Object.keys(snapshot.before)));
        if (currentHash !== snapshot.beforeHash) {
          await mutateFile(participant, snapshot.before, { expectedHash: snapshot.expectedHash });
        }
        if (participant.adapter.kind === 'command') {
          for (const command of [participant.adapter.restore, participant.adapter.observe]) {
            if (command.capability === 'azure-write' && (!allowAzureWrites || !plan.approvals.azureWriteApprovalRef)) throw new Error('Azure restore not authorized');
          }
          const request = await commandRequest(directory, participant, 'restore', snapshot.before, 'production', state, snapshot);
          await hook(participant.adapter.restore, request, Math.min(10000, deadline - Date.now()));
          const observe = await commandRequest(directory, participant, 'observe', snapshot.before, 'production', state, snapshot);
          const observationRequest = await readStateJson(observe);
          const ack = await hook(participant.adapter.observe, observe, Math.min(10000, deadline - Date.now()));
          validateProductionRestoreAck(ack, participant, snapshot, state.guard, observationRequest);
          snapshot.nativeRuntimeAcknowledgement = ack;
        }
        snapshot.status = 'production-restored';
      } catch (failure) {
        snapshot.status = 'restore-failed';
        snapshot.errorCategory = failure.name;
      }
      if (Date.now() > absoluteCutoff || Date.now() > deadline) state.restoreDeadlineMissed = true;
      await atomic(statePath, state);
    }
    if (Date.now() > absoluteCutoff || Date.now() > deadline) state.restoreDeadlineMissed = true;
    state.completeDrainVerified = isDrainComplete(state, plan);
    state.status = state.participants.every(value => value.status === 'production-restored') &&
      state.completeDrainVerified && state.drainFailures.length === 0 && !state.restoreDeadlineMissed
      ? 'restored' : 'restore-failed';
    state.restoredAtUtc = new Date().toISOString();
    state.certificationEligible = false;
    await atomic(statePath, state);
    if (state.status === 'restored' && (Date.now() > absoluteCutoff || Date.now() > deadline)) {
      state.restoreDeadlineMissed = true;
      state.status = 'restore-failed';
      state.restoredAtUtc = new Date().toISOString();
      await atomic(statePath, state);
    }
    return state;
  } finally { await release(); }
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function runWatchdog(statePath) {
  statePath = belowRoot(statePath);
  const heartbeat = join(dirname(statePath), 'watchdog.json');
  for (;;) {
    const state = await readStateJson(statePath);
    const plan = await readStateJson(join(dirname(statePath), 'plan.json'));
    if (state.status === 'restore-failed' || (state.status === 'restored' && isDrainComplete(state, plan))) return;
    await atomic(heartbeat, { schema: 'contoso.sampling-watchdog.v1', pid: process.pid,
      runId: state.runId, observedAtUtc: new Date().toISOString(), ownerAlive: alive(state.ownerPid),
      controllerStatus: state.status });
    if (Date.now() >= Date.parse(state.expiresAtUtc) || !alive(state.ownerPid)) {
      try { await restoreWindow(statePath, { reason: alive(state.ownerPid) ? 'expired' : 'owner-interrupted',
        allowAzureWrites: state.azureWritesAuthorized === true }); return; }
      catch (failure) { if (failure.code !== 'EEXIST') throw failure; }
    }
    else if (!isDrainComplete(state, plan) && Date.now() >= Date.parse(state.drainAtUtc)) {
      try { await drainWindow(statePath, { allowAzureWrites: state.azureWritesAuthorized === true }); }
      catch (failure) { if (failure.code !== 'EEXIST') throw failure; }
    }
    await pause(500);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, input] = process.argv.slice(2);
  if (operation === 'watchdog') await runWatchdog(input);
  else if (operation === 'restore') {
    const state = await restoreWindow(input);
    console.log(JSON.stringify({ status: state.status, certificationEligible: false }));
    if (state.status !== 'restored') process.exitCode = 2;
  } else if (operation === 'enter') {
    const plan = await readStateJson(input);
    const result = await enterWindow(plan);
    console.log(JSON.stringify({ statePath: result.statePath, status: result.state.status, certificationEligible: false }));
    while (!['restored', 'restore-failed'].includes((await readStateJson(result.statePath)).status)) await pause(250);
    const ended = await readStateJson(result.statePath);
    console.log(JSON.stringify({ status: ended.status, certificationEligible: false }));
    if (ended.status !== 'restored') process.exitCode = 2;
  } else throw new Error('Usage: sampling-controller.mjs enter plan.json | restore state.json | watchdog state.json');
}
