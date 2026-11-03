# Contoso End-to-End Correlation POC: atomic kanban

**Board state:** Rehydrated from the 78-card backlog and board-acceptance revision 80. No certification is implied by construction progress.
**Columns:** Avoid doing · To Do · In Progress · Done

| Avoid doing | To Do | In Progress | Done |
|---|---|---|---|
| 25 anti-patterns | 78 cards | 0 of 9 (WIP limit) | 0 |

**Unranked construction children (52):** 47 To Do · 0 In Progress · 5 Done. Child Done is construction-only / NOT CERTIFIED; parents and native requirements are unchanged.

## Board rules

1. Pull the highest-ranked executable facet. Reviewed interface construction may precede dependency Done; completion still requires every needs edge to be Done.
2. One active card per actual implementation owner, maximum nine. Approved acting assignments retain logical backlog ownership; authors cannot review themselves through a logical-role alias.
3. Independent draft, two other-role reviews with claim labels, evidence-based adjudication, then merge and validation.
4. If work cannot progress, return it to To Do with waitingOn and the next action. There is no Blocked state.
5. A council votes on next actions; the evidence hierarchy, never majority vote, adjudicates technical claims.
6. Done requires all own acceptance clauses, completion dependencies, current evidence and two accepted other-role reviews. Fixtures never close live requirements.
7. Bootstrap traffic is NOT CERTIFIED. Final certification requires every applicable facet of all thirteen gates on the frozen deployed environment.
8. Unranked child checklists decompose parent acceptance; they do not add cards or waive WIP, parent evidence or separately approved native-run requirements.

**Approved implementation routing:** user-approved independent nine-role mode (`USER independent_nine_roles`): logical R1 → R1; logical R2 → R2; logical R3 → R3; logical R4 → R4; logical R5 → R5; logical R6 → R6; logical R7 → R7; logical R8 → R8; logical R9 → R9. Nine distinct current implementation lanes; actual actor identities require independent roster reconciliation. Historical stopped/failed agent IDs are not revived. No roster label enrolls native evidence authority, authorizes deployment/spending/traffic or grants acceptance.

## Swarm execution plan

**Mode: ACTIVE CONSTRUCTION SWARM.** The user authorized launch of one coordinator and nine fresh specialist agents. The exact nine-role policy candidate received independent R1/R7 source/unit acceptance before construction activation; actual fresh task identities are recorded in the board state. This section groups the existing work; it does not add ranked cards, change acceptance, grant native authority or authorize deployment/spending/traffic. The Kanban reproduces this canonical plan.

**Coverage baseline:** 78 unfinished parent cards, 52 child tasks, 281 acceptance clauses and 491 required facet checks: 63 static, 157 unit, 58 documentation, 202 live and 11 signoff. The exact clause/facet map in `config\acceptance-scopes.json` remains authoritative; these are obligations, not passing results. The 70 ideal-day sizing and 13-day historical dependency estimate are not an execution forecast: approvals, runtime support and live evidence have no verified completion date.

### Staffing and independent review

Use nine independently staffed logical roles, one implementation card/facet per owner at a time; nine is the implementation WIP ceiling, not a requirement to keep unsafe or stalled work active. Review/test an unrelated frozen handoff when no eligible implementation facet remains. The two reviewers below must be different actual people/agents from the author and from each other; a coauthor cannot count as an independent reviewer.

| Role | First eligible facet sequence, not a start authorization | Exclusive write lease | Independent reviewers |
|---|---|---|---|
| R1 | GATE-07 local checks; GATE-11 reproducible deployment construction; ADR-01/ARC-01/ADR-02 interface handoffs | Root composition, frozen names/map, architecture/decision and operator documents | R3, R8 |
| R2 | WEB-01 current browser evidence; WEB-02 origin/CORS negatives; WEB-03 SSR | Browser/SSR surfaces and their tests; release the Demo 01 route file to its named child executor when leased | R3, R7 |
| R3 | GATE-01 source/negative controls; INF-04/API-01/API-02 actual gateway bindings | APIM modules/policies, OpenAPI and protocol tools/tests | R2, R8 |
| R4 | GATE-02 and GATE-05 current loaded-byte/provider checks; JVM-05 coherent reactor/build handoff | Java API/core, sampler/compute tooling, root Maven/version/package integration | R6, R9 |
| R5 | GATE-09 attempt/link controls; INF-06/MSG-01 transport construction | Messaging-core, workers and messaging infrastructure/tests | R3, R6 |
| R6 | INF-05 deployment/connectivity construction; DAT-01.1 cold-cache preparation and DAT-01/DAT-02 | Inventory data adapters, migrations/grants and data infrastructure/tests | R4, R8 |
| R7 | INF-01 telemetry inputs; OBS-03/OBS-01; OBS-02.1 collector | Telemetry/sampling/query tooling, KQL and workbooks | R2, R9 |
| R8 | GATE-03 secret checks; GATE-04/GATE-10 intake/identity controls; INF-02 | Security/identity code, Key Vault/access/retention tooling and privacy tests | R4, R5 |
| R9 | GATE-06 claim audit; GATE-08/GATE-12/GATE-13 exact evidence intake; DEM-00 | Verification/harness code and the single board, scope and evidence-register writer | R1, R7 |

**Kickoff staffing prerequisite - satisfied for construction only:** the prior runtime policy had seven distinct writing lanes (R3 also acted R1, R5 also acted R6, coordinator covered R4). The coordinator reconciled nine fresh task identities and activated `USER independent_nine_roles` after R1 and R7 each independently accepted the frozen R9 candidate with 40/40 focused tests and unchanged two-file hashes. Prior routing/kickoff facts remain historical in the board state. No stopped/failed historical agent was revived. Later roster changes still require explicit approved metadata and independent validation; this activation supplies no native authority or completion evidence.

### Scheduling and resource isolation

1. R9 dispatches an exact `card / clause / facet` or child-task packet, not an entire vague subsystem. Each packet names its executor, prerequisite artifacts/hashes, allowed files, measurable assertion, negative control, command, stop condition and reviewers. Preserve parent Needs edges and rank within each role; select the highest-ranked executable facet, not repeatedly completed construction.
2. Maximize the ready frontier, not the number of writers touching a file. Reviewed interfaces permit parallel construction before predecessor Done. Native execution additionally requires real deployed readiness, authentication, privacy/sampling controls and the separate bounded authorization; no gate is assumed passed to obtain its bootstrap evidence.
3. Use isolated worktrees or disjoint owned paths and unique run/output directories, ports, datasets and queue entities. One writer owns any shared file at a time. R4 serializes root POM/version/package/loaded-byte integration; R9 serializes board/register writes. Domain owners propose shared-contract edits; freeze/review them before consumers adopt. Do not concurrently write a shared build output or dependency cache.
4. Time-box a packet to one independently checkable outcome. If its prerequisite is absent, return the card to To Do with the exact missing artifact and next action, then review/test another ready handoff. Do not weaken the assertion, invent a placeholder PASS, repeatedly rewrite status prose or repeat the same failed attempt without new evidence.
5. Pipeline implementation, independent execution and two-role review across different packets. Authors fix their own findings; reviewers execute focused positives/negatives against frozen bytes and return source-bound results. R9-authored harness/assertion changes are executed/adjudicated by R1/R7, never self-certified by R9 or an alias.
6. Only the authorized deployment runner changes shared Azure resources. Hold one lease per resource/configuration set; never overlap sampling changes, resets, destructive negative controls, load tests or teardown on the same target. Parallelize read-only checks and genuinely isolated run-owned paths, subject to quota/cost approvals. Restore and verify a lease before the next conflicting run.
7. Release candidate evidence uses one integrated, immutable source/build/deployment epoch. Parallel branch results are construction evidence until replayed or shown valid for that merged closure; never stitch incompatible epochs into a purported full invocation.
8. Schedule early external decisions in parallel: actual budget/quota/region, Entra/RBAC/Key Vault/bootstrap grants, private App/SCM/data reachability, query permissions and six accountable owners. GATE-06 must resolve official source/support claims, including the currently UNVERIFIED Node exporter dependency; neither a lock pin nor local success proves GA/support. Spent native windows stay closed until separately renewed.

### Concurrency and event-driven flow

Parallelism means independent packets execute simultaneously; concurrency means several packet lifecycles advance while others build, export, settle, drain or await review. Optimize both without relaxing empirical acceptance:

- Maintain separate ready queues for construction, independent execution, review and native/resource leases. R9 dispatches on artifact-ready, test-complete, review-returned, telemetry-settled and lease-restored events; do not wait for a daily batch, whole card, whole package or whole wave. Preserve rank among executable facets and never poll/relaunch a job that is already running.
- Publish immutable interface/source/test handoffs as soon as a bounded facet is ready. R2's browser carrier contract can unblock R3/R7, R6's cold-cache contract can unblock R1/R9, and R7's checked collector contract can unblock R9 while those owners complete unrelated work. Consumers bind the exact handoff hash; a later change invalidates only its affected consumers/facets and schedules the scoped rerun.
- Fan GATE-06 source/support investigations out to the domain owners while R9 remains the sole claim-register writer. After Demo 01, each demo owner supplies its concrete trigger/effect/collect/reset handler under an explicit adapter-file lease; R9 integrates the shared dispatcher/contract. Demos 02-15 must ship their own working scenario support, not inherit Demo 01 PASS or ask the presenter to supply callbacks.
- Overlap a frozen packet's build/tests and two independent review runs in isolated worktrees when resources permit. An owner awaiting its running command can review another role's frozen packet without starting a second implementation card. A missing prerequisite instead returns that implementation card to To Do; a genuinely running bounded command remains active work.
- During one authorized invocation, R2/R3/R4/R6 observe their own actual boundary facts concurrently while R7 captures and R8 scans original intake. After a safe immutable capture closes, role-specific parentage, identity, data, async and query assertions may run concurrently over the same source-bound pack; no agent fabricates its own substitute rows or inherits observer authority from a copied projection.
- Pipeline run N analysis/review with run N+1 traffic only when source/runtime/configuration stay frozen, run identities/datasets/messages are isolated, both windows are approved and the resource lease permits it. The two consecutive repeatability cycles and interruption regression retain their required reset-before-next-cycle order. Sampling mutation, reset, load and teardown on shared state are exclusive, even while unrelated read-only work proceeds.
- Use bounded asynchronous commands and independent completion notifications rather than blocking all owners on long builds or backend ingestion. Give each stage an absolute deadline, cancellation/stop/drain/restore path and source-stability check; success requires the complete closed capture, not the earliest partial rows.
- Apply backpressure at the actual bottleneck: file leases, available CPU/memory, original-intake/query limits, broker/data ownership, approved traffic budget and reviewer capacity. Never create unlimited agents/processes, concurrent writes to shared caches, or a second exporter to increase apparent throughput. Borrow idle owners for independent evidence/review before increasing implementation WIP.
- Report ready/running/review/lease-wait counts, time to the first qualified full-path trace, time to two repeatable cycles, current verified-facet throughput and review/ingestion wait time. Tune concurrency from these observations; no arbitrary speedup, worker-count target or local test total is evidence of Done.

### Complete parent-card coverage

These are dispatch packages, not new cards, rankings or completion dependencies. Each parent appears once; execute its exact acceptance clauses and Needs edges inside its package. A package may stream across several waves and has no independent Done status. Every DEM-02 to DEM-15 parent also ships its own scenario adapter (trigger, effect, collect and reset handlers); none inherits Demo 01 PASS or relies on a presenter-supplied callback. Each adapter is its own child (DEM-02.1 to DEM-15.1; Demo 05 also splits its fault switches into DEM-05.1), so no half-day demo card is asked to absorb adapter construction. Shared native evidence may support multiple clauses only through explicit per-clause provenance and assertions.

| Package | Owner | Cards | Empirical exit |
|---|---|---|---|
| P01 | R1 | GATE-07, GATE-11, ADR-01, ARC-01, ADR-02, DOC-01 | Removed-claim negatives, approved decisions/map, clean-group deployment, no-change second what-if and teardown/redeploy observations |
| P02 | R1 | DEM-01, DOC-02, DOC-03, DOC-04 | Full golden trace and actual backend UI captures; another engineer reproduces Windows run/reset/recovery and timed presenter steps |
| P03 | R2 | WEB-01, WEB-02, WEB-03, DEM-02 | Actual first browser carrier/dependency, excluded-origin negatives and separately instrumented SSR-to-Gateway parent joins |
| P04 | R3 | GATE-01, INF-04, API-02, API-01, DEM-03 | Source guards plus actual APIM config, four context vectors, backend parent advancement and canonical business identity |
| P05 | R4 | GATE-02, GATE-05, JVM-05, INF-03, JVM-01, JVM-02, JVM-04, JVM-03 | Coherent reactor/SBOM/packages, actual loaded agent/provider/runtime/export and API/log/async context associations; missing-agent negatives are not healthy-host proof |
| P06 | R4 | DEM-04, DEM-05 | Trusted/untrusted business lookup and actual timeout/database-error effects retain correct HTTP/message/span/log associations |
| P07 | R5 | GATE-09, INF-06, MSG-01, MSG-07, MSG-02, MSG-03, MSG-04, MSG-08, MSG-06, MSG-05 | Real broker/carrier/store state transitions, distinct attempts, durable-outbox publish attempts, fenced batch-checkpoint recovery and exact persisted replay/contributor/batch links with seeded anti-pattern failures |
| P08 | R5 | DEM-06, DEM-07, DEM-08, DEM-09, DEM-10 | Live retry, two-actor DLQ/replay, fan-out/fan-in, mixed batch and Event Grid/Storage delivery, terminal outcomes and run-owned resets |
| P09 | R6 | INF-05, DAT-01, DAT-02, DEM-12 | Actual private Entra PostgreSQL/Managed Redis operations, safe CLIENT spans for Inventory, the Orders workflow store and the worker stores, forced cold-cache path and restored owned/unowned baseline |
| P10 | R7 | INF-01, OBS-03, OBS-01, OBS-02 | Actual telemetry resources, complete sampling roster/admission/drain/restore, executed three KQL procedures and source-bound full-path collection |
| P11 | R7 | DEM-14, OBS-05, OBS-06 | Imported/rendered workbook and actual query/UI results; every orphan candidate accounted for, with unexplained defects failing |
| P12 | R7 | OBS-04, OBS-07, DEM-15 | Approved-load measured thresholds, independent emission/backend counts, restart/flush and watchdog/rollback/restoration evidence |
| P13 | R7 | EVL-B, EVL-A | Separately approved isolated evaluation evidence and decision; never on the certification critical path or relabelled certified |
| P14 | R8 | GATE-03, GATE-04, GATE-10, INF-02, IDN-01, IDN-02, INF-07 | Secret/history and all-original-table scans, real dual-token auth/grant/rotation/retention/purge negatives, server-side identity-client header isolation (AV-23) and required accountable decisions |
| P15 | R8 | DEM-13, DEM-11 | Actual identity/privacy and spoofed-message effects, safe rejection telemetry and preserved trust boundaries; no fixture-only live result |
| P16 | R9 | GATE-06, GATE-08, GATE-12, GATE-13, CRT-01, GOV-01, CRT-03 | Exact claim/facet ledger, independently enrolled source-bound live executor, A/B/C/coverage and provenance negatives, scoped report/limitations |
| P17 | R9 | DEM-00, CRT-02 | Shipped concrete adapter, consecutive run/reset plus interrupted recovery; all fifteen demonstrations, current gate evidence and six real owner signoffs |

### Golden-path child dependency graph

The child Executor fields now name their independent logical-role owner under the activated nine-writer roster. None of these edges requires its parent card to be Done before reviewed construction can proceed; every native qualification prerequisite remains mandatory.

| Child | Target owner | Child prerequisites | Required result |
|---|---|---|---|
| DAT-01.1 | R6 | none | Run-owned cold-cache preparation/reset; actual PostgreSQL SELECT plus Redis GET/population and unchanged unowned state |
| DEM-01.1 | R1 | none | Advertised UI action reaches the order route, actual Orders/Inventory and both data CLIENT boundaries; local substitutes explicitly labelled |
| OBS-02.1 | R7 | DAT-01.1, DEM-01.1 | One qualified actual browser -> APIM request/backend -> Orders -> Inventory -> data capture, using the existing browser driver without waiting for DEM-00.1 |
| DEM-00.1 | R9 | DAT-01.1, DEM-01.1, OBS-02.1 | Supplied concrete native adapter and saved-baseline restore, not an interface requiring the presenter to implement it |
| DEM-00.2 | R9 | DEM-00.1 | Two distinct complete run/capture/assert/reset cycles and a separate interrupted-run cleanup regression |
| DOC-02.1 | R1 | DEM-00.2, GATE-11.2 | Shipped Windows commands reproduced by another engineer without hidden repairs, unsupported script examples or machine-specific paths |

Construction contracts for the first two children, observer and adapter can be drafted in parallel under file leases. The table orders native qualification, not all source edits: the collector can qualify via the existing browser driver before adapter integration. Its real target/auth/privacy/lease prerequisites remain mandatory, avoiding an observer-adapter circular dependency.

### Gap-closure child dependency graph

These children close the gaps found when the execution evidence at commit `7279cd3` was compared with the claims (see the unproven-claim ledger). Each is unranked, starts To Do and meets the atomic test above; none adds a card, clause, facet or estimate, waives a parent Needs edge or grants native authority. Its executor equals the parent owner. The local rehearsal children (JVM-01.1, WEB-01.1, OBS-02.2, DEM-01.2) and the opt-in real-store lanes (DAT-01.3, DAT-02.1) are construction aids that retire integration risk before a native window; they are labelled local and satisfy no live facet. Child prerequisites name only other children; every parent Needs edge, approval and native-window requirement still applies.

