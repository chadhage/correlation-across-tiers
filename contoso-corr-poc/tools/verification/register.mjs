import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot, jsonBytes, readBoundFile, sha256 } from './files.mjs';

const officialHosts = new Set([
  'learn.microsoft.com', 'github.com', 'registry.npmjs.org', 'repo.maven.apache.org',
  'maven.apache.org', 'downloads.apache.org', 'pkgs.dev.azure.com', 'www.w3.org',
  'opentelemetry.io', 'nodejs.org', 'docs.oracle.com', 'www.postgresql.org'
]);
const skip = new Set(['node_modules', 'target', 'dist', 'bin', 'obj', '.cache', '.java-work', '.git', 'deployment-artifact', 'evidence', 'tests', 'eval', 'evaluation']);
const capabilities = new Set(['version', 'apiVersion', 'sku', 'skuName', 'javaVersion', 'jdkVersion', 'runtimeVersion', 'workerVersion', 'status']);
const pointerEscape = value => value.replaceAll('~', '~0').replaceAll('/', '~1');
const VERSION = /^(?:~|\^)?(?:\d+\.\d+(?:\.\d+)?(?:[+.-][a-zA-Z0-9.-]+)?|\d{4}-\d{2}-\d{2})$/;

export function officialSource(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password ||
        !(officialHosts.has(url.hostname) || /^ms-feed-\d+\.pkgs\.visualstudio\.com$/.test(url.hostname))) return false;
    if (url.hostname === 'github.com' && !/^\/(?:microsoft|Azure|adoptium|open-telemetry|redis|pgjdbc|spring-projects|apache|nodejs)\//.test(url.pathname)) return false;
    return true;
  } catch { return false; }
}

function owner(file) {
  if (/^(?:web[\\/])/.test(file)) return 'R2';
  if (/apim|protocol/.test(file)) return 'R3';
  if (/inventory-data|data-postgres|data-managed-redis/.test(file)) return 'R6';
  if (/messaging|workers|message-envelope/.test(file)) return 'R5';
  if (/security|identity|key-vault/.test(file)) return 'R8';
  if (/observability|sampling-profiles|telemetry|workbook|kql/.test(file)) return 'R7';
  if (/pom\.xml|java|VERSIONS|versions\.lock|extensions/.test(file)) return 'R4';
  return 'R1';
}

async function filesUnder(root, prefix = '') {
  const result = [];
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const name = path.join(prefix, entry.name);
    if (entry.isDirectory() && !skip.has(entry.name)) result.push(...await filesUnder(root, name));
    else if (entry.isFile() && /\.(?:json|bicep|bicepparam|xml)$/.test(entry.name) &&
        !/acceptance-scopes\.json|verification-register\.v1\.json|cost-model\.json/.test(entry.name)) result.push(name);
  }
  return result.sort();
}

function inventoryJson(value, file, sourceHints, pointer = '', parent = null, claims = []) {
  if (value && typeof value === 'object') {
    for (const [name, child] of Object.entries(value)) {
      const at = `${pointer}/${pointerEscape(name)}`;
      const isCapability = capabilities.has(name) && typeof child === 'string' &&
        (name === 'status' ? child === 'GA' || child === 'preview' : VERSION.test(child) || /sku/i.test(name));
      const isAgentAbi = /\/agent$/.test(pointer) && ['api', 'instrumentation', 'autoConfigure'].includes(name);
      const isPackageDependency = /^\/(?:devDependencies|dependencies|optionalDependencies)$/.test(pointer) && typeof child === 'string';
      if (isCapability || isAgentAbi || isPackageDependency) {
        if (file === 'package.json' && at === '/version') continue;
        let source = value.source ?? value.resolved ?? value.url ?? parent?.source ?? sourceHints.get(child) ?? null;
        const contosoOwned = name === 'version' && (
          file.endsWith('package.json') && /^(?:@)?contoso[-/]/.test(value.name ?? '') ||
          file.endsWith('package-lock.json') && (pointer === '' || pointer === '/packages/') ||
          file.endsWith('contoso-orders.v1.json') && pointer === '/info' ||
          file.endsWith('versions.lock.json') && pointer.startsWith('/extensions/')
        );
        if (contosoOwned) source = 'DECISIONS.md';
        if (file.endsWith('host.json') && at === '/version') source = 'https://learn.microsoft.com/en-us/azure/azure-functions/functions-host-json';
        if (file.endsWith('package-lock.json') && pointer.startsWith('/packages/node_modules')) {
          const packageName = pointer.slice('/packages/'.length).replaceAll('~1', '/').replaceAll('~0', '~').split('node_modules/').at(-1);
          if (!value.resolved) source = `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(child)}`;
        }
        if (isPackageDependency) source = `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(child)}`;
        claims.push({ id: `${file}#json:${at}`, file, selector: { kind: 'json-pointer', pointer: at }, value: child,
          source, owner: owner(file), category: contosoOwned ? 'contoso-owned' : name === 'status' ? 'capability' : 'pin' });
      }
      inventoryJson(child, file, sourceHints, at, value, claims);
    }
  }
  return claims;
}

