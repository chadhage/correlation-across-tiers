import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const module = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(module, '..', '..');
const java = name => readFile(path.join(module, 'src', 'main', 'java', 'com', 'contoso', 'inventory', 'data', `${name}.java`), 'utf8');
const grant = name => readFile(path.join(module, 'src', 'main', 'resources', 'db', 'grants', 'workflow', `${name}.sql`), 'utf8');
const columns = value => value.split(',').map(column => column.trim());

function schemaTables(sql) {
  const result = new Map();
  for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS contoso\.(async_\w+)\s*\(/g)) {
    let depth = 1, end = match.index + match[0].length;
    const start = end;
    while (depth && end < sql.length) {
      if (sql[end] === '(') depth++;
      if (sql[end] === ')') depth--;
      end++;
    }
    assert.equal(depth, 0, match[1]);
    const fields = [...sql.slice(start, end - 1).matchAll(/^\s*([a-z][a-z0-9_]*)\s+(?:UUID|VARCHAR|CHAR|INTEGER|BIGINT|BOOLEAN|TIMESTAMP)\b/gm)].map(value => value[1]);
    result.set(match[1], new Set(fields));
  }
  return result;
}

function columnPrivileges(sql, table) {
  const result = [];
  for (const statement of sql.split(';').filter(value => value.trim().startsWith('GRANT '))) {
    const match = /\bON contoso\.(async_\w+) TO __ROLE__\s*$/.exec(statement);
    if (!match || (table && match[1] !== table)) continue;
    for (const operation of statement.matchAll(/\b(INSERT|UPDATE)\(([^)]*)\)/g)) {
      result.push({ table: match[1], operation: operation[1], columns: columns(operation[2]) });
    }
    assert.doesNotMatch(statement, /\b(?:INSERT|UPDATE)\s+(?:,|ON)\b/, statement);
  }
  return result;
}

