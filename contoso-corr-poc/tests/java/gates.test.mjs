import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, utimesSync } from 'node:fs';
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
      const header = `<groupId>${inventory.groupId}</groupId><artifactId>${inventory.artifactId}</artifactId><version>${inventory.version}</version>`;
      const writePom = (scope, version) => writeFileSync(join(module, 'pom.xml'),
        pom('opentelemetry-sdk-trace', scope, version).replace('<dependencies>', header + '<dependencies>'));
      writePom('provided', '1.65.0');
      const accepted = run(directory);
      assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
      writeFileSync(join(module, 'pom.xml'), readFileSync(join(module, 'pom.xml'), 'utf8')
        .replace(`<version>${inventory.version}</version>`, '<version>0.0.0</version>'));
      assert.notEqual(run(directory).status, 0);
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
  for (const source of [startup,
    readFileSync(join(root, 'tools', 'java', 'replay.sh'), 'utf8'),
    readFileSync(join(root, 'infra', 'modules', 'compute.bicep'), 'utf8')]) {
    assert.ok(!source.includes('-Dotel.instrumentation.okhttp.enabled=false'));
    assert.ok(!source.includes('OTEL_INSTRUMENTATION_OKHTTP_ENABLED'));
    assert.ok(!source.includes('-Dotel.instrumentation.java-http-client.enabled=false'));
  }
});
test('compute exposes actual hostnames and defaults backend and independent SCM ingress to deny', () => {
  const source = readFileSync(join(root, 'infra', 'modules', 'compute.bicep'), 'utf8');
  for (const parameter of ['apiIpSecurityRestrictions', 'workerIpSecurityRestrictions', 'scmIpSecurityRestrictions']) {
    assert.ok(source.includes(`param ${parameter} array = []`));
  }
  assert.equal((source.match(/ipSecurityRestrictionsDefaultAction: 'Deny'/g) ?? []).length, 2);
  assert.equal((source.match(/scmIpSecurityRestrictionsDefaultAction: 'Deny'/g) ?? []).length, 3);
  assert.equal((source.match(/scmIpSecurityRestrictionsUseMain: false/g) ?? []).length, 3);
  assert.ok(source.includes("output inventoryBaseUrl string = 'https://${apis[1].properties.defaultHostName}/api'"));
  assert.ok(source.includes("output portalOrigin string = 'https://${portal.properties.defaultHostName}'"));
  assert.ok(!source.includes('CONTOSO_INVENTORY_BASE_URL:'));
  assert.ok(!source.includes('.azurewebsites.net'));
});
test('the serial reactor builds current Inventory classes before Orders launches its two-JVM test', () => {
  const reactor = readFileSync(join(root, 'pom.xml'), 'utf8');
  const inventory = reactor.indexOf('<module>services/inventory-api</module>');
  const orders = reactor.indexOf('<module>services/orders-api</module>');
  assert.ok(inventory >= 0 && orders > inventory);
});
test('module observations never promote mixed build epochs into a fresh full-reactor PASS', () => {
  fixture(directory => {
    const epoch = randomUUID();
    const apiDirectory = join(directory, 'evidence', 'java-local', 'native-api', epoch);
    mkdirSync(apiDirectory, { recursive: true });
    writeFileSync(join(directory, 'pom.xml'),
      '<project><modules><module>baseline-a</module><module>overlay-b</module></modules></project>');
    for (const [module, tests] of [['baseline-a', 3], ['overlay-b', 5]]) {
      const target = join(directory, module, 'target');
      mkdirSync(join(target, 'surefire-reports'), { recursive: true });
      writeFileSync(join(directory, module, 'pom.xml'),
        `<project><artifactId>${module}</artifactId><version>1.0.0</version></project>`);
      writeFileSync(join(target, `${module}-1.0.0.jar`), `synthetic ${module} artifact, never executed`);
      writeFileSync(join(target, 'surefire-reports', 'TEST-fixture.xml'),
        `<testsuite name="${module}" tests="${tests}" failures="0" errors="0" skipped="0"/>`);
    }
    mkdirSync(join(directory, 'config'));
    writeFileSync(join(directory, 'config', 'versions.lock.json'), JSON.stringify({
      extensions: [{ sha256: 'a'.repeat(64), probeReport: 'synthetic-probe.json' }]
    }));
    writeFileSync(join(directory, 'synthetic-probe.json'), JSON.stringify({
      result: 'PASS', extensionSha256: 'a'.repeat(64), sdkAbi: 'fixture-only', phases: []
    }));
    const captureBytes = JSON.stringify({ schema: 'contoso.native-api-capture.v1', executionId: epoch });
    writeFileSync(join(apiDirectory, 'capture.json'), captureBytes);
    const receipt = join(apiDirectory, 'receipts.json');
    writeFileSync(receipt, JSON.stringify({
      schema: 'contoso.real-api-native-receipts.v1', executionId: epoch, certificationEligible: false,
      capturePath: join('evidence', 'java-local', 'native-api', epoch, 'capture.json'),
      captureSha256: createHash('sha256').update(captureBytes).digest('hex'),
      originalPrivacyCapture: {
        schema: 'contoso.native-api-safe-capture.v1', validatorPid: process.pid,
        payloadReceipts: [{
          scannedAllOriginalValues: true, projectedAfterScan: true, strictDuplicateKeysVerified: true,
          originalPayloadRetained: false, originalEnvelopeCount: 1, originalPayloadSha256: 'b'.repeat(64)
        }]
      }
    }));
    const observed = spawnSync('pwsh', ['-NoProfile', '-File', join(root, 'tools', 'java', 'Write-ValidationReport.ps1'),
      '-ProjectRoot', directory, '-BuildStartedAtUtc', new Date(Date.now() - 60_000).toISOString(),
      '-ApiReceiptPath', receipt], { encoding: 'utf8' });
    assert.equal(observed.status, 0, observed.stderr || observed.stdout);
    const report = JSON.parse(readFileSync(join(apiDirectory, 'validation.json'), 'utf8'));
    assert.equal(report.schema, 'contoso.java-module-observations.v2');
    assert.equal(report.result, 'OBSERVED_PASSING_TEST_OUTPUTS');
    assert.equal(report.fullReactorExecutionVerified, false);
    assert.equal(report.commonSourceBuildEpochVerified, false);
    assert.equal(report.totalTests, 8);
    assert.match(report.scope, /different executions/);
    assert.match(observed.stdout, /No full-reactor execution or shared build epoch verified/);
    assert.doesNotMatch(observed.stdout, /Current full reactor qualification/);
  });
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

test('startup log guard rejects runtime gate failures, duplicate loads, transformation failures and exporter rejection', () => {
    fixture(directory => {
      const file = join(directory, 'startup.log');
      const invoke = () => spawnSync('pwsh', ['-NoProfile', '-File', join(root, 'tools', 'java', 'Assert-Startup.ps1'),
        '-LogPath', file], { encoding: 'utf8' });
      const loaded = 'CONTOSO_PARENT_SAFE_SAMPLER_LOADED abi=1.65.0 delegate=actual\n';
      writeFileSync(file, loaded);
      assert.equal(invoke().status, 0);
      for (const invalid of [loaded + loaded, loaded + 'IllegalClassFormatException', loaded + 'exporter rejected telemetry',
        loaded + 'java.lang.IllegalStateException: GATE_02_ROLE_MAPPING',
        loaded + 'java.lang.IllegalStateException: GATE_05_REQUIRED_HTTP_INSTRUMENTATION']) {
        writeFileSync(file, invalid);
        assert.notEqual(invoke().status, 0, invalid);
      }
    });
  });

test('throw-only construction bytecode cannot enter a real application package', () => {
    fixture(directory => {
      writeFileSync(join(directory, 'pom.xml'), pom('opentelemetry-api'));
      const source = join(directory, 'jar-stage', 'com', 'contoso', 'security');
      mkdirSync(source, { recursive: true });
      writeFileSync(join(source, 'NeverLoaded.class'), 'Never-deployed class resource containing CONSTRUCTION_ONLY');
      const target = join(directory, 'services', 'orders-api', 'target');
      mkdirSync(target, { recursive: true });
      zip(join(directory, 'jar-stage'), join(target, 'orders-api.jar'));
      assert.notEqual(run(directory).status, 0);
    });
  });

test('deployment ZIP bytes are stable despite changing filesystem timestamps', () => {
    fixture(directory => {
      const source = join(directory, 'source');
      mkdirSync(source);
      writeFileSync(join(source, 'immutable.txt'), 'real package test bytes');
      const first = join(directory, 'first.zip'), second = join(directory, 'second.zip');
      for (const destination of [first, second]) {
        if (destination === second) utimesSync(join(source, 'immutable.txt'), new Date('2027-01-01'), new Date('2027-01-01'));
        const result = spawnSync('pwsh', ['-NoProfile', '-File', join(root, 'tools', 'java', 'Write-DeploymentZip.ps1'),
          '-SourceDirectory', source, '-Destination', destination], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
      }
      assert.deepEqual(readFileSync(first), readFileSync(second));
    });
});