function inventoryPom(text, file, sourceHints) {
  const claims = [];
  const properties = new Map();
  const propertyBlock = /<properties>([\s\S]*?)<\/properties>/.exec(text)?.[1] ?? '';
  for (const item of propertyBlock.matchAll(/<([\w.-]+)>([^<>]+)<\/\1>/g)) properties.set(item[1], item[2].trim());
  for (const item of text.matchAll(/<(dependency|plugin|parent)>([\s\S]*?)<\/\1>/g)) {
    const block = item[2];
    const group = /<groupId>([^<]+)<\/groupId>/.exec(block)?.[1]?.trim();
    const artifact = /<artifactId>([^<]+)<\/artifactId>/.exec(block)?.[1]?.trim();
    const raw = /<version>([^<]+)<\/version>/.exec(block)?.[1]?.trim();
    if (!raw || !artifact || group?.startsWith('com.contoso')) continue;
    const variable = /^\$\{([^}]+)\}$/.exec(raw)?.[1];
    const value = variable ? properties.get(variable) : raw;
    if (!value || !VERSION.test(value)) continue;
    const actualGroup = group ?? (item[1] === 'plugin' ? 'org.apache.maven.plugins' : null);
    const source = actualGroup && !value.includes('${')
      ? `https://repo.maven.apache.org/maven2/${actualGroup.replaceAll('.', '/')}/${artifact}/${value}/${artifact}-${value}.pom`
      : sourceHints.get(value) ?? null;
    claims.push({ id: `${file}#maven:${item[1]}:${actualGroup}:${artifact}`, file,
      selector: { kind: 'maven', coordinate: `${actualGroup}:${artifact}`, property: variable ?? null },
      value, source, owner: owner(file), category: 'pin' });
  }
  for (const [name, value] of properties) {
    if (!/version|release/i.test(name) || !VERSION.test(value) && name !== 'maven.compiler.release') continue;
    const referenced = claims.find(claim => claim.selector.property === name);
    claims.push({ id: `${file}#property:${name}`, file, selector: { kind: 'maven-property', name }, value,
      source: referenced?.source ?? sourceHints.get(value) ??
        (name === 'maven.compiler.release' ? 'https://learn.microsoft.com/en-us/azure/app-service/configure-language-java' : null),
      owner: owner(file), category: 'pin' });
  }
  return claims;
}