test('SOURCE ONLY: all default data entry points use one isolated factory and preserve credential injection', async () => {
  const [pg, cache, adapter, pom] = await Promise.all([
    java('EntraPgConnectionFactory'), java('LettuceInventoryCache'), java('PgRedisInventoryDataAdapter'),
    readFile(path.join(module, 'pom.xml'), 'utf8')
  ]);
  for (const source of [pg, cache, adapter]) {
    assert.match(source, /IdentityHttpClients\.managedIdentity\(/);
    assert.doesNotMatch(source, /new (?:ManagedIdentityCredentialBuilder|DefaultAzureCredentialBuilder)|HttpClientProvider/);
  }
  assert.match(pom, /<groupId>com\.contoso<\/groupId><artifactId>security-core<\/artifactId><\/dependency>/);
  assert.match(pg, /fromEnvironment\(String serviceName, TokenCredential credential\)/);
  assert.match(cache, /fromEnvironment\(TokenCredential credential\)/);
  assert.match(adapter, /fromEnvironment\(TokenCredential credential\)/);
  assert.match(adapter, /EntraPgConnectionFactory\.fromEnvironment\("contoso-inventory-api", credential\)/);
  assert.match(adapter, /LettuceInventoryCache\.fromEnvironment\(credential\)/);
});

test('SOURCE ONLY: public AuthX credential callback keeps fixed audience, bounds, renewal and native TLS transport', async () => {
  const [cache, supplier, pg] = await Promise.all([
    java('LettuceInventoryCache'), java('RedisEntraIdAuthenticationSupplier'), java('EntraPgConnectionFactory')
  ]);
  assert.match(cache, /customEntraIdAuthenticationSupplier\(new RedisEntraIdAuthenticationSupplier\(credential\)\)/);
  assert.match(cache, /TokenBasedRedisCredentialsProvider\.create\(builder\.build\(\)\)/);
  assert.doesNotMatch(cache, /builder\.(?:systemAssignedManagedIdentity|userAssignedManagedIdentity|defaultAzureCredential)\(/);
  assert.match(supplier, /credential\.getToken\(new TokenRequestContext\(\)\.addScopes\(SCOPE\)\)/);
  assert.match(supplier, /https:\/\/redis\.azure\.com\/\.default/);
  assert.match(supplier, /\.timeout\(budget\)\.block\(budget\)/);
  assert.doesNotMatch(supplier, /traceparent|tracestate|InvocationId|business\.invocation_id|HttpClientBuilder|PublicClientApplication|ConfidentialClientApplication/);
  for (const value of ['ON_NEW_CREDENTIALS', 'REJECT_COMMANDS', 'requestQueueSize(64)', 'replayFilter(command -> false)', 'SslVerifyMode.FULL']) {
    assert(cache.includes(value), value);
  }
  assert.match(pg, /setSslMode\("verify-full"\)/);
  assert.match(pg, /org\.postgresql\.ssl\.DefaultJavaSSLFactory/);
});

test('SOURCE ONLY: workflow grants match all actual V002 columns and never assign protected provenance defaults', async () => {
  const schema = schemaTables(await readFile(path.join(root, 'workers', 'messaging-core', 'src', 'main', 'resources', 'db', 'messaging', 'V002__messaging.sql'), 'utf8'));
  assert.equal(schema.size, 11);
  const common = await grant('common');
  for (const table of schema.keys()) assert(common.includes(`contoso.${table}`), table);
  for (const name of ['orders', 'worker', 'aggregator']) {
    const sql = await grant(name);
    for (const permission of columnPrivileges(sql)) {
      const fields = schema.get(permission.table);
      assert(fields, permission.table);
      for (const column of permission.columns) {
        assert(fields.has(column), `${permission.table}.${column}`);
        assert(!['owner', 'publisher', 'receiver', 'creator', 'created_at'].includes(column), `${permission.table}.${column}`);
      }
      if (permission.operation === 'UPDATE') {
        assert(!['async_publication', 'async_effect', 'async_contributor', 'async_replay', 'async_quarantine'].includes(permission.table));
      }
    }
  }
  assert.match(common, /REVOKE ALL PRIVILEGES ON contoso\.async_workflow/);
  assert.match(common, /REVOKE INSERT\(original_message_id,source,workflow_id,new_message_id,owner,created_at\),UPDATE\(/);
});

test('SOURCE ONLY: checked builder close is sanitized and failed handoff closes the created provider', async () => {
  const cache = await java('LettuceInventoryCache');
  const start = cache.indexOf('static <T extends AutoCloseable> T credentialsLifecycle');
  const end = cache.indexOf('private static OwnedInventoryCache open', start);
  const lifecycle = cache.slice(start, end);
  assert.match(cache, /return credentialsLifecycle\(builder, \(\) ->/);
  assert.match(lifecycle, /try \(builder\)/);
  assert.match(lifecycle, /catch \(Exception failure\)/);
  assert.match(lifecycle, /provider\.close\(\)/);
  assert.match(lifecycle, /catch \(Exception cleanupFailure\)[\s\S]*?throw new DataAccessException\(DataErrorKind\.UNAVAILABLE, false\)/);
  assert.doesNotMatch(lifecycle, /catch \([^)]*\bignored\b/);
});

test('SOURCE ONLY: inventory and workflow privilege mutations both require a locked bound dataset marker first', async () => {
  const hooks = await java('InventorySchemaHooks');
  const inventoryStart = hooks.indexOf('public static void grantInventory(');
  const workflowStart = hooks.indexOf('public static void grantWorkflow(');
  const inventory = hooks.slice(inventoryStart, workflowStart);
  assert(inventory.indexOf('verifyBoundDataset(connection, permit)') >= 0);
  assert(inventory.indexOf('verifyBoundDataset(connection, permit)') < inventory.indexOf('statement.execute('));
  assert.match(hooks.slice(workflowStart), /verifyBoundDataset\(connection, permit\)/);
  assert.match(hooks, /static void verifyBoundDataset\(Connection connection, Permit permit\)/);
  assert.match(hooks, /expected_resource_id,workload,environment,seed_version[\s\S]*?FOR UPDATE/);
  for (const predicate of [
    '!rows.next()', '!permit.expectedResourceId().equals(rows.getString(1))',
    '!"contoso-corr".equals(rows.getString(2))', '!"poc".equals(rows.getString(3))', 'rows.getInt(4) != 1'
  ]) assert(hooks.includes(predicate), predicate);
});

test('SOURCE ONLY: targeted replay flag and immutable source/composite message identity remain compatible', async () => {
  const [orders, worker, aggregate, schema] = await Promise.all([
    grant('orders'), grant('worker'), grant('aggregator'),
    readFile(path.join(root, 'workers', 'messaging-core', 'src', 'main', 'resources', 'db', 'messaging', 'V002__messaging.sql'), 'utf8')
  ]);
  for (const operation of ['INSERT', 'UPDATE']) {
    assert(columnPrivileges(orders, 'async_fault').some(value =>
      value.operation === operation && value.columns.includes('replay_requested')));
  }
  assert(columnPrivileges(worker, 'async_replay').some(value => value.operation === 'INSERT' &&
    value.columns.join(',') === 'original_message_id,source,workflow_id,new_message_id'));
  assert.equal(columnPrivileges(worker, 'async_replay').some(value => value.operation === 'UPDATE'), false);
  assert.equal(columnPrivileges(aggregate, 'async_replay').length, 0);
  assert.match(schema, /PRIMARY KEY\(original_message_id,source\)/);
  assert.match(schema, /PRIMARY KEY\(workflow_id,target\)/);
});

test('SOURCE ONLY: aggregator reads protected replay/publication provenance for trust and fan-in without mutation', async () => {
  const [common, aggregate, store] = await Promise.all([
    grant('common'), grant('aggregator'),
    readFile(path.join(root, 'workers', 'messaging-core', 'src', 'main', 'java', 'com', 'contoso', 'messaging', 'PgMessagingStore.java'), 'utf8')
  ]);
  assert.match(store, /SELECT owner FROM contoso\.async_replay WHERE original_message_id=\? AND new_message_id=\? AND workflow_id=\?/);
  assert.match(store, /SELECT source FROM contoso\.async_replay WHERE original_message_id=\? AND new_message_id=\? AND workflow_id=\?/);
  assert.match(store, /SELECT c\.publisher,p\.envelope_json FROM contoso\.async_contributor c JOIN contoso\.async_publication p/);
  const readGrant = common.split(';').find(statement => statement.trim().startsWith('GRANT SELECT ON '));
  assert(readGrant);
  for (const table of ['async_replay', 'async_publication', 'async_contributor']) {
    assert(readGrant.includes(`contoso.${table}`));
    assert.equal(columnPrivileges(aggregate, table).length, 0);
    assert(!aggregate.split(';').some(statement => statement.trim().startsWith('GRANT ') && statement.includes(`contoso.${table}`)));
  }
});

test('SOURCE ONLY: bootstrap grants require explicit approval, target/database binding and nonadmin Entra principal', async () => {
  const [hooks, pg, cache, adapter] = await Promise.all([
    java('InventorySchemaHooks'), java('EntraPgConnectionFactory'), java('LettuceInventoryCache'), java('PgRedisInventoryDataAdapter')
  ]);
  assert.match(hooks, /grantWorkflow\(PgConnectionFactory administrator, Permit permit, Principal principal,/);
  assert.match(hooks, /enum WorkflowRole \{ ORDERS, FULFILLMENT, NOTIFY, AGGREGATOR \}/);
  assert.match(hooks, /!permit\.executionApproved\(\)/);
  assert.match(hooks, /verifyRuntimePrincipal\(connection, principal\)/);
  assert.match(hooks, /rolsuper,rolcreatedb,rolcreaterole,rolbypassrls/);
  assert.match(hooks, /pgaadauth_list_principals\(FALSE\) WHERE rolename=\?/);
  assert.match(hooks, /principal\.objectId\(\)\.equalsIgnoreCase\(rows\.getString\(1\)\)/);
  for (const source of [pg, cache, adapter]) assert.doesNotMatch(source, /grantWorkflow|grantInventory|\.install\(/);
});

test('SOURCE ONLY: GA PG18/Managed Redis private endpoint contracts are not replaced with legacy or preview APIs', async () => {
  const [pg, redis] = await Promise.all([
    readFile(path.join(root, 'infra', 'modules', 'data-postgres.bicep'), 'utf8'),
    readFile(path.join(root, 'infra', 'modules', 'data-managed-redis.bicep'), 'utf8')
  ]);
  assert.match(pg, /flexibleServers@2026-10-01/);
  assert.match(pg, /postgresMajorVersion string = '18'/);
  assert.match(pg, /passwordAuth: 'Disabled'/);
  assert.match(pg, /sslMode: 'verify-full'/);
  assert.match(redis, /redisEnterprise@2026-09-01/);
  assert.match(redis, /EnterpriseCluster/);
  assert.match(redis, /accessPolicyName: 'default'/);
  assert.match(redis, /accessKeysAuthentication: 'Disabled'/);
  assert.match(redis, /privatelink\.redis\.azure\.net/);
  assert.match(redis, /host: cluster\.properties\.hostName/);
  assert.doesNotMatch(redis, /resource\s+\w+\s+'Microsoft\.Cache\/Redis@|listKeys\(/);
  assert.doesNotMatch(pg + redis, /@[^'\n]*preview|administratorLoginPassword/);
});
