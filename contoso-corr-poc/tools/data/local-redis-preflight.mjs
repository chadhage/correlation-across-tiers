import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function validateLocalRedisEnvironment(environment) {
  if (environment.CONTOSO_LOCAL_REDIS_ALLOW_OWNED_KEYS !== 'run-owned-only' ||
      environment.CONTOSO_LOCAL_REDIS_HOST !== '127.0.0.1') {
    throw new Error('local_redis_explicit_loopback_approval_required');
  }
  const runId = environment.CONTOSO_LOCAL_REDIS_RUN_ID;
  if (typeof runId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(runId) ||
      runId === '00000000-0000-0000-0000-000000000000' || environment.CONTOSO_LOCAL_REDIS_PORT !== '10000') {
    throw new Error('local_redis_canonical_run_and_port_10000_required');
  }
  const username = environment.CONTOSO_LOCAL_REDIS_USERNAME;
  const password = environment.CONTOSO_LOCAL_REDIS_PASSWORD;
  if ((username !== undefined && (typeof username !== 'string' || !/^[A-Za-z0-9_-]{1,63}$/.test(username))) ||
      (password !== undefined && (typeof password !== 'string' || password.length === 0)) ||
      (username !== undefined && password === undefined)) {
    throw new Error('local_redis_optional_credentials_invalid');
  }
  return Object.freeze({
    host: '127.0.0.1',
    port: 10000,
    runId,
    skuPrefix: `LOCAL_${runId.replaceAll('-', '').toUpperCase()}`,
    authenticated: password !== undefined
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const settings = validateLocalRedisEnvironment(process.env);
    console.log(JSON.stringify({
      schema: 'contoso.local-redis-preflight.v1',
      scope: 'LOCAL_CONFIGURATION_ONLY',
      status: 'INPUTS_VALID_NOT_CONNECTED',
      realStoreExecuted: false,
      nativeExecution: false,
      settings
    }));
  } catch (failure) {
    console.error(JSON.stringify({
      schema: 'contoso.local-redis-preflight.v1',
      scope: 'LOCAL_CONFIGURATION_ONLY',
      status: 'BLOCKED',
      realStoreExecuted: false,
      nativeExecution: false,
      error: failure.message
    }));
    process.exitCode = 2;
  }
}
