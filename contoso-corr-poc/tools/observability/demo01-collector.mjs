import { readFile } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { collectRawTelemetry, createAzureLogsExecutor, rawRowEvidenceHash, renderRawQuery,
  requireNativeCaptureIdentity } from './raw-query.mjs';
import { HASH, TRACE, SPAN, UUID, normalizeTelemetryRows, ownedConfigurationHash, requireUtc, sha256 } from './telemetry-contract.mjs';
import { loadRootMap } from './kql.mjs';
import { scanGraphIntake, scanPrivacy } from '../security/telemetry.mjs';
import { adaptR7Capture, selectNativeCohort } from '../verification/raw-intake.mjs';
import { assertEvidenceCoverage, bindObservedProofs } from '../verification/evidence.mjs';
import { assertInvariants } from '../verification/invariants.mjs';
import { immutableReceiptMetadata, verifyCapturedQueryCapabilities, verifyObservedAssignments,
  verifyQueryExecutorReceipt } from '../verification/observers.mjs';
import { parseTraceparent } from '../protocol.mjs';

const sourcePath = fileURLToPath(import.meta.url);
export const DEMO01_COLLECTOR_SOURCE_SHA256 = sha256(await readFile(sourcePath));
const settlements = new WeakMap();
const fail = code => { throw Object.assign(new Error(code), { code }); };
const key = value => `${value.traceId}:${value.spanId}`;

function exactKeys(value, allowed) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some(name => !allowed.includes(name))) fail('DEMO01_UNSUPPORTED_INPUT');
}

async function checkSource() {
  if (sha256(await readFile(sourcePath)) !== DEMO01_COLLECTOR_SOURCE_SHA256) fail('DEMO01_LOADED_SOURCE_DRIFT');
}

function browserCarrier(browser, execution, mode) {
  if (browser?.schemaVersion !== 1 || browser.demoId !== 1 || browser.driverKind !== 'browser-spa' ||
      browser.sdkVersion !== '3.4.5' || browser.outcome !== 'staged' || !UUID.test(browser.runId ?? '') ||
      !Number.isSafeInteger(browser.invocationVersion) || browser.invocationVersion < 1 ||
      !UUID.test(execution?.businessInvocationId ?? '') || browser.businessInvocationId !== execution.businessInvocationId ||
      !Array.isArray(browser.observations) || !Array.isArray(browser.dependencies) || !Array.isArray(browser.browserContexts) ||
      (mode !== 'LocalValidate' && (browser.executionMode !== 'live' || browser.evidenceKind !== 'live-observation-not-certified'))) {
    fail('DEMO01_BROWSER_OBSERVATION_REQUIRED');
  }
  const matches = browser.observations.flatMap(observation => {
    const carrier = parseTraceparent(observation.traceparent);
    if (observation.method !== 'POST' || !/\/orders$/.test(observation.path ?? '') ||
        !(observation.status >= 200 && observation.status < 300) || !carrier.valid ||
        observation.contextRedacted === true || observation.businessInvocationId !== execution.businessInvocationId) return [];
    return browser.dependencies.filter(dependency => dependency.runId === browser.runId &&
      dependency.invocationVersion === browser.invocationVersion && dependency.traceId === carrier.traceId &&
      dependency.spanId === carrier.parentId && SPAN.test(dependency.spanId) &&
      (!dependency.businessInvocationId || dependency.businessInvocationId === execution.businessInvocationId))
      .map(dependency => ({ ...carrier, traceparent: observation.traceparent, dependency }));
  });
  if (matches.length !== 1) fail('DEMO01_UNAMBIGUOUS_BROWSER_CARRIER_REQUIRED');
  return matches[0];
}

