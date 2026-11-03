import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const module = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const projectRoot = path.resolve(module, '..', '..');
const resolveProject = file => path.resolve(projectRoot, ...file.split('\\'));

export async function loadWarningInputs() {
  const contract = JSON.parse(await readFile(path.join(module, 'docs', 'data-api-warning-contract.v1.json'), 'utf8'));
  const register = JSON.parse(await readFile(resolveProject(contract.register), 'utf8'));
  const sources = new Map(await Promise.all([...new Set(contract.warnings.map(row => row.file))].map(async file =>
    [file, await readFile(resolveProject(file), 'utf8')])));
  return { contract, register, sources };
}

export function checkWarningSources({ contract, register, sources }) {
  assert.equal(contract.schema, 'contoso.data-api-warning-contract.v1');
  assert.equal(contract.scope, 'local-compilation-only');
  assert.equal(contract.providerPropertiesValidated, false);
  assert.equal(contract.deploymentVerified, false);
  assert.equal(contract.diagnosticCode, 'BCP081');
  assert.equal(contract.warnings.length, 6);
  assert.equal(new Set(contract.warnings.map(row => row.verifyRowId)).size, 6);
  for (const row of contract.warnings) {
    const source = sources.get(row.file);
    assert.equal(typeof source, 'string', row.file);
    assert.doesNotMatch(source, /#disable-next-line[^\r\n]*\bBCP081\b/);
    const declarations = [...source.matchAll(/resource\s+(\w+)\s+'([^']+)@([^']+)'/g)];
    assert(declarations.some(([, symbol, type, version]) =>
      symbol === row.symbol && type === row.resourceType && version === row.apiVersion), row.verifyRowId);
    const claim = register.claims.find(claim => claim.id === row.verifyRowId);
    assert(claim, `missing_VERIFY_row:${row.verifyRowId}`);
    assert.equal(claim.file, row.file);
    assert.equal(claim.selector.symbol, row.symbol);
    assert.equal(claim.selector.resource, row.resourceType);
    assert.equal(claim.value, row.apiVersion);
    assert.equal(claim.source, row.source);
    assert.equal(claim.verification, `VERIFY: ${row.verifyRowId} = ${row.apiVersion}`);
  }
}

export function expectedMessage(row) {
  return `Resource type "${row.resourceType}@${row.apiVersion}" does not have types available. ` +
    'Bicep is unable to validate resource properties prior to deployment, but this will not block the resource from being deployed. ' +
    '[https://aka.ms/bicep/core-diagnostics#BCP081]';
}

export function checkCompilationDiagnostics(contract, compilerVersion, compilations) {
  assert.match(compilerVersion, new RegExp(`^Bicep CLI version ${contract.compilerVersion.replaceAll('.', '\\.')} \\(`));
  const files = [...new Set(contract.warnings.map(row => row.file))].sort();
  assert.deepEqual(compilations.map(result => result.file).sort(), files);
  for (const compilation of compilations) {
    assert.equal(compilation.exitCode, 0, `compile_failed:${compilation.file}`);
    assert.equal(compilation.sarif.version, '2.1.0');
    assert.equal(compilation.sarif.runs.length, 1);
    assert.equal(compilation.sarif.runs[0].tool.driver.name, 'bicep');
    const results = compilation.sarif.runs[0].results;
    const expected = contract.warnings.filter(row => row.file === compilation.file);
    assert.equal(results.length, expected.length, `diagnostic_count_changed:${compilation.file}`);
    assert.equal(new Set(results.map(result => result.message.text)).size, expected.length);
    for (const row of expected) {
      const result = results.find(result => result.message.text === expectedMessage(row));
      assert(result, `missing_BCP081:${row.verifyRowId}`);
      assert.equal(result.ruleId, contract.diagnosticCode);
      assert.notEqual(result.level, 'error');
      assert.equal(result.locations.length, 1);
      assert.equal(path.resolve(fileURLToPath(result.locations[0].physicalLocation.artifactLocation.uri)),
        resolveProject(row.file));
      assert(result.locations[0].physicalLocation.region.startLine > 0);
    }
  }
  return { expectedWarnings: contract.warnings.length, providerPropertiesValidated: false, deploymentVerified: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv[2], '--check');
  const [, , , compilerVersion, output] = process.argv;
  assert(output, 'diagnostic_output_directory_required');
  const inputs = await loadWarningInputs();
  checkWarningSources(inputs);
  const compilations = await Promise.all([...new Set(inputs.contract.warnings.map(row => row.file))].map(async file => ({
    file,
    exitCode: 0,
    sarif: JSON.parse(await readFile(path.join(output, `${path.win32.basename(file, '.bicep')}.sarif.json`), 'utf8'))
  })));
  const result = checkCompilationDiagnostics(inputs.contract, compilerVersion, compilations);
  console.log(`PASS: ${result.expectedWarnings} exact BCP081 warnings linked to existing VERIFY rows; provider/deployment validation remains To Do.`);
}
