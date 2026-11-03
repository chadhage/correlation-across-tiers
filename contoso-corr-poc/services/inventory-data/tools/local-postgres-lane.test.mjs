import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const module = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(module, '..', '..');
const java = (folder, name) => readFile(path.join(module, 'src', folder, 'java', 'com', 'contoso', 'inventory', 'data', `${name}.java`), 'utf8');
const lane = await java('test', 'LocalPostgresLane');

function assertRealPostgresSource(source) {
  assert.match(source, /new PGSimpleDataSource\(\)/);
  assert.match(source, /assertEquals\("PostgreSQL", control\.getMetaData\(\)\.getDatabaseProductName\(\)\)/);
  assert.match(source, /assertEquals\(18, control\.getMetaData\(\)\.getDatabaseMajorVersion\(\)\)/);
  assert.match(source, /SELECT inet_server_addr\(\)::text/);
  assert.doesNotMatch(source, /JdbcDataSource|jdbc:h2|RespFixture|DataFixture|Mockito|Proxy\.newProxyInstance/);
}

test('SOURCE ONLY: real PostgreSQL lane is explicit, loopback-only and excluded from default Surefire name patterns', () => {
  assert.match(lane, /final class LocalPostgresLane \{/);
  assert.match(lane, /"run-owned-only"\.equals\(environment\.get\("CONTOSO_LOCAL_PG_ALLOW_CREATE_DROP"\)\)/);
  assert.match(lane, /!"127\.0\.0\.1"\.equals\(environment\.get\("CONTOSO_LOCAL_PG_HOST"\)\)/);
  assert.match(lane, /Settings\.parse\(System\.getenv\(\)\)/);
  assert.doesNotMatch(lane, /Assumptions|assumeTrue|EnabledIf|DisabledIf|@Disabled/);
  assertRealPostgresSource(lane);
});

test('SOURCE ONLY: actual V001 and shared production grant statements feed the real adapter', () => {
  assert.equal((lane.match(/InventorySchemaHooks\.applyV001\(administrator\)/g) ?? []).length, 2);
  assert.match(lane, /InventorySchemaHooks\.inventoryGrantStatements\(settings\.role\(\)\)/);
  assert.equal((lane.match(/for \(String grant : InventorySchemaHooks\.inventoryGrantStatements/g) ?? []).length, 2);
  assert.match(lane, /GRANT ALL PRIVILEGES ON contoso\.environment_marker TO /);
  assert.match(lane, /has_column_privilege\(current_user,'contoso\.environment_marker','/);
  assert.match(lane, /new PgRedisInventoryDataAdapter\(connections, new PostgresOnlyCache\(\), settings\.marker\(\)\)/);
  assert.match(lane, /adapter\.reserveInventory/);
  assert.match(lane, /adapter\.releaseInventory/);
  assert.match(lane, /assertDenied\(settings/);
  assert.match(lane, /"23514", immutable\.getSQLState\(\)/);
  assert.match(lane, /"23502", nonnull\.getSQLState\(\)/);
});

test('CONTROL: real-store policy rejects H2, RESP, proxies and missing PostgreSQL product verification', () => {
  for (const added of ['jdbc:h2:mem:substitute', 'new RespFixture()', 'Proxy.newProxyInstance']) {
    assert.throws(() => assertRealPostgresSource(lane + '\n' + added));
  }
  assert.throws(() => assertRealPostgresSource(lane.replace('"PostgreSQL"', '"H2"')));
});

test('SOURCE ONLY: cleanup adopts no existing state and drops only successfully created exact run-owned objects', () => {
  assert(lane.indexOf('"Existing databases are never adopted or dropped"') < lane.indexOf('CREATE DATABASE'));
  assert(lane.indexOf('"Existing roles are never adopted or dropped"') < lane.indexOf('CREATE ROLE'));
  assert.match(lane, /if \(databaseCreated\) \{[\s\S]*?DROP DATABASE/);
  assert.match(lane, /if \(roleCreated\) \{[\s\S]*?DROP ROLE/);
  assert.doesNotMatch(lane, /WITH \(FORCE\)|pg_terminate_backend|DROP OWNED|CASCADE|TRUNCATE TABLE|DELETE FROM [^\r\n"]+ WHERE (?!FALSE)/);
  assert.match(lane, /LOCAL-WITNESS/);
});

test('SOURCE ONLY: PostgreSQL row-lock grant preserves every marker provenance field', async () => {
  const hooks = await java('main', 'InventorySchemaHooks');
  assert.match(hooks, /static List<String> inventoryGrantStatements\(String roleName\)/);
  assert.match(hooks, /GRANT SELECT,UPDATE\(singleton\) ON contoso\.environment_marker TO /);
  assert.doesNotMatch(hooks, /GRANT (?:ALL|UPDATE) ON contoso\.environment_marker/);
  assert.match(hooks, /REVOKE ALL PRIVILEGES ON contoso\.environment_marker FROM /);
  const migration = await readFile(path.join(module, 'src', 'main', 'resources', 'db', 'migration', 'V001__inventory.sql'), 'utf8');
  const guarded = source => {
    assert.match(source, /singleton BOOLEAN PRIMARY KEY CHECK \(singleton = TRUE\)/);
    assert.match(source, /workload VARCHAR\(32\) NOT NULL CHECK \(workload = 'contoso-corr'\)/);
    assert.match(source, /environment VARCHAR\(16\) NOT NULL CHECK \(environment = 'poc'\)/);
    assert.match(source, /seed_version INTEGER NOT NULL CHECK \(seed_version = 1\)/);
  };
  guarded(migration);
  assert.throws(() => guarded(migration.replace('PRIMARY KEY ', '')));
  assert.throws(() => guarded(migration.replace('CHECK (singleton = TRUE)', '')));
  const workflow = await readFile(path.join(module, 'src', 'main', 'resources', 'db', 'grants', 'workflow', 'common.sql'), 'utf8');
  assert.doesNotMatch(workflow, /GRANT[^;]*UPDATE[^;]*environment_marker/);
});

test('DOCUMENTATION ONLY: unexecuted real PostgreSQL requirements are not H2, Redis, Entra or native proof', async () => {
  const doc = await readFile(path.join(root, 'tools', 'data', 'LocalPostgresLane.md'), 'utf8');
  for (const text of ['NOT EXECUTED', 'SET ROLE', 'not Entra', 'PostgresOnlyCache', 'LocalPostgresLaneContractTest',
    'run-owned-only', 'To Do', 'no PostgreSQL binary', 'pg_terminate_backend']) assert(doc.includes(text), text);
});
