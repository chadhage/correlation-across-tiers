import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['node_modules', 'target', 'dist', 'tests', 'evidence', 'eval', 'evaluation', '.git', '.azure', '.cache', '.tools', '.java-work', 'deployment-artifact', 'test-results', 'playwright-report']);
const sourceExtensions = new Set(['.bicep', '.bicepparam', '.json', '.xml', '.yml', '.yaml', '.java', '.ts', '.js', '.mjs', '.sh', '.ps1', '.csproj']);
const prerelease = /-(?:alpha|beta|preview|rc)(?:[.-]|$)/i;

export function validatePortalNodeClassification(manifest, lockBytes, classification) {
  const lock = JSON.parse(lockBytes.toString('utf8'));
  const resolved = Object.entries(lock.packages ?? {}).filter(([, item]) => prerelease.test(item.version ?? ''));
  if (!classification || classification.scope !== 'PUBLIC_OFFICIAL_SOURCE_CLASSIFICATION_ONLY' ||
      classification.sourceAcceptanceIsCertification !== false ||
      classification.packageLock?.path !== 'web\\portal-ssr\\package-lock.json' ||
      classification.packageLock.sha256 !== createHash('sha256').update(lockBytes).digest('hex') ||
      !Array.isArray(classification.packages) || classification.packages.length !== resolved.length ||
      !resolved.length) throw new Error('Portal prerelease classification missing or lock/source drift');
  const seen = new Set();
  for (const [location, item] of resolved) {
    const packageName = location.split('node_modules/').at(-1);
    const observation = classification.packages.find(value => value.lockLocation === location);
    const components = manifest.components.filter(value => value.packageName === packageName);
    if (!observation || seen.has(observation.lockLocation) || components.length !== 1) {
      throw new Error(`Missing/duplicate Portal prerelease classification: ${packageName}`);
    }
    seen.add(observation.lockLocation);
    const component = components[0];
    let officialRelease = false;
    try {
      const url = new URL(observation.officialReleaseSource);
      officialRelease = url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password &&
        url.pathname.startsWith('/Azure/azure-sdk-for-js/blob/') &&
        decodeURIComponent(url.pathname).includes(`${packageName}_${item.version}/`) &&
        url.pathname.endsWith('/CHANGELOG.md');
    } catch { /* Invalid public source remains unverified. */ }
    if (!officialRelease || observation.version !== item.version || observation.packageName !== packageName ||
        observation.releaseHeading !== `## ${item.version} (${observation.releasedOn})` ||
        !/^\d{4}-\d{2}-\d{2}$/.test(observation.releasedOn ?? '') ||
        component.version !== item.version || component.classificationSource !== observation.officialReleaseSource ||
        [component, observation].some(value => value.releaseClassification !== 'BETA_PRERELEASE' ||
          value.supportStatus !== 'UNVERIFIED') || component.status !== 'UNVERIFIED' ||
        observation.vendorGaVerified !== false || observation.deployedValueVerified !== false ||
        observation.runtimeCompatibilityVerified !== false ||
        observation.policySource !== 'https://azure.github.io/azure-sdk/policies_support.html') {
      throw new Error(`Portal beta cannot inherit GA/support/deployment clearance: ${packageName}`);
    }
  }
  return { result: 'PASS', scope: classification.scope, classifiedPrereleases: resolved.length,
    sourceAcceptanceIsCertification: false, certificationDependenciesVerified: false };
}

export function checkCertificationSource(name, text) {
  const findings = [];
  const rules = [
    ['removed-servicebus-requirement', /(?:Azure\.Messaging\.ServiceBus|Azure\.ServiceBus|Microsoft\.Azure\.ServiceBus)[\s\S]{0,100}7\.13\.0/i],
    ['removed-activity-switch', /Azure\.Experimental\.EnableActivitySource/],
    ['classic-java-adaptive-sampling', /classic\s+adaptive\s+sampling/i],
    ['retired-cache-resource', /(?:resource\s+\w+\s+['"]Microsoft\.Cache\/redis@|['"]type['"]\s*:\s*['"]Microsoft\.Cache\/redis['"])/i],
    ['apim-native-otlp-assumption', /(?:httpCorrelationProtocol|loggerType)\s*[:=]\s*['"](?:OTLP|openTelemetry)['"]/i]
  ];
  for (const [rule, pattern] of rules) if (pattern.test(text)) findings.push({ file: name, rule });
  if ((name.endsWith('.bicep') || name.endsWith('.bicepparam') || name.endsWith('azure.yaml')) &&
      /(?:\.\.\/|\.\/|[\\/'"])(?:eval|evaluation)[\\/]/i.test(text)) {
    findings.push({ file: name, rule: 'evaluation-on-certification-path' });
  }
  return findings;
}

export function validateCertificationManifest(manifest) {
  if (manifest.schema !== 'contoso.certification-dependencies.v1' || manifest.baseline !== 'direct-azure-monitor') throw new Error('Unsupported certification manifest');
  if (!Array.isArray(manifest.components) || !manifest.components.length) throw new Error('Certification components are required');
  const ids = new Set();
  for (const component of manifest.components) {
    if (!component.id || ids.has(component.id)) throw new Error('Duplicate/missing certification component');
    ids.add(component.id);
    if (component.status === 'GA' && prerelease.test(component.version ?? '')) {
      throw new Error(`Prerelease cannot be GA: ${component.id}`);
    }
    if (!['GA', 'Contoso-owned'].includes(component.status)) throw new Error(`Preview/unknown dependency: ${component.id}`);
    if (!component.source) throw new Error(`Missing dependency source: ${component.id}`);
    if (component.status === 'GA') {
      const url = new URL(component.source);
      if (url.protocol !== 'https:' || !['learn.microsoft.com', 'github.com', 'www.w3.org', 'opentelemetry.io'].includes(url.hostname)) throw new Error(`Non-authoritative dependency source: ${component.id}`);
      if (url.hostname === 'github.com' && !/^\/(?:microsoft|Azure|Azure-Samples)\//.test(url.pathname)) throw new Error(`Non-authoritative GitHub source: ${component.id}`);
    } else if (path.isAbsolute(component.source) || component.source.includes('..')) {
      throw new Error(`Contoso-owned source escapes repository: ${component.id}`);
    }
  }
  for (const flag of ['noPreviewDependency', 'noNativeApimOtlpAssumption', 'noAzureCacheForRedis', 'noClassicJavaAdaptiveSampling', 'contosoOwnedCodeIsNotAnAzureGaAnnouncement']) {
    if (manifest.constraints?.[flag] !== true) throw new Error(`Missing certification constraint: ${flag}`);
  }
}

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(file));
    else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) files.push(file);
  }
  return files;
}

export async function checkCertificationPath() {
  const manifest = JSON.parse(await readFile(path.join(root, 'config', 'certification-dependencies.json'), 'utf8'));
  validateCertificationManifest(manifest);
  const files = (await collect(root)).filter((file) => file !== fileURLToPath(import.meta.url));
  const findings = [];
  for (const file of files) {
    findings.push(...checkCertificationSource(path.relative(root, file), await readFile(file, 'utf8')));
  }
  if (findings.length) throw new Error(JSON.stringify({ gate: 'GATE-07', result: 'FAIL', findings }));
  return { gate: 'GATE-07', scope: 'static', result: 'PASS', checkedFiles: files.length, components: manifest.components.length, liveWhatIf: 'NOT RUN' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: node tools\\certification-path.mjs');
  console.log(JSON.stringify(await checkCertificationPath()));
}
