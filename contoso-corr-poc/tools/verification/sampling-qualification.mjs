import path from 'node:path';
import { types } from 'node:util';
import { TRACE, SPAN, HASH } from '../observability/telemetry-contract.mjs';
import { nativeEvidenceHash, projectRoot, readBoundFile, sha256, verifyManifest } from './files.mjs';
import { immutableReceiptMetadata } from './observers.mjs';
import { VerificationFailure } from './invariants.mjs';

export const LINKED_GUARD_POLICY = 'DROP_VALID_UNSAMPLED_PARENT_AND_ALL_VALID_UNSAMPLED_LINKS';
const receipts = new WeakMap();
// Enrolled only from the witnessed, authorized local execution and its preserved bytes.
const witnessedExecutions = new Map([[
  'a0eb3028e4a3ba7b648ed96dff23fc87628a1e161f5164d7f169ff1f24f282dd',
  {
    executionReceiptSha256: '32307f6c6323452d099346bd3ff97c2b202b58ca18b84a7164cb3d71e130f716',
    originalXmlSha256: '892ff2f70e9412b00247dea58b47f3fc9fdd061e77d0f6b741f515c615520c85'
  }
]]);
const sourcePaths = [
  'workers\\messaging-core\\src\\test\\java\\com\\contoso\\messaging\\LinkedSamplingProbe.java',
  'workers\\messaging-core\\src\\test\\java\\com\\contoso\\messaging\\LinkedRootSamplingTest.java'
];
const fail = detail => { throw new VerificationFailure('E_LOCAL_QUALIFICATION', detail); };
const key = value => `${value.traceId}:${value.spanId}`;
const sameContext = (left, right) => key(left) === key(right) && left.sampled === right.sampled;

export function snapshotQualificationMetadata(value) {
  const visiting = new WeakSet();
  let entries = 0;
  const copy = (item, depth = 0) => {
    if (item === null || ['string', 'boolean'].includes(typeof item) ||
        typeof item === 'number' && Number.isFinite(item)) return item;
    if (!item || typeof item !== 'object' || types.isProxy(item) || depth > 64 ||
        ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(item)) ||
        Object.getPrototypeOf(item) === Array.prototype && !Array.isArray(item) || visiting.has(item)) {
      fail('Qualification metadata must be plain JSON without accessors, proxies, cycles or custom objects');
    }
    visiting.add(item);
    const result = Array.isArray(item) ? [] : Object.create(null);
    if (Array.isArray(result)) Object.setPrototypeOf(result, null);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || !descriptor || !descriptor.enumerable ||
          !Object.hasOwn(descriptor, 'value') || ++entries > 1000) {
        fail('Qualification metadata must be plain JSON without accessors or hidden fields');
      }
      result[key] = copy(descriptor.value, depth + 1);
    }
    visiting.delete(item);
    return result;
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Qualification metadata must be a plain JSON object');
  return immutableReceiptMetadata(copy(value));
}

function context(value) {
  if (!value || !TRACE.test(value.traceId ?? '') || !SPAN.test(value.spanId ?? '') ||
      typeof value.sampled !== 'boolean') fail('Missing actual valid SDK context/decision');
  return value;
}

function links(row) {
  let values;
  try { values = row.links ? JSON.parse(row.links) : []; }
  catch { fail('Malformed actual native link representation'); }
  if (!Array.isArray(values) || values.length > 32) fail('Invalid bounded native links');
  const keys = values.map(value => {
    if (!TRACE.test(value.operation_Id ?? '') || !SPAN.test(value.id ?? '') ||
        `${value.operation_Id}:${value.id}` === key(row)) fail('Invalid/self native contributor');
    return `${value.operation_Id}:${value.id}`;
  });
  if (new Set(keys).size !== keys.length) fail('Repeated native contributor');
  return keys;
}

function equalKeys(actual, expected) {
  if (JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) fail('Actual native contributor set differs');
}