function inventoryBicep(text, file) {
  const claims = [];
  for (const item of text.matchAll(/\bresource\s+([\w]+)\s+'([^'@]+)@([^']+)'/g)) {
    const [, symbol, resource, value] = item;
    const [provider, ...types] = resource.split('/');
    claims.push({ id: `${file}#resource:${symbol}`, file,
      selector: { kind: 'resource-api', symbol, resource }, value, owner: owner(file), category: 'api',
      source: `https://learn.microsoft.com/en-us/azure/templates/${provider.toLowerCase()}/${value}/${types.join('/').toLowerCase()}` });
  }
  const values = ['Developer', 'Standard_B1ms', 'Burstable', 'Balanced_B0', 'EnterpriseCluster', 'P1v3', 'EP1',
    'JAVA|25-java25', 'NODE|24-lts', 'Standard_LRS', 'Standard', '~4'];
  for (const value of values) {
    if (!text.includes(`'${value}'`)) continue;
    const source = value.includes('JAVA|') || value === 'P1v3'
      ? 'https://learn.microsoft.com/en-us/azure/app-service/configure-language-java'
      : value === '~4' || value === 'EP1' ? 'https://learn.microsoft.com/en-us/azure/azure-functions/supported-languages?pivots=programming-language-java'
        : value.startsWith('Balanced_') || value === 'EnterpriseCluster' ? 'https://learn.microsoft.com/en-us/azure/redis/overview'
          : value === 'Standard_B1ms' || value === 'Burstable' ? 'https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-compute'
            : value === 'Developer' ? 'https://learn.microsoft.com/en-us/azure/api-management/api-management-features'
              : value.includes('LRS') ? 'https://learn.microsoft.com/en-us/azure/storage/common/storage-redundancy'
                : value.includes('NODE|') ? 'https://learn.microsoft.com/en-us/azure/app-service/configure-language-nodejs'
                  : 'https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-services-resource-providers';
    claims.push({ id: `${file}#capability:${value}`, file, selector: { kind: 'literal-capability', literal: value },
      value, source, owner: owner(file), category: 'capability' });
  }
  return claims;
}

