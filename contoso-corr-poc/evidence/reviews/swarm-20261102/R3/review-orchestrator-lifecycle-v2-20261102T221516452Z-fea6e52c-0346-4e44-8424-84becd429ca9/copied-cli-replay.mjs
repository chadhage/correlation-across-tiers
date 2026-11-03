import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { backlogSemanticHash, parseBacklog, reviewSourceDigest } from '../../../../../tools/kanban.mjs';

const packet = path.dirname(fileURLToPath(import.meta.url));
const project = fileURLToPath(new URL('../../../../../', import.meta.url));
const work = path.join(packet, 'copied-cli-work');
const repository = path.join(work, 'repository');
const copiedProject = path.join(repository, 'contoso-corr-poc');
const digest = value => createHash('sha256').update(value).digest('hex');
const declaredSources = [
  'tools\\kanban.mjs', 'tests\\kanban.test.mjs', 'tools\\verification\\acceptance.mjs',
  'tools\\verification\\run-focused.mjs', 'tools\\verification\\files.mjs',
  'tools\\observability\\telemetry-contract.mjs'
];
const snapshot = () => Promise.all(declaredSources.map(async file => ({
  path: file, sha256: digest(await readFile(path.join(project, file)))
})));
const before = await snapshot();
assert.equal(before[0].sha256, '21bef385253b8656f73d66fd161c78d089ceb8268dfe3d9aa68c870034a4346d');
assert.equal(before[1].sha256, 'a9a49ba2c2b60e996d70bcca6b3f7ef07bb8594e2fa13702350795f5ebb32d13');
const originalBacklogFile = path.resolve(project, '..', '.docs', 'wiki', 'Contoso_E2E_Correlation_POC_Backlog.md');
const originalBoardFile = path.join(project, 'config', 'board-state.json');
const backlog = await readFile(originalBacklogFile, 'utf8');
const boardBytes = await readFile(originalBoardFile);
const policyBefore = reviewSourceDigest('config\\board-state.json', boardBytes);
const semanticBefore = backlogSemanticHash(backlog);
const runs = [];
let created = false;
let failure;

async function save(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, value);
}
async function run(name, args, expectedExit, expectedError) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, args, {
    cwd: copiedProject, env, encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024
  });
  const stdout = result.stdout ?? '', stderr = result.stderr ?? '';
  await writeFile(path.join(packet, `${name}.stdout.txt`), stdout, { flag: 'wx' });
  await writeFile(path.join(packet, `${name}.stderr.txt`), stderr, { flag: 'wx' });
  runs.push({
    name, command: `node ${args.join(' ')}`, cwd: 'copied-cli-work\\repository\\contoso-corr-poc',
    exitCode: result.status, expectedExit, stdoutSha256: digest(stdout), stderrSha256: digest(stderr)
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, expectedExit, stderr || stdout);
  if (expectedError) assert.match(stderr, expectedError);
  return stdout;
}

