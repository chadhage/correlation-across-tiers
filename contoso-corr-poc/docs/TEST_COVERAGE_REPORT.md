# Test coverage report

**Status:** HISTORICAL — the whole report describes the cited execution epochs, not the current workspace.  
**Source commit:** `63a2a5d58cd041b9893270bc9f4e2d2294e0476d`  
**Originally prepared:** 2 November 2026; explicitly historical-labelled on 2 November 2026.  
**Scope:** Preserved historical evidence only; no new suite, instrumented coverage collection, or repeatability run was performed for this report. Current-source equivalence is not claimed.  
**Historical cited suite completion:** 2 November 2026, 04:45:19 UTC  
**Qualification:** LOCAL VALIDATION ONLY / NOT CERTIFIED / NOT FULL GRAPH

Current source has changed since these receipts. The counts below are not current
test totals, current flaky-test findings, current board status or certification.
`node tools\verification\test-coverage-report.mjs --check` binds the reported
counts to the cited receipt bytes and requires this HISTORICAL label when the
source commit or recorded source closure differs.

## 1. Executive summary

The cited historical root Node and Java suites passed **601 of 601 tests**, with
zero failures, Java errors, or skipped tests. This is a **100% observed pass
rate for those two runs**, not 100% code coverage.

| Metric | Evidence-based result |
|---|---|
| Root Node tests | 419 passed; 0 failed; 0 cancelled; 0 skipped |
| Java tests | 182 passed across 11 modules; 0 failures; 0 errors; 0 skips |
| Combined root Node and Java baseline | 601 passed |
| Line / branch / function / statement coverage | Not measured by the cited runs; percentages unavailable |
| Positive-only / negative-only / mixed test counts | Not classified; no reliable numeric split established |
| Tests explicitly marked flaky in the reviewed test source/configuration | 0 found; this is not a measured flaky-test count |
| Actual flaky-test count or flake rate | Unknown; no dedicated unchanged-source repeat-run audit in the reviewed evidence |
| Separately executed Orders native controls | 7 of 7 verified; 6 native request matches and 3 local root bindings |
| Deployed Azure, full-graph, all-layer zero-loss correlation | Not established |

Frontend workspace tests, browser tests, native control scenarios, and packaged
launch checks are not added to the 601 total. Their units of counting and
execution scopes differ, and some behavior overlaps the root/Java suites.

## 2. Scope, revision, and evidence boundaries

- Repository: `chadhage/correlation-across-tiers`.
- Branch observed during report preparation: `main`.
- Git HEAD observed for this historical report: `63a2a5d58cd041b9893270bc9f4e2d2294e0476d`.
- The recorded workspace contained substantial uncommitted changes. The evidence is
  for its recorded, source-bound working-tree inputs, **not an assertion that
  the clean HEAD commit passed these tests**.
- The [final Node receipt][node-result] records 207 stable source/view inputs,
  103 checked status bindings, and both pinned Bicep compiler environment
  bindings. It is not a Java or deployed-Azure execution receipt.
- The [Java build witness][java-build] records an actual serial clean reactor
  execution with 197 stable source inputs, an observed Maven Java process,
  11 fresh JARs, and a 133-component runtime SBOM.
- A separate [historical current-byte check][java-current] verified those 197 Java inputs,
  six package archives, and the preserved launch-guard receipt without
  executing new Java tests. That check is not a current-workspace recheck.
- Historical failed runs remain failed. Later source fixes and successful runs
  do not retroactively change their results.
- Evidence links refer to the current local evidence tree; some supporting
  artifacts are ignored/generated and may not accompany a clean clone.

### Recorded run times

| Suite | Start, UTC | Finish, UTC | Result |
|---|---|---|---|
| Root Node | 2026-11-02 04:44:52.297 | 2026-11-02 04:45:19.014 | 419 passed |
| Java clean reactor | 2026-11-02 02:02:43.9536142 | 2026-11-02 02:08:44.0503344 | 182 passed |
| Separate Orders conditional observer | 2026-11-02 04:24:53.638 | 2026-11-02 04:25:14.369 | 7 selected controls verified |

These are separate executions, not a single combined run.

## 3. Automated test inventory

### Java: 182 passing tests

Counts are taken from the per-module Surefire suites bound into the
[actual build witness][java-build]. Every listed module had zero failures,
errors, and skips.

| Module | Passing tests |
|---|---:|
| correlation-core | 34 |
| security-core | 32 |
| inventory-data | 33 |
| messaging-core | 43 |
| inventory-api | 4 |
| orders-api | 21 |
| fulfillment | 1 |
| notify | 1 |
| aggregator | 1 |
| replay | 1 |
| parent-safe-sampler | 11 |
| **Total** | **182** |

The four worker entry modules each have one directly reported test. Shared
messaging tests also exercise worker-related behavior, so neither the direct
counts nor the shared counts establish a worker's line/branch coverage.

### Root Node: 419 passing tests in 53 historical discovered test files

