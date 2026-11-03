import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptanceFacets, clauseComplete, createAcceptanceScopes, FACETS, validateAcceptanceScopes } from './verification/acceptance.mjs';
import { focusedSourceSnapshot, validateFocusedReceipt } from './verification/run-focused.mjs';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wikiRoot = path.join(projectRoot, '..', '.docs', 'wiki');
const backlogPath = path.join(wikiRoot, 'Contoso_E2E_Correlation_POC_Backlog.md');
const kanbanPath = path.join(wikiRoot, 'Contoso_E2E_Correlation_POC_Kanban.md');
const statePath = path.join(projectRoot, 'config', 'board-state.json');
const scopesPath = path.join(projectRoot, 'config', 'acceptance-scopes.json');
const statuses = new Set(['To Do', 'In Progress', 'Done']);
const reviewRoles = new Set(Array.from({ length: 9 }, (_, index) => `R${index + 1}`));
const documentationCards = new Set(['ADR-01', 'ADR-02', 'ARC-01', 'GOV-01', 'CRT-01', 'CRT-03', 'DOC-01', 'DOC-02', 'DOC-03', 'DOC-04']);
const hash = (text) => createHash('sha256').update(text).digest('hex');
export const backlogSemanticHash = (text) => hash(text.replace(/^([ \t]*- \[)[ x](\])/gm, '$1 $2'));
const requiredReviewKind = (card) => documentationCards.has(card.id) ? 'documentation' : 'code';
const approvedActingRoles = { R1: 'R3', R6: 'R5' };
const approvedImplementationPolicies = new Map([
  ['USER reassign_existing', approvedActingRoles],
  ['USER independent_nine_roles', Object.fromEntries([...reviewRoles].map(role => [role, role]))]
]);
// No live executor is enrolled during preparation; persisted JSON cannot enroll one.
const liveEvidenceExecutors = new Map();
const constructionChildren = new Set([
  'ARC-01.1', 'GATE-11.1', 'GATE-11.2', 'DEM-01.2', 'DOC-01.1', 'DOC-02.2', 'WEB-01.1',
  'GATE-02.1', 'GATE-05.1', 'JVM-01.1', 'DEM-05.1', 'INF-06.1', 'INF-05.2',
  'DAT-01.2', 'DAT-01.3', 'DAT-02.1', 'OBS-02.2', 'IDN-01.2', 'IDN-01.3', 'IDN-01.4',
  'GATE-06.1', 'GATE-08.1', 'GATE-13.1', 'GOV-01.1', 'CRT-03.1'
]);

export async function verifyPersistedLiveEvidence(receipt, facet) {
  const execute = liveEvidenceExecutors.get(facet?.provenance);
  if (!execute) throw new Error('No root-enrolled live acceptance executor: caller JSON/source hashes cannot grant native authority');
  await execute(receipt, facet);
}

export function implementationOwner(state, logicalRole) {
  validateImplementationAssignments(state);
  if (!reviewRoles.has(logicalRole)) throw new Error(`Unknown implementation role: ${logicalRole}`);
  return state.implementationAssignments.owners[logicalRole] ?? logicalRole;
}

function validateImplementationAssignments(state) {
  const assignments = state.implementationAssignments;
  const approvedOwners = approvedImplementationPolicies.get(assignments?.approval);
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments) ||
      !Object.hasOwn(state, 'implementationAssignments') || !Object.hasOwn(assignments, 'approval') ||
      !approvedOwners || !Object.hasOwn(assignments, 'owners') || !assignments.owners ||
      typeof assignments.owners !== 'object' || Array.isArray(assignments.owners) ||
      Object.keys(assignments.owners).length !== Object.keys(approvedOwners).length ||
      Object.entries(assignments.owners).some(([role, owner]) => !Object.hasOwn(approvedOwners, role) || approvedOwners[role] !== owner)) {
    throw new Error('Explicit approved original-role reassignment or independent-nine-role assignments required; no additional implementation owner');
  }
}

export function reviewSourceDigest(relativePath, bytes) {
  if (relativePath.replaceAll('\\', '/') === 'config/board-state.json') {
    const state = JSON.parse(bytes.toString('utf8'));
    return hash(JSON.stringify({
      schema: state.schema,
      defaultStatus: state.defaultStatus,
      phaseAwareConstructionApproved: state.phaseAwareConstructionApproved,
      explicitActiveFacetsRequired: state.explicitActiveFacetsRequired ?? false,
      acceptancePolicy: state.acceptancePolicy ?? null,
      implementationAssignments: state.implementationAssignments ?? null
    }));
  }
  return hash(bytes);
}

export function reviewScopeDigest(sources) {
  return hash([...sources].map((source) => ({ ...source, path: source.path.replaceAll('\\', '/') }))
    .sort((a, b) => a.path.localeCompare(b.path, 'en'))
    .map((source) => `${source.path}\n${source.sha256}\n`).join(''));
}

export function validateReviewReport(report, review, card, completionSources) {
  if (report.schema !== 'contoso.code-review.v1' || report.reviewKind !== requiredReviewKind(card) ||
      report.reviewerRole !== review.role || report.sourceAcceptanceIsCertification !== false ||
      !Array.isArray(report.notReviewed) || !Array.isArray(report.roles)) {
    throw new Error(`Code/documentation review envelope required: ${card.id}`);
  }
  const owner = report.roles.find((role) => role.role === card.owner);
  if (!owner || owner.result !== 'accepted' || !Array.isArray(owner.sources) || !owner.sources.length ||
      owner.scopeSha256 !== review.scopeSha256 || !/^[0-9a-f]{64}$/.test(owner.scopeSha256)) {
    throw new Error(`Accepted reviewed-owner/source scope required: ${card.id}`);
  }
  const paths = new Set();
  for (const source of owner.sources) {
    if (!source.path || path.isAbsolute(source.path) || !/^[0-9a-f]{64}$/.test(source.sha256 ?? '')) throw new Error(`Invalid reviewed source: ${card.id}`);
    const normalized = source.path.replaceAll('\\', '/');
    if (paths.has(normalized)) throw new Error(`Duplicate reviewed source: ${card.id}`);
    paths.add(normalized);
    const expectedMode = normalized === 'config/board-state.json' ? 'board-policy' : 'raw';
    if ((source.hashMode ?? 'raw') !== expectedMode) throw new Error(`Incorrect review hash mode: ${normalized}`);
  }
  if (reviewScopeDigest(owner.sources) !== owner.scopeSha256) throw new Error(`Review scope hash mismatch: ${card.id}`);
  for (const source of completionSources) {
    if (!paths.has(source.replaceAll('\\', '/'))) throw new Error(`Review omits completion source ${source}: ${card.id}`);
  }
  return owner.sources;
}

