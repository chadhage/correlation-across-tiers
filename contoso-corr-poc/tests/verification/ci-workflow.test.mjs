import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { projectRoot } from '../../tools/verification/files.mjs';

const workflow = await readFile(path.join(projectRoot, '..', '.github', 'workflows', 'ci-node.yml'), 'utf8');

function validateWorkflowSource(text) {
  assert.match(text, /^on:\r?\n  pull_request:\s*$/m, 'every PR must trigger without a path or branch filter');
  assert.doesNotMatch(text, /^\s*(?:paths|paths-ignore|branches|branches-ignore):/m);
  assert.match(text, /runs-on: windows-latest/);
  assert.match(text, /permissions:\r?\n  contents: read/);
  assert.match(text, /persist-credentials: false/);
  for (const command of [
    'node tools\\kanban.mjs --check',
    'node tools\\verification\\register.mjs --check',
    'node tools\\verification\\test-coverage-report.mjs --check',
    'node tools\\verification\\pull-request-template.mjs --check',
    'node tools\\verification\\report.mjs --check',
    'node tools\\verification\\report.mjs --invalidate',
    'node tools\\verification\\ci-node.mjs'
  ]) assert.ok(text.includes(command), command);
  assert.match(text, /CONTOSO_BICEP_PATH=\$compiler/);
  assert.match(text, /CONTOSO_BICEP_EXE=\$compiler/);
  assert.match(text, /Install-Bicep\.ps1 -ToolsRoot \$tools/);
  assert.match(text, /throw 'REPORT_STALE:/);
  assert.match(text, /NOT RUN because the report prerequisite failed/);
  assert.match(text, /NOT RUN until all prerequisites pass/);
  assert.match(text, /skipped \$\(\$summary\.skipped\), cancelled \$\(\$summary\.cancelled\)/);
  assert.match(text, /NODE_TEST_EXECUTION_OR_SKIP_ACCOUNTING_FAILED/);
  assert.match(text, /if: always\(\)/);
  assert.doesNotMatch(text, /continue-on-error|--allow-skips|pull_request_target|azure\/login/);
}

test('real every-PR Windows Node workflow requires report freshness and honest execution accounting', () => {
  validateWorkflowSource(workflow);
});

test('workflow source rejects omitted report staleness, selective triggers and skip waivers', () => {
  for (const changed of [
    workflow.replace('node tools\\verification\\report.mjs --check', 'Write-Output unchecked'),
    workflow.replace('node tools\\verification\\report.mjs --invalidate', 'Write-Output unchanged'),
    workflow.replace('  pull_request:', '  pull_request:\n    paths: [some-path]'),
    workflow.replace('node tools\\verification\\ci-node.mjs', 'node tools\\verification\\ci-node.mjs --allow-skips'),
    workflow.replace('CONTOSO_BICEP_EXE=$compiler', 'IGNORED_COMPILER=$compiler'),
    workflow.replace('persist-credentials: false', 'persist-credentials: true')
  ]) assert.throws(() => validateWorkflowSource(changed));
});
