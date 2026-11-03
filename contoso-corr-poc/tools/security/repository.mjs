import { readdir, readFile, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { forbiddenString, jwtShaped } from './values.mjs';
import { scanAuthorizationIdentifierUse } from './identifiers.mjs';

const MAX_BLOB_BYTES = 128 * 1024 * 1024;
const MAX_HISTORY_BYTES = 256 * 1024 * 1024;
const generated = new Set(['.git', 'node_modules', 'target', 'dist', '.cache', '.tools', '.java-work', 'playwright-report', 'test-results']);
const secretPatterns = [
  ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g],
  ['CONNECTION_STRING', /\b(?:InstrumentationKey\s*=\s*[0-9a-f-]{32,36}|DefaultEndpointsProtocol\s*=\s*https?;|(?:AccountKey|SharedAccessKey|SharedAccessSignature)\s*=\s*[A-Za-z0-9+/=%._~-]{16,})/gi],
  ['JWT_VALUE', /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{16,}\b/g],
  ['SAS_VALUE', /[?&]sig=[A-Za-z0-9%+/=_-]{24,}/g],
  ['GITHUB_TOKEN', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g],
  ['AWS_ACCESS_KEY', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g]
];
const quotedAssignments = /(?<![\w$])(["'`]?)([A-Za-z_$][A-Za-z0-9_$.-]{0,127})\1\s*[:=]\s*@?(["'`])((?:\\[\s\S]|(?!\3)[\s\S])*?)\3/g;

function credentialField(name) {
  return /(?:clientsecret|apikey|accesstoken|refreshtoken|password|passwd|pwd|passphrase|accountkey|sharedaccesskey)$/
    .test(name.replace(/[._$-]/g, '').toLowerCase());
}

function credentialReference(value) {
  if (/^\$\{[A-Za-z_][A-Za-z0-9_.]*\}$/.test(value) || /^\$env:[A-Za-z_][A-Za-z0-9_]*$/i.test(value))
    return true;
  const match = /^@Microsoft\.KeyVault\(SecretUri=([^()]+)\)$/.exec(value);
  if (!match) return false;
  if (/^\$\{[A-Za-z_][A-Za-z0-9_.]*\}$/.test(match[1])) return true;
  try {
    const uri = new URL(match[1]);
    return uri.protocol === 'https:' && /^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]\.vault\.azure\.net$/.test(uri.hostname) &&
      !uri.username && !uri.password && !uri.port && !uri.search && !uri.hash &&
      /^\/secrets\/[A-Za-z0-9-]{1,127}(?:\/[0-9a-f]{32})?$/.test(uri.pathname);
  } catch { return false; }
}

function referenceAssignmentEnds(text, start) {
  let index = start;
  let crossedLine = false;
  while (index < text.length) {
    const whitespace = /^\s+/.exec(text.slice(index));
    if (whitespace) {
      crossedLine ||= /[\r\n]/.test(whitespace[0]);
      index += whitespace[0].length;
    }
    if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2);
      if (end < 0) return false;
      crossedLine ||= /[\r\n]/.test(text.slice(index, end));
      index = end + 2;
      continue;
    }
    if (text.startsWith('//', index)) {
      const end = text.indexOf('\n', index + 2);
      if (end < 0) return true;
      crossedLine = true;
      index = end + 1;
      continue;
    }
    break;
  }
  const tail = text.slice(index);
  if (!tail.length || /^[;,})]/.test(tail)) return true;
  return crossedLine && (/^(?:const|let|var|function|class|export|import|return|if|for|while|switch|try|throw)\b/.test(tail) ||
    /^\$[A-Za-z_][A-Za-z0-9_]*\s*=/.test(tail));
}

export function scanSecretText(text, { evidence = false } = {}) {
  const findings = [];
  for (const [code, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern))
      findings.push({ code, line: text.slice(0, match.index).split('\n').length });
  }
  quotedAssignments.lastIndex = 0;
  for (const match of text.matchAll(quotedAssignments)) {
    if (credentialField(match[2]) &&
        !((!match[4].length || credentialReference(match[4])) &&
          referenceAssignmentEnds(text, match.index + match[0].length)))
      findings.push({ code: 'CREDENTIAL_ASSIGNMENT', line: text.slice(0, match.index).split('\n').length });
  }
  if (jwtShaped(text) && !findings.some(finding => finding.code === 'JWT_VALUE')) findings.push({ code: 'JWT_VALUE', line: 1 });
  if (evidence) {
    const values = [];
    function collect(value) {
      if (typeof value === 'string') values.push(value);
      else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
        values.push(key);
        collect(child);
      }
    }
    try { collect(JSON.parse(text)); } catch { values.push(text); }
    for (const value of values) {
      const code = forbiddenString(value);
      if (code && !findings.some(finding => finding.code === code)) findings.push({ code, line: 1 });
    }
    const identity = /"(?:oid|tenantId|objectId|clientId|azp|appid|upn|email|preferred_username|userClaims|requestBody|responseBody)"\s*:\s*(?:"[^"]+"|\{|\[)/gi;
    for (const match of text.matchAll(identity))
      findings.push({ code: 'RAW_IDENTITY_OR_BODY_IN_EVIDENCE', line: text.slice(0, match.index).split('\n').length });
  }
  return findings;
}

