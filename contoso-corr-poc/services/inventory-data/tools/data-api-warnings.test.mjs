import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkCompilationDiagnostics, checkWarningSources, expectedMessage, loadWarningInputs, projectRoot } from './data-api-warnings.mjs';

const compiler = 'Bicep CLI version 0.48.1 (cec7951cf6)';
const inputs = await loadWarningInputs();
const { contract } = inputs;
const compilations = () => [...new Set(contract.warnings.map(row => row.file))].map(file => ({
  file,
  exitCode: 0,
  sarif: {
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'bicep' } },
      results: contract.warnings.filter(row => row.file === file).map(row => ({
        ruleId: 'BCP081',
        message: { text: expectedMessage(row) },
        locations: [{
          physicalLocation: {
            artifactLocation: { uri: pathToFileURL(path.resolve(projectRoot, ...file.split('\\'))).href },
            region: { startLine: 1 }
          }
        }]
      }))
    }]
  }
}));

test('SOURCE ONLY: six frozen untyped declarations bind their exact existing VERIFY rows', () => {
  checkWarningSources(inputs);
});

test('CONTROL: source/API drift and missing or mismatched VERIFY rows fail closed', () => {
  const sources = new Map(inputs.sources);
  const file = contract.warnings[0].file;
  sources.set(file, sources.get(file).replaceAll('2026-10-01', '2025-08-01'));
  assert.throws(() => checkWarningSources({ ...inputs, sources }));
  for (const mutate of [
    register => { register.claims = register.claims.filter(row => row.id !== contract.warnings[0].verifyRowId); },
    register => { register.claims.find(row => row.id === contract.warnings[0].verifyRowId).value = '2025-08-01'; },
    register => { register.claims.find(row => row.id === contract.warnings[1].verifyRowId).source += '/wrong-resource'; }
  ]) {
    const register = structuredClone(inputs.register);
    mutate(register);
    assert.throws(() => checkWarningSources({ ...inputs, register }));
  }
});

test('CONTROL: suppressing BCP081 or upgrading compilation into deployment proof is rejected', () => {
  const sources = new Map(inputs.sources);
  const file = contract.warnings[0].file;
  sources.set(file, '#disable-next-line BCP081\n' + sources.get(file));
  assert.throws(() => checkWarningSources({ ...inputs, sources }));
  for (const field of ['providerPropertiesValidated', 'deploymentVerified']) {
    assert.throws(() => checkWarningSources({ ...inputs, contract: { ...contract, [field]: true } }));
  }
});

test('DIAGNOSTIC CHECKER ONLY: accepts exactly the six recorded BCP081 messages, not deployment validity', () => {
  assert.deepEqual(checkCompilationDiagnostics(contract, compiler, compilations()), {
    expectedWarnings: 6, providerPropertiesValidated: false, deploymentVerified: false
  });
});

test('CONTROL: missing, duplicate, extra, changed or error diagnostics are rejected', () => {
  for (const mutate of [
    results => results.pop(),
    results => { results[1] = structuredClone(results[0]); },
    results => results.push({ ruleId: 'BCP035', message: { text: 'missing_required_property' } }),
    results => { results[0].message.text += ' changed'; },
    results => { results[0].ruleId = 'BCP999'; },
    results => { results[0].level = 'error'; },
    results => { results[0].locations[0].physicalLocation.artifactLocation.uri = pathToFileURL(path.join(projectRoot, 'wrong.bicep')).href; }
  ]) {
    const actual = compilations();
    mutate(actual[0].sarif.runs[0].results);
    assert.throws(() => checkCompilationDiagnostics(contract, compiler, actual));
  }
});

test('CONTROL: changed compiler, absent module and failed compiler cannot masquerade as an accepted warning', () => {
  assert.throws(() => checkCompilationDiagnostics(contract, 'Bicep CLI version 0.49.0 (changed)', compilations()));
  assert.throws(() => checkCompilationDiagnostics(contract, compiler, compilations().slice(1)));
  const failed = compilations();
  failed[0].exitCode = 1;
  assert.throws(() => checkCompilationDiagnostics(contract, compiler, failed));
});
