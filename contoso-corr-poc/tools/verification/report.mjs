import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot, jsonBytes, readBoundFile, sha256 } from './files.mjs';
import { invalidateChangedSources, sourceSnapshot } from './demo.mjs';
import { loadPreservedLinkedSamplingQualification, requireLinkedSamplingQualification } from './sampling-qualification.mjs';
import { intakeSelectedSecurityClientEpoch, requireSelectedSecurityQualification } from './security-client-qualification.mjs';

export const CERTIFICATION_CRITERIA = [
  { name: 'Coverage', demos: '01, 02, 06–12', gates: 'GATE-05, GATE-08, GATE-09', next: 'Run all declared real HTTP/data/transport/worker paths with native before/after full-path canaries.' },
  { name: 'Trace identity', demos: '01–05, 11', gates: 'GATE-08, GATE-10', next: 'Bind actual native OperationIds, observed trust/cohort roots and carriers; no expected-map ID substitution.' },
  { name: 'Span identity', demos: '01, 05–09, 12, 14', gates: 'GATE-02, GATE-05, GATE-08', next: 'Observe unique emitted request/dependency spans, strict parent equality, active log/exception associations and native links.' },
  { name: 'No falsification', demos: '03, 04, 11, 13', gates: 'GATE-01, GATE-10', next: 'Keep local protocol guards separate from actual APIM wire advancement, strict unsampled SDK state and Entra identity observations.' },
  { name: 'Async honesty', demos: '06–11', gates: 'GATE-09', next: 'Measure every retry, DLQ/replay, fan-out/fan-in and mixed-context batch; native links must equal the persisted contributor ledger.' },
  { name: 'Durable lookup', demos: '04, 06–10', gates: 'GATE-08, GATE-10, GATE-13', next: 'Execute live business lookup over all intended native trace cohorts, with no extra traces and no caller-controlled authorization identity.' },
  { name: 'Data safety', demos: '11–13', gates: 'GATE-03, GATE-04, GATE-10', next: 'Execute full workspace/all-table raw-column classification and real negative effects; graph-intake privacy is not global GATE-04.' },
  { name: 'Operational stability', demos: '05, 15', gates: 'GATE-05, GATE-12', next: 'Observe approved-load latency/CPU/memory/throughput/backpressure/ingestion/cost, restart/flush and actual source-versus-backend span accounting.' },
  { name: 'Backend usability', demos: '01, 02, 08, 14', gates: 'GATE-08, GATE-13', next: 'Execute all three live KQL procedures and capture actual Application Map/Transaction Diagnostics graphs; empty screenshot slots do not pass.' },
  { name: 'Governance', demos: '13, 15', gates: 'GATE-03, GATE-04, GATE-06, GATE-12', next: 'Obtain actual RBAC/retention/purge/auth/key-rotation/budget evidence and six accountable owner signoffs.' },
  { name: 'Repeatability', demos: '01–15', gates: 'GATE-11, GATE-12, GATE-13', next: 'Repeat empty-group deploy/what-if/teardown and all fifteen native runs/resets; verify untampered packs, source invalidation and actual baseline restoration.' }
];
const statePath = path.join(projectRoot, 'evidence', 'verification', 'certification-assessment.json');
const reportPath = path.join(projectRoot, 'docs', 'CERTIFICATION_REPORT.md');

export function validateCertificationAssessment(state) {
  if (state?.schema !== 'contoso.certification-assessment.v1' ||
      state.certificationStatus !== 'NOT CERTIFIED' || state.sourceAcceptanceIsCertification !== false ||
      !Array.isArray(state.rows) || state.rows.length !== CERTIFICATION_CRITERIA.length ||
      new Set(state.rows.map(row => row.criterion)).size !== CERTIFICATION_CRITERIA.length ||
      state.rows.some(row => !CERTIFICATION_CRITERIA.some(item => item.name === row.criterion) ||
        !['NOT RUN', 'INVALIDATED'].includes(row.result))) {
    throw new Error('Preparation assessment cannot grant native results from persisted JSON; actual live execution authority is unavailable');
  }
}

