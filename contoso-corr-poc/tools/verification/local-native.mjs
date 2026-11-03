import { execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { TRACE, SPAN, UUID, HASH } from '../observability/telemetry-contract.mjs';
import { assertAsyncStructure } from '../messaging/async-honesty.mjs';
import { createBoundDirectory, inventoryFiles, jsonBytes, projectRoot, readBoundFile, relativeFile, sha256, writeManifest } from './files.mjs';
import { VerificationFailure } from './invariants.mjs';
import { immutableReceiptMetadata } from './observers.mjs';
import { selectAsyncCaptureReceipts } from './async-capture-receipts.mjs';

const execute = promisify(execFile);
const captures = new WeakMap();
const SOURCE_FILES = [
  'tools\\verification\\local-native.mjs',
  'tools\\verification\\async-capture-receipts.mjs',
  'tools\\verification\\Invoke-LocalAsyncQualification.ps1',
  'tools\\verification\\files.mjs',
  'tools\\verification\\observers.mjs',
  'tools\\verification\\invariants.mjs',
  'tools\\verification\\trust-roots.mjs',
  'tools\\observability\\telemetry-contract.mjs',
  'tools\\observability\\raw-query.mjs',
  'tools\\messaging\\async-honesty.mjs',
  'tools\\java\\Use-Portable.ps1',
  'tools\\java\\Get-Agent.ps1',
  'workers\\messaging-core\\src\\test\\java\\com\\contoso\\messaging\\AsyncNativeAgentTest.java',
  'workers\\messaging-core\\src\\test\\java\\com\\contoso\\messaging\\NativeTestCapture.java',
  'workers\\messaging-core\\src\\test\\java\\com\\contoso\\messaging\\NativeTestCaptureTest.java',
  'workers\\messaging-core\\docs\\native-intake-source-freeze.v2.json',
  'workers\\messaging-core\\docs\\notify-native-source-freeze.v2.json',
  'tools\\security\\native-payload.mjs', 'tools\\security\\Scan-NativePayloads.mjs',
  'tools\\security\\values.mjs', 'tools\\security\\native-payload-source-freeze.v3.json',
  'workers\\messaging-core\\src\\test\\java\\com\\contoso\\messaging\\AsyncNativeProbe.java',
  'workers\\messaging-core\\src\\test\\java\\com\\contoso\\messaging\\LocalCarrierTransport.java',
  'workers\\messaging-core\\src\\test\\java\\com\\contoso\\messaging\\MessagingFixture.java',
  'config\\versions.lock.json', 'pom.xml', 'workers\\messaging-core\\pom.xml',
  'services\\correlation-core\\pom.xml', 'services\\inventory-data\\pom.xml',
  'extensions\\parent-safe-sampler\\pom.xml'
];
const SOURCE_DIRECTORIES = [
  'workers\\messaging-core\\src\\main', 'workers\\messaging-core\\src\\test', 'services\\correlation-core\\src\\main',
  'services\\inventory-data\\src\\main', 'extensions\\parent-safe-sampler\\src\\main'
];
const fail = (code, detail) => { throw new VerificationFailure(code, detail); };
const contextKey = value => `${value.traceId}:${value.spanId}`;

export function checkLocalInspectionBinding(declaredSha256, bytes) {
  if (typeof declaredSha256 !== 'string' || !HASH.test(declaredSha256) ||
      !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 16 * 1024 * 1024 ||
      sha256(bytes) !== declaredSha256) {
    fail('E_LOCAL_BINARY_EVIDENCE', 'Current proof must bind the actual approved sibling inspection bytes');
  }
  return Object.freeze({ inspectionSha256: declaredSha256, sourceAcceptanceIsCertification: false });
}

export function describeOwnedRuntimeClasspath(xml) {
  const properties = new Map();
  for (const match of xml.matchAll(/<property\b[^>]*\/>/g)) {
    const name = /\bname="([^"]*)"/.exec(match[0])?.[1];
    const value = /\bvalue="([^"]*)"/.exec(match[0])?.[1];
    if (name && value !== undefined) properties.set(name, value);
  }
  const property = properties.has('surefire.test.class.path') ? 'surefire.test.class.path' : 'java.class.path';
  const encoded = properties.get(property);
  if (!encoded) fail('E_LOCAL_BINARY_EVIDENCE', 'Actual fresh Surefire child classpath is missing');
  const decode = value => value.replaceAll('&quot;', '"').replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const entries = decode(encoded).split(';');
  const names = ['contoso-correlation-core', 'inventory-data'];
  const ownedLibraries = names.map(name => {
    const values = entries.filter(value => new RegExp(`^${name}-[0-9][^\\\\/]*\\.jar$`).test(path.win32.basename(value)));
    if (values.length !== 1 || !path.win32.isAbsolute(values[0])) {
      fail('E_LOCAL_BINARY_EVIDENCE', 'One declared owned library per module is required; no source/build lineage is inferred');
    }
    return { module: name, classpathPath: values[0], file: path.win32.basename(values[0]) };
  });
  return immutableReceiptMetadata({ sourceExecutionBinding: 'UNVERIFIED', property, ownedLibraries,
    loadedCodeSourceVerified: false, currentSourceQualification: false,
    scope: 'Classpath declarations only; not source/build/loaded-code provenance' });
}

