import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { decodeLogsQueryResult } from '../../observability/raw-query.mjs';
import { normalizeTelemetryRows, ownedConfigurationHash, UUID } from '../../observability/telemetry-contract.mjs';
import { scanGraphIntake } from '../../security/telemetry.mjs';
import { parseBoundedObservationJson } from '../../security/native-payload.mjs';
import { projectRoot, readBoundFile, sha256 } from '../files.mjs';
import { immutableReceiptMetadata } from '../observers.mjs';
import { BROWSER_SOURCE_PATHS, verifyBrowserSources } from './demo01-browser.mjs';

const TABLES = ['AppRequests', 'AppDependencies', 'AppTraces', 'AppExceptions', 'AppEvents', 'AppPageViews'];
const GUID = /^(?!00000000-0000-0000-0000-000000000000$)[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const requirePortal = createRequire(path.join(projectRoot, 'web', 'portal-ssr', 'package.json'));
export function exampleFailure(code, details = {}) {
  return Object.assign(new Error(code), { code, ...details });
}
const fail = code => { throw exampleFailure(code); };
const exact = (object, keys) => {
  if (!object || Object.getPrototypeOf(object) !== Object.prototype ||
      Object.keys(object).some(key => !keys.includes(key))) fail('AZURE_EXAMPLE_INPUT_INVALID');
};

function origin(value) {
  let url;
  try { url = new URL(value); } catch { fail('AZURE_EXAMPLE_HTTPS_ORIGIN_REQUIRED'); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) fail('AZURE_EXAMPLE_HTTPS_ORIGIN_REQUIRED');
  return value;
}

export function validateAzureExampleConfig(value) {
  exact(value, ['schema', 'operatorOrigin', 'operatorTokenScope', 'portalOrigin', 'ordersTokenScope',
    'managedIdentityClientId', 'operatorTokenEnvironment', 'portalTokenEnvironment', 'userTokenEnvironment',
    'browserStorageStateFile', 'headless', 'settleSeconds', 'ingestionGraceSeconds', 'waitSeconds',
    'pageSize', 'maxRows', 'load']);
  if (value.schema !== 'contoso.azure-examples.v1') fail('AZURE_EXAMPLE_CONFIG_SCHEMA');
  origin(value.operatorOrigin); origin(value.portalOrigin);
  for (const field of ['operatorTokenScope', 'ordersTokenScope']) {
    const match = /^api:\/\/([^/]+)\/\.default$/.exec(value[field] ?? '');
    if (!match || !GUID.test(match[1])) fail('AZURE_EXAMPLE_TOKEN_SCOPE_REQUIRED');
  }
  if (value.operatorTokenScope === value.ordersTokenScope) fail('AZURE_EXAMPLE_SEPARATE_OPERATOR_AUDIENCE_REQUIRED');
  if (value.managedIdentityClientId !== null && !GUID.test(value.managedIdentityClientId ?? '')) fail('AZURE_EXAMPLE_IDENTITY_INVALID');
  for (const field of ['operatorTokenEnvironment', 'portalTokenEnvironment', 'userTokenEnvironment']) {
    if (value[field] !== null && !/^[A-Z][A-Z0-9_]{0,80}$/.test(value[field] ?? '')) fail('AZURE_EXAMPLE_CREDENTIAL_REFERENCE_INVALID');
  }
  if (value.browserStorageStateFile !== null) {
    if (typeof value.browserStorageStateFile !== 'string' || !path.isAbsolute(value.browserStorageStateFile)) {
      fail('AZURE_EXAMPLE_EXTERNAL_BROWSER_STATE_REQUIRED');
    }
    const relative = path.relative(projectRoot, value.browserStorageStateFile);
    if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
      fail('AZURE_EXAMPLE_BROWSER_CREDENTIALS_MUST_STAY_OUTSIDE_REPOSITORY');
    }
  }
  if (typeof value.headless !== 'boolean') fail('AZURE_EXAMPLE_BROWSER_MODE_REQUIRED');
  for (const [field, minimum, maximum] of [
    ['settleSeconds', 30, 120], ['ingestionGraceSeconds', 30, 180], ['waitSeconds', 30, 600],
    ['pageSize', 1, 5000], ['maxRows', 1, 100000]
  ]) {
    if (!Number.isInteger(value[field]) || value[field] < minimum || value[field] > maximum) fail('AZURE_EXAMPLE_BOUNDS_INVALID');
  }
  exact(value.load, ['requestsPerSecond', 'durationSeconds']);
  if (!Number.isInteger(value.load.requestsPerSecond) || value.load.requestsPerSecond < 1 || value.load.requestsPerSecond > 10 ||
      !Number.isInteger(value.load.durationSeconds) || value.load.durationSeconds < 1 || value.load.durationSeconds > 120) {
    fail('AZURE_EXAMPLE_LOAD_BOUNDS_INVALID');
  }
  return structuredClone(value);
}

