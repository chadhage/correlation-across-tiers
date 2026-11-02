import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
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
export const backlogSemanticHash = (text) => hash(text.replace(/^(- \[)[ x](\])/gm, '$1 $2'));
const requiredReviewKind = (card) => documentationCards.has(card.id) ? 'documentation' : 'code';
const approvedActingRoles = { R1: 'R3', R6: 'R5' };
// No live executor is enrolled during preparation; persisted JSON cannot enroll one.
const liveEvidenceExecutors = new Map();

export async function verifyPersistedLiveEvidence(receipt, facet) {
  const execute = liveEvidenceExecutors.get(facet?.provenance);
  if (!execute) throw new Error('No root-enrolled live acceptance executor: caller JSON/source hashes cannot grant native authority');
  await execute(receipt, facet);
}

export function implementationOwner(state, logicalRole) {
  validateImplementationAssignments(state);
  return state.implementationAssignments.owners[logicalRole] ?? logicalRole;
}

function validateImplementationAssignments(state) {
  const assignments = state.implementationAssignments;
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments) ||
      assignments.approval !== 'USER reassign_existing' || !assignments.owners ||
      typeof assignments.owners !== 'object' || Array.isArray(assignments.owners) ||
      Object.keys(assignments.owners).length !== Object.keys(approvedActingRoles).length ||
      Object.entries(assignments.owners).some(([role, owner]) => approvedActingRoles[role] !== owner)) {
    throw new Error('Explicit approved original-role reassignment required; no additional implementation owner');
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
    const clauses = [...body.matchAll(/^- \[([ x])\] (.+)$/gm)].map((match) => ({
      text: match[2],
      start: start + match.index,
      checked: match[1] === 'x'
    }));
    if (!clauses.length) throw new Error(`No acceptance clauses: ${id}`);
    return { rank: Number(rank), id, title, kano, owner, days: Number(days), cd3, needs: expandNeeds(needs), clauses };
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
  return cards;
}

export function recordFor(state, id) {
  return state.records[id] ?? {
    status: state.defaultStatus, scope: 'construction', phase: 'not-started',
    nextAction: 'Pull the next executable facet; completion still requires every dependency and acceptance clause.',
    waitingOn: [], criteria: [], reviews: []
  };
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

async function verifyEvidence(cards, state) {
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
  if (record.activeFacet) lines.push(`  - Executing clause ${record.activeFacet.index}, ${record.activeFacet.scope}: ${record.activeFacet.action}`);
  if (record.completionWaitingOn?.length) lines.push(`  - Completion remains unmet: ${record.completionWaitingOn.join('; ')}`);
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
  return lines.join('\n');
}

export function renderKanban(cards, state, existing) {
  validateImplementationAssignments(state);
  const avoid = existing.match(/## Avoid doing \(25\)[\s\S]*?(?=## To Do \()/)?.[0]?.trim();
  if (!avoid) throw new Error('Missing original 25-card Avoid doing section');
  const groups = Object.fromEntries([...statuses].map((status) => [status, cards.filter((card) => recordFor(state, card.id).status === status)]));
  const lines = [
    '# Contoso End-to-End Correlation POC: atomic kanban', '',
    `**Board state:** Rehydrated from the 78-card backlog and board-acceptance revision ${state.revision}. No certification is implied by construction progress.`,
    '**Columns:** Avoid doing \u00b7 To Do \u00b7 In Progress \u00b7 Done', '',
    '| Avoid doing | To Do | In Progress | Done |', '|---|---|---|---|',
    `| 25 anti-patterns | ${groups['To Do'].length} cards | ${groups['In Progress'].length} of 9 (WIP limit) | ${groups.Done.length} |`, '',
    '## Board rules', '',
    '1. Pull the highest-ranked executable facet. Reviewed interface construction may precede dependency Done; completion still requires every needs edge to be Done.',
    '2. One active card per actual implementation owner, maximum nine. Approved acting assignments retain logical backlog ownership; authors cannot review themselves through a logical-role alias.',
    '3. Independent draft, two other-role reviews with claim labels, evidence-based adjudication, then merge and validation.',
    '4. If work cannot progress, return it to To Do with waitingOn and the next action. There is no Blocked state.',
    '5. A council votes on next actions; the evidence hierarchy, never majority vote, adjudicates technical claims.',
    '6. Done requires all own acceptance clauses, completion dependencies, current evidence and two accepted other-role reviews. Fixtures never close live requirements.',
    '7. Bootstrap traffic is NOT CERTIFIED. Final certification requires every applicable facet of all thirteen gates on the frozen deployed environment.', '',
  ];
  if (state.implementationAssignments) lines.push(
    '**Approved implementation routing:** logical R1 → existing R3; logical R6 → existing R5. Original R1/R6 writers are stopped; original R4 is failed and parent/coordinator performs R4 recovery. The original nine-agent roster and logical backlog owners remain historical/unchanged. No new agent or review vote supplies acceptance.', '');
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
  const generated = renderKanban(cards, state, existing);
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
  console.log(JSON.stringify({ cards: cards.length, ...counts }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (!['--check', '--write', '--init-scopes', '--refresh-scopes'].includes(mode) || process.argv.length !== 3) throw new Error('Usage: node tools\\kanban.mjs --check|--write|--init-scopes|--refresh-scopes');
  await synchronize(mode);
}
