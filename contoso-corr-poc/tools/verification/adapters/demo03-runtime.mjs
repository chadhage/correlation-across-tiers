import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contextDecision, scanSource, verifySdkSourcePin } from '../../protocol.mjs';
import { HASH, readBoundFile, sha256 } from '../files.mjs';
import { VerificationFailure } from '../invariants.mjs';
import { immutableReceiptMetadata } from '../observers.mjs';

const fail = (code, detail) => { throw new VerificationFailure(code, detail); };
const requiredCases = ['valid-sampled', 'absent', 'invalid-zero-trace', 'valid-unsampled'];
const policyPaths = [
  'apim\\policies\\service-policy.xml',
  'apim\\policies\\api-policy.xml',
  ...['authn', 'authz', 'backend-proof', 'business-id', 'business-observe', 'context',
    'header-hygiene', 'request-guard', 'response-id'].map(name => `apim\\policies\\fragments\\contoso-${name}-v1.xml`),
  'infra\\modules\\apim-api-policies.bicep',
  'infra\\modules\\apim-observability.bicep'
];
export const DEMO03_SOURCE_PATHS = Object.freeze([
  'tools\\verification\\adapters\\demo03-runtime.mjs',
  'tools\\protocol.mjs',
  'tools\\verification\\files.mjs',
  'tools\\verification\\invariants.mjs',
  'tools\\verification\\observers.mjs',
  'apim\\demo03-cases.v1.json',
  'apim\\sdk-source-pin.json',
  'tests\\apim\\fixtures\\flag-rewrite.xml',
  'tests\\apim\\fixtures\\request-id-parent.xml',
  ...policyPaths
]);
const sourceSnapshot = () => Promise.all(DEMO03_SOURCE_PATHS.map(async file => ({
  path: file, sha256: sha256(await readBoundFile(file))
})));
const loadedSources = await sourceSnapshot();
const exactKeys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));

export async function verifyDemo03Sources(sources) {
  if (!Array.isArray(sources) || sources.length !== loadedSources.length ||
      sources.some((source, index) => !exactKeys(source, ['path', 'sha256']) ||
        source.path !== loadedSources[index].path || !HASH.test(source.sha256 ?? '') ||
        source.sha256 !== loadedSources[index].sha256) ||
      JSON.stringify(loadedSources) !== JSON.stringify(await sourceSnapshot())) {
    fail('D_DEMO03_SOURCE', 'The exact declared loaded construction sources must remain unchanged');
  }
  return immutableReceiptMetadata(loadedSources);
}

export function inspectDemo03Carriers(manifest) {
  if (!exactKeys(manifest, ['schemaVersion', 'purpose', 'publicOperation', 'requestBody', 'liveAcceptance', 'cases']) ||
      manifest.schemaVersion !== 1 || typeof manifest.purpose !== 'string' ||
      manifest.publicOperation !== '/contoso/v1/demo-runs' || manifest.liveAcceptance !== 'To Do' ||
      !exactKeys(manifest.requestBody, ['schemaVersion', 'demoId', 'scenario', 'failureBudget']) ||
      manifest.requestBody.schemaVersion !== 1 || manifest.requestBody.demoId !== 3 ||
      manifest.requestBody.scenario !== 'SAMPLING' || manifest.requestBody.failureBudget !== 0 ||
      !Array.isArray(manifest.cases) || manifest.cases.length < 4 || manifest.cases.length > 64) {
    fail('D_DEMO03_CARRIERS', 'The source carrier manifest must describe Demo 03 synthetic inputs only');
  }
  const cases = new Map();
  for (const vector of manifest.cases) {
    if (!exactKeys(vector, ['caseId', 'headers', 'expectedPolicyDeletion', 'expectedLiveAssertion']) ||
        typeof vector.caseId !== 'string' || cases.has(vector.caseId) ||
        !vector.headers || typeof vector.headers !== 'object' || Array.isArray(vector.headers) ||
        Object.keys(vector.headers).some(name => !['traceparent', 'tracestate'].includes(name)) ||
        Object.values(vector.headers).some(value => !(Array.isArray(value) ? value : [value])
          .every(entry => typeof entry === 'string' && entry.length <= 1024)) ||
        !Array.isArray(vector.expectedPolicyDeletion) || typeof vector.expectedLiveAssertion !== 'string') {
      fail('D_DEMO03_CARRIERS', 'Carrier vectors cannot contain credentials, duplicate case IDs or invented observations');
    }
    const decision = contextDecision(vector.headers.traceparent, vector.headers.tracestate);
    if (JSON.stringify(decision.deleteHeaders) !== JSON.stringify(vector.expectedPolicyDeletion)) {
      fail('D_DEMO03_CARRIERS', 'Carrier deletion expectations disagree with the actual local protocol implementation');
    }
    cases.set(vector.caseId, { vector, decision });
  }
  if (requiredCases.some(name => !cases.has(name))) fail('D_DEMO03_CARRIERS', 'All four required carrier cases must be present');
  const sampled = cases.get('valid-sampled').decision;
  const absent = cases.get('absent').decision;
  const invalid = cases.get('invalid-zero-trace').decision;
  const unsampled = cases.get('valid-unsampled').decision;
  if (!sampled.parent.valid || sampled.parent.flags !== '01' || sampled.tracerRootRequired ||
      absent.parent.disposition !== 'absent' || !absent.tracerRootRequired ||
      invalid.parent.disposition !== 'invalid' || !invalid.tracerRootRequired ||
      !/^00-0{32}-/.test(cases.get('invalid-zero-trace').vector.headers.traceparent) ||
      !unsampled.parent.valid || unsampled.parent.flags !== '00' || unsampled.tracerRootRequired) {
    fail('D_DEMO03_CARRIERS', 'Required sampled, absent, invalid-zero and unsampled cases must retain their distinct meanings');
  }
  return immutableReceiptMetadata({
    sourceKind: 'synthetic-carrier-inputs',
    nativeExecution: 'NOT RUN',
    sourceAcceptanceIsCertification: false,
    requiredCases: requiredCases.map(caseId => {
      const { vector, decision } = cases.get(caseId);
      return {
        caseId, headers: vector.headers, expectedPolicyDeletion: decision.deleteHeaders,
        localParentDisposition: decision.parent.disposition,
        tracerRootRequired: decision.tracerRootRequired,
        nativeAssertion: 'NOT RUN'
      };
    }),
    additionalCaseIds: [...cases.keys()].filter(name => !requiredCases.includes(name))
  });
}

