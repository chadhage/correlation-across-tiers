import assert from 'node:assert/strict';
import test from 'node:test';
import { assertCertificationAssessmentCurrent, prepareCertificationAssessment, preserveHistoricalQualification,
  renderCertificationReport, validateCertificationAssessment } from '../../tools/verification/report.mjs';
import { jsonBytes, sha256 } from '../../tools/verification/files.mjs';

const sources = [{ path: 'tools\\protocol.mjs', sha256: 'a'.repeat(64) }];
const versions = 'b'.repeat(64);
const original = () => prepareCertificationAssessment(undefined, sources, versions);

test('assessment invalidation advances exact source and version snapshots without resetting invalidated rows', () => {
  const previous = original();
  previous.rows[0].result = 'INVALIDATED';
  previous.rows[0].changedSources = ['earlier-source.mjs'];
  const changed = [{ ...sources[0], sha256: 'c'.repeat(64) }, { path: 'tools\\new-runtime.mjs', sha256: 'd'.repeat(64) }];
  const result = prepareCertificationAssessment(previous, changed, 'e'.repeat(64));
  assert.deepEqual(result.sourceSnapshot, changed);
  assert.equal(result.sourceSnapshotSha256, sha256(jsonBytes(changed)));
  assert.equal(result.versionsSha256, 'e'.repeat(64));
  assert.ok(result.rows.every(row => row.result === 'INVALIDATED'));
  assert.ok(result.rows[0].changedSources.includes('earlier-source.mjs'));
  assert.deepEqual(previous.sourceSnapshot, sources);
  assertCertificationAssessmentCurrent(result, changed, 'e'.repeat(64));
  assert.ok(prepareCertificationAssessment(result, changed, 'e'.repeat(64)).rows.every(row => row.result === 'INVALIDATED'));
  const versionsOnly = prepareCertificationAssessment(original(), sources, 'c'.repeat(64));
  assert.ok(versionsOnly.rows.every(row => row.result === 'INVALIDATED' && row.changedSources.includes('VERSIONS.md')));
});

test('stale assessment sources and versions reject even when every rendered row was already invalidated', () => {
  const current = original();
  current.rows.forEach(row => { row.result = 'INVALIDATED'; });
  assertCertificationAssessmentCurrent(current, sources, versions);
  assert.throws(() => assertCertificationAssessmentCurrent(current, [{ ...sources[0], sha256: 'c'.repeat(64) }], versions), /are stale/);
  assert.throws(() => assertCertificationAssessmentCurrent(current, sources, 'c'.repeat(64)), /are stale/);
  const forgedDigest = structuredClone(current);
  forgedDigest.sourceSnapshot[0].sha256 = 'f'.repeat(64);
  assert.throws(() => assertCertificationAssessmentCurrent(forgedDigest, sources, versions), /are stale/);
});

test('prior scoped sampling and security metadata survive as immutable-identity history, not qualification', () => {
  const previous = original();
  previous.localSamplingQualification = { ownerRole: 'R5', scope: 'historical-compiled-binary-only' };
  previous.localSecurityQualification = { result: 'LOCAL_SELECTED_SCOPE_VERIFIED', nativeHttpDependencies: 3 };
  const refreshed = prepareCertificationAssessment(previous, [{ ...sources[0], sha256: 'c'.repeat(64) }], versions);
  assert.equal(refreshed.qualificationHistory.length, 2);
  assert.deepEqual(refreshed.qualificationHistory[0].originalMetadata, previous.localSamplingQualification);
  assert.deepEqual(refreshed.qualificationHistory[1].originalMetadata, previous.localSecurityQualification);
  preserveHistoricalQualification(refreshed, 'localSecurityQualification', 'failed current intake');
  assert.equal(refreshed.qualificationHistory.length, 2);
  const report = renderCertificationReport(refreshed);
  assert.match(report, /HISTORICAL_ONLY/);
  assert.match(report, /UNVERIFIED local sampling qualification/);
  assert.match(report, /UNVERIFIED current selected Security A\/B\/C qualification/);
  assert.doesNotMatch(report, /\*\*LOCAL QUALIFIED|\*\*LOCAL SELECTED SECURITY A\/B\/C QUALIFIED/);
  const changed = structuredClone(refreshed);
  changed.qualificationHistory[0].originalMetadata.ownerRole = 'R4';
  assert.throws(() => validateCertificationAssessment(changed), /change original metadata/);
});

test('orchestrator source-only construction sections and current roster survive a preserving refresh', () => {
  const previous = original();
  previous.constructionNotes = {
    schema: 'contoso.certification-construction-notes.v1', sourceAcceptanceIsCertification: false,
    currentRoster: 'Fresh independent R1–R9 routing; no alias self-review.',
    sections: [{ title: 'Construction children — swarm-20261102', markdown: 'Exact immutable review links stay preserved; source/unit only, NOT CERTIFIED.' }]
  };
  previous.additionalScopedNote = 'preserve an existing assessment key';
  const refreshed = prepareCertificationAssessment(previous, sources, versions);
  assert.deepEqual(refreshed.constructionNotes, previous.constructionNotes);
  assert.equal(refreshed.additionalScopedNote, previous.additionalScopedNote);
  const report = renderCertificationReport(refreshed);
  assert.match(report, /Fresh independent R1–R9 routing/);
  assert.match(report, /Exact immutable review links stay preserved/);
  assert.match(report, /source\/construction-only notes supply no current native\/hosted execution capability/);
  assert.doesNotMatch(report, /logical R1 → existing R3/);
});

test('notes, history and prior JSON cannot mint native approval or resurrect a passing criterion', () => {
  const bad = original();
  bad.constructionNotes = { schema: 'contoso.certification-construction-notes.v1',
    sourceAcceptanceIsCertification: true, sections: [] };
  assert.throws(() => renderCertificationReport(bad), /never native approval authority/);
  const passing = original();
  passing.rows[0].result = 'PASS';
  assert.throws(() => prepareCertificationAssessment(passing, sources, versions), /actual live execution authority is unavailable/);
  const history = original();
  history.qualificationHistory = [{ status: 'CURRENT_QUALIFIED', sourceAcceptanceIsCertification: false }];
  assert.throws(() => renderCertificationReport(history), /cannot grant current\/native authority/);
});

test('missing or duplicate source scopes and invalid version digests fail closed', () => {
  assert.throws(() => prepareCertificationAssessment(undefined, [], versions), /nonempty unique/);
  assert.throws(() => prepareCertificationAssessment(undefined, [...sources, sources[0]], versions), /nonempty unique/);
  assert.throws(() => prepareCertificationAssessment(undefined, sources, '0'.repeat(64)), /nonempty unique/);
});
