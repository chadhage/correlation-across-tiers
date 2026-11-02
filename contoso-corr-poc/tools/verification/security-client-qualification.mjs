import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { canonicalSpanId, TRACE, SPAN } from '../observability/telemetry-contract.mjs';
import { checkHeaderIsolation, checkUsedIdentityScope, jarMemberSha256 } from '../security/av23-check.mjs';
import { createBoundDirectory, jsonBytes, projectRoot, readBoundFile, sha256, writeManifest } from './files.mjs';
import { snapshotQualificationMetadata } from './sampling-qualification.mjs';

const receipts = new WeakMap();
// This is the one parent-authorized, actually executed A/B epoch, not an enrollment API.
const epoch = Object.freeze({
  build: 'evidence\\java-local\\source-builds\\20261101T182202080Z-client-security-652c7229-6b6a-4dae-85a5-575eeee113cd\\source-build.json',
  buildSha256: '8412700a7792eea3b1cf8dc7a321fd71aff16eb5762e3c2985695eb47589611b',
  native: 'services\\security-core\\docs\\av23-java-client-output-parent-20261101T182444029Z.json',
  nativeSha256: 'b380966e1858f455348dd9bbf071fb76f432ed664367f817a9ab860d8028742e',
  freeze: 'services\\security-core\\docs\\native-client-source-freeze.v1.json',
  freezeSha256: '79f81525aec2b4a9e4d9c34d51d58667839476451dad1f32808f8830bcdad1a7',
  sourceTreeSha256: 'fc8ba4b73f15a7b00e3333275a7c25f4d13370959e421b9ccdb3a35ad1383548',
  artifact: 'services\\security-core\\target\\security-core-1.0.0.jar',
  artifactSha256: 'e58d5143a2484f3d0f2a75c48126a2882b89dc3dc4ab2d68034105653288cc87',
  wrapperMemberSha256: '1cd2cd278faf1889e43749b7d00c6cacc88ec29103d35fae042f421aeab50a76',
  sdkSha256: '42f41cc327176141f258c00d5bdfe8e20c5bb599e3efc60df2ea1e2fcca26207',
  sdkMemberSha256: 'e7c68a59fb6206d315579ac6a834caacc2ee092ee37613316aeebcc3dd770b43',
  probeSource: 'services\\security-core\\src\\test\\java\\com\\contoso\\security\\AuthPropagationProbe.java',
  probeSourceSha256: 'da3363eee98e544e05cd65fe6b20ae18327ff7e898b13e1e20b4c80bfc2df1b6',
  probeDirectory: 'services\\security-core\\target\\r8-av23\\classes',
  probeClassSha256: '543f0d73f1dc2a2ae7c179f7145057b74833be327e01232e0a7972b43515b4aa',
  checker: 'tools\\security\\av23-check.mjs',
  checkerSha256: 'd9daf0ee1a4e7254349bc6e0e0b02d101adcf04e6c0d9eaccfe050ec4ff18882',
  compilerPid: 62968,
  childPid: 61972
});
const toolRoot = path.resolve(projectRoot, '..', '..', '..', '.copilot', 'session-state',
  'a2820816-7000-4e63-9cf2-cd2c8da2162f', 'files', 'tools', 'r4');
const sdkFile = path.join(toolRoot, 'm2', 'com', 'azure', 'azure-core-http-okhttp', '1.13.8',
  'azure-core-http-okhttp-1.13.8.jar');
const fail = detail => { throw Object.assign(new Error(detail), { code: 'E_SECURITY_EPOCH' }); };
const check = (condition, detail) => { if (!condition) fail(detail); };
const digestTree = sources => sha256(Buffer.from(JSON.stringify(sources)));
const sameFile = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
const fromUri = value => {
  try { return fileURLToPath(value); }
  catch { fail('Actual public file CodeSource is required'); }
};
const safeTime = value => typeof value === 'string' && value.endsWith('Z') && Number.isFinite(Date.parse(value));