export async function inspectDemo03Construction(...args) {
  if (args.length) fail('D_ARGUMENT', 'The construction inspector accepts no callbacks, observations or authority options');
  await verifyDemo03Sources(loadedSources);
  const carriers = inspectDemo03Carriers(JSON.parse((await readBoundFile('apim\\demo03-cases.v1.json')).toString('utf8')));
  const pin = JSON.parse((await readBoundFile('apim\\sdk-source-pin.json')).toString('utf8'));
  const findings = (await Promise.all(policyPaths.map(async file =>
    scanSource((await readBoundFile(file)).toString('utf8'), file)))).flat();
  if (!verifySdkSourcePin(pin) || findings.length) fail('D_DEMO03_SOURCE', 'Actual APIM construction source or SDK pin failed the local protocol scanner');
  const negativeControls = [];
  for (const [file, requiredCodes] of [
    ['tests\\apim\\fixtures\\flag-rewrite.xml', ['SAMPLED_FLAG_SURGERY', 'VALID_CONTEXT_WRITE']],
    ['tests\\apim\\fixtures\\request-id-parent.xml', ['REQUEST_ID_PROVENANCE']]
  ]) {
    const detectedCodes = [...new Set(scanSource((await readBoundFile(file)).toString('utf8'), file).map(finding => finding.code))];
    if (requiredCodes.some(code => !detectedCodes.includes(code))) fail('D_DEMO03_SOURCE', 'The actual forbidden-source fixture did not fail as required');
    negativeControls.push({ path: file, requiredCodes, detectedCodes, forbiddenInputRejected: true });
  }
  const sources = await verifyDemo03Sources(loadedSources);
  return immutableReceiptMetadata({
    schema: 'contoso.demo03-runtime-construction.v1',
    result: 'BLOCKED',
    runnableDemoAdapter: false,
    sourceAcceptanceIsCertification: false,
    certificationStatus: 'NOT CERTIFIED',
    nativeExecution: 'NOT RUN',
    sourceBinding: 'DECLARED LOADED CONSTRUCTION BYTES ONLY; NOT COMPLETE TRANSITIVE RUNTIME CLOSURE, INDEPENDENT REVIEW OR NATIVE ENROLLMENT',
    carriers,
    localProtocolChecks: {
      scope: 'APIM policy/module source and seeded forbidden-source controls only; not the whole PR gate or a Gateway run',
      policySourcesScanned: policyPaths.length, findings: [], negativeControls
    },
    blockingInterfaces: [
      { id: 'native-gateway-execution', requiredBy: ['execute', 'drain', 'stopTraffic'],
        missing: 'Approved authenticated deployed Gateway trigger/stop/drain and independent ingress/outbound wire plus real Gateway span observations for each case' },
      { id: 'native-query-enrollment', requiredBy: ['collect', 'scanPrivacy'],
        missing: 'Independently enrolled authenticated original-RAW query transport and original-column privacy receipt' },
      { id: 'native-sampling-control', requiredBy: ['prepare', 'observeSampling', 'reset'],
        missing: 'Reviewed finite native sampling apply/observe/restore operations, full participant inventory and independent emission ledger; -00 wire and active recording remain unobserved' },
      { id: 'owned-baseline-reset', requiredBy: ['prepare', 'reset'],
        missing: 'Actual captured run-owned baseline and concrete flags/data/messages reset leaving unowned state unchanged' },
      { id: 'durable-owned-recovery', requiredBy: ['restoreCapturedRun'],
        missing: 'Authenticated separate-process saved-run recovery; baseline hashes cannot reconstruct private values' },
      { id: 'reviewed-shared-native-pattern', requiredBy: ['execute', 'collect', 'reset'],
        missing: 'Reviewed native-ready DEM-00.1 and Demo 01 adapter pattern plus separately approved bounded target/traffic/control window' }
    ],
    sources
  });
}

export async function demo03ConstructionMain(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== '--check') fail('D_ARGUMENT', 'Only --check is available for blocked Demo 03 source construction');
  return inspectDemo03Construction();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await demo03ConstructionMain()));
    process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof VerificationFailure ? error.code : 'D_DEMO03_CONSTRUCTION');
    process.exitCode = 1;
  }
}
