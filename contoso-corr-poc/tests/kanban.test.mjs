import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { expandNeeds, parseBacklog, projectRoot, renderKanban, reviewScopeDigest, reviewSourceDigest, updateAcceptance, validateReviewReport, validateState } from '../tools/kanban.mjs';

const wiki = path.join(projectRoot, '..', '.docs', 'wiki');
const backlog = await readFile(path.join(wiki, 'Contoso_E2E_Correlation_POC_Backlog.md'), 'utf8');
const board = await readFile(path.join(wiki, 'Contoso_E2E_Correlation_POC_Kanban.md'), 'utf8');
const cards = parseBacklog(backlog);
const empty = () => ({ schema: 'contoso.board-acceptance.v1', revision: 1, defaultStatus: 'To Do', phaseAwareConstructionApproved: true, records: {} });
const active = () => ({ status: 'In Progress', scope: 'construction', phase: 'draft', constructionReady: true, nextAction: 'Implement checker', waitingOn: [], criteria: [], reviews: [] });

test('imports exactly 78 original ranks, 13 gates and the 1:5 Kano mix', () => {
  assert.equal(cards.length, 78);
  assert.equal(cards.filter((card) => card.id.startsWith('GATE-')).length, 13);
  assert.equal(cards.filter((card) => card.kano === 'Dissatisfier').length, 13);
  assert.equal(cards.filter((card) => card.kano === 'Satisfier').length, 57);
  assert.equal(cards.filter((card) => card.kano === 'Delighter').length, 8);
  assert.equal(cards.reduce((sum, card) => sum + card.days, 0), 70);
});

test('expands range dependencies without dropping final certification edges', () => {
  assert.deepEqual(expandNeeds('INF-04 to INF-06'), ['INF-04', 'INF-05', 'INF-06']);
  const certificate = cards.find((card) => card.id === 'CRT-02');
  assert.ok(certificate.needs.includes('GATE-13'));
  assert.ok(certificate.needs.includes('DEM-15'));
  assert.ok(certificate.needs.includes('DOC-04'));
  assert.throws(() => expandNeeds('DEM-03 to DEM-01'), /Reversed/);
  assert.throws(() => expandNeeds('unknown'), /Unrecognized/);
});

test('rejects Blocked and unknown card states instead of silently defaulting', () => {
  const state = empty();
  state.records['GATE-03'] = { ...active(), status: 'Blocked' };
  assert.throws(() => validateState(cards, state), /Unsupported state/);
  state.records = { 'NOT-A-CARD': active() };
  assert.throws(() => validateState(cards, state), /Unknown state card/);
});

test('enforces one active card per role and returns stalled work to To Do', () => {
  const state = empty();
  state.records['GATE-07'] = active();
  state.records['GATE-11'] = active();
  assert.throws(() => validateState(cards, state), /WIP exceeds one card/);
  delete state.records['GATE-11'];
  state.records['GATE-07'].waitingOn = ['missing live prerequisite'];
  assert.throws(() => validateState(cards, state), /return to To Do/);
});

test('construction does not satisfy completion dependencies or evidence', () => {
  const state = empty();
  state.records['WEB-01'] = active();
  validateState(cards, state);
  state.phaseAwareConstructionApproved = false;
  assert.throws(() => validateState(cards, state), /No executable/);
  state.records['WEB-01'].status = 'Done';
  assert.throws(() => validateState(cards, state), /Unmet completion dependencies/);
});

test('does not mark a card Done on a draft, a vote, or missing acceptance', () => {
  const state = empty();
  state.records['GATE-03'] = { ...active(), status: 'Done' };
  assert.throws(() => validateState(cards, state), /Two other-role reviews/);
  state.records['GATE-03'].reviews = [
    { role: 'R1', result: 'accepted', reviewKind: 'code', reviewedOwnerRole: 'R8', artifact: 'evidence/reviews/r1.json', sha256: '0'.repeat(64), scopeSha256: '0'.repeat(64) },
    { role: 'R2', result: 'accepted', reviewKind: 'code', reviewedOwnerRole: 'R8', artifact: 'evidence/reviews/r2.json', sha256: '0'.repeat(64), scopeSha256: '0'.repeat(64) }
  ];
  assert.throws(() => validateState(cards, state), /Every acceptance clause/);
});

