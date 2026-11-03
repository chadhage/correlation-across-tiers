import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateBoundaryMap, HASH, UUID, requireUtc } from '../observability/telemetry-contract.mjs';
import { VerificationFailure } from './invariants.mjs';
import { verifyGraphIntake, assertVerifiedScenario } from './pipeline.mjs';
import { parseTraceparent } from '../protocol.mjs';
import { projectRoot, createBoundDirectory, jsonBytes, sha256, readBoundFile, relativeFile, writeManifest, verifyManifest } from './files.mjs';

const MODES = new Set(['LocalValidate', 'BootstrapValidate', 'Certify']);
const REQUIRED_ADAPTER_METHODS = ['prepare', 'execute', 'drain', 'collect', 'scanPrivacy', 'observeSampling', 'stopTraffic', 'reset'];
const SOURCE_EXTENSIONS = /\.(?:json|bicep|bicepparam|xml|java|ts|js|mjs|ps1|sh|ya?ml)$/;
const skip = new Set(['node_modules', 'target', 'dist', 'bin', 'obj', '.cache', '.tools', '.java-work', '.git', 'deployment-artifact', 'evidence', 'tests']);
const failure = (code, detail) => { throw new VerificationFailure(code, detail); };

export async function loadCatalog() {
  const bytes = await readBoundFile(path.join('demos', 'catalog.json'));
  const catalog = JSON.parse(bytes.toString('utf8'));
  const mapBytes = await readBoundFile(catalog.boundaryMap);
  const map = validateBoundaryMap(JSON.parse(mapBytes.toString('utf8')));
  const scenarios = (await readBoundFile(path.join('services', 'correlation-core', 'src', 'main', 'java', 'com', 'contoso', 'correlation', 'workflow', 'RunScenario.java')))
    .toString('utf8').match(/enum RunScenario\s*\{([^}]+)\}/)?.[1].split(',').map(value => value.trim());
  if (catalog.schema !== 'contoso.demo-catalog.v1' || catalog.sourceAcceptanceIsCertification !== false ||
      catalog.demos?.length !== 15 || !scenarios) failure('D_CATALOG', 'Exact fifteen-demo source catalog/native enum required');
  catalog.demos.forEach((spec, index) => {
    if (spec.id !== String(index + 1).padStart(2, '0') || !spec.title || !spec.purpose ||
        !scenarios.includes(spec.scenario) || (spec.additionalScenarios ?? []).some(value => !scenarios.includes(value)) ||
        !Array.isArray(spec.paths) || !spec.paths.length || !Array.isArray(spec.criteria) || !spec.criteria.length ||
        !spec.assertion || !spec.brief?.length) failure('D_CATALOG', 'Demo ID/scenario/acceptance contract mismatch');
    spec.requiredBoundaries = spec.requiredBoundaries === 'coreSynchronousBoundaries'
      ? [...map.coreSynchronousBoundaries] : spec.requiredBoundaries;
    if (!Array.isArray(spec.requiredBoundaries) || !spec.requiredBoundaries.length ||
        spec.requiredBoundaries.some(id => !map.spans.some(boundary => boundary.id === id))) failure('D_CATALOG', 'Demo coverage must refer to the one root expected map');
  });
  return { catalog, map, catalogSha256: sha256(bytes), boundaryMapSha256: sha256(mapBytes) };
}