export function renderCertificationReport(state, { localSamplingCapability, localSecurityCapability } = {}) {
  validateCertificationAssessment(state);
  let localQualification;
  try { localQualification = requireLinkedSamplingQualification(localSamplingCapability, state.localSamplingQualification); }
  catch { localQualification = null; }
  const localMetadata = localQualification?.metadata;
  let localSecurity;
  try { localSecurity = requireSelectedSecurityQualification(localSecurityCapability); }
  catch { localSecurity = null; }
  const lines = [
    '# Contoso certification report', '',
    '> **NOT CERTIFIED.** Preparation, unit fixtures, source reviews and configuration percentages are not live acceptance.',
    '',
    '## Executive summary', '',
    '- Implemented exact native A/B/C/links, source/paging/coverage/privacy/canary guards and all fifteen run/reset entry points.',
    '- Missing native adapters, absent rows, mismatched provenance or incomplete contributors fail closed.',
    '- Local checking may PASS; BootstrapValidate remains explicitly NOT CERTIFIED.',
    '- No Azure observer is enrolled; no actually observed complete Azure runtime roster exists in this preparation.',
    '- No bounded full-path Azure emission-versus-backend evidence, global privacy clearance or performance/owner signoff is claimed.',
    '- The source-bound VERIFY inventory includes direct/transitive lock pins; official source contents, support/GA and deployed values remain open.',
    '- Dependency/runtime/agent/policy/schema changes invalidate affected rows rather than silently retaining acceptance.',
    '- Approved acting implementation roles: logical R1 → existing R3; logical R6 → existing R5; parent performs failed R4 recovery. Logical backlog/kickoff remain unchanged, one WIP per executor, no alias self-review.',
    '',
    '## Scoped certification statement — GATE-12', '',
    'No environment or production path is certified. Prepared target: `contoso-corr / poc`, `centralus`.',
    `VERSIONS.md SHA-256 at this assessment: \`${state.versionsSha256}\`.`,
    'Tested scope: source/fixture/real-local owner regressions explicitly identified in their evidence, not Azure parity.',
    'Sampling scope: LocalValidate and finite NOT CERTIFIED bootstrap interfaces. No global 100% fidelity or zero-loss statement.',
    'A future certification must name the actually deployed resources, exact versions, paths and native sampling window; all thirteen gates and accountable signoffs remain required.',
    '',
    '## Brief §24 criteria', '',
    '| Criterion | Demos | Gates/checks | Native result | Evidence and next action |',
    '|---|---|---|---|---|'
  ];
  for (const row of state.rows) {
    const definition = CERTIFICATION_CRITERIA.find(item => item.name === row.criterion);
    lines.push(`| ${row.criterion} | ${definition.demos} | ${definition.gates}; tests\\verification | **${row.result}** | Local-only: evidence\\verification\\preparation-tests.json (when present). ${definition.next} |`);
  }
  lines.push('', 'No row is marked live PASS from reviewer votes, source hashes, default 100% settings, sampled-00 export absence, a fixture or a clean-looking map.',
    '', '## Accountable signoffs', '',
    '| Owner | Status | Required scope |', '|---|---|---|',
    '| Architecture | NOT RECORDED | Actual topology, trust boundaries, legal names and frozen inventory |',
    '| Application | NOT RECORDED | Real API/browser/worker behavior, durable identity and reset |',
    '| Platform | NOT RECORDED | Actual deployment/host/provider/network/RBAC ownership |',
    '| SRE / observability | NOT RECORDED | Native sampling, loss detector, thresholds, alert route and rollback |',
    '| Security / privacy | NOT RECORDED | Real Entra, HMAC cryptoperiod, full raw-table clearance and access/purge |',
    '| Data | NOT RECORDED | Actual private PostgreSQL/Managed Redis operations, safety and migration |',
    '', '## Evidence provenance and unresolved clauses', '',
    '- config\\acceptance-scopes.json maps every backlog clause to exact static/unit/documentation/live/signoff facets.',
    '- contracts\\verification-observer-registry.v1.json deliberately has no approved observers. A pinned CLI or injected query callback is not authentic Azure evidence.',
    '- Native request/dependency spans are counted separately from associated logs/events/exceptions and page-view display IDs. Duplicate emitted spans are never deduplicated.',
    '- The expected boundary map is used only to evaluate actual classified native rows. Source locators/digests must bind the real row and ID serialization.',
    '- Six-table graph-intake scanning is explicitly narrower than all-table GATE-04. Original IKey/client/geo/session metadata is scanned in memory and not persisted.',
    '- Single-page bounded capture is valid only within its observed limit. Multi-page capture needs an actually discovered stable physical key, unique/nonempty key counts and exhaustive immutable-watermark pages.',
    '- Settled query counts alone cannot prove no late/drop loss: the complete independent native emission ledger and distinct full-path before/after canaries are mandatory.',
    '- Screenshot slots are NOT CAPTURED. Entra/resource grants, deployment, live privacy/performance/cost checks and actual owner signoffs are unmet.',
    '',
    '### Observed mandatory-vector and AV23 gaps — no scope waiver',
    '',
    '- **HISTORICAL FAILED, c3 local actual provider:** authenticated producer00 → consumer100 keeps ordinary PROCESS00/same trace/non-export, but declared replay/result/fan-in/batch new roots become01. This did not satisfy SAMPLING_MATRIX Mandatory #2 every-outgoing00 on the same declared paths.',
    '- Preserved exact qualification: evidence\\verification\\linked-root-sampling\\qualification.json, SHA-256 `b81339a200aeafd21ee062dfdbcb29e20445abd2da36b26b326b11311d2c614e`; source-receipt.json records actual source/test/provider scope. JUnit observation collection PASS is not this facet PASS.',
    '- **User decision: extend_guard.** Existing valid-parent00 DROP is retained; a declared no-parent root with NONEMPTY ALL-valid-unsampled links must DROP. Sampled/mixed links and unlinked roots retain delegate decisions. No scope waiver, flag surgery, arbitrary parent or new provider.',
    '- The preserved c3/b813 failure remains historical and unmodified; it is never promoted into current qualification.',
    localQualification
      ? `- **LOCAL QUALIFIED**, guard ${localMetadata.guardArtifactVersion}, ${localMetadata.ownerRole} preserved owner execution: validated original source/execution receipts and ALL0/positive/MIX SDK decisions/native rows establish required00 ordinary/replay/results/fan-in/batch unsampled, ordinary same-trace/export0, and intact actual01/MIX0/1/unlinked delegate controls. Exact preserved qualification: \`${localMetadata.path}\`, SHA-256 \`${localMetadata.sha256}\`, guard bytes \`${localMetadata.extensionSha256}\`. The real1/1/0skip execution asserts the requirement. Owned-library source/build lineage remains **UNVERIFIED**; this is a compiled-binary local algorithm slice, not current-source certification.`
      : '- **UNVERIFIED local sampling qualification.** Missing/failing/unknown source, execution, owner, policy, actual decisions or current guard evidence cannot render literal00 success. Preserved prior observations remain separate; metadata/hash/manifest labels alone do not qualify them.',
    localQualification
      ? `- Validated scoped consumer native row totals: [${localQualification.nativeRowCounts.join(',')}], including unrelated/pre-trust/unlinked rows. These are NOT full00 export absence, zero loss or full-path fidelity. Current independent R9 compiled-binary algorithm, complete role/map/observer/native ACKs, source/build lineage, reviews and production acceptance remain separate.`
      : '- Unknown scoped row totals remain unknown. They are NOT full00 export absence, zero loss or full-path fidelity; complete native/source/owner acceptance remains unmet.',
    '- **HISTORICAL FAILED, local Java AV23:** original1.1.0/BB829 two-public-layer prototype still injected traceparent on JWKS/MI (990a), and the approve_okhttp false switch did not honor raw transport suppression (9cf). Exact originals remain unchanged. These are not relabelled PASS by the later contract or source changes; trusted JDK positive observations remain separate.',
    '- **User decision: header_isolation_only.** Public REST/network isolation must suppress all seven production identity headers while retaining eligible identity CLIENT instrumentation in the same provider. The raw unfiltered native-context transport is an expected NEGATIVE control, not discarded or asserted suppressed. Fresh changed-TestProbe A32 (841270) and parent B380 are separate from older A72/header-only B6a2.',
    localSecurity
      ? `- **LOCAL SELECTED SECURITY A/B/C QUALIFIED:** actual parent-executed JUnit${localSecurity.observedJUnit.tests}/0skip and native JWKS${localSecurity.observedNativeHttpDependencies.jwks}/MI${localSecurity.observedNativeHttpDependencies.managedIdentity} HTTP dependency records retain their original native IDs, actual published-root direct parent/trace and type. R9 independently bound current original source closure, execution logs/JUnit counts, tool bytes, fresh probe class and actually USED Security-wrapper/SDK backing JAR members. Exact A \`${localSecurity.buildReceiptSha256}\`, B \`${localSecurity.nativeReceiptSha256}\`, Security JAR \`${localSecurity.currentSecurityJarSha256}\`. Logical sends${localSecurity.logicalIdentitySends}, physical attempts${localSecurity.physicalWireAttempts}, native payloads${localSecurity.nativePayloads}/envelopes${localSecurity.nativeEnvelopes} are distinct bounded counters, not equality or full-export completeness. This is a read-only binding of that execution, not another native run.`
      : '- **UNVERIFIED current selected Security A/B/C qualification.** Parent B380 measured eligible JWKS/MI outputs in its local fixture, but source/hash/report labels alone cannot grant a current-source/USED qualification. Missing, changed or failing original execution/source/tool/artifact/member facts require a fresh approved epoch; caller JSON cannot mint the private receipt.',
    '- **Residual AV23/lineage scope:** original raw envelopes were intentionally not retained, so R9/peer reviewers cannot independently rescan every original. Unused Security/Core/Inventory/worker classes, configured-only OkHttp object usage, default-business-Netty USED, installed consumer adoption, live Entra/KV/private data, full exporter completeness, global privacy and Azure full-path/zero-loss remain UNVERIFIED. No fullAV23/API_READY or production/global certification is rendered.',
    '- These local observations are not Azure authentication/privacy/host/all-role certification. They narrow and invalidate applicable claims rather than being filled with expected properties or zero metrics.',
    '',
    '## VERIFY and residuals', '',
    'See config\\verification-register.v1.json for exact owners/values/source links/tests and open statuses. Numeric pin/API/SKU lint is executable; uncited semantic prose/support claims still require source review and remain unaccepted.',
    'See docs\\RESIDUAL_LIMITATIONS.md for all Brief §20 failure modes and §23 production-ready items, and docs\\DEMO_RUNBOOK.md for all fifteen operations/talk tracks.',
    '', '## Source invalidation', '',
    '`npm run verify:invalidate` compares the frozen assessment source scope with current dependencies, runtimes, agents, policies and contracts and marks affected rows INVALIDATED.',
    'A local regression rerun does not resurrect a prior live certification: new current native evidence and accountable approvals are required.',
    '', 'Contoso Eval A/B remain isolated and are not certification dependencies.', ''
  );
  return lines.join('\n');
}

