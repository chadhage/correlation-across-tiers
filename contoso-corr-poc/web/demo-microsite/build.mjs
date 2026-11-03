import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderArchitecture } from '../../tools/architecture.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(directory, '..', '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function resolveSource(root, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) {
    throw new Error('Expected a repository-relative source path');
  }
  const resolved = path.resolve(root, ...relative.split(/[\\/]/));
  const within = path.relative(root, resolved);
  if (!within || within === '..' || within.startsWith(`..${path.sep}`) || path.isAbsolute(within)) {
    throw new Error('Source path must remain inside the repository');
  }
  return resolved;
}

async function source(root, relative) {
  const bytes = await readFile(resolveSource(root, relative));
  return { path: relative, sha256: digest(bytes), content: bytes.toString('utf8') };
}

export async function inspectReceipt(root, receipt) {
  if (!receipt || !/^[a-f0-9]{64}$/.test(receipt.sha256)) throw new Error('Invalid registered receipt digest');
  const resolved = resolveSource(root, receipt.artifact);
  let bytes;
  try {
    bytes = await readFile(resolved);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return { path: receipt.artifact, expectedSha256: receipt.sha256, state: 'missing' };
  }
  const actualSha256 = digest(bytes);
  return {
    path: receipt.artifact,
    expectedSha256: receipt.sha256,
    actualSha256,
    state: actualSha256 === receipt.sha256 ? 'matches' : 'differs'
  };
}

function requireCounts(object, fields, label) {
  for (const field of fields) {
    if (!Number.isSafeInteger(object?.[field]) || object[field] < 0) {
      throw new Error(`Missing or invalid ${label}.${field}`);
    }
  }
}

export async function loadMicrositeData({ root = projectRoot, builtAt = new Date().toISOString() } = {}) {
  const initialPaths = [
    'demos\\catalog.json',
    'contracts\\expected-boundary-map.v1.json',
    'config\\verification-register.v1.json'
  ];
  const initial = await Promise.all(initialPaths.map(relative => source(root, relative)));
  const [catalog, boundaryMap, register] = initial.map(item => JSON.parse(item.content));
  if (catalog.schema !== 'contoso.demo-catalog.v1' || catalog.sourceAcceptanceIsCertification !== false) {
    throw new Error('Unsupported demo catalog or certification semantics');
  }
  if (register.schema !== 'contoso.verification-register.v1') throw new Error('Unsupported evidence register');
  renderArchitecture(boundaryMap);
  const ids = new Set();
  const spanIds = new Set(boundaryMap.spans.map(span => span.id));
  const demos = catalog.demos.map(demo => {
    if (!/^\d{2}$/.test(demo.id) || ids.has(demo.id)) throw new Error('Invalid or duplicate demo ID');
    ids.add(demo.id);
    const boundaries = typeof demo.requiredBoundaries === 'string'
      ? boundaryMap[demo.requiredBoundaries]
      : demo.requiredBoundaries;
    if (!Array.isArray(boundaries) || !boundaries.length || boundaries.some(id => !spanIds.has(id))) {
      throw new Error(`Unresolved boundaries for demo ${demo.id}`);
    }
    return { ...demo, boundaries };
  });
  if (!demos.length) throw new Error('No demo scenarios found');

  const local = register.boundedLocalEvidence?.localConstructionBaseline;
  const conditional = register.boundedLocalEvidence?.ordersConditionalV7;
  requireCounts(local?.rootNode, ['actualTests', 'actualFailures', 'actualSkips', 'actualCancelled'], 'rootNode');
  requireCounts(local?.javaReactor, ['actualTests', 'actualFailures', 'actualErrors', 'actualSkips', 'actualModules'], 'javaReactor');
  requireCounts(local?.packages, ['recordedActualZipPackages'], 'packages');
  requireCounts(local?.missingAgentGuards, ['actualMissingAgentNegativeLaunches'], 'missingAgentGuards');
  requireCounts(conditional, ['actualWireSdkCases', 'actualNativeRequestMatches', 'privateRootBindings'], 'ordersConditionalV7');
  if (local.certification !== 'NOT_CERTIFIED' || conditional.certification !== 'NOT_CERTIFIED') {
    throw new Error('Certification status changed; review microsite scope before publishing');
  }

  const receiptEntries = [
    ['node', local.rootNode],
    ['java', local.javaReactor],
    ['packages', local.packages],
    ['guards', local.missingAgentGuards],
    ['conditional', conditional.nativeExecution],
    ['bindings', conditional.privateLocalBindings],
    ['adjudication', conditional.adjudication]
  ];
  const receipts = Object.fromEntries(await Promise.all(receiptEntries.map(async ([id, entry]) =>
    [id, await inspectReceipt(root, entry)])));
  const documentPaths = [
    'docs\\ARCHITECTURE.md',
    'docs\\DEMO_RUNBOOK.md',
    'docs\\CERTIFICATION_REPORT.md',
    'docs\\RESIDUAL_LIMITATIONS.md',
    'kql\\README.md',
    'kql\\trace-reconstruct.kql',
    'kql\\business-lookup.kql',
    'kql\\orphan-candidates.kql',
    ...demos.map(demo => `demos\\${demo.id}\\README.md`)
  ];
  const documents = await Promise.all([
    ...documentPaths.map(relative => source(root, relative)),
    source(path.dirname(root), 'LICENSE')
  ]);
  initial[2] = {
    ...initial[2],
    excerpt: true,
    content: JSON.stringify({
      schema: register.schema,
      sourceAcceptanceIsCertification: register.sourceAcceptanceIsCertification,
      boundedLocalEvidence: register.boundedLocalEvidence
    }, null, 2)
  };
  if (!Number.isFinite(Date.parse(builtAt))) throw new Error('Invalid snapshot timestamp');
  return {
    schema: 'contoso.demo-microsite.v1',
    builtAt,
    certification: 'NOT CERTIFIED',
    demos,
    boundaryMap,
    evidence: { local, conditional, receipts },
    sources: [...initial, ...documents]
  };
}

