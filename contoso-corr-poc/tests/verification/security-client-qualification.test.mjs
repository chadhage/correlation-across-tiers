import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { projectRoot, sha256 } from '../../tools/verification/files.mjs';
import { checkSelectedSecurityEpoch, intakeSelectedSecurityClientEpoch, requireSelectedSecurityQualification,
  validateSecurityFreezeSources, resolveSecurityToolsRoot,
  validateSecurityEpochLocation, validateSecurityToolBindings } from '../../tools/verification/security-client-qualification.mjs';

const original = {
  build: JSON.parse(await readFile(path.join(projectRoot, 'evidence', 'java-local', 'source-builds',
    '20261101T182202080Z-client-security-652c7229-6b6a-4dae-85a5-575eeee113cd', 'source-build.json'))),
  native: JSON.parse(await readFile(path.join(projectRoot, 'services', 'security-core', 'docs',
    'av23-java-client-output-parent-20261101T182444029Z.json')))
};
const freeze = JSON.parse(await readFile(path.join(projectRoot, 'services', 'security-core', 'docs',
  'native-client-source-freeze.v1.json')));
const copy = () => structuredClone(original);

test('original A/B semantic consistency is structural only and cannot mint acceptance', () => {
  const result = checkSelectedSecurityEpoch(copy());
  assert.equal(result.authorityGranted, false);
  assert.deepEqual(result.counts, { jwks: 1, managedIdentity: 2 });
  assert.throws(() => requireSelectedSecurityQualification(result), /private genuine/);
});

function recordedRoot() {
  let root = fileURLToPath(original.native.probeCompilation.actualCodeSource);
  for (let depth = 0; depth < 5; depth++) root = path.dirname(root);
  return root;
}

test('archived path consistency cannot enroll a relocated current execution', () => {
  const root = recordedRoot();
  const result = validateSecurityEpochLocation(original.native, root);
  assert.equal(result.authorityGranted, false);
  assert.throws(() => requireSelectedSecurityQualification(result), /private genuine/);
  assert.throws(() => validateSecurityEpochLocation(original.native, path.join(root, 'relocated-copy')), /Relocated project copies/);
});

test('historical compiler source, output and used artifact paths must retain one recorded root', () => {
  const candidate = copy();
  candidate.native.probeCompilation.compilerArguments[4] = path.join(recordedRoot(), 'relocated-copy',
    'services', 'security-core', 'src', 'test', 'java', 'com', 'contoso', 'security', 'AuthPropagationProbe.java');
  assert.throws(() => checkSelectedSecurityEpoch(candidate), /compiler\/source\/class\/CodeSource/);
});

test('omitted/duplicate/recomputed closure cannot qualify current-source lineage', () => {
  for (const change of [
    a => a.beforeSources.pop(),
    a => a.afterSources.push(a.afterSources[0]),
    a => { a.beforeSources.pop(); a.beforeSourcesSha256 = sha256(JSON.stringify(a.beforeSources)); },
    a => { a.skipped = 1; },
    a => { a.mavenJavaObservations[0].parentPid++; }
  ]) {
    const candidate = copy();
    change(candidate.build);
    assert.throws(() => checkSelectedSecurityEpoch(candidate));
  }
});

test('missing/zero/duplicate/wrong-root/native-kind IDs fail without expected-name synthesis', () => {
  for (const change of [
    b => { b.identityClientOutput.safeNativeClientProjection.length = 0; },
    b => { b.identityClientOutput.safeNativeClientProjection[0].nativeSpanId = '0'.repeat(16); },
    b => { b.identityClientOutput.safeNativeClientProjection[1] = b.identityClientOutput.safeNativeClientProjection[0]; },
    b => { b.identityClientOutput.safeNativeClientProjection[0].nativeParentId = '1'.repeat(16); },
    b => { b.identityClientOutput.safeNativeClientProjection[0].nativeDependencyType = 'SQL'; },
    b => { b.identityClientOutput.safeNativeClientProjection[0].nativeTimeUtc = '2020-01-01T00:00:00.000Z'; }
  ]) {
    const candidate = copy();
    change(candidate.native);
    assert.throws(() => checkSelectedSecurityEpoch(candidate));
  }
});

test('all seven production header checks, raw negative and trusted advance remain required', () => {
  for (const change of [
    b => { b.wireHeaderPresence.jwks[0].traceparent = true; },
    b => { b.wireHeaderPresence.identity[1]['x-business-correlation-id'] = true; },
    b => { b.rawNativeInterceptorPresent = false; },
    b => { b.trustedParentAdvanced = false; },
    b => { b.mode = 'approve_okhttp'; }
  ]) {
    const candidate = copy();
    change(candidate.native);
    assert.throws(() => checkSelectedSecurityEpoch(candidate));
  }
});

test('fresh probe compilation and actual USED instances cannot be inferred from old A/created objects', () => {
  for (const change of [
    b => { b.probeCompilation.sourceSha256After = '1'.repeat(64); },
    b => { b.probeCompilation.compiledClassSha256After = '1'.repeat(64); },
    b => { b.probeCompilation.compilerPid++; },
    b => { b.probeCompilation.widerSourceBuildLineageClaimed = true; },
    b => { b.clientObservations[0].usage = 'CREATED_ONLY'; },
    b => { b.clientObservations[1].classResourceSha256 = '1'.repeat(64); }
  ]) {
    const candidate = copy();
    change(candidate.native);
    assert.throws(() => checkSelectedSecurityEpoch(candidate));
  }
});