function git(root, args, input, maxBuffer = MAX_HISTORY_BYTES) {
  const result = spawnSync('git', ['--no-pager', ...args], { cwd: root, input, maxBuffer, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error('GIT_HISTORY_SCAN_FAILED');
  return result.stdout;
}

function historyBlobs(root) {
  const listed = git(root, ['rev-list', '--objects', '--all']).toString('utf8').trim().split('\n').filter(Boolean);
  const objects = listed.map(line => ({ oid: line.slice(0, 40), file: line.slice(41) || 'historical-object' }));
  if (!objects.length) throw new Error('GIT_HISTORY_MISSING');
  const metadata = git(root, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'],
    objects.map(object => object.oid + '\n').join('')).toString('utf8').trim().split('\n');
  let total = 0;
  const blobs = [];
  metadata.forEach((line, index) => {
    const [oid, type, bytesText] = line.split(' ');
    const bytes = Number(bytesText);
    if (!/^[0-9a-f]{40}$/.test(oid) || !Number.isSafeInteger(bytes)) throw new Error('GIT_HISTORY_SCAN_FAILED');
    if (type !== 'blob') return;
    if (bytes > MAX_BLOB_BYTES) throw new Error('HISTORY_BLOB_LIMIT_EXCEEDED');
    total += bytes;
    if (total > MAX_HISTORY_BYTES) throw new Error('HISTORY_SCAN_LIMIT_EXCEEDED');
    blobs.push({ oid, bytes, file: objects[index].file });
  });
  return blobs;
}

function safePath(file) {
  if (/@|eyJ[A-Za-z0-9_-]{5,}\.eyJ/i.test(file) || scanSecretText(file).length) return '[redacted-path]';
  return file;
}

export function decodeHistoryBatch(blobs, raw) {
  const decoded = [];
  let offset = 0;
  for (const blob of blobs) {
    const end = raw.indexOf(10, offset);
    if (end < 0 || raw.subarray(offset, end).toString('utf8') !== `${blob.oid} blob ${blob.bytes}`)
      throw new Error('GIT_HISTORY_SCAN_FAILED');
    offset = end + 1;
    const body = raw.subarray(offset, offset + blob.bytes);
    if (body.length !== blob.bytes || raw[offset + blob.bytes] !== 10) throw new Error('GIT_HISTORY_SCAN_FAILED');
    offset += blob.bytes + 1;
    decoded.push({ ...blob, body });
  }
  if (offset !== raw.length) throw new Error('GIT_HISTORY_SCAN_FAILED');
  return decoded;
}

export async function scanRepository({ root, history = true, evidence = true } = {}) {
  root = path.resolve(root ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..'));
  const findings = [];
  let scannedFiles = 0, scannedHistoryBlobs = 0;
  const add = (file, values, origin, blobId) => {
    for (const value of values) findings.push({ file: safePath(file), ...value, origin, ...(blobId ? { blobId } : {}) });
  };
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file);
      if (entry.isSymbolicLink()) {
        findings.push({ file: safePath(relative), code: 'UNSCANNED_SYMLINK', line: 0, origin: 'worktree' });
        continue;
      }
      if (entry.isDirectory()) { if (!generated.has(entry.name)) await walk(file); continue; }
      if (!entry.isFile()) continue;
      const info = await lstat(file);
      if (info.size > MAX_BLOB_BYTES) {
        findings.push({ file: safePath(relative), code: 'WORKTREE_BLOB_LIMIT', line: 0, origin: 'worktree' });
        continue;
      }
      const bytes = await readFile(file);
      scannedFiles++;
      if (/\.(?:pfx|p12|key)$/i.test(relative))
        findings.push({ file: safePath(relative), code: 'UNAPPROVED_CREDENTIAL_CONTAINER', line: 0, origin: 'worktree' });
      const text = bytes.toString('utf8');
      const isEvidence = evidence && relative.split(path.sep).includes('evidence');
      add(relative, scanSecretText(text, { evidence: isEvidence }), 'worktree');
      if (/\.(?:java|js|mjs|ts|tsx)$/.test(relative) && !relative.split(path.sep).includes('tests') &&
          !relative.includes(`${path.sep}src${path.sep}test${path.sep}`))
        add(relative, scanAuthorizationIdentifierUse(text).findings.map(finding => ({ ...finding, line: 0 })), 'worktree');
    }
  }
  try {
    await walk(root);
    if (history) {
      const blobs = historyBlobs(root);
      const raw = git(root, ['cat-file', '--batch'], blobs.map(blob => blob.oid + '\n').join(''));
      for (const blob of decodeHistoryBatch(blobs, raw)) {
        scannedHistoryBlobs++;
        if (/\.(?:pfx|p12|key)$/i.test(blob.file))
          findings.push({ file: safePath(blob.file), code: 'UNAPPROVED_CREDENTIAL_CONTAINER', line: 0, origin: 'history', blobId: blob.oid });
        add(blob.file, scanSecretText(blob.body.toString('utf8'), { evidence: evidence && /(?:^|[\\/])evidence[\\/]/.test(blob.file) }),
          'history', blob.oid);
      }
    }
  } catch (error) {
    findings.push({ file: 'scan', code: /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : 'SCAN_INCOMPLETE',
      line: 0, origin: 'scanner' });
  }
  return {
    schema: 'contoso.repository-security-scan.v1', result: findings.length ? 'FAIL' : 'PASS',
    assessmentScope: 'repository-history-evidence', certification: 'NOT_CERTIFIED',
    scannedFiles, scannedHistoryBlobs, historyScanned: history && scannedHistoryBlobs > 0, findings
  };
}

