import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { backlogSemanticHash, expandNeeds, extractSwarmPlan, implementationOwner, parseBacklog, projectRoot, renderKanban, reviewScopeDigest, reviewSourceDigest, updateAcceptance, validateReviewReport, validateState, verifyPersistedLiveEvidence } from '../tools/kanban.mjs';
import { createAcceptanceScopes, validateAcceptanceScopes } from '../tools/verification/acceptance.mjs';

const wiki = path.join(projectRoot, '..', '.docs', 'wiki');
const backlog = await readFile(path.join(wiki, 'Contoso_E2E_Correlation_POC_Backlog.md'), 'utf8');
const board = await readFile(path.join(wiki, 'Contoso_E2E_Correlation_POC_Kanban.md'), 'utf8');
const cards = parseBacklog(backlog);
const currentState = JSON.parse(await readFile(path.join(projectRoot, 'config', 'board-state.json')));
const roles = Array.from({ length: 9 }, (_, index) => `R${index + 1}`);
const empty = () => ({ schema: 'contoso.board-acceptance.v1', revision: 1, defaultStatus: 'To Do', phaseAwareConstructionApproved: true,
  implementationAssignments: { approval: 'USER reassign_existing', owners: { R1: 'R3', R6: 'R5' } }, records: {} });
const independent = () => ({ ...empty(), implementationAssignments: {
  approval: 'USER independent_nine_roles', owners: Object.fromEntries(roles.map(role => [role, role]))
} });
const active = () => ({ status: 'In Progress', scope: 'construction', phase: 'draft', constructionReady: true, nextAction: 'Implement checker', waitingOn: [], criteria: [], reviews: [] });
const scopeCards = createAcceptanceScopes(cards, backlogSemanticHash(backlog)).cards;
const constructionFacet = (card) => {
  const clause = scopeCards[card.id].clauses.find(item => item.requiredFacets.some(scope => scope !== 'live' && scope !== 'signoff'));
  return { ...active(), activeFacet: { index: clause.index,
    scope: clause.requiredFacets.find(scope => scope !== 'live' && scope !== 'signoff'),
    action: 'Implement the named owned construction facet', readiness: 'executable' } };
};
const nineActive = () => {
  const state = independent();
  state.explicitActiveFacetsRequired = true;
  state.executableCards = roles.map(role => cards.find(card => card.owner === role).id);
  state.records = Object.fromEntries(state.executableCards.map(id => [id, constructionFacet(cards.find(card => card.id === id))]));
  return state;
};
function assertSwarmRosterState(state) {
  validateState(cards, state, scopeCards);
  const isIndependent = state.implementationAssignments.approval === 'USER independent_nine_roles';
  assert.equal(state.swarmPlan.status, isIndependent ? 'ACTIVE_CONSTRUCTION' : 'PLANNED_NOT_STARTED');
  assert.equal(state.swarmPlan.targetIndependentRoleOwners, 9);
  assert.equal(state.swarmPlan.currentDistinctImplementationLanes, isIndependent ? 9 : 7);
  assert.equal(state.swarmPlan.rosterPolicyTransitionRequiredBeforeNineWriterExecution, !isIndependent);
  assert.equal(state.swarmPlan.activeAssignmentsChanged, isIndependent);
  assert.equal(state.swarmPlan.nativeTrafficOrDeploymentAuthorized, false);
  assert.equal(state.swarmPlan.cardCompletionGranted, false);
  if (!isIndependent) {
    assert.deepEqual(state.implementationAssignments.owners, { R1: 'R3', R6: 'R5' });
    assert.ok(cards.every(card => (state.records[card.id]?.status ?? state.defaultStatus) === 'To Do'));
  }
}