async function recordOwnedRuntimeClasspathFiles(xml) {
  const description = describeOwnedRuntimeClasspath(xml);
  const files = await Promise.all(description.ownedLibraries.map(async value => ({
    ...value, postExecutionFileSha256: sha256(await readFile(value.classpathPath)),
    sourceBuildLineage: 'UNVERIFIED', loadedCodeSourceVerified: false
  })));
  return immutableReceiptMetadata({ ...description, files, observedAfterExecutionOnly: true });
}

async function snapshot() {
  const files = [...SOURCE_FILES];
  for (const directory of SOURCE_DIRECTORIES) {
    files.push(...(await inventoryFiles(path.join(projectRoot, directory))).map(file => path.join(directory, file)));
  }
  return Promise.all([...new Set(files)].sort().map(async file => ({ path: file, sha256: sha256(await readBoundFile(file)) })));
}

async function extensionIdentity() {
  const lock = JSON.parse((await readBoundFile('config\\versions.lock.json')).toString('utf8'));
  const entries = lock.extensions?.filter(entry => entry.module === 'extensions/parent-safe-sampler') ?? [];
  const extension = entries[0];
  if (entries.length !== 1 || !HASH.test(lock.agent?.sha256 ?? '') || !HASH.test(extension?.sha256 ?? '') ||
      !/^\d+\.\d+\.\d+$/.test(extension.version ?? '') || extension.sdkAbi !== lock.agent.api ||
      extension.file !== `target/${extension.artifactId}-${extension.version}.jar` || !extension.guardPolicy) {
    fail('E_LOCAL_ARTIFACT', 'One exact current lock artifact/file/version/ABI is required before execution');
  }
  const file = path.join(relativeFile(extension.module), relativeFile(extension.file));
  if (sha256(await readBoundFile(file)) !== extension.sha256) fail('E_LOCAL_ARTIFACT', 'Actual current extension bytes differ from the sole lock');
  return { file, groupId: extension.groupId, artifactId: extension.artifactId, version: extension.version,
    sha256: extension.sha256, sdkAbiConfigured: extension.sdkAbi, expectedGuardPolicy: extension.guardPolicy,
    agentSha256: lock.agent.sha256 };
}

