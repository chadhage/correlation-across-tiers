import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSecretText, scanRepository, lintSecretReferences, decodeHistoryBatch } from '../../tools/security/repository.mjs';
import { fakeJwt } from './fixtures.mjs';

test('seeded secret forms are detected with location/code only', () => {
  const spacedJwt = [Buffer.from('  {"alg":"RS256","typ":"JWT"}').toString('base64url'),
    Buffer.from('\n{"subject":"canary-only"}').toString('base64url'), randomBytes(32).toString('base64url')].join('.');
  const seeds = [
    ['Instrumentation', 'Key=', randomUUID()].join(''),
    ['Account', 'Key=', randomBytes(32).toString('base64')].join(''),
    ['-----BEGIN ', 'PRIVATE KEY-----'].join(''),
    fakeJwt(),
    spacedJwt,
    'gh' + 'p_' + randomBytes(20).toString('hex'),
    'AK' + 'IA' + 'A'.repeat(16),
    'https://storage.example/path?sig=' + randomBytes(32).toString('base64url')
  ];
  for (const seed of seeds) {
    const result = scanSecretText(seed);
    assert(result.length > 0);
    assert.equal(JSON.stringify(result).includes(seed), false);
  }
});

test('known credential literals fail for short, punctuated, escaped and prefixed assignments', () => {
  const vectors = [
    ['pass' + 'word', 'x'],
    ['pass' + 'word', 'short!9'],
    ['client_' + 'secret', 'long!punctuated@value#$%^&*()+=[]{};:,.?'],
    ['CONTOSO_CLIENT_' + 'SECRET', 'short punctuation !$'],
    ['api_' + 'key', 'value with spaces'],
    ['pass' + 'phrase', 'contains\\"escaped\\"quotes'],
    ['refresh_' + 'token', 'SYNTHETIC_short!'],
    ['account_' + 'key', 'small*']
  ];
  for (const [field, value] of vectors) {
    const source = field + ' = "' + value + '";';
    const findings = scanSecretText(source);
    assert(findings.some(finding => finding.code === 'CREDENTIAL_ASSIGNMENT'));
    assert.equal(JSON.stringify(findings).includes(value), false);
  }
  for (const value of ['${CONTOSO_PASSWORD}', '$env:CONTOSO_PASSWORD',
    '@Microsoft.KeyVault(SecretUri=https://contoso-corr-poc-kv.vault.azure.net/secrets/approved-password)',
    '@Microsoft.KeyVault(SecretUri=${approvedSecretIdentifier})', '']) {
    assert.equal(scanSecretText(('pass' + 'word') + ' = "' + value + '";').length, 0);
  }
  assert(scanSecretText(('pass' + 'word') + ' = "${CONTOSO_PASSWORD}literal";').length > 0);
});

