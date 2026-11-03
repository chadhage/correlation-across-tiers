import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateLocalRedisEnvironment } from './local-redis-preflight.mjs';

const environment = () => ({
  CONTOSO_LOCAL_REDIS_ALLOW_OWNED_KEYS: 'run-owned-only',
  CONTOSO_LOCAL_REDIS_HOST: '127.0.0.1',
  CONTOSO_LOCAL_REDIS_PORT: '10000',
  CONTOSO_LOCAL_REDIS_RUN_ID: 'd4787bb0-c876-4c62-9edf-fc17d79c68c8'
});
const run = provided => {
  const env = { ...process.env };
  for (const name of Object.keys(env)) if (name.startsWith('CONTOSO_LOCAL_REDIS_')) delete env[name];
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [fileURLToPath(new URL('./local-redis-preflight.mjs', import.meta.url))], {
    encoding: 'utf8', timeout: 10000, env: { ...env, ...provided }
  });
};

test('LOCAL CONFIGURATION ONLY: explicit loopback approval derives unique bounded cache key inputs', () => {
  const settings = validateLocalRedisEnvironment(environment());
  assert.equal(settings.host, '127.0.0.1');
  assert.equal(settings.port, 10000);
  assert.equal(settings.skuPrefix, 'LOCAL_D4787BB0C8764C629EDFFC17D79C68C8');
  assert.equal(settings.authenticated, false);
  assert(Object.isFrozen(settings));
});

test('CONTROL: default-off approval and every required target input fail closed', () => {
  for (const name of Object.keys(environment())) {
    const env = environment();
    delete env[name];
    assert.throws(() => validateLocalRedisEnvironment(env));
  }
  assert.throws(() => validateLocalRedisEnvironment({
    ...environment(), CONTOSO_LOCAL_REDIS_ALLOW_OWNED_KEYS: 'true'
  }));
});

test('CONTROL: remote, DNS, wildcard, tunnel-shaped and ambiguous loopback target strings are rejected', () => {
  for (const host of ['localhost', '::1', '0.0.0.0', '127.0.0.2', '127.0.0.1.example',
    'contoso-cache.redis.azure.net', 'redis://127.0.0.1:10000']) {
    assert.throws(() => validateLocalRedisEnvironment({ ...environment(), CONTOSO_LOCAL_REDIS_HOST: host }));
  }
});

test('CONTROL: noncanonical run IDs and nonmatching production-adapter telemetry ports are rejected', () => {
  for (const runId of ['00000000-0000-0000-0000-000000000000', '1-1-1-1-1', 'not-a-run',
    environment().CONTOSO_LOCAL_REDIS_RUN_ID.toUpperCase()]) {
    assert.throws(() => validateLocalRedisEnvironment({ ...environment(), CONTOSO_LOCAL_REDIS_RUN_ID: runId }));
  }
  for (const port of ['6379', '0', '65536', '10000;FLUSHALL', ' 10000']) {
    assert.throws(() => validateLocalRedisEnvironment({ ...environment(), CONTOSO_LOCAL_REDIS_PORT: port }));
  }
});

test('LOCAL CONFIGURATION ONLY: optional credentials are validated but never returned or printed', () => {
  const env = { ...environment(), CONTOSO_LOCAL_REDIS_USERNAME: 'local_user', CONTOSO_LOCAL_REDIS_PASSWORD: 'LOCAL_AUTH_CANARY' };
  const settings = validateLocalRedisEnvironment(env);
  assert.equal(settings.authenticated, true);
  assert.doesNotMatch(JSON.stringify(settings), /CANARY|local_user/);
  const result = run(env);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /CANARY|local_user/);
  assert.equal(JSON.parse(result.stdout).realStoreExecuted, false);
  assert.equal(JSON.parse(result.stdout).status, 'INPUTS_VALID_NOT_CONNECTED');
});

test('CONTROL: malformed optional authentication fails without echoing credentials', () => {
  for (const credentials of [
    { CONTOSO_LOCAL_REDIS_USERNAME: 'local_user' },
    { CONTOSO_LOCAL_REDIS_USERNAME: 'bad user', CONTOSO_LOCAL_REDIS_PASSWORD: 'LOCAL_AUTH_CANARY' },
    { CONTOSO_LOCAL_REDIS_PASSWORD: '' }
  ]) {
    assert.throws(() => validateLocalRedisEnvironment({ ...environment(), ...credentials }),
      /local_redis_optional_credentials_invalid/);
  }
});

test('EXECUTABLE NEGATIVE: default CLI reports BLOCKED, never skipped or real-store success', () => {
  const result = run({});
  assert.equal(result.status, 2, result.stdout);
  const receipt = JSON.parse(result.stderr);
  assert.equal(receipt.status, 'BLOCKED');
  assert.equal(receipt.scope, 'LOCAL_CONFIGURATION_ONLY');
  assert.equal(receipt.realStoreExecuted, false);
  assert.equal(receipt.nativeExecution, false);
  assert.doesNotMatch(result.stderr, /PASSWORD|username|127\.0\.0\.1/);
});
