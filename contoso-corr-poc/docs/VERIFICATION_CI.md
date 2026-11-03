# Node CI and report freshness

These are source/construction controls, **NOT CERTIFIED**. A workflow file or
local unit test is not an actual hosted PR run, branch-protection approval,
native executor enrollment or accountable-owner signoff.

## Certification assessment

The root `.gitattributes` preserves source, board, lockfile and evidence bytes
across Git `core.autocrlf` settings. Existing LF and CRLF are retained: do not
normalize pinned files or rewrite historical receipt hashes to make a check
pass. The checkout regression executes Git staging and checkout in all three
autocrlf modes and compares the resulting bytes.

The ignored `.tools` directory contains installed portable prerequisites, not
application sources. Source snapshots, VERIFY inventory, certification-path
scans and repository scans exclude it just as they exclude generated caches.
Refreshing the register retains removed tool-installation claims under
`invalidatedPreviousClaims`; their removal supplies no GA/support or deployed
verification. Unchanged claims retain their owning role and test/next-action
annotations, but a refresh never inherits verified source-content or deployed
status. If the inventory and metadata are unchanged, refresh retains the
original claim order and file bytes rather than invalidating byte-pinned
reviews through a formatting-only rewrite. Historical receipts remain historical.

From the POC root:

```powershell
node tools\verification\report.mjs --check
node tools\verification\report.mjs --invalidate
```

`--check` is read-only. It rejects a changed source snapshot or versions digest
even when every native criterion is already INVALIDATED, and also checks the
rendered Markdown. `--invalidate` refreshes the exact source snapshot, its
SHA-256 and the versions digest; affected criteria remain INVALIDATED and no
native PASS is created. Existing `--write` is a preserving alias, not a reset.

The orchestrator is the sole writer of the assessment and certification report
in the current swarm. Before regeneration, preserve its construction section as:

```json
{
  "constructionNotes": {
    "schema": "contoso.certification-construction-notes.v1",
    "sourceAcceptanceIsCertification": false,
    "currentRoster": "Current independently staffed roster; no self-review.",
    "sections": [
      { "title": "Construction children", "markdown": "Existing scoped construction notes and immutable receipt links." }
    ]
  }
}
```

Unknown assessment keys are retained. Prior scoped sampling/security metadata is
retained under `qualificationHistory` with `HISTORICAL_ONLY`, its original
metadata and digest. A failed current qualification remains UNVERIFIED. History,
notes and saved JSON cannot supply a private execution capability.

## Execution and skip accounting

A clean checkout needs the sampler JAR and compiled Portal browser adapter
before the root suite. Install the checksum-locked portable prerequisites once
with `tools\java\Install-Portable.ps1`, or select an existing verified
`CONTOSO_PORTABLE_TOOLS_ROOT`, then run:

```powershell
npm run test:prepare
npm test -- --test-reporter=spec --test-concurrency=2
```

Preparation builds the real sampler from this checkout, verifies its locked
hash, restores Portal dependencies without modifying its lockfile and compiles
the browser adapter. It does not run Java tests or grant runtime/native
acceptance. Generated `target`, `dist`, tool and dependency directories remain
untracked. CI runs the same preparation before the configured Node suite.
The retained historical Surefire XML under the evidence support tree is an
immutable classifier input, not an output or passing Java run from this checkout.

Archived security observations are checked against their recorded path
structure. Current selected-epoch intake still requires the original execution
root and exact executable/source/artifact bytes; relocated copies cannot inherit
that execution identity.

`node tools\verification\ci-node.mjs` executes the configured root Node suite and
preserves actual TAP, stderr, source-before/after and result/manifest files under
`evidence\ci-node`. Missing TAP, nonzero exit, timeout/signal, source drift, any
failure, skip or cancellation fails the check. Skips are reported separately,
never added to passing tests. Frontend/browser and Java suites are not counted.

The [Windows PR workflow](../../.github/workflows/ci-node.yml) has no path or
branch filters and provides both hash-verified Bicep environment
bindings (`CONTOSO_BICEP_PATH` and `CONTOSO_BICEP_EXE`) and execute the portability
lint through the configured repository test discovery. GATE-11.2's passing lint
and an actual hosted PR run remain prerequisites, not results supplied by this
workflow source or its static tests. No Azure credentials, deployment or cloud traffic are needed or granted.
A stale report fails the PR check; CI may regenerate INVALIDATED copies only in
its ephemeral checkout for the retained diagnostic artifact, never commit them.
If a prerequisite fails, the root suite is **NOT RUN**, not a passing suite.

`test-coverage-report.mjs --check` checks the explicitly historical coverage
report against its cited original receipts. `pull-request-template.mjs --check`
checks template requirements only; it does not assert that actual independent
PR reviews occurred.