Files introduced here are exclusive to their owner while leased (`.github\` sits at the Git repository root, above `contoso-corr-poc\`): `azure.yaml` and `tools\Rehearse-Demo01.ps1` (R1); `.github\workflows\ci-node.yml` and `.github\pull_request_template.md` (R9); `.github\workflows\ci-java.yml` and `tools\java\Start-LocalPair.ps1` (R4); `.github\workflows\secret-scan.yml` (R8); and each `tools\verification\adapters\demoNN-runtime.mjs` (its demo's owner, integrated by R9 only through the shared adapter contract).

| Child | Target owner | Child prerequisites | Required result |
|---|---|---|---|
| ARC-01.1 | R1 | none | Every store-consuming role's PostgreSQL CLIENT boundary declared in the single map, with a source-derived completeness test |
| GATE-11.1 | R1 | none | Root `azure.yaml` consistent with the Bicep infrastructure and every deployable package, statically checked |
| GATE-11.2 | R1 | GATE-05.1, DAT-01.2, GATE-13.1, IDN-01.2, INF-06.1 | Lint rejecting machine-specific tool and user paths in shipped files |
| DEM-01.2 | R1 | JVM-01.1, WEB-01.1, OBS-02.2 | One-command local rehearsal labelled LOCAL REHEARSAL, never APIM, Azure or certification evidence |
| DOC-01.1 | R1 | ARC-01.1 | Tier-role labels and a hop-by-hop table generated from the single map, with a drift test |
| DOC-02.2 | R1 | none | Every top-level directory classified in the README repository map and tested |
| WEB-01.1 | R2 | JVM-01.1 | Real Storefront click through a pass-through forwarder to local Orders, with the browser-to-Orders parent join asserted |
| DEM-02.1 | R2 | DEM-00.1 | Shipped Demo 02 adapter observing SSR and SPA roots separately |
| DEM-03.1 | R3 | DEM-00.1 | Shipped Demo 03 adapter driving the four carrier cases through the Gateway |
| GATE-02.1 | R4 | none | Current-source local receipt for the sampler guard's unsampled and linked-root decisions |
| GATE-05.1 | R4 | none | Six Java tooling scripts free of the session-folder default |
| GATE-05.2 | R4 | GATE-05.1 | Every-PR Java reactor workflow that fails on skipped agent-gated tests |
| JVM-01.1 | R4 | none | Local Orders and Inventory JVMs with the agent and a loopback receiver from one command |
| DEM-04.1 | R4 | DEM-00.1 | Shipped Demo 04 adapter for trusted, untrusted and malformed IDs over HTTP and Service Bus |
| DEM-05.1 | R4 | none | Default-off Inventory timeout and database-error fault switches gated by the demo/control role |
| DEM-05.2 | R4 | DEM-00.1, DEM-05.1 | Shipped Demo 05 adapter that uses and then clears the fault switches |
| INF-06.1 | R5 | none | Messaging infrastructure test that skips explicitly instead of failing on a machine path |
| MSG-02.1 | R5 | none | Real-queue proof of outbox publish attempts, uncertain-publish retries and duplicates |
| MSG-06.1 | R5 | none | Real Event Hubs proof of fenced checkpoint restart and replay |
| DEM-06.1 | R5 | DEM-00.1 | Shipped Demo 06 adapter showing N+1 distinct retry attempts on a real broker |
| DEM-07.1 | R5 | DEM-00.1 | Shipped Demo 07 adapter for dead-letter and replay with a run-owned drain |
| DEM-08.1 | R5 | DEM-00.1 | Shipped Demo 08 adapter for fan-out PROCESS spans and Aggregator links |
| DEM-09.1 | R5 | DEM-00.1 | Shipped Demo 09 adapter for a mixed-context batch without a first-message parent |
| DEM-10.1 | R5 | DEM-00.1 | Shipped Demo 10 adapter for the Event Grid and Storage Queue paths with a duplicate |
| INF-05.1 | R6 | none | Per-app database and Redis connection smoke tests under each app's own identity |
| INF-05.2 | R6 | none | Untyped data-tier API-version warnings recorded, test-gated and tied to VERIFY rows |
| DAT-01.2 | R6 | none | Inventory fixture script free of the session-folder default |
| DAT-01.3 | R6 | none | Opt-in real-PostgreSQL local lane for the migration, grants and operations |
| DAT-02.1 | R6 | none | Opt-in real-Redis local lane for the cache adapter |
| DEM-12.1 | R6 | DEM-00.1, ARC-01.1 | Shipped Demo 12 adapter with safe store spans in every tier and seeded negative controls |
| OBS-02.2 | R7 | none | Merged local trace tree with Invariants A, B and C under a named local profile |
| DEM-14.1 | R7 | DEM-00.1, ARC-01.1 | Shipped Demo 14 adapter classifying every orphan candidate with zero defects |
| DEM-15.1 | R7 | DEM-00.1 | Shipped Demo 15 adapter for the bounded certification window, load report and rollback |
| GATE-03.1 | R8 | none | Secret-scan workflow on every pull request and over full history |
| IDN-01.1 | R8 | none | Native dual-token negative-control matrix through the deployed Gateway |
| IDN-01.2 | R8 | none | AV-23 Java probe free of the session-folder default |
| IDN-01.3 | R8 | IDN-01.2 | Current-build AV-23 header-isolation receipts for every Java JVM |
| IDN-01.4 | R8 | none | Current-build AV-23 wire evidence for the Portal Node process |
| DEM-11.1 | R8 | DEM-00.1 | Shipped Demo 11 adapter with an authenticated spoofed-delivery publisher |
| DEM-13.1 | R8 | DEM-00.1, IDN-01.1, IDN-01.3 | Shipped Demo 13 adapter showing pseudonym-only telemetry through the dual-token chain |
| GATE-06.1 | R9 | none | Official-source classification of the Portal's resolved beta Node packages |
| GATE-08.1 | R9 | ARC-01.1 | Invariant C assertions and seeded failures for the Orders workflow and worker store boundaries |
| GATE-12.1 | R9 | GATE-11.2 | Every-PR Node gate workflow with report-staleness and skip accounting |
| GATE-13.1 | R9 | none | Security client qualification free of the session-folder default |
| GOV-01.1 | R9 | none | Pull-request template enforcing two-role review and claim labels |
| CRT-03.1 | R9 | none | Test-coverage report regenerated from current receipts or labelled historical |

### Overlapping waves and release conditions

| Wave | Concurrent work | Required exit / next release |
|---|---|---|
| W0 - Reconcile | Nine owners audit existing receipts against every exact clause/facet; R9 checks freshness, actual roster and unavailable live enrollment; owners request external approvals | Dispatchable source-bound packets, tested roster transition and explicit missing prerequisites; no assumed fresh PASS from historical evidence |
| W1 - Construct | All nine lanes execute the eligible facet sequences above; R6/R1 children proceed alongside R7 collector and R9 adapter contracts; idle owners cross-review | Reviewed interfaces, focused positive/negative results and one coherent integrated build; runtime/support/permission gaps explicit |
| W2 - Bootstrap | Authorized runner provisions/configures/deploys; owners independently verify their own hosts/data/brokers/identity while R7/R8 qualify native query/privacy intake and R9 live executor provenance | Approved actual resource/runtime roster, source-to-loaded-byte correspondence, working auth/routes/data and bounded controls; bootstrap stays NOT CERTIFIED |
| W3 - Golden slice | R1/R2 drive corrected Demo 01; R3 observes gateway, R4 APIs, R6 stores, R7 capture and R8 original privacy; R9 runs adapter/assertion/reset, independent R1/R7 verify | All required actual parent joins, emission/backend coverage, two cycles and interruption recovery, exact baseline restoration; then repeat by the documented commands |
| W4 - Expand | R2 Demo 02; R3 Demo 03; R4 Demos 04/05; R5 Demos 06-10; R6 Demo 12; R8 Demos 11/13; R7 Demo 14/workbook/classifier; R9 evidence intake | Each demo's own native assertions, actual terminal effects, UI/query outputs and run-owned reset; independent resource leases allow overlap, shared controls serialize |
| W5 - Operate | R7/R4 measure load/shutdown/loss and Demo 15; R8 verifies governance/rotation/retention and owners sign; R1 rehearses clone-to-demo/operator recovery | Measured agreed thresholds, zero unexplained required gaps, actual rollback/restore and accountable evidence; no simultaneous conflicting correctness/load run |
| W6 - Close | R9/R1/R7 independently reconcile exact facets and current reviews; execute bounded certification regression on frozen scope; optional P13 only after certification or in separately authorized isolation | Parent Needs edges close in topological order; all required clauses/gates/owners satisfied and reproducible packs retained, or explicit To Do/NOT CERTIFIED with next action |

Waves are release conditions, not global barriers: continue independent ready work while another lane waits. Do not wait for final certification to collect bootstrap evidence needed by GATE-08/GATE-13/DEM-00; do not call bootstrap certification. Preparation of optional evaluations may overlap only without competing for the golden-path writers/resources; their native runs never waive baseline requirements.

### Evidence receipts and Done Done

For every parent, R9 expands the existing exact clause map into `card / clause / required facet` rows; every child references its parent clauses plus its own measurable exit. An owner supplies evidence, not their own acceptance. Use existing manifests/receipts and register interfaces rather than a second status database.

| Facet | Evidence that can satisfy it | Evidence that cannot substitute |
|---|---|---|
| static | Actual scanner/compiler/config-export output against named current inputs, with seeded forbidden cases where required | A source hash or review vote alone |
| unit | Executed focused positives and negative assertions with command, runtime, counts and stable before/after source closure | A printed PASS, skipped required tests or a copied prior run |
| documentation | Delivered/rendered artifact and independently checked links/claims; actual rehearsal/clone commands where the clause requires them | A template, screenshot slot or future-tense runbook |
| live | Independently authorized and enrolled original source, actual executed query/wire/SDK observations with locators and exact runtime/target/window correspondence | Fixture rows, expected topology, caller JSON/flags, resource configuration alone or composite evidence from incompatible epochs |
| signoff | The named accountable owner's actual scoped decision on current evidence, with date and unresolved conditions | An agent reviewer acting as an organizational owner |

Each evidence handoff records the executed command/inputs, actual start/end and runtime/process identity, immutable source and artifact hashes, target/resource scope, original query/carrier/native locators, measured versus expected values, positive/negative outcomes, and reset/cleanup result as applicable. Preserve original evidence bytes and failed runs. Scan original columns before persisting only approved safe projections; never retain secrets, raw tokens, bodies, SQL parameters or cache keys/values as proof. Unknown counts and missing rows remain unknown/failures, not zero.

**Done Done is the existing Done status, not a weaker new column.** R9 proposes it only when:

1. Every own acceptance clause and every required facet has current passing evidence of the allowed kind, and each required child exit is independently verified. Each actual native edge/terminal effect is asserted, not inferred from a clean diagram.
2. Every parent Needs dependency is Done; construction progress alone never satisfies completion. Cross-card evidence reuse names the exact clauses it proves without claiming broader scope.
3. Two independent other-role reviews cover the complete current source scope and execution findings. Required seeded controls fail in the expected way; required tests are neither skipped nor cancelled.
4. The merged source, built packages, installed/loaded runtime, actual configuration and observed evidence agree for the declared scope. Changed dependencies/runtime/agent/policies/schema invalidate affected facets and trigger scoped reruns, not receipt rehashing.
5. A demo's real native run/capture/assert/reset and required repeated/interrupted recovery pass; deployment repeatability, global privacy, retention/load and owner signoffs are supplied wherever its own clauses require them. Local H2/RESP/loopback success remains a separately labelled construction fact.
6. Current privacy/safety/naming and applicable gates pass, original evidence/manifests verify, run-owned state is restored, and every unexplained required gap is resolved. Optional/deferred scope is disclosed, not counted as Done.
7. The single board writer links the exact evidence and runs `npm run board:check` and the relevant gates. Until the actual live executor enrollment/verification exists, keep live clauses and cards To Do even if JSON or reviewer opinions say PASS.

Report measured progress as current passing versus required facets, qualified actual edges, repeatable native demos and independently closed cards. Do not substitute lines changed, agent count, votes or local test totals for delivery. If a distinct attempted path still fails, report its evidence and next executable action; do not spin a review/status loop.

## Avoid doing (25)

Never built, in any lane, even behind a flag. Not counted in the backlog or the Kano ratio.

| # | Don't | Source | Caught by |
|---:|---|---|---|
| AV-01 | Rewrite the `traceparent` sampled flag from `-00` to `-01`, anywhere, even behind a flag | Prompt §5.4, §6 · Brief §3, D05 | GATE-01 |
| AV-02 | Build a `traceparent` or trace-id from APIM `context.RequestId` | Prompt §5.4 · Brief §3, D06 | GATE-01, GATE-10 |
| AV-03 | Leave the Storefront on the SDK default `AI_AND_W3C`, or APIM on Legacy/None correlation | Prompt §4 · Brief §20 · reference pattern §2 | GATE-01 |
| AV-04 | Treat a shared GUID copied into logs as a trace | Prompt §5.1 · Brief P1 | GATE-08 |
| AV-05 | Add a second OpenTelemetry SDK, TracerProvider or exporter to a JVM (even just for manual spans), or attach the agent twice | Prompt §5.3 · Brief §6, §20 | GATE-02 |
| AV-06 | Hand-parse `traceparent` in application code for log correlation | Brief §6 | JVM-02 |
| AV-07 | Put the Application Insights connection string, keys or tokens in source, parameters, plain app settings or evidence | Prompt §5.8 | GATE-03 |
| AV-08 | Capture APIM request or response bodies, or log Authorization headers, cookies or tokens | Prompt §5.8 · Brief §7 | GATE-04 |
| AV-09 | Capture SQL literals or parameters, or Redis keys, values, scripts or arguments | Prompt §5.7 · Brief §9 | GATE-04 |
| AV-10 | Present JDBC or Redis client spans as PostgreSQL or Redis server-side continuation | Prompt §5.7 · Brief §3 | GATE-08, DAT-01 |
| AV-11 | Accept an untrusted caller's business ID, encode customer or order data in it, or use it as an auth credential or metric dimension | Prompt §5.5 · Brief §11 | GATE-10, JVM-04 |
| AV-12 | Use Entra request/correlation IDs, a CloudEvent `id`, a MessageId or the APIM request ID as a trace-id | Prompt §5.9 · Brief §20 | GATE-10 |
| AV-13 | Reuse a span-id across retries, or continue an old parent on replay as if it were still active | Prompt §5.6 · Brief §20 | GATE-09 |
| AV-14 | Make one arbitrary input, or the first message in a batch, the parent for fan-in or batches; allow unbounded links | Prompt §5.6 · Brief §8, §20 | GATE-09 |
| AV-15 | Carry forward removed claims: .NET Service Bus 7.13.0, `Azure.Experimental.EnableActivitySource`, "classic adaptive sampling" for Java, APIM native OTLP | Prompt §2 · Brief §21 | GATE-07 |
| AV-16 | Provision Azure Cache for Redis for the new cache | Prompt §2, §5.11 | GATE-07 |
| AV-17 | Put Azure Monitor Traces / Trace Analytics or a non-GA OTLP path on the certification path | Prompt §2, §5.11 | GATE-07 |
| AV-18 | Leave 100% sampling on outside the bounded certification window, or promise 100% reconstructability in production | Prompt §5.10 · Brief §12 | GATE-12 |
| AV-19 | Invent product versions, API versions, SKU capabilities, GA dates or support-matrix entries | Prompt §2 | GATE-06 |
| AV-20 | Write code that papers over a documented-versus-observed gap, or certify on mocked telemetry | Prompt §2 | GATE-13 |
| AV-21 | Use instance IDs as role names | Prompt §3 · Brief §6 | GATE-11 |
| AV-22 | Use the reference pattern's `x-business-correlation-id` / `business.correlation_id` names instead of prompt §3's `x-business-invocation-id` / `business.invocation_id` | Prompt §3 (source of record) | GATE-11, GOV-01 |
| AV-23 | Send trace or business headers to CDN, analytics, identity or other third-party domains | Brief §5 | WEB-02 |
| AV-24 | Settle a disputed claim by majority vote | Prompt §1 | GOV-01 |
| AV-25 | Keep competing versions of the same artifact after the merge | Prompt §1 step 4 | Definition of Done |

## To Do (78)

### R1: 10 cards

- [ ] **#2 GATE-07 · Removed-claims and preview-isolation lint**
  Dissatisfier · logical R1 · CD3 82.0 · 0.5 d · needs none
  - Phase: returned; scope: construction.
  - Next action: Run live deployment what-if for evaluation isolation and obtain two code reviews; the static guard and seeded tests pass locally.
  - Waiting on: Complete root infrastructure; Live what-if evidence; Two accepted code reviews
  - [ ] Fails on any requirement or dependency on .NET Service Bus 7.13.0, `Azure.Experimental.EnableActivitySource`, "classic adaptive sampling" for Java, APIM native OTLP, or an Azure Cache for Redis resource.
  - [ ] A certification dependency manifest lists every component on the certification path with its GA or preview status and source; the lint fails on any preview entry, including Azure Monitor Traces / Trace Analytics and any OTLP ingestion path not confirmed GA for the target region.
  - [ ] Contoso Eval A/B code and parameters sit in isolated folders the certification deployment never references; a deployment what-if proves it.
  - [ ] A seeded fixture for each forbidden item makes the lint fail.

- [ ] **#4 GATE-11 · Deployability and naming-conformance gate**
  Dissatisfier · logical R1 · CD3 53.0 · 1 d · needs none
  - Phase: unstarted-at-threshold-stop-all-leases-released; scope: construction.
  - Next action: R1 closeout is inspection only with zero files/tests/builds and all leases released; no technical blocker was established. GATE-11.1 and other source children remain unimplemented at STOP. Resume only after an authorized reopened frontier; native deployment/what-if/teardown remains separately unmet.
  - Waiting on: Static entry-point implementation and current R3/R8 evidence were not produced before threshold STOP; Native deployment/what-if/teardown and all accountable completion remain separately unmet
  - Completion remains unmet: Empty-group deployment and second-run what-if; Availability/quotas/cost and provisioning authorization; Teardown/redeploy evidence; Two accepted source reviews
  - [ ] `azd up` (or the documented equivalent) deploys the full topology into an empty resource group with no manual steps beyond the README prerequisites; a second run shows no changes in what-if. No shipped script or test depends on a particular operator's machine: tool locations come from the repository or a documented prerequisite variable.
  - [ ] A naming lint checks the frozen logical-to-physical map: use the `contoso-corr-poc-` prefix where legal, documented storage/Key Vault/global-name and fixed-child exceptions, and an availability-checked discriminator where required. Every `service.name` and cloud role name still equals its §3 identifier: `contoso-storefront-spa`, `contoso-portal-ssr`, `contoso-orders-api`, `contoso-inventory-api`, `contoso-fulfillment-worker`, `contoso-notify-worker`, `contoso-order-aggregator`. The provider rejects a Service Bus namespace ending in `-sb`; its approved legal physical alias must be frozen.
  - [ ] Fails on instance IDs in role names (they belong only in `service.instance.id`) and on the reference pattern's header names (`x-business-correlation-id`, `business.correlation_id`).
  - [ ] Teardown and redeploy reproduce the same names.

  #### Child tasks

    - [ ] **GATE-11.1 - Add the root azd entry point beside `infra\`**
      - Executor: R1.
      - Prerequisites: The existing `infra\main.bicep`, `infra\params\poc.bicepparam` and the package outputs of `tools\Prepare-DeploymentPackages.ps1`. No Azure access is required for the static check.
      - Deliverable: One `azure.yaml` at the project root beside `infra\`, naming the Bicep infrastructure path and parameter file and every deployable app in `infra\main.bicep` with its packaging step, without a second deployment definition.
      - Acceptance: A static test fails when a service project path, packaging script, infrastructure path or parameter file named in `azure.yaml` does not exist, when a deployable app in `infra\main.bicep` is missing from it, or when it embeds a secret or connection string (GATE-03 scope); its commands match the README and runbook. Provisioning an empty group, the no-change second what-if and teardown/redeploy remain the native facets of clauses 1 and 4 and are not claimed here.

    - [ ] **GATE-11.2 - Reject machine-specific tool and user paths in shipped files**
      - Executor: R1.
      - Prerequisites: GATE-05.1, DAT-01.2, GATE-13.1, IDN-01.2 and INF-06.1, each of which removes one existing violation.
      - Deliverable: One static lint over shipped scripts, tools, tests and documents that fails on an absolute user-profile, `.copilot\session-state` or fixed drive-letter tool path used as a default. Preserved evidence, receipt and source-freeze files record historical paths and are explicitly out of scope.
      - Acceptance: The lint passes on the cleaned tree and fails for a seeded fixture of each violation class (PowerShell default parameter, Node default constant and test constant), naming the file and line. `npm test` runs it, and the documented prerequisite variables (`CONTOSO_PORTABLE_TOOLS_ROOT`, `CONTOSO_BICEP_PATH`, `CONTOSO_AGENT_JAR`, `CONTOSO_PARENT_SAFE_JAR`) are listed once in the README prerequisites.
    - GATE-11.1: **To Do — construction-only / NOT CERTIFIED**. Unimplemented at threshold STOP: R1 performed inspection only, changed no files and ran no tests. After an authorized reopened frontier, implement azure.yaml matching existing main/params/package inventory, run missing-path/service/secret negatives, then obtain R3/R8 reviews.
      Waiting on: Implementation did not begin before threshold STOP; no technical blocker or acceptance receipt was established
    - GATE-11.2: **To Do — construction-only / NOT CERTIFIED**. Complete GATE-13.1, then deliver the shipped-path lint with all three seeded violation classes and documented portable prerequisites when the implementation frontier permits.
      Waiting on: GATE-13.1 remains To Do; No current R1 lint packet was delivered before the below-four dispatch stop

- [ ] **#18 ADR-01 · ADRs A01-A03: causality, business ID, trust policy**
  Satisfier · logical R1 · CD3 48.0 · 1 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] DECISIONS.md holds signed ADRs A01, A02 and A03 with context, decision, consequences and Brief references.
  - [ ] A01 names W3C `traceparent`/`tracestate` and span links as the only technical-causality mechanism.
  - [ ] A02 defines when `business.invocation_id` is used, its format (UUIDv4 or ULID), the trusted edge, retention, privacy and cardinality controls, and whether the response header is exposed.
  - [ ] A03 gives testable rules for valid, absent, invalid and oversized context, deliberate trust-boundary breaks and safe hashing of rejected values, precise enough to write the Demo 03 and Demo 11 assertions.

- [ ] **#19 ARC-01 · Expected correlation boundary map**
  Satisfier · logical R1 · CD3 68.0 · 0.5 d · needs ADR-01
  - Phase: map-extension-required-for-store-boundaries; scope: construction.
  - Next action: Extend contracts\expected-boundary-map.v1.json, the single source, with the CLIENT boundaries the shipped wrapper already emits for the Orders workflow/outbox store and each worker messaging store (local H2 captures show contoso.pg.transaction and contoso.pg.select under the Orders request, producer and PROCESS spans). Regenerate docs\ARCHITECTURE.md, the workbook and KQL bindings and add boundary tests; keep no second map copy. This work is child ARC-01.1; GATE-08.1, DOC-01.1, DEM-12.1 and DEM-14.1 depend on it.
  - Waiting on: R1 boundary-map change with regenerated architecture, workbook and KQL bindings; Two accepted current source reviews; Native spans for the new boundaries (DAT-01 and DEM-12 live facets)
  - [ ] Lists every hop with its expected span kind and edge type (parent or link) across the sync path, the SSR path, each transport, each worker, the Aggregator and replay, plus every tier's data-store CLIENT operation (Inventory PostgreSQL and Redis, the Orders workflow/outbox store and each worker's messaging store), so no span emitted by the Contoso correlation wrapper lacks a declared boundary; auto-instrumented identity HTTP dependencies stay governed by the map's identity-client constraint.
  - [ ] Lists every API origin the Storefront calls and every SSR hop, and marks each deliberate new-root point with its ADR A03 rule.
  - [ ] GATE-08 (Invariant C), the orphan-candidate query, Demo 02 and the Mermaid diagram all read this one file; no second copy exists.

  #### Child tasks

    - [ ] **ARC-01.1 - Declare the Orders workflow and worker store boundaries in the single map**
      - Executor: R1.
      - Prerequisites: ADR-01 decisions and the existing `contracts\expected-boundary-map.v1.json` with its consumers (diagram generator, orphan-query inputs, workbook and GATE-08).
      - Deliverable: One edit of the single boundary map that declares the PostgreSQL CLIENT boundary of the Orders workflow/outbox store and of the Fulfillment, Notify and Aggregator messaging stores, each with its role name, parent edge and ADR A03 rule, plus the regenerated generated artifacts; no second map or consumer-side copy.
      - Acceptance: A source-derived test lists every role whose Java sources call `PgOperations.execute`, the path that emits `contoso.pg.*` CLIENT spans, and fails when a role has no declared store boundary; removing one declared boundary fails naming the missing edge. Inventory's `postgres.logical` and `redis.logical` entries, the identity-client constraint and every existing edge are unchanged, and the diagram check still passes. This declares expectation only; native spans stay with DAT-01 clause 1 and DEM-12 clause 1.
    - ARC-01.1: **To Do — construction-only / NOT CERTIFIED**. Deliver a source-derived completeness check and single-map declarations for every Orders/worker PostgreSQL CLIENT boundary, then obtain R3/R8 reviews without changing ranked acceptance.
      Waiting on: R1 has not delivered a frozen exact child-exit packet; Fresh implementation dispatch stopped below four distinct ready owners

- [ ] **#20 ADR-02 · ADRs A04-A06: export baseline, telemetry topology, cache**
  Satisfier · logical R1 · CD3 66.0 · 0.5 d · needs ADR-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] A04 picks direct Azure Monitor export as the baseline, compares the Collector and third-party options, and lists the documented triggers that would justify Contoso Eval A.
  - [ ] A05 fixes one workspace-based Application Insights resource for `contoso-corr` / `poc` on the shared Log Analytics workspace, with a naming, RBAC and retention map.
  - [ ] A06 selects Azure Managed Redis, cites the Azure Cache for Redis retirement dates (Basic/Standard/Premium 30 Sep 2028; Enterprise and Enterprise Flash 30 Mar 2027) and marks the target SKU and region `VERIFY:`.

- [ ] **#40 DOC-01 · Architecture diagram (Mermaid)**
  Satisfier · logical R1 · CD3 32.0 · 0.5 d · needs ARC-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Shows every §3 component by its Contoso name and tier role (including the role the Orders API plays between the front end and its downstream services), the trust boundaries and the deliberate new roots.
  - [ ] Sync parent edges and async link edges are visually distinct.
  - [ ] Generated from, or checked against, the boundary map, and renders on GitHub.

  #### Child tasks

    - [ ] **DOC-01.1 - Label tier roles and generate the hop-by-hop table from the boundary map**
      - Executor: R1.
      - Prerequisites: ARC-01.1 and the existing diagram generator (`tools\architecture.mjs`) and diagram check.
      - Deliverable: One `docs\ARCHITECTURE.md` update that labels each component's tier role (browser, SSR portal, edge gateway, orchestrating backend-for-frontend, downstream microservice, data store, async worker), states which role the Orders API plays because the repository never names a backend-for-frontend, and adds a hop-by-hop table (caller, carrier, span kind, parent or link, store boundary) generated from the single boundary map. Tier labels are keyed by the map's role names.
      - Acceptance: A drift test fails when the table or a tier label disagrees with the map, when a component lacks exactly one tier label or when a store boundary declared by ARC-01.1 is missing. The diagram still renders on GitHub with sync parent edges and async link edges visually distinct.
    - DOC-01.1: **To Do — construction-only / NOT CERTIFIED**. After ARC-01.1 is Done, generate tier-role labels and hop table from that single map and independently execute the drift negatives.
      Waiting on: ARC-01.1; No R1 documentation packet was dispatched below the four-owner threshold

- [ ] **#52 DEM-01 · Contoso Demo 01: Synchronous golden path**
  Satisfier · logical R1 · CD3 45.0 · 1 d · needs GATE-08, API-01, DAT-01, DAT-02, DEM-00, JVM-02, JVM-04, WEB-02
  - Phase: routing-fixture-qualified-native-blocked; scope: construction.
  - Next action: The advertised Demo 01 action, browser driver, telemetry scope and refresh path now use order submission. R1 passed 28 focused fixtures; R2 independently passed 16 on the same frozen source/output epoch. Do not repeat this completed construction packet or count it as Java/data/APIM proof. Next obtain reviewed real-store preparation/collector/adapter and separately approved native source/target/window, then execute full parentage and repeated/reset acceptance. The optional laptop-only LOCAL REHEARSAL entry point is child DEM-01.2 (after JVM-01.1, WEB-01.1 and OBS-02.2) and satisfies no live facet.
  - Waiting on: Reviewed concrete DAT-01.1, OBS-02.1 and DEM-00.1 native operation handoffs; Actual independently authorized deployed source/target/identity and bounded native execution window; Complete current independent source reviews and all parent completion dependencies
  - Completion remains unmet: All DEM-01 completion dependencies and current independent source reviews; Actual deployed browser/Gateway/backend/PG/Redis parentage and safe native evidence; Concrete adapter, repeated run/reset, native privacy and accountable acceptance
  - [ ] `demos\01\Run.ps1` drives Storefront → Gateway → Orders → Inventory → PostgreSQL + Redis with a known business ID.
  - [ ] GATE-08 passes: one trace-id/OperationId on all rows, unique non-zero span-ids, each child ParentId equals its parent's Id; logs carry the same IDs.
  - [ ] The live show finds the expected nodes in Application Map and the expected graph in Transaction Diagnostics.
  - [ ] Assertion, evidence pack and reset run through DEM-00 using the shipped Demo 01 adapter (DEM-00.1), and the demo fits 3-5 minutes.

  #### Child tasks

    - [ ] **DEM-01.1 - Correct the advertised Demo 01 UI route and prove downstream execution**
      - Executor: R1.
      - Prerequisites: Reviewed WEB-01/WEB-02 browser, Gateway order-route and JVM-04 API contracts, plus the existing two-JVM data fixtures for the construction regression; this does not depend on parent DEM-00 being Done.
      - Deliverable: One Demo 01 action-routing correction with a browser-to-Orders/Inventory integration regression.
      - Acceptance: Click the actual Demo 01 Run demo control and observe the order-submission route, the real Orders -> Inventory HTTP call, Inventory SERVER span and its Redis/JDBC logical CLIENT children in the same trace. The regression fails if the action only stages `/demo-runs`, bypasses Inventory, omits either data boundary or reuses unrelated telemetry. Preserve other demo routes. H2/RESP may prove the local routing construction but must be labelled as substitutes; OBS-02.1 separately qualifies the deployed Gateway and real stores using DAT-01.1 preparation.

    - [ ] **DEM-01.2 - Add the one-command local rehearsal entry point**
      - Executor: R1.
      - Prerequisites: JVM-01.1, WEB-01.1 and OBS-02.2, and the documented local prerequisites (JDK, Node, browser dependency, pinned agent and sampler).
      - Deliverable: One `tools\Rehearse-Demo01.ps1` that starts the local Orders and Inventory pair, runs the browser rehearsal, prints the merged trace tree with the Invariant A, B and C result under the local-rehearsal profile, and stops everything it started.
      - Acceptance: From a fresh clone with only the documented prerequisites it prints one tree containing the browser dependency, Orders, Inventory and both store CLIENT spans for one business ID. It exits non-zero with an explicit message when a prerequisite is missing or any rehearsal hop is absent, and leaves no process, port or tracked-file change. Its output states LOCAL REHEARSAL: not APIM, Entra, Azure or certification evidence. The README quick start links it as a laptop preview and never as a substitute for `demos\01\Run.ps1`.
    - DEM-01.1: **To Do — construction-only / NOT CERTIFIED**. Run the advertised real UI action over the approved Gateway/Orders/Inventory/both-store path with actual emitted joins; local browser substitutes must remain explicitly local.
      Waiting on: Actual approved full-chain target/auth/store/reset inputs; Native browser/Gateway/API/data observations; browser-only rehearsal is not this exit
    - DEM-01.2: **To Do — construction-only / NOT CERTIFIED**. After all three local prerequisites are independently Done, deliver and actually reproduce the one-command LOCAL REHEARSAL without APIM/Azure/certification claims.
      Waiting on: JVM-01.1; WEB-01.1; OBS-02.2; No new R1 rehearsal parent was dispatched below threshold

- [ ] **#59 DOC-02 · README quick start**
  Satisfier · logical R1 · CD3 32.0 · 0.5 d · needs DEM-01, INF-04, INF-05, INF-06
  - Phase: child-task-planned; scope: construction.
  - Next action: Complete DOC-02.1 after DEM-00.2 and GATE-11.2: align quick-start, runbook, demo and planning commands with shipped Windows wrappers using the default PowerShell execution policy form, regenerate the Kanban and obtain a second-engineer clone-to-two-cycle/reset result. Machine-specific tools-root defaults are removed by GATE-05.1, DAT-01.2, GATE-13.1, IDN-01.2 and INF-06.1 and enforced by the GATE-11.2 lint; the repository-map classification is child DOC-02.2. Planning alone grants no native traffic or certification.
  - Waiting on: DEM-00.2 verified consecutive native runs and interrupted-run recovery; Reviewed shipped entrypoints and DOC-03 recovery contract; GATE-11.2 passing (no machine-specific tool paths) and an execution-policy-safe command form
  - [ ] Lists prerequisites (tools, Azure roles, quotas, region) and the steps from clone to `azd up` to a passing Demo 01.
  - [ ] Links the VERIFY register and lists the open items.
  - [ ] Includes a repository map that matches §4 and classifies each top-level directory as reference implementation, verification and governance tooling, evidence or documentation, so the product under demonstration is separable from its verification machinery.

  #### Child tasks

    - [ ] **DOC-02.1 - Align and verify the shipped Windows run/reset commands**
      - Executor: R1.
      - Prerequisites: DEM-00.2 and GATE-11.2, the shipped PowerShell/package entrypoints and the reviewed DOC-03 runbook/recovery contract.
      - Deliverable: One consistent Windows command set across the quick start, runbook, demo instructions and source planning criteria, with the Kanban regenerated from that source.
      - Acceptance: Replace obsolete `run.sh`/`reset.sh` examples with the actual `Run.ps1`/`Reset.ps1` entrypoints and documented working directory, arguments, reviewed adapter/hash selection and approved deployment equivalent. A second engineer follows the commands from a fresh clone with declared approved prerequisites and reproduces the passing two-cycle/reset result without writing an adapter or undocumented manual repairs. Missing configuration fails explicitly. The documented commands run under the default PowerShell execution policy (an explicit `-ExecutionPolicy Bypass -File` form or signed scripts) and, with GATE-11.2 passing, no shipped script or test depends on another operator's machine. Do not imply that the microsite executes demos, or that these commands authorize native traffic or certification.

    - [ ] **DOC-02.2 - Classify every top-level directory in the repository map**
      - Executor: R1.
      - Prerequisites: None.
      - Deliverable: One README repository-map update that classifies each top-level directory of `contoso-corr-poc\` as reference implementation (for example `web`, `services`, `workers`, `apim`, `infra`, `kql` and `workbooks`), verification and governance tooling (for example `tools`, `tests`, `contracts` and `config`), evidence, documentation or demo wrapper, or build output, with a start-here pointer to the Orders to Inventory source path.
      - Acceptance: A test fails when a top-level directory is absent from the map, has more than one classification, or is named by the map but does not exist. The section states that verification code is not the product under demonstration and claims no certification or native execution.
    - DOC-02.1: **To Do — construction-only / NOT CERTIFIED**. After DEM-00.2 and GATE-11.2, have another engineer reproduce the shipped Windows run/reset/recovery commands without hidden repairs.
      Waiting on: DEM-00.2; GATE-11.2; Actual independent reproduction and baseline restoration, not a future-tense runbook
    - DOC-02.2: **To Do — construction-only / NOT CERTIFIED**. Deliver the tested README classification of every top-level directory when a future eligible frontier can execute the R1 packet.
      Waiting on: R1 has not delivered an independently reviewed directory-map exit; New implementation dispatch stopped below threshold

- [ ] **#71 DOC-03 · DEMO_RUNBOOK.md: operations**
  Satisfier · logical R1 · CD3 18.0 · 1 d · needs DEM-00
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] A pre-show checklist covers the certification window, sampling state, seed data and a baseline check.
  - [ ] Gives the demo order with a 3-5 minute budget and the reset steps for each demo.
  - [ ] Gives recovery steps for a demo that fails mid-show.

- [ ] **#74 DOC-04 · Presenter talk track for Demos 01-15**
  Delighter · logical R1 · CD3 9.3 · 1.5 d · needs DOC-03
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] For each demo: the claim proven (Brief §), what to click in Application Map and Transaction Diagnostics, which evidence to point at, and what the demo rules out.
  - [ ] Two likely audience questions per demo, with answers grounded in the Brief.
  - [ ] A timed dry run keeps each segment within 3-5 minutes.

### R2: 4 cards

- [ ] **#36 WEB-01 · Contoso Storefront SPA instrumentation**
  Satisfier · logical R2 · CD3 22.7 · 1.5 d · needs INF-01
  - Phase: fresh-local-browser-parent-join-construction; scope: construction.
  - Next action: Final v3 fixes the real Run-demo control, immutable input declaration and preflight/cleanup handling. Both R3/R7 executed twelve current Chromium controls; actual JVM pair/ingress/emitted-parent join and native WEB-01 remain unmet.
  - Waiting on: JVM-01.1 and actual current browser/JVM parent-join execution; Approved deployed Entra/browser/Gateway/SSR/full native acceptance
  - Completion remains unmet: INF-01 completion; Approved deployed runtime/Entra and live Application Insights rows; Two accepted current source reviews
  - Construction evidence: [R3 final immutable Run-demo source/Chromium 12/12](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R3/review-r2-web01-v3-20261102-56a48b43/review.json) (SOURCE_UNIT_ONLY_NOT_CHILD_EXIT / NOT CERTIFIED).
  - Construction evidence: [R7 final immutable Run-demo source/Chromium 12/12](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R7/web-01.1-review-v3/review.json) (SOURCE_UNIT_ONLY_NOT_CHILD_EXIT / NOT CERTIFIED).
  - [ ] The SDK version is pinned in the lockfile and in VERSIONS.md (`VERIFY:`); the connection string is injected at deploy time.
  - [ ] `distributedTracingMode` is W3C and the SDK initializes before the first network call; a browser network capture shows a valid `traceparent` on the first call to the Gateway.
  - [ ] Route changes produce page views, and each order action produces an AJAX dependency whose Id is the Gateway request's ParentId.
  - [ ] All Storefront telemetry carries role name `contoso-storefront-spa`.

  #### Child tasks

    - [ ] **WEB-01.1 - Add a local browser rehearsal driver through a pass-through forwarder**
      - Executor: R2.
      - Prerequisites: JVM-01.1 for the local Orders and Inventory pair, the built Storefront with its fixture identity adapter and the existing browser test setup.
      - Deliverable: One rehearsal driver that serves the built Storefront, routes its Gateway origin through a pass-through forwarder that adds no span and changes no trace header, clicks the real Demo 01 Run demo control and writes the browser dependency telemetry to a local capture file.
      - Acceptance: The captured AJAX dependency Id equals the ParentId of the Orders SERVER request and the `traceparent` Orders receives equals the one the browser sent, flags included. A forwarder that rewrites, drops or invents a header fails the assertion. The run is labelled LOCAL REHEARSAL: the forwarder is not APIM, the fixture identity is not Entra, and nothing here satisfies the Gateway-parent or native facets of WEB-01 clauses 2 and 3.
    - WEB-01.1: **To Do — construction-only / NOT CERTIFIED**. Final v3 has both R3/R7 twelve-test real-Chromium source reviews, immutable inputs and bounded cleanup. Execute the actual JVM-pair ingress/emitted-parent conjunction after JVM-01.1; the launcher was never implemented.
      Waiting on: JVM-01.1 independently complete and actual current browser-to-JVM ingress/emitted-span join

- [ ] **#39 WEB-02 · Correlation domains and CORS**
  Satisfier · logical R2 · CD3 34.0 · 1 d · needs ARC-01, INF-04, WEB-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] `enableCorsCorrelation` is on and `correlationHeaderDomains` lists only the Gateway origin; CDN, analytics, identity and other third-party domains are excluded.
  - [ ] An automated browser test proves `traceparent`, `tracestate` and `x-business-invocation-id` reach only approved origins; a call to an excluded domain carries none of them.
  - [ ] The Gateway CORS policy allows those headers on preflight for the Storefront origin only; preflight from any other origin is refused.

- [ ] **#60 WEB-03 · Contoso Portal SSR instrumentation**
  Satisfier · logical R2 · CD3 26.0 · 1 d · needs INF-03, INF-04
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Server requests and outbound calls appear under the stable role name `contoso-portal-ssr`.
  - [ ] Outbound calls to the Gateway carry a valid `traceparent` from the server span, and the Gateway continues it.
  - [ ] Where browser page telemetry and the server render form separate roots, the boundary map records it as expected.
  - [ ] The process runs exactly one telemetry provider.

- [ ] **#61 DEM-02 · Contoso Demo 02: Portal SSR path vs SPA path**
  Satisfier · logical R2 · CD3 32.0 · 0.5 d · needs ARC-01, DEM-00, WEB-01, WEB-03
  - Phase: fresh-fail-closed-spa-ssr-construction-inspector; scope: construction.
  - Next action: The previous eight-test R3/R7 reviews remain historical after their declared Demo01 dependency changed in the bounded correction. No runnable adapter exists; current-source inspection and actual SPA/SSR auth/query/sampling/reset/recovery remain unmet.
  - Waiting on: Current-source checks/reviews for the changed declared Demo01 dependency; historical receipts are not rehashed; Actual native auth/query/sampling/original-baseline/reset/durable-recovery operations
  - Construction evidence: [R3 Demo02 inspector eight controls (pre-correction epoch)](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R3/review-r2-demo02-20261102-c57297fa/review.json) (HISTORICAL_AFTER_DEMO01_DEPENDENCY_CORRECTION_NOT_CHILD_EXIT / NOT CERTIFIED).
  - Construction evidence: [R7 Demo02 inspector eight controls (pre-correction epoch)](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R7/dem-02.1-review-v1/review.json) (HISTORICAL_AFTER_DEMO01_DEPENDENCY_CORRECTION_NOT_CHILD_EXIT / NOT CERTIFIED).
  - [ ] SSR requests appear under the stable role name `contoso-portal-ssr`.
  - [ ] Separate roots between browser page telemetry and the server render are shown and explained from the boundary map.
  - [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-02.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

  #### Child tasks

    - [ ] **DEM-02.1 - Ship the Demo 02 Portal SSR versus SPA adapter**
      - Executor: R2.
      - Prerequisites: DEM-00.1 and the reviewed WEB-01 and WEB-03 contracts. Native execution additionally needs the approved deployed Storefront and Portal, the Portal controller authentication, the pinned Portal runtime image and a separately approved bounded native window.
      - Deliverable: One `tools\verification\adapters\demo02-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 02.
      - Acceptance: The shipped `demos\02\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It observes browser page telemetry under `contoso-storefront-spa` and the server render under `contoso-portal-ssr` as independently captured roots, asserts the SSR-to-Gateway parent join and explains the separate roots from the boundary map. Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset restores the run-owned baseline and leaves unowned state unchanged, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).
    - DEM-02.1: **To Do — construction-only / NOT CERTIFIED**. The earlier R3/R7 eight-test source reviews are historical after their declared Demo01 dependency changed in the bounded integration correction. No runnable adapter exists; current checks and actual native auth/query/sampling/original-baseline/reset/recovery remain required.
      Waiting on: Actual native SPA/SSR auth/query/sampling/original-baseline/reset/durable-recovery operations

### R3: 5 cards

- [ ] **#5 GATE-01 · Protocol-integrity static scan**
  Dissatisfier · logical R3 · CD3 53.0 · 1 d · needs none
  - Phase: fresh-source-xml-entity-negative-controls; scope: construction.
  - Next action: XML-entity bypass fixed; author/R2/R8 each executed 35 positive/negative tests against the same 25-source closure. Hosted CI and actual Gateway/wire/native acceptance remain To Do.
  - Waiting on: Actual hosted every-PR checks and separately approved deployed Gateway/logger/wire/privacy observations
  - Construction evidence: [R2 current source/unit 35/35](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R2/review-r3-gate01-20261102T165806181-5489d039-bf57-4d65-9eb0-f1e8a9b3fc57/execution.json) (construction-only / NOT CERTIFIED).
  - Construction evidence: [R8 current source/unit 35/35](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R8/r3-gate01-20261102T220900Z/review.json) (construction-only / NOT CERTIFIED).
  - [ ] Runs on every pull request over `apim/policies/`, `infra/`, `web/`, `services/` and `workers/`, and fails on: a trace-flags change from `-00` to `-01`; a `traceparent` or trace-id built from `context.RequestId`; an APIM diagnostic `httpCorrelationProtocol` other than `W3C`; a Storefront `distributedTracingMode` other than W3C (the SDK default `AI_AND_W3C` also fails).
  - [ ] Fails when the forbidden logic sits behind a feature flag, named value or disabled policy fragment.
    Evidence: [clause 2](../../contoso-corr-poc/evidence/reviews/code-r9.json) (unit, INVALIDATED).
  - [ ] Seeded fixtures in `tests/fixtures/` (excluded from every deployable path) make the scan fail; with them removed it passes.
    Evidence: [clause 3](../../contoso-corr-poc/evidence/reviews/code-r9.json) (unit, INVALIDATED).
  - [ ] Output is saved under `evidence/` and linked from the No falsification row of CERTIFICATION_REPORT.md.

- [ ] **#23 INF-04 · APIM IaC: Contoso Gateway, logger and W3C diagnostic**
  Satisfier · logical R3 · CD3 39.0 · 1 d · needs INF-01, INF-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] The logger points to `contoso-corr-poc-appi` through the Key Vault-backed named value (managed identity only if validated for the pinned API version: `VERIFY:`).
  - [ ] The diagnostic sets `httpCorrelationProtocol: W3C`, fixed sampling as a parameter (100 in certification), `alwaysLog: allErrors`, frontend and backend logged headers limited to `x-business-invocation-id`, and body bytes 0 (property shape `VERIFY:` against the pinned API version).
  - [ ] The diagnostic scope (all APIs or per API) is documented and the export shows no conflicting diagnostic at another scope.
  - [ ] The exported resource state and its API version are saved under `evidence/config/`; the GATE-01 and GATE-04 config checks pass against it.

- [ ] **#24 API-02 · Gateway business-ID and header policy**
  Satisfier · logical R3 · CD3 58.0 · 0.5 d · needs ADR-01, INF-04
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] `x-business-invocation-id` is the only business header forwarded; values that fail the ADR A02 length, charset or format rules, or that come from untrusted callers, are removed so the trusted edge issues a new one.
  - [ ] Duplicate header values are overwritten, never appended.
  - [ ] A policy test shows Authorization headers, cookies and tokens are never logged.

- [ ] **#25 API-01 · Gateway inbound-context policy**
  Satisfier · logical R3 · CD3 46.0 · 1 d · needs ADR-01, INF-04
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Policy does not manually rewrite a valid inbound carrier. The gateway request continues the inbound trace ID; its backend dependency advances parentage, and Orders ParentId equals that actual backend dependency Id. Assert ingress/outbound wire carriers and real gateway spans separately; never manufacture missing gateway rows.
  - [ ] Absent or malformed context (all-zero IDs, wrong length, forbidden version `ff`) gets a compliant root from supported tracing, never one built in policy or from `context.RequestId`. Higher versions follow verified forward-compatible parsing; invalid `tracestate` can be discarded independently. Any stricter restart is an explicit A03 trust boundary. Rejected raw values are never logged; a digest requires a reviewed safe-input/key policy.
  - [ ] An inbound `-00` flag is forwarded as `-00`.
  - [ ] Evidence for the valid, absent, invalid and `-00` cases is saved; any documented-versus-observed difference goes to the gap log.

- [ ] **#47 DEM-03 · Contoso Demo 03: Inbound context at the Gateway**
  Satisfier · logical R3 · CD3 52.0 · 0.5 d · needs GATE-01, API-01, DEM-00
  - Phase: scenario-adapter-required-native-blocked; scope: construction.
  - Next action: Ship Demo 03's own scenario adapter (DEM-03.1) against the reviewed shared DEM-00 adapter contract; the closing clause now forbids a stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback. Drive the valid, absent, invalid and -00 carriers through the deployed Gateway; apim\demo03-cases.v1.json holds carrier vectors only. Run.ps1 returned FAIL D_MISSING_ADAPTER at commit 7279cd3.
  - Waiting on: Reviewed DEM-00.1 shared adapter contract and Demo 01 native qualification; This demo's own reviewed scenario adapter; Approved deployed target, identities and a separately approved bounded native window
  - [ ] Four cases run: valid context is continued; absent and invalid context get a new compliant root; `-00` is forwarded unchanged.
  - [ ] The GATE-01 scan result is shown live: no rewrite, no RequestId conversion.
  - [ ] Negative control: GATE-01 run against the rewrite fixture fails, showing the guard firing.
  - [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-03.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

  #### Child tasks

    - [ ] **DEM-03.1 - Ship the Demo 03 Gateway inbound-context adapter**
      - Executor: R3.
      - Prerequisites: DEM-00.1 and the reviewed Demo 01 adapter pattern. Native execution additionally needs the approved deployed Gateway and a separately approved bounded native window.
      - Deliverable: One `tools\verification\adapters\demo03-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 03.
      - Acceptance: The shipped `demos\03\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It drives the valid, absent, invalid and `-00` carriers through the deployed Gateway (`apim\demo03-cases.v1.json` supplies carrier vectors only) and asserts continued context, compliant new roots for absent and invalid input, an unchanged `-00`, and the GATE-01 result with its rewrite-fixture negative control. Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset restores the run-owned baseline and leaves unowned state unchanged, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).
    - DEM-03.1: **To Do — construction-only / NOT CERTIFIED**. Retain the independently reviewed seven-test fail-closed inspector as source-only. Ship and run the actual four-carrier Gateway adapter only after real execution/query/sampling/reset/recovery operations exist.
      Waiting on: DEM-00.1; Approved deployed Gateway/controller/query/sampling/reset/durable-recovery operations; no createAdapter is exported

### R4: 10 cards

- [ ] **#6 GATE-02 · Single-provider-per-JVM check**
  Dissatisfier · logical R4 · CD3 53.0 · 1 d · needs none
  - Phase: finite-local-build-and-orders-evidence-accepted-full-runtime-and-owner-blocked; scope: construction.
  - Next action: Final-grant local sampler epoch is sealed with one actual sampler test and twelve safe Java contracts; its private-current witness/enrollment remains unverified. R4 released this packet to To Do and moved to Java CI construction.
  - Waiting on: Independently grounded current private-local witness/enrollment and two final-source exit reviews; Approved deployed provider/image/whole-runtime/native and accountable acceptance
  - Completion remains unmet: Actual per-JVM Azure startup/export/image/auth/schema evidence; Two current accepted source reviews; Native roster and full-path fidelity evidence
  - Construction evidence: [Sealed 168-source local build and classpath receipt](../../contoso-corr-poc/evidence/verification/linked-root-sampling/current-source/20261102T221357375Z-dbde0a8e-ce7c-46e6-98b2-6f00ce7613b2/source-build.json) (RECORDED_LOCAL_BUILD_ONLY_NOT_CURRENT_AUTHORITY / NOT CERTIFIED).
  - [ ] Runtime dependency/artifact scans of every Java build reject an additional OpenTelemetry SDK implementation, provider/global construction, classic Application Insights SDK, extra exporter or competing attachment. The explicitly approved hash-pinned Contoso sampler extension alone may compile against public sampler/autoconfigure-SPI APIs with `provided` scope resolved to the agent ABI; those classes/libraries are never packaged as a second runtime SDK. Its only customization wraps the supplied sampler, with loader/service/classloader/content and strict positive/unsampled proof. Unknown extensions or `setSampler`/provider-builder workarounds fail closed.
  - [ ] A startup-log assertion fails on a second agent load, a duplicate provider, a bytecode transformation error or an exporter rejection, including App Service built-in autoinstrumentation running alongside an explicit `-javaagent`.
  - [ ] A code scan fails on in-process SDK construction (`OpenTelemetrySdk.builder`, `SdkTracerProvider`); manual spans use `GlobalOpenTelemetry` only.
  - [ ] A seeded fixture with a second SDK makes both the dependency check and the startup check fail.
  - [ ] Per-JVM output is saved under `evidence/` and satisfies the §9 one-provider check.

  #### Child tasks

    - [ ] **GATE-02.1 - Re-qualify the Contoso sampler guard's unsampled and linked-root decisions on current sources**
      - Executor: R4.
      - Prerequisites: The pinned agent and the locked `contoso-parent-safe-sampler` artifact (`CONTOSO_AGENT_JAR`, `CONTOSO_PARENT_SAFE_JAR`), the existing `tools\verification\sampling-qualification.mjs` and the preserved historical receipts. No Azure access is required.
      - Deliverable: One new source-bound qualification receipt under `evidence\verification\linked-root-sampling\`, produced by the existing tool against the current sampler, provider and test sources. The historical failed `b81339...` receipt stays unchanged.
      - Acceptance: With the agent loaded, actual decisions show that a valid-parent `-00` request stays dropped, a declared no-parent root whose links are all valid and unsampled is dropped, and sampled/mixed-link and unlinked roots keep the delegate decision. The receipt binds current source hashes, the executed command and the runtime and agent identity; `npm run verify:report` moves the local sampling claim off UNVERIFIED only for that receipt, and a seeded guard change returns it to UNVERIFIED. The result is labelled local and never stands for native sampling, roster acknowledgement or full-path evidence.
    - GATE-02.1: **To Do — construction-only / NOT CERTIFIED**. R6/R9 each passed sixteen current source checks and verified the retained 168-source/152-class/96-JAR record. The current loader remains deliberately empty; independently grounded actual local execution enrollment is still required, not source-review votes.
      Waiting on: Independently grounded actual current local execution witness/enrollment; neither recorded-build consistency nor caller JSON supplies it

- [ ] **#13 GATE-05 · JDK 25 compatibility gate**
  Dissatisfier · logical R4 · CD3 30.0 · 2 d · needs none
  - Phase: fresh-every-pr-java-ci-skip-gate; scope: construction.
  - Next action: GATE-05.1 is independently Done for construction. Final CI v3 has both R6/R9 six-test approvals and independent cancellation-count closure; actual hosted full-reactor execution remains unrun and no JVM launcher was started.
  - Waiting on: Actual hosted full-reactor clean and seeded-negative PR execution; Actual deployed JDK/provider compatibility, approved runtime and accountable acceptance
  - Completion remains unmet: Current locked Java/agent/sampler executable prerequisites; Actual deployed JDK image and all provider/exporter paths; Two current other-role executed child reviews
  - Construction evidence: [R6 CI v3 six source/PowerShell controls](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R6/review-r4-gate-05.2-v3/execution/review.json) (CURRENT_SOURCE_UNIT_ONLY_NOT_HOSTED_CHILD_EXIT / NOT CERTIFIED).
  - Construction evidence: [R9 CI v3 six controls and cancellation-count review](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R9/gate-05-2-source-independent-v3/review.json) (CURRENT_SOURCE_UNIT_ONLY_NOT_HOSTED_CHILD_EXIT / NOT CERTIFIED).
  - [ ] Covers HTTP server, HTTP client, JDBC, the selected Redis client, logging MDC, each messaging SDK in use, shutdown flush and redeploy/restart on the exact JDK 25 image and agent version recorded in VERSIONS.md.
  - [ ] Each test compares emitted spans with an expected-span oracle (count, kind, parent); a service that starts but drops spans fails.
  - [ ] A seeded fixture with one instrumentation module disabled makes the gate fail.
  - [ ] CI blocks certification of any demo that exercises a Java service or worker until the gate passes on the deployed build.
  - [ ] Results are saved per service under `evidence/`.

  #### Child tasks

    - [x] **GATE-05.1 - Remove the session-folder default from the Java tooling scripts**
      - Executor: R4.
      - Prerequisites: The documented `CONTOSO_PORTABLE_TOOLS_ROOT` convention, or a repository-relative default that version control excludes.
      - Deliverable: One change across `tools\java\Use-Portable.ps1`, `Install-Portable.ps1`, `Install-Bicep.ps1`, `Get-Agent.ps1`, `Gate-05.ps1` and `Validate-Compute.ps1` that replaces each hard-coded `C:\Users\...\session-state\...` default with that convention.
      - Acceptance: Run without the variable, each script installs into the documented repository-relative root or stops with an explicit error naming the variable; with it set, the scripts behave as before and still verify the agent, JDK, Maven and Bicep hashes from `config\versions.lock.json`. A source test fails on any absolute user-profile or session-state path in these scripts.

    - [ ] **GATE-05.2 - Run the Java reactor on every pull request**
      - Executor: R4.
      - Prerequisites: GATE-05.1; a runner with the pinned JDK, the locked Maven version and the locked agent and sampler artifacts.
      - Deliverable: One workflow file, `.github\workflows\ci-java.yml`, that runs the full Maven reactor with the pinned agent and sampler supplied so the environment-gated tests execute.
      - Acceptance: The job prints executed and skipped totals. Any skipped or cancelled test whose gate requires the agent or sampler fails the job instead of passing silently (clause 4), and the existing seeded second-SDK and disabled-module fixtures fail as expected. Agent and sampler hashes must equal the lock. Success is source and unit evidence on that runner image and does not replace the deployed-build JDK 25 check.
    - GATE-05.1: **Done — construction-only / NOT CERTIFIED**. Six-script portable-root construction is independently complete on the exact current 12-input scope. Parent deployed JDK/provider compatibility and hosted CI remain To Do.
      Evidence: [R6 executed review](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R6/review-r4-gate-05.1-v1/execution/review.json).
      Evidence: [R9 executed review](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R9/gate-05-1-independent-v1/review.json).
    - GATE-05.2: **To Do — construction-only / NOT CERTIFIED**. Final v3 has both R6/R9 six-test source approvals and independent five-case cancellation-count closure. Actual hosted clean/seeded full-reactor PR execution is still required; source-only checks cannot complete this child.
      Waiting on: Actual hosted full-reactor clean and seeded-negative PR executions

- [ ] **#15 JVM-05 · VERSIONS.md, Java SBOM and agent pin**
  Satisfier · logical R4 · CD3 68.0 · 0.5 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] VERSIONS.md lists every SDK, agent, runtime, image and API version in use (browser SDK, APIM SKU and API version, App Service JDK 25 image, Java agent, frameworks and clients, messaging SDKs, Functions runtime and worker, resource API versions), each with an official source link.
  - [ ] A Java SBOM covers the HTTP, JDBC, Redis and messaging libraries of every service and worker.
  - [ ] The agent binary is pinned with its checksum and release/support evidence, and has a GATE-06 `VERIFY:` entry.
  - [ ] A change to any listed version triggers GATE-12 invalidation.

- [ ] **#26 INF-03 · Compute IaC: App Service on JDK 25 and Java Functions**
  Satisfier · logical R4 · CD3 34.0 · 1 d · needs INF-01, INF-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] App Service apps `contoso-orders-api` and `contoso-inventory-api` run the JDK 25 image recorded in VERSIONS.md (`VERIFY:` until confirmed); `contoso-portal-ssr` runs on its documented stack.
  - [ ] Function apps host `contoso-fulfillment-worker`, `contoso-notify-worker` and `contoso-order-aggregator` on the Java worker recorded in VERSIONS.md (`VERIFY:` JDK 25 support).
  - [ ] Every app has a managed identity and the Key Vault-referenced connection string, and sets its role name to its §3 identifier through the agent's supported setting (`VERIFY:` the setting for the pinned agent).
  - [ ] Each app has exactly one agent-attach mechanism (never built-in autoinstrumentation plus an explicit `-javaagent`).

- [ ] **#27 JVM-01 · Java service baseline: Orders API and Inventory API**
  Satisfier · logical R4 · CD3 35.3 · 1.5 d · needs INF-03, JVM-05
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Both services run on JDK 25 with the pinned agent attached exactly once through the supported App Service startup mechanism.
  - [ ] Role names equal `contoso-orders-api` and `contoso-inventory-api`; instance identity appears only in `service.instance.id`.
  - [ ] Startup logs show one agent, one provider and a working exporter (GATE-02 passes).
  - [ ] An Orders → Inventory call produces a client span in Orders and a server child span in Inventory whose ParentId matches.

  #### Child tasks

    - [ ] **JVM-01.1 - Add a local two-JVM launcher with the agent and a loopback receiver**
      - Executor: R4.
      - Prerequisites: The pinned agent and sampler artifacts verified against `config\versions.lock.json`, and the H2 (PostgreSQL mode), RESP and synthetic-token seams used by `NativeApiIntegrationTest`.
      - Deliverable: One launcher, `tools\java\Start-LocalPair.ps1`, that starts Inventory and Orders as separate JVMs, each with the agent attached once and the sampler extension loaded, plus a loopback telemetry receiver, and prints their local origins until stopped.
      - Acceptance: A request to Orders yields, in one captured trace, an Orders SERVER span, its outbound HTTP CLIENT span, an Inventory SERVER span parented to that client span and the Redis and JDBC logical CLIENT children. Startup logs show one agent and one provider per JVM (GATE-02 checks apply), and a launch with a missing or second agent, or a sampler artifact whose hash differs from the lock, fails before any traffic is accepted. Stopping the launcher ends both JVMs and the receiver and leaves no tracked file modified. The output labels the substitute stores and synthetic tokens, and no production validation path is relaxed.
    - JVM-01.1: **To Do — construction-only / NOT CERTIFIED**. In a future eligible frontier, implement and actually run the one-command loopback Orders/Inventory pair with locked agent/sampler, explicit ports/PIDs, remote export disabled and bounded cleanup.
      Waiting on: R4 confirms Start-LocalPair.ps1 was not implemented or started; No new JVM parent was dispatched after the threshold stop

- [ ] **#28 JVM-02 · Structured logging correlation (MDC)**
  Satisfier · logical R4 · CD3 52.0 · 0.5 d · needs JVM-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Logs carry trace-id and span-id from the instrumentation-supplied MDC fields, plus `business.invocation_id`; no code parses `traceparent` by hand.
  - [ ] A test matches each log line's IDs to the active span, including work handed to thread pools.
  - [ ] Logs contain no credentials, tokens, raw claims, query parameters, cache keys or bodies (GATE-04).

- [ ] **#32 JVM-04 · Trusted-edge business invocation ID and HTTP propagation**
  Satisfier · logical R4 · CD3 34.0 · 1 d · needs ADR-01, JVM-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Orders API accepts an inbound `x-business-invocation-id` only from a trusted caller and only if it matches the approved length, charset and namespace; otherwise it generates a new opaque UUIDv4 or ULID.
  - [ ] Property-based tests cover length, charset, namespace and trust cases.
  - [ ] The value is set on the active span and logs and sent to Inventory API as the allowlisted header; an integration test proves continuity without using the trace-id.
  - [ ] The ID is returned in a response header only if ADR A02 allows it.

- [ ] **#41 JVM-03 · Manual spans for uncovered business boundaries**
  Satisfier · logical R4 · CD3 32.0 · 0.5 d · needs JVM-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Manual spans (for example `orders.validate`) use `GlobalOpenTelemetry` from the agent.
  - [ ] Each records exceptions and error status and carries `business.invocation_id`.
  - [ ] Code review and a trace show no span duplicates an auto-instrumented one.

- [ ] **#48 DEM-04 · Contoso Demo 04: Trusted-edge business invocation ID**
  Satisfier · logical R4 · CD3 52.0 · 0.5 d · needs GATE-10, API-02, DEM-00, JVM-04, MSG-02, OBS-02
  - Phase: scenario-adapter-required-native-blocked; scope: construction.
  - Next action: Ship Demo 04's own scenario adapter (DEM-04.1) against the reviewed shared DEM-00 adapter contract; the closing clause now forbids a stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback. Exercise a trusted-issuer (Portal workload) ID versus an untrusted caller ID and the exact business lookup. Run.ps1 returned FAIL D_MISSING_ADAPTER at commit 7279cd3.
  - Waiting on: Reviewed DEM-00.1 shared adapter contract and Demo 01 native qualification; This demo's own reviewed scenario adapter; Approved deployed target, identities and a separately approved bounded native window
  - [ ] An untrusted or malformed ID is replaced; a trusted valid ID is accepted and carried over HTTP and Service Bus.
  - [ ] Business-lookup KQL returns every intended trace and nothing extra.
  - [ ] Negative control: an untrusted caller's ID is visibly rejected and replaced.
  - [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-04.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

  #### Child tasks

    - [ ] **DEM-04.1 - Ship the Demo 04 trusted-edge business-ID adapter**
      - Executor: R4.
      - Prerequisites: DEM-00.1 and the reviewed JVM-04, MSG-02 and OBS-02 contracts. Native execution additionally needs the approved deployed topology and a separately approved bounded native window.
      - Deliverable: One `tools\verification\adapters\demo04-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 04.
      - Acceptance: The shipped `demos\04\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It exercises a trusted-issuer (Portal workload) ID, an untrusted caller's ID and a malformed ID over HTTP and Service Bus, asserts the untrusted and malformed IDs are visibly replaced and the trusted ID is carried, and checks that the business-lookup query returns every intended trace and nothing extra. Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset restores the run-owned baseline and leaves unowned state unchanged, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).
    - DEM-04.1: **To Do — construction-only / NOT CERTIFIED**. After DEM-00.1, implement and run the trusted/untrusted/malformed business-ID cases across actual HTTP and Service Bus with preserved trust-boundary effects.
      Waiting on: DEM-00.1; Approved actual HTTP/broker identities, native operations and reset window

- [ ] **#69 DEM-05 · Contoso Demo 05: Error and timeout correlation**
  Satisfier · logical R4 · CD3 18.0 · 1 d · needs DAT-01, DEM-00, JVM-03
  - Phase: scenario-adapter-required-native-blocked; scope: construction.
  - Next action: Add the default-off Inventory fault switches (DEM-05.1), then ship Demo 05's own scenario adapter (DEM-05.2) against the reviewed shared DEM-00 adapter contract; the closing clause now forbids a stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback. The catalog requires an approved native Inventory-timeout and PostgreSQL-error injection; the data adapter ships no fault switch. Run.ps1 returned FAIL D_MISSING_ADAPTER at commit 7279cd3.
  - Waiting on: Reviewed DEM-00.1 shared adapter contract and Demo 01 native qualification; This demo's own reviewed scenario adapter and approved fault-injection mechanism; Approved deployed target, identities and a separately approved bounded native window
  - [ ] Feature flags inject an Inventory timeout and a PostgreSQL error.
  - [ ] Trace and business correlation hold; exceptions attach to the right span; APIM error telemetry appears (alwaysLog).
  - [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-05.2, using the DEM-05.1 fault switches: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

  #### Child tasks

    - [ ] **DEM-05.1 - Add default-off Inventory fault switches for Demo 05**
      - Executor: R4.
      - Prerequisites: The reviewed JVM-03 manual-span and DAT-01 data-adapter interfaces. No Azure access is required for the construction tests.
      - Deliverable: Two run-scoped, default-off fault switches in the Inventory API service layer, not the data adapter: an upstream timeout and a PostgreSQL-error outcome. Only a caller holding the demo/control role can set them, and the run's baseline restore clears them.
      - Acceptance: With both switches off, behaviour and telemetry equal the existing tests. Enabled, the Orders to Inventory call times out or fails as configured, exceptions attach to the correct span, and trace and business IDs persist. A caller without the demo/control role cannot enable a switch, no production configuration enables one, and a seeded always-on setting fails a test.

    - [ ] **DEM-05.2 - Ship the Demo 05 error and timeout adapter**
      - Executor: R4.
      - Prerequisites: DEM-00.1 and DEM-05.1. Native execution additionally needs the approved deployed topology and a separately approved bounded native window.
      - Deliverable: One `tools\verification\adapters\demo05-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations and the DEM-05.1 switches for Demo 05.
      - Acceptance: The shipped `demos\05\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It enables each switch through the control path, drives a timeout and a PostgreSQL-error invocation through the deployed Gateway, and asserts that trace and business correlation hold, exceptions attach to the right span and APIM error telemetry (alwaysLog) appears; reset turns both switches off and verifies the baseline. Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).
    - DEM-05.1: **To Do — construction-only / NOT CERTIFIED**. In a future eligible frontier, qualify the current default-off Inventory timeout/database-error controls and role-gated reset; no completed frozen source exit was delivered in this stopped epoch.
      Waiting on: R4 exact source/role/default-off/reset packet and two current reviews; No new fault-switch parent was dispatched below threshold
    - DEM-05.2: **To Do — construction-only / NOT CERTIFIED**. After DEM-00.1 and DEM-05.1, ship and run the real fault adapter and prove the switches are cleared after both normal and interrupted execution.
      Waiting on: DEM-00.1; DEM-05.1; Approved actual native runtime/control/reset operations

### R5: 15 cards

- [ ] **#7 GATE-09 · Async-honesty assertions**
  Dissatisfier · logical R5 · CD3 46.0 · 1 d · needs none
  - Phase: corrected-notify-v2-source-ready-review-wait; scope: construction.
  - Next action: Earned finite LOCAL both-actor replay/isolation gap closure: actualselected13/4JVMs/b08a plus BOTHoriginalR2d11b/R3106504 copied-consistency reviews and R9actualchecker01b4 on154records. Preserve originalSDK/nativeIDs/emptyPROCESSmessageId/directORIGINALPROCESS+SENDlinks and27fieldstate; no rolebackfill/independentDBquery/rawrescan/privatecap. Full43module notexecuted byselected13; remaining wholeDemo07/fullpath/broker/Functions/Azure/owner requirements stayToDo. Oldd324fail/40/ca28 unchanged.
  - Waiting on: Actual remaining full-role/fullpath/broker/Functions/Azure/owner completion facets
  - Completion remains unmet: Actual new Notify-role source/compile/native case and both-actor Demo07 receipts; Approved native brokers/worker hosts and all completion edges; Real retry/DLQ/replay/fan-in/batch exported records; Two accepted current reviews
  - [ ] Asserts each delivery attempt has its own PROCESS span with a new span-id and an attempt or delivery-count attribute.
  - [ ] Asserts replay either links to the original context or starts a new trace linked to it, with `business.invocation_id` unchanged, and never continues an old parent as if it were active.
  - [ ] Asserts the Aggregator span has at most one parent plus links to every contributor, batch processing never makes the first message the parent, and link counts stay within the configured bound.
  - [ ] A fixture for each anti-pattern (span-id reuse, old-parent continuation, single-parent fan-in, first-message parent, unbounded links) makes it fail.
  - [ ] Called by Demos 06-10 and linked from the Async honesty row.

- [ ] **#29 INF-06 · Messaging IaC: Service Bus, Event Grid, Event Hubs, Storage Queue**
  Satisfier · logical R5 · CD3 34.0 · 1 d · needs INF-03
  - Phase: fresh-compiler-resolution-and-skip-controls; scope: construction.
  - Next action: INF-06.1 is construction Done after R3/R6 each executed all 12 focused controls on the same seven current inputs and a real pinned compiler. Actual messaging deployment/native acceptance remains To Do.
  - Waiting on: INF-03 completion and approved actual messaging infrastructure/broker observations
  - Completion remains unmet: INF-03 completion; Approved actual messaging infrastructure and provider observations; Two current other-role executed child reviews
  - [ ] The frozen legal physical alias for logical `contoso-corr-poc-sb` (queue `contoso-orders`; topic `contoso-order-events` with Fulfillment and Notify subscriptions), `contoso-corr-poc-egt` (CloudEvents schema), `contoso-corr-poc-eh` (hub `contoso-telemetry-batch`) and storage queue `contoso-legacy-jobs` deploy. Required Contoso result/relay entities are in the same declared topology; no reserved `-sb` suffix or unreviewed private-only Event Grid delivery claim is used.
  - [ ] Producers and workers use managed identity with least-privilege data roles; no connection strings in settings.
  - [ ] Max delivery count, lock duration and dead-lettering are parameters (used by Demos 06 and 07).
  - [ ] Deploys idempotently under GATE-11.

  #### Child tasks

    - [x] **INF-06.1 - Make the messaging infrastructure test independent of one machine's Bicep path**
      - Executor: R5.
      - Prerequisites: None; follow the compiler convention of the APIM and telemetry tests.
      - Deliverable: One change to `tests\messaging\infra.test.mjs` that resolves the compiler from `CONTOSO_BICEP_PATH`, accepts the existing `CONTOSO_BICEP_EXE` alias and removes the absolute `.copilot\session-state` default.
      - Acceptance: With a valid compiler the existing assertions run unchanged. Without one the tests are reported as skipped with an explicit not-verified reason, counted as skipped rather than passed, instead of failing on a missing machine path. A source test fails on an absolute user-profile path in the file.
    - INF-06.1: **Done — construction-only / NOT CERTIFIED**. Compiler resolution and honest missing-prerequisite skip behavior are independently complete for construction. Actual messaging deployment/native acceptance remains To Do.
      Evidence: [R3 executed review](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R3/review-r5-inf06-20261102-8d9476d4/review.json).
      Evidence: [R6 executed review](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R6/review-r5-inf-06.1-v1/execution/review.json).

- [ ] **#30 MSG-01 · Message envelope v1, validator and untrusted-context handling**
  Satisfier · logical R5 · CD3 34.0 · 1 d · needs ADR-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] The schema defines version, `traceparent`, `tracestate`, `business.invocation_id`, message identity and size limits.
  - [ ] A shared validator rejects malformed, oversized and schema-invalid envelopes, with a test per rule.
  - [ ] Consumers apply ADR A03 to spoofed or malformed context: new root and bounded rejection category, never a raw rejected value. An optional digest requires the approved safe-input/key policy; a plain hash is not automatically a safe pseudonym for arbitrary personal input.
  - [ ] A schema change requires a version bump and triggers GATE-12 invalidation.

- [ ] **#31 MSG-07 · Storage Queue envelope path**
  Satisfier · logical R5 · CD3 42.0 · 0.5 d · needs INF-06, JVM-01, MSG-01
  - Phase: sdk-path-clause-tightened-native-blocked; scope: construction.
  - Next action: Clause 3 now tests the selected SDK-managed Storage Queue receive path and states that native trigger-binding behaviour is not claimed (ADR A04). Real queue round-trip, size and duplicate-delivery effects are pending.
  - Waiting on: INF-06 deployed storage queue and roles; Real envelope round-trip, oversize/invalid rejection and duplicate delivery; Two accepted current source reviews
  - [ ] Jobs use envelope v1; the worker extracts the envelope context and starts its PROCESS span explicitly.
  - [ ] The envelope round-trips within size and privacy limits; oversized or invalid envelopes are rejected.
  - [ ] The selected SDK-managed Storage Queue receive path is tested for the properties it does and does not expose; native trigger-binding behaviour is not claimed, and gaps go to the gap log.

- [ ] **#42 MSG-02 · Service Bus send and process path**
  Satisfier · logical R5 · CD3 22.7 · 1.5 d · needs INF-06, JVM-01, MSG-01
  - Phase: outbox-and-timer-poll-clauses-tightened-native-blocked; scope: construction.
  - Next action: Clause 1 now covers the durable outbox (the persisted request context parents each publish-attempt PRODUCER span, a retry after an uncertain publish is a new span with a publish-attempt count, delayed publication never re-parents or re-samples, duplicates are idempotent by message ID) and clause 3 matches ADR A04: the selected path is timer-polled and SDK-managed, native trigger-binding parity is not claimed. Local carrier/H2 captures show attempts and links; real broker and Functions host evidence is pending. The real-broker outbox proof is child MSG-02.1.
  - Waiting on: INF-06 deployed namespaces and managed-identity roles; Real broker publish attempts including an uncertain-publish retry; ai-azure-functions suppression and no-duplicate-span observation on the deployed host; Two accepted current source reviews
  - [ ] Orders API sends with a producer span and W3C context in application properties through supported Azure SDK instrumentation or an explicit propagator (`VERIFY:` property name and behaviour for the pinned Java SDK); `business.invocation_id` travels as an application property. Publication goes through the durable outbox: the persisted request context parents every publish-attempt PRODUCER span (a retry after an uncertain publish is a new span with a publish-attempt count), delayed publication neither re-parents nor re-samples that context, and at-least-once duplicates are idempotent by message ID.
  - [ ] Fulfillment Worker creates a PROCESS span per delivery, parented or linked to the producer context as the boundary map defines.
  - [ ] The Functions host and the Java worker do not emit duplicate spans on the selected timer-polled, SDK-managed receive path (`ai-azure-functions` suppression verified); native trigger-binding parentage and parity are not claimed and stay a separate qualification (ADR A04).
  - [ ] Message ID, delivery count and dead-letter reason are recorded as safe attributes.

  #### Child tasks

    - [ ] **MSG-02.1 - Prove durable-outbox publish attempts against a real Service Bus queue**
      - Executor: R5.
      - Prerequisites: The reviewed outbox dispatcher and message-schema contract; an approved INF-06 deployment with managed-identity data roles, a run-owned queue and a separately approved bounded window.
      - Deliverable: One opt-in qualification that drives the persisted-context outbox through delayed, retried-after-uncertain-publish and duplicate publication against a real queue and writes a source-bound receipt. Without an approved namespace it skips with an explicit reason.
      - Acceptance: The persisted request context parents every publish-attempt PRODUCER span; a retry after an uncertain publish is a new span with an incremented publish-attempt count; delayed publication neither re-parents nor re-samples the context; a duplicate delivery is idempotent by message ID so one effect occurs; and `business.invocation_id` is unchanged. A seeded re-parenting or span-ID reuse fails (GATE-09). `UnavailableBroker` and in-memory runs are construction only.
    - MSG-02.1: **To Do — construction-only / NOT CERTIFIED**. Supply approved real queue/role/run-owned entities and observe publish attempts, uncertain-publish retry and duplicates with actual outbox effects and cleanup.
      Waiting on: No approved broker endpoint/DB-role/run-owned entity/bootstrap/window inputs; Actual real-queue evidence; source/H2/carrier tests cannot substitute

- [ ] **#43 MSG-03 · Retry attempt semantics**
  Satisfier · logical R5 · CD3 58.0 · 0.5 d · needs MSG-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Each redelivery creates a new PROCESS span with a new span-id and an attempt or delivery-count attribute, keeping the original propagated context.
  - [ ] Message and business identity are unchanged across attempts.
  - [ ] GATE-09 retry checks pass after N injected transient failures.

- [ ] **#49 DEM-06 · Contoso Demo 06: Service Bus retry semantics**
  Satisfier · logical R5 · CD3 52.0 · 0.5 d · needs GATE-09, DEM-00, MSG-03
  - Phase: scenario-adapter-required-native-blocked; scope: construction.
  - Next action: Ship Demo 06's own scenario adapter (DEM-06.1) against the reviewed shared DEM-00 adapter contract; the closing clause now forbids a stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback. N injected failures plus success must show N+1 actual PROCESS attempts on a real broker. Run.ps1 returned FAIL D_MISSING_ADAPTER at commit 7279cd3.
  - Waiting on: Reviewed DEM-00.1 shared adapter contract and Demo 01 native qualification; This demo's own reviewed scenario adapter; Approved deployed target, identities and a separately approved bounded native window
  - [ ] Declare injectedFailures, expectedAttempts, terminal outcome and delivery-count convention. N injected failures followed by success produce N+1 distinct PROCESS attempts; a run stopping after N failed deliveries has N attempts and no success. Actual extra redeliveries are classified, not hidden.
  - [ ] Message and business identity are preserved and no span-id is reused (GATE-09).
  - [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-06.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

  #### Child tasks

    - [ ] **DEM-06.1 - Ship the Demo 06 Service Bus retry adapter**
      - Executor: R5.
      - Prerequisites: DEM-00.1 and the reviewed MSG-03 and GATE-09 retry contracts. Native execution additionally needs the approved INF-06 broker and a separately approved bounded native window.
      - Deliverable: One `tools\verification\adapters\demo06-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 06.
      - Acceptance: The shipped `demos\06\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It declares injectedFailures, expectedAttempts, the terminal outcome and the delivery-count convention and, on a real broker, asserts that N injected failures followed by success produce N+1 distinct PROCESS attempts with new span IDs, that a run stopped after N failures shows N attempts and no success, and that extra redeliveries are classified (GATE-09). Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset drains only run-owned messages, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).
    - DEM-06.1: **To Do — construction-only / NOT CERTIFIED**. After DEM-00.1, drive a real broker retry sequence and prove N+1 distinct attempts with terminal effects and run-owned cleanup.
      Waiting on: DEM-00.1; Approved real broker entities/identity/window and native capture/reset

- [ ] **#54 MSG-04 · Dead-letter preservation and replay tool**
  Satisfier · logical R5 · CD3 29.0 · 1 d · needs MSG-03
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Dead-lettered messages keep the original MessageId, `business.invocation_id`, trace context and dead-letter reason, with no tokens or payload data in attributes.
  - [ ] The replay tool in `workers/` re-submits with the original MessageId recorded and either links to the original context or starts a new trace linked to it.
  - [ ] `business.invocation_id` is unchanged after replay; GATE-09 replay checks pass.

- [ ] **#55 DEM-07 · Contoso Demo 07: Dead-letter and replay**
  Satisfier · logical R5 · CD3 52.0 · 0.5 d · needs GATE-09, DEM-00, MSG-04
  - Phase: scenario-adapter-required-native-blocked; scope: construction.
  - Next action: Ship Demo 07's own scenario adapter (DEM-07.1) against the reviewed shared DEM-00 adapter contract; the closing clause now forbids a stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback. Run the Fulfillment and Notify dead-letter cases and their replay PROCESS and SEND roots with a run-scoped drain. Run.ps1 returned FAIL D_MISSING_ADAPTER at commit 7279cd3.
  - Waiting on: Reviewed DEM-00.1 shared adapter contract and Demo 01 native qualification; This demo's own reviewed scenario adapter; Approved deployed target, identities and a separately approved bounded native window
  - [ ] The dead-lettered message keeps its safe identity and reason.
  - [ ] Replay links to the original context or starts a new trace linked to it; `business.invocation_id` is unchanged (GATE-09); the reset drains the dead-letter queue.
  - [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-07.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

  #### Child tasks

    - [ ] **DEM-07.1 - Ship the Demo 07 dead-letter and replay adapter**
      - Executor: R5.
      - Prerequisites: DEM-00.1 and the reviewed MSG-04 and GATE-09 replay contracts. Native execution additionally needs the approved INF-06 broker and a separately approved bounded native window.
      - Deliverable: One `tools\verification\adapters\demo07-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 07.
      - Acceptance: The shipped `demos\07\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It runs the Fulfillment and Notify dead-letter cases and their replay PROCESS and SEND roots and asserts the dead-lettered message keeps its safe identity and reason, replay links to the original context or starts a linked new trace with `business.invocation_id` unchanged (GATE-09), and reset drains only run-owned dead-letter messages. Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).
    - DEM-07.1: **To Do — construction-only / NOT CERTIFIED**. After DEM-00.1, drive actual dead-letter and replay with run-owned drain/reset and exact attempt/link/terminal-effect evidence.
      Waiting on: DEM-00.1; Approved real DLQ/replay entities, identities and native operations/window

- [ ] **#56 MSG-08 · Fan-out and fan-in with links**
  Satisfier · logical R5 · CD3 29.0 · 1 d · needs MSG-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] An event on `contoso-order-events` fans out to Fulfillment and Notify; each creates its own PROCESS span from the propagated context.
  - [ ] `contoso-order-aggregator` creates one span with at most one parent and links to every contributor, within the bound.
  - [ ] Links show in exported telemetry and in the trace-reconstruction query.

- [ ] **#57 DEM-08 · Contoso Demo 08: Fan-out and fan-in**
  Satisfier · logical R5 · CD3 52.0 · 0.5 d · needs GATE-09, DEM-00, MSG-08
  - Phase: scenario-adapter-required-native-blocked; scope: construction.
  - Next action: Ship Demo 08's own scenario adapter (DEM-08.1) against the reviewed shared DEM-00 adapter contract; the closing clause now forbids a stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback. Observe separate worker PROCESS spans and the Aggregator's links to every persisted contributor. Run.ps1 returned FAIL D_MISSING_ADAPTER at commit 7279cd3.
  - Waiting on: Reviewed DEM-00.1 shared adapter contract and Demo 01 native qualification; This demo's own reviewed scenario adapter; Approved deployed target, identities and a separately approved bounded native window
  - [ ] Fulfillment and Notify each show their own PROCESS span.
  - [ ] The Aggregator has at most one parent plus bounded links to every contributor (GATE-09).
  - [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-08.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

  #### Child tasks

    - [ ] **DEM-08.1 - Ship the Demo 08 fan-out and fan-in adapter**
      - Executor: R5.
      - Prerequisites: DEM-00.1 and the reviewed MSG-08 and GATE-09 contracts. Native execution additionally needs the approved INF-06 broker and a separately approved bounded native window.
      - Deliverable: One `tools\verification\adapters\demo08-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 08.
      - Acceptance: The shipped `demos\08\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It observes the separate Fulfillment and Notify PROCESS spans and asserts the Aggregator has at most one parent plus bounded links to every persisted contributor (GATE-09). Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset removes only run-owned messages and state, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).
    - DEM-08.1: **To Do — construction-only / NOT CERTIFIED**. After DEM-00.1, observe actual fan-out PROCESS attempts and Aggregator contributor links against the durable ledger, then restore run-owned state.
      Waiting on: DEM-00.1; Approved actual fan-out/fan-in broker/runtime and native query/reset operations

- [ ] **#62 MSG-06 · Event Hubs mixed-context batch path**
  Satisfier · logical R5 · CD3 24.0 · 1 d · needs INF-06, JVM-01, MSG-01
  - Phase: checkpoint-recovery-clause-tightened-native-blocked; scope: construction.
  - Next action: Clause 1 now also requires offsets to advance only after durable outcomes under the fenced partition lease, and a restart or replay that neither drops nor double-counts a contributor. Local H2/SDK-carrier evidence exists; actual Event Hubs checkpoint recovery is pending. The real-hub proof is child MSG-06.1.
  - Waiting on: INF-06 deployed Event Hubs namespace and consumer roles; Real mixed-context batch with a restart and replay; Two accepted current source reviews
  - [ ] Events from different traces go to `contoso-telemetry-batch` and are consumed as one batch; offsets advance only after durable outcomes under the fenced partition lease, and a restart or replay neither drops nor double-counts a contributor.
  - [ ] The batch span links to each contributing context within a configured bound, or uses a documented bounded per-item representation; the first message is never the parent.
  - [ ] Partition and offset are recorded as safe attributes; the link bound is a parameter.

  #### Child tasks

    - [ ] **MSG-06.1 - Prove fenced Event Hubs checkpoint recovery against a real hub**
      - Executor: R5.
      - Prerequisites: The reviewed batch handler and checkpoint-store contract; an approved INF-06 hub `contoso-telemetry-batch` with a run-owned consumer group and a separately approved bounded window.
      - Deliverable: One opt-in restart-and-replay qualification against the real hub with a source-bound receipt. Without an approved namespace it skips with an explicit reason.
      - Acceptance: Offsets advance only after durable outcomes under the fenced partition lease. Killing the consumer after processing but before its checkpoint and restarting it neither drops nor double-counts a contributor, and a consumer that lost its fence cannot advance the checkpoint. Each batch span links every contributor within the configured bound and the first event is never the parent. A seeded early checkpoint fails. In-memory runs are construction only.
    - MSG-06.1: **To Do — construction-only / NOT CERTIFIED**. Use an approved actual Event Hubs group/checkpoint store to prove fenced restart and replay with actual effects and run-owned cleanup.
      Waiting on: Approved real Event Hubs endpoint/group/checkpoint identity/window; Actual broker evidence; local fencing fixtures are not real-store proof

- [ ] **#63 DEM-09 · Contoso Demo 09: Event Hubs mixed-context batch**
  Satisfier · logical R5 · CD3 36.0 · 0.5 d · needs GATE-09, DEM-00, MSG-06
  - Phase: scenario-adapter-required-native-blocked; scope: construction.
  - Next action: Ship Demo 09's own scenario adapter (DEM-09.1) against the reviewed shared DEM-00 adapter contract; the closing clause now forbids a stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback. Produce events from different traces, consume them as one mixed-context batch and prove the first item is never the parent. Run.ps1 returned FAIL D_MISSING_ADAPTER at commit 7279cd3.
  - Waiting on: Reviewed DEM-00.1 shared adapter contract and Demo 01 native qualification; This demo's own reviewed scenario adapter; Approved deployed target, identities and a separately approved bounded native window
  - [ ] Batch processing uses links or a bounded per-item representation.
  - [ ] The first message is never the parent (GATE-09).
  - [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-09.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

  #### Child tasks

    - [ ] **DEM-09.1 - Ship the Demo 09 mixed-context batch adapter**
      - Executor: R5.
      - Prerequisites: DEM-00.1 and the reviewed MSG-06 and GATE-09 contracts. Native execution additionally needs the approved INF-06 Event Hubs namespace and a separately approved bounded native window.
      - Deliverable: One `tools\verification\adapters\demo09-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 09.
      - Acceptance: The shipped `demos\09\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It produces events from different traces to `contoso-telemetry-batch`, consumes them as one mixed-context batch and asserts links or a bounded per-item representation with the first message never the parent (GATE-09). Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset removes only run-owned events and state, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).
    - DEM-09.1: **To Do — construction-only / NOT CERTIFIED**. After DEM-00.1, run a real mixed-context batch without a first-message parent and compare native links with the persisted contributor ledger.
      Waiting on: DEM-00.1; Approved actual broker/runtime and native capture/reset operations

- [ ] **#67 MSG-05 · Event Grid CloudEvents path**
  Satisfier · logical R5 · CD3 24.0 · 1 d · needs INF-06, JVM-01, MSG-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Orders API publishes to `contoso-corr-poc-egt` with context in the CloudEvents distributed-tracing extension; the event `id` is never the trace-id.
  - [ ] The subscriber extracts the context and creates a PROCESS span; propagation is validated end to end.
  - [ ] Duplicate deliveries are detected by event `id` and handled idempotently; size and validation limits are enforced.

- [ ] **#70 DEM-10 · Contoso Demo 10: Event Grid CloudEvents and Storage Queue envelope**
  Satisfier · logical R5 · CD3 18.0 · 1 d · needs GATE-09, DEM-00, MSG-05, MSG-07
  - Phase: scenario-adapter-required-native-blocked; scope: construction.
  - Next action: Ship Demo 10's own scenario adapter (DEM-10.1) against the reviewed shared DEM-00 adapter contract; the closing clause now forbids a stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback. Drive the Event Grid relay and Storage Queue envelope paths including size limits and a duplicate delivery. Run.ps1 returned FAIL D_MISSING_ADAPTER at commit 7279cd3.
  - Waiting on: Reviewed DEM-00.1 shared adapter contract and Demo 01 native qualification; This demo's own reviewed scenario adapter; Approved deployed target, identities and a separately approved bounded native window
  - [ ] CloudEvent `id` differs from the trace-id; context survives through the distributed-tracing extension and through the envelope.
  - [ ] Size and validation limits are enforced and a duplicate delivery is handled.
  - [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-10.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

  #### Child tasks

    - [ ] **DEM-10.1 - Ship the Demo 10 Event Grid and Storage Queue adapter**
      - Executor: R5.
      - Prerequisites: DEM-00.1 and the reviewed MSG-05, MSG-07 and GATE-09 contracts. Native execution additionally needs the approved INF-06 Event Grid topic, relay and Storage Queue, and a separately approved bounded native window.
      - Deliverable: One `tools\verification\adapters\demo10-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 10.
      - Acceptance: The shipped `demos\10\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It drives the Event Grid relay and Storage Queue envelope paths, including the size and validation limits and a duplicate delivery, and asserts the CloudEvent `id` differs from the trace ID, context survives the distributed-tracing extension and the envelope, and the duplicate is handled. Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset removes only run-owned messages, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).
    - DEM-10.1: **To Do — construction-only / NOT CERTIFIED**. After DEM-00.1, execute actual Event Grid and Storage Queue paths including a duplicate and preserve exact effect/trace/reset evidence.
      Waiting on: DEM-00.1; Approved actual Event Grid/Storage Queue entities, identities and native operations/window

### R6: 4 cards

- [ ] **#33 INF-05 · Data-tier IaC: PostgreSQL and Azure Managed Redis**
  Satisfier · logical R6 · CD3 29.0 · 1 d · needs ADR-02, INF-02
  - Phase: fresh-untyped-data-api-diagnostic-gate; scope: construction.
  - Next action: INF-05.2 is construction Done: final v2 actual author/R4/R8 replays each passed six Node controls and two compiler checks at the stable register epoch. Provider properties, GA/support, deployment and own-identity connectivity remain To Do.
  - Waiting on: ADR-02/INF-02 completion and approved provider/private connectivity/per-app own-identity observations
  - [ ] `contoso-corr-poc-pg` with database `contoso_orders` and `contoso-corr-poc-amr` (Azure Managed Redis; SKU and region `VERIFY:`) deploy with private connectivity from the App Service apps.
  - [ ] Credentials use Microsoft Entra authentication or Key Vault references, never source or logs.
  - [ ] A connection smoke test from every store-consuming app (Inventory API; Orders API workflow store; Fulfillment, Notify and Aggregator messaging store) passes under that app's own database role and Redis identity where used, and its logs contain no secrets.
  - [ ] No Azure Cache for Redis resource exists (GATE-07 passes).

  #### Child tasks

    - [ ] **INF-05.1 - Ship per-app data-tier connection smoke tests**
      - Executor: R6.
      - Prerequisites: Reviewed INF-05 outputs and the existing per-app workflow grant files in `services\inventory-data`. Native execution additionally needs approved private connectivity, Entra grants and a separately approved bounded window.
      - Deliverable: One smoke-test command that, for each store-consuming app (Inventory; Orders workflow store; Fulfillment, Notify and Aggregator messaging stores), connects under that app's own database role and Redis identity where used, through the app's own runtime identity, and performs one read-only probe.
      - Acceptance: The report gives one pass or fail per app naming only the role identity. A wrong-role or missing-grant case fails, and no connection string, token, password or SQL parameter reaches output or logs. Runs against H2 or the RESP fixture test the harness only and are labelled construction.

    - [x] **INF-05.2 - Record and gate the untyped data-tier API versions**
      - Executor: R6.
      - Prerequisites: The frozen Bicep compiler (`CONTOSO_BICEP_PATH`) and the existing data-tier modules. Native `validate` and `what-if` additionally need the approved subscription and resource group.
      - Deliverable: One test and register update that compile `infra\modules\data-postgres.bicep` and `data-managed-redis.bicep` and record the BCP081 warnings for `Microsoft.DBforPostgreSQL/flexibleServers@2026-10-01` and `Microsoft.Cache/redisEnterprise@2026-09-01`, each tied to a VERIFY register row.
      - Acceptance: The test passes only when the warning set equals the recorded set and fails on an unrecorded warning or any error; without a compiler it reports skipped. The documentation states that provider property validation for those resources happens at deployment. A successful ARM validate and no-change what-if against the approved group (GATE-11 clauses 1 and 4) is the native exit and is not claimed here.
    - INF-05.1: **To Do — construction-only / NOT CERTIFIED**. Obtain approved per-app targets/identities and run each consuming app's real PostgreSQL/Redis connectivity and denied-role controls under its own identity.
      Waiting on: Approved actual private data targets and app identities; Explicit native connectivity/window authorization
    - INF-05.2: **Done — construction-only / NOT CERTIFIED**. The original v2 warning/VERIFY scope remains byte-identical after the idempotent checkout repair. Both existing R4/R8 executed reviews and all eight inputs verify unchanged; provider/GA/deployment/connectivity remain To Do.
      Evidence: [R4 executed review](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R4/review-R6-INF05.2-v2/review.json).
      Evidence: [R8 executed review](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R8/r6-inf05.2-v2-20261102/receipt/review.json).

- [ ] **#34 DAT-01 · PostgreSQL JDBC client spans**
  Satisfier · logical R6 · CD3 39.0 · 1 d · needs INF-05, JVM-01
  - Phase: fresh-opt-in-real-postgresql-lane-construction; scope: construction.
  - Next action: DAT-01.2 is construction Done. Opt-in PostgreSQL source and twelve safe Java contracts are complete, with original XML independently witnessed; actual PostgreSQL locking/effective ACL/provenance/cleanup has not run.
  - Waiting on: Actual approved PostgreSQL target/tools and real grant/locking/cleanup execution; Real private/identity store and durable recovery/native acceptance
  - Completion remains unmet: INF-05/JVM-01 completion; Real Azure PostgreSQL/Managed Redis private/Entra data operations and exported spans; Two accepted current source reviews; Current full-root source/execution/artifact and actual installed-consumer/USED handoff; Native actual default Data/identity/private TLS/role/grant/global/owner evidence
  - Construction evidence: [R8 opt-in PostgreSQL source controls](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R8/r6-dat01.3-v1-20261102/receipt/review.json) (CURRENT_SOURCE_UNIT_ONLY_NOT_REAL_STORE_EXECUTION / NOT CERTIFIED).
  - Construction evidence: [Original safe Java contract XML witness](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R6/dat-01.3-v1/java-contract-witness.json) (LOCAL_CONTRACTS_ONLY_NOT_POSTGRESQL_OR_ENTRA / NOT CERTIFIED).
  - [ ] The selected safe JDBC logical-operation wrapper uses the existing provider to produce one CLIENT dependency under Inventory (and, through the same wrapper, under the Orders workflow/outbox store and each worker messaging-store operation, parented to its request, producer or PROCESS span), with only database system, approved logical namespace, endpoint and fixed operation/outcome attributes. Automatic JDBC capture is disabled on this path; any automatic qualification is separate and never runs in parallel at the same logical boundary.
  - [ ] SQL text and parameter capture are off or sanitized; GATE-04 finds no literals, parameters or credentials.
  - [ ] The span wraps the logical operation, not just pool acquisition, and driver retries are visible as a count.
  - [ ] A runbook note states these are client spans, not PostgreSQL server spans, and gives the time-correlation method for server logs.

  #### Child tasks

    - [ ] **DAT-01.1 - Prepare deterministic run-owned PostgreSQL and Redis state**
      - Executor: R6.
      - Prerequisites: Reviewed Inventory data/cache interfaces and migration/grant contracts; native qualification additionally needs approved INF-05 deployment, private connectivity, Entra permissions and an owned synthetic dataset.
      - Deliverable: One Demo 01 preparation/reset implementation that captures the run-owned baseline, seeds the approved synthetic fixture and evicts only its owned cache entry before the measured invocation.
      - Acceptance: A source-bound test proves a cold lookup executes Redis GET, PostgreSQL SELECT and cache population, rather than skipping PostgreSQL on a hit. An approved real-store probe confirms those operations and baseline restoration; H2/RESP results remain construction-only. Before/after hashes prove unrelated rows and cache state unchanged. Reset restores the captured baseline without global cache flushes or broad deletes; evidence retains ownership/hashes, not cache keys, values or credentials.

    - [x] **DAT-01.2 - Remove the session-folder default from the Inventory fixture test script**
      - Executor: R6.
      - Prerequisites: The documented `CONTOSO_PORTABLE_TOOLS_ROOT` convention.
      - Deliverable: One change to `services\inventory-data\tools\Test-InventoryFixture.ps1` that replaces its absolute `.copilot\session-state` `ToolsRoot` default.
      - Acceptance: Run without the variable, the script stops with an explicit prerequisite error naming it; with it set, the fixture contract and source tests behave as before. A source test fails on an absolute user-profile or session-state path in the script.

    - [ ] **DAT-01.3 - Add an opt-in real-PostgreSQL local lane for the data adapter**
      - Executor: R6.
      - Prerequisites: A developer-supplied PostgreSQL instance or container runtime, enabled only by an explicit variable; the committed `V001__inventory.sql` migration, the workflow grant files and the existing adapter tests.
      - Deliverable: One opt-in integration lane that applies the committed migration and workflow grants to a real PostgreSQL instance and runs the Inventory SELECT and transaction paths through `PgOperations` under the existing provider.
      - Acceptance: Without the variable the lane reports skipped with the reason, never a pass. Enabled, the migration and every grant file apply unmodified, operations return the same results as the H2 (PostgreSQL mode) tests and each emits one CLIENT span with only system, namespace, operation and outcome attributes. A seeded dialect difference that H2 accepts must fail here. The result is labelled local real-store evidence, not Entra-authenticated private-network evidence (INF-05, DAT-01 native facets).
    - DAT-01.1: **To Do — construction-only / NOT CERTIFIED**. Qualify run-owned cold-cache preparation/reset on actual PostgreSQL and Redis and prove unchanged unowned state; existing local fixture/H2/RESP evidence cannot close this exit.
      Waiting on: Actual approved PostgreSQL/Redis targets, identity and reset lease; Current authentic store/emission evidence
    - DAT-01.2: **Done — construction-only / NOT CERTIFIED**. Portable fixture-root construction is independently complete: R4/R8 each executed 11 source/PowerShell controls on the same nine current inputs. Real store lifecycle/native qualification remains To Do.
      Evidence: [R4 executed review](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R4/review-R6-DAT01.2-v1/review.json).
      Evidence: [R8 executed review](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R8/r6-dat01.2-20261102/receipt/review.json).
    - DAT-01.3: **To Do — construction-only / NOT CERTIFIED**. R4/R8 source checks and twelve safe Java contracts are complete, with original XML independently witnessed. Actual PostgreSQL has not run; execute effective ACL/locking/provenance/cleanup on an approved real target before Done.
      Waiting on: Actual approved PostgreSQL target/tools and real grant/locking/cleanup execution

- [ ] **#35 DAT-02 · Azure Managed Redis client spans**
  Satisfier · logical R6 · CD3 39.0 · 1 d · needs INF-05, JVM-01
  - Phase: fresh-opt-in-real-redis-lane-construction; scope: construction.
  - Next action: Both R4/R8 twelve-test source reviews and six safe Java contracts are complete. Actual Redis has never run; approved real adapter/cleanup evidence remains required.
  - Waiting on: Actual approved standalone Redis target/tools and adapter/cleanup execution
  - Completion remains unmet: INF-05/JVM-01 completion; Actual approved Redis operations/client spans and safe cleanup; Two current other-role exact child-exit reviews
  - Construction evidence: [R4 opt-in Redis source controls](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R4/review-R6-DAT02.1-v1/review.json) (CURRENT_SOURCE_UNIT_ONLY_NOT_REAL_STORE_EXECUTION / NOT CERTIFIED).
  - Construction evidence: [R8 opt-in Redis source controls](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R8/r6-dat02.1-v1-20261102/receipt/review.json) (CURRENT_SOURCE_UNIT_ONLY_NOT_REAL_STORE_EXECUTION / NOT CERTIFIED).
  - [ ] The Redis client version is checked against the pinned agent's supported list (`VERIFY:`); if unsupported, a manual client span wraps a safe abstraction boundary.
  - [ ] Spans record operation category, endpoint and outcome only; keys, values, scripts, command arguments and session IDs are never captured.
  - [ ] Each cache call appears once; hit or miss is a bounded attribute or a metric.

  #### Child tasks

    - [ ] **DAT-02.1 - Add an opt-in real-Redis local lane for the cache adapter**
      - Executor: R6.
      - Prerequisites: A developer-supplied Redis-compatible server or container runtime, enabled only by an explicit variable; the existing `LettuceInventoryCache`, `OwnedInventoryCache` and RESP-fixture tests.
      - Deliverable: One opt-in integration lane that runs the cache adapter against a real Redis-compatible server.
      - Acceptance: Without the variable the lane reports skipped with the reason. Enabled, a GET miss, population, GET hit, owned-entry eviction and reset behave as under the RESP fixture, and each cache call emits one CLIENT span with no key, value, script or argument attribute; a seeded key capture fails. The result is labelled local; Entra-authenticated Azure Managed Redis behaviour stays with the INF-05 and DAT-02 native facets.
    - DAT-02.1: **To Do — construction-only / NOT CERTIFIED**. Both R4/R8 twelve-test source reviews and six safe Java contracts are complete. Actual Redis has not run; execute the adapter and exact cleanup on an approved real standalone target before Done.
      Waiting on: Approved real standalone Redis target/tools and actual adapter/cleanup execution

- [ ] **#50 DEM-12 · Contoso Demo 12: Data-tier safety**
  Satisfier · logical R6 · CD3 52.0 · 0.5 d · needs GATE-04, DAT-01, DAT-02, DEM-00
  - Phase: scenario-adapter-and-store-scope-required-native-blocked; scope: construction.
  - Next action: Ship Demo 12's own scenario adapter (DEM-12.1, after ARC-01.1) against the reviewed shared DEM-00 adapter contract; the closing clause now forbids a stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback. Clause 1 now covers every store-consuming tier (Inventory, the Orders workflow store and the worker messaging stores) with seeded SQL-literal and Redis-key negative controls. Run.ps1 returned FAIL D_MISSING_ADAPTER at commit 7279cd3.
  - Waiting on: Reviewed DEM-00.1 shared adapter contract and Demo 01 native qualification; This demo's own reviewed scenario adapter; Boundary-map declaration of the Orders and worker store operations (ARC-01) and real private data operations (INF-05); Approved deployed target, identities and a separately approved bounded native window
  - [ ] JDBC and Redis client spans are present with safe attributes and wrap the logical operation in every tier that touches a store (Inventory, the Orders workflow store and the worker messaging stores).
  - [ ] GATE-04 finds no SQL literals or parameters and no Redis keys, values or scripts.
  - [ ] Negative control: a seeded SQL literal and Redis key are not captured, and the scan proves it.
  - [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-12.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

  #### Child tasks

    - [ ] **DEM-12.1 - Ship the Demo 12 data-tier safety adapter**
      - Executor: R6.
      - Prerequisites: DEM-00.1 and ARC-01.1, the reviewed DAT-01, DAT-02 and GATE-04 interfaces. Native execution additionally needs the approved private data tier and a separately approved bounded native window.
      - Deliverable: One `tools\verification\adapters\demo12-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 12.
      - Acceptance: The shipped `demos\12\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It runs the seeded SQL-literal and Redis-key negative controls and asserts safe CLIENT spans in every store-consuming tier (Inventory, the Orders workflow store and the worker messaging stores) with no SQL literal, parameter, Redis key, value or script captured by the GATE-04 original-column scan; the clean run passes and the seeded run fails. Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset restores the run-owned baseline without global cache flushes or broad deletes, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).
    - DEM-12.1: **To Do — construction-only / NOT CERTIFIED**. After DEM-00.1 and ARC-01.1, run the actual all-tier safe-store span/negative controls and restore run-owned state; local opt-in interfaces alone do not satisfy it.
      Waiting on: DEM-00.1; ARC-01.1; Approved actual stores/runtime/identities and native operations

### R7: 12 cards

- [ ] **#21 INF-01 · Telemetry backbone IaC: Application Insights, Log Analytics, budgets**
  Satisfier · logical R7 · CD3 39.0 · 1 d · needs ADR-02, INF-02
  - Phase: source-merged-live-and-current-native-blocked; scope: construction.
  - Next action: Rootv4 now composes the existing sole telemetry module and committed Workbook58797/map aefab source. R7 current sampler-intake9d24 has original R2/R3 finite source/loopback35 acceptance, not native retake. R9 local conditional factory/graph source is being implemented; runtime source cases need the exact parent Java port and approved execution, not JSON/query waivers. Actual deployment/owner/native roster/full-table privacy/cost/quota evidence remain unmet.
  - Waiting on: Actual approved deployed root/telemetry/Workbook state, parameters and render evidence; Current accepted code reviews and actual empty-group deployment/idempotent what-if; Approved KV/bootstrap/grants/cost/quota/table plans/native caps/reset/action-group receiver/owner evidence
  - Completion remains unmet: ADR-02/INF-02 completion; Actual complete runtime/host roster and native ACKs; Approved all-table backend privacy/canary/drain/load evidence; Two current accepted source reviews
  - [ ] One workspace-based `contoso-corr-poc-appi` is connected to `contoso-corr-poc-law`, with retention set per ADR A05.
  - [ ] The connection string is written to `contoso-corr-poc-kv` from deployment outputs; it is never emitted in plain text.
  - [ ] An ingestion budget and an ingestion-volume alert exist.
  - [ ] `infra/main.bicep`, `infra/params/poc.bicepparam` and `azure.yaml` exist and deploy this module under GATE-11.

- [ ] **#22 OBS-03 · KQL: orphan-candidate detection**
  Satisfier · logical R7 · CD3 48.0 · 0.5 d · needs ARC-01, INF-01
  - Phase: source-reviewed-native-and-observer-blocked; scope: construction.
  - Next action: New sampler-intake9d24 own5/effective17 has BOTH original R2/R3 source/owned-loopback35 reviews accepted, with R2 separate actual absolute-deadline trickle control. Owner81/full portfolio tests are not independent native retakes. Oldcc91869 reviews are AT_EXECUTION/unchanged-code facts only, not current affected closure. Parent must explicitly execute/preserve/select new native epochs; no locked-Gate02 auto-adoption. R9 fixed conditional runtime/carrier graph source remains locally actionable, actual native cases NOT RUN; missing cases stay defects, never a generic query/map waiver.
  - Waiting on: Actual locally source-bound runtime/carrier observer implementation and genuine executed conditional cases; Approved complete native graph/source-query/privacy/full-path and owner evidence
  - Completion remains unmet: Actual source-enrolled runtime/carrier/Azure query and complete native graph/root cases; Current R2/R3 independent source reviews after final frozen R7 integration; Privacy/full-path/canary/owner acceptance
  - [ ] Returns spans whose ParentId has no matching Id in scope over a parameterized lookback, plus a legacy-schema variant.
  - [ ] Cross-resource scope is explicit, so orphans caused by query scope are visible.
  - [ ] Output joins to the expected boundary map so known remote or broker parents are pre-labelled.

- [ ] **#44 OBS-01 · Sampling matrix and bounded certification switch**
  Satisfier · logical R7 · CD3 29.0 · 1 d · needs INF-04, JVM-01, WEB-01
  - Phase: current6dd-source-reviewed-local-retake-root-selected; scope: construction.
  - Next action: Current6dd/DFAF/fda has bothoriginal45SOURCEvotes and separatelyexecutedparent actual5c [2,0,2]/RPS5 proof explicitlyRootselected4075/VERSIONS. Retain old875 bothlifecycleCHANGES_REQUIRED/43PASS andthreefailedepochs unchanged; successdoesnotproveidle-socketcausality or allparticipants/globalfidelity. Actual fullmatrix/nativeowner/Azure clauses remainunmet, no cardDone. R7 supports originalR9ed4 source review without ownReader self-vote.
  - Waiting on: Actual remaining complete participant/runtime/host sampling and bounded owner acceptance; Completion dependencies and approved fullpath/Azure evidence; Re-qualification of the linked-root local slice on current sources (invalidated at commit 7279cd3)
  - Completion remains unmet: Successful separately granted actual current4JVM retake and explicit immutable RootGate02 selection; Current complete participant/native sampling matrix, Azure/owner evidence and completion dependencies
  - [ ] docs/SAMPLING_MATRIX.md covers browser, APIM, each JVM, the optional Collector and ingestion, for certification and production separately.
  - [ ] The Java row records the pinned agent's documented default and override (`VERIFY:`), never "classic adaptive sampling".
  - [ ] One configuration switch sets 100% on every layer for a declared window and reverts afterwards; the change record and config snapshots are saved.
    - Facet unit: NOT RUN.
    Whole clause remains unmet; partial local facets are not live acceptance.

- [ ] **#45 OBS-02 · KQL: trace reconstruction and business lookup**
  Satisfier · logical R7 · CD3 29.0 · 1 d · needs INF-01, JVM-04
  - Phase: fresh-local-rehearsal-trace-merger; scope: construction.
  - Next action: Final corrective v3 has both R2/R9 seventy-five-test current approvals and actual mixed-provenance regression closure. Actual complete browser/JVM capture is still missing because the pair launcher was not implemented; native authority is absent.
  - Waiting on: Actual current local JVM pair and corrected canonical Run-demo browser capture; Approved native query/transport/emission/privacy/window authority
  - Completion remains unmet: Reviewed DEM-01.1 routing and DAT-01.1 deterministic real-store preparation; Approved deployed telemetry/Gateway/runtime outputs, independent tool/query source, privacy/sampling interfaces and bounded native window; Actual enrolled native observer and exact live query/carrier/SDK/source correspondence; All parent completion dependencies and current independent source reviews
  - Construction evidence: [R2 corrected local provenance source controls 75/75](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R2/review-r7-obs02-v3-5f66321c-5fce-4ebd-9b14-3d525c8c308a/review.json) (CURRENT_SOURCE_UNIT_ONLY_NOT_COMPLETE_LOCAL_CAPTURE / NOT CERTIFIED).
  - Construction evidence: [R9 corrected local provenance source controls 75/75](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R9/obs-02-2-source-independent-v3/review.json) (CURRENT_SOURCE_UNIT_ONLY_NOT_COMPLETE_LOCAL_CAPTURE / NOT CERTIFIED).
  - [ ] Both queries run against the current workspace tables (`AppRequests`, `AppDependencies`, `AppTraces`, `AppExceptions`, `AppEvents`, `AppPageViews`) and return results for a known trace-id and business ID.
  - [ ] Legacy variants (`requests`, `dependencies`, `traces`, `exceptions`) live in separate files; no query mixes schemas.
  - [ ] Business lookup returns every intended trace for a known ID and nothing extra, checked against the demo's expected trace list.
  - [ ] Saved outputs carry the timestamp and workspace configuration.

  #### Child tasks

    - [ ] **OBS-02.1 - Implement and qualify the native Demo 01 observer/collector**
      - Executor: R7.
      - Prerequisites: DEM-01.1 and DAT-01.1 for native qualification; approved deployed INF-01/INF-04/runtime outputs, independently authorized tool/query source, reviewed OBS-01 sampling and GATE-04 original-intake interfaces, and a separately approved bounded native window. The existing browser driver can qualify collection without waiting for DEM-00.1.
      - Deliverable: One collector implementation using the existing raw-query/intake path, with a source-bound Demo 01 native qualification receipt; no additional telemetry provider.
      - Acceptance: Bind the actual browser carrier, gateway SERVER and backend CLIENT, Orders SERVER and outbound HTTP CLIENT, Inventory SERVER and PostgreSQL/Redis CLIENT spans to the same observed invocation and UTC window. Preserve original IDs/parents, source locators, executed queries, runtime/source identity, independent emission accounting and before/after full-path canaries. Original-column privacy scanning precedes safe persistence. An omitted or mismatched required hop fails. Fixtures, expected-map IDs, saved JSON or caller authentication flags cannot enroll an observer or establish native authority; qualification must traverse the approved source-bound intake.

    - [ ] **OBS-02.2 - Render one merged local trace tree and run Invariants A, B and C over it**
      - Executor: R7.
      - Prerequisites: The existing browser and loopback-receiver capture formats and the GATE-08 invariant library. No Azure access is required.
      - Deliverable: One command that merges the browser and JVM local captures of a single invocation into one parent/child tree, prints it and runs Invariants A, B and C over the merged rows under a named local-rehearsal profile that marks only the Gateway request and Gateway backend-dependency hops as expected-remote.
      - Acceptance: A complete rehearsal capture prints one tree (one trace ID, unique span IDs, each child under its parent) and passes A, B and C under the profile. Fixtures with a split trace, a duplicate span ID, a wrong ParentId or any other missing hop fail naming the edge, and the full-chain profile still fails a capture that lacks the Gateway hops, so a rehearsal can never satisfy Invariant C (GATE-08 clause 3). Output is labelled LOCAL REHEARSAL.
    - OBS-02.1: **To Do — construction-only / NOT CERTIFIED**. After DAT-01.1 and DEM-01.1, capture the actual browser/Gateway request+backend/Orders/Inventory/data path using independently enrolled native query and emission observers.
      Waiting on: DAT-01.1; DEM-01.1; Approved target/auth/privacy/lease/window and native observers
    - OBS-02.2: **To Do — construction-only / NOT CERTIFIED**. Corrective v3 passed 75 controls and both R2/R9 current replays. Mixed caller inputs now downgrade to structural-only. Actual complete browser/JVM capture remains missing because the pair launcher was not implemented.
      Waiting on: Actual current local JVM pair and complete canonical Demo01 Run-demo browser/JVM capture

- [ ] **#58 DEM-14 · Contoso Demo 14: Orphan-candidate triage**
  Satisfier · logical R7 · CD3 36.0 · 0.5 d · needs ARC-01, DEM-00, OBS-03
  - Phase: scenario-adapter-required-native-blocked; scope: construction.
  - Next action: Ship Demo 14's own scenario adapter (DEM-14.1, after ARC-01.1) against the reviewed shared DEM-00 adapter contract; the closing clause now forbids a stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback. Triage every orphan candidate from the deployed trace set; unexplained candidates stay defects. Run.ps1 returned FAIL D_MISSING_ADAPTER at commit 7279cd3.
  - Waiting on: Reviewed DEM-00.1 shared adapter contract and Demo 01 native qualification; This demo's own reviewed scenario adapter; Approved deployed target, identities and a separately approved bounded native window
  - [ ] Every candidate is classified as expected-remote, cross-resource, sampled, delayed or defect, with justification.
  - [ ] Defects = 0.
  - [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-14.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

  #### Child tasks

    - [ ] **DEM-14.1 - Ship the Demo 14 orphan-candidate triage adapter**
      - Executor: R7.
      - Prerequisites: DEM-00.1 and ARC-01.1, the reviewed OBS-03 query and a deployed Demo 01 trace set. Native execution additionally needs approved workspace query permission and a separately approved bounded native window.
      - Deliverable: One `tools\verification\adapters\demo14-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 14.
      - Acceptance: The shipped `demos\14\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It runs the orphan-candidate query over the deployed trace set and classifies every candidate as expected-remote, cross-resource, sampled, delayed or defect from the boundary map; defects must be 0 and an unexplained candidate stays a defect. Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset removes only run-owned query artifacts, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).
    - DEM-14.1: **To Do — construction-only / NOT CERTIFIED**. After DEM-00.1 and ARC-01.1, run the native orphan classifier for every candidate with actual paths/screenshots and zero unexplained defects.
      Waiting on: DEM-00.1; ARC-01.1; Approved actual native query/runtime/window; empty results are not zero defects

- [ ] **#64 OBS-04 · Load, overhead and cost test**
  Satisfier · logical R7 · CD3 22.7 · 1.5 d · needs DAT-01, DAT-02, MSG-02, OBS-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] A repeatable load profile measures latency, CPU, memory, throughput, ingestion volume, exporter backpressure and cost at certification and production sampling.
  - [ ] Gateway diagnostic and policy overhead is reported before and after.
  - [ ] Restart and shutdown under load show no unacceptable span loss.
  - [ ] Results are compared with thresholds agreed in advance and saved under `evidence/`.

- [ ] **#65 OBS-07 · Production sampling profile with rollback**
  Delighter · logical R7 · CD3 30.0 · 0.5 d · needs OBS-01, OBS-04
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Per-layer production rates and error and critical-path rules are version-controlled and based on OBS-04 measurements.
  - [ ] A one-step rollback restores the previous profile and is tested.
  - [ ] Labelled as a proposal for Brief J02, outside the certification scope.

- [ ] **#66 DEM-15 · Contoso Demo 15: Sampling, overhead and certification-to-production switch**
  Satisfier · logical R7 · CD3 26.0 · 1 d · needs GATE-12, DEM-00, OBS-01, OBS-04, OBS-07
  - Phase: scenario-adapter-required-native-blocked; scope: construction.
  - Next action: Ship Demo 15's own scenario adapter (DEM-15.1) against the reviewed shared DEM-00 adapter contract; the closing clause now forbids a stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback. Toggle the bounded certification window, run the approved load and show the production profile and rollback. Run.ps1 returned FAIL D_MISSING_ADAPTER at commit 7279cd3.
  - Waiting on: Reviewed DEM-00.1 shared adapter contract and Demo 01 native qualification; This demo's own reviewed scenario adapter; Approved deployed target, identities, load budget and a separately approved bounded native window
  - [ ] Shows the sampling matrix and toggles 100% certification mode on and off through configuration, inside the GATE-12 window.
  - [ ] Shows the load-test report against thresholds: latency, CPU, memory, throughput, ingestion volume and cost.
  - [ ] Shows the version-controlled production profile and its tested rollback.
  - [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-15.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

  #### Child tasks

    - [ ] **DEM-15.1 - Ship the Demo 15 sampling, overhead and production-switch adapter**
      - Executor: R7.
      - Prerequisites: DEM-00.1 and the reviewed OBS-01, OBS-04 and OBS-07 interfaces. Native execution additionally needs the approved deployed topology, the approved load budget and thresholds, and a separately approved bounded native window.
      - Deliverable: One `tools\verification\adapters\demo15-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 15.
      - Acceptance: The shipped `demos\15\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It toggles the bounded 100% certification window on and off inside the GATE-12 window, runs the approved load profile and reports it against the agreed thresholds, shows the version-controlled production profile with its tested rollback, and verifies after reset that no layer remains at 100% outside the window. Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).
    - DEM-15.1: **To Do — construction-only / NOT CERTIFIED**. After DEM-00.1 and explicit owner/budget/load approval, execute the bounded native window, measured load report, rollback and restoration.
      Waiting on: DEM-00.1; Actual approved load/sampling/ACK/loss/budget/owner window and native observers

- [ ] **#73 OBS-05 · Correlation workbook**
  Delighter · logical R7 · CD3 11.0 · 1 d · needs OBS-02, OBS-03
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Deploys with the IaC and offers trace reconstruction by trace-id, business lookup by ID, orphan-candidate triage and ingestion volume against budget.
  - [ ] Driven by parameters only; no hard-coded identifiers or secrets.
  - [ ] A presenter can run every demo's live-show step from the workbook instead of raw KQL.

- [ ] **#76 OBS-06 · Orphan-candidate triage classifier**
  Delighter · logical R7 · CD3 13.0 · 1 d · needs OBS-03
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Each candidate is classified as expected-remote, cross-resource, sampled, delayed or defect, with the evidence used.
  - [ ] An unexplained candidate defaults to defect until a reviewer records a justification.
  - [ ] Demo 14 reruns and the regression suite can use its output in place of manual triage.

- [ ] **#77 EVL-B · Contoso Eval B: Azure Monitor Traces / Trace Analytics preview lane**
  Delighter · logical R7 · CD3 5.0 · 1 d · needs CRT-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Records preview terms, regional availability, schema and rollback.
  - [ ] Has no production or certification dependency; GATE-07 passes.
  - [ ] Findings are dated and flagged for re-check.

- [ ] **#78 EVL-A · Contoso Eval A: Collector tail-sampling lane**
  Delighter · logical R7 · CD3 4.7 · 1.5 d · needs ADR-02, CRT-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Runs only if an ADR A04 trigger is documented; otherwise the card closes with "rejected: no trigger" recorded.
  - [ ] Reports high availability, capacity and late-span behaviour.
  - [ ] Isolated from certification: GATE-07 passes and no certification component references it.

### R8: 9 cards

- [ ] **#1 GATE-03 · Secret-free repository and Key Vault-reference check**
  Dissatisfier · logical R8 · CD3 106.0 · 0.5 d · needs none
  - Phase: fresh-secret-scan-ci-construction; scope: construction.
  - Next action: Workflow source and local synthetic-history controls passed 27 tests; obtain R4/R5 source reviews and actual hosted clean/seeded PR execution. R8 released implementation to IDN-01.2.
  - Waiting on: Actual hosted PR executions and separately approved native KV/Entra/privacy/owner evidence
  - Completion remains unmet: Actual Entra/KV/RBAC/runtime/data privacy observations; Explicit owner approvals and two source reviews
  - [ ] A secret scanner runs on every pull request and over the full history of the merged repository; zero findings allowed.
  - [ ] A config lint fails unless the Application Insights connection string appears only as a `@Microsoft.KeyVault(...)` reference in App Service and Functions settings and as a Key Vault-backed named value for the APIM logger; the Storefront receives it at deploy time, never from a committed file.
  - [ ] `infra/params/poc.bicepparam`, `demos/` scripts and generated `evidence/` are inside the scan scope.
  - [ ] A seeded fake secret in a fixture makes the job fail.

  #### Child tasks

    - [ ] **GATE-03.1 - Run the secret scan on every pull request and over full history in CI**
      - Executor: R8.
      - Prerequisites: The existing `tools\security\repository.mjs` scanner and `Run-SecurityGates.ps1`; a hosted pull-request runner. No Azure access, secret or deployment is required.
      - Deliverable: One workflow file, `.github\workflows\secret-scan.yml`, that runs the existing scanner on every pull request and, from a full-history checkout, over the merged history.
      - Acceptance: A pull request containing the existing seeded fake-secret fixture fails the job and the clean tree passes. The scan scope includes `infra\params\poc.bicepparam`, `demos\` scripts and generated `evidence\`; the full-history step reports zero findings or fails the job with locations and rule IDs only, never the matched value. The workflow uses no repository secret and does not change the scanner's rules.
    - GATE-03.1: **To Do — construction-only / NOT CERTIFIED**. Review the frozen workflow source and obtain separately approved actual hosted clean/seeded PR executions; local synthetic-history evidence is construction-only.
      Waiting on: Actual hosted pull-request runner execution is unavailable without an approved PR/runner window

- [ ] **#8 GATE-04 · Telemetry data-safety scan**
  Dissatisfier · logical R8 · CD3 40.0 · 1.5 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] A scan over every Application Insights / Log Analytics table in the certification window fails on JWT-shaped strings, `Authorization` or cookie values, request or response bodies, email addresses, UPNs, raw Entra object IDs, SQL literals or bound parameters, and Redis keys, values, scripts or arguments.
  - [ ] A config check fails unless APIM frontend and backend body bytes are 0, the logged-header allowlist holds only `x-business-invocation-id`, JDBC statement capture is sanitized or off, and Redis argument capture is off.
  - [ ] Seeded forbidden values sent through the negative controls of Demos 12 and 13 are caught: the seeded run fails and the clean run passes.
  - [ ] Results are saved under `evidence/` and linked from the Data safety row.

- [ ] **#10 GATE-10 · Identifier-integrity guard**
  Dissatisfier · logical R8 · CD3 39.0 · 1 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] A query over the certification window fails if any OperationId, Id or ParentId equals an APIM request ID, an Entra request or correlation ID, a CloudEvent `id`, a Service Bus MessageId or a `business.invocation_id`.
  - [ ] Fails if `business.invocation_id` appears as a custom-metric dimension or is read on any authentication or authorization code path.
  - [ ] Fails on any business ID that is not an opaque UUIDv4 or ULID, or that embeds customer, user or order data.
  - [ ] Fails if Entra request or correlation IDs appear anywhere except the separate security-approved attribute.
  - [ ] A seeded fixture for each case makes it fail.

- [ ] **#14 INF-02 · Key Vault and Key Vault-reference wiring**
  Satisfier · logical R8 · CD3 68.0 · 0.5 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] `contoso-corr-poc-kv` deploys with RBAC authorization and purge protection, and no secret values in templates or parameters.
  - [ ] A reusable Bicep module grants each app's managed identity read access to named secrets only and emits `@Microsoft.KeyVault(...)` reference strings for app settings.
  - [ ] An explicitly approved SDK bootstrap generates at least 256 bits of HMAC material with a cryptographically strong RNG in memory and stores it as a named Standard Key Vault secret version. Generation is client-side, not falsely described as vault-side entropy. No secret value enters source, parameters, files, argv, transcripts, logs or evidence; provenance, version/epoch, readers and rotation are reviewed.
  - [ ] GATE-03 passes against the module and its parameters.

- [ ] **#37 IDN-01 · Entra authentication and safe identity attributes**
  Satisfier · logical R8 · CD3 34.0 · 1 d · needs ADR-01, JVM-01, WEB-01
  - Phase: fresh-av23-probe-tools-root; scope: construction.
  - Next action: IDN-01.2 is construction Done after R4/R5 each executed 13 exact portable-probe controls on the same nine current inputs. Current installed-agent/per-JVM/Portal wire and native dual-token/identity acceptance remain To Do.
  - Waiting on: Current source-built and loaded Java/Portal runtime handoff; Approved deployed Gateway/Entra negative controls and privacy/owner acceptance
  - [ ] Microsoft Entra ID authenticates the Storefront and the APIs through the actual dual-token chain on the deployed Gateway (INF-04): caller token validated at the Gateway, independent Gateway managed-identity proof and Orders → Inventory token verified at each API. Native negative controls are refused: missing, forged, expired, wrong-audience or wrong-role tokens, a workload principal given a human pseudonym, and a caller without demo/control permission. Authorization failures stay correlated to the request span.
  - [ ] An attribute allowlist permits only authentication outcome and policy or role category; no JWTs, refresh tokens, Authorization headers or claims bundles.
  - [ ] Entra request and correlation IDs, when kept, sit only in the separate security-approved attribute and never replace W3C IDs. Production identity attempts (JWKS retrieval and managed-identity token acquisition, including retries) send no W3C or business headers to Microsoft identity endpoints (AV-23, server side), proven by native wire evidence for every Java API/worker JVM and the Portal Node process; the raw unfiltered transport stays a recorded negative control.

  #### Child tasks

    - [ ] **IDN-01.1 - Run the native dual-token negative-control matrix**
      - Executor: R8.
      - Prerequisites: An approved deployed Gateway (INF-04), Entra app registrations and roles with Key Vault wiring (INF-02), the reviewed Orders and Inventory authenticators and the GATE-04 original-intake interface, plus a separately approved bounded native window. Local synthetic-JWT runs construct the matrix only.
      - Deliverable: One matrix runner and source-bound receipt covering, through the deployed Gateway, missing, forged, expired, wrong-audience and wrong-role caller tokens; a missing or invalid Gateway managed-identity proof; a missing or invalid Orders to Inventory token; a workload principal presented with a human pseudonym; and a caller without demo/control permission.
      - Acceptance: Every case is refused at the tier that owns the check, the authorization-failure telemetry joins the same request trace and span, and no JWT, claim or Authorization value reaches Application Insights (GATE-04 original-column scan). A valid-token positive control passes. A case that is accepted, refused at the wrong tier or uncorrelated fails; fixtures and expected-role maps are not native evidence.

    - [x] **IDN-01.2 - Remove the session-folder default from the AV-23 Java probe**
      - Executor: R8.
      - Prerequisites: The documented `CONTOSO_PORTABLE_TOOLS_ROOT` convention.
      - Deliverable: One change to `tools\security\Run-JavaAuthPropagationProbe.mjs` that removes its absolute `.copilot\session-state` default for the portable tools root.
      - Acceptance: Run without the variable, the probe exits with an explicit missing-prerequisite error naming it; with it set, the existing AV-23 tests and the agent, extension and SDK hash checks behave as before. A source test fails on an absolute user-profile or session-state path in the file.

    - [ ] **IDN-01.3 - Retake the AV-23 header isolation on the current build for every Java JVM**
      - Executor: R8.
      - Prerequisites: IDN-01.2; the pinned agent and sampler artifacts verified against `config\versions.lock.json`; current built security-core, Orders, Inventory and worker artifacts. No Azure access is required for the local retake; native Entra and managed-identity endpoints stay a separate approved qualification.
      - Deliverable: One source-bound receipt set from the existing probe and `av23-check.mjs` covering the Orders, Inventory, Fulfillment, Notify and Aggregator launch paths, including each worker's default identity client and the installed consumer, with jar-member lineage showing which HTTP client class was actually used.
      - Acceptance: For JWKS retrieval and managed-identity token attempts, retries included, none of the W3C, baggage, legacy and business correlation headers listed in `services\security-core\docs\AV23.md` reaches the wire while the eligible identity CLIENT span is still produced in the same provider. The raw unfiltered transport stays a recorded negative control and a seeded header leak fails. Historical failed receipts stay unchanged; the report claim changes only through `verify:invalidate` rules.

    - [ ] **IDN-01.4 - Capture current Portal Node-process AV-23 wire evidence**
      - Executor: R8.
      - Prerequisites: The existing `tools\security\Run-NodeAuthPropagationProbe.mjs`, the current Portal build and its locked identity dependencies. No Azure access is required for the local capture.
      - Deliverable: One source-bound receipt from the Node probe for the Portal's JWKS and managed-identity token paths on the current build, recording the Node runtime and package versions actually loaded.
      - Acceptance: JWKS and managed-identity attempts, retries included, carry no W3C, baggage, legacy or business correlation header, while the Portal's outbound Gateway calls still carry `traceparent`. A seeded header leak fails. Local fixture endpoints are labelled and never count as Entra or managed-identity evidence.
    - IDN-01.1: **To Do — construction-only / NOT CERTIFIED**. Run the dual-token negative matrix through the actual approved Gateway and both APIs, preserving current wire and effect evidence without retaining tokens.
      Waiting on: Deployed Gateway/APIs and Entra registrations/grants; Approved bounded native window and safe original-wire observer
    - IDN-01.2: **Done — construction-only / NOT CERTIFIED**. AV-23 portable prerequisite construction is independently complete: R4/R5 each executed 13 controls on nine current inputs. Installed-agent/per-JVM/Portal wire and native identity remain To Do.
      Evidence: [R4 executed review](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R4/review-R8-IDN01.2-v1/review.json).
      Evidence: [R5 executed review](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R5/review-r8-idn01-20261102-a20e70fa-01/receipt/review.json).
    - IDN-01.3: **To Do — construction-only / NOT CERTIFIED**. Use a current R4 source-built/installed Java lineage handoff and approved bounded local wire capture to retake every required JVM's AV-23 controls; do not reuse historical epochs.
      Waiting on: Current per-JVM installed-agent/artifact/dependency handoff; Actual current header-isolation wire receipts and independent reviews
    - IDN-01.4: **To Do — construction-only / NOT CERTIFIED**. Freeze the actual loaded Portal build/dependency scope and execute its bounded wire header-isolation controls with current source/byte correspondence.
      Waiting on: Current loaded Portal build and dependency handoff; Actual bounded current Portal wire capture; source/typechecking alone is insufficient

- [ ] **#38 IDN-02 · HMAC pseudonymization and key rotation**
  Satisfier · logical R8 · CD3 58.0 · 0.5 d · needs IDN-01, INF-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] User analytics uses a secret-keyed HMAC over a stable internal subject; the key lives in Key Vault.
  - [ ] Key rotation, access control and retention are documented and approved by the privacy owner.
  - [ ] A test proves no plain hash of an email address or object ID appears in telemetry.

- [ ] **#51 DEM-13 · Contoso Demo 13: Identity and privacy enrichment**
  Satisfier · logical R8 · CD3 52.0 · 0.5 d · needs GATE-04, GATE-10, DEM-00, IDN-01, IDN-02
  - Phase: scenario-adapter-required-native-blocked; scope: construction.
  - Next action: Ship Demo 13's own scenario adapter (DEM-13.1, after IDN-01.1 and IDN-01.3) against the reviewed shared DEM-00 adapter contract; the closing clause now forbids a stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback. Show only the HMAC pseudonym and authentication-outcome category through the dual-token chain, with the AV-23 identity-client header isolation (IDN-01). Run.ps1 returned FAIL D_MISSING_ADAPTER at commit 7279cd3.
  - Waiting on: Reviewed DEM-00.1 shared adapter contract and Demo 01 native qualification; This demo's own reviewed scenario adapter; IDN-01 native dual-token and AV-23 evidence and the privacy owner decision; Approved deployed target, identities and a separately approved bounded native window
  - [ ] Telemetry carries only the HMAC pseudonym and the authentication-outcome category.
  - [ ] No JWTs, claims or Entra IDs are used as trace IDs (GATE-10) and the classification scan is clean (GATE-04).
  - [ ] Negative control: an attempt to capture a forbidden header is rejected or redacted.
  - [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-13.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

  #### Child tasks

    - [ ] **DEM-13.1 - Ship the Demo 13 identity and privacy adapter**
      - Executor: R8.
      - Prerequisites: DEM-00.1, IDN-01.1 and IDN-01.3, plus the reviewed IDN-02, GATE-04 and GATE-10 interfaces. Native execution additionally needs the approved deployed Gateway, Entra roles and a separately approved bounded native window.
      - Deliverable: One `tools\verification\adapters\demo13-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 13.
      - Acceptance: The shipped `demos\13\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It drives the dual-token chain with a workload and a human caller and asserts that telemetry carries only the HMAC pseudonym and the authentication-outcome category, that no JWT, claim or Entra ID is used as a trace ID (GATE-10), that the classification scan is clean (GATE-04), that a forbidden-header capture attempt is rejected or redacted, and that AV-23 header isolation holds. Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset restores the run-owned baseline and leaves unowned state unchanged, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).
    - DEM-13.1: **To Do — construction-only / NOT CERTIFIED**. After the adapter, dual-token and Java AV-23 prerequisites, observe pseudonym-only telemetry over the real chain with current original-column privacy evidence.
      Waiting on: DEM-00.1; IDN-01.1; IDN-01.3; Approved actual identity/privacy runtime and native window

- [ ] **#53 DEM-11 · Contoso Demo 11: Spoofed and malformed message context**
  Satisfier · logical R8 · CD3 42.0 · 0.5 d · needs DEM-00, MSG-01, MSG-02
  - Phase: scenario-adapter-required-native-blocked; scope: construction.
  - Next action: Ship Demo 11's own scenario adapter (DEM-11.1) against the reviewed shared DEM-00 adapter contract; the closing clause now forbids a stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback. The catalog requires authenticated malformed and spoofed delivery negative controls with a safe bounded rejection category. Run.ps1 returned FAIL D_MISSING_ADAPTER at commit 7279cd3.
  - Waiting on: Reviewed DEM-00.1 shared adapter contract and Demo 01 native qualification; This demo's own reviewed scenario adapter and authenticated spoofed-delivery controls; Approved deployed target, identities and a separately approved bounded native window
  - [ ] Spoofed and malformed message context follows ADR A03: a new root and bounded rejection outcome; raw values are absent. Any displayed digest follows the reviewed safe-input/key policy, rather than treating an arbitrary unkeyed personal-data hash as safe.
  - [ ] Negative control: the spoofed context is visibly refused.
  - [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-11.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

  #### Child tasks

    - [ ] **DEM-11.1 - Ship the Demo 11 spoofed-context adapter with an authenticated publisher**
      - Executor: R8.
      - Prerequisites: DEM-00.1 and the reviewed MSG-01 and MSG-02 contracts and ADR A03 rules. Native execution additionally needs the approved INF-06 broker, a publisher identity limited to a run-owned entity and a separately approved bounded native window.
      - Deliverable: One `tools\verification\adapters\demo11-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, including a bounded authenticated publisher that delivers malformed and spoofed message context to a run-owned entity.
      - Acceptance: The shipped `demos\11\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. Delivery is authenticated, so the negative control exercises the consumer's validation rather than transport refusal; the adapter asserts a new root and a bounded rejection outcome, no raw value in telemetry, any displayed digest following the reviewed safe-input and key policy, and the spoofed context visibly refused. Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset removes only run-owned messages, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).
    - DEM-11.1: **To Do — construction-only / NOT CERTIFIED**. After DEM-00.1, run real spoofed/malformed broker-message controls and prove rejection effects and preserved trust boundaries with run-owned reset.
      Waiting on: DEM-00.1; Approved actual broker/runtime identities, native wire/effect capture and reset

- [ ] **#68 INF-07 · Access and retention governance**
  Satisfier · logical R8 · CD3 24.0 · 1 d · needs ADR-01, INF-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Resource-context RBAC follows the ADR A05 map; an access test shows an unauthorized identity cannot query or export telemetry, with audit evidence saved.
  - [ ] Retention for tables that carry `business.invocation_id` follows ADR A02.
  - [ ] A purge procedure is documented and tested on synthetic data.
  - [ ] Owners for topology, RBAC, retention and purge are named for the Governance row.

### R9: 9 cards

- [ ] **#3 GATE-06 · VERIFY register with fail-closed assumption tests**
  Dissatisfier · logical R9 · CD3 53.0 · 1 d · needs none
  - Phase: fresh-official-beta-package-classification; scope: construction.
  - Next action: Final beta-package classification and R7 review each passed thirteen tests at the stable register epoch. R1's second child review remains required; all 635 numeric/support/deployed VERIFY claims remain OPEN.
  - Waiting on: Second current child review by R1; Official-source content, support/GA and approved deployed-value verification for all remaining OPEN claims
  - Completion remains unmet: Stable R7 diagnostics/intake successor and original corrected-source R7/parent R4 reviews before native adoption; Actual direct conditional runtime/carrier factory execution/private graph positive after parent port and separately granted native window; Official source-content and approved deployed value confirmations; Actual Azure observer/runtime roster/full native path evidence; Global telemetry/privacy/performance/owner signoffs; Parent R4 current API capture/source and complete completion-source coverage; current accepted R7 board3 is not full R9 completion
  - Construction evidence: [R7 exact beta/source classification thirteen controls](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R7/gate-06.1-review-v1/review.json) (CURRENT_SOURCE_UNIT_ONLY_NOT_FULL_GATE / NOT CERTIFIED).
  - [ ] Each pinned or assumed value (Java agent version, APIM API version and SKU behaviour, JS SDK version, Functions Java worker and JDK 25 support, Azure Managed Redis SKU and region, Java messaging SDK versions, workspace table schema) has a `VERIFY:` entry with the exact official page, an owner and a status.
  - [ ] Each entry has an automated test that fails closed when the deployed or locked value differs from the recorded value or the source link is missing.
  - [ ] A lint fails on any version, API version, SKU capability, GA date or support-matrix claim in the repository that has no register entry.
  - [ ] Open items are listed in README.md and in the executive summary.

  #### Child tasks

    - [ ] **GATE-06.1 - Classify the Portal's resolved beta Node packages from official sources**
      - Executor: R9.
      - Prerequisites: The `node-azure-exporter` entry in `config\certification-dependencies.json`, its VERIFY register rows and the locked Portal dependency tree; access to the official Microsoft package and support pages.
      - Deliverable: One reviewed register and manifest update that records, for `@azure/monitor-opentelemetry-exporter` 1.0.0-beta.46 and `@azure/opentelemetry-instrumentation-azure-sdk` 1.1.0-beta.1, the exact official page, owner and GA, preview or unsupported classification, or the documented decision to keep the Portal exporter outside the certification statement.
      - Acceptance: Each entry cites an official source that states the classification; without such a source it stays UNVERIFIED and the GATE-07 preview-isolation lint keeps it off the certified path. The register test fails closed when the locked version or the recorded source link changes. A lock pin, registry listing or successful local run is never accepted as a support claim.
    - GATE-06.1: **To Do — construction-only / NOT CERTIFIED**. Prior beta-classification/register receipts are historical after the checkout fixes. The two resolved beta packages and 635 open claims remain unverified; obtain two current source reviews without inferring GA/support/runtime clearance.
      Waiting on: Two current other-role executed reviews

- [ ] **#9 GATE-08 · Trace and span identity assertions (Invariants A, B, C)**
  Dissatisfier · logical R9 · CD3 40.0 · 1.5 d · needs none
  - Phase: finite-orders-root-exceptions-accepted-full-invariants-and-path-blocked; scope: construction.
  - Next action: Actual v7 Orders-only three trust-root exceptions plus four continuation/state/business/strict00 controls are accepted finite: epoch5795/graphbd926/c384 and Parent a2da. This is a private LocalValidate NOT_FULL_GRAPH contribution, not full A/B/C or link/path coverage. Keep all required Azure/native full-path evidence, unrun Inventory/Gateway/data/broker roles, contributor/emission ledgers, canaries and owner acceptance open. Formal live executor remains unenrolled; saved files cannot mint it. The Orders workflow and worker store boundaries in Invariant C are child GATE-08.1 (after ARC-01.1).
  - Waiting on: Actual deployed/runtime boundary-map correspondence and remaining unrun conditional roles; Actual native Azure observer and full-path emission/canary capture; Two current accepted source reviews
  - [ ] Given a known business ID or trace-id and a time window, asserts Invariant A: every row shares one non-zero 32-hex trace-id/OperationId, except documented trust-boundary roots.
    - Facet unit: INVALIDATED; [evidence](../../contoso-corr-poc/evidence/verification/focused/20261101T110748604Z-8a7395b4-87de-4f97-b19d-7268ad724923/preparation-tests.json).
    Whole clause remains unmet; partial local facets are not live acceptance.
  - [ ] Asserts Invariant B: every actual request/dependency span has a non-zero unique span-id, and every strict child's ParentId equals its parent's Id. Associated logs/events/exceptions may reference the same active span; their display/context IDs are not counted as new spans. Duplicate emitted span records are never hidden by de-duplication.
    - Facet unit: INVALIDATED; [evidence](../../contoso-corr-poc/evidence/verification/focused/20261101T110748604Z-8a7395b4-87de-4f97-b19d-7268ad724923/preparation-tests.json).
    Whole clause remains unmet; partial local facets are not live acceptance.
  - [ ] Asserts Invariant C: browser dependency → Gateway request → Gateway backend dependency → Orders server → Inventory server → JDBC and Redis client chain matches the expected boundary map; JDBC and Redis spans are client/dependency kind; no APIM request ID appears as a trace-id.
    - Facet unit: INVALIDATED; [evidence](../../contoso-corr-poc/evidence/verification/focused/20261101T110748604Z-8a7395b4-87de-4f97-b19d-7268ad724923/preparation-tests.json).
    Whole clause remains unmet; partial local facets are not live acceptance.
  - [ ] Fixture sets for each failure (split trace, duplicate span-id, wrong ParentId, missing hop) fail with a message naming the broken edge.
    Evidence: [clause 4](../../contoso-corr-poc/evidence/verification/focused/20261101T110748604Z-8a7395b4-87de-4f97-b19d-7268ad724923/preparation-tests.json) (unit, INVALIDATED).
  - [ ] Linked from the Trace identity and Span identity rows.

  #### Child tasks

    - [ ] **GATE-08.1 - Assert the Orders workflow and worker store boundaries in Invariant C**
      - Executor: R9.
      - Prerequisites: ARC-01.1 and the existing GATE-08 invariant library and fixture sets.
      - Deliverable: One extension of the shared Invariant C assertion and its fixture sets so the Orders workflow/outbox and worker messaging-store CLIENT spans are checked as children of their request, producer or PROCESS span using only the single boundary map.
      - Acceptance: A fixture trace with every store CLIENT span correctly parented passes; fixtures with a missing store span, a wrong parent, a non-CLIENT span kind and an undeclared store boundary each fail with a message naming the broken edge. Inventory's PostgreSQL and Redis chain behaviour is unchanged. These are assertion fixtures only and prove no native store span (DAT-01 clause 1, DEM-12 clause 1).
    - GATE-08.1: **To Do — construction-only / NOT CERTIFIED**. After ARC-01.1 is independently Done, add exact Orders workflow/worker store-boundary Invariant C assertions and seeded failures; retain native qualification separately.
      Waiting on: ARC-01.1; No new invariant implementation was dispatched below the four-owner threshold

- [ ] **#11 GATE-12 · Certification-boundary gate**
  Dissatisfier · logical R9 · CD3 34.0 · 1 d · needs none
  - Phase: fresh-report-source-freshness-and-node-ci-construction; scope: construction.
  - Next action: R9 released the seventeen-test source-current/history-preserving report helper and every-PR Node workflow. Orchestrator will regenerate its two outputs after final source freeze; hosted/lint/native acceptance remains To Do.
  - Waiting on: Second current source review by R1; GATE-11.2 and actual hosted PR execution; Approved native sampling/window/ACK/loss and accountable acceptance
  - [ ] 100% sampling on browser, APIM, JVMs and workers can only be switched on with a declared start and end; the check fails if any layer is still at 100% outside the window.
  - [ ] The certification statement names only the environment, the VERSIONS.md versions, the tested paths and the sampling configuration.
  - [ ] A CI rule marks the affected CERTIFICATION_REPORT.md rows "invalidated" when a dependency, runtime, agent, policy or message-schema file changes, until the regression suite passes again.
  - [ ] A seeded agent-version bump flips the affected rows to "invalidated".

  #### Child tasks

    - [ ] **GATE-12.1 - Run the Node gates and verification checks on every pull request**
      - Executor: R9.
      - Prerequisites: GATE-11.2 and the existing `npm test`, `board:check`, `verify:report`, `verify:register` and `demos:check` scripts.
      - Deliverable: One workflow file, `.github\workflows\ci-node.yml`, that runs those scripts from `contoso-corr-poc` on every pull request with the Node version required by `package.json`, the browser dependency installed and the Bicep compiler provisioned from the locked version or reported as an explicit skip.
      - Acceptance: A clean pull request passes. A seeded change to a pinned dependency, runtime, agent, policy or message-schema file without refreshed `verify:invalidate` output fails the `verify:report` step and names the invalidated rows (clause 3); a seeded stale board or register fails its own step. Bicep-gated tests that cannot run print their reason and are counted as skipped, not passed. The workflow deploys nothing, spends nothing and sends no native traffic.
    - GATE-12.1: **To Do — construction-only / NOT CERTIFIED**. Prior report/Node-CI receipts are historical after adding clean-checkout build preparation. Review the current workflow and runner with two other roles; GATE-11.2 and actual hosted clean/seeded PR execution remain required before Done.
      Waiting on: Two current other-role source reviews of checkout preparation and verification; GATE-11.2 and actual hosted pull-request execution

- [ ] **#12 GATE-13 · Evidence-integrity and gap-log gate**
  Dissatisfier · logical R9 · CD3 34.0 · 1 d · needs none
  - Phase: fresh-security-qualification-portability; scope: construction.
  - Next action: Final environment-required v3 and R7 each passed twelve current controls after final sampler imports. R1's second source review and independently enrolled native/runtime evidence remain unmet.
  - Waiting on: Second current child review by R1; Current independently enrolled runtime sources and approved native target/window
  - Completion remains unmet: Current independently enrolled live source and authentic untampered runtime packs; Approved native target/window and accountable completion
  - Construction evidence: [R7 current explicit-environment and immutable-byte controls](../../contoso-corr-poc/evidence/reviews/swarm-20261102/R7/gate-13.1-review-v3/review.json) (CURRENT_SOURCE_UNIT_ONLY_NOT_NATIVE_QUALIFICATION / NOT CERTIFIED).
  - [ ] Certification assertions read live Application Insights / Log Analytics rows only; a run fails if any assertion is fed by mocks or fixture rows.
  - [ ] Every pack under `evidence/demo-XX/<timestamp>/` carries the query text, non-secret resource identifiers, UTC timestamps, a config snapshot, the VERSIONS.md hash and a SHA-256 manifest; a tampered file fails verification.
  - [ ] A gap log records each case where documented and observed behaviour differ (claim, source, observed evidence, impact); the affected demo shows the observed behaviour and no code compensates for it.
  - [ ] Linked from the Repeatability row.

  #### Child tasks

    - [ ] **GATE-13.1 - Remove the session-folder default from the security client qualification**
      - Executor: R9.
      - Prerequisites: The documented `CONTOSO_PORTABLE_TOOLS_ROOT` convention for the portable Maven repository.
      - Deliverable: One change to `tools\verification\security-client-qualification.mjs` so the tool root and the `azure-core-http-okhttp` artifact path come from `CONTOSO_PORTABLE_TOOLS_ROOT`, not from a `.copilot\session-state` path.
      - Acceptance: With the variable unset the tool fails with an explicit missing-prerequisite error that names it. With a valid root the existing unit tests and `npm run verify:security-client` behave exactly as before, with no relaxed hash, epoch or lineage check. A source test fails when the file contains an absolute user-profile or session-state path.
    - GATE-13.1: **To Do — construction-only / NOT CERTIFIED**. Prior owner v3/R7 receipts are historical after the recorded-versus-current location guard repair. Review current checker bytes with two other roles; cloned historical paths still cannot grant current native/private qualification.
      Waiting on: Two current other-role reviews of the repaired location and tool-root controls

- [ ] **#16 CRT-01 · CERTIFICATION_REPORT.md template**
  Satisfier · logical R9 · CD3 58.0 · 0.5 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] One row per §24 criterion (Coverage, Trace identity, Span identity, No falsification, Async honesty, Durable lookup, Data safety, Operational stability, Backend usability, Governance, Repeatability) with demo(s), test(s) or gate(s), evidence path and pass/fail.
  - [ ] Includes the scoped certification statement block from GATE-12.
  - [ ] Includes sign-off rows for architecture, application, platform, SRE/observability, security/privacy and data owners.

- [ ] **#17 GOV-01 · Adjudication log and claim-labelling workflow**
  Delighter · logical R9 · CD3 82.0 · 0.5 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] DECISIONS.md has an adjudication log with: claim, each reviewer's label (Verified / Partially verified / Unsupported / Incorrect / Outdated), resolution, winning source and its evidence-hierarchy level.
  - [ ] The pull-request template requires review by at least two other roles and a label on every material technical claim.
  - [ ] The log states that majority vote is not evidence; a resolution without a source is rejected in review.
  - [ ] The first conflict between the two attached sources (`x-business-correlation-id` in the reference pattern versus `x-business-invocation-id` in prompt §3) is logged and resolved in favour of the prompt.

  #### Child tasks

    - [ ] **GOV-01.1 - Commit the pull-request template that enforces two-role review and claim labels**
      - Executor: R9.
      - Prerequisites: The GOV-01 adjudication-log vocabulary in `DECISIONS.md`.
      - Deliverable: One `.github\pull_request_template.md` requiring the author role, two other-role reviewers who are different people or agents, a Verified, Partially verified, Unsupported, Incorrect or Outdated label with an evidence link on every material technical claim, the no-majority-vote rule, and a reminder that nothing in the change grants native authority or certification.
      - Acceptance: A repository test parses the template and fails when any required item is absent; a seeded copy without the claim-label item fails. The template links to `DECISIONS.md` and adds no approval authority beyond the Definition of Done.
    - GOV-01.1: **To Do — construction-only / NOT CERTIFIED**. R1 independently review the frozen real PR template/checker after R7's four-test current-source acceptance. Template source is not actual PR review or branch-protection signoff.
      Waiting on: Second current other-role review by R1

- [ ] **#46 DEM-00 · Demo harness: one-command run, evidence capture, reset**
  Delighter · logical R9 · CD3 24.0 · 1.5 d · needs GATE-13, INF-01, OBS-01, OBS-02
  - Phase: supplied-operation-subset-frozen-full-adapter-blocked; scope: construction.
  - Next action: R9 supplied browser/privacy operations and a source-only construction report; author and coordinator each passed 29 focused construction/runner controls. The report intentionally exits 2 and does not export createAdapter/v1 because five real operations remain absent. Complete those reviewed production operations before advertising a runnable native adapter, then obtain actual two-cycle/interrupted-run evidence.
  - Waiting on: Independent emission/canary/gateway-wire operation supplying actual execution expectation, ledger and proof artifacts; Independently enrolled authenticated query/transport capability; Reviewed native sampling apply/observe/restore/stop operations and complete participant observer; Independently reviewed bridge and actual hash-pinned integrated classpath/operator authentication/resources; Reviewed authenticated durable recovery callable by a new Reset.ps1 process; Per-demo scenario adapters for Demos 02-15 (each DEM-02 to DEM-15 closing clause) once the shared adapter contract is reviewed; all fifteen Run.ps1 entry points returned FAIL D_MISSING_ADAPTER at commit 7279cd3
  - Completion remains unmet: Reviewed OBS-02.1, DAT-01.1, DEM-01.1 and OBS-01 interfaces; Actual approved target/authentication inputs, native traffic budget and sampling/cleanup window; Actual native observer enrollment, full required boundaries, privacy and two-cycle/interrupted-run reset evidence; All parent completion dependencies and current independent source reviews
  - [ ] The shipped Windows entry point `demos\XX\Run.ps1` drives synthetic traffic with a known `business.invocation_id`, then saves raw `traceparent` at trusted test points, AI rows, KQL output, screenshot slots for Application Map and Transaction Diagnostics, and config snapshots to `evidence/demo-XX/<timestamp>/`.
  - [ ] Before asserting, it confirms certification mode (OBS-01) is on for the run window; if not, the run is marked inconclusive rather than passed or failed.
  - [ ] It runs the demo's assertion and prints PASS or FAIL with the §19 and §24 IDs.
  - [ ] `demos\XX\Reset.ps1` returns flags, seed data, queues and sampling to baseline and verifies it.
  - [ ] A demo folder template carries Purpose, Pre-state, Run, Live show, Evidence capture, Assertion and Reset.

  #### Child tasks

    - [ ] **DEM-00.1 - Ship the concrete native Demo 01 traffic adapter**
      - Executor: R9.
      - Prerequisites: Reviewed OBS-02.1, DAT-01.1 and DEM-01.1 outputs; reviewed OBS-01 sampling/control interfaces; actual approved target/authentication inputs and a separately approved bounded native window for execution.
      - Deliverable: A supplied `tools\verification\adapters\demo01-runtime.mjs` exporting `createAdapter()` with the existing `contoso.demo-adapter.v1` contract, composing the shipped browser, collector, sampling and run-owned preparation/reset implementations.
      - Acceptance: The shipped `demos\01\Run.ps1` loads the reviewed adapter by its actual SHA-256 and completes prepare, execute, drain, collect, scanPrivacy, observeSampling, stopTraffic and reset against the approved native target; `restoreCapturedRun` also restores a saved run-owned baseline. Every required method has a concrete implementation: no stubs, fixture PASS or request that the presenter write a module/callback. Only approved configuration, authentication and reviewed source identity are supplied externally. The native pack passes the existing scoped assertions while BootstrapValidate remains NOT CERTIFIED.

    - [ ] **DEM-00.2 - Prove consecutive runs and interrupted-run recovery**
      - Executor: R9.
      - Prerequisites: DEM-00.1 and the existing GATE-08/GATE-13 assertion/evidence interfaces; an approved traffic budget and sampling/cleanup window covering the complete regression.
      - Deliverable: One automated two-cycle-and-interruption regression using the supplied adapter and independently checked run-owned baseline receipts.
      - Acceptance: Execute two consecutive run -> capture -> assert -> reset cycles with distinct run/business IDs; both pass with all required native boundaries and no stale evidence reuse. After each cycle, compare the actual data/cache, flags, owned messages and sampling with the captured baseline and prove unowned state unchanged. Interrupt a separate invocation after traffic starts: it must report failure, stop/drain traffic and restore baseline within the runner's declared finite cleanup deadlines. Missing spans, a timeout, failed cleanup or baseline mismatch fails the regression; local fixtures cannot satisfy its native acceptance.
    - DEM-00.1: **To Do — construction-only / NOT CERTIFIED**. Replace the source-only adapter contract with supplied real operations and saved-baseline durable recovery only after the actual golden-path prerequisites are qualified.
      Waiting on: DAT-01.1; DEM-01.1; OBS-02.1; Actual independently enrolled execution/query/sampling/preparation/reset/recovery operations
    - DEM-00.2: **To Do — construction-only / NOT CERTIFIED**. Run two distinct complete native run/capture/assert/reset cycles and a separate interrupted cleanup regression with exact baseline restoration.
      Waiting on: DEM-00.1; Approved actual runtime/reset lease and native capture window

- [ ] **#72 CRT-03 · Residual limitations and §23 coverage map**
  Satisfier · logical R9 · CD3 18.0 · 1 d · needs none
  - Phase: deferrals-and-report-currency-clauses-tightened; scope: construction.
  - Next action: Clause 2 now lists the deferrals recorded in ADR A04 and docs\RESIDUAL_LIMITATIONS.md (native Functions-binding parity, automatic JDBC/Redis instrumentation qualification, third-party exporter parity) and clause 3 requires supporting status reports to name their source commit and quote counts only from current receipts. docs\TEST_COVERAGE_REPORT.md cites commit 63a2a5d with Node 419 and Java 182 tests where the suites at 7279cd3 run Node 492 and Java 213: regenerate it from current receipts or label it historical (child CRT-03.1).
  - Waiting on: Current local receipts for the Node and Java suites at the reviewed commit; Refreshed or historical-labelled supporting reports; Two accepted current documentation reviews
  - [ ] Every §20 failure mode is marked covered (with the card, demo or gate) or not covered (with the reason).
  - [ ] Every §23 production-ready item is marked in scope (with evidence) or explicitly deferred, including the Azure Cache for Redis migration plan (F06), production rollout (J03-J10) and the deferrals recorded in ADR A04 and `docs\RESIDUAL_LIMITATIONS.md` (native Functions-binding parity, automatic JDBC/Redis instrumentation qualification, third-party exporter parity).
  - [ ] Delivered as §8 item 8 and satisfies the first §9 check; every supporting status report under `docs\` (test coverage, Java validation, observability) names its source commit and quotes counts only from current receipts, or is labelled historical when sources change.

  #### Child tasks

    - [ ] **CRT-03.1 - Refresh or label the test-coverage report**
      - Executor: R9.
      - Prerequisites: Current Node and Java test receipts on a recorded source commit.
      - Deliverable: One update of `docs\TEST_COVERAGE_REPORT.md` that either regenerates its commit and counts from those receipts or labels the whole report HISTORICAL with the commit it describes (currently `63a2a5d`).
      - Acceptance: A static check fails when the report quotes a total that differs from the receipt it cites, names no source commit, or lacks a HISTORICAL label while its source closure has changed. Skipped tests are reported as skipped, not as passes.
    - CRT-03.1: **To Do — construction-only / NOT CERTIFIED**. Historical coverage source/count guard passed five focused tests; R1/R7 independently review current exact inputs before the construction child can be Done.
      Waiting on: Two current other-role executed documentation reviews

- [ ] **#75 CRT-02 · Certification run, sign-off package and executive summary**
  Satisfier · logical R9 · CD3 19.0 · 2 d · needs GATE-01, GATE-02, GATE-03, GATE-04, GATE-05, GATE-06, GATE-07, GATE-08, GATE-09, GATE-10, GATE-11, GATE-12, GATE-13, CRT-01, CRT-03, DEM-01, DEM-02, DEM-03, DEM-04, DEM-05, DEM-06, DEM-07, DEM-08, DEM-09, DEM-10, DEM-11, DEM-12, DEM-13, DEM-14, DEM-15, DOC-01, DOC-02, DOC-03, DOC-04, INF-07, OBS-05
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] With GATE-05 passed, a bounded certification window runs all 15 demos with every gate green; VERSIONS.md is frozen and hashed.
  - [ ] CERTIFICATION_REPORT.md has evidence links and pass/fail for every §24 row.
  - [ ] R9 confirms the §5 non-negotiables and every §9 checklist item with evidence.
  - [ ] The executive summary (10 lines or fewer) states what was built, the certification status and the open VERIFY items, and the output is returned in §8 order; Contoso Eval A/B stay outside it.

## In Progress (0 of 9)

No cards in this column.

## Done (0)

No card has met every acceptance and review requirement yet.

## Definition of Done

Acceptance, current evidence, required other-role reviews, approved naming/safety invariants, and completion dependencies must all be satisfied. NOT RUN, stale, fixture-only, or unsupported evidence is never a pass.