test('code completion cannot count earlier design-only or generic review markers', () => {
  const state = empty();
  state.records['GATE-03'] = {
    ...active(), status: 'Done',
    reviews: [
      { role: 'R1', result: 'accepted', reviewKind: 'design', reviewedOwnerRole: 'R8', artifact: 'DECISIONS.md', sha256: '0'.repeat(64), scopeSha256: '0'.repeat(64) },
      { role: 'R2', result: 'accepted', reviewKind: 'design', reviewedOwnerRole: 'R8', artifact: 'DECISIONS.md', sha256: '0'.repeat(64), scopeSha256: '0'.repeat(64) }
    ]
  };
  assert.throws(() => validateState(cards, state), /Two other-role reviews/);
});

test('review envelopes bind verdict, explicit completion sources, and source-scope hashes', () => {
  const card = cards.find((item) => item.id === 'GATE-03');
  const sources = [{ path: 'tools/privacy.mjs', sha256: '1'.repeat(64) }];
  const scopeSha256 = reviewScopeDigest(sources);
  const review = { role: 'R2', scopeSha256 };
  const report = {
    schema: 'contoso.code-review.v1', reviewKind: 'code', reviewerRole: 'R2',
    sourceAcceptanceIsCertification: false, notReviewed: [],
    roles: [{ role: 'R8', result: 'accepted', scopeSha256, sources }]
  };
  assert.deepEqual(validateReviewReport(report, review, card, ['tools/privacy.mjs']), sources);
  assert.throws(() => validateReviewReport({ ...report, reviewKind: 'design' }, review, card, ['tools/privacy.mjs']), /review envelope/);
  assert.throws(() => validateReviewReport({ result: 'accepted' }, review, card, ['tools/privacy.mjs']), /review envelope/);
  assert.throws(() => validateReviewReport(report, review, card, ['missing-source.mjs']), /omits completion source/);
  const stale = structuredClone(report);
  stale.roles[0].sources[0].sha256 = '2'.repeat(64);
  assert.throws(() => validateReviewReport(stale, review, card, ['tools/privacy.mjs']), /scope hash mismatch/);
});

test('source digest detects code changes but does not self-invalidate on operational board transitions', () => {
  assert.notEqual(reviewSourceDigest('tools/privacy.mjs', Buffer.from('before')), reviewSourceDigest('tools/privacy.mjs', Buffer.from('after')));
  const first = empty();
  const second = structuredClone(first);
  second.records['GATE-03'] = active();
  second.revision = 2;
  assert.equal(reviewSourceDigest('config/board-state.json', Buffer.from(JSON.stringify(first))), reviewSourceDigest('config/board-state.json', Buffer.from(JSON.stringify(second))));
  second.phaseAwareConstructionApproved = false;
  assert.notEqual(reviewSourceDigest('config/board-state.json', Buffer.from(JSON.stringify(first))), reviewSourceDigest('config/board-state.json', Buffer.from(JSON.stringify(second))));
});

test('partial passing checkboxes require scope policy and current evidence too', () => {
  const state = empty();
  state.records['GATE-04'] = {
    ...active(), status: 'To Do',
    criteria: [{ index: 1, result: 'PASS', scope: 'unit', artifact: 'evidence/privacy.json', sha256: '0'.repeat(64) }]
  };
  assert.throws(() => validateState(cards, state), /Missing approved clause scope/);
  const policy = { 'GATE-04': { clauseCount: cards.find((card) => card.id === 'GATE-04').clauses.length, liveClauses: [1] } };
  assert.throws(() => validateState(cards, state, policy), /Live evidence required/);
  state.records['GATE-04'].criteria[0].sha256 = '';
  assert.throws(() => validateState(cards, state, policy), /Missing current passing evidence/);
});

test('rehydrates all card IDs once with accurate columns and unchanged Avoid doing', () => {
  const state = empty();
  state.records['GATE-03'] = active();
  const output = renderKanban(cards, state, board);
  assert.equal([...output.matchAll(/^\- \[[ x]\] \*\*#\d+ [A-Z]+-[A-Z0-9]+/gm)].length, 78);
  assert.match(output, /## To Do \(77\)/);
  assert.match(output, /## In Progress \(1 of 9\)/);
  assert.match(output, /## Done \(0\)/);
  assert.match(output, /\| AV-25 \|/);
  assert.equal(updateAcceptance(backlog, cards, empty()), backlog.replaceAll('- [x] ', '- [ ] '));
});