function canaryParameters(execution, map) {
  const ledger = execution?.trafficLedger;
  if (ledger?.schema !== 'contoso.native-traffic-ledger.v1' || !HASH.test(ledger.evidenceSha256 ?? '') ||
      ledger.observationOrigin !== 'native-runtime' || ledger.complete !== true || ledger.dropped !== 0 ||
      !Array.isArray(ledger.spans) || !ledger.spans.length || !Array.isArray(ledger.canaries) ||
      ledger.canaries.length !== 2) fail('DEMO01_INDEPENDENT_EMISSION_LEDGER_REQUIRED');
  const contexts = ['before', 'after'].flatMap(position => {
    const canary = ledger.canaries.filter(item => item.position === position);
    if (canary.length !== 1 || !Array.isArray(canary[0].spans) ||
        map.coreSynchronousBoundaries.some(boundary => !canary[0].spans.some(span => span.boundaryId === boundary))) {
      fail('DEMO01_FULL_PATH_CANARIES_REQUIRED');
    }
    return canary[0].spans.filter(span => map.coreSynchronousBoundaries.includes(span.boundaryId)).map(span => {
      const boundary = map.spans.find(item => item.id === span.boundaryId);
      if (!TRACE.test(span.traceId ?? '') || !SPAN.test(span.spanId ?? '') ||
          span.traceId !== canary[0].traceId) fail('DEMO01_FULL_PATH_CANARIES_REQUIRED');
      return { position: position === 'before' ? 'pre' : 'post',
        table: boundary.semanticKind === 'SERVER' ? 'AppRequests' : 'AppDependencies',
        traceId: span.traceId, spanId: span.spanId };
    });
  });
  return { trafficLedgerSha256: ledger.evidenceSha256, contexts };
}

function scanOriginals(capture) {
  if (!Array.isArray(capture?.rows) || !Array.isArray(capture.rawTables) || !capture.scanReceipt) {
    fail('DEMO01_ORIGINAL_INTAKE_REQUIRED');
  }
  const privacy = scanGraphIntake({ tables: capture.rawTables, receipt: capture.scanReceipt });
  if (privacy.result !== 'PASS' || privacy.scannedAllColumns !== true ||
      privacy.scannedRawRecords !== capture.rows.length) fail('DEMO01_ORIGINAL_PRIVACY_FAILED');
  for (const table of capture.rawTables) {
    const rows = capture.rows.filter(row => row.nativeTable === table.name);
    const columns = table.columns.map(column => typeof column === 'string' ? column : column.name);
    if (rows.length !== table.rows.length) fail('DEMO01_ORIGINAL_CORRESPONDENCE_FAILED');
    table.rows.forEach((row, index) => {
      const values = Array.isArray(row) ? row : columns.map(column => row[column]);
      if (columns.some((column, ordinal) => JSON.stringify(rows[index][column]) !== JSON.stringify(values[ordinal])) ||
          Object.keys(rows[index]).some(column => !columns.includes(column) && !['nativeTable', 'ingestedAtUtc'].includes(column))) {
        fail('DEMO01_ORIGINAL_CORRESPONDENCE_FAILED');
      }
    });
  }
  return privacy;
}

function requireEmissionProof(proof, artifacts, sourceKind) {
  if (proof?.observed !== true || !artifacts.some(artifact =>
    ['native-runtime', 'native-contributor-ledger'].includes(artifact.kind) && artifact.sourceKind === sourceKind &&
    artifact.sha256 === proof.evidenceSha256 && ownedConfigurationHash(artifact.value) === artifact.sha256)) {
    fail('DEMO01_INDEPENDENT_EMISSION_PROOF_REQUIRED');
  }
}

/**
 * Assemble original raw intake and the existing browser/traffic-ledger contracts.
 * Fixture inputs are LocalValidate checker data only. Native inputs require the
 * original private RAW capture and an internally observed repeated-read settlement;
 * neither this projection nor JSON evidence enrolls runtime/transport authority.
 */
