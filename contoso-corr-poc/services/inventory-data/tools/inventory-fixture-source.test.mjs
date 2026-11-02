import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const module = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const java = name => readFile(path.join(module, 'src', 'main', 'java', 'com', 'contoso', 'inventory', 'data', `${name}.java`), 'utf8');

test('SOURCE ONLY: preparation uses existing target guards and one parameterized fixture, never bootstrap/reset-all', async () => {
  const source = await java('InventoryFixtureRun');
  for (const guard of ['InventorySchemaHooks.authorized', 'InventorySchemaHooks.verifyEndpoint',
    'InventorySchemaHooks.verifyDatabase', 'InventorySchemaHooks.verifyBoundDataset']) assert(source.includes(guard), guard);
  assert.match(source, /InventorySchemaHooks\.SYNTHETIC_SKUS\.contains\(sku\)/);
  assert.match(source, /UPDATE contoso\.inventory_item SET available=\?,revision=\? WHERE sku=\? AND synthetic=TRUE/);
  assert.match(source, /DELETE FROM contoso\.inventory_reservation WHERE reservation_id=\? AND order_id=\? AND sku=\? AND invocation_id=\? AND synthetic=TRUE/);
  assert.doesNotMatch(source, /resetOwnedRows|applyV001|grantInventory|grantWorkflow|registerPrincipal|CREATE |TRUNCATE |DROP /);
});

test('SOURCE ONLY: real cache baseline has typed explicit operations, bounded expiry and no global/raw command surface', async () => {
  const [cache, contract] = await Promise.all([java('LettuceInventoryCache'), java('RestorableInventoryCache')]);
  assert.match(cache, /implements RestorableInventoryCache/);
  assert.match(cache, /connection\.async\(\)\.pttl\(key\(sku\)\)/);
  assert.match(cache, /new SetArgs\(\)\.pxAt\(baseline\.expiresAt\(\)\.toEpochMilli\(\)\)/);
  assert.match(cache, /if \(!"OK"\.equals\(reply\)\) throw new DataAccessException/);
  assert.doesNotMatch(cache, /\.(?:flushall|flushdb|keys|scan|eval|script)\(/i);
  assert.match(contract, /Baseline capture\(String sku, OperationContext context\);/);
  assert.match(contract, /void restore\(String sku, Baseline baseline, OperationContext context\);/);
  assert.doesNotMatch(contract, /\bdefault\b|\bexecute\b/);
});

test('SOURCE ONLY: fixed bridge opens actual operator clients without accepting saved JSON as baseline authority', async () => {
  const source = await java('InventoryFixtureStdio');
  assert.match(source, /--approved-operator-stdio/);
  assert.match(source, /IdentityHttpClients\.defaultCredential\(\)/);
  assert.match(source, /EntraPgConnectionFactory\.fromEnvironment\("contoso-inventory-api", credential\)/);
  assert.match(source, /LettuceInventoryCache\.fromEnvironment\(credential\)/);
  assert.match(source, /InventoryFixtureRun\.capture\(/);
  assert.match(source, /run\.prepare\(context\)/);
  assert.match(source, /run\.reset\(context\)/);
  assert.match(source, /INCOMPLETE_RESET/);
  assert.doesNotMatch(source, /ObjectMapper|readTree|readValue|ProcessBuilder|Runtime\.getRuntime|HttpServer|@RestController/);
});

test('SOURCE ONLY: retry checkpoints precede SQL mutation, bind observed state and clear only after verified restoration', async () => {
  const source = await java('InventoryFixtureRun');
  const reset = source.slice(source.indexOf('public synchronized ResetReceipt reset('), source.indexOf('private void retainRestoreCheckpoint('));
  assert(reset.indexOf('retainRestoreCheckpoint(current, owned, currentCache, context)') < reset.indexOf('DELETE FROM contoso.inventory_reservation'));
  assert.match(source, /restoreCheckpoint\.invocation\(\)\.equals\(context\.invocationId\(\)\.uuid\(\)\)/);
  assert.match(source, /restoreCheckpoint\.item\(\)\.equals\(current\)[\s\S]*restoreCheckpoint\.reservations\(\)\.equals\(owned\)/);
  assert.match(source, /sql\.item\(\)\.equals\(current\) && owned\.isEmpty\(\)/);
  assert.match(source, /matches\(restoreCheckpoint\.cache\(\), currentCache, now\)/);
  assert(reset.indexOf('if (!expected.equals(observed))') < reset.indexOf('restoreCheckpoint = null'));
});

test('SOURCE ONLY: offline runner isolates outputs and explicitly selects no native qualification test', async () => {
  const runner = await readFile(path.join(module, 'tools', 'Test-InventoryFixture.ps1'), 'utf8');
  assert.match(runner, /& \$maven -o -B -ntp -f \$pomPath test/);
  assert.match(runner, /directory = \(Join-Path \$run 'build'\)/);
  assert.match(runner, /InventoryFixtureRunTest,InventoryFixtureStdioTest/);
  assert.match(runner, /before\.sha256 -ne \$after\.sha256/);
  assert.doesNotMatch(runner, /DataAgentQualificationTest|mvn.*\b(?:install|verify|package|clean)\b/);
});

test('SOURCE ONLY: handoff discloses actual prerequisites, bounded hash coverage and missing durable recovery', async () => {
  const contract = await readFile(path.join(module, 'tools', 'InventoryFixtureContract.md'), 'utf8');
  for (const required of ['construction code', 'unowned cache coverage', 'declared witnesses',
    'CONTOSO_PG_USERNAME', 'PXAT', 'restoreCapturedRun(saved summary)', 'not implemented',
    'hash-pinned complete runtime', 'not authentication', 'not** been run']) {
    assert(contract.toLowerCase().includes(required.toLowerCase()), required);
  }
});
