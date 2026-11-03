import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { validatePullRequestTemplate, pullRequestTemplateMain } from '../../tools/verification/pull-request-template.mjs';
import { projectRoot } from '../../tools/verification/files.mjs';

const template = await readFile(path.join(projectRoot, '..', '.github', 'pull_request_template.md'), 'utf8');

test('real repository PR template requires independent other-role reviews and labelled sourced claims', async () => {
  const result = await pullRequestTemplateMain(['--check']);
  assert.equal(result.result, 'PASS');
  assert.equal(result.actualReviewsVerified, false);
  assert.equal(result.sourceAcceptanceIsCertification, false);
  assert.equal(result.certificationStatus, 'NOT CERTIFIED');
});

test('seeded template without the claim-label item fails closed', () => {
  assert.throws(() => validatePullRequestTemplate(template.replace(/^Allowed labels:.*$/m, '')), /claim labels/);
});

test('each required template item is parsed in its own section and cannot be omitted', () => {
  for (const line of [
    /^Author role.*$/m,
    /^Author person.*$/m,
    /^- \[ \] At least two accepted.*$/m,
    /^- \[ \] Both reviewers.*$/m,
    /^- \[ \] Reviewers are different.*$/m,
    /^\| Reviewer \| Role.*$/m,
    /^Every material technical claim.*$/m,
    /^\| Material technical claim \| Author label.*$/m,
    /^- \[ \] Conflicts and resolutions.*$/m,
    /^- \[ \] Majority vote.*$/m,
    /^- \[ \] Nothing in this change.*$/m
  ]) {
    assert.ok(line.test(template));
    assert.throws(() => validatePullRequestTemplate(template.replace(line, '')), /PR_TEMPLATE_REQUIRED/);
  }
  assert.throws(() => validatePullRequestTemplate(template.replace('## Material technical claims', '## Unrelated section')), /claim labels/);
});

test('PR source checker rejects unsupported arguments rather than treating a body as review approval', async () => {
  await assert.rejects(pullRequestTemplateMain(['--approve']), /Usage:/);
  assert.throws(() => validatePullRequestTemplate(''), /author role/);
});