async function sourceFiles(prefix = '') {
  const files = [];
  for (const entry of await readdir(path.join(projectRoot, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && !skip.has(entry.name)) files.push(...await sourceFiles(relative));
    else if (entry.isFile() && entry.name !== 'board-state.json' && (SOURCE_EXTENSIONS.test(entry.name) || entry.name === 'VERSIONS.md')) files.push(relative);
  }
  return files.sort();
}

export async function sourceSnapshot() {
  return Promise.all((await sourceFiles()).map(async file => ({ path: file, sha256: sha256(await readBoundFile(file)) })));
}

export function invalidateChangedSources(previous, current, claims) {
  const before = new Map(previous.map(item => [relativeFile(item.path), item.sha256]));
  const after = new Map(current.map(item => [relativeFile(item.path), item.sha256]));
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter(file => before.get(file) !== after.get(file));
  const newCritical = changed.some(file => !before.has(file) &&
    /^(?:services|workers|web|apim|infra|contracts|config|extensions|tools)[\\/]|\b(?:pom\.xml|package(?:-lock)?\.json)$/.test(file));
  return claims.map(claim => ({
    ...claim,
    result: newCritical || changed.some(file => claim.sources?.some(source => relativeFile(source) === file)) ? 'INVALIDATED' : claim.result,
    changedSources: changed.filter(file => claim.sources?.some(source => relativeFile(source) === file))
  }));
}

function safeNormalizedRows(rows) {
  return rows.map(row => {
    const { recordLocator, resourceId, workspaceId, subscriptionId, ...rest } = row;
    const { resourceId: ignoredResource, workspaceId: ignoredWorkspace, subscriptionId: ignoredSubscription, ...locator } = recordLocator;
    return { ...rest, recordLocator: locator };
  });
}

function assertReset(before, after) {
  if (!before || after?.schema !== 'contoso.demo-reset.v1' || after.scope !== 'run-only' ||
      after.unownedStateTouched !== false || after.trafficStopped !== true ||
      after.samplingRestored !== true || after.flagsRestored !== true || after.seedRestored !== true ||
      after.ownedMessagesDrained !== true || !HASH.test(after.evidenceSha256 ?? '') ||
      JSON.stringify(before.baselineHashes) !== JSON.stringify(after.baselineHashes)) failure('D_RESET', 'Actual run-scoped baseline/queue/flags/sampling restore receipt required');
  return { result: 'PASS', scope: 'run-only', sourceAcceptanceIsCertification: false, evidenceSha256: after.evidenceSha256 };
}

async function bounded(operation, seconds, signalController) {
  let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => { timer = setTimeout(() => {
        signalController.abort();
        reject(new VerificationFailure('D_TIMEOUT', 'Bounded demo stage expired; stop/drain/reset required'));
      }, seconds * 1000); })
    ]);
  } finally { clearTimeout(timer); }
}

function verifyAdapter(adapter, mode) {
  if (!adapter || adapter.schema !== 'contoso.demo-adapter.v1' ||
      REQUIRED_ADAPTER_METHODS.some(name => typeof adapter[name] !== 'function')) failure('D_MISSING_ADAPTER', 'VERIFY: approved native traffic/capture/control/reset adapter is not implemented or supplied');
  if (mode !== 'LocalValidate' && (!adapter.sourceReviewed || !HASH.test(adapter.sourceSha256 ?? '') ||
      !adapter.trafficApprovalRef || !adapter.nativeTargetScope)) failure('D_ADAPTER_APPROVAL', 'Approved reviewed native target/traffic source required; preparation grants no cloud actions');
}

function verifySampling(sampling, execution, mode) {
  if (mode === 'LocalValidate') return { result: 'NOT CERTIFIED', mode, nativeFidelityVerified: false };
  if (sampling?.schema !== 'contoso.demo-sampling-observation.v1' ||
      sampling.nativeRuntimeInventoryComplete !== true || sampling.nativeFidelityVerified !== true ||
      sampling.allParticipantsObserved !== true || sampling.settingsOnly !== false ||
      !HASH.test(sampling.evidenceSha256 ?? '') || !Array.isArray(sampling.participants) || !sampling.participants.length) {
    return { result: 'INCONCLUSIVE', reason: 'Native sampling/inventory admission not verified; settings are not fidelity evidence' };
  }
  const from = Date.parse(requireUtc(execution.fromUtc, 'traffic start'));
  const to = Date.parse(requireUtc(execution.toUtc, 'traffic end'));
  const start = Date.parse(requireUtc(sampling.startsAtUtc, 'sampling start'));
  const end = Date.parse(requireUtc(sampling.expiresAtUtc, 'sampling expiry'));
  if (end <= start || end - start > 7_200_000 || from < start || to > end ||
      sampling.participants.some(item => item.observed !== true || item.percentage !== 100 || !HASH.test(item.evidenceSha256 ?? ''))) {
    return { result: 'INCONCLUSIVE', reason: '100% native admission does not cover the exact bounded traffic window' };
  }
  return { result: 'PASS', nativeFidelityVerified: true, evidenceSha256: sampling.evidenceSha256 };
}