export function createExampleCredentials(config) {
  let credential;
  return async (profile, signal) => {
    const environment = profile === 'operator' ? config.operatorTokenEnvironment :
      profile === 'portal' ? config.portalTokenEnvironment : config.userTokenEnvironment;
    if (environment !== null) {
      const token = process.env[environment];
      if (!token) fail('AZURE_EXAMPLE_TOKEN_ENVIRONMENT_REQUIRED');
      if (token.length > 8192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
        fail('AZURE_EXAMPLE_TOKEN_INVALID');
      }
      return token;
    }
    if (profile === 'user') fail('AZURE_EXAMPLE_DELEGATED_USER_TOKEN_REQUIRED');
    if (!credential) {
      let identity;
      try { identity = requirePortal('@azure/identity'); }
      catch { fail('AZURE_EXAMPLE_RESTORE_PORTAL_DEPENDENCIES'); }
      credential = new identity.DefaultAzureCredential({
        ...(config.managedIdentityClientId ? { managedIdentityClientId: config.managedIdentityClientId } : {})
      });
    }
    const result = await credential.getToken(profile === 'operator' ? config.operatorTokenScope : config.ordersTokenScope,
      { abortSignal: signal ?? AbortSignal.timeout(10000) });
    if (!result || result.expiresOnTimestamp < Date.now() + 30000) fail('AZURE_EXAMPLE_TOKEN_UNAVAILABLE');
    return result.token;
  };
}

export async function boundedJsonResponse(response) {
  if (!response.body) fail('AZURE_EXAMPLE_EMPTY_RESPONSE');
  const chunks = [];
  let length = 0;
  try {
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > 8388608) fail('AZURE_EXAMPLE_RESPONSE_LIMIT');
      chunks.push(chunk);
    }
    return parseBoundedObservationJson(Buffer.concat(chunks));
  } catch (error) {
    if (error.code === 'AZURE_EXAMPLE_RESPONSE_LIMIT') throw error;
    fail('AZURE_EXAMPLE_RESPONSE_INVALID');
  }
}

export function decodeObservedLogsResult(response) {
  if (!Array.isArray(response?.tables)) fail('AZURE_EXAMPLE_LOG_RESPONSE_INVALID');
  for (const table of response.tables) {
    if (!Array.isArray(table.columns) || !Array.isArray(table.rows)) fail('AZURE_EXAMPLE_LOG_RESPONSE_INVALID');
    for (const row of table.rows) if (Array.isArray(row)) {
      table.columns.forEach((column, index) => {
        if (column.type === 'dynamic' && typeof row[index] === 'string') {
          row[index] = parseBoundedObservationJson(Buffer.from(row[index], 'utf8'));
        }
        if (column.type === 'dynamic' && row[index] && typeof row[index] === 'object' &&
            typeof row[index]['_MS.links'] === 'string') {
          parseBoundedObservationJson(Buffer.from(row[index]['_MS.links'], 'utf8'));
        }
      });
    }
  }
  return decodeLogsQueryResult(response);
}