test('R2-R8-01 project-local settings reproducer fails without persisting matched values', async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures-generated', 'r8-' + randomUUID());
  const short = 'short!' + '9';
  const punctuation = 'long!' + randomBytes(16).toString('hex') + '@#$%^&*()';
  try {
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'settings.js'), [
      ('pass' + 'word') + ' = "' + short + '";',
      ('client_' + 'secret') + ' = "' + punctuation + '";'
    ].join('\n'));
    const result = await scanRepository({ root, history: false });
    assert.equal(result.result, 'FAIL');
    assert.equal(result.scannedFiles, 1);
    assert.equal(result.historyScanned, false);
    assert.equal(result.findings.filter(finding => finding.code === 'CREDENTIAL_ASSIGNMENT').length, 2);
    assert.equal(JSON.stringify(result).includes(short), false);
    assert.equal(JSON.stringify(result).includes(punctuation), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('whole references cannot hide concatenated or modified right-hand assignment expressions', () => {
  const prefix = 'const ' + ('client_' + 'secret') + ' = "${APP_SECRET}"';
  for (const tail of [' + "canary-only!";', '\n+ "canary-only!";',
    ' /* harmless comment */ + "canary-only!";', ' // harmless comment\n+ "canary-only!";',
    '.slice(0) + "canary-only!";', '[0] + "canary-only!";',
    ' || "canary-only!";', ' ? "canary-only!" : "";']) {
    const findings = scanSecretText(prefix + tail);
    assert(findings.some(finding => finding.code === 'CREDENTIAL_ASSIGNMENT'));
    assert.equal(JSON.stringify(findings).includes('canary-only!'), false);
  }
  for (const tail of ['', ';', ' /* harmless comment */ ;', ' // harmless comment',
    '\nconst harmless = 1;', '\n$harmless = 1;'])
    assert.equal(scanSecretText(prefix + tail).length, 0);
  assert(scanSecretText(('client_' + 'secret') + '=""+"canary-only!";').length > 0);
});

test('R2-R8-02 one-file reference-plus-literal reproducer fails and is removed', async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures-generated', 'r8-' + randomUUID());
  const appended = 'canary-' + 'only!';
  try {
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, 'settings.js'),
      'const ' + ('client_' + 'secret') + '="${APP_SECRET}"+"' + appended + '";');
    const result = await scanRepository({ root, history: false });
    assert.equal(result.result, 'FAIL');
    assert.equal(result.scannedFiles, 1);
    assert.equal(result.findings.filter(finding => finding.code === 'CREDENTIAL_ASSIGNMENT').length, 1);
    assert.equal(JSON.stringify(result).includes(appended), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('project-local outside-deployment fixtures prove source/params/demo/evidence coverage', async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures-generated', 'r8-' + randomUUID());
  try {
    for (const child of ['infra\\params', 'demos', 'evidence']) await mkdir(path.join(root, child), { recursive: true });
    const secret = ['Account', 'Key=', randomBytes(32).toString('base64')].join('');
    await writeFile(path.join(root, 'infra\\params\\poc.bicepparam'), secret);
    await writeFile(path.join(root, 'demos\\canary.ps1'), fakeJwt());
    await writeFile(path.join(root, 'evidence\\canary.json'), JSON.stringify({ oid: randomUUID() }));
    const result = await scanRepository({ root, history: false });
    assert.equal(result.result, 'FAIL');
    assert.equal(result.scannedFiles, 3);
    assert.equal(result.historyScanned, false);
    assert(result.findings.some(finding => finding.code === 'RAW_IDENTITY_OR_BODY_IN_EVIDENCE'));
    assert.equal(JSON.stringify(result).includes(secret), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('history blob parser scans deleted-path secrets and rejects truncated/mismatched batches', () => {
  const body = Buffer.from(['SharedAccess', 'Key=', randomBytes(32).toString('base64')].join(''));
  const blob = { oid: '1'.repeat(40), bytes: body.length, file: 'deleted-config.txt' };
  const raw = Buffer.concat([Buffer.from(`${blob.oid} blob ${body.length}\n`), body, Buffer.from('\n')]);
  const decoded = decodeHistoryBatch([blob], raw);
  assert.equal(scanSecretText(decoded[0].body.toString()).length, 1);
  assert.throws(() => decodeHistoryBatch([blob], raw.subarray(0, raw.length - 1)), /GIT_HISTORY_SCAN_FAILED/);
});

test('missing history fails closed rather than claiming a clean full-history scan', async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures-generated', 'r8-' + randomUUID());
  const ceiling = process.env.GIT_CEILING_DIRECTORIES;
  try {
    await mkdir(root, { recursive: true });
    process.env.GIT_CEILING_DIRECTORIES = path.dirname(root);
    const result = await scanRepository({ root, history: true });
    assert.equal(result.result, 'FAIL');
    assert.equal(result.historyScanned, false);
  } finally {
    if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = ceiling;
    await rm(root, { recursive: true, force: true });
  }
});

test('AI server settings/APIM logger must use real Key Vault references; browser source cannot embed key', () => {
  const secretUri = 'https://contoso-corr-poc-kv.vault.azure.net/secrets/contoso-appinsights-connection';
  const clean = {
    appSettings: Object.fromEntries(['contoso-orders-api', 'contoso-inventory-api', 'contoso-portal-ssr',
      'contoso-fulfillment-worker', 'contoso-notify-worker', 'contoso-order-aggregator'].map(role =>
      [role, { APPLICATIONINSIGHTS_CONNECTION_STRING: `@Microsoft.KeyVault(SecretUri=${secretUri})` }])),
    apimNamedValues: [{ name: 'contoso-appinsights-connection-string', secret: true, keyVault: { secretIdentifier: secretUri } }],
    apimLoggers: [{ loggerType: 'applicationInsights', credentials: { connectionString: '{{contoso-appinsights-connection-string}}' } }],
    storefrontFiles: []
  };
  assert.equal(lintSecretReferences(clean).result, 'PASS');
  const badApp = structuredClone(clean);
  badApp.appSettings['contoso-orders-api'].APPLICATIONINSIGHTS_CONNECTION_STRING = ['Instrumentation', 'Key=', randomUUID()].join('');
  assert.equal(lintSecretReferences(badApp).result, 'FAIL');
  const badApim = structuredClone(clean);
  badApim.apimNamedValues[0].value = 'raw-value';
  assert.equal(lintSecretReferences(badApim).result, 'FAIL');
  const badBrowser = structuredClone(clean);
  badBrowser.storefrontFiles.push(['Instrumentation', 'Key=', randomUUID()].join(''));
  assert.equal(lintSecretReferences(badBrowser).result, 'FAIL');
  const incomplete = structuredClone(clean);
  delete incomplete.appSettings['contoso-fulfillment-worker'];
  assert.equal(lintSecretReferences(incomplete).result, 'FAIL');
  const wrongLogger = structuredClone(clean);
  wrongLogger.apimLoggers[0].credentials.connectionString = 'inline-value';
  assert.equal(lintSecretReferences(wrongLogger).result, 'FAIL');
  assert.equal(lintSecretReferences({}).result, 'FAIL');
});
