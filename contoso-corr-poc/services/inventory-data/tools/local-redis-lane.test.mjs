import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const module = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(module, '..', '..');
const java = name => readFile(path.join(module, 'src', 'test', 'java', 'com', 'contoso', 'inventory', 'data', `${name}.java`), 'utf8');
const lane = await java('LocalRedisLane');

function assertRealRedisSource(source) {
  assert.match(source, /RedisClient\.create\(resources, settings\.uri\(\)\)/);
  assert.match(source, /observer\.sync\(\)\.info\("server"\)/);
  assert.match(source, /redis_version:/);
  assert.match(source, /redis_mode:standalone/);
  assert.match(source, /new LettuceInventoryCache\("127\.0\.0\.1", cacheClient, cacheClient\.connect\(\)/);
  assert.doesNotMatch(source, /RespFixture|DataFixture|jdbc:h2|Mockito|Proxy\.newProxyInstance/);
}

test('SOURCE ONLY: real Redis lane is explicit and uses actual Redis plus the unchanged production adapter', () => {
  assert.match(lane, /final class LocalRedisLane \{/);
  assert.match(lane, /Settings\.parse\(System\.getenv\(\)\)/);
  assert.match(lane, /"run-owned-only"\.equals\(environment\.get\("CONTOSO_LOCAL_REDIS_ALLOW_OWNED_KEYS"\)\)/);
  assert.match(lane, /!"127\.0\.0\.1"\.equals\(environment\.get\("CONTOSO_LOCAL_REDIS_HOST"\)\)/);
  assert.match(lane, /!"10000"\.equals\(environment\.get\("CONTOSO_LOCAL_REDIS_PORT"\)\)/);
  assert.doesNotMatch(lane, /Assumptions|assumeTrue|EnabledIf|DisabledIf|@Disabled/);
  assertRealRedisSource(lane);
});

test('CONTROL: fake RESP, H2, proxies or missing actual Redis product evidence cannot qualify the source lane', () => {
  for (const added of ['new RespFixture()', 'jdbc:h2:mem:substitute', 'Proxy.newProxyInstance']) {
    assert.throws(() => assertRealRedisSource(lane + '\n' + added));
  }
  assert.throws(() => assertRealRedisSource(lane.replace('info("server")', 'ping()')));
});

test('SOURCE ONLY: real cache operations check TTL, canonical/error safety, restoration and a declared witness', () => {
  for (const operation of ['get', 'put', 'invalidate', 'capture', 'restore']) {
    assert(lane.includes(`cache.${operation}(`), operation);
  }
  assert.match(lane, /restoredTtl > 0 && restoredTtl <= 20_000/);
  assert.match(lane, /assertFalse\(corrupt\.toString\(\)\.contains\("CANARY"\)\)/);
  assert.match(lane, /assertNull\(corrupt\.getCause\(\)\)/);
  assert.match(lane, /"23:41"\.equals\(observer\.sync\(\)\.get\(settings\.key\("WITNESS"\)\)\)/);
});

test('SOURCE ONLY: NX ownership and watched exact-key cleanup never use a global Redis command', () => {
  assert.match(lane, /new SetArgs\(\)\.nx\(\)\.px\(90_000\)/);
  assert.match(lane, /claimed\.add\(key\)/);
  assert.match(lane, /String\[\] keys = claimed\.toArray\(String\[\]::new\)/);
  assert.match(lane, /commands\.watch\(keys\)/);
  assert.match(lane, /commands\.del\(keys\)/);
  assert.match(lane, /result\.wasDiscarded\(\)/);
  assert.match(lane, /commands\.exists\(key\)/);
  assert.doesNotMatch(lane, /\.(?:flushall|flushdb|keys|scan|eval|script|config|acl)\s*\(/i);
  assert.match(lane, /resources\.shutdown\(0, 2, TimeUnit\.SECONDS\)/);
});

test('DOCUMENTATION ONLY: configuration and parser tests cannot be promoted into real Redis or Entra evidence', async () => {
  const doc = await readFile(path.join(root, 'tools', 'data', 'LocalRedisLane.md'), 'utf8');
  for (const text of ['NOT EXECUTED', 'To Do', 'INPUTS_VALID_NOT_CONNECTED', 'realStoreExecuted: false',
    'LocalRedisLaneContractTest', 'not a Managed Redis', 'never replaced by a RESP peer', '10000']) {
    assert(doc.includes(text), text);
  }
});