export function checkLocalNativeCorrespondence(proof, inspection, expectedAgentSha256) {
  if (proof?.schemaVersion !== 1 || proof.evidenceKind !== 'real-local-agent-loopback' || proof.certified !== false ||
      !HASH.test(expectedAgentSha256 ?? '') || proof.agentSha256 !== expectedAgentSha256 ||
      !Array.isArray(proof.spans) || !proof.spans.length || !Array.isArray(inspection) ||
      inspection.length !== proof.spans.length) fail('E_LOCAL_NATIVE_SCHEMA', 'Complete current native proof/inspection correspondence is required');
  const observed = new Map();
  const nativeSpanIds = new Set();
  for (const row of inspection) {
    if (!row || !TRACE.test(row.traceId ?? '') || !SPAN.test(row.id ?? '') || nativeSpanIds.has(row.id) ||
        typeof row.parentId !== 'string' || row.parentId && !SPAN.test(row.parentId) ||
        !row.properties || typeof row.properties !== 'object' || Array.isArray(row.properties)) {
      fail('E_LOCAL_NATIVE_IDENTITY', 'Native repeated/invalid spans cannot be deduplicated or omitted');
    }
    nativeSpanIds.add(row.id);
    observed.set(`${row.traceId}:${row.id}`, row);
  }
  const identities = new Set();
  const spans = proof.spans.map(value => {
    if (!value || !TRACE.test(value.traceId ?? '') || !SPAN.test(value.spanId ?? '') || identities.has(contextKey(value)) ||
        !['SERVER', 'CLIENT', 'INTERNAL', 'CONSUMER', 'PRODUCER'].includes(value.kind) ||
        !['contoso-fulfillment-worker', 'contoso-notify-worker'].includes(value.roleName) ||
        !UUID.test(value.businessInvocationId ?? '') ||
        typeof value.parentSpanId !== 'string' || value.parentSpanId && !SPAN.test(value.parentSpanId) ||
        !Array.isArray(value.links)) fail('E_LOCAL_NATIVE_IDENTITY', 'Actual native identities/kinds/role must remain unmodified');
    identities.add(contextKey(value));
    const native = observed.get(contextKey(value));
    if (!native || native.name !== value.name || native.parentId !== value.parentSpanId ||
        native.properties['contoso.span.kind'] !== value.kind ||
        native.properties['business.invocation_id'] !== value.businessInvocationId ||
        (native.properties['contoso.message.id'] ?? '') !== value.messageId ||
        (native.properties['contoso.process.attempt'] ?? '') !== value.attempt) {
      fail('E_LOCAL_NATIVE_CORRESPONDENCE', 'Actual native name/parent/kind/identity/attempt differs from source proof');
    }
    let links;
    try { links = native.properties['_MS.links'] ? JSON.parse(native.properties['_MS.links']) : []; }
    catch { fail('E_LOCAL_NATIVE_LINK', 'Malformed actual native links cannot be replaced by proof links'); }
    if (!Array.isArray(links) || links.length > 32 || links.length !== value.links.length) {
      fail('E_LOCAL_NATIVE_LINK', 'Every bounded native link must correspond exactly once');
    }
    const linkKey = link => {
      if (!link || !TRACE.test(link.operation_Id ?? '') || !SPAN.test(link.id ?? '') ||
          `${link.operation_Id}:${link.id}` === contextKey(value)) fail('E_LOCAL_NATIVE_LINK', 'Actual links require valid non-self contexts');
      return `${link.operation_Id}:${link.id}`;
    };
    const actualKeys = links.map(linkKey);
    const proofKeys = value.links.map(linkKey);
    if (new Set(actualKeys).size !== actualKeys.length || new Set(proofKeys).size !== proofKeys.length ||
        JSON.stringify(actualKeys.sort()) !== JSON.stringify(proofKeys.sort())) {
      fail('E_LOCAL_NATIVE_LINK', 'Native/proof contributor identities differ or repeat');
    }
    const count = native.properties['contoso.link.count'];
    if (count !== undefined && (!/^(?:0|[1-9]\d*)(?:\.0+)?$/.test(count) || Number(count) !== links.length)) {
      fail('E_LOCAL_NATIVE_LINK', 'Observed native link-count attribute differs from its actual representation');
    }
    return { ...value, properties: native.properties };
  });
  return immutableReceiptMetadata({
    checkerOnly: true, sourceAcceptanceIsCertification: false, spans,
    roleCorrespondence: 'PRESERVED_PROOF_ROLES_NO_ROLE_COLUMN_IN_SIDECAR',
    independentlyVerifiedNativeRoles: false
  });
}