export async function reportMain(args) {
  if (args.length !== 1 || !['--write', '--invalidate', '--check'].includes(args[0])) throw new Error('Usage: report.mjs --write|--invalidate|--check');
  const current = await sourceSnapshot();
  const versionsSha256 = sha256(await readBoundFile('VERSIONS.md'));
  let state;
  try { state = JSON.parse(await readFile(statePath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!state || args[0] === '--write') {
    state = {
      schema: 'contoso.certification-assessment.v1', certificationStatus: 'NOT CERTIFIED',
      sourceAcceptanceIsCertification: false, versionsSha256, sourceSnapshot: current,
      rows: CERTIFICATION_CRITERIA.map(item => ({ criterion: item.name, result: 'NOT RUN',
        sources: current.map(source => source.path), evidence: [] }))
    };
  } else {
    state.rows = invalidateChangedSources(state.sourceSnapshot, current, state.rows);
  }
  let localSamplingCapability;
  if (state.localSamplingQualification) {
    try {
      localSamplingCapability = await loadPreservedLinkedSamplingQualification(state.localSamplingQualification);
      state.localSamplingQualificationStatus = 'VALIDATED_LOCAL_COMPILED_BINARY_SLICE';
      delete state.localSamplingQualificationFailure;
    } catch (error) {
      state.localSamplingQualificationStatus = 'UNVERIFIED';
      state.localSamplingQualificationFailure = error.code ?? 'E_LOCAL_QUALIFICATION_UNAVAILABLE';
    }
  }
  let localSecurityCapability;
  try {
    localSecurityCapability = await intakeSelectedSecurityClientEpoch();
    state.localSecurityQualificationStatus = 'VALIDATED_WITNESSED_LOCAL_SELECTED_SCOPE_ONLY';
    state.localSecurityQualification = requireSelectedSecurityQualification(localSecurityCapability);
    delete state.localSecurityQualificationFailure;
  } catch (error) {
    state.localSecurityQualificationStatus = 'UNVERIFIED';
    state.localSecurityQualificationFailure = error.code ?? 'E_SECURITY_EPOCH';
    delete state.localSecurityQualification;
  }
  const report = renderCertificationReport(state, { localSamplingCapability, localSecurityCapability });
  if (args[0] === '--check') {
    if (report !== await readFile(reportPath, 'utf8')) throw new Error('Certification report is stale; run verify:invalidate');
  } else {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, jsonBytes(state));
    await writeFile(reportPath, report);
  }
  console.log(JSON.stringify({ criteria: state.rows.length, certificationStatus: 'NOT CERTIFIED',
    invalidated: state.rows.filter(row => row.result === 'INVALIDATED').length, livePassed: 0 }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await reportMain(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