export function checkLinkedSamplingQualification({ metadata, qualification, sourceReceipt, executionReceipt }) {
  metadata = snapshotQualificationMetadata(metadata);
  const tests = metadata?.ownerExecutedTests;
  if (metadata?.ownerRole !== 'R5' || metadata.guardPolicy !== LINKED_GUARD_POLICY ||
      metadata.sourceAcceptanceIsCertification !== false || metadata.boundedFullPathEvidence !== false ||
      metadata.everyOutgoingZeroSatisfied !== undefined && metadata.everyOutgoingZeroSatisfied !== true ||
      tests?.tests !== 1 || tests.passed !== 1 || tests.failed !== 0 || tests.errors !== 0 || tests.skipped !== 0 ||
      !HASH.test(metadata.sha256 ?? '') || !HASH.test(metadata.extensionSha256 ?? '')) {
    fail('Exact R5 policy/owner and successful executed assertion counts are required');
  }
  if (sourceReceipt?.schema !== 'contoso.qualification-preservation.v1' || sourceReceipt.ownerRole !== 'R5' ||
      sourceReceipt.preserverRole !== 'R9' || sourceReceipt.sourceAcceptanceIsCertification !== false ||
      sourceReceipt.ownerExecutedLocalNativeRetake !== true ||
      sourceReceipt.qualificationSha256 !== metadata.sha256 || sourceReceipt.artifactSha256 !== metadata.extensionSha256 ||
      sourceReceipt.guardArtifactVersion !== metadata.guardArtifactVersion || sourceReceipt.expectedGuardPolicy !== LINKED_GUARD_POLICY ||
      !Array.isArray(sourceReceipt.sources) || sourceReceipt.sources.length !== sourcePaths.length ||
      new Set(sourceReceipt.sources.map(value => value.path)).size !== sourcePaths.length ||
      sourcePaths.some(file => !sourceReceipt.sources.some(value => value.path === file && HASH.test(value.sha256 ?? '')))) {
    fail('Original complete source-preservation receipt is required');
  }
  if (executionReceipt?.schema !== 'contoso.local-junit-execution.v1' || executionReceipt.ownerRole !== 'R5' ||
      executionReceipt.preserverRole !== 'R9' || executionReceipt.sourceAcceptanceIsCertification !== false ||
      executionReceipt.sourceKind !== 'preserved-original-local-junit-execution' ||
      executionReceipt.qualificationSha256 !== metadata.sha256 || !HASH.test(executionReceipt.originalXmlSha256 ?? '') ||
      executionReceipt.testSuite !== 'com.contoso.messaging.LinkedRootSamplingTest' ||
      executionReceipt.testClass !== executionReceipt.testSuite ||
      executionReceipt.testMethod !== 'keepRequired00RootsUnsampledAndDelegate01MixedAndUnlinkedToExistingProvider' ||
      executionReceipt.tests !== 1 || executionReceipt.passed !== 1 || executionReceipt.failed !== 0 ||
      executionReceipt.errors !== 0 || executionReceipt.skipped !== 0 || executionReceipt.rawXmlRetained !== false) {
    fail('Actual preserved successful literal-requirement execution receipt is required');
  }
  if (qualification?.schemaVersion !== 1 || qualification.certified !== false ||
      qualification.guardPolicy !== LINKED_GUARD_POLICY || qualification.guardArtifactVersion !== metadata.guardArtifactVersion ||
      qualification.extensionSha256 !== metadata.extensionSha256 ||
      !Array.isArray(qualification.observations) || qualification.observations.length !== 3) {
    fail('Exact current-policy qualification schema/observations are required');
  }
  const modes = ['actual-native-producer-0', 'actual-native-producer-100', 'mixed-native-producer-0-and-100'];
  const phases = modes.map(mode => {
    const values = qualification.observations.filter(value => value.inputMode === mode);
    if (values.length !== 1) fail('Missing/duplicate actual ALL0, positive or MIX phase');
    return values[0];
  });
  for (let index = 0; index < phases.length; index++) {
    const phase = phases[index], decisions = phase.actualDecisions;
    if (phase.sourcePercentage !== [0, 100, -1][index] || phase.consumerPercentage !== 100 ||
        !decisions || !Array.isArray(decisions.inputContexts) || decisions.inputContexts.length !== 5 ||
        !Array.isArray(decisions.resultSends) || decisions.resultSends.length !== 2 ||
        !Array.isArray(decisions.batchItems) || decisions.batchItems.length !== 2 ||
        !Array.isArray(phase.actualNativeSpans) || !phase.actualNativeSpans.length ||
        phase.everyOutgoingZeroSatisfied !== (index === 0)) fail('Complete actual phase inputs/outcomes are required');
    const inputs = decisions.inputContexts.map(context);
    const flags = index === 0 ? [false, false, false, false, false]
      : index === 1 ? [true, true, true, true, true] : [true, true, true, false, true];
    if (inputs.some((value, ordinal) => value.sampled !== flags[ordinal]) ||
        new Set(inputs.map(key)).size !== inputs.length) fail('Actual producer flags/contexts differ or repeat');
    if (index === 2) {
      inputs.forEach((value, ordinal) => {
        const original = phases[ordinal === 3 ? 0 : 1].actualDecisions.inputContexts[ordinal];
        if (!sameContext(value, original)) fail('MIX must retain original whole producer contexts without bit/ID repair');
      });
    }
    const outputs = [decisions.ordinaryProcess, decisions.replaySend, decisions.fanIn,
      ...decisions.resultSends, ...decisions.batchItems].map(context);
    const unlinked = context(decisions.unlinkedRoot);
    if (!unlinked.sampled || outputs.some(value => value.sampled !== (index !== 0)) ||
        new Set([...outputs, unlinked].map(key)).size !== outputs.length + 1 ||
        outputs.some(value => inputs.some(input => input.spanId === value.spanId))) {
      fail('Every required actual output decision and unchanged unlinked delegate are required');
    }
    if (decisions.ordinaryProcess.traceId !== inputs[0].traceId ||
        decisions.replaySend.traceId === inputs[1].traceId || decisions.fanIn.traceId === inputs[2].traceId ||
        decisions.batchItems[0].traceId !== decisions.batchItems[1].traceId) fail('Actual continuation/new-root identity mismatch');
    const native = new Map(), spanIds = new Set();
    for (const row of phase.actualNativeSpans) {
      if (!TRACE.test(row.traceId ?? '') || !SPAN.test(row.spanId ?? '') || spanIds.has(row.spanId) ||
          typeof row.parentId !== 'string' || row.parentId && !SPAN.test(row.parentId)) fail('Missing/repeated/invalid actual native span');
      spanIds.add(row.spanId); native.set(key(row), row); links(row);
    }
    const actualOrdinary = native.has(key(decisions.ordinaryProcess)) ? 1 : 0;
    if (phase.exportedOrdinaryCount !== actualOrdinary || actualOrdinary !== (index === 0 ? 0 : 1) ||
        index === 0 && outputs.some(value => native.has(key(value))) ||
        index !== 0 && outputs.some(value => !native.has(key(value))) || !native.has(key(unlinked))) {
      fail('Actual SDK decisions must match the complete scoped native export slice');
    }
    if (index === 0) continue;
    const ordinary = native.get(key(decisions.ordinaryProcess)), replay = native.get(key(decisions.replaySend));
    const fanIn = native.get(key(decisions.fanIn));
    if (ordinary.parentId !== inputs[0].spanId || replay.parentId !== '' || fanIn.parentId !== '') {
      fail('Actual ordinary parent advance and linked-root parentlessness are required');
    }
    equalKeys(links(replay), [key(inputs[1])]);
    const branches = phase.actualNativeSpans.filter(row => row.traceId === inputs[2].traceId &&
      row.parentId === inputs[2].spanId && ['contoso.fulfillment.process', 'contoso.notify.process'].includes(row.name));
    if (branches.length !== 2 || new Set(branches.map(row => row.name)).size !== 2) fail('Independent actual branch PROCESS contributors missing');
    const resultLinks = decisions.resultSends.flatMap(value => {
      const row = native.get(key(value));
      if (row.parentId !== '' || links(row).length !== 1) fail('Result SEND must be an actual one-link root');
      return links(row);
    });
    equalKeys(resultLinks, branches.map(key));
    equalKeys(links(fanIn), [...branches, ...decisions.resultSends].map(key));
    const items = decisions.batchItems.map(value => native.get(key(value)));
    if (!items[0].parentId || items[0].parentId !== items[1].parentId) fail('Both batch items must use the actual mixed batch root');
    const root = native.get(`${items[0].traceId}:${items[0].parentId}`);
    if (!root || root.parentId !== '') fail('Actual parentless mixed batch root missing');
    equalKeys(links(root), inputs.slice(3).map(key));
  }
  return immutableReceiptMetadata({ checkerOnly: true, sourceAcceptanceIsCertification: false,
    result: 'PASS_LOCAL_SEMANTICS', nativeRowCounts: phases.map(value => value.actualNativeSpans.length),
    sourceExecutionBinding: 'UNVERIFIED', completeMatrixVerified: false, boundedFullPathEvidence: false });
}