async function stopOwnedTree(pid) {
  if (!Number.isInteger(pid) || pid < 1) return;
  await execute('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
    `function Stop-Owned([int]$processId) { Get-CimInstance Win32_Process -Filter ("ParentProcessId=" + $processId) | ForEach-Object { Stop-Owned ([int]$_.ProcessId) }; Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }; Stop-Owned ${pid}`],
  { cwd: projectRoot, windowsHide: true, timeout: 15000 }).catch(() => {});
}

export async function executeLocalAsyncQualification() {
  const sources = await snapshot();
  const artifact = await extensionIdentity();
  const startedAtUtc = new Date().toISOString();
  const started = Date.now();
  const run = execute('pwsh', ['-NoProfile', '-NonInteractive', '-File',
    path.join(projectRoot, 'tools', 'verification', 'Invoke-LocalAsyncQualification.ps1')], {
    cwd: projectRoot, windowsHide: true, maxBuffer: 2 * 1024 * 1024
  });
  let timer;
  let stopping;
  let completed;
  try {
    completed = await Promise.race([run, new Promise((_, reject) => {
      timer = setTimeout(() => {
        stopping = stopOwnedTree(run.child?.pid);
        reject(new VerificationFailure('E_LOCAL_DEADLINE', 'Actual native qualification exceeded the bounded window'));
      }, 240000);
    })]);
  } catch (error) {
    if (stopping) await stopping;
    if (error instanceof VerificationFailure) throw error;
    fail('E_LOCAL_EXECUTION', 'Actual native Maven/JVM qualification failed; no source authority or PASS is minted');
  } finally { clearTimeout(timer); }
  if (JSON.stringify(sources) !== JSON.stringify(await snapshot())) fail('E_LOCAL_DRIFT', 'Source changed during actual native execution');
  if (JSON.stringify(artifact) !== JSON.stringify(await extensionIdentity())) fail('E_LOCAL_DRIFT', 'Actual current artifact identity changed during execution');
  const selected = selectAsyncCaptureReceipts(completed.stdout);
  if (!selected.nativeProof || selected.linkedQualification) fail('E_LOCAL_EXECUTION', 'Actual selected test must publish exactly one new native-proof receipt');
  const proofFile = path.join(projectRoot, selected.nativeProof.path);
  const directory = path.dirname(proofFile);
  const inspectionFile = path.join(directory, 'native-safe-inspection.json');
  for (const file of [proofFile, inspectionFile]) {
    const times = await stat(file);
    if (times.birthtimeMs < started || times.mtimeMs < started) fail('E_LOCAL_STALE', 'New actual epoch proof and sibling inspection must both be created during the R9-launched run');
  }
  const proofBytes = await readBoundFile(path.relative(projectRoot, proofFile));
  if (sha256(proofBytes) !== selected.nativeProof.sha256) fail('E_LOCAL_BINARY_EVIDENCE', 'Actual stdout receipt does not bind the final new proof bytes');
  const inspectionBytes = await readBoundFile(path.relative(projectRoot, inspectionFile));
  const proof = JSON.parse(proofBytes.toString('utf8'));
  const inspection = JSON.parse(inspectionBytes.toString('utf8'));
  checkLocalInspectionBinding(proof.nativeSafeInspectionSha256, inspectionBytes);
  const report = path.join(projectRoot, 'workers', 'messaging-core', 'target', 'surefire-reports', 'TEST-com.contoso.messaging.AsyncNativeAgentTest.xml');
  if ((await stat(report)).mtimeMs < started) fail('E_LOCAL_STALE', 'Current actual native JUnit execution receipt missing');
  const xml = await readFile(report, 'utf8');
  const suite = /<testsuite\b[^>]*>/.exec(xml)?.[0] ?? '';
  if (!/\btests="1"/.test(suite) || !/\bfailures="0"/.test(suite) ||
      !/\berrors="0"/.test(suite) || !/\bskipped="0"/.test(suite)) fail('E_LOCAL_EXECUTION', 'Native qualifier did not run its real agent assertion');
  const runtimeClasspath = await recordOwnedRuntimeClasspathFiles(xml);
  const { spans, roleCorrespondence, independentlyVerifiedNativeRoles } =
    checkLocalNativeCorrespondence(proof, inspection, artifact.agentSha256);
  const capability = Object.freeze(Object.create(null));
  captures.set(capability, immutableReceiptMetadata({
    spans, sources, artifact, runtimeClasspath, roleCorrespondence, independentlyVerifiedNativeRoles,
    agentSha256: proof.agentSha256, proofSha256: sha256(proofBytes),
    inspectionSha256: sha256(inspectionBytes), junitSha256: sha256(xml),
    actualPrintedProofReceipt: selected.nativeProof,
    siblingInspectionReceiptStatus: 'INDEPENDENT_R9_BYTE_HASH_MATCHED_CURRENT_PROOF_SIDECAR_DECLARATION',
    startedAtUtc, finishedAtUtc: new Date().toISOString(),
    sourceExecutionBinding: 'UNVERIFIED',
    scope: 'Actual R9-launched bounded compiled-binary algorithm slice with one agent per source-defined JVM; selected installed owned-library source/build lineage UNVERIFIED. Source snapshots prove immutability only, not executed-source provenance. H2 PostgreSQL-mode/in-memory carriers; NOT current-source/Azure/broker/Functions/full-map/privacy certification'
  }));
  return capability;
}

