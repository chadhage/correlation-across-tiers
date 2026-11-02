import { LINKED_GUARD_POLICY } from '../../tools/verification/sampling-qualification.mjs';

export function samplingFixture() {
  let sequence = 1;
  const id = width => (sequence++).toString(16).padStart(width, '0');
  const span = (sampled, traceId = id(32)) => ({ traceId, spanId: id(16), sampled });
  const zero = Array.from({ length: 5 }, () => span(false));
  const one = Array.from({ length: 5 }, () => span(true));
  const makePhase = (inputs, ordinal) => {
    const sampled = ordinal !== 0;
    const ordinary = span(sampled, inputs[0].traceId), replay = span(sampled);
    const branches = [span(sampled, inputs[2].traceId), span(sampled, inputs[2].traceId)];
    const results = [span(sampled), span(sampled)], fanIn = span(sampled), batchRoot = span(sampled);
    const items = [span(sampled, batchRoot.traceId), span(sampled, batchRoot.traceId)], unlinked = span(true);
    const row = (value, name, parentId = '', contributors = []) => ({ traceId: value.traceId, spanId: value.spanId,
      name, parentId, links: contributors.length ? JSON.stringify(contributors.map(x => ({ operation_Id: x.traceId, id: x.spanId }))) : '' });
    const native = [row(unlinked, 'contoso.sampling.unlinked.control')];
    if (sampled) native.push(row(ordinary, 'contoso.fulfillment.process', inputs[0].spanId),
      row(replay, 'contoso.replay.send', '', [inputs[1]]),
      row(branches[0], 'contoso.fulfillment.process', inputs[2].spanId),
      row(branches[1], 'contoso.notify.process', inputs[2].spanId),
      row(results[0], 'contoso.servicebus.send', '', [branches[0]]),
      row(results[1], 'contoso.servicebus.send', '', [branches[1]]),
      row(fanIn, 'contoso.fanin.process', '', [...branches, ...results]),
      row(batchRoot, 'contoso.eventhubs.batch.process', '', inputs.slice(3)),
      ...items.map(value => row(value, 'contoso.eventhubs.batch.process', batchRoot.spanId)));
    return { sourcePercentage: [0, 100, -1][ordinal],
      inputMode: ['actual-native-producer-0', 'actual-native-producer-100', 'mixed-native-producer-0-and-100'][ordinal],
      consumerPercentage: 100, actualDecisions: { inputContexts: inputs, ordinaryProcess: ordinary, replaySend: replay,
        resultSends: results, fanIn, batchItems: items, unlinkedRoot: unlinked },
      actualNativeSpans: native, exportedOrdinaryCount: sampled ? 1 : 0, everyOutgoingZeroSatisfied: !sampled };
  };
  const metadata = { ownerRole: 'R5', guardPolicy: LINKED_GUARD_POLICY, guardArtifactVersion: '1.1.0',
    sha256: 'a'.repeat(64), extensionSha256: 'b'.repeat(64), sourceAcceptanceIsCertification: false,
    boundedFullPathEvidence: false, ownerExecutedTests: { tests: 1, passed: 1, failed: 0, errors: 0, skipped: 0 } };
  const sources = [
    'workers\\messaging-core\\src\\test\\java\\com\\contoso\\messaging\\LinkedSamplingProbe.java',
    'workers\\messaging-core\\src\\test\\java\\com\\contoso\\messaging\\LinkedRootSamplingTest.java'
  ].map(path => ({ path, sha256: 'c'.repeat(64) }));
  return { fixtureScope: 'CHECKER ONLY — all IDs synthetic; never native execution authority',
    metadata,
    qualification: { schemaVersion: 1, certified: false, guardPolicy: LINKED_GUARD_POLICY,
      guardArtifactVersion: '1.1.0', extensionSha256: metadata.extensionSha256,
      observations: [makePhase(zero, 0), makePhase(one, 1), makePhase([one[0], one[1], one[2], zero[3], one[4]], 2)] },
    sourceReceipt: { schema: 'contoso.qualification-preservation.v1', ownerRole: 'R5', preserverRole: 'R9',
      sourceAcceptanceIsCertification: false, ownerExecutedLocalNativeRetake: true,
      qualificationSha256: metadata.sha256, artifactSha256: metadata.extensionSha256,
      guardArtifactVersion: '1.1.0', expectedGuardPolicy: LINKED_GUARD_POLICY, sources },
    executionReceipt: { schema: 'contoso.local-junit-execution.v1', ownerRole: 'R5', preserverRole: 'R9',
      sourceKind: 'preserved-original-local-junit-execution', sourceAcceptanceIsCertification: false,
      qualificationSha256: metadata.sha256, originalXmlSha256: 'd'.repeat(64),
      testSuite: 'com.contoso.messaging.LinkedRootSamplingTest', testClass: 'com.contoso.messaging.LinkedRootSamplingTest',
      testMethod: 'keepRequired00RootsUnsampledAndDelegate01MixedAndUnlinkedToExistingProvider',
      tests: 1, passed: 1, failed: 0, errors: 0, skipped: 0, rawXmlRetained: false } };
}