export function serializeForHtml(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}

export function renderMicrosite(data, template, script) {
  const substitutions = {
    SITE_DATA: serializeForHtml(data),
    SITE_SCRIPT: script,
    DEMO_COUNT: String(data.demos.length),
    BOUNDARY_COUNT: String(data.boundaryMap.spans.length),
    ROLE_COUNT: String(new Set(data.boundaryMap.spans.map(span => span.roleName)).size),
    BUILT_AT: data.builtAt
  };
  let html = template;
  for (const [key, value] of Object.entries(substitutions)) {
    const token = `{{${key}}}`;
    if (!html.includes(token)) throw new Error(`Missing template token: ${key}`);
    html = html.replaceAll(token, () => value);
  }
  // HTML parsing normalizes line endings before the browser checks script hashes.
  html = html.replace(/\r\n?/g, '\n');
  const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
    .map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
  const policy = `default-src 'none'; script-src ${hashes.join(' ')}; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'`;
  html = html.replace('{{CSP}}', () => policy);
  if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error('Unresolved microsite template token');
  return html;
}

export async function buildMicrosite() {
  const [data, template, script] = await Promise.all([
    loadMicrositeData(),
    readFile(path.join(directory, 'template.html'), 'utf8'),
    readFile(path.join(directory, 'site.mjs'), 'utf8')
  ]);
  const html = renderMicrosite(data, template, script);
  const outputPath = path.join(directory, 'dist', 'index.html');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, 'utf8');
  return { outputPath, html, data };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { outputPath, data } = await buildMicrosite();
  console.log(`Built ${data.demos.length} demo walkthroughs: ${outputPath}`);
  for (const receipt of Object.values(data.evidence.receipts)) {
    if (receipt.state !== 'matches') console.warn(`Recorded receipt ${receipt.state}: ${receipt.path}`);
  }
}