export function assertLocalNativeAsync(capability) {
  const capture = captures.get(capability);
  if (!capture) fail('E_LOCAL_AUTHORITY', 'Caller file/origin/bool/hash cannot mint actual local execution authority');
  const spans = capture.spans;
  const byContext = new Map(spans.map(span => [contextKey(span), span]));
  const native = span => ({
    traceId: span.traceId, spanId: span.spanId, parentSpanId: span.parentSpanId || null,
    operation: span.kind === 'CONSUMER' ? 'PROCESS' : span.properties['messaging.operation.name'],
    attempt: Number(span.attempt), businessInvocationId: span.businessInvocationId,
    messageId: span.messageId, originalMessageId: span.properties['contoso.original.message.id'],
    outcome: span.properties['contoso.outcome'], semanticKind: span.kind,
    links: span.links.map(link => ({ traceId: link.operation_Id, spanId: link.id }))
  });
  const completed = spans.filter(span => span.name === 'contoso.fulfillment.process' && span.properties['contoso.outcome'] === 'SUCCESS');
  const terminal = completed.find(span => spans.filter(item => item.name === span.name && item.messageId === span.messageId).length === 3);
  if (!terminal) fail('E_LOCAL_RETRY', 'Actual three-attempt successful native retry cohort missing');
  const attempts = spans.filter(span => span.name === terminal.name && span.messageId === terminal.messageId).map(native);
  const replay = spans.find(span => span.name === 'contoso.replay.send');
  const originalLink = replay?.links[0];
  const original = originalLink && byContext.get(`${originalLink.operation_Id}:${originalLink.id}`);
  const aggregate = spans.find(span => span.name === 'contoso.fanin.process' && span.kind === 'INTERNAL' && !span.parentSpanId);
  const batch = spans.find(span => span.name === 'contoso.eventhubs.batch.process' && !span.parentSpanId && span.links.length);
  if (!replay || !original || !aggregate || !batch) fail('E_LOCAL_NATIVE_COVERAGE', 'Actual replay/INTERNAL fan-in/mixed batch contexts missing');
  for (const item of [replay, aggregate, batch]) for (const link of item.links) {
    if (!byContext.has(`${link.operation_Id}:${link.id}`)) fail('E_LOCAL_NATIVE_LINK', 'Actual linked contributor is absent; no expected context may be inserted');
  }
  const aggregateWorkflow = aggregate.properties['contoso.workflow.id'];
  const processContributors = spans.filter(span => span.properties['contoso.workflow.id'] === aggregateWorkflow &&
    ['FULFILLMENT', 'NOTIFY'].includes(span.properties['contoso.branch']) && span.kind === 'CONSUMER' &&
    ['contoso.fulfillment.process', 'contoso.notify.process'].includes(span.name));
  const processKeys = new Set(processContributors.map(contextKey));
  const resultContributors = spans.filter(span => span.properties['contoso.workflow.id'] === aggregateWorkflow &&
    span.kind === 'PRODUCER' && !span.parentSpanId && span.links.length === 1 &&
    processKeys.has(`${span.links[0].operation_Id}:${span.links[0].id}`));
  const contributors = [...processContributors, ...resultContributors];
  if (!aggregateWorkflow || contributors.length !== 4) fail('E_LOCAL_CONTRIBUTORS', 'Actual independent branch PROCESS/result SEND contexts missing; link list cannot define its own expected contributors');
  const batchContributors = spans.filter(span => span.kind === 'PRODUCER' && span.name === 'contoso.eventhubs.send');
  if (batchContributors.length !== 2) fail('E_LOCAL_CONTRIBUTORS', 'Actual independent mixed batch producer contexts missing');
  const structure = {
    maxLinks: 32, retries: [{ attempts, expected: {
      expectedAttempts: 3, injectedFailures: 2, terminalOutcome: 'SUCCESS',
      traceId: terminal.traceId, parentSpanId: terminal.parentSpanId,
      businessInvocationId: terminal.businessInvocationId, messageId: terminal.messageId
    } }],
    replays: [{ observed: native(replay), original: native(original) }],
    aggregates: [{ observed: native(aggregate), persistedContributors: contributors.map(native) }],
    batches: [{ observed: native(batch), contributors: batchContributors.map(native) }]
  };
  assertAsyncStructure(structure);
  return {
    schema: 'contoso.local-native-async-result.v1', result: 'PASS',
    sourceKind: 'real-local-agent-loopback', certificationStatus: 'NOT CERTIFIED',
    sourceAcceptanceIsCertification: false, scope: capture.scope,
    sourceExecutionBinding: capture.sourceExecutionBinding,
    currentSourceQualification: false,
    runtimeClasspath: capture.runtimeClasspath,
    sourceSnapshotPurpose: 'Before/after input-tree immutability ONLY; installed owned-library build/loaded-code lineage is not proved',
    sources: capture.sources, agentSha256: capture.agentSha256, artifact: capture.artifact,
    proofSha256: capture.proofSha256, inspectionSha256: capture.inspectionSha256, junitSha256: capture.junitSha256,
    startedAtUtc: capture.startedAtUtc, finishedAtUtc: capture.finishedAtUtc, spans: spans.length,
    retryAttempts: attempts.length, replayLinks: replay.links.length, fanInLinks: aggregate.links.length,
    batchLinks: batch.links.length, actualRoles: [...new Set(spans.map(span => span.roleName))],
    roleCorrespondence: capture.roleCorrespondence,
    independentlyVerifiedNativeRoles: capture.independentlyVerifiedNativeRoles,
    azureNativeAcceptance: 'NOT RUN', fullPathCoverage: 'NOT RUN', globalTelemetryPrivacy: 'NOT RUN',
    completePersistedContributorLedger: 'NOT RUN — independently observed native contexts; H2 durable effects asserted by actual source driver, no Azure/PG actor proof'
  };
}

export async function localNativeMain() {
  const capability = await executeLocalAsyncQualification();
  const result = assertLocalNativeAsync(capability);
  const directory = path.join(projectRoot, 'evidence', 'verification', 'local-native', `${new Date().toISOString().replaceAll(/[-:.]/g, '')}-${randomUUID()}`);
  await createBoundDirectory(directory);
  await writeFile(path.join(directory, 'result.json'), jsonBytes(result), { flag: 'wx' });
  await writeManifest(directory, { sourceKind: result.sourceKind, sourceAcceptanceIsCertification: false,
    startedAtUtc: result.startedAtUtc, finishedAtUtc: result.finishedAtUtc });
  console.log(JSON.stringify({ result: result.result, sourceKind: result.sourceKind, certificationStatus: result.certificationStatus,
    spans: result.spans, retryAttempts: result.retryAttempts, fanInLinks: result.fanInLinks,
    evidencePath: path.relative(projectRoot, directory) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await localNativeMain(); }
  catch (error) { console.error(error instanceof VerificationFailure ? error.message : 'Actual local native qualification failed; NOT CERTIFIED'); process.exitCode = 1; }
}