export function checkSelectedSecurityEpoch(candidate) {
  const { build: a, native: b } = snapshotQualificationMetadata(candidate);
  check(a?.schema === 'contoso.parent-java-source-build.v1' && a.module === 'services\\security-core' &&
    a.scope === 'actual-selected-owned-module-clean-build' && a.result === 'PASS' && a.certified === false &&
    a.exitCode === 0 && a.tests === 32 && a.failures === 0 && a.errors === 0 && a.skipped === 0,
  'Actual selected clean-build and successful non-skipped JUnit scope required');
  check(Array.isArray(a.beforeSources) && Array.isArray(a.afterSources) && a.beforeSources.length === 28 &&
    a.afterSources.length === 28 && new Set(a.beforeSources.map(s => s.path)).size === 28 &&
    new Set(a.afterSources.map(s => s.path)).size === 28 && a.sourcesStable === true &&
    a.beforeSourcesSha256 === epoch.sourceTreeSha256 && a.afterSourcesSha256 === epoch.sourceTreeSha256 &&
    digestTree(a.beforeSources) === epoch.sourceTreeSha256 && digestTree(a.afterSources) === epoch.sourceTreeSha256,
  'Exact original before/after source closure cannot be omitted, duplicated or recomputed into a weaker closure');
  check(a.afterSources.some(s => s.path === epoch.probeSource && s.sha256 === epoch.probeSourceSha256) &&
    a.producedArtifact?.path === epoch.artifact && a.producedArtifact.sha256 === epoch.artifactSha256 &&
    a.producedArtifact.bytes === 50595, 'Current changed test source and produced Security artifact must be bound');
  check(safeTime(a.startedAtUtc) && safeTime(a.finishedAtUtc) && Date.parse(a.startedAtUtc) < Date.parse(a.finishedAtUtc) &&
    a.launcherPid === 5244 && a.executionId === 'b3bd6eb1-890f-4ff5-88da-723880603515' &&
    Array.isArray(a.mavenJavaObservations) && a.mavenJavaObservations.length === 1 &&
    a.mavenJavaObservations[0].pid === 62088 && a.mavenJavaObservations[0].parentPid === a.launcherPid &&
    sameFile(a.mavenJavaObservations[0].executable, a.toolchain.java) &&
    Date.parse(a.mavenJavaObservations[0].createdAtUtc) >= Date.parse(a.startedAtUtc) &&
    Date.parse(a.mavenJavaObservations[0].observedAtUtc) <= Date.parse(a.finishedAtUtc) &&
    /clean package/.test(a.command) && /Apache Maven 3\.10\.0/.test(a.toolchain.versions) &&
    /Java version: 25\.0\.5/.test(a.toolchain.versions), 'Original Maven tool/PID/parent/time execution witness required');
  check(Array.isArray(a.suites) && a.suites.length === 6 &&
    a.suites.reduce((sum, s) => sum + s.tests, 0) === 32 &&
    a.suites.every(s => s.failures === 0 && s.errors === 0 && s.skipped === 0),
  'Actual selected JUnit suite accounting must agree');
  check(b?.schema === 'contoso.av23-java-wire.v3' && b.sourceKind === 'real-local-agent-loopback' &&
    b.result === 'PASS' && b.exitCode === 0 && b.qualified === true && b.mode === 'header_isolation_only' &&
    b.headerPolicyVersion === 1 && b.sourceAcceptanceIsCertification === false && b.rawOutputRetained === false &&
    b.agentSha256 === '93a70c8f5d364c7e777f6c4d1b235dba91aef8448bd3fa94359f1d7f3e2eb0ec' &&
    b.extensionSha256 === 'bb829be676bdc86e9a0657391764a419c7665c47542c2e53f64c37761f45193f' &&
    b.guardArtifactVersion === '1.1.0' && b.sdkAbi === '1.65.0' && b.guardLoadedFromFrozenBytes === true &&
    b.guardPolicy === 'DROP_VALID_UNSAMPLED_PARENT_AND_ALL_VALID_UNSAMPLED_LINKS',
  'Only the witnessed current header-only native epoch is eligible, not historical failures or header-only v2');
  check(b.securityArtifactSha256Before === epoch.artifactSha256 &&
    b.securityArtifactSha256After === epoch.artifactSha256 && b.securityArtifactStable === true &&
    b.pid === epoch.childPid && safeTime(b.processStartUtc) && safeTime(b.observedAtUtc) &&
    safeTime(b.capturedAtUtc) && Date.parse(a.finishedAtUtc) < Date.parse(b.processStartUtc) &&
    Date.parse(b.processStartUtc) < Date.parse(b.observedAtUtc) &&
    Date.parse(b.observedAtUtc) <= Date.parse(b.capturedAtUtc), 'Native child/artifact/execution window binding required');
  const compile = b.probeCompilation;
  check(compile?.verified === true && compile.compilerPid === epoch.compilerPid && compile.compilerExitCode === 0 &&
    safeTime(compile.compilerStartedAtUtc) && safeTime(compile.compilerEndedAtUtc) &&
    Date.parse(a.finishedAtUtc) < Date.parse(compile.compilerStartedAtUtc) &&
    Date.parse(compile.compilerStartedAtUtc) < Date.parse(compile.compilerEndedAtUtc) &&
    Date.parse(compile.compilerEndedAtUtc) <= Date.parse(b.processStartUtc) &&
    sameFile(compile.compilerExecutable, a.toolchain.javac) &&
    compile.compilerExecutableSha256 === a.toolchain.javacSha256 &&
    compile.sourceSha256Before === epoch.probeSourceSha256 && compile.sourceSha256After === epoch.probeSourceSha256 &&
    compile.classResourceSha256 === epoch.probeClassSha256 &&
    compile.compiledClassSha256Before === epoch.probeClassSha256 &&
    compile.compiledClassSha256After === epoch.probeClassSha256 &&
    sameFile(fromUri(compile.actualCodeSource), path.join(projectRoot, epoch.probeDirectory)) &&
    Array.isArray(compile.compilerArguments) && compile.compilerArguments.length === 5 &&
    compile.compilerArguments[0] === '-cp' && compile.compilerArguments[2] === '-d' &&
    sameFile(compile.compilerArguments[3], path.join(projectRoot, epoch.probeDirectory)) &&
    sameFile(compile.compilerArguments[4], path.join(projectRoot, epoch.probeSource)) &&
    compile.productionModuleRebuilt === false && compile.widerSourceBuildLineageClaimed === false,
  'Separate actual current test-probe compiler/source/class/CodeSource witness required');
  check(b.checkerSha256 === epoch.checkerSha256 && b.probeSourceSha256 === epoch.probeSourceSha256 &&
    b.nativeCollectorSha256Before === '8166b4d3d7485d069aea69f717a0b046e67c6e0d19d140f3705635231eed5195' &&
    b.nativeCollectorSha256After === b.nativeCollectorSha256Before &&
    b.harnessSha256 === '5b486c0d0f4d7693be7ea3f8691abf757cebb87c33f36cd5acd4c320ac39d279',
  'Actual native collector/helper/extra imported checker source binding required');
  check(checkHeaderIsolation(b, b.wireHeaderPresence).verified &&
    b.authHeadersAbsent === true && b.rawNativeInterceptorPresent === true && b.trustedPropagationObserved === true &&
    b.trustedParentAdvanced === true && b.retryObserved === true, 'Both original header controls and trusted/retry observations are required');
  const used = checkUsedIdentityScope(b, b.wireHeaderPresence, {
    securityArtifactUri: pathToFileURL(path.join(projectRoot, epoch.artifact)).href,
    securityArtifactSha256: epoch.artifactSha256, wrapperMemberSha256: epoch.wrapperMemberSha256,
    sdkArtifactUri: pathToFileURL(sdkFile).href, sdkArtifactSha256: epoch.sdkSha256,
    sdkMemberSha256: epoch.sdkMemberSha256, childPid: epoch.childPid
  });
  check(used.verified && used.logicalIdentitySendCalls === 2 && used.physicalIdentityWireAttempts === 3,
    'Actual USED wrapper/SDK origin/member/PID binding and distinct logical/physical counts required');
  const output = b.identityClientOutput;
  const root = output?.actualRootContext;
  const records = output?.safeNativeClientProjection;
  check(output?.schema === 'contoso.identity-client-output.v1' && output.verified === true &&
    Array.isArray(records) && records.length === 3 && TRACE.test(root?.traceId ?? '') && SPAN.test(root?.spanId ?? '') &&
    output.nativePayloadsReceived === 2 && output.nativeEnvelopesReceived === 12 &&
    output.rawPayloadRetained === false && output.fullExporterCompletenessVerified === false &&
    output.globalRawTelemetrySafetyVerified === false && output.independentProducerAuthorityVerified === false &&
    output.spanCountsEqualPhysicalAttemptsClaimed === false, 'Positive bounded native projection must not claim global completeness/privacy/authority');
  const ids = new Set(), ordinals = new Set();
  for (const record of records) {
    check(record.nativeBaseType === 'RemoteDependencyData' && ['Http', 'HTTP'].includes(record.nativeDependencyType) &&
      record.nativeRoleName === 'contoso-av23-probe' && ['jwks', 'managed-identity'].includes(record.route) &&
      record.nativeTraceId === root.traceId && record.traceId === root.traceId &&
      record.nativeParentId === root.spanId && record.parentSpanId === root.spanId &&
      canonicalSpanId(record.nativeSpanId, record.nativeTraceId) === record.spanId &&
      SPAN.test(record.spanId ?? '') && record.spanId !== root.spanId && !ids.has(record.spanId) &&
      Number.isSafeInteger(record.nativeEnvelopeOrdinal) && record.nativeEnvelopeOrdinal >= 0 &&
      record.nativeEnvelopeOrdinal < output.nativeEnvelopesReceived && !ordinals.has(record.nativeEnvelopeOrdinal) &&
      safeTime(record.nativeTimeUtc) && Date.parse(record.nativeTimeUtc) >= Date.parse(b.processStartUtc) &&
      Date.parse(record.nativeTimeUtc) <= Date.parse(b.observedAtUtc),
    'Actual native type/IDs/direct published root parent/trace/time/ordinal must remain unchanged');
    ids.add(record.spanId);
    ordinals.add(record.nativeEnvelopeOrdinal);
  }
  const counts = { jwks: records.filter(r => r.route === 'jwks').length,
    managedIdentity: records.filter(r => r.route === 'managed-identity').length };
  check(counts.jwks === 1 && counts.managedIdentity === 2 &&
    output.nativeIdentityClientSpanCounts?.jwks === counts.jwks &&
    output.nativeIdentityClientSpanCounts?.managedIdentity === counts.managedIdentity &&
    output.logicalIdentitySendCalls === 2 && output.physicalIdentityWireAttempts === 3,
  'Native counts must be recomputed from actual records, not forced equal to sends/retries');
  return Object.freeze({ scope: 'STRUCTURAL_ONLY_NO_AUTHORITY', authorityGranted: false,
    sourceAcceptanceIsCertification: false, counts: Object.freeze(counts) });
}