export function createAzureExampleClient(configuration, token, fetcher = fetch) {
  const config = immutableReceiptMetadata(validateAzureExampleConfig(configuration));
  return Object.freeze({
    config,
    async post(route, body, { signal } = {}) {
      if (!/^\/(?:describe|runs(?:\/[a-f0-9-]{36}\/[a-z-]+)?)$/.test(route)) fail('AZURE_EXAMPLE_ROUTE_INVALID');
      let response;
      try {
        response = await fetcher(config.operatorOrigin + route, {
          method: 'POST', redirect: 'error',
          headers: { authorization: `Bearer ${await token('operator')}`, 'content-type': 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(25000), ...(signal ? [signal] : [])])
        });
      } catch (error) {
        if (/^AZURE_EXAMPLE_/.test(error?.code ?? '')) throw error;
        fail('AZURE_EXAMPLE_OPERATOR_UNREACHABLE');
      }
      const value = await boundedJsonResponse(response);
      if (!response.ok) {
        const code = /^[A-Z][A-Z0-9_]{0,95}$/.test(value?.code ?? '') ? value.code : 'AZURE_EXAMPLE_OPERATOR_REJECTED';
        throw exampleFailure(code, UUID.test(value?.runId ?? '') ? { recoveryRunId: value.runId } : {});
      }
      return value;
    },
    async userRequest(gatewayUrl, route, { headers = {}, invalidToken = false, signal } = {}) {
      if (!['/me'].includes(route) || !gatewayUrl.endsWith('/contoso/v1')) fail('AZURE_EXAMPLE_ROUTE_INVALID');
      origin(new URL(gatewayUrl).origin);
      if (Object.keys(headers).some(name => !['x-business-invocation-id'].includes(name)) ||
          Object.values(headers).some(value => typeof value !== 'string' || value.length > 64 || /[\r\n]/.test(value))) {
        fail('AZURE_EXAMPLE_HEADER_INVALID');
      }
      let response;
      try {
        response = await fetcher(gatewayUrl + route, { redirect: 'error', headers: {
          ...headers, authorization: `Bearer ${invalidToken ? 'not-a-token' : await token('user')}`
        }, signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]) });
      } catch { fail('AZURE_EXAMPLE_GATEWAY_UNREACHABLE'); }
      const value = await boundedJsonResponse(response);
      const invocation = response.headers.get('x-business-invocation-id');
      if (invocation !== null && !UUID.test(invocation)) fail('AZURE_EXAMPLE_USER_IDENTITY_INVALID');
      if (response.ok && (!UUID.test(invocation ?? '') || value?.actorType !== 'user' ||
          !/^h1:[a-f0-9]{32}:[A-Za-z0-9_-]{43}$/.test(value?.pseudonym ?? ''))) fail('AZURE_EXAMPLE_USER_IDENTITY_INVALID');
      return { status: response.status, invocationId: invocation, actorType: value.actorType ?? null,
        pseudonymObserved: /^h1:[a-f0-9]{32}:[A-Za-z0-9_-]{43}$/.test(value?.pseudonym ?? '') };
    },
    async browser() {
      await verifyBrowserSources(await Promise.all(BROWSER_SOURCE_PATHS.map(async file => ({
        path: file, sha256: sha256(await readBoundFile(file))
      }))));
      let chromium;
      try { ({ chromium } = requirePortal('@playwright/test')); }
      catch { fail('AZURE_EXAMPLE_PLAYWRIGHT_REQUIRED'); }
      const browser = await chromium.launch({ headless: config.headless });
      try {
        const context = await browser.newContext({
          ...(config.browserStorageStateFile ? { storageState: config.browserStorageStateFile } : {})
        });
        const page = await context.newPage();
        await page.goto(config.portalOrigin + '/storefront/', { waitUntil: 'domcontentloaded' });
        const ready = await page.evaluate(async () => {
          await window.contosoDemos?.ready;
          const element = document.getElementById('contoso-runtime-config');
          if (!element?.textContent || !window.contosoDemos) return null;
          const value = JSON.parse(element.textContent);
          return { executionMode: value.executionMode, apiOrigin: value.api.origin,
            window: value.certification, runtime: window.contosoDemos.runtimeState() };
        });
        if (ready?.executionMode !== 'live' || !ready.window.enabled ||
            Date.parse(ready.window.startsAtUtc) > Date.now() || Date.parse(ready.window.endsAtUtc) <= Date.now() ||
            ready.runtime?.providerActive !== true || ready.runtime?.samplingPercentage !== 100) {
          fail('AZURE_EXAMPLE_BROWSER_WINDOW_NOT_ACTIVE');
        }
        if (!config.headless && !config.browserStorageStateFile) {
          if (!process.stdin.isTTY) fail('AZURE_EXAMPLE_INTERACTIVE_BROWSER_LOGIN_REQUIRED');
          const { createInterface } = await import('node:readline/promises');
          const prompt = createInterface({ input: process.stdin, output: process.stderr });
          try {
            await prompt.question('Sign in normally in the isolated Storefront browser, then press Enter. ', {
              signal: AbortSignal.timeout(Math.max(1, Math.min(120000, Date.parse(ready.window.endsAtUtc) - Date.now())))
            });
          } finally { prompt.close(); }
        }
        const module = await import(pathToFileURL(path.join(projectRoot, 'web', 'portal-ssr', 'dist', 'browser-adapter.js')).href);
        return {
          page, context, browser, ready,
          async drive(workflowId, demoId) {
            if (demoId === '02') {
              await page.goto(config.portalOrigin + '/storefront/', { waitUntil: 'domcontentloaded' });
              await page.evaluate(async () => { await window.contosoDemos?.ready; await window.contosoDemos?.flushTelemetry(); });
              const authorization = await context.request.post(config.portalOrigin + '/portal/session', {
                headers: { authorization: `Bearer ${await token('portal')}`, origin: config.portalOrigin, 'content-type': 'application/json' },
                data: { schemaVersion: 1 }
              });
              if (authorization.status() !== 200) fail('AZURE_EXAMPLE_PORTAL_CONTROLLER_REJECTED');
              await page.goto(config.portalOrigin + '/portal/', { waitUntil: 'domcontentloaded' });
            }
            return module.driveContosoBrowser(page, { schemaVersion: 1, runId: workflowId,
              demoId: Number(demoId), kind: demoId === '02' ? 'portal' : 'order', sku: 'CONTOSO-001', quantity: 1 });
          },
          async close() {
            try {
              await page.evaluate(async () => {
                window.contosoDemos?.stopTraffic();
                await window.contosoDemos?.drain();
                await window.contosoDemos?.flushTelemetry();
              });
            } finally { await browser.close(); }
          }
        };
      } catch (error) { await browser.close(); throw error; }
    }
  });
}