test('native/logical/physical counters stay independent and broad privacy/completeness remain false', () => {
  for (const change of [
    b => { b.identityClientOutput.nativeIdentityClientSpanCounts.managedIdentity = 0; },
    b => { b.identityClientOutput.spanCountsEqualPhysicalAttemptsClaimed = true; },
    b => { b.identityClientOutput.fullExporterCompletenessVerified = true; },
    b => { b.identityClientOutput.globalRawTelemetrySafetyVerified = true; }
  ]) {
    const candidate = copy();
    change(candidate.native);
    assert.throws(() => checkSelectedSecurityEpoch(candidate));
  }
});

test('the original14 source freeze is not retroactively extended to include another input', () => {
  assert.equal(validateSecurityFreezeSources(freeze).length, 14);
  const missing = structuredClone(freeze);
  missing.changedSourcesFromRepositoryRoot.pop();
  assert.throws(() => validateSecurityFreezeSources(missing));
  const duplicated = structuredClone(freeze);
  duplicated.importedPureSourcesFromRepositoryRoot[1] = duplicated.importedPureSourcesFromRepositoryRoot[0];
  assert.throws(() => validateSecurityFreezeSources(duplicated));
});

test('JSON/clones/getters/caller callbacks cannot enroll the fixed witnessed local epoch', async () => {
  for (const value of [{}, { verified: true }, JSON.parse(JSON.stringify(original.native))]) {
    assert.throws(() => requireSelectedSecurityQualification(value), /private genuine/);
  }
  await assert.rejects(intakeSelectedSecurityClientEpoch(original), /cannot enroll/);
  let reads = 0;
  const candidate = copy();
  Object.defineProperty(candidate.native, 'identityClientOutput', { enumerable: true, get() { reads++; return {}; } });
  assert.throws(() => checkSelectedSecurityEpoch(candidate), /accessors/);
  assert.equal(reads, 0);
});

test('security tool selection requires the named environment prerequisite and honors an explicit spaced root', () => {
  for (const value of ['', '   ', null, {}, 'bad\0root']) {
    assert.throws(() => resolveSecurityToolsRoot(value), /CONTOSO_PORTABLE_TOOLS_ROOT is required/);
  }
  const selected = path.join(projectRoot, 'tests', 'verification', 'selected tools');
  assert.equal(resolveSecurityToolsRoot(` ${selected} `), selected);
});

test('actual security qualification CLI fails explicitly when the tools-root variable is unset', () => {
  const env = { ...process.env };
  delete env.CONTOSO_PORTABLE_TOOLS_ROOT;
  const result = spawnSync(process.execPath, ['tools\\verification\\security-client-qualification.mjs'], {
    cwd: projectRoot, env, encoding: 'utf8', timeout: 30000
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const diagnostic = JSON.parse(result.stderr.trim());
  assert.equal(diagnostic.code, 'E_SECURITY_TOOLS_ROOT');
  assert.equal(diagnostic.missingPrerequisite, 'CONTOSO_PORTABLE_TOOLS_ROOT');
  assert.equal(diagnostic.result, 'FAIL_OR_UNVERIFIED');
  assert.equal(diagnostic.apiReady, false);
});

test('security qualification source has no machine or session-folder default', async () => {
  const source = await readFile(path.join(projectRoot, 'tools', 'verification', 'security-client-qualification.mjs'), 'utf8');
  assert.doesNotMatch(source, /[a-z]:[\\/]+users[\\/]|session-state/iu);
  assert.match(source, /CONTOSO_PORTABLE_TOOLS_ROOT/);
});

test('explicit security tool byte checks remain read-only and cannot enroll a receipt', async () => {
  const root = path.join(projectRoot, 'tests', 'verification', 'generated-fixtures', randomUUID(), 'selected tools');
  const tools = {};
  const files = [
    ['mavenCommand', 'mavenCommandSha256', 'apache-maven-3.10.0', 'mvn.cmd'],
    ['java', 'javaSha256', 'jdk-25.0.5+8', 'java.exe'],
    ['javac', 'javacSha256', 'jdk-25.0.5+8', 'javac.exe']
  ];
  try {
    for (const [property, hash, directory, file] of files) {
      tools[property] = path.join(root, directory, 'bin', file);
      tools[hash] = sha256(Buffer.from(file));
      await mkdir(path.dirname(tools[property]), { recursive: true });
      await writeFile(tools[property], file);
    }
    const checked = await validateSecurityToolBindings(tools, root);
    assert.equal(checked.authorityGranted, false);
    assert.throws(() => requireSelectedSecurityQualification(checked), /private genuine/);
    await assert.rejects(validateSecurityToolBindings(tools, `${root}-relocated`), /cannot inherit execution identity/);
    await writeFile(tools.java, 'changed');
    await assert.rejects(validateSecurityToolBindings(tools, root), /unavailable or changed/);
    await rm(tools.java);
    await assert.rejects(validateSecurityToolBindings(tools, root), /CONTOSO_PORTABLE_TOOLS_ROOT/);
  } finally { await rm(path.dirname(root), { recursive: true, force: true }); }
});