test('imports exactly 78 original ranks, 13 gates and the 1:5 Kano mix', () => {
  assert.equal(cards.length, 78);
  assert.equal(cards.filter((card) => card.id.startsWith('GATE-')).length, 13);
  assert.equal(cards.filter((card) => card.kano === 'Dissatisfier').length, 13);
  assert.equal(cards.filter((card) => card.kano === 'Satisfier').length, 57);
  assert.equal(cards.filter((card) => card.kano === 'Delighter').length, 8);
  assert.equal(cards.reduce((sum, card) => sum + card.days, 0), 70);
});

test('extracts the complete canonical swarm plan without swallowing ranked work or board lanes', () => {
  const source = '# Backlog\n\n## Swarm execution plan\n\nPlan.\n\n### Flow\n\nConcurrent handoffs.\n\n## Force-ranked backlog\n\nOther work.';
  const expected = '## Swarm execution plan\n\nPlan.\n\n### Flow\n\nConcurrent handoffs.';
  assert.equal(extractSwarmPlan(source), expected);
  assert.equal(extractSwarmPlan(source.replaceAll('\n', '\r\n')).replaceAll('\r\n', '\n'), expected);
  assert.equal(extractSwarmPlan(expected), expected);
  assert.equal(extractSwarmPlan('# No plan\n\n## Other\n'), '');
});

test('swarm dispatch packages cover every parent exactly once under its logical owner', () => {
  const plan = extractSwarmPlan(backlog);
  const packages = [...plan.matchAll(/^\| (P\d{2}) \| (R[1-9]) \| ([^|\r\n]+) \| ([^|\r\n]+) \|$/gm)];
  assert.equal(packages.length, 17);
  assert.equal(new Set(packages.map(row => row[1])).size, packages.length);
  const assignments = packages.flatMap(row => row[3].split(',').map(id => ({ id: id.trim(), owner: row[2] })));
  assert.equal(assignments.length, cards.length);
  assert.equal(new Set(assignments.map(item => item.id)).size, cards.length);
  for (const card of cards) assert.equal(assignments.find(item => item.id === card.id)?.owner, card.owner, card.id);
  assert.equal(new Set(assignments.map(item => item.owner)).size, 9);
});

test('swarm child qualification edges cover all six children without an observer-adapter cycle', () => {
  const plan = extractSwarmPlan(backlog);
  const rows = [...plan.matchAll(/^\| ([A-Z]+-\d+\.\d+) \| (R[1-9]) \| ([^|\r\n]+) \| ([^|\r\n]+) \|$/gm)];
  const children = cards.flatMap(card => [...card.childTasks.matchAll(/^  - \[[ x]\] \*\*([A-Z]+-\d+\.\d+) - /gm)]
    .map(match => ({ id: match[1], owner: card.owner })));
  assert.equal(rows.length, 6);
  assert.equal(new Set(rows.map(row => row[1])).size, children.length);
  const needs = new Map(rows.map(row => [row[1], row[3] === 'none' ? [] : row[3].split(',').map(id => id.trim())]));
  for (const child of children) assert.equal(rows.find(row => row[1] === child.id)?.[2], child.owner, child.id);
  function visit(id, ancestors = new Set()) {
    assert.ok(needs.has(id), `Unknown child prerequisite: ${id}`);
    assert.ok(!ancestors.has(id), `Child dependency cycle: ${id}`);
    for (const dependency of needs.get(id)) visit(dependency, new Set([...ancestors, id]));
  }
  for (const id of needs.keys()) visit(id);
  assert.deepEqual(needs.get('OBS-02.1'), ['DAT-01.1', 'DEM-01.1']);
  assert.ok(!needs.get('OBS-02.1').includes('DEM-00.1'));
  assert.ok(needs.get('DEM-00.1').includes('OBS-02.1'));
  assert.deepEqual(needs.get('DEM-00.2'), ['DEM-00.1']);
});