export async function runDemo({
  demoId, mode = 'LocalValidate', adapter = null, adapterPath = null, timeoutSeconds = 300,
  outputRoot = path.join(projectRoot, 'evidence'), recordEvidence = true
}) {
  if (!MODES.has(mode) || !/^(?:0[1-9]|1[0-5])$/.test(demoId) ||
      !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0 || timeoutSeconds > 7200) failure('D_ARGUMENT', 'Invalid bounded demo ID/mode/timeout');
  const rootRelative = path.relative(projectRoot, path.resolve(outputRoot));
  if (rootRelative === '..' || rootRelative.startsWith(`..${path.sep}`) || path.isAbsolute(rootRelative)) failure('E_PATH', 'Evidence must stay in the project');
  const { catalog, map, catalogSha256, boundaryMapSha256 } = await loadCatalog();
  const spec = catalog.demos.find(item => item.id === demoId);
  const runId = randomUUID();
  const startedAtUtc = new Date().toISOString();
  const context = {
    schema: 'contoso.demo-context.v1', demoId, runId, mode, spec, startedAtUtc,
    requestedBusinessInvocationId: randomUUID(), boundaryMapSha256,
    signal: new AbortController().signal
  };
  const controller = new AbortController();
  context.signal = controller.signal;
  const summary = {
    schema: 'contoso.demo-run.v1', demoId, runId, mode, startedAtUtc, result: 'FAIL',
    certificationStatus: mode === 'BootstrapValidate' ? 'NOT CERTIFIED — BOOTSTRAP' : 'NOT CERTIFIED',
    sourceAcceptanceIsCertification: false, brief: spec.brief, criteria: spec.criteria,
    catalogSha256, boundaryMapSha256, adapterPath, adapterSha256: adapter?.sourceSha256 ?? null,
    reset: { result: 'NOT RUN', reason: 'No native adapter/effect baseline' }
  };
  let prepared;
  let approvedCapture;
  let approvedRows;
  let approvedMetadata;
  let beforeSources;
  const deadline = Date.now() + timeoutSeconds * 1000;
  const stage = operation => bounded(operation, Math.max(0.001, (deadline - Date.now()) / 1000), controller);
  try {
    verifyAdapter(adapter, mode);
    if (mode === 'Certify') {
      const board = JSON.parse((await readBoundFile(path.join('config', 'board-state.json'))).toString('utf8'));
      if (Array.from({ length: 13 }, (_, index) => `GATE-${String(index + 1).padStart(2, '0')}`)
        .some(id => board.records[id]?.status !== 'Done')) failure('D_GATES_NOT_ACCEPTED', 'All thirteen current applicable gate facets are required; use NOT CERTIFIED bootstrap to obtain missing evidence');
    }
    beforeSources = await sourceSnapshot();
    prepared = await stage(() => adapter.prepare(context));
    if (!Array.isArray(prepared?.baselineHashes) || !prepared.baselineHashes.length ||
        prepared.baselineHashes.some(item => !item.component || !HASH.test(item.sha256 ?? ''))) failure('D_BASELINE', 'Capture actual run-scoped pre-state before effects');
    summary.baselineHashes = prepared.baselineHashes.map(item => ({ component: item.component, sha256: item.sha256 }));
    const execution = await stage(() => adapter.execute(context, prepared));
    if (!execution || !UUID.test(execution.businessInvocationId ?? '') || !execution.expectation ||
        execution.observationOrigin !== 'native-runtime') failure('D_NATIVE_TRIGGER', 'Actual native trigger response/identity/traffic receipt required');
    await stage(() => adapter.drain(context, execution));
    const capture = await stage(() => adapter.collect(context, execution));
    const privacy = await stage(() => adapter.scanPrivacy(capture, execution));
    if (privacy?.result !== 'PASS' || privacy.scannedAllColumns !== true) failure('E_PRIVACY', 'Unsafe or incomplete raw capture; original rows are never persisted');
    const capability = await stage(() => verifyGraphIntake({ map, spec, capture, execution, mode }));
    const verified = assertVerifiedScenario(capability);
    const { rows, coverage, invariants, assertion } = verified;
    const sampling = verifySampling(await stage(() => adapter.observeSampling(context, execution)), execution, mode);
    if (JSON.stringify(beforeSources) !== JSON.stringify(await sourceSnapshot())) failure('E_SOURCE_DRIFT', 'Dependency/runtime/policy/schema/checker changed during the run; affected claims INVALIDATED');
    summary.result = sampling.result === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : 'PASS';
    summary.coverage = coverage;
    summary.invariants = invariants;
    summary.assertion = assertion;
    summary.originScope = verified.originScope;
    summary.sampling = sampling;
    summary.privacy = { result: verified.privacy.result, policySha256: verified.privacy.policySha256,
      scannedRawRecords: verified.privacy.scannedRawRecords, tablesScanned: verified.privacy.tablesScanned,
      assessmentScope: verified.privacy.assessmentScope ?? 'graph-intake',
      globalTelemetrySafetyVerified: verified.privacy.globalTelemetrySafetyVerified === true };
    if (/Authorization|Cookie|InstrumentationKey=|AccountKey=|eyJ[A-Za-z0-9_-]{12}/i.test(capture.queryText)) failure('E_PRIVACY', 'Unsafe query persistence refused');
    approvedCapture = capture;
    approvedRows = safeNormalizedRows(rows);
    const carriers = (execution.nativeFacts ?? []).filter(fact => fact.type === 'gateway-wire' || fact.type === 'message-envelope').map(fact => ({
      type: fact.type, caseId: fact.caseId ?? null, evidenceSha256: fact.evidenceSha256,
      inboundTraceparent: parseTraceparent(fact.inboundTraceparent).valid ? fact.inboundTraceparent : null,
      outboundTraceparent: parseTraceparent(fact.outboundTraceparent ?? fact.traceparent).valid ? fact.outboundTraceparent ?? fact.traceparent : null,
      rejectedValuePersistence: 'NEVER', nativeSdkSampled: fact.nativeSdkSampled ?? null,
      nativeSdkRecording: fact.nativeSdkRecording ?? null
    }));
    approvedMetadata = {
      receipt: {
        schema: capture.receipt.schema, sourceKind: capture.receipt.sourceKind, scope: capture.receipt.scope,
        captureId: capture.receipt.captureId, fromUtc: capture.receipt.fromUtc, toUtc: capture.receipt.toUtc,
        capturedAtUtc: capture.receipt.capturedAtUtc, ingestionWatermarkUtc: capture.receipt.ingestionWatermarkUtc,
        querySha256: capture.receipt.querySha256, queryManifestSha256: capture.receipt.queryManifestSha256 ?? null,
        rowCount: capture.receipt.rowCount, tables: capture.receipt.tables,
        tableInventoryComplete: capture.receipt.tableInventoryComplete === true,
        complete: capture.receipt.complete, paginationComplete: capture.receipt.paginationComplete,
        sourceAcceptanceIsCertification: false
      },
      carriers,
      ledger: {
        schema: execution.trafficLedger.schema, observationOrigin: execution.trafficLedger.observationOrigin,
        evidenceSha256: execution.trafficLedger.evidenceSha256,
        workStartedAtUtc: execution.trafficLedger.workStartedAtUtc, workCompletedAtUtc: execution.trafficLedger.workCompletedAtUtc,
        spans: execution.trafficLedger.spans, canaries: execution.trafficLedger.canaries,
        dropped: execution.trafficLedger.dropped, complete: execution.trafficLedger.complete
      },
      configuration: { sourceSnapshot: beforeSources, samplingResult: summary.sampling, privacyPolicySha256: verified.privacy.policySha256 },
      queryOutputs: (execution.nativeFacts ?? []).filter(fact => fact.type === 'business-lookup').map(fact => ({
        type: fact.type, evidenceSha256: fact.evidenceSha256,
        traceIds: fact.traceIds, sourceAcceptanceIsCertification: false
      }))
    };
  } catch (error) {
    summary.result = 'FAIL';
    summary.failure = error instanceof VerificationFailure
      ? { code: error.code, detail: error.message }
      : { code: 'D_ADAPTER_FAILURE', detail: 'Native adapter/checker failed; inspect only approved safe local diagnostics' };
  } finally {
    controller.abort();
    if (prepared && adapter) {
      const cleanupController = new AbortController();
      const cleanupContext = { ...context, signal: cleanupController.signal };
      try {
        await bounded(() => adapter.stopTraffic(cleanupContext), 30, cleanupController);
        const reset = await bounded(() => adapter.reset(cleanupContext, prepared), 120, cleanupController);
        summary.reset = assertReset(prepared, reset);
      } catch {
        summary.result = 'FAIL';
        summary.reset = { result: 'FAIL', reason: 'Stop/reset could not verify actual run-scoped baseline; native watchdog remains required' };
      }
    }
    summary.finishedAtUtc = new Date().toISOString();
  }
  if (recordEvidence) {
    const timestamp = startedAtUtc.replaceAll(/[-:.]/g, '');
    const directory = path.join(outputRoot, `demo-${demoId}`, `${timestamp}-${runId}`);
    await createBoundDirectory(directory);
    await writeFile(path.join(directory, 'result.json'), jsonBytes(summary), { flag: 'wx' });
    await writeFile(path.join(directory, 'capture-status.json'), jsonBytes({
      schema: 'contoso.capture-status.v1', rawOriginalRowsPersisted: false,
      nativeSafeProjectionAvailable: Boolean(approvedRows),
      reason: 'All raw columns are scanned in memory; classified in-memory-only metadata is never written.',
      queryCaptured: Boolean(approvedCapture), applicationMap: 'NOT CAPTURED', transactionDiagnostics: 'NOT CAPTURED'
    }), { flag: 'wx' });
    if (beforeSources) await writeFile(path.join(directory, 'source-snapshot.json'), jsonBytes(beforeSources), { flag: 'wx' });
    if (approvedRows) {
      await writeFile(path.join(directory, 'native-safe-rows.json'), jsonBytes(approvedRows), { flag: 'wx' });
      await writeFile(path.join(directory, 'query.kql'), approvedCapture.queryText, { flag: 'wx' });
      await Promise.all(Object.entries({
        'capture-receipt.json': approvedMetadata.receipt,
        'trusted-carriers.json': approvedMetadata.carriers,
        'native-emission-ledger.json': approvedMetadata.ledger,
        'config-snapshot.json': approvedMetadata.configuration,
        'kql-results.json': approvedMetadata.queryOutputs
      }).map(([file, value]) => writeFile(path.join(directory, file), jsonBytes(value), { flag: 'wx' })));
    }
    await writeManifest(directory, {
      sourceKind: approvedCapture?.receipt.sourceKind ?? 'not-observed',
      sourceAcceptanceIsCertification: false, versionsSha256: sha256(await readBoundFile('VERSIONS.md')),
      startedAtUtc, finishedAtUtc: summary.finishedAtUtc, runId, demoId, mode
    });
    await verifyManifest(directory);
    summary.evidencePath = path.relative(projectRoot, directory);
  }
  return summary;
}