export function lintSecretReferences({ appSettings, apimNamedValues, apimLoggers, storefrontFiles = [] } = {}) {
  const findings = [];
  let referencesChecked = 0;
  const requiredServices = ['contoso-orders-api', 'contoso-inventory-api', 'contoso-portal-ssr',
    'contoso-fulfillment-worker', 'contoso-notify-worker', 'contoso-order-aggregator'];
  const namedValueName = 'contoso-appinsights-connection-string';
  const validUri = value => {
    try {
      const uri = new URL(value);
      return uri.protocol === 'https:' && /^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]\.vault\.azure\.net$/.test(uri.hostname) &&
        !uri.username && !uri.password && !uri.port && !uri.search && !uri.hash &&
        /^\/secrets\/[A-Za-z0-9-]{1,127}(?:\/[0-9a-f]{32})?$/.test(uri.pathname);
    } catch { return false; }
  };
  if (!appSettings || !Object.keys(appSettings).length) findings.push({ code: 'APP_SETTINGS_MISSING' });
  for (const service of requiredServices) if (!appSettings?.[service]) findings.push({ code: 'SERVER_SETTINGS_SCOPE_INCOMPLETE' });
  for (const settings of Object.values(appSettings ?? {})) {
    const value = settings?.APPLICATIONINSIGHTS_CONNECTION_STRING;
    const match = typeof value === 'string' && /^@Microsoft\.KeyVault\(SecretUri=([^()]+)\)$/.exec(value);
    if (!match || !validUri(match[1])) findings.push({ code: 'APP_INSIGHTS_NOT_KEY_VAULT_REFERENCE' });
    else referencesChecked++;
  }
  if (!Array.isArray(apimNamedValues) || !apimNamedValues.length) findings.push({ code: 'APIM_NAMED_VALUES_MISSING' });
  const connectionValues = (Array.isArray(apimNamedValues) ? apimNamedValues : []).filter(entry => entry &&
    ((typeof entry.name === 'string' && entry.name.split('/').at(-1) === namedValueName) ||
      (entry.properties ?? entry).displayName === namedValueName));
  if (connectionValues.length !== 1) findings.push({ code: 'APIM_LOGGER_NAMED_VALUE_NOT_UNIQUE' });
  for (const entry of connectionValues) {
    const value = entry.properties ?? entry;
    if (value.secret !== true || value.value != null || !validUri(value.keyVault?.secretIdentifier))
      findings.push({ code: 'APIM_NOT_KEY_VAULT_BACKED' });
    else referencesChecked++;
  }
  const loggers = (Array.isArray(apimLoggers) ? apimLoggers : []).filter(entry =>
    entry && (entry.properties ?? entry).loggerType === 'applicationInsights');
  if (!loggers.length) findings.push({ code: 'APIM_LOGGER_CONFIGURATION_MISSING' });
  for (const logger of loggers) {
    const credentials = (logger.properties ?? logger).credentials;
    if (credentials?.connectionString !== `{{${namedValueName}}}` || credentials?.instrumentationKey != null)
      findings.push({ code: 'APIM_LOGGER_NOT_KEY_VAULT_BACKED' });
  }
  if (!Array.isArray(storefrontFiles)) findings.push({ code: 'BROWSER_SOURCE_SCOPE_INVALID' });
  for (const source of Array.isArray(storefrontFiles) ? storefrontFiles : []) if (scanSecretText(source).length)
    findings.push({ code: 'COMMITTED_BROWSER_CONNECTION_STRING' });
  return { result: findings.length ? 'FAIL' : 'PASS', referencesChecked, findings };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const index = args.indexOf('--root');
  const root = index < 0 ? undefined : args[index + 1];
  const result = await scanRepository({ root, history: !args.includes('--worktree-only') });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.result === 'PASS' ? 0 : 1;
}