export async function bindDemo01Capture(capture, observations) {
  exactKeys(observations, ['mode', 'execution', 'browserEvidence', 'proofArtifacts', 'serializationByRole', 'settledRead']);
  await checkSource();
  const sourceKind = capture?.receipt?.sourceKind;
  const mode = observations.mode ?? 'LocalValidate';
  if (!['LocalValidate', 'BootstrapValidate', 'Certify'].includes(mode)) fail('DEMO01_INVALID_MODE');
  let settlement;
  let authenticatedPeerVerified = false;
  if (sourceKind === 'fixture-check') {
    if (mode !== 'LocalValidate') fail('DEMO01_FIXTURE_CANNOT_QUALIFY_NATIVE');
    settlement = { settledRead: observations.settledRead, firstCapture: null };
  } else {
    requireNativeCaptureIdentity(capture);
    settlement = settlements.get(capture);
    if (!settlement || observations.settledRead !== undefined ||
        settlement.observationsSha256 !== ownedConfigurationHash({ ...observations, mode })) {
      fail('DEMO01_ORIGINAL_NATIVE_SETTLEMENT_REQUIRED');
    }
    requireNativeCaptureIdentity(settlement.firstCapture);
    authenticatedPeerVerified = verifyCapturedQueryCapabilities(capture.verifiedQueryCapabilities, {
      scope: { workspaceId: capture.receipt.workspaceId, resourceId: capture.receipt.resourceId },
      queries: capture.receipt.executedQueries
    }).authenticatedPeerVerified;
  }
  const privacy = scanOriginals(capture);
  const { execution, browserEvidence, proofArtifacts, serializationByRole = {} } = immutableReceiptMetadata(observations);
  if (!Array.isArray(proofArtifacts)) fail('DEMO01_SOURCE_PROOFS_REQUIRED');
  const { map, mapSha256 } = await loadRootMap();
  if (settlement.boundaryMapSha256 && settlement.boundaryMapSha256 !== mapSha256) fail('DEMO01_BOUNDARY_SOURCE_DRIFT');
  const carrier = browserCarrier(browserEvidence, execution, sourceKind === 'fixture-check' ? mode : 'BootstrapValidate');
  canaryParameters(execution, map);
  if (requireUtc(execution.fromUtc, 'execution start') !== capture.receipt.fromUtc ||
      requireUtc(execution.toUtc, 'execution end') !== capture.receipt.toUtc) fail('DEMO01_EXECUTION_WINDOW_MISMATCH');
  const traceIds = [carrier.traceId, ...execution.trafficLedger.canaries.map(item => item.traceId)];
  if (new Set(traceIds).size !== 3 || !Array.isArray(execution.expectation?.traceIds) ||
      execution.expectation.traceIds.length !== traceIds.length ||
      traceIds.some(traceId => !execution.expectation.traceIds.includes(traceId))) fail('DEMO01_OBSERVED_COHORT_MISMATCH');
  const adapted = adaptR7Capture(capture, { settledRead: settlement.settledRead });
  const normalized = normalizeTelemetryRows(capture.rows, { schema: 'workspace', scope: adapted.receipt.scope,
    captureId: adapted.receipt.captureId, capturedAtUtc: adapted.receipt.capturedAtUtc,
    privacyDisposition: privacy, serializationByRole, sourceKind });
  const rows = selectNativeCohort(normalized, { traceIds, businessInvocationId: execution.businessInvocationId });
  const artifacts = [...proofArtifacts];
  requireEmissionProof({ observed: true, evidenceSha256: execution.trafficLedger.evidenceSha256 }, artifacts, sourceKind);
  const assignments = execution.trafficLedger.spans.map(emitted => {
    requireEmissionProof(emitted, artifacts, sourceKind);
    const matches = rows.filter(row => row.recordKind === 'span' && key(row) === key(emitted));
    if (matches.length !== 1 || !map.spans.some(boundary => boundary.id === emitted.boundaryId)) {
      fail('DEMO01_MISSING_OR_AMBIGUOUS_EMITTED_SPAN');
    }
    const row = matches[0];
    const raw = capture.rows[row.recordLocator.rowOrdinal];
    const evidenceSha256 = rawRowEvidenceHash(raw, { privacyDisposition: privacy });
    artifacts.push({ kind: 'native-row', sourceKind, value: raw, sha256: evidenceSha256 });
    return { traceId: row.traceId, spanId: row.spanId, boundaryId: emitted.boundaryId,
      observed: true, sourceLocator: row.recordLocator, evidenceSha256 };
  });
  const at = boundary => assignments.filter(item => item.traceId === carrier.traceId && item.boundaryId === boundary);
  if (at('storefront.http').length !== 1 || at('storefront.http')[0].spanId !== carrier.parentId) {
    fail('DEMO01_BROWSER_NATIVE_ID_MISMATCH');
  }
  const gateway = at('gateway.backend');
  const wire = (execution.nativeFacts ?? []).filter(fact => {
    const outgoing = parseTraceparent(fact.outboundTraceparent);
    return fact.type === 'gateway-wire' && fact.observed === true && fact.inboundTraceparent === carrier.traceparent &&
      outgoing.valid && outgoing.traceId === carrier.traceId && gateway.length === 1 && outgoing.parentId === gateway[0].spanId;
  });
  if (wire.length !== 1) fail('DEMO01_GATEWAY_CARRIER_MISMATCH');
  if (!artifacts.some(artifact => artifact.kind === 'native-wire' && artifact.sourceKind === sourceKind &&
      artifact.sha256 === wire[0].evidenceSha256)) fail('DEMO01_GATEWAY_SOURCE_PROOF_REQUIRED');
  if (!artifacts.some(artifact => artifact.kind === 'native-wire' && artifact.sourceKind === sourceKind &&
      artifact.sha256 === ownedConfigurationHash(browserEvidence))) fail('DEMO01_BROWSER_SOURCE_PROOF_REQUIRED');
  const browserSpan = rows.find(row => row.recordKind === 'span' && row.traceId === carrier.traceId && row.spanId === carrier.parentId);
  const context = browserEvidence.browserContexts.find(item => item.schemaVersion === 1 &&
    UUID.test(item.pageInstanceId ?? '') && item.identityKind === 'sdk-browser-context-not-span' &&
    item.sdkVersion === browserEvidence.sdkVersion && item.traceId === carrier.traceId &&
    (item.contextSpanId ?? null) === browserSpan.parentSpanId &&
    Date.parse(requireUtc(item.observedAtUtc, 'browser context')) >= Date.parse(capture.receipt.fromUtc) &&
    Date.parse(item.observedAtUtc) < Date.parse(capture.receipt.toUtc) &&
    (execution.expectation.browserContexts ?? []).some(proof => proof.traceId === item.traceId &&
      proof.contextSpanId === (item.contextSpanId ?? null) && proof.roleName === browserSpan.roleName &&
      proof.identityKind === item.identityKind && proof.evidenceSha256 === ownedConfigurationHash(item)));
  if (!context) fail('DEMO01_BROWSER_CONTEXT_SOURCE_MISMATCH');
  bindObservedProofs([...assignments, ...execution.trafficLedger.spans, ...execution.trafficLedger.canaries,
    ...(execution.nativeFacts ?? []), ...(execution.expectation.browserContexts ?? []),
    ...(execution.expectation.independentCohorts ?? [])], artifacts);
  verifyObservedAssignments(assignments, { rawRows: capture.rows, normalizedRows: normalized,
    receipt: adapted.receipt, proofArtifacts: artifacts, serializationByRole });
  assertEvidenceCoverage({ ...adapted, privacy, rows, trafficLedger: execution.trafficLedger,
    requiredBoundaries: map.coreSynchronousBoundaries, mode });
  assertInvariants({ map, rows, assignments, expectation: { ...execution.expectation,
    businessInvocationId: execution.businessInvocationId, paths: ['spa', 'sync'],
    requiredBoundaries: map.coreSynchronousBoundaries }, fromUtc: execution.fromUtc, toUtc: execution.toUtc, mode });
  for (const boundary of ['orders.request', 'inventory.request']) {
    if (!at(boundary).every(assignment => rows.find(row => row.recordKind === 'span' && key(row) === key(assignment))
      ?.businessInvocationId === execution.businessInvocationId)) fail('DEMO01_BACKEND_INVOCATION_MISMATCH');
  }
  await checkSource();
  return { ...adapted, assignments, proofArtifacts: artifacts, serializationByRole,
    collectorReceipt: { schema: 'contoso.demo01-collector.v1', sourceKind,
      collectorSourceSha256: DEMO01_COLLECTOR_SOURCE_SHA256, boundaryMapSha256: mapSha256,
      browserRunId: browserEvidence.runId, browserInvocationVersion: browserEvidence.invocationVersion,
      traceId: carrier.traceId, businessInvocationId: execution.businessInvocationId,
      browserEvidenceSha256: ownedConfigurationHash(browserEvidence), assignmentCount: assignments.length,
      authenticatedPeerVerified, independentProducerAuthorityVerified: false,
      nativeQualification: 'NOT RUN', certificationEligible: false, sourceAcceptanceIsCertification: false,
      rawRowsInMemoryOnly: true, globalTelemetrySafetyVerified: false },
    originalSettlingCapture: settlement.firstCapture };
}