The [root test runner](../tools/run-tests.mjs) discovers JavaScript test files
under the root test directory and inventory-data tooling. The following is a
**source test-file inventory**, not a per-area executed-case count or code
coverage percentage.

| Area | Test files | Principal subject matter |
|---|---:|---|
| APIM | 6 | Policies, protocol handling, contracts, compiler checks |
| Security/privacy | 7 | Authentication-related contracts, original-payload and privacy checks |
| Observability | 10 | Sampling, telemetry contracts, receivers, qualification controls |
| Verification | 16 | Evidence provenance, private capabilities, native correspondence, trust roots |
| Messaging | 5 | Messaging/replay contracts and asynchronous evidence |
| Java validation tooling | 2 | Dependency/instrumentation gates and report behavior |
| Inventory-data tooling | 1 | Schema/data tooling checks |
| Root cross-cutting checks | 6 | Architecture, certification paths, cost, naming, board and composition |
| **Total** | **53** | **419 executed tests in the cited root run** |

File counts describe organization only. One file can contain many tests, and one
test can exercise multiple success, boundary, and rejection scenarios.

### Frontend and browser suites

Both [Storefront](../web/storefront-spa/package.json) and
[Portal](../web/portal-ssr/package.json) define separate TypeScript test commands.
Portal additionally defines a Playwright browser suite. The root discovery
command does not automatically include these workspace TypeScript/browser suites.

This report does not assign them an additional numeric pass total or coverage
percentage. They are **outside the 601-test denominator**, not evidence that
frontend testing is absent.

## 4. Positive, negative, and mixed tests

For a future classified inventory:

- **Positive-only:** a test case exclusively checks expected behavior for
  supported inputs or successful operations.
- **Negative-only:** a test case exclusively checks rejection, failure handling,
  prohibited behavior, or invalid-input handling.
- **Mixed:** a single reported test case checks both positive and negative
  behavior.

The existing test reports do not record these categories. A source-name
keyword count would not be a defensible classification: tests contain loops,
shared helpers, and both acceptance and rejection assertions.

For example, the
[conditional hash normalization test](../tests/verification/conditional-observer.test.mjs)
checks successful canonical hashing and rejection of an invalid private
capability within the same reported test case.

| Requested category | Established count |
|---|---|
| Positive-only | Not classified |
| Negative-only | Not classified |
| Mixed | Present; not separately counted |

**A passing negative test is still a pass.** The 601 passing tests must not be
reported as 601 positive tests or zero negative tests. No new classification
exercise was performed, in accordance with this report's existing-evidence scope.

## 5. Flakiness assessment

The reviewed test source/configuration contains no explicit flaky-test labels.
The [Portal Playwright configuration](../web/portal-ssr/playwright.config.ts)
sets `retries: 0` in the cited historical source. The cited root Node and Java runs report no failures.

However, the reviewed evidence does not provide a dedicated controlled audit
that repeatedly runs each current test against unchanged source, dependencies,
and environment while retaining every attempt. Therefore:

- **Explicitly marked flaky tests found: 0.**
- **Confirmed actual flaky-test count: unknown.**
- **Measured flaky-test rate: unavailable.**

Earlier failed native verifier attempts followed by source fixes are not
sufficient evidence of current test flakiness. Likewise, a successful final
run does not prove that the current tests are deterministic.

## 6. Separately verified local native behavior

The [Orders native adjudication][native-result] records one separately
authorized successful execution of the frozen v7 observer. It bound actual
sent carriers, SDK observations, process/class origins, and native telemetry.

| Control | Verified outcome |
|---|---|
| No incoming parent | New SDK/native root |
| Invalid all-zero trace ID | New SDK/native root |
| Invalid all-zero parent span ID | New SDK/native root |
| Valid sampled parent | Technical trace continued with a fresh request span |
| Invalid tracestate only, valid parent | Valid technical parent retained; no root waiver |
| Changed business invocation ID, same valid parent | Technical parent retained |
| Valid unsampled `00` parent | SDK context unsampled and nonrecording; zero related request/dependency exports |

The sampled cases produced six matching native requests. The first three
controls produced three private **LocalValidate** root bindings. Sources and
runtime bytes matched before/after, and the recorded JVM/compiler/validator
processes stopped.

This establishes **LOCAL_ORDERS_CONDITIONAL_ONLY / NOT_FULL_GRAPH**. Saved JSON,
hashes, or this report cannot recreate the original private execution capability.
Original raw payloads were not retained, so no independent raw-payload rescan is
claimed. The execution window is spent/closed; this report authorizes no rerun.

The [six packaged missing-agent checks][launch-guards] also verified expected
startup rejection. Those are negative controls, not proof that six deployed
applications start and operate successfully.

## 7. Coverage strengths and remaining gaps

### Demonstrated within the cited historical bounded local scopes

- Unit and integration checks for correlation helpers, security, data adapters,
  APIs, asynchronous workflow/replay behavior, and sampling.