export async function discoverClaims(root = projectRoot) {
  const lock = JSON.parse((await readBoundFile(path.join('config', 'versions.lock.json'), root)).toString('utf8'));
  const hints = new Map();
  function hintsFrom(value) {
    if (!value || typeof value !== 'object') return;
    if (value.version && officialSource(value.source)) hints.set(value.version, value.source);
    Object.values(value).forEach(hintsFrom);
  }
  hintsFrom(lock);
  const list = [];
  for (const file of await filesUnder(root)) {
    const text = (await readBoundFile(file, root)).toString('utf8');
    if (file.endsWith('.json')) list.push(...inventoryJson(JSON.parse(text), file, hints));
    else if (file.endsWith('.xml')) list.push(...inventoryPom(text, file, hints));
    else list.push(...inventoryBicep(text, file));
  }
  const unique = new Map();
  for (const claim of list) {
    const previous = unique.get(claim.id);
    if (previous && previous.value !== claim.value) throw new Error(`Ambiguous pinned claim selector: ${claim.id}`);
    unique.set(claim.id, claim);
  }
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function createRegister(inventory) {
  return {
    schema: 'contoso.verification-register.v1', sourceAcceptanceIsCertification: false,
    numericPinLintScope: 'Deployable JSON/Maven/resource API and explicit SKU/runtime literals; semantic prose/support claims still require source review.',
    claims: inventory.map(claim => ({
      ...claim, label: officialSource(claim.source) || claim.category === 'contoso-owned' ? 'Partially verified' : 'Unsupported',
      verification: `VERIFY: ${claim.id} = ${claim.value}`,
      lockedValueVerified: true, deployedValueVerified: false, officialSourceContentVerified: false,
      prereleaseSupportNeedsVerification: /beta|alpha|preview|rc[.-]?\d/i.test(claim.value),
      test: 'node tools\\verification\\register.mjs --check',
      nextAction: claim.category === 'contoso-owned'
        ? 'Contoso-owned semantic version, not a vendor GA/support assertion; bind the actual reviewed artifact and runtime.'
        : officialSource(claim.source)
        ? 'Check exact source contents and approved deployed value; a release/POM pin is not runtime compatibility or regional support evidence.'
        : 'Owning role must supply an exact official source; do not treat this claim as verified.'
    }))
  };
}

export function validateRegister(register, inventory, { deployed = [], certify = false } = {}) {
  if (register?.schema !== 'contoso.verification-register.v1' || register.sourceAcceptanceIsCertification !== false ||
      !Array.isArray(register.claims) || !register.claims.length) throw new Error('Source-bound VERIFY register required');
  const byId = new Map();
  for (const claim of register.claims) {
    if (!claim.id || byId.has(claim.id) || !/^R[1-9]$/.test(claim.owner ?? '') ||
        !claim.verification?.startsWith('VERIFY:') || !claim.test ||
        !['Verified', 'Partially verified', 'Unsupported', 'Incorrect', 'Outdated'].includes(claim.label) ||
        !(officialSource(claim.source) || claim.category === 'contoso-owned' && claim.source === 'DECISIONS.md')) throw new Error(`Missing/invalid official source, owner or VERIFY test: ${claim.id ?? 'unknown'}`);
    byId.set(claim.id, claim);
  }
  if (new Set(inventory.map(claim => claim.id)).size !== inventory.length) throw new Error('Duplicate observed claim selector');
  for (const observed of inventory) {
    const registered = byId.get(observed.id);
    if (!registered) throw new Error(`Unregistered pin/API/SKU/capability claim: ${observed.id}`);
    if (registered.value !== observed.value || registered.source !== observed.source) throw new Error(`Locked/source value drift: ${observed.id}`);
  }
  if (inventory.length !== register.claims.length) throw new Error('Removed/stale registered claim requires adjudication');
  for (const observed of deployed) {
    const claim = byId.get(observed.id);
    if (!claim || claim.value !== observed.value || observed.sourceKind !== 'approved-native-runtime' ||
        !observed.evidenceSha256 || observed.observed !== true) throw new Error(`Deployed value drift/unverified observation: ${observed.id}`);
  }
  const open = register.claims.filter(claim => claim.label !== 'Verified' || !claim.officialSourceContentVerified || !claim.deployedValueVerified);
  if (certify && (open.length || deployed.length !== register.claims.length)) throw new Error('Open VERIFY items cannot certify; source hashes or locked values are not deployed evidence');
  return { schema: 'contoso.verify-register-result.v1', result: 'PASS', sourceAcceptanceIsCertification: false,
    registered: register.claims.length, open: open.map(claim => ({ id: claim.id, owner: claim.owner, label: claim.label, nextAction: claim.nextAction })) };
}

export async function registerMain(args) {
  const file = path.join(projectRoot, 'config', 'verification-register.v1.json');
  const inventory = await discoverClaims();
  if (args.length !== 1 || !['--freeze', '--refresh', '--check', '--certify'].includes(args[0])) throw new Error('Usage: register.mjs --freeze|--refresh|--check|--certify');
  if (args[0] === '--freeze' || args[0] === '--refresh') {
    const registry = createRegister(inventory);
    if (args[0] === '--refresh') {
      const previous = JSON.parse(await readFile(file, 'utf8'));
      const before = new Map(previous.claims.map(claim => [claim.id, claim]));
      registry.invalidatedPreviousClaims = inventory.filter(claim => before.has(claim.id) &&
        (before.get(claim.id).value !== claim.value || before.get(claim.id).source !== claim.source))
        .map(claim => ({ id: claim.id, oldValue: before.get(claim.id).value, value: claim.value,
          result: 'INVALIDATED', reason: 'New source snapshot registration is not deployed/source-content/support verification' }));
    }
    await writeFile(file, jsonBytes(registry), { flag: args[0] === '--freeze' ? 'wx' : 'w' });
    console.log(JSON.stringify({ result: 'REGISTERED_NOT_CERTIFIED', claims: registry.claims.length, sha256: sha256(jsonBytes(registry)) }));
    return;
  }
  const register = JSON.parse(await readFile(file, 'utf8'));
  const result = validateRegister(register, inventory, { certify: args[0] === '--certify' });
  console.log(JSON.stringify({ result: result.result, sourceAcceptanceIsCertification: false, registered: result.registered, open: result.open.length }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await registerMain(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
