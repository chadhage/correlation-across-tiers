import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { backlogSemanticHash, childRecordFor, expandNeeds, extractSwarmPlan, implementationOwner, parseBacklog, projectRoot, renderKanban, reviewScopeDigest, reviewSourceDigest, runConstructionReview, updateAcceptance, validateConstructionChildren, validateConstructionRun, validateConstructionTap, validateReviewReport, validateState, verifyConstructionEvidence, verifyEvidence, verifyPersistedLiveEvidence } from '../tools/kanban.mjs';
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

test('swarm child qualification edges cover every child without an observer-adapter cycle', () => {
  const plan = extractSwarmPlan(backlog);
  const rows = [...plan.matchAll(/^\| ([A-Z]+-\d+\.\d+) \| (R[1-9]) \| ([^|\r\n]+) \| ([^|\r\n]+) \|$/gm)];
  const children = cards.flatMap(card => [...card.childTasks.matchAll(/^  - \[[ x]\] \*\*([A-Z]+-\d+\.\d+) - /gm)]
    .map(match => ({ id: match[1], owner: card.owner })));
  assert.equal(children.length, 52);
  assert.equal(rows.length, children.length);
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
  assert.deepEqual(needs.get('DOC-02.1'), ['DEM-00.2', 'GATE-11.2']);
  assert.deepEqual(needs.get('GATE-11.2'), ['GATE-05.1', 'DAT-01.2', 'GATE-13.1', 'IDN-01.2', 'INF-06.1']);
  assert.deepEqual(needs.get('DEM-05.2'), ['DEM-00.1', 'DEM-05.1']);
  for (const id of needs.keys()) {
    if (/^DEM-(0[2-9]|1[0-5])\.1$/.test(id) && id !== 'DEM-05.1') assert.ok(needs.get(id).includes('DEM-00.1'), id);
  }
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

test('preserves explicit atomic child tasks without adding cards or acceptance clauses', () => {
  const expected = [
    ['GATE-03', 4, 'GATE-03.1'], ['GATE-06', 4, 'GATE-06.1'], ['GATE-11', 4, 'GATE-11.1', 'GATE-11.2'],
    ['GATE-02', 5, 'GATE-02.1'], ['GATE-08', 5, 'GATE-08.1'], ['GATE-12', 4, 'GATE-12.1'],
    ['GATE-13', 4, 'GATE-13.1'], ['GATE-05', 5, 'GATE-05.1', 'GATE-05.2'], ['GOV-01', 4, 'GOV-01.1'],
    ['ARC-01', 3, 'ARC-01.1'], ['JVM-01', 4, 'JVM-01.1'], ['INF-06', 4, 'INF-06.1'],
    ['INF-05', 4, 'INF-05.1', 'INF-05.2'], ['DAT-01', 4, 'DAT-01.1', 'DAT-01.2', 'DAT-01.3'],
    ['DAT-02', 3, 'DAT-02.1'], ['WEB-01', 4, 'WEB-01.1'], ['IDN-01', 3, 'IDN-01.1', 'IDN-01.2', 'IDN-01.3', 'IDN-01.4'],
    ['DOC-01', 3, 'DOC-01.1'], ['MSG-02', 4, 'MSG-02.1'], ['OBS-02', 4, 'OBS-02.1', 'OBS-02.2'],
    ['DEM-00', 5, 'DEM-00.1', 'DEM-00.2'], ['DEM-03', 4, 'DEM-03.1'], ['DEM-04', 4, 'DEM-04.1'],
    ['DEM-06', 3, 'DEM-06.1'], ['DEM-12', 4, 'DEM-12.1'], ['DEM-13', 4, 'DEM-13.1'],
    ['DEM-01', 4, 'DEM-01.1', 'DEM-01.2'], ['DEM-11', 3, 'DEM-11.1'], ['DEM-07', 3, 'DEM-07.1'],
    ['DEM-08', 3, 'DEM-08.1'], ['DEM-14', 3, 'DEM-14.1'], ['DOC-02', 3, 'DOC-02.1', 'DOC-02.2'],
    ['DEM-02', 3, 'DEM-02.1'], ['MSG-06', 3, 'MSG-06.1'], ['DEM-09', 3, 'DEM-09.1'],
    ['DEM-15', 4, 'DEM-15.1'], ['DEM-05', 3, 'DEM-05.1', 'DEM-05.2'], ['DEM-10', 3, 'DEM-10.1'],
    ['CRT-03', 3, 'CRT-03.1']
  ].map(([parent, clauses, ...tasks]) => ({ parent, clauses, tasks }));
  assert.deepEqual(cards.filter(card => card.childTasks).map(card => card.id).sort(), expected.map(item => item.parent).sort());
  const output = renderKanban(cards, currentState, board);
  for (const item of expected) {
    const card = cards.find(candidate => candidate.id === item.parent);
    const owner = implementationOwner(currentState, card.owner);
    const executor = owner === card.owner ? owner : `${owner} acting ${card.owner}`;
    assert.equal(card.clauses.length, item.clauses);
    for (const id of item.tasks) {
      assert.match(card.childTasks, new RegExp(`  - \\[[ x]\\] \\*\\*${id.replace('.', '\\.')} - `), id);
      assert.match(id, new RegExp(`^${item.parent}\\.\\d+$`));
    }
    for (const field of ['Executor', 'Prerequisites', 'Deliverable', 'Acceptance']) {
      assert.equal([...card.childTasks.matchAll(new RegExp(`^    - ${field}:`, 'gm'))].length, item.tasks.length);
    }
    assert.equal(card.childTasks.split(`    - Executor: ${executor}.`).length - 1, item.tasks.length);
    const expectedChildren = card.childTasks.replace(/^(  - \[)[ x](\] \*\*([A-Z]+-\d+\.\d+) - )/gm,
      (_, prefix, suffix, id) => `${prefix}${childRecordFor(currentState, id).status === 'Done' ? 'x' : ' '}${suffix}`);
    assert.ok(output.includes(expectedChildren.split(/\r?\n/).map(line => line ? `  ${line}` : '').join('\n')));
  }
  assert.equal([...backlog.matchAll(/^  - \[[ x]\] \*\*[A-Z]+-\d+\.\d+ - /gm)].length, 52);
  assert.equal(expected.reduce((sum, item) => sum + item.tasks.length, 0), 52);
  assert.equal(currentState.swarmPlan.childTasks, 52);
  for (const card of cards.filter(candidate => /^DEM-(0[2-9]|1[0-5])$/.test(candidate.id))) {
    const adapter = card.id === 'DEM-05' ? 'DEM-05.2' : `${card.id}.1`;
    assert.ok(card.clauses.at(-1).text.includes(adapter), `${card.id} closing clause cites ${adapter}`);
    assert.ok(card.childTasks.includes(`**${adapter} - `), adapter);
  }
});

test('unproven-claim ledger cites only existing cards and children and accounts for every child', () => {
  const ledger = [...backlog.matchAll(/^\| (UC-\d{2}) \| [^|\r\n]+ \| ([^|\r\n]+) \| [^|\r\n]+ \|$/gm)];
  assert.equal(ledger.length, 21);
  const cardIds = new Set(cards.map(card => card.id));
  const childIds = new Set(cards.flatMap(card => [...card.childTasks.matchAll(/^  - \[[ x]\] \*\*([A-Z]+-\d+\.\d+) - /gm)]
    .map(match => match[1])));
  const cited = new Set();
  for (const [, id, accounted] of ledger) {
    const references = accounted.match(/\b[A-Z]{3,4}-(?:\d{2}|[AB])(?:\.\d+)?\b/g) ?? [];
    assert.ok(references.length > 0, `${id} names no card or child`);
    for (const reference of references) {
      assert.ok(cardIds.has(reference) || childIds.has(reference), `${id} cites unknown ${reference}`);
      cited.add(reference);
    }
  }
  for (const id of childIds) assert.ok(cited.has(id), `child missing from the ledger: ${id}`);
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
    assert.ok(output.includes(card.childTasks.replace(/^(  - \[)x(\])/gm, '$1 $2')
      .split(/\r?\n/).map(line => line ? `  ${line}` : '').join('\n')));
  }
  assert.doesNotMatch(output, /- Executor: R[35] acting R[16]\./);
});

test('child checklist ticks neither change acceptance scope nor grant parent completion', () => {
  const updated = backlog.replace('  - [ ] **DEM-00.1 - ', '  - [x] **DEM-00.1 - ');
  assert.notEqual(updated, backlog);
  assert.equal(backlogSemanticHash(updated), backlogSemanticHash(backlog));
  const parsed = parseBacklog(updated);
  assert.deepEqual(parsed.map(card => card.clauses.map(clause => clause.text)), cards.map(card => card.clauses.map(clause => clause.text)));
  assert.ok(updateAcceptance(updated, parsed, empty()).includes('  - [ ] **DEM-00.1 - '));
  const output = renderKanban(parsed, empty(), board);
  assert.match(output, /- \[ \] \*\*#46 DEM-00 /);
  assert.match(output, /    - \[ \] \*\*DEM-00\.1 /);
});

const childFixture = (id = 'GATE-11.1') => {
  const state = independent();
  state.currentImplementationRouting = structuredClone(currentState.currentImplementationRouting);
  const card = cards.find(item => item.children.some(child => child.id === id));
  const child = card.children.find(item => item.id === id);
  const reviewers = roles.filter(role => role !== card.owner).slice(0, 2);
  const record = {
    status: 'Done', scope: 'construction', waitingOn: [], nextAction: 'Construction exit independently checked; parent/native completion remains To Do.',
    certificationStatus: 'NOT CERTIFIED', sourceAcceptanceIsCertification: false,
    definitionSha256: child.definitionSha256, authorAgentId: state.currentImplementationRouting.roles[card.owner],
    completionSources: ['tests\\construction-fixture.mjs'],
    reviews: reviewers.map(role => ({ role, reviewerAgentId: state.currentImplementationRouting.roles[role],
      result: 'accepted', reviewKind: ['ARC-01', 'DOC-01', 'DOC-02', 'GOV-01', 'CRT-03'].includes(card.id) ? 'documentation' : 'code',
      reviewedOwnerRole: card.owner, artifact: `evidence\\reviews\\${role}.json`,
      sha256: '1'.repeat(64), scopeSha256: '2'.repeat(64) }))
  };
  state.childRecords = { [id]: record };
  return { state, card, child, record };
};

test('construction children retain exact definitions and qualification prerequisites across checkbox-only updates', () => {
  const child = cards.find(card => card.id === 'GATE-11').children[0];
  const updated = backlog.replace(`  - [${child.checked ? 'x' : ' '}] **${child.id} - `, `  - [${child.checked ? ' ' : 'x'}] **${child.id} - `);
  const parsed = parseBacklog(updated);
  assert.equal(parsed.find(card => card.id === 'GATE-11').children[0].definitionSha256, child.definitionSha256);
  assert.equal(backlogSemanticHash(updated), backlogSemanticHash(backlog));
  assert.equal(cards.flatMap(card => card.children).length, 52);
  assert.deepEqual(cards.find(card => card.id === 'GATE-11').children[1].needs,
    ['GATE-05.1', 'DAT-01.2', 'GATE-13.1', 'IDN-01.2', 'INF-06.1']);
  const changed = parseBacklog(backlog.replace('One `azure.yaml` at the project root', 'Two `azure.yaml` files at the project root'));
  assert.notEqual(changed.find(card => card.id === 'GATE-11').children[0].definitionSha256, child.definitionSha256);
});

test('independently completed construction child ticks without closing its parent or native clauses', () => {
  const { state, child } = childFixture();
  validateState(cards, state, scopeCards);
  const updated = updateAcceptance(backlog, cards, state);
  assert.ok(updated.includes('  - [x] **GATE-11.1 - '));
  assert.equal(backlogSemanticHash(updated), backlogSemanticHash(backlog));
  assert.equal(state.records['GATE-11']?.status ?? state.defaultStatus, 'To Do');
  const output = renderKanban(cards, state, board);
  assert.match(output, /construction-only \/ NOT CERTIFIED/);
  assert.match(output, /reviewers|executed review/);
  assert.match(output, /- \[ \] \*\*#4 GATE-11 /);
  assert.equal(childRecordFor(state, child.id).status, 'Done');
  assert.equal(childRecordFor(state, 'DEM-00.1').status, 'To Do');
});

test('child completion rejects missing prerequisites, generic metadata and native or hosted shortcuts', () => {
  const { state, record } = childFixture();
  delete record.definitionSha256;
  assert.throws(() => validateConstructionChildren(cards, state), /Exact construction-only/);
  record.definitionSha256 = cards.find(card => card.id === 'GATE-11').children[0].definitionSha256;
  record.certificationStatus = 'CERTIFIED';
  assert.throws(() => validateConstructionChildren(cards, state), /Exact construction-only/);
  for (const id of ['GATE-11.2', 'DOC-01.1']) {
    assert.throws(() => validateConstructionChildren(cards, childFixture(id).state), /Unmet child prerequisites/);
  }
  for (const id of ['DEM-00.1', 'GATE-03.1', 'GATE-05.2', 'GATE-12.1', 'DAT-01.1']) {
    assert.throws(() => validateConstructionChildren(cards, childFixture(id).state), /needs native\/hosted qualification/);
  }
  const unknown = independent();
  unknown.childRecords = { 'NEW-01.1': record };
  assert.throws(() => validateConstructionChildren(cards, unknown), /Unknown construction child/);
});

test('child reviews require two distinct current other-role agents, never author aliases or historical identities', () => {
  for (const mutation of [
    ({ record }) => record.reviews.splice(1),
    ({ record }) => { record.reviews[1] = { ...record.reviews[0] }; },
    ({ record }) => { record.reviews[0].reviewerAgentId = '00000000-0000-4000-8000-000000000000'; },
    ({ record, card }) => { record.reviews[0].role = card.owner; },
    ({ record }) => { record.authorAgentId = '00000000-0000-4000-8000-000000000000'; },
    ({ record }) => { record.reviews[0].scopeSha256 = ''; }
  ]) {
    const fixture = childFixture();
    mutation(fixture);
    assert.throws(() => validateConstructionChildren(cards, fixture.state), /current other-role|Stale child author/);
  }
  const fixture = childFixture();
  fixture.state.currentImplementationRouting.roles[fixture.record.reviews[0].role] = fixture.record.authorAgentId;
  fixture.record.reviews[0].reviewerAgentId = fixture.record.authorAgentId;
  assert.throws(() => validateConstructionChildren(cards, fixture.state), /Distinct current other-role/);
});

test('child implementation WIP is linked to exactly one executable parent packet, not extra parallel cards', () => {
  const { state, record } = childFixture();
  record.status = 'In Progress';
  record.constructionReady = true;
  assert.throws(() => validateConstructionChildren(cards, state), /executable parent packet/);
  state.records['GATE-11'] = { ...active(), activeChildId: 'GATE-11.1' };
  validateConstructionChildren(cards, state);
  record.waitingOn.push('Unavailable runtime');
  assert.throws(() => validateConstructionChildren(cards, state), /executable parent packet/);
});

test('printed PASS, skipped tests and absent negative assertions cannot substitute for executed child evidence', () => {
  const tests = { passed: 2, positiveTests: ['valid positive'], negativeTests: ['rejects invalid'] };
  const tap = 'TAP version 13\nok 1 - valid positive\nok 2 - rejects invalid\n1..2\n# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  validateConstructionTap(tap, tests);
  assert.throws(() => validateConstructionTap('PASS', tests), /execution log/);
  assert.throws(() => validateConstructionTap(tap.replace('# skipped 0', '# skipped 1'), tests), /execution log/);
  assert.throws(() => validateConstructionTap(tap.replace('ok 2 - rejects invalid', 'not ok 2 - rejects invalid'), tests), /execution log/);
  assert.throws(() => validateConstructionTap(tap, { ...tests, negativeTests: ['unexecuted rejection'] }), /were not executed/);
});

test('aggregate board evidence rejects a missing Done-child receipt even with no parent unit PASS', async () => {
  const { state, record } = childFixture();
  assert.deepEqual(state.records, {});
  record.reviews[0].artifact = `evidence\\reviews\\swarm-20261102\\orchestrator\\missing-${randomUUID()}.json`;
  validateState(cards, state, scopeCards);
  await assert.rejects(verifyEvidence(cards, state), /ENOENT/);
});

test('actual scoped child review receipts verify logs and current sources and invalidate after drift or tampering', async () => {
  const fixture = childFixture();
  const prefix = path.join('evidence', 'reviews', 'swarm-20261102', 'orchestrator', `checks-${randomUUID()}`);
  const source = path.join(prefix, 'checks.mjs');
  const content = "import test from 'node:test'; import assert from 'node:assert/strict';\ntest('valid positive', () => assert.equal(2 + 2, 4));\ntest('rejects invalid', () => assert.throws(() => assert.equal(2 + 2, 5)));\n";
  await mkdir(path.join(projectRoot, prefix), { recursive: true });
  await writeFile(path.join(projectRoot, source), content);
  try {
    const reviews = [];
    for (const role of fixture.record.reviews.map(review => review.role)) {
      reviews.push(await runConstructionReview({
        reviewerRole: role, reviewerAgentId: fixture.state.currentImplementationRouting.roles[role],
        authorRole: fixture.card.owner, childIds: [fixture.child.id], sourcePaths: [source], testFiles: [source],
        positiveTests: ['valid positive'], negativeTests: ['rejects invalid'], outputDirectory: path.join(prefix, role)
      }));
    }
    fixture.record.completionSources = [source];
    fixture.record.reviews = reviews;
    await verifyConstructionEvidence(cards, fixture.state);
    await verifyEvidence(cards, fixture.state);
    const report = JSON.parse(await readFile(path.join(projectRoot, reviews[0].artifact), 'utf8'));
    const malformed = structuredClone(report);
    malformed.beforeSources[0].sha256 = 'f'.repeat(64);
    assert.throws(() => validateConstructionRun(malformed, reviews[0], fixture.card, fixture.child, fixture.record, fixture.state), /Stable executed/);
    await writeFile(path.join(projectRoot, source), `${content}\n// changed input\n`);
    await assert.rejects(verifyConstructionEvidence(cards, fixture.state), /Child reviewed source changed/);
    await assert.rejects(verifyEvidence(cards, fixture.state), /Child reviewed source changed/);
    await writeFile(path.join(projectRoot, source), content);
    await writeFile(path.join(projectRoot, report.roles[0].tests.artifact), 'PASS\n');
    await assert.rejects(verifyConstructionEvidence(cards, fixture.state), /Evidence hash mismatch/);
    await assert.rejects(verifyEvidence(cards, fixture.state), /Evidence hash mismatch/);
  } finally {
    await rm(path.join(projectRoot, prefix), { recursive: true, force: true });
  }
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