- Node checks for APIM/infrastructure contracts, privacy parsing, verification
  provenance, and acceptance/reporting behavior.
- Actual selected SDK/native propagation, continuation, root-restart, and
  strict-unsampled behavior, subject to the exact local execution scopes.
- Packaged missing-agent startup rejection.

These observations establish exercised behavior, not exhaustive coverage of each
component or all possible failure modes.

### Not established by the cited evidence or by this historical report

| Gap | Consequence |
|---|---|
| Line/branch/function/statement instrumentation | No defensible code-coverage percentage or threshold compliance |
| Positive/negative/mixed inventory | No exact scenario-type distribution |
| Controlled repeated runs | No defensible flaky-test count or rate |
| Inventory/Gateway conditional native cases | Orders-only results cannot qualify those boundaries |
| Real brokers, PostgreSQL, Redis, managed identity and deployed hosts | Local fixtures cannot certify the production service path |
| Full graph, contributor/emission/backend coverage and canaries | No all-layer zero-loss correlation claim |
| Retention and source-to-backend loss/delay accounting | No demonstrated durable zero-loss reconstruction |
| Global/all-layer privacy and complete provider/exporter ownership | Selected safe captures do not establish global compliance |
| Watchdog, overhead, load/SLO and accountable-owner acceptance | No production readiness or operational acceptance |

The historical [frozen status record][status-freeze] recorded **78 To Do, 0 In Progress,
0 Done**, and **628 OPEN verification claims**. These are formal acceptance
statuses at that epoch, not current board/claim totals or a statement that no implementation or local tests exist.

## 8. Recommended follow-up measurement

The following work is recommended, but **was not performed or authorized by
this existing-evidence report**:

1. Define coverage denominators and collect line/branch/function reports
   separately for production Java, Node tooling, frontend TypeScript, and browser
   execution. Keep generated/dependency/test code exclusions explicit.
2. Classify each reported test case as positive-only, negative-only, or mixed;
   distinguish parameterized scenarios from runner-level test counts.
3. Run a bounded unchanged-source repeatability audit, preserving all attempts,
   failures, durations, and environment identity. Report observed flakiness over
   that finite run set rather than claiming proof of zero flakiness.
4. Close live full-graph and operational gaps only through separately approved,
   source-bound Azure qualification. Do not equate local passes with deployment
   or certification approval.

**Conclusion:** the cited historical 601-test root Node/Java baseline passed and
recorded meaningful bounded native evidence. This report does **not establish current test totals, a measured
repository-wide code-coverage percentage, an exact positive/negative split, or a
measured flaky-test count**.

## 9. Primary evidence and integrity references

The following SHA-256 values identify the cited original receipts, not newly
executed tests. The [final consistency review][final-review] ties together their
finite scopes and retained limitations.

| Reference | SHA-256 |
|---|---|
| [Root Node result][node-result] | `a2a23bd9f4a1129edd48794658c5315182d1b556ea01f7f09eeba5a7c83fa17b` |
| [Root Node source snapshot][node-sources] | `e3f79389a4bb6774e9e847146c0e3270021a50db793c61044cb644e63c933d9f` |
| [Java execution witness][java-build] | `d3ff1ed1755c258066a6ee8f07f5cecce33423fb9d8f2e6a70e6eff858d2c7df` |
| [Orders native adjudication][native-result] | `c384c72148af9fb614af809451530b4e4865817be9fac1ae08ad8db8bf114d73` |
| [Metadata-only status freeze][status-freeze] | `b3cb1b2aa41b9459a365eb94d84555461052ab22a24497b7780dd53792c7feee` |
| [Final local consistency review][final-review] | `31bb270236d83135809ddbda08f3357bda4e334423c66e0d4a015b18b5724675` |

[node-result]: ../evidence/verification/root-node/20261102T044452090Z-0314607f-8474-41a8-baeb-4267f7447368/result.json
[node-sources]: ../evidence/verification/root-node/20261102T044452090Z-0314607f-8474-41a8-baeb-4267f7447368/after-sources.json
[java-build]: ../evidence/java-local/source-builds/20261102T020237806Z-integrated-reactor-bbf3e7ef-36b8-4d66-b009-df47b708d6d3/source-build.json
[java-current]: ../.cache/parent/java182-current-check/20261102T042717472Z-3f7f0027-c5b4-42c7-a24b-872c148b6a89/result.json
[native-result]: ../evidence/verification/conditional-adjudications/20261102T042736620Z-bd49b993-97ed-4916-a010-aa253bc883d3/adjudication.json
[launch-guards]: ../evidence/java-local/packaged-launch-guards/20261102T021846197Z-14587d8c-bb9e-42df-8ec5-d365bf06928a.json
[status-freeze]: ../tools/verification/conditional-source-freeze.v8.json
[final-review]: ../.cache/parent/final-local-validation/20261102T044647473Z-2dab9fff-1026-49fd-ae74-ee0342cb58f3/review.json