try {
  await mkdir(work);
  created = true;
  for (const file of declaredSources.filter(file => file !== 'tests\\kanban.test.mjs')) {
    await save(path.join(copiedProject, file), await readFile(path.join(project, file)));
  }
  for (const name of ['Contoso_E2E_Correlation_POC_Backlog.md', 'Contoso_E2E_Correlation_POC_Kanban.md']) {
    await save(path.join(repository, '.docs', 'wiki', name),
      await readFile(path.resolve(project, '..', '.docs', 'wiki', name)));
  }
  await save(path.join(copiedProject, 'config', 'acceptance-scopes.json'),
    await readFile(path.join(project, 'config', 'acceptance-scopes.json')));
  const state = JSON.parse(boardBytes);
  state.records = {};
  state.childRecords = {};
  const stateFile = path.join(copiedProject, 'config', 'board-state.json');
  await save(stateFile, JSON.stringify(state, null, 2));
  const fixtureSource = 'tests\\admission-fixture.test.mjs';
  const fixtureBytes = Buffer.from(
    "import test from 'node:test'; import assert from 'node:assert/strict';\n" +
    "test('UNIT FIXTURE positive arithmetic', () => assert.equal(2 + 2, 4));\n" +
    "test('UNIT FIXTURE rejects wrong arithmetic', () => assert.throws(() => assert.equal(2 + 2, 5)));\n");
  await save(path.join(copiedProject, fixtureSource), fixtureBytes);
  const card = parseBacklog(backlog).find(item => item.id === 'GATE-11');
  const child = card.children.find(item => item.id === 'GATE-11.1');
  const reviews = [];
  for (const role of ['R2', 'R3']) {
    const request = {
      reviewerRole: role, reviewerAgentId: state.currentImplementationRouting.roles[role],
      authorRole: card.owner, childIds: [child.id], sourcePaths: [fixtureSource], testFiles: [fixtureSource],
      positiveTests: ['UNIT FIXTURE positive arithmetic'], negativeTests: ['UNIT FIXTURE rejects wrong arithmetic'],
      outputDirectory: `evidence\\reviews\\swarm-20261102\\R3\\copied-cli-${role}`
    };
    const requestPath = `request-${role}.json`;
    await save(path.join(copiedProject, requestPath), JSON.stringify(request, null, 2));
    reviews.push(JSON.parse(await run(`fixture-review-${role}`, ['tools\\kanban.mjs', '--review-child', requestPath], 0)));
  }
  state.childRecords[child.id] = {
    status: 'Done', scope: 'construction', waitingOn: [], nextAction: 'UNIT FIXTURE ONLY; never real child acceptance',
    certificationStatus: 'NOT CERTIFIED', sourceAcceptanceIsCertification: false,
    definitionSha256: child.definitionSha256, authorAgentId: state.currentImplementationRouting.roles[card.owner],
    completionSources: [fixtureSource], reviews
  };
  await save(stateFile, JSON.stringify(state, null, 2));
  await run('valid-fixture-write', ['tools\\kanban.mjs', '--write'], 0);
  const baseline = JSON.parse(await run('valid-fixture-check', ['tools\\kanban.mjs', '--check'], 0));
  assert.equal(baseline.cards, 78);
  assert.equal(baseline['To Do'], 78);
  assert.equal(baseline['In Progress'], 0);
  assert.equal(baseline.Done, 0);
  assert.equal(baseline.children.total, 52);
  assert.equal(baseline.children.Done, 1);
  const copiedState = JSON.parse(await readFile(stateFile, 'utf8'));
  assert.deepEqual(copiedState.records, {});

  const artifact = path.join(copiedProject, reviews[0].artifact);
  const artifactBytes = await readFile(artifact);
  await rm(artifact);
  await run('missing-child-review', ['tools\\kanban.mjs', '--check'], 1, /ENOENT/);
  await save(artifact, artifactBytes);

  await save(path.join(copiedProject, fixtureSource), Buffer.concat([fixtureBytes, Buffer.from('// changed reviewed source\n')]));
  await run('changed-child-source', ['tools\\kanban.mjs', '--check'], 1, /Child reviewed source changed/);
  await save(path.join(copiedProject, fixtureSource), fixtureBytes);

  const review = JSON.parse(artifactBytes);
  const tapFile = path.join(copiedProject, review.roles[0].tests.artifact);
  const tapBytes = await readFile(tapFile);
  await save(tapFile, 'PASS\n');
  await run('tampered-child-tap', ['tools\\kanban.mjs', '--check'], 1, /Evidence hash mismatch/);
  await save(tapFile, tapBytes);
  await run('restored-fixture-check', ['tools\\kanban.mjs', '--check'], 0);
} catch (error) {
  failure = error.message;
} finally {
  if (created) await rm(work, { recursive: true, force: true });
}
const after = await snapshot();
const stable = JSON.stringify(before) === JSON.stringify(after);
const boardPolicyStable = policyBefore === reviewSourceDigest('config\\board-state.json', await readFile(originalBoardFile));
const backlogSemanticsStable = semanticBefore === backlogSemanticHash(await readFile(originalBacklogFile, 'utf8'));
const receipt = {
  schema: 'contoso.code-review.v1', reviewKind: 'code', reviewerRole: 'R3',
  reviewerAgentId: '5b8ca6ff-5b97-464f-877a-5f42ee562abb',
  reviewedOwnerRole: 'orchestrator', reviewedOwnerAgentId: '1ebe7a51-b442-482a-aa51-b8da393798a0',
  result: !failure && stable && boardPolicyStable && backlogSemanticsStable ? 'ACCEPTED_COPIED_CLI_CONTROLS_ONLY' : 'FAILED',
  sourceAcceptanceIsCertification: false, certificationStatus: 'NOT CERTIFIED',
  executionScope: 'Isolated copied CLI and synthetic metadata/TAP fixtures only; reviewer IDs in the copy are test inputs, not independent review authority',
  nodeVersion: process.version, beforeSources: before, afterSources: after,
  sourcesVerifiedBeforeAfter: stable, originalBoardPolicyStable: boardPolicyStable,
  originalBacklogSemanticHashStable: backlogSemanticsStable,
  realBoardOperationalStatusNotCompared: true,
  parentUnitPassFacetsInCopy: 0, parentCardsDoneInCopy: 0, runs,
  failure: failure ?? null,
  cleanup: 'Private copied repository, fixture source/state and fixture review records removed; immutable stdout/stderr and receipt retained. No real board/wiki/scopes edits, services, Maven, cloud or secret access.'
};
await writeFile(path.join(packet, 'copied-cli-result.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ result: receipt.result, runs: runs.length, sourcesStable: stable,
  boardPolicyStable, backlogSemanticsStable, copiedWorkRemoved: created, failure: receipt.failure }));
if (receipt.result === 'FAILED') process.exitCode = 1;
