import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectRoot } from './files.mjs';

export function validatePullRequestTemplate(text) {
  const headings = [...text.matchAll(/^## (.+)\r?$/gm)];
  const sections = new Map(headings.map((heading, index) => [
    heading[1], text.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? text.length)
  ]));
  const checks = [
    ['author role', /Author role \(R1–R9\):/, 'Author'],
    ['author identity', /Author person\/agent identity:/, 'Author'],
    ['two accepted other-role reviews', /At least two accepted reviews/, 'Independent other-role reviews'],
    ['different roles', /roles different from the author and from each other/, 'Independent other-role reviews'],
    ['different independent identities', /different people or agents; neither is an author or coauthor/, 'Independent other-role reviews'],
    ['review receipts', /\| Reviewer \| Role \(R1–R9\) \| Person\/agent identity \| Current source hashes \| Positive and negative execution receipt \|/, 'Independent other-role reviews'],
    ['claim labels', /Allowed labels: \*\*Verified \/ Partially verified \/ Unsupported \/ Incorrect \/ Outdated\*\*/, 'Material technical claims'],
    ['every claim and evidence', /Every material technical claim requires a label and an evidence link/, 'Material technical claims'],
    ['independent reviewer claim labels', /including a label from each independent reviewer/, 'Material technical claims'],
    ['claim evidence table', /\| Material technical claim \| Author label \| Reviewer 1 label \| Reviewer 2 label \| Exact source\/evidence link \| Resolution or next action \|/, 'Material technical claims'],
    ['adjudication source', /\[DECISIONS\.md\]\(\.\.\/contoso-corr-poc\/DECISIONS\.md\).*winning source and its evidence-hierarchy level/, 'Material technical claims'],
    ['no majority vote', /Majority vote is not evidence\. A resolution without a source is rejected\./, 'Material technical claims'],
    ['no native authority', /Nothing in this change grants native authority or certification/, 'Verification and remaining prerequisites'],
    ['definition of done', /\*\*NOT CERTIFIED\*\*.*Definition of Done.*actual runtime evidence or accountable signoff/, 'Verification and remaining prerequisites']
  ];
  for (const [item, pattern, section] of checks) {
    if (!pattern.test(sections.get(section) ?? '')) throw new Error(`PR_TEMPLATE_REQUIRED: ${item}`);
  }
  return { result: 'PASS', scope: 'template-source-only', actualReviewsVerified: false,
    sourceAcceptanceIsCertification: false, certificationStatus: 'NOT CERTIFIED' };
}

export async function pullRequestTemplateMain(args) {
  if (args.length !== 1 || args[0] !== '--check') throw new Error('Usage: pull-request-template.mjs --check');
  return validatePullRequestTemplate(await readFile(path.join(projectRoot, '..', '.github', 'pull_request_template.md'), 'utf8'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await pullRequestTemplateMain(process.argv.slice(2)))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
