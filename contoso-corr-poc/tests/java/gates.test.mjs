import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const guard = join(root, 'tools', 'java', 'Gate-02.ps1');

function fixture(action) {
  const directory = join(root, 'tests', 'java', 'generated-fixtures', randomUUID());
  mkdirSync(directory, { recursive: true });
  try { action(directory); } finally { rmSync(directory, { recursive: true, force: true }); }
}
function run(directory) {
  return spawnSync('pwsh', ['-NoProfile', '-File', guard, '-ProjectRoot', directory], { encoding: 'utf8' });
}
function zip(source, destination) {
  const result = spawnSync('pwsh', ['-NoProfile', '-Command',
    '[IO.Compression.ZipFile]::CreateFromDirectory($env:SOURCE_ARCHIVE,$env:TARGET_ARCHIVE)'],
    { encoding: 'utf8', env: { ...process.env, SOURCE_ARCHIVE: source, TARGET_ARCHIVE: destination } });
  assert.equal(result.status, 0, result.stderr);
}
const pom = (artifact, scope = 'compile', version = '1.65.0') => `<project><modelVersion>4.0.0</modelVersion><dependencies>
<dependency><groupId>io.opentelemetry</groupId><artifactId>${artifact}</artifactId><version>${version}</version><scope>${scope}</scope></dependency>
</dependencies></project>`;

test('GATE-02 accepts API only and fails a never-deployed second-SDK fixture', () => {
  fixture(directory => {
    writeFileSync(join(directory, 'pom.xml'), pom('opentelemetry-api'));
    assert.equal(run(directory).status, 0);
    writeFileSync(join(directory, 'pom.xml'), pom('opentelemetry-sdk'));
    assert.notEqual(run(directory).status, 0);
  });
});
test('GATE-02 fails provider construction before deployment', () => {
  fixture(directory => {
    writeFileSync(join(directory, 'pom.xml'), pom('opentelemetry-api'));
    mkdirSync(join(directory, 'src', 'main', 'java'), { recursive: true });
    writeFileSync(join(directory, 'src', 'main', 'java', 'NeverDeployed.java'),
      'class NeverDeployed { void bad() { OpenTelemetrySdk.builder(); } }');
    assert.notEqual(run(directory).status, 0);
  });
});
test('PROVIDED SDK APIs outside the one approved extension remain forbidden', () => {
    fixture(directory => {
      writeFileSync(join(directory, 'pom.xml'), pom('opentelemetry-sdk-trace', 'provided'));
      assert.notEqual(run(directory).status, 0);
    });
  });
test('extension compiler exception is exact ABI and PROVIDED, not a subtree exclusion', () => {
    fixture(directory => {
      const inventory = JSON.parse(readFileSync(join(root, 'config', 'versions.lock.json'))).extensions[0];
      mkdirSync(join(directory, 'config'), { recursive: true });
      writeFileSync(join(directory, 'config', 'versions.lock.json'), JSON.stringify({ extensions: [inventory] }));
      const module = join(directory, 'extensions', 'parent-safe-sampler');
      mkdirSync(module, { recursive: true });
      const header = '<groupId>com.contoso</groupId><artifactId>contoso-parent-safe-sampler</artifactId><version>1.0.0</version>';
      const writePom = (scope, version) => writeFileSync(join(module, 'pom.xml'),
        pom('opentelemetry-sdk-trace', scope, version).replace('<dependencies>', header + '<dependencies>'));
      writePom('provided', '1.65.0');
      assert.equal(run(directory).status, 0);
      writePom('compile', '1.65.0');
      assert.notEqual(run(directory).status, 0);
      writePom('provided', '1.64.0');
      assert.notEqual(run(directory).status, 0);
      writePom('provided', '1.65.0');
      mkdirSync(join(module, 'src', 'main', 'java'), { recursive: true });
      writeFileSync(join(module, 'src', 'main', 'java', 'NeverDeployed.java'),
        'class NeverDeployed { void bad() { GlobalOpenTelemetry.set(null); } }');
      assert.notEqual(run(directory).status, 0);
    });
  });
test('agent pin, runtime guard and generated VERSIONS refer to the same lock', () => {
  const bytes = readFileSync(join(root, 'config', 'versions.lock.json'));
  const lock = JSON.parse(bytes);
  const guardSource = readFileSync(join(root, 'services', 'correlation-core', 'src', 'main', 'java',
    'com', 'contoso', 'correlation', 'RuntimeGuard.java'), 'utf8');
  assert.ok(guardSource.includes(lock.agent.sha256));
  assert.ok(readFileSync(join(root, 'VERSIONS.md'), 'utf8').includes(createHash('sha256').update(bytes).digest('hex')));
  assert.equal(lock.certification, 'NOT_CERTIFIED');
});
test('startup owns one pinned agent and never promotes a sampled flag', () => {
  const startup = readFileSync(join(root, 'tools', 'java', 'startup.sh'), 'utf8');
  assert.equal((startup.match(/export JAVA_TOOL_OPTIONS=/g) ?? []).length, 1);
  assert.ok(startup.includes('GATE_02_DUPLICATE_AGENT'));
  assert.ok(!startup.includes('traceparent'));
  assert.ok(startup.includes('${JDK_JAVA_OPTIONS-}'));
  assert.ok(startup.includes('${_JAVA_OPTIONS-}'));
  assert.ok(startup.includes('unset JDK_JAVA_OPTIONS _JAVA_OPTIONS'));
});
test('BOOT-INF SDK resources and unlabelled nested libraries cannot evade admission', () => {
  for (const nested of [false, true]) fixture(directory => {
    writeFileSync(join(directory, 'pom.xml'), pom('opentelemetry-api'));
    const stage = join(directory, 'archive-stage');
    const sdk = join(stage, nested ? 'io' : 'BOOT-INF/classes/io', 'opentelemetry', 'sdk', 'trace');
    mkdirSync(sdk, { recursive: true });
    writeFileSync(join(sdk, 'NeverLoaded.class'), 'resource fixture, not an SDK implementation');
    const target = join(directory, 'services', 'orders-api', 'target');
    mkdirSync(target, { recursive: true });
    if (nested) {
      const outer = join(directory, 'outer-stage', 'BOOT-INF', 'lib');
      mkdirSync(outer, { recursive: true });
      zip(stage, join(outer, 'unlabelled-library.jar'));
      zip(join(directory, 'outer-stage'), join(target, 'orders-api.jar'));
    } else zip(stage, join(target, 'orders-api.jar'));
    assert.notEqual(run(directory).status, 0);
  });
});