export async function pollExample(operation, accept, { seconds, signal, intervalMs = 1000 }) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const result = await operation();
    if (accept(result)) return result;
    await wait(Math.min(intervalMs, Math.max(0, deadline - Date.now())), undefined, { signal });
  }
  fail('AZURE_EXAMPLE_OBSERVATION_TIMEOUT');
}

export function validateObservedTables(tables, metadata, scope, browserEvidence = null) {
  const receipt = { complete: true, paginationComplete: true, warnings: [], tableInventoryComplete: false,
    tables: tables.map(table => ({ name: table.name, count: table.rows.length, complete: true })) };
  const privacy = scanGraphIntake({ tables, receipt });
  if (privacy.result !== 'PASS' || privacy.scannedAllColumns !== true) {
    throw exampleFailure('AZURE_EXAMPLE_RAW_PRIVACY_FAILED', { safeFindings: privacy.findings });
  }
  const rawRows = tables.flatMap(table => table.rows.map(row => ({ ...Object.fromEntries(
    table.columns.map((column, index) => [column.name, row[index]])), nativeTable: table.name })));
  const serializationByRole = {};
  if (browserEvidence) {
    if (browserEvidence.sdkVersion !== '3.4.5' || !Array.isArray(browserEvidence.dependencies)) fail('AZURE_EXAMPLE_SDK_IDENTITY_REQUIRED');
    const role = browserEvidence.driverKind === 'browser-spa' ? 'contoso-storefront-spa' : 'contoso-portal-ssr';
    const composite = browserEvidence.dependencies.filter(item => {
      const match = /^\|([a-f0-9]{32})\.([a-f0-9]{16})\.?$/.exec(item.dependencyId ?? '');
      return match && match[1] === item.traceId && match[2] === item.spanId;
    });
    if (composite.length) serializationByRole[role] = {
      format: 'ai-composite', evidenceSha256: ownedConfigurationHash(browserEvidence)
    };
  }
  const rows = normalizeTelemetryRows(rawRows, { schema: 'workspace', scope, captureId: randomUUID(),
    capturedAtUtc: new Date().toISOString(), privacyDisposition: privacy, sourceKind: 'azure-monitor-logs', serializationByRole });
  return { rows, privacy, metadata, rawRowsRetained: false, independentlyEnrolledObserver: false,
    completeEmissionLedger: false, certificationStatus: 'NOT CERTIFIED' };
}