export async function materializeDemos() {
  const { catalog } = await loadCatalog();
  for (const spec of catalog.demos) {
    const directory = path.join(projectRoot, 'demos', spec.id);
    await mkdir(directory, { recursive: true });
    const files = {
      'Run.ps1': `$ErrorActionPreference = 'Stop'\n& node \"$PSScriptRoot\\..\\..\\tools\\verification\\demo.mjs\" --demo ${spec.id} @args\nexit $LASTEXITCODE\n`,
      'Reset.ps1': `$ErrorActionPreference = 'Stop'\n& node \"$PSScriptRoot\\..\\..\\tools\\verification\\demo.mjs\" --reset --demo ${spec.id} @args\nexit $LASTEXITCODE\n`,
      'demo.json': `${JSON.stringify({ schema: 'contoso.demo.v1', demoId: spec.id, catalog: '..\\catalog.json' }, null, 2)}\n`,
      'README.md': `# Contoso Demo ${spec.id}: ${spec.title}\n\n## Purpose\n${spec.purpose} Brief sections: ${spec.brief.join(', ')}.\n\n## Pre-state\nUse an approved native adapter, record actual baseline hashes and a finite sampling lease. VERIFY: approved runtime/control/capture interfaces and external owner evidence; no cloud approval is implied.\n\n## Run\nFrom the POC root: \`powershell -File .\\demos\\${spec.id}\\Run.ps1 --adapter <reviewed-relative-module> --adapter-sha256 <reviewed-hash> --mode LocalValidate\`.\nUse BootstrapValidate only with explicit approved native target/traffic. It remains NOT CERTIFIED. Missing adapters or native evidence fail, never mock PASS.\n\n## Live show\nFilter Application Map and Transaction Diagnostics by the **observed** business/trace IDs; show the native rows and exact boundary edges. See docs\\DEMO_RUNBOOK.md. Uncaptured screenshots remain NOT CAPTURED.\n\n## Evidence and assertion\nThe single root expected-boundary map is expectation only. The runner calls native A/B/C, coverage/privacy/canary and ${spec.assertion} checks, with ${spec.criteria.join(', ')} §24 mappings. Outputs are under evidence\\demo-${spec.id}\\<UTC-run-id>. Original sensitive metadata is never persisted.\n\n## Reset\nThe runner always stops/drains and resets its own run after a captured baseline. Repeat with \`powershell -File .\\demos\\${spec.id}\\Reset.ps1 --pack <relative-evidence-pack> --adapter <reviewed-relative-module> --adapter-sha256 <reviewed-hash>\`. It must prove baseline/flags/seed/owned messages/sampling restoration. It never purges shared or unowned state.\n`
    };
    for (const [name, text] of Object.entries(files)) {
      const file = path.join(directory, name);
      try { await writeFile(file, text, { flag: 'wx' }); }
      catch (error) {
        if (error.code !== 'EEXIST' || await readFile(file, 'utf8') !== text) throw error;
      }
    }
  }
}

