import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const gate = join(root, 'tools', 'java', 'Assert-JavaTestResults.ps1');
const workflow = join(root, '..', '.github', 'workflows', 'ci-java.yml');
const classes = ['com.contoso.correlation.SingleAgentExportTest',
  'com.contoso.inventory.data.DataAgentQualificationTest', 'com.contoso.orders.NativeApiIntegrationTest',
  'com.contoso.messaging.AsyncNativeAgentTest', 'com.contoso.messaging.LinkedRootSamplingTest'];
const suite = (name, { skipped = 0, errors = 0, body = '', omitCase = false, cancelled = false } = {}) =>
  `<testsuite name="${name}" tests="1" failures="0" errors="${errors}" skipped="${skipped}">` +
  (omitCase ? '' : `<testcase classname="${name}" name="gate"${cancelled ? ' cancelled="true"' : ''}>${body}</testcase>`) + '</testsuite>';
function fixture(action) {
  const directory = join(root, 'tests', 'java', 'generated-fixtures', randomUUID());
  const reports = join(directory, 'sample', 'target', 'surefire-reports');
  mkdirSync(reports, { recursive: true });
  writeFileSync(join(directory, 'pom.xml'), '<project><modules><module>sample</module></modules></project>');
  for (const name of classes) {
    const parts = name.split('.');
    const short = parts.pop(), source = join(directory, 'sample', 'src', 'test', 'java', ...parts);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, `${short}.java`), `package ${parts.join('.')};
class ${short} {
 @Test @EnabledIfEnvironmentVariable(named = "CONTOSO_AGENT_JAR", matches = ".+")
 void gate() {}
}`);
    writeFileSync(join(reports, `TEST-${name}.xml`), suite(name));
  }
  const run = () => spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', gate,
    '-ProjectRoot', directory, '-StartedAtUtc', new Date(Date.now() - 60_000).toISOString(),
    '-SummaryPath', join(directory, 'summary.json')], { encoding: 'utf8', timeout: 30_000 });
  try { action({ directory, reports, run }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}
function checkWorkflow(source) {
  for (const pattern of [
    /^on:\r?\n  pull_request:/m, /runs-on: windows-latest/, /contents: read/,
    /APPLICATIONINSIGHTS_STATSBEAT_DISABLED: 'true'/, /APPLICATIONINSIGHTS_LIVE_METRICS_ENABLED: 'false'/,
    /Install-Portable\.ps1/, /Use-Portable\.ps1/, /Get-Agent\.ps1/,
    /Get-FileHash \$sampler/, /-ne \$lock\.extensions\[0\]\.sha256/,
    /CONTOSO_AGENT_JAR=\$agent/, /CONTOSO_PARENT_SAFE_JAR=\$sampler/,
    /mvn -B -ntp clean verify/, /if: always\(\)[\s\S]*Assert-JavaTestResults\.ps1/,
    /-StartedAtUtc \$env:CONTOSO_JAVA_TEST_START/, /Gate-02\.ps1 -RequireArtifacts/,
    /node --test \.\\tests\\java\\gates\.test\.mjs/
  ]) assert.match(source, pattern);
  assert.doesNotMatch(source, /paths(?:-ignore)?:|pull_request_target|secrets\.|id-token:\s*write|azd up|az deployment/);
  assert.doesNotMatch(source, /-D(?:skipTests|maven\.test\.skip)/);
}

test('every PR runs the locked serial reactor with both artifacts and fail-closed totals', () => {
  checkWorkflow(readFileSync(workflow, 'utf8'));
});

test('workflow controls reject skipped reactor, missing sampler pin and restricted PR trigger', () => {
  const source = readFileSync(workflow, 'utf8');
  for (const changed of [
    source.replace('  pull_request:', '  push:'),
    source.replace('mvn -B -ntp clean verify', 'mvn -B -ntp -DskipTests clean verify'),
    source.replace('-ne $lock.extensions[0].sha256', '-ne "caller-label"'),
    source.replace("APPLICATIONINSIGHTS_STATSBEAT_DISABLED: 'true'", "APPLICATIONINSIGHTS_STATSBEAT_DISABLED: 'false'"),
    source.replace("APPLICATIONINSIGHTS_LIVE_METRICS_ENABLED: 'false'", "APPLICATIONINSIGHTS_LIVE_METRICS_ENABLED: 'true'"),
    source.replace('  pull_request:', '  pull_request:\n    paths: ["services/**"]')
  ]) assert.throws(() => checkWorkflow(changed));
});

test('fresh complete XML prints executed and skipped totals and covers every required agent class', () => {
  fixture(({ directory, run }) => {
    const result = run();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /JAVA_TEST_TOTALS/);
    const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
    assert.equal(summary.result, 'PASS_SOURCE_UNIT_ONLY');
    assert.equal(summary.requiredAgentTests, 5);
    assert.deepEqual(summary.totals, { tests: 5, executed: 5, passed: 5, failures: 0, errors: 0, skipped: 0, cancelled: 0, reports: 5 });
  });
});

test('skipped or cancelled agent assertions fail even when Maven reported zero failures', () => {
  fixture(({ directory, reports, run }) => {
    for (const change of [
      { skipped: 1, body: '<skipped type="org.opentest4j.TestAbortedException"/>' },
      { errors: 1, body: '<error type="java.util.concurrent.CancellationException"/>' },
      { cancelled: true }
    ]) {
      writeFileSync(join(reports, `TEST-${classes[0]}.xml`), suite(classes[0], change));
      const result = run();
      assert.notEqual(result.status, 0);
      const summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
      assert.equal(summary.totals.cancelled, 1);
      assert.equal(summary.totals.passed, 4);
      assert.ok(summary.issues.includes('JAVA_TESTS_FAILED_SKIPPED_OR_CANCELLED'));
    }
  });
});

test('missing gated testcase, incomplete counts and stale reports cannot pass silently', () => {
  fixture(({ directory, reports, run }) => {
    const file = join(reports, `TEST-${classes[0]}.xml`);
    writeFileSync(file, suite(classes[0], { omitCase: true }));
    assert.notEqual(run().status, 0);
    let summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
    assert.ok(summary.issues.some(value => value.startsWith('JAVA_REQUIRED_AGENT_TEST_NOT_EXECUTED:')));
    assert.ok(summary.issues.some(value => value.startsWith('JAVA_TEST_COUNTS_INCOMPLETE:')));
    writeFileSync(file, suite(classes[0]));
    utimesSync(file, new Date(0), new Date(0));
    assert.notEqual(run().status, 0);
    summary = JSON.parse(readFileSync(join(directory, 'summary.json'), 'utf8'));
    assert.ok(summary.issues.some(value => value.startsWith('JAVA_TEST_REPORT_STALE:')));
  });
});

test('duplicate emitted tests and DTD-bearing XML are rejected', () => {
  fixture(({ reports, run }) => {
    writeFileSync(join(reports, 'TEST-duplicate.xml'), suite(classes[0]));
    assert.notEqual(run().status, 0);
    rmSync(join(reports, 'TEST-duplicate.xml'));
    const file = join(reports, `TEST-${classes[0]}.xml`);
    writeFileSync(file, '<!DOCTYPE testsuite [<!ENTITY seed "control">]>' + suite(classes[0]));
    assert.notEqual(run().status, 0);
  });
});