export function validateSecurityFreezeSources(freeze) {
  const groups = ['changedSourcesFromRepositoryRoot', 'importedPureSourcesFromRepositoryRoot',
    'unchangedProductionSourcesFromRepositoryRoot', 'immutablePriorEpochsFromRepositoryRoot'];
  check(freeze?.schema === 'contoso.r8-native-client-source-freeze.v1' &&
    groups.every((group, i) => Array.isArray(freeze[group]) && freeze[group].length === [6, 2, 2, 4][i]),
  'Original14 source freeze groups required; no retrospective source addition');
  const entries = groups.flatMap(group => freeze[group]).map(s => ({
    path: s.path?.replace(/^contoso-corr-poc\\/, ''), sha256: s.sha256
  }));
  check(new Set(entries.map(s => s.path)).size === 14 && entries.every(s => /^[a-f0-9]{64}$/.test(s.sha256 ?? '')),
    'Original source closure cannot be duplicated or weakened');
  return entries;
}

async function original(relative, expected) {
  const bytes = await readBoundFile(relative);
  check(sha256(bytes) === expected, 'Original witnessed epoch bytes changed; JSON/hash labels cannot enroll another execution');
  return { bytes, value: JSON.parse(bytes) };
}

async function bindingToolSources() {
  const sources = new Map();
  const visit = async file => {
    if (sources.has(file)) return;
    check(sources.size < 64, 'Selected binding-tool source closure exceeded its bound');
    const bytes = await readBoundFile(file);
    sources.set(file, sha256(bytes));
    for (const match of bytes.toString('utf8').matchAll(/\b(?:from|import)\s+['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(projectRoot, path.dirname(file), match[1]);
      await visit(path.relative(projectRoot, target));
    }
  };
  await visit(path.relative(projectRoot, fileURLToPath(import.meta.url)));
  return [...sources].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([file, digest]) => ({ path: file, sha256: digest }));
}

export async function intakeSelectedSecurityClientEpoch(...args) {
  check(args.length === 0, 'Caller paths, reports, flags and callbacks cannot enroll a selected execution');
  const bindingBefore = await bindingToolSources();
  const [a, b, f] = await Promise.all([
    original(epoch.build, epoch.buildSha256), original(epoch.native, epoch.nativeSha256),
    original(epoch.freeze, epoch.freezeSha256)
  ]);
  const observed = checkSelectedSecurityEpoch({ build: a.value, native: b.value });
  const sources = [...a.value.afterSources, ...validateSecurityFreezeSources(f.value),
    { path: epoch.checker, sha256: epoch.checkerSha256 }];
  const unique = new Map();
  for (const source of sources) {
    check(!unique.has(source.path) || unique.get(source.path) === source.sha256, 'Conflicting selected source closure');
    unique.set(source.path, source.sha256);
  }
  const current = async () => Promise.all([...unique].map(async ([file, expected]) => {
    const actual = sha256(await readBoundFile(file));
    check(actual === expected, 'Selected current source changed after the actual build/native epoch');
    return { path: file, sha256: actual };
  }));
  const before = await current();
  const buildDirectory = path.dirname(epoch.build);
  for (const [file, expected] of [['maven.stdout.log', a.value.stdoutSha256], ['maven.stderr.log', a.value.stderrSha256]]) {
    check(sha256(await readBoundFile(path.join(buildDirectory, file))) === expected, 'Actual Maven execution output binding changed');
  }
  for (const suite of a.value.suites) {
    const bytes = await readBoundFile(suite.path);
    check(sha256(bytes) === suite.sha256, 'Actual selected JUnit report changed');
    const head = /<testsuite\b[^>]*>/.exec(bytes.toString('utf8'))?.[0];
    check(head && ['tests', 'failures', 'errors', 'skipped'].every(name =>
      Number(new RegExp(`\\b${name}="(\\d+)"`).exec(head)?.[1] ?? -1) === suite[name]),
    'Original actual JUnit counts do not match the executed report');
  }
  const tools = a.value.toolchain;
  for (const [file, expected, canonical] of [
    [tools.mavenCommand, tools.mavenCommandSha256, path.join(toolRoot, 'apache-maven-3.10.0', 'bin', 'mvn.cmd')],
    [tools.java, tools.javaSha256, path.join(toolRoot, 'jdk-25.0.5+8', 'bin', 'java.exe')],
    [tools.javac, tools.javacSha256, path.join(toolRoot, 'jdk-25.0.5+8', 'bin', 'javac.exe')]
  ]) {
    check(sameFile(file, canonical) && sha256(await readFile(canonical)) === expected, 'Exact original executable bytes unavailable or changed');
  }
  const jar = await readBoundFile(epoch.artifact);
  const sdk = await readFile(sdkFile);
  const probeClass = await readBoundFile(path.join(epoch.probeDirectory, 'com', 'contoso', 'security', 'AuthPropagationProbe.class'));
  check(sha256(jar) === epoch.artifactSha256 &&
    jarMemberSha256(jar, 'com/contoso/security/IdentityHttpClients$ContextFreeRestClient.class') === epoch.wrapperMemberSha256 &&
    sha256(sdk) === epoch.sdkSha256 &&
    jarMemberSha256(sdk, 'com/azure/core/http/okhttp/OkHttpAsyncHttpClient.class') === epoch.sdkMemberSha256 &&
    sha256(probeClass) === epoch.probeClassSha256, 'Actual selected backing artifacts/members do not match the public USED/class origin');
  const after = await current();
  const bindingAfter = await bindingToolSources();
  check(digestTree(before) === digestTree(after), 'Current selected source changed during C intake');
  check(digestTree(bindingBefore) === digestTree(bindingAfter), 'Binding-tool source changed during C intake');
  const metadata = snapshotQualificationMetadata({
    schema: 'contoso.selected-security-qualification.v1',
    scope: 'WITNESSED_LOCAL_SELECTED_SECURITY_FACTORY_TESTPROBE_AND_USED_SDK_ARTIFACT_ONLY',
    result: 'LOCAL_SELECTED_SCOPE_VERIFIED', certification: 'NOT_CERTIFIED', apiReady: false,
    sourceAcceptanceIsCertification: false, executedBy: 'parent-R4', boundBy: 'R9',
    buildReceipt: epoch.build, buildReceiptSha256: epoch.buildSha256,
    nativeReceipt: epoch.native, nativeReceiptSha256: epoch.nativeSha256,
    sourceFreezeSha256: epoch.freezeSha256, currentSourceCount: after.length,
    beforeCurrentSourcesSha256: digestTree(before), afterCurrentSourcesSha256: digestTree(after),
    bindingToolSourceCount: bindingAfter.length, bindingToolSources: bindingAfter,
    beforeBindingToolSourcesSha256: digestTree(bindingBefore), afterBindingToolSourcesSha256: digestTree(bindingAfter),
    bindingNodeVersion: process.version,
    boundAtUtc: new Date().toISOString(), observedJUnit: {
      tests: a.value.tests, failures: a.value.failures, errors: a.value.errors, skipped: a.value.skipped
    },
    observedNativeHttpDependencies: observed.counts,
    logicalIdentitySends: b.value.identityClientOutput.logicalIdentitySendCalls,
    physicalWireAttempts: b.value.identityClientOutput.physicalIdentityWireAttempts,
    nativePayloads: b.value.identityClientOutput.nativePayloadsReceived,
    nativeEnvelopes: b.value.identityClientOutput.nativeEnvelopesReceived,
    countsEqualityClaimed: false, actualNativeIdsAndRootParentTraceRetained: true,
    currentSecurityJarSha256: epoch.artifactSha256, wrapperMemberSha256: epoch.wrapperMemberSha256,
    sdkArtifactSha256: epoch.sdkSha256, sdkMemberSha256: epoch.sdkMemberSha256,
    currentProbeClassSha256: epoch.probeClassSha256,
    originalHeaderPresenceControlsRecomputed: true, originalTrustedAdvanceObservationBound: true,
    allOriginalRawEnvelopesIndependentlyRescannedByR9: false,
    vendorSdkOwnedSourceBuildVerified: false, configuredOkHttpObjectUsage: 'CREATED_ONLY_NOT_PROMOTED',
    unusedSecurityClassesLoadedVerified: false, unusedCoreInventoryWorkersVerified: false,
    workerDefaultNettyUsedVerified: false, installedConsumerAdoptionVerified: false,
    fullAv23Verified: false, fullExporterCompletenessVerified: false,
    globalPrivacyVerified: false, boundedAzureFullPathVerified: false, zeroLossVerified: false
  });
  const capability = Object.freeze(Object.create(null));
  receipts.set(capability, metadata);
  return capability;
}

export function requireSelectedSecurityQualification(capability) {
  const result = receipts.get(capability);
  if (!result) fail('Only the private genuine selected A/B/C intake receipt can qualify this local scope');
  return result;
}

export async function securityClientMain(args) {
  check(args.length === 0, 'Usage: security-client-qualification.mjs (fixed witnessed local epoch only)');
  const startedAtUtc = new Date().toISOString();
  const metadata = requireSelectedSecurityQualification(await intakeSelectedSecurityClientEpoch());
  const pack = path.join(projectRoot, 'evidence', 'verification', 'security-client-epoch',
    `${startedAtUtc.replaceAll(/[-:.]/g, '')}-${randomUUID()}`);
  await createBoundDirectory(pack);
  const bytes = jsonBytes(metadata);
  await writeFile(path.join(pack, 'qualification.json'), bytes, { flag: 'wx' });
  await writeManifest(pack, { sourceKind: 'R9-bound-original-parent-selected-local-A-B-epoch',
    sourceAcceptanceIsCertification: false, certification: 'NOT_CERTIFIED' });
  console.log(JSON.stringify({ result: metadata.result, scope: metadata.scope,
    nativeHttpDependencies: metadata.observedNativeHttpDependencies, certification: 'NOT_CERTIFIED',
    apiReady: false, artifact: path.relative(projectRoot, path.join(pack, 'qualification.json')), sha256: sha256(bytes) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await securityClientMain(process.argv.slice(2)); }
  catch (error) { console.error(JSON.stringify({ result: 'FAIL_OR_UNVERIFIED', code: error.code ?? 'E_SECURITY_EPOCH',
    certification: 'NOT_CERTIFIED', apiReady: false })); process.exitCode = 1; }
}