test('nine-role target has independent review pairs and mode-aware construction lifecycle metadata', () => {
  const plan = extractSwarmPlan(backlog);
  const roles = [...plan.matchAll(/^\| (R[1-9]) \| [^|\r\n]+ \| [^|\r\n]+ \| (R[1-9]), (R[1-9]) \|$/gm)];
  assert.equal(roles.length, 9);
  assert.equal(new Set(roles.map(row => row[1])).size, 9);
  for (const [_, author, first, second] of roles) assert.equal(new Set([author, first, second]).size, 3);
  assertSwarmRosterState(currentState);
  const candidate = nineActive();
  candidate.swarmPlan = { ...currentState.swarmPlan, status: 'ACTIVE_CONSTRUCTION',
    currentDistinctImplementationLanes: 9, rosterPolicyTransitionRequiredBeforeNineWriterExecution: false,
    activeAssignmentsChanged: true };
  assertSwarmRosterState(candidate);
  candidate.swarmPlan.status = 'PLANNED_NOT_STARTED';
  assert.throws(() => assertSwarmRosterState(candidate), /ACTIVE_CONSTRUCTION/);
});

test('swarm evidence totals match the exact parent facets rather than broad package PASS labels', () => {
  const scopes = createAcceptanceScopes(cards, backlogSemanticHash(backlog));
  const clauses = Object.values(scopes.cards).flatMap(card => card.clauses);
  const facets = clauses.flatMap(clause => clause.requiredFacets);
  assert.equal(clauses.length, 281);
  assert.equal(facets.length, 491);
  assert.deepEqual(Object.fromEntries(['static', 'unit', 'documentation', 'live', 'signoff']
    .map(scope => [scope, facets.filter(facet => facet === scope).length])),
  { static: 63, unit: 157, documentation: 58, live: 202, signoff: 11 });
  const plan = extractSwarmPlan(backlog);
  assert.match(plan, /281 acceptance clauses and 491 required facet checks/);
  assert.match(plan, /### Concurrency and event-driven flow/);
  assert.match(plan, /reset-before-next-cycle order/);
  assert.match(plan, /Until the actual live executor enrollment\/verification exists, keep live clauses and cards To Do/);
});

test('Kanban reproduces the source swarm plan rather than retaining stale generated planning', () => {
  const plan = extractSwarmPlan(backlog);
  assert.ok(plan.length > 1000);
  assert.equal(extractSwarmPlan(board), plan);
  const stale = board.replace('## Swarm execution plan', '## Swarm execution plan\n\nStale generated planning.');
  assert.notEqual(extractSwarmPlan(stale), plan);
  assert.equal(extractSwarmPlan(renderKanban(cards, empty(), stale, plan)), plan);
  assert.equal(extractSwarmPlan(renderKanban(cards, empty(), board)), plan);
});

test('preserves six explicit child tasks without adding cards or acceptance clauses', () => {
  const expected = [
    { parent: 'DAT-01', clauses: 4, tasks: ['DAT-01.1'] },
    { parent: 'OBS-02', clauses: 4, tasks: ['OBS-02.1'] },
    { parent: 'DEM-00', clauses: 5, tasks: ['DEM-00.1', 'DEM-00.2'] },
    { parent: 'DEM-01', clauses: 4, tasks: ['DEM-01.1'] },
    { parent: 'DOC-02', clauses: 3, tasks: ['DOC-02.1'] }
  ];
  const output = renderKanban(cards, currentState, board);
  for (const item of expected) {
    const card = cards.find(candidate => candidate.id === item.parent);
    const owner = implementationOwner(currentState, card.owner);
    const executor = owner === card.owner ? owner : `${owner} acting ${card.owner}`;
    assert.equal(card.clauses.length, item.clauses);
    for (const id of item.tasks) assert.ok(card.childTasks.includes(`  - [ ] **${id} - `), id);
    for (const field of ['Executor', 'Prerequisites', 'Deliverable', 'Acceptance']) {
      assert.equal([...card.childTasks.matchAll(new RegExp(`^    - ${field}:`, 'gm'))].length, item.tasks.length);
    }
    assert.equal(card.childTasks.split(`    - Executor: ${executor}.`).length - 1, item.tasks.length);
    assert.ok(output.includes(card.childTasks.split(/\r?\n/).map(line => line ? `  ${line}` : '').join('\n')));
  }
  assert.equal([...backlog.matchAll(/^  - \[ \] \*\*[A-Z]+-\d+\.\d+ - /gm)].length, 6);
});

test('later independent activation can update child executors without changing parent acceptance', () => {
  const updated = backlog.replace(/^    - Executor: R5 acting R6\.$/gm, '    - Executor: R6.')
    .replace(/^    - Executor: R3 acting R1\.$/gm, '    - Executor: R1.');
  const parsed = parseBacklog(updated);
  const policy = createAcceptanceScopes(parsed, backlogSemanticHash(updated));
  assert.deepEqual(policy.cards, scopeCards);
  validateAcceptanceScopes(parsed, policy, backlogSemanticHash(updated));
  const output = renderKanban(parsed, independent(), board, extractSwarmPlan(updated));
  for (const card of parsed.filter(item => item.childTasks)) {
    const count = [...card.childTasks.matchAll(/^  - \[[ x]\] \*\*[A-Z]+-\d+\.\d+ - /gm)].length;
    assert.equal(card.childTasks.split(`    - Executor: ${card.owner}.`).length - 1, count);
    assert.ok(output.includes(card.childTasks.split(/\r?\n/).map(line => line ? `  ${line}` : '').join('\n')));
  }
  assert.doesNotMatch(output, /- Executor: R[35] acting R[16]\./);
});

test('child checklist ticks neither change acceptance scope nor grant parent completion', () => {
  const updated = backlog.replace('  - [ ] **DEM-00.1 - ', '  - [x] **DEM-00.1 - ');
  assert.notEqual(updated, backlog);
  assert.equal(backlogSemanticHash(updated), backlogSemanticHash(backlog));
  const parsed = parseBacklog(updated);
  assert.deepEqual(parsed.map(card => card.clauses.map(clause => clause.text)), cards.map(card => card.clauses.map(clause => clause.text)));
  assert.ok(updateAcceptance(updated, parsed, empty()).includes('  - [x] **DEM-00.1 - '));
  const output = renderKanban(parsed, empty(), board);
  assert.match(output, /- \[ \] \*\*#46 DEM-00 /);
  assert.match(output, /    - \[x\] \*\*DEM-00\.1 /);
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

test('approved acting roles retain logical ownership but share one implementation WIP limit', () => {
  const state = empty();
  state.implementationAssignments = { approval: 'USER reassign_existing', owners: { R1: 'R3', R6: 'R5' } };
  state.records['GATE-11'] = active();
  validateState(cards, state);
  assert.equal(implementationOwner(state, 'R1'), 'R3');
  state.records['GATE-01'] = active();
  assert.throws(() => validateState(cards, state), /implementation owner R3/);
  delete state.records['GATE-01'];
  state.records['DAT-01'] = active();
  state.records['GATE-09'] = active();
  assert.throws(() => validateState(cards, state), /implementation owner R5/);
});

test('explicit independent-nine-role assignments permit nine distinct active construction facets', () => {
  const state = nineActive();
  validateState(cards, state, scopeCards);
  assert.deepEqual(roles.map(role => implementationOwner(state, role)), roles);
  assert.equal(new Set(Object.keys(state.records).map(id => implementationOwner(state, cards.find(card => card.id === id).owner))).size, 9);
  assert.ok(Object.values(state.records).every(record => record.scope === 'construction' && record.activeFacet.readiness === 'executable'));
  assert.ok(Object.values(state.records).every(record => record.criteria.length === 0 && record.reviews.length === 0));
});

test('a second active construction card fails for each independent implementation owner', () => {
  for (const role of roles) {
    const state = nineActive();
    const second = cards.filter(card => card.owner === role)[1];
    state.records[second.id] = constructionFacet(second);
    assert.throws(() => validateState(cards, state, scopeCards), new RegExp(`WIP exceeds one card for implementation owner ${role}`));
  }
});

test('independent-role priority remains per owner rather than retaining obsolete acting-role aliases', () => {
  const state = independent();
  state.explicitActiveFacetsRequired = true;
  state.executableCards = ['GATE-11', 'GATE-01'];
  state.records['GATE-01'] = constructionFacet(cards.find(card => card.id === 'GATE-01'));
  validateState(cards, state, scopeCards);
  state.records = { 'GATE-11': constructionFacet(cards.find(card => card.id === 'GATE-11')) };
  state.executableCards = ['GATE-07', 'GATE-11'];
  assert.throws(() => validateState(cards, state, scopeCards), /Pull higher-priority executable facet GATE-07/);
});

test('independent-nine-role mode requires explicit exact identity assignments, never aliases or an unknown policy', () => {
  const approved = independent().implementationAssignments;
  const missing = structuredClone(approved);
  delete missing.owners.R1;
  for (const assignments of [
    undefined, null, [], {}, { approval: approved.approval }, { owners: approved.owners },
    { ...approved, approval: null }, { ...approved, approval: 'USER unknown_roster' },
    { ...approved, approval: 'USER reassign_existing' },
    { ...approved, owners: null }, { ...approved, owners: [] }, { ...approved, owners: {} }, missing,
    { ...approved, owners: { ...approved.owners, R1: 'R3' } },
    { ...approved, owners: { ...approved.owners, R6: 'R5' } },
    { ...approved, owners: { ...approved.owners, R1: null } },
    { ...approved, owners: { ...approved.owners, R1: 'R10' } },
    { ...approved, owners: { ...approved.owners, R10: 'R10' } },
    { ...approved, owners: { R1: 'R3', R6: 'R5' } }
  ]) {
    const state = { ...independent(), implementationAssignments: assignments };
    assert.throws(() => validateState(cards, state, scopeCards), /Explicit approved/);
    assert.throws(() => implementationOwner(state, 'R1'), /Explicit approved/);
    assert.throws(() => renderKanban(cards, state, board), /Explicit approved/);
  }
  for (const state of [empty(), independent()]) {
    for (const role of [undefined, null, '', 'R0', 'R10', 'parent-R4', 'R3 acting R1']) {
      assert.throws(() => implementationOwner(state, role), /Unknown implementation role/);
    }
  }
});

test('acting authors cannot count their own reviews through logical-role aliases', () => {
  for (const [id, author] of [['GATE-11', 'R3'], ['DAT-01', 'R5'], ['GATE-09', 'R6'], ['GATE-01', 'R1']]) {
    const state = empty();
    state.implementationAssignments = { approval: 'USER reassign_existing', owners: { R1: 'R3', R6: 'R5' } };
    state.records[id] = { ...active(), status: 'To Do', reviews: [{ role: author, result: 'accepted' }] };
    assert.throws(() => validateState(cards, state), /Author\/self-review/);
  }
});

test('two accepted logical-role aliases cannot count as two implementation reviewers', () => {
  const state = empty();
  state.implementationAssignments = { approval: 'USER reassign_existing', owners: { R1: 'R3', R6: 'R5' } };
  state.records['GATE-03'] = { ...active(), status: 'Done', reviews: ['R1', 'R3'].map(role => ({
    role, result: 'accepted', reviewKind: 'code', reviewedOwnerRole: 'R8',
    artifact: `evidence\\reviews\\${role}.json`, sha256: '1'.repeat(64), scopeSha256: '2'.repeat(64)
  })) };
  assert.throws(() => validateState(cards, state), /Two other-role reviews/);
});

test('independent-role authors still cannot review themselves or manufacture two reviewers', () => {
  for (const role of roles) {
    const state = independent();
    const card = cards.find(candidate => candidate.owner === role);
    state.records[card.id] = { ...active(), status: 'To Do', reviews: [{ role, result: 'accepted' }] };
    assert.throws(() => validateState(cards, state), /Author\/self-review/);
  }
  const state = independent();
  const review = role => ({ role, result: 'accepted', reviewKind: 'code', reviewedOwnerRole: 'R8',
    artifact: `evidence\\reviews\\${role}.json`, sha256: '1'.repeat(64), scopeSha256: '2'.repeat(64) });
  state.records['GATE-03'] = { ...active(), status: 'Done', reviews: [review('R1'), review('R1')] };
  assert.throws(() => validateState(cards, state), /Two other-role reviews/);
  state.records['GATE-03'].reviews = [review('R1'), review('R3')];
  assert.throws(() => validateState(cards, state), /Every acceptance clause/);
  state.records['GATE-03'].reviews = [review('R1'), review('R10')];
  assert.throws(() => validateState(cards, state), /Unknown implementation role/);
  state.records = { 'GATE-06': { ...active(), status: 'To Do',
    reviews: ['R1', 'R7'].map(role => ({ ...review(role), reviewedOwnerRole: 'R9' })) } };
  validateState(cards, state);
  state.records['GATE-06'].status = 'Done';
  assert.throws(() => validateState(cards, state), /Every acceptance clause/);
});

test('unapproved replacement roles reject and approved assignment changes invalidate board-policy review', () => {
  const state = empty();
  const historical = { ...state, implementationAssignments: null };
  const before = reviewSourceDigest('config\\board-state.json', Buffer.from(JSON.stringify(historical)));
  const after = reviewSourceDigest('config\\board-state.json', Buffer.from(JSON.stringify(state)));
  assert.notEqual(before, after);
  state.implementationAssignments.owners.R1 = 'R10';
  assert.throws(() => validateState(cards, state), /Explicit approved/);
  for (const assignments of [
    { owners: { R1: 'R3', R6: 'R5' } },
    { approval: 'USER reassign_existing', owners: {} },
    { approval: 'USER reassign_existing', owners: { R1: 'R3' } },
    { approval: 'USER reassign_existing', owners: { R1: 'R3', R6: 'R5', R4: 'R2' } }
  ]) {
    state.implementationAssignments = assignments;
    assert.throws(() => validateState(cards, state), /Explicit approved/);
  }
});

test('a roster-policy transition invalidates board-policy source and review-scope digests', () => {
  const legacy = empty();
  const next = independent();
  const before = reviewSourceDigest('config\\board-state.json', Buffer.from(JSON.stringify(legacy)));
  const after = reviewSourceDigest('config\\board-state.json', Buffer.from(JSON.stringify(next)));
  assert.notEqual(before, after);
  assert.notEqual(reviewScopeDigest([{ path: 'config\\board-state.json', sha256: before }]),
    reviewScopeDigest([{ path: 'config\\board-state.json', sha256: after }]));
  const operational = structuredClone(next);
  operational.records['GATE-06'] = active();
  operational.revision++;
  assert.equal(after, reviewSourceDigest('config\\board-state.json', Buffer.from(JSON.stringify(operational))));
  operational.implementationAssignments.approval = 'USER unknown_roster';
  assert.notEqual(after, reviewSourceDigest('config\\board-state.json', Buffer.from(JSON.stringify(operational))));
});

test('current synchronization/rendering cannot remove or null either approved assignment mode', () => {
  const scopeCards = createAcceptanceScopes(cards, backlogSemanticHash(backlog)).cards;
  for (const source of [empty(), independent(), currentState]) {
    for (const value of [undefined, null]) {
      const candidate = structuredClone(source);
      if (value === undefined) delete candidate.implementationAssignments;
      else candidate.implementationAssignments = value;
      assert.throws(() => validateState(cards, candidate, scopeCards), /Explicit approved/);
      assert.throws(() => implementationOwner(candidate, 'R1'), /Explicit approved/);
      assert.throws(() => renderKanban(cards, candidate, board), /Explicit approved/);
    }
  }
});

test('cross-role WIP and author protection cannot fall back to parked roles without the map', () => {
  const state = empty();
  state.records['GATE-09'] = active();
  state.records['DAT-01'] = active();
  state.records['GATE-11'] = { ...active(), reviews: [{ role: 'R3', result: 'accepted' }] };
  delete state.implementationAssignments;
  assert.throws(() => validateState(cards, state), /Explicit approved/);
});

test('highest executable facet is compared across logical roles sharing an implementation owner', () => {
  const scopeCards = createAcceptanceScopes(cards, backlogSemanticHash(backlog)).cards;
  for (const [id, higher, index, scope] of [
    ['GATE-01', 'GATE-11', 2, 'unit'],
    ['DAT-01', 'GATE-09', 3, 'unit']
  ]) {
    const state = empty();
    state.implementationAssignments = { approval: 'USER reassign_existing', owners: { R1: 'R3', R6: 'R5' } };
    state.explicitActiveFacetsRequired = true;
    state.executableCards = [higher, id];
    state.records[id] = { ...active(), activeFacet: { index, scope, action: 'Implement owned source facet', readiness: 'executable' } };
    assert.throws(() => validateState(cards, state, scopeCards), new RegExp(`Pull higher-priority executable facet ${higher}`));
    state.executableCards = [id];
    validateState(cards, state, scopeCards);
  }
});

test('rendered implementation lanes show acting owner instead of stopped original writer', () => {
  const state = empty();
  state.implementationAssignments = { approval: 'USER reassign_existing', owners: { R1: 'R3', R6: 'R5' } };
  state.records['GATE-11'] = active();
  const output = renderKanban(cards, state, board);
  assert.match(output, /### R3: 1 cards/);
  assert.match(output, /logical R1; implementation R3 acting R1/);
  assert.match(output, /\*\*Approved implementation routing:\*\* logical R1 → existing R3; logical R6 → existing R5/);
});

test('independent routing renders all nine current lanes without reviving historical agents', () => {
  const state = nineActive();
  const output = renderKanban(cards, state, board);
  const routing = output.split('\n').find(line => line.startsWith('**Approved implementation routing:**'));
  assert.match(routing, /user-approved independent nine-role mode \(`USER independent_nine_roles`\)/);
  for (const role of roles) assert.ok(routing.includes(`logical ${role} → ${role}`));
  assert.match(routing, /Historical stopped\/failed agent IDs are not revived/);
  assert.match(routing, /No roster label enrolls native evidence authority/);
  assert.doesNotMatch(routing, /→ existing R[35]|parent\/coordinator performs R4 recovery/);
  const inProgress = output.split('## In Progress (9 of 9)')[1].split('## Done (0)')[0];
  assert.equal([...inProgress.matchAll(/^### R[1-9]: 1 cards$/gm)].length, 9);
  assert.doesNotMatch(inProgress, /; implementation R[1-9] acting R[1-9]/);
  assert.equal([...output.matchAll(/^\- \[[ x]\] \*\*#\d+ [A-Z]+-[A-Z0-9]+/gm)].length, 78);
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

test('persisted live PASS labels, hashes, coverage and authentication flags cannot enroll authority', async () => {
  const receipt = { provenance: 'azure-monitor-logs', result: 'PASS', fixture: false,
    sourceAcceptanceIsCertification: false, coverage: { complete: true }, sourceManifestSha256: 'a'.repeat(64),
    authenticatedPeerVerified: true, observerId: 'caller-invented', nativeHttpStatus: 200 };
  for (const state of [empty(), independent()]) {
    validateState(cards, state, scopeCards);
    const rosterLabelled = { ...receipt, rosterPolicy: state.implementationAssignments.approval,
      implementationAssignments: state.implementationAssignments };
    await assert.rejects(verifyPersistedLiveEvidence(rosterLabelled, { provenance: receipt.provenance }), /No root-enrolled live acceptance executor/);
    await assert.rejects(verifyPersistedLiveEvidence({ ...rosterLabelled, provenance: 'azure-resource-manager-read' },
      { provenance: 'azure-resource-manager-read' }), /cannot grant native authority/);
    await assert.rejects(verifyPersistedLiveEvidence(rosterLabelled,
      { provenance: state.implementationAssignments.approval }), /cannot grant native authority/);
  }
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

test('exact scopes cover all clauses and invalidate on a semantic source change', () => {
  const policy = createAcceptanceScopes(cards, backlogSemanticHash(backlog));
  validateAcceptanceScopes(cards, policy, backlogSemanticHash(backlog));
  assert.equal(Object.keys(policy.cards).length, 78);
  assert.deepEqual(policy.cards['CRT-01'].liveClauses, []);
  assert.deepEqual(policy.cards['GATE-08'].clauses[0].requiredFacets, ['unit', 'live']);
  const changed = structuredClone(cards);
  changed[0].clauses[0].text += ' changed';
  assert.throws(() => validateAcceptanceScopes(changed, policy, backlogSemanticHash(backlog)), /Stale\/invalid exact/);
  assert.throws(() => validateAcceptanceScopes(cards, policy, '1'.repeat(64)), /unapproved, or stale/);
});

test('partial local facet is rendered separately and cannot tick a whole live clause', () => {
  const state = empty();
  state.records['GATE-08'] = { ...active(), criteria: [{
    index: 1, result: 'NOT RUN', scope: 'unit',
    facets: [{ scope: 'unit', result: 'PASS', artifact: 'evidence/local.json', sha256: '1'.repeat(64) }]
  }] };
  const policy = createAcceptanceScopes(cards, backlogSemanticHash(backlog));
  validateState(cards, state, policy.cards);
  assert.match(renderKanban(cards, state, board), /Whole clause remains unmet/);
  assert.equal(updateAcceptance(backlog, cards, state), backlog.replaceAll('- [x] ', '- [ ] '));
  state.records['GATE-08'].criteria[0].result = 'PASS';
  assert.throws(() => validateState(cards, state, policy.cards), /Live evidence required/);
});

test('arbitrary live PASS and reviewer votes are not native acceptance', () => {
  const policy = createAcceptanceScopes(cards, backlogSemanticHash(backlog));
  for (const state of [empty(), independent()]) {
    state.records['GATE-08'] = { ...active(), criteria: [{
      index: 1, result: 'PASS', scope: 'live',
      facets: [
        { scope: 'unit', result: 'PASS', artifact: 'evidence/unit.json', sha256: '1'.repeat(64) },
        { scope: 'live', result: 'PASS', artifact: 'evidence/live.json', sha256: '2'.repeat(64) }
      ]
    }] };
    assert.throws(() => validateState(cards, state, policy.cards), /Native live evidence provenance/);
  }
});

test('source-backlog hash does not authorize removal of a live facet or weaker evidence kinds', () => {
  const policy = createAcceptanceScopes(cards, backlogSemanticHash(backlog));
  const missingLive = structuredClone(policy);
  missingLive.cards['GATE-02'].clauses[0].requiredFacets =
    missingLive.cards['GATE-02'].clauses[0].requiredFacets.filter(value => value !== 'live');
  missingLive.cards['GATE-02'].liveClauses =
    missingLive.cards['GATE-02'].clauses.filter(clause => clause.requiredFacets.includes('live')).map(clause => clause.index);
  assert.throws(() => validateAcceptanceScopes(cards, missingLive, backlogSemanticHash(backlog)), /authoritative acceptance facets/);
  const weakerKind = structuredClone(policy);
  weakerKind.cards['GATE-08'].clauses[0].liveEvidenceKinds.push('azure-arm-state');
  assert.throws(() => validateAcceptanceScopes(cards, weakerKind, backlogSemanticHash(backlog)), /authoritative acceptance facets/);
});
