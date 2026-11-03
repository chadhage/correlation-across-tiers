import assert from 'node:assert/strict';
import test from 'node:test';
import { CERTIFICATION_CRITERIA, renderCertificationReport, validateCertificationAssessment } from '../../tools/verification/report.mjs';
import { samplingFixture } from './sampling-fixture.mjs';

const state = () => ({ schema: 'contoso.certification-assessment.v1', certificationStatus: 'NOT CERTIFIED',
  sourceAcceptanceIsCertification: false, versionsSha256: 'a'.repeat(64),
  rows: CERTIFICATION_CRITERIA.map(item => ({ criterion: item.name, result: 'NOT RUN' })) });

test('persisted assessment PASS/coverage/auth/source labels cannot grant a native result', () => {
  validateCertificationAssessment(state());
  const value = state();
  value.rows[0] = { ...value.rows[0], result: 'PASS', coverage: { complete: true },
    authenticatedPeerVerified: true, sourceSha256: 'b'.repeat(64) };
  assert.throws(() => renderCertificationReport(value), /actual live execution authority is unavailable/);
  assert.throws(() => validateCertificationAssessment({ ...state(), rows: [] }), /Preparation assessment/);
});

test('local metadata without validated original source/execution capability cannot affirm success', () => {
  const value = state();
  value.localSamplingQualification = samplingFixture().metadata;
  value.localSamplingQualification.artifactCurrent = true;
  const report = renderCertificationReport(value);
  assert.match(report, /HISTORICAL FAILED, c3/);
  assert.match(report, /UNVERIFIED local sampling qualification/);
  assert.doesNotMatch(report, /\*\*LOCAL QUALIFIED/);
  assert.match(report, /NOT full00 export absence, zero loss or full-path fidelity/);
  assert.match(report, /FAILED, local Java AV23/);
  assert.equal([...report.matchAll(/\*\*NOT RUN\*\*/g)].length, 11);
});

test('reviewer four same-identity negative metadata vectors cannot render literal00 success', () => {
  for (const override of [{ ownerExecutedTests: { tests: 1, passed: 0, failed: 1, errors: 0, skipped: 0 } },
    { ownerRole: 'R8' }, { everyOutgoingZeroSatisfied: false }, { guardPolicy: 'DROP_VALID_UNSAMPLED_PARENT' }]) {
    const value = state();
    value.localSamplingQualification = { ...samplingFixture().metadata, ...override };
    const report = renderCertificationReport(value, { localSamplingCapability: { verified: true, result: 'PASS' } });
    assert.match(report, /UNVERIFIED local sampling qualification/);
    assert.doesNotMatch(report, /\*\*LOCAL QUALIFIED/);
  }
});

test('saved Security PASS/source/count labels cannot render selected A/B/C qualification', () => {
  const value = state();
  value.localSecurityQualification = { result: 'LOCAL_SELECTED_SCOPE_VERIFIED', verified: true,
    nativeReceiptSha256: 'b380966e1858f455348dd9bbf071fb76f432ed664367f817a9ab860d8028742e',
    observedNativeHttpDependencies: { jwks: 1, managedIdentity: 2 } };
  const report = renderCertificationReport(value, { localSecurityCapability: value.localSecurityQualification });
  assert.match(report, /UNVERIFIED current selected Security A\/B\/C qualification/);
  assert.doesNotMatch(report, /\*\*LOCAL SELECTED SECURITY A\/B\/C QUALIFIED/);
  assert.match(report, /header_isolation_only/);
  assert.match(report, /No fullAV23\/API_READY/);
  assert.equal([...report.matchAll(/\*\*NOT RUN\*\*/g)].length, 11);
});
