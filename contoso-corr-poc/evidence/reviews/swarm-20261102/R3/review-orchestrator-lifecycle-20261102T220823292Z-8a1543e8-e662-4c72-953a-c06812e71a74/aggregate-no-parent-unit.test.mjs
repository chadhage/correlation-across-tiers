import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  parseBacklog, recordFor, validateState, verifyConstructionEvidence
} from '../../../../../tools/kanban.mjs';

const root = new URL('../../../../../', import.meta.url);
const source = await readFile(new URL('tools/kanban.mjs', root), 'utf8');
assert.equal(createHash('sha256').update(source).digest('hex'),
  'd54ab48af3f1d4e7b50873e73141e86c1d27164d8d7de7898059301d6a760e8e');
const backlog = await readFile(new URL('../.docs/wiki/Contoso_E2E_Correlation_POC_Backlog.md', root), 'utf8');
const cards = parseBacklog(backlog);
const current = JSON.parse(await readFile(new URL('config/board-state.json', root), 'utf8'));

function fixture() {
  const state = structuredClone(current);
  state.records = {};
  const card = cards.find(item => item.id === 'GATE-11');
  const child = card.children.find(item => item.id === 'GATE-11.1');
  state.childRecords = {
    [child.id]: {
      status: 'Done', scope: 'construction', waitingOn: [], nextAction: 'NEGATIVE UNIT FIXTURE ONLY',
      certificationStatus: 'NOT CERTIFIED', sourceAcceptanceIsCertification: false,
      definitionSha256: child.definitionSha256,
      authorAgentId: state.currentImplementationRouting.roles.R1,
      completionSources: ['tools\\kanban.mjs'],
      reviews: ['R2', 'R3'].map(role => ({
        role, reviewerAgentId: state.currentImplementationRouting.roles[role],
        result: 'accepted', reviewKind: 'code', reviewedOwnerRole: 'R1',
        artifact: 'evidence\\reviews\\swarm-20261102\\R3\\review-orchestrator-lifecycle-20261102T220823292Z-8a1543e8-e662-4c72-953a-c06812e71a74\\missing-negative-fixture-review.json',
        sha256: '1'.repeat(64), scopeSha256: '2'.repeat(64)
      }))
    }
  };
  validateState(cards, state);
  return state;
}

test('positive control: direct child IO verification rejects the nonexistent review artifact', async () => {
  await assert.rejects(verifyConstructionEvidence(cards, fixture()), /ENOENT|Evidence/);
});

test('negative control: aggregate IO verification must reject a Done child even without parent unit PASS facets', async () => {
  const start = source.indexOf('async function verifyEvidence(');
  const end = source.indexOf('\nexport function updateAcceptance', start);
  assert.ok(start >= 0 && end > start);
  let calls = 0;
  // Expose only the frozen private function in memory; no production file or board is changed.
  const aggregate = new Function('recordFor', 'verifyConstructionEvidence',
    `${source.slice(start, end)}\nreturn verifyEvidence;`)(
    recordFor, (...args) => { calls++; return verifyConstructionEvidence(...args); });
  try {
    await assert.rejects(aggregate(cards, fixture()), /ENOENT|Evidence/);
  } finally {
    process.stdout.write(`# aggregate child IO verifier calls ${calls}; expected at least one\n`);
  }
});