export async function captureAzureExample(client, run, scope, { fromUtc, toUtc, signal, browserEvidence = null }) {
  const config = client.config;
  await wait(config.ingestionGraceSeconds * 1000, undefined, { signal });
  const watermarkUtc = new Date().toISOString();
  const parameters = { fromUtc, toUtc, watermarkUtc };
  async function snapshot() {
    const tables = [], metadata = [];
    let total = 0;
    for (const table of TABLES) {
      const query = request => client.post(`/runs/${run.runId}/query`, { table, ...parameters, ...request }, { signal });
      const schema = decodeObservedLogsResult(await query({ phase: 'schema' })).rows;
      const counts = decodeObservedLogsResult(await query({ phase: 'count' })).rows;
      if (counts.length !== 1 || !Number.isSafeInteger(counts[0].Rows) || counts[0].Rows < 0 ||
          total + counts[0].Rows > config.maxRows) fail('AZURE_EXAMPLE_QUERY_LIMIT_OR_COUNTS');
      const count = counts[0].Rows;
      if (!Number.isSafeInteger(counts[0].UnwatermarkedRows) || counts[0].UnwatermarkedRows !== 0 ||
          !Number.isSafeInteger(counts[0].RowsBeyondWatermark) || counts[0].RowsBeyondWatermark < 0) {
        fail('AZURE_EXAMPLE_INGESTION_WATERMARK_UNPROVED');
      }
      const columns = schema.map(row => ({ name: row.ColumnName, type: row.ColumnType }));
      if (new Set(columns.map(column => column.name)).size !== columns.length ||
          columns.some(column => typeof column.name !== 'string' || typeof column.type !== 'string' || column.name.startsWith('ContosoObserved'))) {
        fail('AZURE_EXAMPLE_SCHEMA_INVALID');
      }
      if (count > config.pageSize && (!columns.some(column => column.name === '_ItemId') ||
          counts[0].DistinctKeys !== count || counts[0].EmptyKeys !== 0 || counts[0].DuplicateRows !== 0)) {
        fail('AZURE_EXAMPLE_STABLE_PHYSICAL_KEY_REQUIRED');
      }
      const records = [];
      for (let page = 0; page < Math.ceil(count / config.pageSize); page++) {
        const result = decodeObservedLogsResult(await query({ phase: 'page', page, pageSize: config.pageSize }));
        const expected = Math.min(config.pageSize, count - page * config.pageSize);
        if (result.rows.length !== expected || columns.some(column => !result.columns.some(value =>
          value.name === column.name && value.type === column.type))) {
          fail('AZURE_EXAMPLE_INCOMPLETE_PAGE');
        }
        if (result.columns.some(column => !columns.some(value => value.name === column.name) &&
            !['ContosoObservedIngestedAt', 'ContosoObservedOrdinal', 'ContosoObservedKey'].includes(column.name))) {
          fail('AZURE_EXAMPLE_UNSCANNED_NATIVE_COLUMN');
        }
        records.push(...result.rows.map(row => columns.map(column => row[column.name])));
      }
      total += records.length;
      tables.push({ name: table, columns, rows: records });
      metadata.push({ table, rows: records.length, pages: Math.ceil(count / config.pageSize), watermarkUtc,
        rowsBeyondWatermark: counts[0].RowsBeyondWatermark });
    }
    return { tables, metadata };
  }
  const first = await snapshot();
  validateObservedTables(first.tables, first.metadata, scope, browserEvidence);
  await wait(config.settleSeconds * 1000, undefined, { signal });
  const second = await snapshot();
  const stable = value => ownedConfigurationHash(value.tables.map(table => ({
    ...table, rows: table.rows.map(row => ownedConfigurationHash(row)).sort()
  })));
  if (stable(first) !== stable(second)) fail('AZURE_EXAMPLE_WATERMARK_DRIFT');
  return validateObservedTables(second.tables, second.metadata, scope, browserEvidence);
}