export async function loadPreservedLinkedSamplingQualification(metadata) {
  metadata = snapshotQualificationMetadata(metadata);
  if (!metadata?.path || !metadata.executionReceiptPath || !HASH.test(metadata.executionReceiptSha256 ?? '')) {
    fail('Preserved qualification and execution paths are missing');
  }
  const bytes = await readBoundFile(metadata.path);
  if (sha256(bytes) !== metadata.sha256) fail('Preserved qualification hash changed');
  const directory = path.join(projectRoot, path.dirname(metadata.path));
  await verifyManifest(directory);
  const sourceReceipt = JSON.parse((await readBoundFile('source-receipt.json', directory)).toString('utf8'));
  const executionBytes = await readBoundFile(metadata.executionReceiptPath);
  if (sha256(executionBytes) !== metadata.executionReceiptSha256) fail('Preserved execution receipt hash changed');
  await verifyManifest(path.join(projectRoot, path.dirname(metadata.executionReceiptPath)));
  const executionReceipt = JSON.parse(executionBytes.toString('utf8'));
  const witnessed = witnessedExecutions.get(metadata.sha256);
  if (!witnessed || witnessed.executionReceiptSha256 !== metadata.executionReceiptSha256 ||
      witnessed.originalXmlSha256 !== executionReceipt.originalXmlSha256) {
    fail('No independently witnessed local execution enrollment; caller JSON/manifest cannot grant success');
  }
  const qualification = JSON.parse(bytes.toString('utf8'));
  const summary = checkLinkedSamplingQualification({ metadata, qualification, sourceReceipt, executionReceipt });
  for (const source of sourceReceipt.sources) {
    if (sha256(await readBoundFile(source.path)) !== source.sha256) fail('Preserved assertion source changed; current qualification unavailable');
  }
  const lock = JSON.parse((await readBoundFile('config\\versions.lock.json')).toString('utf8'));
  const extensions = lock.extensions.filter(value => value.module === 'extensions/parent-safe-sampler');
  if (extensions.length !== 1 || extensions[0].version !== metadata.guardArtifactVersion ||
      extensions[0].guardPolicy !== LINKED_GUARD_POLICY || extensions[0].sha256 !== metadata.extensionSha256 ||
      sha256(await readBoundFile(path.join(extensions[0].module, extensions[0].file))) !== metadata.extensionSha256) {
    fail('Actual current guard bytes/version/policy do not match the qualified local epoch');
  }
  const capability = Object.freeze(Object.create(null));
  receipts.set(capability, immutableReceiptMetadata({ ...summary, checkerOnly: false,
    metadata, metadataSha256: nativeEvidenceHash(metadata), actualAzureAuthority: false }));
  return capability;
}

export function requireLinkedSamplingQualification(capability, metadata) {
  const value = receipts.get(capability);
  if (!value) fail('Caller metadata/checker labels cannot mint a validated local report receipt');
  const snapshot = snapshotQualificationMetadata(metadata);
  if (value.metadataSha256 !== nativeEvidenceHash(snapshot)) fail('Caller metadata differs from the immutable validated local report receipt');
  return immutableReceiptMetadata(value);
}