async function loadAdapter(name, expectedSha256) {
  if (!name) return null;
  if (!HASH.test(expectedSha256 ?? '')) failure('D_ADAPTER_APPROVAL', 'Explicit reviewed adapter SHA-256 required');
  const relative = relativeFile(name);
  const bytes = await readBoundFile(relative);
  if (sha256(bytes) !== expectedSha256) failure('D_ADAPTER_APPROVAL', 'Reviewed adapter source has changed');
  const module = await import(pathToFileURL(path.join(projectRoot, relative)).href);
  const adapter = typeof module.createAdapter === 'function' ? await module.createAdapter() : module.adapter;
  if (adapter) adapter.sourceSha256 = expectedSha256;
  return adapter;
}

export async function demoMain(args) {
  const options = {};
  const flags = new Set(['--all', '--check', '--materialize', '--reset']);
  const valued = new Set(['--demo', '--mode', '--adapter', '--adapter-sha256', '--pack', '--timeout-seconds']);
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (flags.has(token)) options[token] = true;
    else if (valued.has(token) && args[index + 1] && !args[index + 1].startsWith('--')) options[token] = args[++index];
    else failure('D_ARGUMENT', 'Usage: demo.mjs --check|--materialize|--all|--demo XX [--mode LocalValidate|BootstrapValidate|Certify] [--adapter path --adapter-sha256 hash]');
  }
  if (options['--materialize']) await materializeDemos();
  if (options['--check'] || options['--materialize']) {
    const { catalog } = await loadCatalog();
    for (const spec of catalog.demos) for (const file of ['Run.ps1', 'Reset.ps1', 'demo.json', 'README.md']) await readBoundFile(path.join('demos', spec.id, file));
    console.log(JSON.stringify({ demos: 15, construction: 'RUNNABLE_WRAPPERS', certificationStatus: 'NOT CERTIFIED', nativeExecution: 'REQUIRES_REVIEWED_ADAPTER' }));
    return;
  }
  const adapter = await loadAdapter(options['--adapter'], options['--adapter-sha256']);
  if (options['--reset']) {
    if (!options['--pack'] || !options['--demo']) failure('D_ARGUMENT', 'Reset requires --demo, --pack and the same reviewed adapter');
    const directory = path.join(projectRoot, relativeFile(options['--pack']));
    await verifyManifest(directory);
    const summary = JSON.parse((await readBoundFile('result.json', directory)).toString('utf8'));
    if (summary.demoId !== options['--demo'] || summary.adapterSha256 !== options['--adapter-sha256']) failure('D_RESET', 'Reset target/adapter differs from captured run');
    verifyAdapter(adapter, summary.mode);
    if (typeof adapter.restoreCapturedRun !== 'function') failure('D_MISSING_ADAPTER', 'VERIFY: persisted native baseline restore adapter missing');
    const cleanupController = new AbortController();
    const result = await bounded(() => adapter.restoreCapturedRun({ ...summary, signal: cleanupController.signal }), 120, cleanupController);
    assertReset({ baselineHashes: summary.baselineHashes }, result);
    console.log(JSON.stringify({ demoId: summary.demoId, result: 'PASS', certificationStatus: 'NOT CERTIFIED', reset: 'RUN_ONLY' }));
    return;
  }
  const { catalog } = await loadCatalog();
  const ids = options['--all'] ? catalog.demos.map(spec => spec.id) : [options['--demo']];
  let failed = false;
  for (const demoId of ids) {
    const result = await runDemo({
      demoId, mode: options['--mode'] ?? 'LocalValidate', adapter, adapterPath: options['--adapter'] ?? null,
      timeoutSeconds: Number(options['--timeout-seconds'] ?? 300)
    });
    console.log(JSON.stringify({ demoId, result: result.result, certificationStatus: result.certificationStatus,
      failure: result.failure?.code, evidencePath: result.evidencePath }));
    if (result.result !== 'PASS') failed = true;
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await demoMain(process.argv.slice(2)); }
  catch (error) { console.error(error instanceof VerificationFailure ? error.message : 'Demo construction/adapter unavailable; NOT CERTIFIED'); process.exitCode = 1; }
}