export function expandNeeds(value) {
  if (value === 'none') return [];
  const result = [];
  for (const token of value.split(',').map((part) => part.trim())) {
    if (token === 'all 13 gates') {
      result.push(...Array.from({ length: 13 }, (_, index) => `GATE-${String(index + 1).padStart(2, '0')}`));
      continue;
    }
    const range = /^([A-Z]+)-(\d+) to \1-(\d+)$/.exec(token);
    if (range) {
      const first = Number(range[2]);
      const last = Number(range[3]);
      if (last < first) throw new Error(`Reversed dependency range: ${token}`);
      for (let index = first; index <= last; index++) result.push(`${range[1]}-${String(index).padStart(2, '0')}`);
    } else if (/^[A-Z]+-[A-Z0-9]+$/.test(token)) {
      result.push(token);
    } else {
      throw new Error(`Unrecognized dependency: ${token}`);
    }
  }
  if (new Set(result).size !== result.length) throw new Error(`Duplicate dependencies: ${value}`);
  return result;
}

export function parseBacklog(text) {
  const childEdges = new Map([...extractSwarmPlan(text).matchAll(/^\| ([A-Z]+-\d+\.\d+) \| (R[1-9]) \| ([^|\r\n]+) \| ([^|\r\n]+) \|$/gm)]
    .map(([, id, owner, needs, requiredResult]) => [id, {
      owner, needs: needs === 'none' ? [] : needs.split(',').map(value => value.trim()), requiredResult: requiredResult.trim()
    }]));
  const rows = text.split(/\r?\n/).filter((line) => /^\| \d+ \| [A-Z]+-[A-Z0-9]+ \|/.test(line));
  const sections = [...text.matchAll(/^### (\d+)\. ([A-Z]+-[A-Z0-9]+) [^\r\n]+$/gm)];
  const cards = rows.map((line) => {
    const fields = line.split('|').slice(1, -1).map((field) => field.trim());
    if (fields.length !== 13) throw new Error('Backlog rank row must have 13 fields');
    const [rank, id, title, kano, owner, , , , , days, cd3, needs] = fields;
    const sectionIndex = sections.findIndex((section) => section[2] === id);
    if (sectionIndex < 0) throw new Error(`Missing acceptance section: ${id}`);
    const start = sections[sectionIndex].index;
    const end = sections[sectionIndex + 1]?.index ?? text.length;
    const body = text.slice(start, end);
    const childTasks = body.match(/^#### Child tasks\r?\n[\s\S]*$/m)?.[0].trim() ?? '';
    const childMatches = [...body.matchAll(/^  - \[([ x])\] \*\*([A-Z]+-\d+\.\d+) - (.+)\*\*/gm)];
    const children = childMatches.map((match, index) => {
      const edge = childEdges.get(match[2]);
      if (!edge || edge.owner !== owner || !match[2].startsWith(`${id}.`)) throw new Error(`Missing/invalid child qualification edge: ${match[2]}`);
      const definition = body.slice(match.index, childMatches[index + 1]?.index ?? body.length).trimEnd();
      return { id: match[2], title: match[3], checked: match[1] === 'x', start: start + match.index,
        ...edge, constructionOnly: constructionChildren.has(match[2]),
        definitionSha256: hash(JSON.stringify({ definition: definition.replace(/^(  - \[)[ x](\])/, '$1 $2').replaceAll('\r\n', '\n'),
          needs: edge.needs, requiredResult: edge.requiredResult })) };
    });
    const clauses = [...body.matchAll(/^- \[([ x])\] (.+)$/gm)].map((match) => ({
      text: match[2],
      start: start + match.index,
      checked: match[1] === 'x'
    }));
    if (!clauses.length) throw new Error(`No acceptance clauses: ${id}`);
    return { rank: Number(rank), id, title, kano, owner, days: Number(days), cd3, needs: expandNeeds(needs), clauses, childTasks, children };
  });
  if (cards.length !== 78 || sections.length !== 78) throw new Error('Expected exactly 78 ranked cards and acceptance sections');
  const byId = new Map(cards.map((card) => [card.id, card]));
  if (byId.size !== 78) throw new Error('Duplicate backlog card IDs');
  cards.forEach((card, index) => {
    if (card.rank !== index + 1) throw new Error(`Noncontiguous rank: ${card.id}`);
    if (!reviewRoles.has(card.owner)) throw new Error(`Invalid owner: ${card.id}`);
    for (const dependency of card.needs) {
      if (!byId.has(dependency)) throw new Error(`Unknown dependency ${dependency} on ${card.id}`);
      if (byId.get(dependency).rank >= card.rank) throw new Error(`Dependency does not precede ${card.id}: ${dependency}`);
    }
  });
  const children = new Map(cards.flatMap(card => card.children.map(child => [child.id, child])));
  if (children.size !== childEdges.size) throw new Error('Child qualification graph does not match checklists');
  function visit(id, ancestors = new Set()) {
    if (!children.has(id) || ancestors.has(id)) throw new Error(`Unknown/cyclic child prerequisite: ${id}`);
    for (const dependency of children.get(id).needs) visit(dependency, new Set([...ancestors, id]));
  }
  for (const id of children.keys()) visit(id);
  return cards;
}

export function extractSwarmPlan(text) {
  const heading = /^## Swarm execution plan\r?$/m.exec(text);
  if (!heading) return '';
  const section = text.slice(heading.index);
  const next = /^## /m.exec(section.slice(heading[0].length));
  return section.slice(0, next ? heading[0].length + next.index : undefined).trim();
}

export function recordFor(state, id) {
  return state.records[id] ?? {
    status: state.defaultStatus, scope: 'construction', phase: 'not-started',
    nextAction: 'Pull the next executable facet; completion still requires every dependency and acceptance clause.',
    waitingOn: [], criteria: [], reviews: []
  };
}

export function childRecordFor(state, id) {
  return state.childRecords?.[id] ?? { status: 'To Do', scope: 'construction', waitingOn: [], reviews: [],
    nextAction: 'Complete the exact child exit and its prerequisites; obtain two current other-role executed reviews.' };
}

function currentAgentId(state, role) {
  const id = state.currentImplementationRouting?.roles?.[role];
  if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new Error(`Current worker identity required: ${role}`);
  return id;
}

export function validateConstructionChildren(cards, state) {
  const children = new Map(cards.flatMap(card => card.children.map(child => [child.id, { card, child }])));
  if (state.childRecords && (typeof state.childRecords !== 'object' || Array.isArray(state.childRecords))) throw new Error('Child records must be an object');
  for (const [id, record] of Object.entries(state.childRecords ?? {})) {
    const entry = children.get(id);
    if (!entry) throw new Error(`Unknown construction child: ${id}`);
    const { card, child } = entry;
    if (!statuses.has(record.status) || record.scope !== 'construction' || !Array.isArray(record.waitingOn) ||
        !Array.isArray(record.reviews) || !record.nextAction) throw new Error(`Invalid construction child lifecycle: ${id}`);
    if (record.status === 'In Progress' && (record.waitingOn.length || record.constructionReady !== true ||
        recordFor(state, card.id).status !== 'In Progress' || recordFor(state, card.id).activeChildId !== id)) {
      throw new Error(`Child WIP must belong to its executable parent packet: ${id}`);
    }
    if (record.status !== 'Done') continue;
    if (!child.constructionOnly) throw new Error(`Child needs native/hosted qualification, not construction-only evidence: ${id}`);
    if (record.certificationStatus !== 'NOT CERTIFIED' || record.sourceAcceptanceIsCertification !== false ||
        record.definitionSha256 !== child.definitionSha256 || record.waitingOn.length) throw new Error(`Exact construction-only child exit required: ${id}`);
    if (child.needs.some(dependency => childRecordFor(state, dependency).status !== 'Done')) throw new Error(`Unmet child prerequisites: ${id}`);
    if (record.authorAgentId !== currentAgentId(state, card.owner)) throw new Error(`Stale child author identity: ${id}`);
    if (!Array.isArray(record.completionSources) || !record.completionSources.length ||
        record.completionSources.some(source => typeof source !== 'string' || !source || path.isAbsolute(source))) throw new Error(`Explicit child completion sources required: ${id}`);
    const reviewers = new Set();
    const agents = new Set([record.authorAgentId]);
    for (const review of record.reviews) {
      if (review.result !== 'accepted') continue;
      if (!reviewRoles.has(review.role) || review.role === card.owner ||
          implementationOwner(state, review.role) === implementationOwner(state, card.owner) ||
          review.reviewerAgentId !== currentAgentId(state, review.role) || agents.has(review.reviewerAgentId) ||
          review.reviewKind !== requiredReviewKind(card) || review.reviewedOwnerRole !== card.owner ||
          !review.artifact || !/^[0-9a-f]{64}$/.test(review.sha256 ?? '') ||
          !/^[0-9a-f]{64}$/.test(review.scopeSha256 ?? '')) throw new Error(`Distinct current other-role child reviews required: ${id}`);
      reviewers.add(implementationOwner(state, review.role));
      agents.add(review.reviewerAgentId);
    }
    if (reviewers.size < 2) throw new Error(`Two current other-role executed child reviews required: ${id}`);
  }
}

export function validateState(cards, state, scopeCards = null) {
  if (state.schema !== 'contoso.board-acceptance.v1' || state.defaultStatus !== 'To Do') throw new Error('Unsupported board schema/default');
  if (!Number.isInteger(state.revision) || state.revision < 1) throw new Error('Invalid board revision');
  if (!state.records || typeof state.records !== 'object' || Array.isArray(state.records)) throw new Error('Board records must be an object');
  validateImplementationAssignments(state);
  const byId = new Map(cards.map((card) => [card.id, card]));
  for (const id of Object.keys(state.records)) if (!byId.has(id)) throw new Error(`Unknown state card: ${id}`);
  const activeRoles = new Set();
  let wip = 0;
  for (const card of cards) {
    const record = recordFor(state, card.id);
    const executor = implementationOwner(state, card.owner);
    if (!statuses.has(record.status)) throw new Error(`Unsupported state for ${card.id}: ${record.status}`);
    if (!Array.isArray(record.criteria) || !Array.isArray(record.reviews) || !Array.isArray(record.waitingOn)) throw new Error(`Invalid evidence collections: ${card.id}`);
    if (record.reviews.some(review => review.result === 'accepted' &&
        (review.role === card.owner || implementationOwner(state, review.role) === executor))) throw new Error(`Author/self-review cannot count: ${card.id}`);
    if (record.status === 'In Progress') {
      if (!record.nextAction || record.waitingOn.length) throw new Error(`Stalled work must return to To Do: ${card.id}`);
      if (activeRoles.has(executor)) throw new Error(`WIP exceeds one card for implementation owner ${executor}`);
      if (state.explicitActiveFacetsRequired === true) {
        const facet = record.activeFacet;
        if (!facet || !Number.isInteger(facet.index) || facet.index < 1 || facet.index > card.clauses.length ||
            !FACETS.has(facet.scope) || !facet.action || facet.readiness !== 'executable' ||
            scopeCards?.[card.id]?.clauses?.[facet.index - 1]?.requiredFacets.includes(facet.scope) !== true) throw new Error(`Explicit executable scoped facet required: ${card.id}`);
        const higher = cards.find(candidate => implementationOwner(state, candidate.owner) === executor && candidate.rank < card.rank &&
          state.executableCards?.includes(candidate.id) && recordFor(state, candidate.id).status !== 'Done');
        if (higher) throw new Error(`Pull higher-priority executable facet ${higher.id} before ${card.id}`);
      }
      activeRoles.add(executor);
      wip++;
      const completeDependencies = card.needs.every((id) => recordFor(state, id).status === 'Done');
      if (!completeDependencies && !(state.phaseAwareConstructionApproved && record.scope === 'construction' && record.constructionReady === true)) {
        throw new Error(`No executable construction/completion facet: ${card.id}`);
      }
    }
    if (record.status === 'Done') {
      if (card.needs.some((id) => recordFor(state, id).status !== 'Done')) throw new Error(`Unmet completion dependencies: ${card.id}`);
      const accepted = new Set(record.reviews.filter((review) =>
        review.result === 'accepted' && reviewRoles.has(review.role) && review.role !== card.owner &&
        implementationOwner(state, review.role) !== executor &&
        review.reviewKind === requiredReviewKind(card) && review.reviewedOwnerRole === card.owner &&
        review.artifact && /^[0-9a-f]{64}$/.test(review.sha256 ?? '') &&
        /^[0-9a-f]{64}$/.test(review.scopeSha256 ?? '')).map((review) => implementationOwner(state, review.role)));
      if (accepted.size < 2) throw new Error(`Two other-role reviews required: ${card.id}`);
      if (record.criteria.length !== card.clauses.length) throw new Error(`Every acceptance clause needs evidence: ${card.id}`);
      if (!Array.isArray(record.completionSources) || !record.completionSources.length ||
          record.completionSources.some((source) => typeof source !== 'string' || !source || path.isAbsolute(source))) {
        throw new Error(`Explicit completion source scope required: ${card.id}`);
      }
    }
    const indices = new Set();
    for (const criterion of record.criteria) {
      if (!Number.isInteger(criterion.index) || criterion.index < 1 || criterion.index > card.clauses.length || indices.has(criterion.index)) throw new Error(`Invalid clause index: ${card.id}`);
      indices.add(criterion.index);
      if (!['PASS', 'FAIL', 'NOT RUN', 'INVALIDATED'].includes(criterion.result) || !FACETS.has(criterion.scope)) throw new Error(`Invalid result/scope: ${card.id}`);
      if (record.status === 'Done' && criterion.result !== 'PASS') throw new Error(`Incomplete acceptance: ${card.id}`);
      const policy = scopeCards?.[card.id];
      const facets = acceptanceFacets(criterion);
      if (!Array.isArray(facets) || !facets.length || new Set(facets.map(facet => facet.scope)).size !== facets.length) throw new Error(`Duplicate/invalid acceptance facet: ${card.id}`);
      for (const facet of facets) {
        if (!FACETS.has(facet.scope) || !['PASS', 'FAIL', 'NOT RUN', 'INVALIDATED'].includes(facet.result)) throw new Error(`Invalid result/scope: ${card.id}`);
        if (facet.result !== 'PASS') continue;
        if (!facet.artifact || !/^[0-9a-f]{64}$/.test(facet.sha256 ?? '')) throw new Error(`Missing current passing evidence: ${card.id}`);
        if (!policy || policy.clauseCount !== card.clauses.length || !Array.isArray(policy.liveClauses)) throw new Error(`Missing approved clause scope mapping: ${card.id}`);
        if (facet.scope === 'live' && !(policy.clauses?.[criterion.index - 1]?.liveEvidenceKinds ?? ['azure-monitor-logs']).includes(facet.provenance)) throw new Error(`Native live evidence provenance required: ${card.id}`);
        if (facet.scope === 'signoff' && (!facet.accountableOwner || !facet.signedAtUtc)) throw new Error(`Accountable owner signoff required: ${card.id}`);
      }
      if (criterion.result !== 'PASS') continue;
      if (policy.liveClauses.includes(criterion.index) && !facets.some(facet => facet.scope === 'live' && facet.result === 'PASS')) throw new Error(`Live evidence required; fixtures cannot close ${card.id} clause ${criterion.index}`);
      if (policy.clauses && !clauseComplete(criterion, policy.clauses[criterion.index - 1])) throw new Error(`Every required acceptance facet must pass: ${card.id}/${criterion.index}`);
    }
  }
  if (wip > 9) throw new Error('Board WIP exceeds nine');
  validateConstructionChildren(cards, state);
}

async function verifyArtifact(artifact, expectedHash) {
  if (typeof artifact !== 'string' || !artifact || path.isAbsolute(artifact)) throw new Error('Evidence must use a relative project path');
  const resolved = await realpath(path.resolve(projectRoot, artifact));
  const relative = path.relative(await realpath(projectRoot), resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Evidence escapes the project');
  const bytes = await readFile(resolved);
  if (expectedHash && hash(bytes) !== expectedHash) throw new Error(`Evidence hash mismatch: ${artifact}`);
  return bytes;
}

async function verifyConstructionSource(source) {
  if (typeof source !== 'string' || !source || path.isAbsolute(source)) throw new Error('Construction source must use a relative repository path');
  const root = await realpath(path.dirname(projectRoot));
  const resolved = await realpath(path.resolve(projectRoot, source));
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Construction source escapes the repository');
  return readFile(resolved);
}

export function validateConstructionRun(report, review, card, child, record, state) {
  const sources = validateReviewReport(report, review, card, record.completionSources);
  const owner = report.roles.find(role => role.role === card.owner);
  const exit = owner.children?.find(item => item.id === child.id);
  const tests = owner.tests;
  if (report.reviewerAgentId !== currentAgentId(state, review.role) || report.reviewerAgentId !== review.reviewerAgentId ||
      owner.authorAgentId !== record.authorAgentId || exit?.result !== 'accepted' ||
      exit.definitionSha256 !== child.definitionSha256 || report.certificationStatus !== 'NOT CERTIFIED' ||
      report.sourcesVerifiedBeforeAfter !== true || !tests || tests.runner !== 'node-tap' || !tests.command ||
      !tests.startedAtUtc || !tests.finishedAtUtc || !Number.isFinite(Date.parse(tests.startedAtUtc)) ||
      !Number.isFinite(Date.parse(tests.finishedAtUtc)) || Date.parse(tests.finishedAtUtc) < Date.parse(tests.startedAtUtc) ||
      tests.exitCode !== 0 || !Number.isInteger(tests.passed) || tests.passed < 2 ||
      tests.failed !== 0 || tests.skipped !== 0 || tests.cancelled !== 0 ||
      !tests.artifact || !/^[0-9a-f]{64}$/.test(tests.sha256 ?? '') ||
      !Array.isArray(tests.positiveTests) || !tests.positiveTests.length ||
      !Array.isArray(tests.negativeTests) || !tests.negativeTests.length ||
      new Set([...tests.positiveTests, ...tests.negativeTests]).size !== tests.positiveTests.length + tests.negativeTests.length) {
    throw new Error(`Executed positive/negative current-source child review required: ${child.id}`);
  }
  if (!Array.isArray(report.beforeSources) || !Array.isArray(report.afterSources) ||
      reviewScopeDigest(report.beforeSources) !== owner.scopeSha256 || reviewScopeDigest(report.afterSources) !== owner.scopeSha256 ||
      report.beforeSources.length !== sources.length || report.afterSources.length !== sources.length ||
      !Array.isArray(tests.testFiles) || !tests.testFiles.length ||
      tests.testFiles.some(file => !sources.some(source => source.path.replaceAll('\\', '/') === file.replaceAll('\\', '/')))) {
    throw new Error(`Stable executed child source/test closure required: ${child.id}`);
  }
  return { sources, tests };
}

export function validateConstructionTap(text, tests) {
  const count = name => Number(new RegExp(`^# ${name} (\\d+)\\s*$`, 'm').exec(text)?.[1] ?? -1);
  if (count('pass') !== tests.passed || count('tests') !== tests.passed || count('fail') !== 0 ||
      count('skipped') !== 0 || count('cancelled') !== 0 || /^(?:not ok\b|.*# (?:SKIP|TODO)\b)/m.test(text)) {
    throw new Error('Child review execution log is incomplete, failed or skipped');
  }
  const passed = [...text.matchAll(/^\s*ok \d+ - (.+)$/gm)].map(match => match[1]);
  if ([...tests.positiveTests, ...tests.negativeTests].some(name => typeof name !== 'string' || !passed.includes(name))) {
    throw new Error('Child review positive/negative assertions were not executed');
  }
}

export async function verifyConstructionEvidence(cards, state) {
  validateConstructionChildren(cards, state);
  for (const card of cards) {
    for (const child of card.children) {
      const record = childRecordFor(state, child.id);
      if (record.status !== 'Done') continue;
      for (const review of record.reviews.filter(item => item.result === 'accepted')) {
        const report = JSON.parse((await verifyArtifact(review.artifact, review.sha256)).toString('utf8'));
        const { sources, tests } = validateConstructionRun(report, review, card, child, record, state);
        validateConstructionTap((await verifyArtifact(tests.artifact, tests.sha256)).toString('utf8'), tests);
        for (const source of sources) {
          if (reviewSourceDigest(source.path, await verifyConstructionSource(source.path)) !== source.sha256) throw new Error(`Child reviewed source changed: ${source.path}`);
        }
      }
    }
  }
}

export async function runConstructionReview(request) {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const cards = parseBacklog(await readFile(backlogPath, 'utf8'));
  const card = cards.find(item => item.owner === request.authorRole && item.children.some(child => request.childIds?.includes(child.id)));
  if (!card || !Array.isArray(request.childIds) || !request.childIds.length ||
      request.childIds.some(id => !card.children.some(child => child.id === id)) ||
      request.reviewerRole === card.owner || !reviewRoles.has(request.reviewerRole) ||
      request.reviewerAgentId !== currentAgentId(state, request.reviewerRole) ||
      !Array.isArray(request.sourcePaths) || !request.sourcePaths.length ||
      new Set(request.sourcePaths.map(file => file.replaceAll('\\', '/'))).size !== request.sourcePaths.length ||
      !Array.isArray(request.testFiles) || !request.testFiles.length ||
      request.testFiles.some(file => !request.sourcePaths.includes(file)) ||
      !request.outputDirectory?.startsWith('evidence\\reviews\\swarm-20261102\\')) throw new Error('Exact current independent child review request required');
  const output = path.resolve(projectRoot, request.outputDirectory);
  const relative = path.relative(projectRoot, output);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Child review output escapes evidence');
  const snapshot = () => Promise.all(request.sourcePaths.map(async file => ({
    path: file, sha256: reviewSourceDigest(file, await verifyConstructionSource(file)),
    hashMode: file.replaceAll('\\', '/') === 'config/board-state.json' ? 'board-policy' : 'raw'
  })));
  const before = await snapshot();
  const startedAtUtc = new Date().toISOString();
  const args = ['--test', '--test-reporter=tap', '--test-concurrency=1', ...request.testFiles];
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, args, { cwd: projectRoot, env, encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
  const after = await snapshot();
  const finishedAtUtc = new Date().toISOString();
  const stdout = run.stdout ?? '';
  const passed = Number(/^# pass (\d+)\s*$/m.exec(stdout)?.[1] ?? -1);
  const stable = reviewScopeDigest(before) === reviewScopeDigest(after);
  const artifact = path.join(request.outputDirectory, 'tests.tap');
  const tests = { runner: 'node-tap', command: `node ${args.join(' ')}`, testFiles: request.testFiles,
    startedAtUtc, finishedAtUtc, exitCode: run.status, passed,
    failed: Number(/^# fail (\d+)\s*$/m.exec(stdout)?.[1] ?? -1),
    skipped: Number(/^# skipped (\d+)\s*$/m.exec(stdout)?.[1] ?? -1),
    cancelled: Number(/^# cancelled (\d+)\s*$/m.exec(stdout)?.[1] ?? -1),
    artifact, sha256: hash(stdout), positiveTests: request.positiveTests, negativeTests: request.negativeTests };
  let result = run.status === 0 && !run.error && !run.signal && stable ? 'accepted' : 'rejected';
  try { validateConstructionTap(stdout, tests); } catch { result = 'rejected'; }
  const report = { schema: 'contoso.code-review.v1', reviewKind: requiredReviewKind(card),
    reviewerRole: request.reviewerRole, reviewerAgentId: request.reviewerAgentId,
    sourceAcceptanceIsCertification: false, certificationStatus: 'NOT CERTIFIED',
    notReviewed: ['Native/Azure/hosted execution, parent completion and accountable signoff'],
    beforeSources: before, afterSources: after, sourcesVerifiedBeforeAfter: stable,
    roles: [{ role: card.owner, authorAgentId: currentAgentId(state, card.owner), result,
      scopeSha256: reviewScopeDigest(after), sources: after, tests,
      children: request.childIds.map(id => ({ id, definitionSha256: card.children.find(child => child.id === id).definitionSha256, result })) }] };
  await mkdir(output, { recursive: true });
  const actualOutput = path.relative(await realpath(projectRoot), await realpath(output));
  if (actualOutput === '..' || actualOutput.startsWith(`..${path.sep}`) || path.isAbsolute(actualOutput)) throw new Error('Child review output symlink escapes evidence');
  await writeFile(path.join(output, 'tests.tap'), stdout, { flag: 'wx' });
  await writeFile(path.join(output, 'stderr.txt'), `${run.stderr ?? ''}${run.error ? `\n${run.error.message}` : ''}`, { flag: 'wx' });
  const reportPath = path.join(request.outputDirectory, 'review.json');
  const bytes = `${JSON.stringify(report, null, 2)}\n`;
  await writeFile(path.resolve(projectRoot, reportPath), bytes, { flag: 'wx' });
  const receipt = { role: request.reviewerRole, reviewerAgentId: request.reviewerAgentId, result,
    reviewKind: report.reviewKind, reviewedOwnerRole: card.owner, artifact: reportPath,
    sha256: hash(bytes), scopeSha256: reviewScopeDigest(after) };
  if (result !== 'accepted') throw new Error(`Child review failed; preserved ${reportPath}`);
  return receipt;
}

export async function verifyEvidence(cards, state) {
  let focusedSources;
  for (const card of cards) {
    const record = recordFor(state, card.id);
    for (const criterion of record.criteria) {
      for (const facet of acceptanceFacets(criterion).filter(item => item.result === 'PASS')) {
        const bytes = await verifyArtifact(facet.artifact, facet.sha256);
        if (facet.scope === 'unit') {
          const receipt = JSON.parse(bytes.toString('utf8'));
          if (receipt.schema === 'contoso.local-check.v1') {
            focusedSources ??= await focusedSourceSnapshot();
            validateFocusedReceipt(receipt, focusedSources);
          } else if (receipt.schema === 'contoso.code-review.v1') {
            const owner = receipt.roles?.find(item => item.role === card.owner);
            if (!reviewRoles.has(receipt.reviewerRole) || receipt.reviewerRole === card.owner ||
                implementationOwner(state, receipt.reviewerRole) === implementationOwner(state, card.owner) ||
                !Number.isInteger(owner?.tests?.passed) || owner.tests.passed < 1 ||
                owner.tests.failed !== 0 || owner.tests.skipped !== 0) throw new Error(`Actual scoped local tests required: ${card.id}`);
            const sources = validateReviewReport(receipt, { role: receipt.reviewerRole, scopeSha256: owner.scopeSha256 }, card, []);
            for (const source of sources) {
              if (reviewSourceDigest(source.path, await verifyArtifact(source.path)) !== source.sha256) {
                throw new Error(`Scoped local test source changed: ${source.path}`);
              }
            }
          } else throw new Error(`Unknown local test execution receipt: ${card.id}`);
        }
        if (facet.scope === 'live') {
          const receipt = JSON.parse(bytes.toString('utf8'));
          if (receipt.provenance !== facet.provenance || receipt.result !== 'PASS' ||
              receipt.fixture !== false || receipt.sourceAcceptanceIsCertification !== false ||
              !receipt.coverage?.complete || !receipt.sourceManifestSha256) throw new Error(`Incomplete/fixture live acceptance receipt: ${card.id}`);
          await verifyPersistedLiveEvidence(receipt, facet);
        }
      }
    }
    for (const review of record.reviews.filter((item) => item.result === 'accepted')) {
      if (record.status !== 'Done') {
        await verifyArtifact(review.artifact, review.sha256);
        continue;
      }
      const report = JSON.parse((await verifyArtifact(review.artifact, review.sha256)).toString('utf8'));
      const sources = validateReviewReport(report, review, card, record.completionSources);
      const current = [];
      for (const source of sources) {
        const bytes = await verifyArtifact(source.path);
        const actual = reviewSourceDigest(source.path, bytes);
        if (actual !== source.sha256) throw new Error(`Reviewed source changed: ${source.path}`);
        current.push({ ...source, sha256: actual });
      }
      if (reviewScopeDigest(current) !== review.scopeSha256) throw new Error(`Reviewed scope is stale: ${card.id}`);
    }
  }
  await verifyConstructionEvidence(cards, state);
}

export function updateAcceptance(text, cards, state) {
  const replacements = [];
  for (const card of cards) {
    const record = recordFor(state, card.id);
    for (let index = 0; index < card.clauses.length; index++) {
      const criterion = record.criteria.find((item) => item.index === index + 1);
      const checked = criterion?.result === 'PASS' && typeof criterion.artifact === 'string' && /^[0-9a-f]{64}$/.test(criterion.sha256 ?? '');
      replacements.push({ position: card.clauses[index].start + 3, value: checked ? 'x' : ' ' });
    }
    for (const child of card.children) replacements.push({ position: child.start + 5, value: childRecordFor(state, child.id).status === 'Done' ? 'x' : ' ' });
  }
  for (const replacement of replacements.sort((a, b) => b.position - a.position)) {
    text = text.slice(0, replacement.position) + replacement.value + text.slice(replacement.position + 1);
  }
  return text;
}

function renderCard(card, state) {
  const record = recordFor(state, card.id);
  const executor = implementationOwner(state, card.owner);
  const needs = card.needs.length ? card.needs.join(', ') : 'none';
  const lines = [
    `- [${record.status === 'Done' ? 'x' : ' '}] **#${card.rank} ${card.id} \u00b7 ${card.title}**`,
    `  ${card.kano} \u00b7 logical ${card.owner}${executor !== card.owner ? `; implementation ${executor} acting ${card.owner}` : ''} \u00b7 CD3 ${card.cd3} \u00b7 ${card.days} d \u00b7 needs ${needs}`,
    `  - Phase: ${record.phase}; scope: ${record.scope}.`,
    `  - Next action: ${record.nextAction}`
  ];
  if (record.waitingOn.length) lines.push(`  - Waiting on: ${record.waitingOn.join('; ')}`);
  if (record.status === 'In Progress' && record.activeFacet) lines.push(`  - Executing clause ${record.activeFacet.index}, ${record.activeFacet.scope}: ${record.activeFacet.action}`);
  if (record.completionWaitingOn?.length) lines.push(`  - Completion remains unmet: ${record.completionWaitingOn.join('; ')}`);
  for (const evidence of record.constructionEvidence ?? []) {
    lines.push(`  - Construction evidence: [${evidence.label}](../../contoso-corr-poc/${evidence.artifact.replaceAll('\\', '/')}) (${evidence.scope}).`);
  }
  for (let index = 0; index < card.clauses.length; index++) {
    const criterion = record.criteria.find((item) => item.index === index + 1);
    const checked = criterion?.result === 'PASS' && criterion.artifact && /^[0-9a-f]{64}$/.test(criterion.sha256 ?? '');
    lines.push(`  - [${checked ? 'x' : ' '}] ${card.clauses[index].text}`);
    if (criterion?.artifact) lines.push(`    Evidence: [clause ${index + 1}](../../contoso-corr-poc/${criterion.artifact.replaceAll('\\', '/')}) (${criterion.scope}, ${criterion.result}).`);
    if (criterion?.facets) {
      for (const facet of criterion.facets) {
        lines.push(`    - Facet ${facet.scope}: ${facet.result}${facet.artifact ? `; [evidence](../../contoso-corr-poc/${facet.artifact.replaceAll('\\', '/')})` : ''}.`);
      }
      if (!checked) lines.push('    Whole clause remains unmet; partial local facets are not live acceptance.');
    }
  }
  if (card.childTasks) {
    const childText = card.childTasks.replace(/^(  - \[)[ x](\] \*\*([A-Z]+-\d+\.\d+) - )/gm,
      (_, prefix, suffix, id) => `${prefix}${childRecordFor(state, id).status === 'Done' ? 'x' : ' '}${suffix}`);
    lines.push('', ...childText.split(/\r?\n/).map(line => line ? `  ${line}` : ''));
    for (const child of card.children) {
      const outcome = state.childRecords?.[child.id];
      if (!outcome) continue;
      lines.push(`    - ${child.id}: **${outcome.status} — construction-only / NOT CERTIFIED**. ${outcome.nextAction}`);
      if (outcome.waitingOn.length) lines.push(`      Waiting on: ${outcome.waitingOn.join('; ')}`);
      for (const review of outcome.reviews.filter(item => item.result === 'accepted')) {
        lines.push(`      Evidence: [${review.role} executed review](../../contoso-corr-poc/${review.artifact.replaceAll('\\', '/')}).`);
      }
    }
  }
  return lines.join('\n');
}

export function renderKanban(cards, state, existing, swarmPlan = extractSwarmPlan(existing)) {
  validateImplementationAssignments(state);
  const avoid = existing.match(/## Avoid doing \(25\)[\s\S]*?(?=## To Do \()/)?.[0]?.trim();
  if (!avoid) throw new Error('Missing original 25-card Avoid doing section');
  const groups = Object.fromEntries([...statuses].map((status) => [status, cards.filter((card) => recordFor(state, card.id).status === status)]));
  const children = cards.flatMap(card => card.children);
  const childCounts = Object.fromEntries([...statuses].map(status => [status, children.filter(child => childRecordFor(state, child.id).status === status).length]));
  const lines = [
    '# Contoso End-to-End Correlation POC: atomic kanban', '',
    `**Board state:** Rehydrated from the 78-card backlog and board-acceptance revision ${state.revision}. No certification is implied by construction progress.`,
    '**Columns:** Avoid doing \u00b7 To Do \u00b7 In Progress \u00b7 Done', '',
    '| Avoid doing | To Do | In Progress | Done |', '|---|---|---|---|',
    `| 25 anti-patterns | ${groups['To Do'].length} cards | ${groups['In Progress'].length} of 9 (WIP limit) | ${groups.Done.length} |`, '',
    `**Unranked construction children (${children.length}):** ${childCounts['To Do']} To Do · ${childCounts['In Progress']} In Progress · ${childCounts.Done} Done. Child Done is construction-only / NOT CERTIFIED; parents and native requirements are unchanged.`, '',
    '## Board rules', '',
    '1. Pull the highest-ranked executable facet. Reviewed interface construction may precede dependency Done; completion still requires every needs edge to be Done.',
    '2. One active card per actual implementation owner, maximum nine. Approved acting assignments retain logical backlog ownership; authors cannot review themselves through a logical-role alias.',
    '3. Independent draft, two other-role reviews with claim labels, evidence-based adjudication, then merge and validation.',
    '4. If work cannot progress, return it to To Do with waitingOn and the next action. There is no Blocked state.',
    '5. A council votes on next actions; the evidence hierarchy, never majority vote, adjudicates technical claims.',
    '6. Done requires all own acceptance clauses, completion dependencies, current evidence and two accepted other-role reviews. Fixtures never close live requirements.',
    '7. Bootstrap traffic is NOT CERTIFIED. Final certification requires every applicable facet of all thirteen gates on the frozen deployed environment.',
    '8. Unranked child checklists decompose parent acceptance; they do not add cards or waive WIP, parent evidence or separately approved native-run requirements.', '',
  ];
  if (state.implementationAssignments.approval === 'USER independent_nine_roles') lines.push(
    `**Approved implementation routing:** user-approved independent nine-role mode (\`USER independent_nine_roles\`): ${[...reviewRoles].map(role => `logical ${role} → ${implementationOwner(state, role)}`).join('; ')}. Nine distinct current implementation lanes; actual actor identities require independent roster reconciliation. Historical stopped/failed agent IDs are not revived. No roster label enrolls native evidence authority, authorizes deployment/spending/traffic or grants acceptance.`, '');
  else lines.push(
    '**Approved implementation routing:** logical R1 → existing R3; logical R6 → existing R5. Original R1/R6 writers are stopped; original R4 is failed and parent/coordinator performs R4 recovery. The original nine-agent roster and logical backlog owners remain historical/unchanged. No new agent or review vote supplies acceptance.', '');
  if (swarmPlan) lines.push(swarmPlan, '');
  lines.push(avoid, '');
  for (const status of statuses) {
    lines.push(`## ${status} (${groups[status].length}${status === 'In Progress' ? ' of 9' : ''})`, '');
    if (!groups[status].length) {
      lines.push(status === 'Done' ? 'No card has met every acceptance and review requirement yet.' : 'No cards in this column.', '');
      continue;
    }
    for (const role of reviewRoles) {
      const lane = groups[status].filter((card) => implementationOwner(state, card.owner) === role);
      if (!lane.length) continue;
      lines.push(`### ${role}: ${lane.length} cards`, '');
      for (const card of lane) lines.push(renderCard(card, state), '');
    }
  }
  lines.push('## Definition of Done', '',
    'Acceptance, current evidence, required other-role reviews, approved naming/safety invariants, and completion dependencies must all be satisfied. NOT RUN, stale, fixture-only, or unsupported evidence is never a pass.', '');
  return lines.join('\n');
}

export async function synchronize(mode) {
  const [backlog, existing, stateText] = await Promise.all([readFile(backlogPath, 'utf8'), readFile(kanbanPath, 'utf8'), readFile(statePath, 'utf8')]);
  const state = JSON.parse(stateText);
  const cards = parseBacklog(backlog);
  if (mode === '--init-scopes' || mode === '--refresh-scopes') {
    await writeFile(scopesPath, `${JSON.stringify(createAcceptanceScopes(cards, backlogSemanticHash(backlog)), null, 2)}\n`, { encoding: 'utf8', flag: mode === '--init-scopes' ? 'wx' : 'w' });
    return;
  }
  const policy = JSON.parse(await readFile(scopesPath, 'utf8'));
  const scopeCards = validateAcceptanceScopes(cards, policy, backlogSemanticHash(backlog));
  validateState(cards, state, scopeCards);
  await verifyEvidence(cards, state);
  const updatedBacklog = updateAcceptance(backlog, cards, state);
  const generated = renderKanban(cards, state, existing, extractSwarmPlan(backlog));
  if (mode === '--check') {
    if (updatedBacklog !== backlog || generated.replaceAll('\r\n', '\n') !== existing.replaceAll('\r\n', '\n')) throw new Error('Backlog/kanban are stale; run board:rehydrate');
    if (state.sourceHashes?.backlog !== hash(backlog) || state.sourceHashes?.kanban !== hash(existing)) throw new Error('Board source hashes changed; rehydrate before using state');
  } else {
    state.sourceHashes = { backlog: hash(updatedBacklog), kanban: hash(generated) };
    await writeFile(backlogPath, updatedBacklog, 'utf8');
    await writeFile(kanbanPath, generated, 'utf8');
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }
  const counts = Object.fromEntries([...statuses].map((status) => [status, cards.filter((card) => recordFor(state, card.id).status === status).length]));
  const children = cards.flatMap(card => card.children);
  const childCounts = Object.fromEntries([...statuses].map(status => [status, children.filter(child => childRecordFor(state, child.id).status === status).length]));
  console.log(JSON.stringify({ cards: cards.length, ...counts, children: { total: children.length, ...childCounts } }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === '--review-child' && process.argv.length === 4) {
    console.log(JSON.stringify(await runConstructionReview(JSON.parse((await verifyArtifact(process.argv[3])).toString('utf8')))));
  } else {
    if (!['--check', '--write', '--init-scopes', '--refresh-scopes'].includes(mode) || process.argv.length !== 3) throw new Error('Usage: node tools\\kanban.mjs --check|--write|--init-scopes|--refresh-scopes OR --review-child request.json');
    await synchronize(mode);
  }
}