/**
 * Concrete native reads use only the shipped pinned CLI executor, actual R8 scan
 * and R9 source verifier. observerId is a registry selector, never authentication.
 * collect(parameters, observations, {signal}) performs two equal six-table reads
 * at one watermark, at least 30 seconds apart. No callbacks or saved settlement.
 * Browser driving, independent emission observations and native approval are
 * external prerequisites; sampling fidelity and qualification remain separate.
 */
export function createDemo01Collector(configuration) {
  exactKeys(configuration, ['workspaceId', 'resourceId', 'azureCliExecutable', 'azureCliExecutableSha256',
    'allowAzureReads', 'readApprovalRef', 'observerId']);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(configuration.observerId ?? '')) fail('DEMO01_APPROVED_OBSERVER_SELECTOR_REQUIRED');
  const config = immutableReceiptMetadata(configuration);
  return Object.freeze({
    async collect(parameters, observations, controls = {}) {
      exactKeys(parameters, ['fromUtc', 'toUtc', 'ingestionWatermarkUtc', 'pageSize', 'maxRows', 'maxPages', 'mode']);
      exactKeys(observations, ['execution', 'browserEvidence', 'proofArtifacts', 'serializationByRole']);
      exactKeys(controls, ['signal']);
      const { signal } = controls;
      if (signal && !(signal instanceof AbortSignal)) fail('DEMO01_INVALID_ABORT_SIGNAL');
      if (signal?.aborted) fail('CAPTURE_ABORTED');
      const requested = immutableReceiptMetadata(parameters);
      const observed = immutableReceiptMetadata(observations);
      await checkSource();
      const mode = requested.mode ?? 'BootstrapValidate';
      if (!['LocalValidate', 'BootstrapValidate', 'Certify'].includes(mode)) fail('DEMO01_INVALID_MODE');
      browserCarrier(observed.browserEvidence, observed.execution, 'BootstrapValidate');
      const { map, mapSha256 } = await loadRootMap();
      const input = { ...requested, workspaceId: config.workspaceId, resourceId: config.resourceId, mode, signal,
        canary: canaryParameters(observed.execution, map), serializationByRole: observed.serializationByRole ?? {} };
      renderRawQuery('AppRequests', 'schema', input);
      if (requireUtc(observed.execution.fromUtc, 'execution start') !== requireUtc(input.fromUtc, 'capture start') ||
          requireUtc(observed.execution.toUtc, 'execution end') !== requireUtc(input.toUtc, 'capture end')) {
        fail('DEMO01_EXECUTION_WINDOW_MISMATCH');
      }
      const executeQuery = await createAzureLogsExecutor(config);
      const ports = { executeQuery, scanPrivacy, sourceKind: 'azure-monitor-logs', verifyQueryExecutorReceipt };
      const firstCapture = await collectRawTelemetry(input, ports);
      requireNativeCaptureIdentity(firstCapture);
      if (!firstCapture.receipt.complete) fail('DEMO01_INCOMPLETE_CAPTURE');
      const firstAtUtc = firstCapture.receipt.capturedAtUtc;
      await wait(30000, undefined, { signal });
      const capture = await collectRawTelemetry(input, ports);
      requireNativeCaptureIdentity(capture);
      if (!capture.receipt.complete || capture.receipt.rawRowsSha256 !== firstCapture.receipt.rawRowsSha256) {
        fail('DEMO01_UNSETTLED_CAPTURE');
      }
      settlements.set(capture, { firstCapture, observationsSha256: ownedConfigurationHash({ ...observed, mode }),
        boundaryMapSha256: mapSha256, settledRead: {
        firstAtUtc, lastAtUtc: capture.receipt.capturedAtUtc,
        firstRowsSha256: firstCapture.receipt.rawRowsSha256, lastRowsSha256: capture.receipt.rawRowsSha256
      } });
      return bindDemo01Capture(capture, { ...observed, mode });
    }
  });
}
