# Contoso End-to-End Correlation POC: force-ranked backlog

**Covers:** all the work the *Ensemble Prompt: Contoso End-to-End Correlation POC and Demo Suite* expects the ensemble to produce: the repository, the 15 demos, the documents and the certification package.  
**Sources:** the Ensemble Prompt ("Prompt"); *Azure End-to-End Correlation Architecture*, evidence cutoff 31 October 2026 ("Brief", the source of record); *Azure End-to-End Correlation Reference Pattern* (supporting input; where it differs, the Prompt and the Brief win).  
**Companion:** Contoso_E2E_Correlation_POC_Kanban.md holds the same 78 cards on the board.  
**Prepared:** 31 October 2026

## Execution policy

- Preparation is authorized for a new Azure POC in `centralus`, with App Service
  APIs/Portal and Java Functions workers. Costs and quotas require explicit
  approval before provisioning.
- The Architecture Brief and supporting reference-pattern PDFs were supplied
  for source grounding. The Prompt and Brief still govern source conflicts.
- There is no Blocked state. Work that cannot progress returns to To Do with
  its unmet prerequisite, evidence, and next action recorded.
- When stuck, convene a council and vote on the next executable path. Votes
  select actions; the evidence hierarchy adjudicates technical claims.
- Do not close a card on a draft, a fixture-only run, or a vote. Acceptance
  criteria, cross-review, applicable gates, and linked evidence remain required.
- The user approved separate construction and completion readiness: reviewed
  interfaces may support construction before predecessor Done, but every
  completion dependency remains required for Done. Bootstrap traffic is
  explicitly NOT CERTIFIED and may generate gate evidence without assuming
  that the gates will pass.
- Approved adjudications retain canonical Contoso roles while allowing a frozen
  legal physical naming map; use honest client-SDK HMAC generation stored in
  Standard Key Vault, SDK-managed Java Functions, safe manual data CLIENT spans,
  workload-only Portal SSR/Storefront cohosting, and disclosed public browser
  ingestion/Event Grid relay boundaries. Native-binding and automatic data
  qualification are separate from the selected certification path.

## At a glance

| Measure | Value |
|---|---|
| Atomic items | 78 |
| Kano mix | 13 dissatisfiers · 57 satisfiers · 8 delighters |
| Dissatisfiers : satisfiers + delighters | 13 : 65 = **1 : 5** |
| Estimated effort | 70 ideal days (relative sizing) |
| Longest dependency chain to certification sign-off | 13 days: ADR-01 → ADR-02 → INF-01 → INF-03 → JVM-01 → JVM-04 → OBS-02 → DEM-00 → DOC-03 → DOC-04 → CRT-02 |
| Ranked first | GATE-03, GATE-07, GATE-06, GATE-11, GATE-01 |

## How the ranking works

### Kano labels

Judged from the point of view of the Contoso review audience (the architecture, application, platform, SRE/observability, security/privacy and data owners who sign off under Brief §19) and the presenter.

| Label | Meaning here | How it's built |
|---|---|---|
| **Dissatisfier** | A guarantee the audience takes for granted. If it's missing or breached, certification is void, whatever else ships. | One fail-closed gate per guarantee, with a seeded failure that proves the gate fires. |
| **Satisfier** | Adds proof coverage or usable documentation. Each one raises confidence in proportion; each one missing narrows what can be certified or shown. | A build, demo or document card. |
| **Delighter** | Not expected. Makes the proof faster to run, easier to see, or extends it past certification. Missing it goes unnoticed. | A build or document card. |

### CD3 scoring

**CD3 = Cost of Delay ÷ Duration.**

- **Cost of Delay (CoD) = V + T + R**, each scored 1, 3, 5, 8, 13 or 20. The sources hold no financial data, so CoD is relative, not currency.
  - **V, value:** what the card contributes to certification and the demos.
  - **T, time criticality:** 20 = blocks other work from starting (decisions, most gates); 13 = on the build path the demos need (phases B to F); 8 = needed before the demos and certification run (phases G to I); 5 = demo packaging and documents before sign-off; 3 = late documents; 1 = optional lanes after certification.
  - **R, risk reduction and enablement:** the higher of the risk the card retires and the number of cards it unblocks (1 card = 3, 2 = 5, 3 to 4 = 8, 5 to 7 = 13, 8 or more = 20).
- **Duration:** ideal days for the owning role, including deploy-and-verify time. Relative sizing for ranking, not a schedule.

### Ranking rules (applied in code, in this order)

1. **Dissatisfiers first**, highest CD3 first. Kano puts must-be needs before performance and attractive ones, and each gate protects every card after it.
2. **Satisfiers ahead of delighters**, highest CD3 first, unless CD3 justifies otherwise: a delighter goes ahead of the best available satisfier only when its CD3 is at least **1.5×** that satisfier's.
3. **Dependencies.** No card ranks above a card it needs. A card that a higher-priority card is waiting on takes that card's priority, scored as a group: the group's total CoD ÷ the group's total duration. This is the only way a card ranks above its own CD3; those cards are marked ↑. A delighter that a satisfier needs is ranked as that satisfier.
4. **Ties:** higher CoD, then shorter duration, then earlier build phase.

### What makes a card atomic

One owner role, one artifact or change, one verifiable outcome, 2 days or less, testable on its own.

Roles: R1 Lead Architect; R2 Front-end Engineer; R3 API Platform Engineer; R4 Java/OTel Engineer; R5 Async/Integration Engineer; R6 Data-Tier Engineer; R7 Observability/KQL Engineer; R8 Security & Privacy Red Team; R9 Verifier / Adjudicator.

Unranked child checklists below decompose existing parent acceptance, not additional cards or estimates. Each child has one existing implementation executor, explicit prerequisites, one bounded deliverable and independently verifiable acceptance, and meets the same atomic test as a card: one owner role, one artifact or change, one verifiable outcome, two ideal days or less and testable on its own. A deliverable that cannot meet it is split into further children, not enlarged. All children start To Do and retain the existing WIP/review rules; child checkmarks never substitute for parent evidence, waive completion dependencies or authorize deployment, spending or native traffic. Construction may use reviewed interfaces before predecessor Done; native qualification still requires the separately approved runtime and bounded execution window.

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

## Force-ranked backlog

| Rank | ID | Item | Kano | Owner | V | T | R | CoD | Days | CD3 | Needs | Note |
|---:|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|
| 1 | GATE-03 | Secret-free repository and Key Vault-reference check | Dissatisfier | R8 | 13 | 20 | 20 | 53 | 0.5 | 106.0 | none |  |
| 2 | GATE-07 | Removed-claims and preview-isolation lint | Dissatisfier | R1 | 8 | 20 | 13 | 41 | 0.5 | 82.0 | none |  |
| 3 | GATE-06 | VERIFY register with fail-closed assumption tests | Dissatisfier | R9 | 13 | 20 | 20 | 53 | 1 | 53.0 | none |  |
| 4 | GATE-11 | Deployability and naming-conformance gate | Dissatisfier | R1 | 13 | 20 | 20 | 53 | 1 | 53.0 | none |  |
| 5 | GATE-01 | Protocol-integrity static scan | Dissatisfier | R3 | 13 | 20 | 20 | 53 | 1 | 53.0 | none |  |
| 6 | GATE-02 | Single-provider-per-JVM check | Dissatisfier | R4 | 13 | 20 | 20 | 53 | 1 | 53.0 | none |  |
| 7 | GATE-09 | Async-honesty assertions | Dissatisfier | R5 | 13 | 13 | 20 | 46 | 1 | 46.0 | none |  |
| 8 | GATE-04 | Telemetry data-safety scan | Dissatisfier | R8 | 20 | 20 | 20 | 60 | 1.5 | 40.0 | none |  |
| 9 | GATE-08 | Trace and span identity assertions (Invariants A, B, C) | Dissatisfier | R9 | 20 | 20 | 20 | 60 | 1.5 | 40.0 | none |  |
| 10 | GATE-10 | Identifier-integrity guard | Dissatisfier | R8 | 13 | 13 | 13 | 39 | 1 | 39.0 | none |  |
| 11 | GATE-12 | Certification-boundary gate | Dissatisfier | R9 | 13 | 8 | 13 | 34 | 1 | 34.0 | none |  |
| 12 | GATE-13 | Evidence-integrity and gap-log gate | Dissatisfier | R9 | 13 | 8 | 13 | 34 | 1 | 34.0 | none |  |
| 13 | GATE-05 | JDK 25 compatibility gate | Dissatisfier | R4 | 20 | 20 | 20 | 60 | 2 | 30.0 | none |  |
| 14 | INF-02 | Key Vault and Key Vault-reference wiring | Satisfier | R8 | 8 | 13 | 13 | 34 | 0.5 | 68.0 | none |  |
| 15 | JVM-05 | VERSIONS.md, Java SBOM and agent pin | Satisfier | R4 | 8 | 13 | 13 | 34 | 0.5 | 68.0 | none |  |
| 16 | CRT-01 | CERTIFICATION_REPORT.md template | Satisfier | R9 | 13 | 8 | 8 | 29 | 0.5 | 58.0 | none |  |
| 17 | GOV-01 | Adjudication log and claim-labelling workflow | Delighter | R9 | 8 | 20 | 13 | 41 | 0.5 | 82.0 | none | Delighter ahead on CD3: 82.0 is 1.50× the best available satisfier (ADR-01 group, 54.7) |
| 18 | ADR-01 | ADRs A01-A03: causality, business ID, trust policy | Satisfier | R1 | 8 | 20 | 20 | 48 | 1 | 48.0 | none | ↑ needed by ARC-01 (group CD3 54.7) |
| 19 | ARC-01 | Expected correlation boundary map | Satisfier | R1 | 8 | 13 | 13 | 34 | 0.5 | 68.0 | ADR-01 |  |
| 20 | ADR-02 | ADRs A04-A06: export baseline, telemetry topology, cache | Satisfier | R1 | 5 | 20 | 8 | 33 | 0.5 | 66.0 | ADR-01 |  |
| 21 | INF-01 | Telemetry backbone IaC: Application Insights, Log Analytics, budgets | Satisfier | R7 | 13 | 13 | 13 | 39 | 1 | 39.0 | ADR-02, INF-02 | ↑ needed by API-02 (group CD3 42.8) |
| 22 | OBS-03 | KQL: orphan-candidate detection | Satisfier | R7 | 8 | 8 | 8 | 24 | 0.5 | 48.0 | ARC-01, INF-01 |  |
| 23 | INF-04 | APIM IaC: Contoso Gateway, logger and W3C diagnostic | Satisfier | R3 | 13 | 13 | 13 | 39 | 1 | 39.0 | INF-01, INF-02 | ↑ needed by API-02 (group CD3 45.3) |
| 24 | API-02 | Gateway business-ID and header policy | Satisfier | R3 | 8 | 13 | 8 | 29 | 0.5 | 58.0 | ADR-01, INF-04 |  |
| 25 | API-01 | Gateway inbound-context policy | Satisfier | R3 | 20 | 13 | 13 | 46 | 1 | 46.0 | ADR-01, INF-04 |  |
| 26 | INF-03 | Compute IaC: App Service on JDK 25 and Java Functions | Satisfier | R4 | 13 | 13 | 8 | 34 | 1 | 34.0 | INF-01, INF-02 | ↑ needed by JVM-02 (group CD3 37.7) |
| 27 | JVM-01 | Java service baseline: Orders API and Inventory API | Satisfier | R4 | 20 | 13 | 20 | 53 | 1.5 | 35.3 | INF-03, JVM-05 | ↑ needed by JVM-02 (group CD3 39.5) |
| 28 | JVM-02 | Structured logging correlation (MDC) | Satisfier | R4 | 8 | 13 | 5 | 26 | 0.5 | 52.0 | JVM-01 |  |
| 29 | INF-06 | Messaging IaC: Service Bus, Event Grid, Event Hubs, Storage Queue | Satisfier | R5 | 8 | 13 | 13 | 34 | 1 | 34.0 | INF-03 | ↑ needed by MSG-07 (group CD3 35.6) |
| 30 | MSG-01 | Message envelope v1, validator and untrusted-context handling | Satisfier | R5 | 13 | 8 | 13 | 34 | 1 | 34.0 | ADR-01 | ↑ needed by MSG-07 (group CD3 36.7) |
| 31 | MSG-07 | Storage Queue envelope path | Satisfier | R5 | 8 | 8 | 5 | 21 | 0.5 | 42.0 | INF-06, JVM-01, MSG-01 |  |
| 32 | JVM-04 | Trusted-edge business invocation ID and HTTP propagation | Satisfier | R4 | 13 | 13 | 8 | 34 | 1 | 34.0 | ADR-01, JVM-01 |  |
| 33 | INF-05 | Data-tier IaC: PostgreSQL and Azure Managed Redis | Satisfier | R6 | 8 | 13 | 8 | 29 | 1 | 29.0 | ADR-02, INF-02 | ↑ needed by DAT-01 (group CD3 34.0) |
| 34 | DAT-01 | PostgreSQL JDBC client spans | Satisfier | R6 | 13 | 13 | 13 | 39 | 1 | 39.0 | INF-05, JVM-01 |  |
| 35 | DAT-02 | Azure Managed Redis client spans | Satisfier | R6 | 13 | 13 | 13 | 39 | 1 | 39.0 | INF-05, JVM-01 |  |
| 36 | WEB-01 | Contoso Storefront SPA instrumentation | Satisfier | R2 | 13 | 13 | 8 | 34 | 1.5 | 22.7 | INF-01 | ↑ needed by IDN-02 (group CD3 32.3) |
| 37 | IDN-01 | Entra authentication and safe identity attributes | Satisfier | R8 | 13 | 8 | 13 | 34 | 1 | 34.0 | ADR-01, JVM-01, WEB-01 | ↑ needed by IDN-02 (group CD3 42.0) |
| 38 | IDN-02 | HMAC pseudonymization and key rotation | Satisfier | R8 | 8 | 8 | 13 | 29 | 0.5 | 58.0 | IDN-01, INF-02 |  |
| 39 | WEB-02 | Correlation domains and CORS | Satisfier | R2 | 8 | 13 | 13 | 34 | 1 | 34.0 | ARC-01, INF-04, WEB-01 |  |
| 40 | DOC-01 | Architecture diagram (Mermaid) | Satisfier | R1 | 8 | 5 | 3 | 16 | 0.5 | 32.0 | ARC-01 |  |
| 41 | JVM-03 | Manual spans for uncovered business boundaries | Satisfier | R4 | 5 | 8 | 3 | 16 | 0.5 | 32.0 | JVM-01 |  |
| 42 | MSG-02 | Service Bus send and process path | Satisfier | R5 | 13 | 8 | 13 | 34 | 1.5 | 22.7 | INF-06, JVM-01, MSG-01 | ↑ needed by MSG-03 (group CD3 31.5) |
| 43 | MSG-03 | Retry attempt semantics | Satisfier | R5 | 13 | 8 | 8 | 29 | 0.5 | 58.0 | MSG-02 |  |
| 44 | OBS-01 | Sampling matrix and bounded certification switch | Satisfier | R7 | 13 | 8 | 8 | 29 | 1 | 29.0 | INF-04, JVM-01, WEB-01 | ↑ needed by DOC-02 (group CD3 31.0) |
| 45 | OBS-02 | KQL: trace reconstruction and business lookup | Satisfier | R7 | 13 | 8 | 8 | 29 | 1 | 29.0 | INF-01, JVM-04 | ↑ needed by DOC-02 (group CD3 31.5) |
| 46 | DEM-00 | Demo harness: one-command run, evidence capture, reset | Delighter | R9 | 8 | 8 | 20 | 36 | 1.5 | 24.0 | GATE-13, INF-01, OBS-01, OBS-02 | ↑ needed by DEM-01 (group CD3 32.4) |
| 47 | DEM-03 | Contoso Demo 03: Inbound context at the Gateway | Satisfier | R3 | 13 | 5 | 8 | 26 | 0.5 | 52.0 | GATE-01, API-01, DEM-00 |  |
| 48 | DEM-04 | Contoso Demo 04: Trusted-edge business invocation ID | Satisfier | R4 | 13 | 5 | 8 | 26 | 0.5 | 52.0 | GATE-10, API-02, DEM-00, JVM-04, MSG-02, OBS-02 |  |
| 49 | DEM-06 | Contoso Demo 06: Service Bus retry semantics | Satisfier | R5 | 13 | 5 | 8 | 26 | 0.5 | 52.0 | GATE-09, DEM-00, MSG-03 |  |
| 50 | DEM-12 | Contoso Demo 12: Data-tier safety | Satisfier | R6 | 13 | 5 | 8 | 26 | 0.5 | 52.0 | GATE-04, DAT-01, DAT-02, DEM-00 |  |
| 51 | DEM-13 | Contoso Demo 13: Identity and privacy enrichment | Satisfier | R8 | 13 | 5 | 8 | 26 | 0.5 | 52.0 | GATE-04, GATE-10, DEM-00, IDN-01, IDN-02 |  |
| 52 | DEM-01 | Contoso Demo 01: Synchronous golden path | Satisfier | R1 | 20 | 5 | 20 | 45 | 1 | 45.0 | GATE-08, API-01, DAT-01, DAT-02, DEM-00, JVM-02, JVM-04, WEB-02 |  |
| 53 | DEM-11 | Contoso Demo 11: Spoofed and malformed message context | Satisfier | R8 | 8 | 5 | 8 | 21 | 0.5 | 42.0 | DEM-00, MSG-01, MSG-02 |  |
| 54 | MSG-04 | Dead-letter preservation and replay tool | Satisfier | R5 | 13 | 8 | 8 | 29 | 1 | 29.0 | MSG-03 | ↑ needed by DEM-07 (group CD3 36.7) |
| 55 | DEM-07 | Contoso Demo 07: Dead-letter and replay | Satisfier | R5 | 13 | 5 | 8 | 26 | 0.5 | 52.0 | GATE-09, DEM-00, MSG-04 |  |
| 56 | MSG-08 | Fan-out and fan-in with links | Satisfier | R5 | 13 | 8 | 8 | 29 | 1 | 29.0 | MSG-02 | ↑ needed by DEM-08 (group CD3 36.7) |
| 57 | DEM-08 | Contoso Demo 08: Fan-out and fan-in | Satisfier | R5 | 13 | 5 | 8 | 26 | 0.5 | 52.0 | GATE-09, DEM-00, MSG-08 |  |
| 58 | DEM-14 | Contoso Demo 14: Orphan-candidate triage | Satisfier | R7 | 8 | 5 | 5 | 18 | 0.5 | 36.0 | ARC-01, DEM-00, OBS-03 |  |
| 59 | DOC-02 | README quick start | Satisfier | R1 | 8 | 5 | 3 | 16 | 0.5 | 32.0 | DEM-01, INF-04 to INF-06 |  |
| 60 | WEB-03 | Contoso Portal SSR instrumentation | Satisfier | R2 | 8 | 13 | 5 | 26 | 1 | 26.0 | INF-03, INF-04 | ↑ needed by DEM-02 (group CD3 28.0) |
| 61 | DEM-02 | Contoso Demo 02: Portal SSR path vs SPA path | Satisfier | R2 | 8 | 5 | 3 | 16 | 0.5 | 32.0 | ARC-01, DEM-00, WEB-01, WEB-03 |  |
| 62 | MSG-06 | Event Hubs mixed-context batch path | Satisfier | R5 | 8 | 8 | 8 | 24 | 1 | 24.0 | INF-06, JVM-01, MSG-01 | ↑ needed by DEM-09 (group CD3 28.0) |
| 63 | DEM-09 | Contoso Demo 09: Event Hubs mixed-context batch | Satisfier | R5 | 8 | 5 | 5 | 18 | 0.5 | 36.0 | GATE-09, DEM-00, MSG-06 |  |
| 64 | OBS-04 | Load, overhead and cost test | Satisfier | R7 | 13 | 8 | 13 | 34 | 1.5 | 22.7 | DAT-01, DAT-02, MSG-02, OBS-01 | ↑ needed by DEM-15 (group CD3 25.0) |
| 65 | OBS-07 | Production sampling profile with rollback | Delighter | R7 | 5 | 5 | 5 | 15 | 0.5 | 30.0 | OBS-01, OBS-04 | ↑ needed by DEM-15 (group CD3 27.3) |
| 66 | DEM-15 | Contoso Demo 15: Sampling, overhead and certification-to-production switch | Satisfier | R7 | 13 | 5 | 8 | 26 | 1 | 26.0 | GATE-12, DEM-00, OBS-01, OBS-04, OBS-07 |  |
| 67 | MSG-05 | Event Grid CloudEvents path | Satisfier | R5 | 8 | 8 | 8 | 24 | 1 | 24.0 | INF-06, JVM-01, MSG-01 |  |
| 68 | INF-07 | Access and retention governance | Satisfier | R8 | 8 | 8 | 8 | 24 | 1 | 24.0 | ADR-01, INF-01 |  |
| 69 | DEM-05 | Contoso Demo 05: Error and timeout correlation | Satisfier | R4 | 8 | 5 | 5 | 18 | 1 | 18.0 | DAT-01, DEM-00, JVM-03 |  |
| 70 | DEM-10 | Contoso Demo 10: Event Grid CloudEvents and Storage Queue envelope | Satisfier | R5 | 8 | 5 | 5 | 18 | 1 | 18.0 | GATE-09, DEM-00, MSG-05, MSG-07 |  |
| 71 | DOC-03 | DEMO_RUNBOOK.md: operations | Satisfier | R1 | 8 | 5 | 5 | 18 | 1 | 18.0 | DEM-00 |  |
| 72 | CRT-03 | Residual limitations and §23 coverage map | Satisfier | R9 | 8 | 5 | 5 | 18 | 1 | 18.0 | none |  |
| 73 | OBS-05 | Correlation workbook | Delighter | R7 | 5 | 3 | 3 | 11 | 1 | 11.0 | OBS-02, OBS-03 | ↑ needed by CRT-02 (group CD3 14.0) |
| 74 | DOC-04 | Presenter talk track for Demos 01-15 | Delighter | R1 | 8 | 3 | 3 | 14 | 1.5 | 9.3 | DOC-03 | ↑ needed by CRT-02 (group CD3 14.9) |
| 75 | CRT-02 | Certification run, sign-off package and executive summary | Satisfier | R9 | 20 | 5 | 13 | 38 | 2 | 19.0 | all 13 gates, CRT-01, CRT-03, DEM-01 to DEM-15, DOC-01 to DOC-04, INF-07, OBS-05 |  |
| 76 | OBS-06 | Orphan-candidate triage classifier | Delighter | R7 | 5 | 3 | 5 | 13 | 1 | 13.0 | OBS-03 |  |
| 77 | EVL-B | Contoso Eval B: Azure Monitor Traces / Trace Analytics preview lane | Delighter | R7 | 3 | 1 | 1 | 5 | 1 | 5.0 | CRT-02 |  |
| 78 | EVL-A | Contoso Eval A: Collector tail-sampling lane | Delighter | R7 | 3 | 1 | 3 | 7 | 1.5 | 4.7 | ADR-02, CRT-02 |  |

## Acceptance criteria

In rank order. Every card also has to meet the Definition of Done at the end of this file.

### 1. GATE-03 · Secret-free repository and Key Vault-reference check

**Dissatisfier** · Owner: R8 Security & Privacy Red Team · Build phase B · CD3 106.0 (CoD 53 ÷ 0.5 d) · Needs: none  
Traces to: Prompt §5.8, §9 · Brief §6 Configuration, §23

Blocks any secret, token or connection string from entering the repository, app settings or evidence.

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

### 2. GATE-07 · Removed-claims and preview-isolation lint

**Dissatisfier** · Owner: R1 Lead Architect · Build phase A · CD3 82.0 (CoD 41 ÷ 0.5 d) · Needs: none  
Traces to: Prompt §2, §5.11, §9 · Brief §14, §21

Keeps the claims the Brief removed and every preview capability off the certification path.

- [ ] Fails on any requirement or dependency on .NET Service Bus 7.13.0, `Azure.Experimental.EnableActivitySource`, "classic adaptive sampling" for Java, APIM native OTLP, or an Azure Cache for Redis resource.
- [ ] A certification dependency manifest lists every component on the certification path with its GA or preview status and source; the lint fails on any preview entry, including Azure Monitor Traces / Trace Analytics and any OTLP ingestion path not confirmed GA for the target region.
- [ ] Contoso Eval A/B code and parameters sit in isolated folders the certification deployment never references; a deployment what-if proves it.
- [ ] A seeded fixture for each forbidden item makes the lint fail.

### 3. GATE-06 · VERIFY register with fail-closed assumption tests

**Dissatisfier** · Owner: R9 Verifier / Adjudicator · Build phase A · CD3 53.0 (CoD 53 ÷ 1 d) · Needs: none  
Traces to: Prompt §2, §8 item 7 · Brief §19 Inventory freeze

The §8 item 7 register: every version or capability assumption has an official source to check and a test that fails if it is wrong.

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

### 4. GATE-11 · Deployability and naming-conformance gate

**Dissatisfier** · Owner: R1 Lead Architect · Build phase B · CD3 53.0 (CoD 53 ÷ 1 d) · Needs: none  
Traces to: Prompt §0, §3, §4 · Brief §6 Service identity, §24 Repeatability

Proves the POC deploys from scratch and that every resource and role name follows the Contoso convention.

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

### 5. GATE-01 · Protocol-integrity static scan

**Dissatisfier** · Owner: R3 API Platform Engineer · Build phase D · CD3 53.0 (CoD 53 ÷ 1 d) · Needs: none  
Traces to: Prompt §5.1, §5.4, §6 negative controls · Brief §3, §7, §24 No falsification

A CI scan that blocks any change that falsifies or bypasses W3C trace context.

- [ ] Runs on every pull request over `apim/policies/`, `infra/`, `web/`, `services/` and `workers/`, and fails on: a trace-flags change from `-00` to `-01`; a `traceparent` or trace-id built from `context.RequestId`; an APIM diagnostic `httpCorrelationProtocol` other than `W3C`; a Storefront `distributedTracingMode` other than W3C (the SDK default `AI_AND_W3C` also fails).
- [ ] Fails when the forbidden logic sits behind a feature flag, named value or disabled policy fragment.
- [ ] Seeded fixtures in `tests/fixtures/` (excluded from every deployable path) make the scan fail; with them removed it passes.
- [ ] Output is saved under `evidence/` and linked from the No falsification row of CERTIFICATION_REPORT.md.

### 6. GATE-02 · Single-provider-per-JVM check

**Dissatisfier** · Owner: R4 Java/OTel Engineer · Build phase E · CD3 53.0 (CoD 53 ÷ 1 d) · Needs: none  
Traces to: Prompt §5.3, §9 · Brief §6, §20

Proves every JVM runs exactly one OpenTelemetry provider: the Azure Monitor Java agent, attached once.

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

### 7. GATE-09 · Async-honesty assertions

**Dissatisfier** · Owner: R5 Async/Integration Engineer · Build phase G · CD3 46.0 (CoD 46 ÷ 1 d) · Needs: none  
Traces to: Prompt §5.6 · Brief §8, §17, §24 Async honesty

A shared assertion library that proves retry, replay, fan-in and batch telemetry is honest.

- [ ] Asserts each delivery attempt has its own PROCESS span with a new span-id and an attempt or delivery-count attribute.
- [ ] Asserts replay either links to the original context or starts a new trace linked to it, with `business.invocation_id` unchanged, and never continues an old parent as if it were active.
- [ ] Asserts the Aggregator span has at most one parent plus links to every contributor, batch processing never makes the first message the parent, and link counts stay within the configured bound.
- [ ] A fixture for each anti-pattern (span-id reuse, old-parent continuation, single-parent fan-in, first-message parent, unbounded links) makes it fail.
- [ ] Called by Demos 06-10 and linked from the Async honesty row.

### 8. GATE-04 · Telemetry data-safety scan

**Dissatisfier** · Owner: R8 Security & Privacy Red Team · Build phase H · CD3 40.0 (CoD 60 ÷ 1.5 d) · Needs: none  
Traces to: Prompt §5.7, §5.8 · Brief §7, §9, §24 Data safety

Scans captured telemetry and capture settings so no secret, credential, body or personal data reaches Application Insights.

- [ ] A scan over every Application Insights / Log Analytics table in the certification window fails on JWT-shaped strings, `Authorization` or cookie values, request or response bodies, email addresses, UPNs, raw Entra object IDs, SQL literals or bound parameters, and Redis keys, values, scripts or arguments.
- [ ] A config check fails unless APIM frontend and backend body bytes are 0, the logged-header allowlist holds only `x-business-invocation-id`, JDBC statement capture is sanitized or off, and Redis argument capture is off.
- [ ] Seeded forbidden values sent through the negative controls of Demos 12 and 13 are caught: the seeded run fails and the clean run passes.
- [ ] Results are saved under `evidence/` and linked from the Data safety row.

### 9. GATE-08 · Trace and span identity assertions (Invariants A, B, C)

**Dissatisfier** · Owner: R9 Verifier / Adjudicator · Build phase I · CD3 40.0 (CoD 60 ÷ 1.5 d) · Needs: none  
Traces to: Prompt §6 Demo 01 · Brief §19 Invariants A-C, §24 Trace and Span identity

A shared assertion library every demo calls to prove Invariants A, B and C against live telemetry.

- [ ] Given a known business ID or trace-id and a time window, asserts Invariant A: every row shares one non-zero 32-hex trace-id/OperationId, except documented trust-boundary roots.
- [ ] Asserts Invariant B: every actual request/dependency span has a non-zero unique span-id, and every strict child's ParentId equals its parent's Id. Associated logs/events/exceptions may reference the same active span; their display/context IDs are not counted as new spans. Duplicate emitted span records are never hidden by de-duplication.
- [ ] Asserts Invariant C: browser dependency → Gateway request → Gateway backend dependency → Orders server → Inventory server → JDBC and Redis client chain matches the expected boundary map; JDBC and Redis spans are client/dependency kind; no APIM request ID appears as a trace-id.
- [ ] Fixture sets for each failure (split trace, duplicate span-id, wrong ParentId, missing hop) fail with a message naming the broken edge.
- [ ] Linked from the Trace identity and Span identity rows.

#### Child tasks

  - [ ] **GATE-08.1 - Assert the Orders workflow and worker store boundaries in Invariant C**
    - Executor: R9.
    - Prerequisites: ARC-01.1 and the existing GATE-08 invariant library and fixture sets.
    - Deliverable: One extension of the shared Invariant C assertion and its fixture sets so the Orders workflow/outbox and worker messaging-store CLIENT spans are checked as children of their request, producer or PROCESS span using only the single boundary map.
    - Acceptance: A fixture trace with every store CLIENT span correctly parented passes; fixtures with a missing store span, a wrong parent, a non-CLIENT span kind and an undeclared store boundary each fail with a message naming the broken edge. Inventory's PostgreSQL and Redis chain behaviour is unchanged. These are assertion fixtures only and prove no native store span (DAT-01 clause 1, DEM-12 clause 1).

### 10. GATE-10 · Identifier-integrity guard

**Dissatisfier** · Owner: R8 Security & Privacy Red Team · Build phase H · CD3 39.0 (CoD 39 ÷ 1 d) · Needs: none  
Traces to: Prompt §5.4, §5.5, §5.9 · Brief §10, §11, §20

Keeps every non-W3C identifier out of trace identity, and keeps the business ID out of auth and metrics.

- [ ] A query over the certification window fails if any OperationId, Id or ParentId equals an APIM request ID, an Entra request or correlation ID, a CloudEvent `id`, a Service Bus MessageId or a `business.invocation_id`.
- [ ] Fails if `business.invocation_id` appears as a custom-metric dimension or is read on any authentication or authorization code path.
- [ ] Fails on any business ID that is not an opaque UUIDv4 or ULID, or that embeds customer, user or order data.
- [ ] Fails if Entra request or correlation IDs appear anywhere except the separate security-approved attribute.
- [ ] A seeded fixture for each case makes it fail.

### 11. GATE-12 · Certification-boundary gate

**Dissatisfier** · Owner: R9 Verifier / Adjudicator · Build phase I · CD3 34.0 (CoD 34 ÷ 1 d) · Needs: none  
Traces to: Prompt §5.10, §9 · Brief §12, §24 Certification statement

Bounds 100% sampling to the certification window and keeps the certification claim scoped and current.

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

### 12. GATE-13 · Evidence-integrity and gap-log gate

**Dissatisfier** · Owner: R9 Verifier / Adjudicator · Build phase I · CD3 34.0 (CoD 34 ÷ 1 d) · Needs: none  
Traces to: Prompt §0, §2 · Brief §19 evidence, §24 Repeatability

Certifies only on live, untampered evidence, and logs every place where documented and observed behaviour differ.

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

### 13. GATE-05 · JDK 25 compatibility gate

**Dissatisfier** · Owner: R4 Java/OTel Engineer · Build phase E · CD3 30.0 (CoD 60 ÷ 2 d) · Needs: none  
Traces to: Prompt §7 · Brief §6 compatibility gate

Proves the pinned Java provider emits the expected spans for every selected automatic or safe manual logical-boundary path on the App Service JDK 25 image, with no silent span loss. Qualification of automatic JDBC/Redis instrumentation remains separate; manual CLIENT evidence does not certify that automatic path.

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

### 14. INF-02 · Key Vault and Key Vault-reference wiring

**Satisfier** · Owner: R8 Security & Privacy Red Team · Build phase B · CD3 68.0 (CoD 34 ÷ 0.5 d) · Needs: none  
Traces to: Prompt §4 infra, §5.8 · Brief §6 Configuration

Creates `contoso-corr-poc-kv` and the secret plumbing every app uses.

- [ ] `contoso-corr-poc-kv` deploys with RBAC authorization and purge protection, and no secret values in templates or parameters.
- [ ] A reusable Bicep module grants each app's managed identity read access to named secrets only and emits `@Microsoft.KeyVault(...)` reference strings for app settings.
- [ ] An explicitly approved SDK bootstrap generates at least 256 bits of HMAC material with a cryptographically strong RNG in memory and stores it as a named Standard Key Vault secret version. Generation is client-side, not falsely described as vault-side entropy. No secret value enters source, parameters, files, argv, transcripts, logs or evidence; provenance, version/epoch, readers and rotation are reviewed.
- [ ] GATE-03 passes against the module and its parameters.

### 15. JVM-05 · VERSIONS.md, Java SBOM and agent pin

**Satisfier** · Owner: R4 Java/OTel Engineer · Build phase E · CD3 68.0 (CoD 34 ÷ 0.5 d) · Needs: none  
Traces to: Prompt §4 VERSIONS.md · Brief §19 Inventory freeze

Starts the inventory freeze and pins the Java agent before any service attaches it.

- [ ] VERSIONS.md lists every SDK, agent, runtime, image and API version in use (browser SDK, APIM SKU and API version, App Service JDK 25 image, Java agent, frameworks and clients, messaging SDKs, Functions runtime and worker, resource API versions), each with an official source link.
- [ ] A Java SBOM covers the HTTP, JDBC, Redis and messaging libraries of every service and worker.
- [ ] The agent binary is pinned with its checksum and release/support evidence, and has a GATE-06 `VERIFY:` entry.
- [ ] A change to any listed version triggers GATE-12 invalidation.

### 16. CRT-01 · CERTIFICATION_REPORT.md template

**Satisfier** · Owner: R9 Verifier / Adjudicator · Build phase I · CD3 58.0 (CoD 29 ÷ 0.5 d) · Needs: none  
Traces to: Prompt §4 docs/CERTIFICATION_REPORT.md, §8 item 5 · Brief §24

The §8 item 5 template that maps each §24 criterion to its proof.

- [ ] One row per §24 criterion (Coverage, Trace identity, Span identity, No falsification, Async honesty, Durable lookup, Data safety, Operational stability, Backend usability, Governance, Repeatability) with demo(s), test(s) or gate(s), evidence path and pass/fail.
- [ ] Includes the scoped certification statement block from GATE-12.
- [ ] Includes sign-off rows for architecture, application, platform, SRE/observability, security/privacy and data owners.

### 17. GOV-01 · Adjudication log and claim-labelling workflow

**Delighter** · Owner: R9 Verifier / Adjudicator · Build phase A · CD3 82.0 (CoD 41 ÷ 0.5 d) · Needs: none  
Traces to: Prompt §1 steps 2-3 · Brief claim labels and evidence hierarchy

Sets up the cross-review and adjudication trail in DECISIONS.md so every disputed claim is settled by evidence.

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

### 18. ADR-01 · ADRs A01-A03: causality, business ID, trust policy

**Satisfier** · Owner: R1 Lead Architect · Build phase A · CD3 48.0 (CoD 48 ÷ 1 d) · Needs: none  
Traces to: Prompt §1 R1, §8 item 6 · Brief §22 Phase A

Records the three correlation-semantics decisions every other role builds on.

- [ ] DECISIONS.md holds signed ADRs A01, A02 and A03 with context, decision, consequences and Brief references.
- [ ] A01 names W3C `traceparent`/`tracestate` and span links as the only technical-causality mechanism.
- [ ] A02 defines when `business.invocation_id` is used, its format (UUIDv4 or ULID), the trusted edge, retention, privacy and cardinality controls, and whether the response header is exposed.
- [ ] A03 gives testable rules for valid, absent, invalid and oversized context, deliberate trust-boundary breaks and safe hashing of rejected values, precise enough to write the Demo 03 and Demo 11 assertions.

### 19. ARC-01 · Expected correlation boundary map

**Satisfier** · Owner: R1 Lead Architect · Build phase A · CD3 68.0 (CoD 34 ÷ 0.5 d) · Needs: ADR-01  
Traces to: Prompt §4 topology · Brief §17, §18 orphan interpretation

One machine-readable map of every hop, edge type and deliberate new root, used by tests, triage and the diagram.

- [ ] Lists every hop with its expected span kind and edge type (parent or link) across the sync path, the SSR path, each transport, each worker, the Aggregator and replay, plus every tier's data-store CLIENT operation (Inventory PostgreSQL and Redis, the Orders workflow/outbox store and each worker's messaging store), so no span emitted by the Contoso correlation wrapper lacks a declared boundary; auto-instrumented identity HTTP dependencies stay governed by the map's identity-client constraint.
- [ ] Lists every API origin the Storefront calls and every SSR hop, and marks each deliberate new-root point with its ADR A03 rule.
- [ ] GATE-08 (Invariant C), the orphan-candidate query, Demo 02 and the Mermaid diagram all read this one file; no second copy exists.

#### Child tasks

  - [ ] **ARC-01.1 - Declare the Orders workflow and worker store boundaries in the single map**
    - Executor: R1.
    - Prerequisites: ADR-01 decisions and the existing `contracts\expected-boundary-map.v1.json` with its consumers (diagram generator, orphan-query inputs, workbook and GATE-08).
    - Deliverable: One edit of the single boundary map that declares the PostgreSQL CLIENT boundary of the Orders workflow/outbox store and of the Fulfillment, Notify and Aggregator messaging stores, each with its role name, parent edge and ADR A03 rule, plus the regenerated generated artifacts; no second map or consumer-side copy.
    - Acceptance: A source-derived test lists every role whose Java sources call `PgOperations.execute`, the path that emits `contoso.pg.*` CLIENT spans, and fails when a role has no declared store boundary; removing one declared boundary fails naming the missing edge. Inventory's `postgres.logical` and `redis.logical` entries, the identity-client constraint and every existing edge are unchanged, and the diagram check still passes. This declares expectation only; native spans stay with DAT-01 clause 1 and DEM-12 clause 1.

### 20. ADR-02 · ADRs A04-A06: export baseline, telemetry topology, cache

**Satisfier** · Owner: R1 Lead Architect · Build phase A · CD3 66.0 (CoD 33 ÷ 0.5 d) · Needs: ADR-01  
Traces to: Prompt §8 item 6 · Brief §9, §13, §22 Phase A

Records the platform decisions the IaC implements.

- [ ] A04 picks direct Azure Monitor export as the baseline, compares the Collector and third-party options, and lists the documented triggers that would justify Contoso Eval A.
- [ ] A05 fixes one workspace-based Application Insights resource for `contoso-corr` / `poc` on the shared Log Analytics workspace, with a naming, RBAC and retention map.
- [ ] A06 selects Azure Managed Redis, cites the Azure Cache for Redis retirement dates (Basic/Standard/Premium 30 Sep 2028; Enterprise and Enterprise Flash 30 Mar 2027) and marks the target SKU and region `VERIFY:`.

### 21. INF-01 · Telemetry backbone IaC: Application Insights, Log Analytics, budgets

**Satisfier** · Owner: R7 Observability/KQL Engineer · Build phase B · CD3 39.0 (CoD 39 ÷ 1 d) · Needs: ADR-02, INF-02  
Traces to: Prompt §4 infra · Brief §13

Deploys `contoso-corr-poc-appi` and `contoso-corr-poc-law` per ADR A05, with ingestion budget and alerts.

- [ ] One workspace-based `contoso-corr-poc-appi` is connected to `contoso-corr-poc-law`, with retention set per ADR A05.
- [ ] The connection string is written to `contoso-corr-poc-kv` from deployment outputs; it is never emitted in plain text.
- [ ] An ingestion budget and an ingestion-volume alert exist.
- [ ] `infra/main.bicep`, `infra/params/poc.bicepparam` and `azure.yaml` exist and deploy this module under GATE-11.

### 22. OBS-03 · KQL: orphan-candidate detection

**Satisfier** · Owner: R7 Observability/KQL Engineer · Build phase I · CD3 48.0 (CoD 24 ÷ 0.5 d) · Needs: ARC-01, INF-01  
Traces to: Prompt §4 kql/ · Brief §18

Delivers `kql/orphan-candidates.kql` with a legacy variant and boundary-map awareness.

- [ ] Returns spans whose ParentId has no matching Id in scope over a parameterized lookback, plus a legacy-schema variant.
- [ ] Cross-resource scope is explicit, so orphans caused by query scope are visible.
- [ ] Output joins to the expected boundary map so known remote or broker parents are pre-labelled.

### 23. INF-04 · APIM IaC: Contoso Gateway, logger and W3C diagnostic

**Satisfier** · Owner: R3 API Platform Engineer · Build phase D · CD3 39.0 (CoD 39 ÷ 1 d) · Needs: INF-01, INF-02  
Traces to: Prompt §4 infra · Brief §7

Deploys `contoso-corr-poc-apim` with its Application Insights logger and a W3C diagnostic.

- [ ] The logger points to `contoso-corr-poc-appi` through the Key Vault-backed named value (managed identity only if validated for the pinned API version: `VERIFY:`).
- [ ] The diagnostic sets `httpCorrelationProtocol: W3C`, fixed sampling as a parameter (100 in certification), `alwaysLog: allErrors`, frontend and backend logged headers limited to `x-business-invocation-id`, and body bytes 0 (property shape `VERIFY:` against the pinned API version).
- [ ] The diagnostic scope (all APIs or per API) is documented and the export shows no conflicting diagnostic at another scope.
- [ ] The exported resource state and its API version are saved under `evidence/config/`; the GATE-01 and GATE-04 config checks pass against it.

### 24. API-02 · Gateway business-ID and header policy

**Satisfier** · Owner: R3 API Platform Engineer · Build phase D · CD3 58.0 (CoD 29 ÷ 0.5 d) · Needs: ADR-01, INF-04  
Traces to: Prompt §4 apim/policies, §5.5 · Brief §7 Headers

Enforces the business-ID allowlist and keeps sensitive headers out of telemetry.

- [ ] `x-business-invocation-id` is the only business header forwarded; values that fail the ADR A02 length, charset or format rules, or that come from untrusted callers, are removed so the trusted edge issues a new one.
- [ ] Duplicate header values are overwritten, never appended.
- [ ] A policy test shows Authorization headers, cookies and tokens are never logged.

### 25. API-01 · Gateway inbound-context policy

**Satisfier** · Owner: R3 API Platform Engineer · Build phase D · CD3 46.0 (CoD 46 ÷ 1 d) · Needs: ADR-01, INF-04  
Traces to: Prompt §4 apim/policies, §5.2, §5.4 · Brief §7 Inbound context

Implements ADR A03 at the Gateway: continue valid context, start a compliant root otherwise, never falsify.

- [ ] Policy does not manually rewrite a valid inbound carrier. The gateway request continues the inbound trace ID; its backend dependency advances parentage, and Orders ParentId equals that actual backend dependency Id. Assert ingress/outbound wire carriers and real gateway spans separately; never manufacture missing gateway rows.
- [ ] Absent or malformed context (all-zero IDs, wrong length, forbidden version `ff`) gets a compliant root from supported tracing, never one built in policy or from `context.RequestId`. Higher versions follow verified forward-compatible parsing; invalid `tracestate` can be discarded independently. Any stricter restart is an explicit A03 trust boundary. Rejected raw values are never logged; a digest requires a reviewed safe-input/key policy.
- [ ] An inbound `-00` flag is forwarded as `-00`.
- [ ] Evidence for the valid, absent, invalid and `-00` cases is saved; any documented-versus-observed difference goes to the gap log.

### 26. INF-03 · Compute IaC: App Service on JDK 25 and Java Functions

**Satisfier** · Owner: R4 Java/OTel Engineer · Build phase B · CD3 34.0 (CoD 34 ÷ 1 d) · Needs: INF-01, INF-02  
Traces to: Prompt §4 infra · Brief §6, §8 Functions

Deploys the Java hosts and the Portal host with managed identities and Key Vault references.

- [ ] App Service apps `contoso-orders-api` and `contoso-inventory-api` run the JDK 25 image recorded in VERSIONS.md (`VERIFY:` until confirmed); `contoso-portal-ssr` runs on its documented stack.
- [ ] Function apps host `contoso-fulfillment-worker`, `contoso-notify-worker` and `contoso-order-aggregator` on the Java worker recorded in VERSIONS.md (`VERIFY:` JDK 25 support).
- [ ] Every app has a managed identity and the Key Vault-referenced connection string, and sets its role name to its §3 identifier through the agent's supported setting (`VERIFY:` the setting for the pinned agent).
- [ ] Each app has exactly one agent-attach mechanism (never built-in autoinstrumentation plus an explicit `-javaagent`).

### 27. JVM-01 · Java service baseline: Orders API and Inventory API

**Satisfier** · Owner: R4 Java/OTel Engineer · Build phase E · CD3 35.3 (CoD 53 ÷ 1.5 d) · Needs: INF-03, JVM-05  
Traces to: Prompt §4 services/ · Brief §6

Stands up `contoso-orders-api` and `contoso-inventory-api` on JDK 25 with the agent attached once.

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

### 28. JVM-02 · Structured logging correlation (MDC)

**Satisfier** · Owner: R4 Java/OTel Engineer · Build phase E · CD3 52.0 (CoD 26 ÷ 0.5 d) · Needs: JVM-01  
Traces to: Prompt §4 services/ · Brief §6 Logging correlation

Puts the active trace-id, span-id and business ID on every structured log line.

- [ ] Logs carry trace-id and span-id from the instrumentation-supplied MDC fields, plus `business.invocation_id`; no code parses `traceparent` by hand.
- [ ] A test matches each log line's IDs to the active span, including work handed to thread pools.
- [ ] Logs contain no credentials, tokens, raw claims, query parameters, cache keys or bodies (GATE-04).

### 29. INF-06 · Messaging IaC: Service Bus, Event Grid, Event Hubs, Storage Queue

**Satisfier** · Owner: R5 Async/Integration Engineer · Build phase B · CD3 34.0 (CoD 34 ÷ 1 d) · Needs: INF-03  
Traces to: Prompt §3, §4 infra · Brief §8

Deploys every async transport the demos exercise, wired for managed identity.

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

### 30. MSG-01 · Message envelope v1, validator and untrusted-context handling

**Satisfier** · Owner: R5 Async/Integration Engineer · Build phase G · CD3 34.0 (CoD 34 ÷ 1 d) · Needs: ADR-01  
Traces to: Prompt §4 contracts/ · Brief §8

Defines `contracts/message-envelope.v1.json` and the rules every consumer applies to inbound message context.

- [ ] The schema defines version, `traceparent`, `tracestate`, `business.invocation_id`, message identity and size limits.
- [ ] A shared validator rejects malformed, oversized and schema-invalid envelopes, with a test per rule.
- [ ] Consumers apply ADR A03 to spoofed or malformed context: new root and bounded rejection category, never a raw rejected value. An optional digest requires the approved safe-input/key policy; a plain hash is not automatically a safe pseudonym for arbitrary personal input.
- [ ] A schema change requires a version bump and triggers GATE-12 invalidation.

### 31. MSG-07 · Storage Queue envelope path

**Satisfier** · Owner: R5 Async/Integration Engineer · Build phase G · CD3 42.0 (CoD 21 ÷ 0.5 d) · Needs: INF-06, JVM-01, MSG-01  
Traces to: Prompt §4 async path · Brief §8

Carries context through `contoso-legacy-jobs` inside envelope v1.

- [ ] Jobs use envelope v1; the worker extracts the envelope context and starts its PROCESS span explicitly.
- [ ] The envelope round-trips within size and privacy limits; oversized or invalid envelopes are rejected.
- [ ] The selected SDK-managed Storage Queue receive path is tested for the properties it does and does not expose; native trigger-binding behaviour is not claimed, and gaps go to the gap log.

### 32. JVM-04 · Trusted-edge business invocation ID and HTTP propagation

**Satisfier** · Owner: R4 Java/OTel Engineer · Build phase E · CD3 34.0 (CoD 34 ÷ 1 d) · Needs: ADR-01, JVM-01  
Traces to: Prompt §4 services/orders-api, §5.5 · Brief §11, §18

Implements the trusted-edge logic in Orders API and carries the ID to Inventory API.

- [ ] Orders API accepts an inbound `x-business-invocation-id` only from a trusted caller and only if it matches the approved length, charset and namespace; otherwise it generates a new opaque UUIDv4 or ULID.
- [ ] Property-based tests cover length, charset, namespace and trust cases.
- [ ] The value is set on the active span and logs and sent to Inventory API as the allowlisted header; an integration test proves continuity without using the trace-id.
- [ ] The ID is returned in a response header only if ADR A02 allows it.

### 33. INF-05 · Data-tier IaC: PostgreSQL and Azure Managed Redis

**Satisfier** · Owner: R6 Data-Tier Engineer · Build phase B · CD3 29.0 (CoD 29 ÷ 1 d) · Needs: ADR-02, INF-02  
Traces to: Prompt §4 infra, §5.11 · Brief §9

Deploys `contoso-corr-poc-pg` (database `contoso_orders`) and `contoso-corr-poc-amr` with private connectivity.

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

### 34. DAT-01 · PostgreSQL JDBC client spans

**Satisfier** · Owner: R6 Data-Tier Engineer · Build phase F · CD3 39.0 (CoD 39 ÷ 1 d) · Needs: INF-05, JVM-01  
Traces to: Prompt §4 services/inventory-api, §5.7 · Brief §9

Produces safe JDBC client spans from Inventory API to `contoso_orders`.

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

### 35. DAT-02 · Azure Managed Redis client spans

**Satisfier** · Owner: R6 Data-Tier Engineer · Build phase F · CD3 39.0 (CoD 39 ÷ 1 d) · Needs: INF-05, JVM-01  
Traces to: Prompt §4 services/inventory-api, §5.7 · Brief §9

Produces safe Redis client spans from Inventory API to `contoso-corr-poc-amr`.

- [ ] The Redis client version is checked against the pinned agent's supported list (`VERIFY:`); if unsupported, a manual client span wraps a safe abstraction boundary.
- [ ] Spans record operation category, endpoint and outcome only; keys, values, scripts, command arguments and session IDs are never captured.
- [ ] Each cache call appears once; hit or miss is a bounded attribute or a metric.

#### Child tasks

  - [ ] **DAT-02.1 - Add an opt-in real-Redis local lane for the cache adapter**
    - Executor: R6.
    - Prerequisites: A developer-supplied Redis-compatible server or container runtime, enabled only by an explicit variable; the existing `LettuceInventoryCache`, `OwnedInventoryCache` and RESP-fixture tests.
    - Deliverable: One opt-in integration lane that runs the cache adapter against a real Redis-compatible server.
    - Acceptance: Without the variable the lane reports skipped with the reason. Enabled, a GET miss, population, GET hit, owned-entry eviction and reset behave as under the RESP fixture, and each cache call emits one CLIENT span with no key, value, script or argument attribute; a seeded key capture fails. The result is labelled local; Entra-authenticated Azure Managed Redis behaviour stays with the INF-05 and DAT-02 native facets.

### 36. WEB-01 · Contoso Storefront SPA instrumentation

**Satisfier** · Owner: R2 Front-end Engineer · Build phase C · CD3 22.7 (CoD 34 ÷ 1.5 d) · Needs: INF-01  
Traces to: Prompt §4 web/storefront-spa · Brief §5

Instruments `contoso-storefront-spa` with the Application Insights JavaScript SDK in W3C mode.

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

### 37. IDN-01 · Entra authentication and safe identity attributes

**Satisfier** · Owner: R8 Security & Privacy Red Team · Build phase H · CD3 34.0 (CoD 34 ÷ 1 d) · Needs: ADR-01, JVM-01, WEB-01  
Traces to: Prompt §4 Identity, §5.9 · Brief §10

Authenticates the Storefront and APIs with Microsoft Entra ID and records only safe identity facts.

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

### 38. IDN-02 · HMAC pseudonymization and key rotation

**Satisfier** · Owner: R8 Security & Privacy Red Team · Build phase H · CD3 58.0 (CoD 29 ÷ 0.5 d) · Needs: IDN-01, INF-02  
Traces to: Prompt §5.9 · Brief §5, §10

Gives user analytics a stable pseudonym that cannot be reversed by enumeration.

- [ ] User analytics uses a secret-keyed HMAC over a stable internal subject; the key lives in Key Vault.
- [ ] Key rotation, access control and retention are documented and approved by the privacy owner.
- [ ] A test proves no plain hash of an email address or object ID appears in telemetry.

### 39. WEB-02 · Correlation domains and CORS

**Satisfier** · Owner: R2 Front-end Engineer · Build phase C · CD3 34.0 (CoD 34 ÷ 1 d) · Needs: ARC-01, INF-04, WEB-01  
Traces to: Prompt §4 web/storefront-spa · Brief §5

Limits where the browser sends trace and business headers, and lets the Gateway accept them.

- [ ] `enableCorsCorrelation` is on and `correlationHeaderDomains` lists only the Gateway origin; CDN, analytics, identity and other third-party domains are excluded.
- [ ] An automated browser test proves `traceparent`, `tracestate` and `x-business-invocation-id` reach only approved origins; a call to an excluded domain carries none of them.
- [ ] The Gateway CORS policy allows those headers on preflight for the Storefront origin only; preflight from any other origin is refused.

### 40. DOC-01 · Architecture diagram (Mermaid)

**Satisfier** · Owner: R1 Lead Architect · Build phase A · CD3 32.0 (CoD 16 ÷ 0.5 d) · Needs: ARC-01  
Traces to: Prompt §8 item 2 · Brief Figure 1, §17

The §8 item 2 diagram of the Contoso topology and its correlation boundaries.

- [ ] Shows every §3 component by its Contoso name and tier role (including the role the Orders API plays between the front end and its downstream services), the trust boundaries and the deliberate new roots.
- [ ] Sync parent edges and async link edges are visually distinct.
- [ ] Generated from, or checked against, the boundary map, and renders on GitHub.

#### Child tasks

  - [ ] **DOC-01.1 - Label tier roles and generate the hop-by-hop table from the boundary map**
    - Executor: R1.
    - Prerequisites: ARC-01.1 and the existing diagram generator (`tools\architecture.mjs`) and diagram check.
    - Deliverable: One `docs\ARCHITECTURE.md` update that labels each component's tier role (browser, SSR portal, edge gateway, orchestrating backend-for-frontend, downstream microservice, data store, async worker), states which role the Orders API plays because the repository never names a backend-for-frontend, and adds a hop-by-hop table (caller, carrier, span kind, parent or link, store boundary) generated from the single boundary map. Tier labels are keyed by the map's role names.
    - Acceptance: A drift test fails when the table or a tier label disagrees with the map, when a component lacks exactly one tier label or when a store boundary declared by ARC-01.1 is missing. The diagram still renders on GitHub with sync parent edges and async link edges visually distinct.

### 41. JVM-03 · Manual spans for uncovered business boundaries

**Satisfier** · Owner: R4 Java/OTel Engineer · Build phase E · CD3 32.0 (CoD 16 ÷ 0.5 d) · Needs: JVM-01  
Traces to: Prompt §5.3 · Brief §18

Adds custom spans only where auto-instrumentation leaves a business boundary uncovered.

- [ ] Manual spans (for example `orders.validate`) use `GlobalOpenTelemetry` from the agent.
- [ ] Each records exceptions and error status and carries `business.invocation_id`.
- [ ] Code review and a trace show no span duplicates an auto-instrumented one.

### 42. MSG-02 · Service Bus send and process path

**Satisfier** · Owner: R5 Async/Integration Engineer · Build phase G · CD3 22.7 (CoD 34 ÷ 1.5 d) · Needs: INF-06, JVM-01, MSG-01  
Traces to: Prompt §4 workers/ · Brief §8

Orders API produces to `contoso-orders`; Fulfillment Worker processes it with correct parentage.

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

### 43. MSG-03 · Retry attempt semantics

**Satisfier** · Owner: R5 Async/Integration Engineer · Build phase G · CD3 58.0 (CoD 29 ÷ 0.5 d) · Needs: MSG-02  
Traces to: Prompt §5.6 · Brief §8

Makes every redelivery a new, countable processing attempt.

- [ ] Each redelivery creates a new PROCESS span with a new span-id and an attempt or delivery-count attribute, keeping the original propagated context.
- [ ] Message and business identity are unchanged across attempts.
- [ ] GATE-09 retry checks pass after N injected transient failures.

### 44. OBS-01 · Sampling matrix and bounded certification switch

**Satisfier** · Owner: R7 Observability/KQL Engineer · Build phase I · CD3 29.0 (CoD 29 ÷ 1 d) · Needs: INF-04, JVM-01, WEB-01  
Traces to: Prompt §4 docs/SAMPLING_MATRIX.md, §5.10 · Brief §12

Documents every sampling decision point and provides one switch for the 100% certification window.

- [ ] docs/SAMPLING_MATRIX.md covers browser, APIM, each JVM, the optional Collector and ingestion, for certification and production separately.
- [ ] The Java row records the pinned agent's documented default and override (`VERIFY:`), never "classic adaptive sampling".
- [ ] One configuration switch sets 100% on every layer for a declared window and reverts afterwards; the change record and config snapshots are saved.

### 45. OBS-02 · KQL: trace reconstruction and business lookup

**Satisfier** · Owner: R7 Observability/KQL Engineer · Build phase I · CD3 29.0 (CoD 29 ÷ 1 d) · Needs: INF-01, JVM-04  
Traces to: Prompt §4 kql/ · Brief §18

Delivers `kql/trace-reconstruct.kql` and `kql/business-lookup.kql`, with separate legacy-schema variants.

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

### 46. DEM-00 · Demo harness: one-command run, evidence capture, reset

**Delighter** · Owner: R9 Verifier / Adjudicator · Build phase I · CD3 24.0 (CoD 36 ÷ 1.5 d) · Needs: GATE-13, INF-01, OBS-01, OBS-02  
Traces to: Prompt §6 demo parts · Brief §19 evidence

The shared machinery that makes every demo one command with an automatic evidence pack.

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

### 47. DEM-03 · Contoso Demo 03: Inbound context at the Gateway

**Satisfier** · Owner: R3 API Platform Engineer · Build phase I · CD3 52.0 (CoD 26 ÷ 0.5 d) · Needs: GATE-01, API-01, DEM-00  
Traces to: Prompt §6 Demo 03 · Brief §7

Shows Brief §7, D05-D07 and the sampling invariant live, then the matching evidence in Application Insights and KQL.

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

### 48. DEM-04 · Contoso Demo 04: Trusted-edge business invocation ID

**Satisfier** · Owner: R4 Java/OTel Engineer · Build phase I · CD3 52.0 (CoD 26 ÷ 0.5 d) · Needs: GATE-10, API-02, DEM-00, JVM-04, MSG-02, OBS-02  
Traces to: Prompt §6 Demo 04 · Brief §11, §18

Shows Brief §11 and the §18 trusted-edge logic (E09, E10) live, then the matching evidence in Application Insights and KQL.

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

### 49. DEM-06 · Contoso Demo 06: Service Bus retry semantics

**Satisfier** · Owner: R5 Async/Integration Engineer · Build phase I · CD3 52.0 (CoD 26 ÷ 0.5 d) · Needs: GATE-09, DEM-00, MSG-03  
Traces to: Prompt §6 Demo 06 · Brief §8

Shows Brief §8, G02 and G07 (retry attempts) live, then the matching evidence in Application Insights and KQL.

- [ ] Declare injectedFailures, expectedAttempts, terminal outcome and delivery-count convention. N injected failures followed by success produce N+1 distinct PROCESS attempts; a run stopping after N failed deliveries has N attempts and no success. Actual extra redeliveries are classified, not hidden.
- [ ] Message and business identity are preserved and no span-id is reused (GATE-09).
- [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-06.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

#### Child tasks

  - [ ] **DEM-06.1 - Ship the Demo 06 Service Bus retry adapter**
    - Executor: R5.
    - Prerequisites: DEM-00.1 and the reviewed MSG-03 and GATE-09 retry contracts. Native execution additionally needs the approved INF-06 broker and a separately approved bounded native window.
    - Deliverable: One `tools\verification\adapters\demo06-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 06.
    - Acceptance: The shipped `demos\06\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It declares injectedFailures, expectedAttempts, the terminal outcome and the delivery-count convention and, on a real broker, asserts that N injected failures followed by success produce N+1 distinct PROCESS attempts with new span IDs, that a run stopped after N failures shows N attempts and no success, and that extra redeliveries are classified (GATE-09). Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset drains only run-owned messages, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).

### 50. DEM-12 · Contoso Demo 12: Data-tier safety

**Satisfier** · Owner: R6 Data-Tier Engineer · Build phase I · CD3 52.0 (CoD 26 ÷ 0.5 d) · Needs: GATE-04, DAT-01, DAT-02, DEM-00  
Traces to: Prompt §6 Demo 12 · Brief §9

Shows Brief §9 and F01-F05 (data-tier safety) live, then the matching evidence in Application Insights and KQL.

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

### 51. DEM-13 · Contoso Demo 13: Identity and privacy enrichment

**Satisfier** · Owner: R8 Security & Privacy Red Team · Build phase I · CD3 52.0 (CoD 26 ÷ 0.5 d) · Needs: GATE-04, GATE-10, DEM-00, IDN-01, IDN-02  
Traces to: Prompt §6 Demo 13 · Brief §10

Shows Brief §10 and H01-H03 (identity and privacy) live, then the matching evidence in Application Insights and KQL.

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

### 52. DEM-01 · Contoso Demo 01: Synchronous golden path

**Satisfier** · Owner: R1 Lead Architect · Build phase I · CD3 45.0 (CoD 45 ÷ 1 d) · Needs: GATE-08, API-01, DAT-01, DAT-02, DEM-00, JVM-02, JVM-04, WEB-02  
Traces to: Prompt §6 Demo 01 · Brief §17 sync, §19

Shows Brief §17 synchronous flow and §19 Invariants A, B and C live, then the matching evidence in Application Insights and KQL.

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

### 53. DEM-11 · Contoso Demo 11: Spoofed and malformed message context

**Satisfier** · Owner: R8 Security & Privacy Red Team · Build phase I · CD3 42.0 (CoD 21 ÷ 0.5 d) · Needs: DEM-00, MSG-01, MSG-02  
Traces to: Prompt §6 Demo 11 · Brief §8

Shows Brief G10 and A03 (untrusted message context) live, then the matching evidence in Application Insights and KQL.

- [ ] Spoofed and malformed message context follows ADR A03: a new root and bounded rejection outcome; raw values are absent. Any displayed digest follows the reviewed safe-input/key policy, rather than treating an arbitrary unkeyed personal-data hash as safe.
- [ ] Negative control: the spoofed context is visibly refused.
- [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-11.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

#### Child tasks

  - [ ] **DEM-11.1 - Ship the Demo 11 spoofed-context adapter with an authenticated publisher**
    - Executor: R8.
    - Prerequisites: DEM-00.1 and the reviewed MSG-01 and MSG-02 contracts and ADR A03 rules. Native execution additionally needs the approved INF-06 broker, a publisher identity limited to a run-owned entity and a separately approved bounded native window.
    - Deliverable: One `tools\verification\adapters\demo11-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, including a bounded authenticated publisher that delivers malformed and spoofed message context to a run-owned entity.
    - Acceptance: The shipped `demos\11\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. Delivery is authenticated, so the negative control exercises the consumer's validation rather than transport refusal; the adapter asserts a new root and a bounded rejection outcome, no raw value in telemetry, any displayed digest following the reviewed safe-input and key policy, and the spoofed context visibly refused. Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset removes only run-owned messages, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).

### 54. MSG-04 · Dead-letter preservation and replay tool

**Satisfier** · Owner: R5 Async/Integration Engineer · Build phase G · CD3 29.0 (CoD 29 ÷ 1 d) · Needs: MSG-03  
Traces to: Prompt §4 workers/ DLQ replay tool · Brief §8

Keeps safe identity through dead-lettering and replays with honest link semantics.

- [ ] Dead-lettered messages keep the original MessageId, `business.invocation_id`, trace context and dead-letter reason, with no tokens or payload data in attributes.
- [ ] The replay tool in `workers/` re-submits with the original MessageId recorded and either links to the original context or starts a new trace linked to it.
- [ ] `business.invocation_id` is unchanged after replay; GATE-09 replay checks pass.

### 55. DEM-07 · Contoso Demo 07: Dead-letter and replay

**Satisfier** · Owner: R5 Async/Integration Engineer · Build phase I · CD3 52.0 (CoD 26 ÷ 0.5 d) · Needs: GATE-09, DEM-00, MSG-04  
Traces to: Prompt §6 Demo 07 · Brief §17 async step 5

Shows Brief G08 and §17 async step 5 (dead-letter and replay) live, then the matching evidence in Application Insights and KQL.

- [ ] The dead-lettered message keeps its safe identity and reason.
- [ ] Replay links to the original context or starts a new trace linked to it; `business.invocation_id` is unchanged (GATE-09); the reset drains the dead-letter queue.
- [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-07.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

#### Child tasks

  - [ ] **DEM-07.1 - Ship the Demo 07 dead-letter and replay adapter**
    - Executor: R5.
    - Prerequisites: DEM-00.1 and the reviewed MSG-04 and GATE-09 replay contracts. Native execution additionally needs the approved INF-06 broker and a separately approved bounded native window.
    - Deliverable: One `tools\verification\adapters\demo07-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 07.
    - Acceptance: The shipped `demos\07\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It runs the Fulfillment and Notify dead-letter cases and their replay PROCESS and SEND roots and asserts the dead-lettered message keeps its safe identity and reason, replay links to the original context or starts a linked new trace with `business.invocation_id` unchanged (GATE-09), and reset drains only run-owned dead-letter messages. Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).

### 56. MSG-08 · Fan-out and fan-in with links

**Satisfier** · Owner: R5 Async/Integration Engineer · Build phase G · CD3 29.0 (CoD 29 ÷ 1 d) · Needs: MSG-02  
Traces to: Prompt §4 workers/ aggregator · Brief §8

Fans an order event out to Fulfillment and Notify, then aggregates with links.

- [ ] An event on `contoso-order-events` fans out to Fulfillment and Notify; each creates its own PROCESS span from the propagated context.
- [ ] `contoso-order-aggregator` creates one span with at most one parent and links to every contributor, within the bound.
- [ ] Links show in exported telemetry and in the trace-reconstruction query.

### 57. DEM-08 · Contoso Demo 08: Fan-out and fan-in

**Satisfier** · Owner: R5 Async/Integration Engineer · Build phase I · CD3 52.0 (CoD 26 ÷ 0.5 d) · Needs: GATE-09, DEM-00, MSG-08  
Traces to: Prompt §6 Demo 08 · Brief §17 async step 6

Shows Brief G09 and §17 async step 6 (fan-out, fan-in) live, then the matching evidence in Application Insights and KQL.

- [ ] Fulfillment and Notify each show their own PROCESS span.
- [ ] The Aggregator has at most one parent plus bounded links to every contributor (GATE-09).
- [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-08.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

#### Child tasks

  - [ ] **DEM-08.1 - Ship the Demo 08 fan-out and fan-in adapter**
    - Executor: R5.
    - Prerequisites: DEM-00.1 and the reviewed MSG-08 and GATE-09 contracts. Native execution additionally needs the approved INF-06 broker and a separately approved bounded native window.
    - Deliverable: One `tools\verification\adapters\demo08-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 08.
    - Acceptance: The shipped `demos\08\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It observes the separate Fulfillment and Notify PROCESS spans and asserts the Aggregator has at most one parent plus bounded links to every persisted contributor (GATE-09). Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset removes only run-owned messages and state, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).

### 58. DEM-14 · Contoso Demo 14: Orphan-candidate triage

**Satisfier** · Owner: R7 Observability/KQL Engineer · Build phase I · CD3 36.0 (CoD 18 ÷ 0.5 d) · Needs: ARC-01, DEM-00, OBS-03  
Traces to: Prompt §6 Demo 14 · Brief §18

Shows Brief §18 orphan query and I08 live, then the matching evidence in Application Insights and KQL.

- [ ] Every candidate is classified as expected-remote, cross-resource, sampled, delayed or defect, with justification.
- [ ] Defects = 0.
- [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-14.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

#### Child tasks

  - [ ] **DEM-14.1 - Ship the Demo 14 orphan-candidate triage adapter**
    - Executor: R7.
    - Prerequisites: DEM-00.1 and ARC-01.1, the reviewed OBS-03 query and a deployed Demo 01 trace set. Native execution additionally needs approved workspace query permission and a separately approved bounded native window.
    - Deliverable: One `tools\verification\adapters\demo14-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 14.
    - Acceptance: The shipped `demos\14\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It runs the orphan-candidate query over the deployed trace set and classifies every candidate as expected-remote, cross-resource, sampled, delayed or defect from the boundary map; defects must be 0 and an unexplained candidate stays a defect. Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset removes only run-owned query artifacts, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).

### 59. DOC-02 · README quick start

**Satisfier** · Owner: R1 Lead Architect · Build phase I · CD3 32.0 (CoD 16 ÷ 0.5 d) · Needs: DEM-01, INF-04 to INF-06  
Traces to: Prompt §4 README.md

Gets a new engineer from clone to a passing Demo 01.

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

### 60. WEB-03 · Contoso Portal SSR instrumentation

**Satisfier** · Owner: R2 Front-end Engineer · Build phase C · CD3 26.0 (CoD 26 ÷ 1 d) · Needs: INF-03, INF-04  
Traces to: Prompt §4 web/portal-ssr · Brief §5

Instruments `contoso-portal-ssr` on the server, independently of the browser.

- [ ] Server requests and outbound calls appear under the stable role name `contoso-portal-ssr`.
- [ ] Outbound calls to the Gateway carry a valid `traceparent` from the server span, and the Gateway continues it.
- [ ] Where browser page telemetry and the server render form separate roots, the boundary map records it as expected.
- [ ] The process runs exactly one telemetry provider.

### 61. DEM-02 · Contoso Demo 02: Portal SSR path vs SPA path

**Satisfier** · Owner: R2 Front-end Engineer · Build phase I · CD3 32.0 (CoD 16 ÷ 0.5 d) · Needs: ARC-01, DEM-00, WEB-01, WEB-03  
Traces to: Prompt §6 Demo 02 · Brief §5

Shows Brief §5 (SSR versus SPA roots) live, then the matching evidence in Application Insights and KQL.

- [ ] SSR requests appear under the stable role name `contoso-portal-ssr`.
- [ ] Separate roots between browser page telemetry and the server render are shown and explained from the boundary map.
- [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-02.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

#### Child tasks

  - [ ] **DEM-02.1 - Ship the Demo 02 Portal SSR versus SPA adapter**
    - Executor: R2.
    - Prerequisites: DEM-00.1 and the reviewed WEB-01 and WEB-03 contracts. Native execution additionally needs the approved deployed Storefront and Portal, the Portal controller authentication, the pinned Portal runtime image and a separately approved bounded native window.
    - Deliverable: One `tools\verification\adapters\demo02-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 02.
    - Acceptance: The shipped `demos\02\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It observes browser page telemetry under `contoso-storefront-spa` and the server render under `contoso-portal-ssr` as independently captured roots, asserts the SSR-to-Gateway parent join and explains the separate roots from the boundary map. Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset restores the run-owned baseline and leaves unowned state unchanged, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).

### 62. MSG-06 · Event Hubs mixed-context batch path

**Satisfier** · Owner: R5 Async/Integration Engineer · Build phase G · CD3 24.0 (CoD 24 ÷ 1 d) · Needs: INF-06, JVM-01, MSG-01  
Traces to: Prompt §4 async path · Brief §8

Processes a batch of events from different traces without inventing a parent.

- [ ] Events from different traces go to `contoso-telemetry-batch` and are consumed as one batch; offsets advance only after durable outcomes under the fenced partition lease, and a restart or replay neither drops nor double-counts a contributor.
- [ ] The batch span links to each contributing context within a configured bound, or uses a documented bounded per-item representation; the first message is never the parent.
- [ ] Partition and offset are recorded as safe attributes; the link bound is a parameter.

#### Child tasks

  - [ ] **MSG-06.1 - Prove fenced Event Hubs checkpoint recovery against a real hub**
    - Executor: R5.
    - Prerequisites: The reviewed batch handler and checkpoint-store contract; an approved INF-06 hub `contoso-telemetry-batch` with a run-owned consumer group and a separately approved bounded window.
    - Deliverable: One opt-in restart-and-replay qualification against the real hub with a source-bound receipt. Without an approved namespace it skips with an explicit reason.
    - Acceptance: Offsets advance only after durable outcomes under the fenced partition lease. Killing the consumer after processing but before its checkpoint and restarting it neither drops nor double-counts a contributor, and a consumer that lost its fence cannot advance the checkpoint. Each batch span links every contributor within the configured bound and the first event is never the parent. A seeded early checkpoint fails. In-memory runs are construction only.

### 63. DEM-09 · Contoso Demo 09: Event Hubs mixed-context batch

**Satisfier** · Owner: R5 Async/Integration Engineer · Build phase I · CD3 36.0 (CoD 18 ÷ 0.5 d) · Needs: GATE-09, DEM-00, MSG-06  
Traces to: Prompt §6 Demo 09 · Brief §8

Shows Brief G04 and the batch test live, then the matching evidence in Application Insights and KQL.

- [ ] Batch processing uses links or a bounded per-item representation.
- [ ] The first message is never the parent (GATE-09).
- [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-09.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

#### Child tasks

  - [ ] **DEM-09.1 - Ship the Demo 09 mixed-context batch adapter**
    - Executor: R5.
    - Prerequisites: DEM-00.1 and the reviewed MSG-06 and GATE-09 contracts. Native execution additionally needs the approved INF-06 Event Hubs namespace and a separately approved bounded native window.
    - Deliverable: One `tools\verification\adapters\demo09-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 09.
    - Acceptance: The shipped `demos\09\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It produces events from different traces to `contoso-telemetry-batch`, consumes them as one mixed-context batch and asserts links or a bounded per-item representation with the first message never the parent (GATE-09). Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset removes only run-owned events and state, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).

### 64. OBS-04 · Load, overhead and cost test

**Satisfier** · Owner: R7 Observability/KQL Engineer · Build phase I · CD3 22.7 (CoD 34 ÷ 1.5 d) · Needs: DAT-01, DAT-02, MSG-02, OBS-01  
Traces to: Prompt §6 Demo 15 · Brief §24 Operational stability

Measures what correlation costs at representative load.

- [ ] A repeatable load profile measures latency, CPU, memory, throughput, ingestion volume, exporter backpressure and cost at certification and production sampling.
- [ ] Gateway diagnostic and policy overhead is reported before and after.
- [ ] Restart and shutdown under load show no unacceptable span loss.
- [ ] Results are compared with thresholds agreed in advance and saved under `evidence/`.

### 65. OBS-07 · Production sampling profile with rollback

**Delighter** · Owner: R7 Observability/KQL Engineer · Build phase I · CD3 30.0 (CoD 15 ÷ 0.5 d) · Needs: OBS-01, OBS-04  
Traces to: Prompt §6 Demo 15 · Brief §12 Production strategy

A version-controlled production sampling proposal that Demo 15 can switch to and roll back.

- [ ] Per-layer production rates and error and critical-path rules are version-controlled and based on OBS-04 measurements.
- [ ] A one-step rollback restores the previous profile and is tested.
- [ ] Labelled as a proposal for Brief J02, outside the certification scope.

### 66. DEM-15 · Contoso Demo 15: Sampling, overhead and certification-to-production switch

**Satisfier** · Owner: R7 Observability/KQL Engineer · Build phase I · CD3 26.0 (CoD 26 ÷ 1 d) · Needs: GATE-12, DEM-00, OBS-01, OBS-04, OBS-07  
Traces to: Prompt §6 Demo 15 · Brief §12

Shows Brief §12, I01, I09 and J02 (sampling, overhead, switch) live, then the matching evidence in Application Insights and KQL.

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

### 67. MSG-05 · Event Grid CloudEvents path

**Satisfier** · Owner: R5 Async/Integration Engineer · Build phase G · CD3 24.0 (CoD 24 ÷ 1 d) · Needs: INF-06, JVM-01, MSG-01  
Traces to: Prompt §4 async path · Brief §8

Publishes CloudEvents with trace context in the distributed-tracing extension, never in the event `id`.

- [ ] Orders API publishes to `contoso-corr-poc-egt` with context in the CloudEvents distributed-tracing extension; the event `id` is never the trace-id.
- [ ] The subscriber extracts the context and creates a PROCESS span; propagation is validated end to end.
- [ ] Duplicate deliveries are detected by event `id` and handled idempotently; size and validation limits are enforced.

### 68. INF-07 · Access and retention governance

**Satisfier** · Owner: R8 Security & Privacy Red Team · Build phase H · CD3 24.0 (CoD 24 ÷ 1 d) · Needs: ADR-01, INF-01  
Traces to: Prompt §4 infra (RBAC) · Brief §13

Restricts who can query and export telemetry, and sets retention and purge for business IDs.

- [ ] Resource-context RBAC follows the ADR A05 map; an access test shows an unauthorized identity cannot query or export telemetry, with audit evidence saved.
- [ ] Retention for tables that carry `business.invocation_id` follows ADR A02.
- [ ] A purge procedure is documented and tested on synthetic data.
- [ ] Owners for topology, RBAC, retention and purge are named for the Governance row.

### 69. DEM-05 · Contoso Demo 05: Error and timeout correlation

**Satisfier** · Owner: R4 Java/OTel Engineer · Build phase I · CD3 18.0 (CoD 18 ÷ 1 d) · Needs: DAT-01, DEM-00, JVM-03  
Traces to: Prompt §6 Demo 05 · Brief §19

Shows Brief I04 (errors keep correlation) live, then the matching evidence in Application Insights and KQL.

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

### 70. DEM-10 · Contoso Demo 10: Event Grid CloudEvents and Storage Queue envelope

**Satisfier** · Owner: R5 Async/Integration Engineer · Build phase I · CD3 18.0 (CoD 18 ÷ 1 d) · Needs: GATE-09, DEM-00, MSG-05, MSG-07  
Traces to: Prompt §6 Demo 10 · Brief §8

Shows Brief G03, G05 and the envelope contract live, then the matching evidence in Application Insights and KQL.

- [ ] CloudEvent `id` differs from the trace-id; context survives through the distributed-tracing extension and through the envelope.
- [ ] Size and validation limits are enforced and a duplicate delivery is handled.
- [ ] Assertion, evidence pack and reset run through DEM-00 using this demo's own shipped scenario adapter (DEM-10.1: trigger, effect, collect and reset handlers; no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), and the demo fits 3-5 minutes.

#### Child tasks

  - [ ] **DEM-10.1 - Ship the Demo 10 Event Grid and Storage Queue adapter**
    - Executor: R5.
    - Prerequisites: DEM-00.1 and the reviewed MSG-05, MSG-07 and GATE-09 contracts. Native execution additionally needs the approved INF-06 Event Grid topic, relay and Storage Queue, and a separately approved bounded native window.
    - Deliverable: One `tools\verification\adapters\demo10-runtime.mjs` exporting `createAdapter()` under the existing `contoso.demo-adapter.v1` contract, composing the existing shipped implementations for Demo 10.
    - Acceptance: The shipped `demos\10\Run.ps1` loads the reviewed adapter by its actual SHA-256 and no longer returns `D_MISSING_ADAPTER`. It drives the Event Grid relay and Storage Queue envelope paths, including the size and validation limits and a duplicate delivery, and asserts the CloudEvent `id` differs from the trace ID, context survives the distributed-tracing extension and the envelope, and the duplicate is handled. Every adapter method is concrete (no stub, inherited Demo 01 PASS, fixture PASS or presenter-supplied callback), reset removes only run-owned messages, and local runs are construction only (BootstrapValidate stays NOT CERTIFIED).

### 71. DOC-03 · DEMO_RUNBOOK.md: operations

**Satisfier** · Owner: R1 Lead Architect · Build phase I · CD3 18.0 (CoD 18 ÷ 1 d) · Needs: DEM-00  
Traces to: Prompt §4 docs/DEMO_RUNBOOK.md, §8 item 4

Pre-show, timing and reset procedures for all 15 demos.

- [ ] A pre-show checklist covers the certification window, sampling state, seed data and a baseline check.
- [ ] Gives the demo order with a 3-5 minute budget and the reset steps for each demo.
- [ ] Gives recovery steps for a demo that fails mid-show.

### 72. CRT-03 · Residual limitations and §23 coverage map

**Satisfier** · Owner: R9 Verifier / Adjudicator · Build phase J · CD3 18.0 (CoD 18 ÷ 1 d) · Needs: none  
Traces to: Prompt §8 item 8, §9 · Brief §20, §23

States plainly what the POC covers and what it does not.

- [ ] Every §20 failure mode is marked covered (with the card, demo or gate) or not covered (with the reason).
- [ ] Every §23 production-ready item is marked in scope (with evidence) or explicitly deferred, including the Azure Cache for Redis migration plan (F06), production rollout (J03-J10) and the deferrals recorded in ADR A04 and `docs\RESIDUAL_LIMITATIONS.md` (native Functions-binding parity, automatic JDBC/Redis instrumentation qualification, third-party exporter parity).
- [ ] Delivered as §8 item 8 and satisfies the first §9 check; every supporting status report under `docs\` (test coverage, Java validation, observability) names its source commit and quotes counts only from current receipts, or is labelled historical when sources change.

#### Child tasks

  - [ ] **CRT-03.1 - Refresh or label the test-coverage report**
    - Executor: R9.
    - Prerequisites: Current Node and Java test receipts on a recorded source commit.
    - Deliverable: One update of `docs\TEST_COVERAGE_REPORT.md` that either regenerates its commit and counts from those receipts or labels the whole report HISTORICAL with the commit it describes (currently `63a2a5d`).
    - Acceptance: A static check fails when the report quotes a total that differs from the receipt it cites, names no source commit, or lacks a HISTORICAL label while its source closure has changed. Skipped tests are reported as skipped, not as passes.

### 73. OBS-05 · Correlation workbook

**Delighter** · Owner: R7 Observability/KQL Engineer · Build phase I · CD3 11.0 (CoD 11 ÷ 1 d) · Needs: OBS-02, OBS-03  
Traces to: Prompt §4 workbooks/ · Brief §13

Delivers `workbooks/contoso-correlation.workbook.json` for point-and-click evidence.

- [ ] Deploys with the IaC and offers trace reconstruction by trace-id, business lookup by ID, orphan-candidate triage and ingestion volume against budget.
- [ ] Driven by parameters only; no hard-coded identifiers or secrets.
- [ ] A presenter can run every demo's live-show step from the workbook instead of raw KQL.

### 74. DOC-04 · Presenter talk track for Demos 01-15

**Delighter** · Owner: R1 Lead Architect · Build phase I · CD3 9.3 (CoD 14 ÷ 1.5 d) · Needs: DOC-03  
Traces to: Prompt §8 item 4 · Brief §17-§19

What to say, click and point at in each demo.

- [ ] For each demo: the claim proven (Brief §), what to click in Application Map and Transaction Diagnostics, which evidence to point at, and what the demo rules out.
- [ ] Two likely audience questions per demo, with answers grounded in the Brief.
- [ ] A timed dry run keeps each segment within 3-5 minutes.

### 75. CRT-02 · Certification run, sign-off package and executive summary

**Satisfier** · Owner: R9 Verifier / Adjudicator · Build phase J · CD3 19.0 (CoD 38 ÷ 2 d) · Needs: all 13 gates, CRT-01, CRT-03, DEM-01 to DEM-15, DOC-01 to DOC-04, INF-07, OBS-05  
Traces to: Prompt §7 J01, §8 item 1, §9 · Brief §19 Sign-off, §24

Runs the bounded certification window, completes the report and returns the output in §8 order.

- [ ] With GATE-05 passed, a bounded certification window runs all 15 demos with every gate green; VERSIONS.md is frozen and hashed.
- [ ] CERTIFICATION_REPORT.md has evidence links and pass/fail for every §24 row.
- [ ] R9 confirms the §5 non-negotiables and every §9 checklist item with evidence.
- [ ] The executive summary (10 lines or fewer) states what was built, the certification status and the open VERIFY items, and the output is returned in §8 order; Contoso Eval A/B stay outside it.

### 76. OBS-06 · Orphan-candidate triage classifier

**Delighter** · Owner: R7 Observability/KQL Engineer · Build phase I · CD3 13.0 (CoD 13 ÷ 1 d) · Needs: OBS-03  
Traces to: Prompt §6 Demo 14 · Brief §18

Automates Demo 14's orphan triage so it can run routinely after certification.

- [ ] Each candidate is classified as expected-remote, cross-resource, sampled, delayed or defect, with the evidence used.
- [ ] An unexplained candidate defaults to defect until a reviewer records a justification.
- [ ] Demo 14 reruns and the regression suite can use its output in place of manual triage.

### 77. EVL-B · Contoso Eval B: Azure Monitor Traces / Trace Analytics preview lane

**Delighter** · Owner: R7 Observability/KQL Engineer · Build phase J · CD3 5.0 (CoD 5 ÷ 1 d) · Needs: CRT-02  
Traces to: Prompt §6 Contoso Eval B · Brief §14

An isolated, optional evaluation of the Trace Analytics preview.

- [ ] Records preview terms, regional availability, schema and rollback.
- [ ] Has no production or certification dependency; GATE-07 passes.
- [ ] Findings are dated and flagged for re-check.

### 78. EVL-A · Contoso Eval A: Collector tail-sampling lane

**Delighter** · Owner: R7 Observability/KQL Engineer · Build phase J · CD3 4.7 (CoD 7 ÷ 1.5 d) · Needs: ADR-02, CRT-02  
Traces to: Prompt §6 Contoso Eval A · Brief A04

An isolated, optional evaluation of an OpenTelemetry Collector tail-sampling lane.

- [ ] Runs only if an ADR A04 trigger is documented; otherwise the card closes with "rejected: no trigger" recorded.
- [ ] Reports high availability, capacity and late-span behaviour.
- [ ] Isolated from certification: GATE-07 passes and no certification component references it.

## Rule checks

| Check | Result |
|---|---|
| 1 dissatisfier to 5 satisfiers and delighters | 13 : 65 (57 satisfiers + 8 delighters) = 1 : 5. Pass |
| Dissatisfiers first | All 13 rank 1 to 13. Pass |
| No card above a card it needs | Every card ranks below all its prerequisites. Pass |
| Satisfiers ahead of delighters unless CD3 justifies | Each delighter placement is listed below with its CD3 justification. Pass |
| Cards ranked above their own CD3 (↑) | 22, each needed by a higher-priority card; see the Note column. |

### Where each delighter sits, and why

Rule 2 compares a delighter with the best satisfier that can start at that point. A satisfier still waiting on other cards counts at its group CD3, because its value can't arrive before the group is done. Example: ARC-01 scores 68.0 alone but can't start before ADR-01, so at rank 17 it counted as the ADR-01 + ARC-01 group (54.7).

| Rank | Delighter | Own CD3 | Why it sits here |
|---:|---|---:|---|
| 17 | GOV-01 · Adjudication log and claim-labelling workflow | 82.0 | CD3 rule: 82.0 is 1.50× the best satisfier available at that point (ADR-01 group, 54.7), meeting the 1.5× bar. |
| 46 | DEM-00 · Demo harness: one-command run, evidence capture, reset | 24.0 | Needed by satisfier DEM-01; ranked with that group (CD3 32.4). |
| 65 | OBS-07 · Production sampling profile with rollback | 30.0 | Needed by satisfier DEM-15; ranked with that group (CD3 27.3). |
| 73 | OBS-05 · Correlation workbook | 11.0 | Needed by satisfier CRT-02; ranked with that group (CD3 14.0). |
| 74 | DOC-04 · Presenter talk track for Demos 01-15 | 9.3 | Needed by satisfier CRT-02; ranked with that group (CD3 14.9). |
| 76 | OBS-06 · Orphan-candidate triage classifier | 13.0 | After every satisfier: no CD3 or dependency case for moving it up. |
| 77 | EVL-B · Contoso Eval B: Azure Monitor Traces / Trace Analytics preview lane | 5.0 | After every satisfier: no CD3 or dependency case for moving it up. |
| 78 | EVL-A · Contoso Eval A: Collector tail-sampling lane | 4.7 | After every satisfier: no CD3 or dependency case for moving it up. |

## Coverage checks

### Prompt §5 non-negotiables → gates

| Non-negotiable | Enforced by |
|---|---|
| 1. W3C Trace Context is the only causality protocol | GATE-01, GATE-08 |
| 2. Validate inbound context; new root only when absent, invalid or at a trust boundary | GATE-08 (with API-01, MSG-01) |
| 3. One OpenTelemetry provider per JVM | GATE-02, GATE-05 |
| 4. No `-00` → `-01` rewrite; no trace-id from `context.RequestId` | GATE-01, GATE-10 |
| 5. `business.invocation_id` trusted, opaque, allowlisted; never a credential or metric dimension | GATE-10 (with JVM-04, API-02) |
| 6. Retries are new PROCESS spans; replay, fan-in and batches use links | GATE-09 |
| 7. JDBC and Redis are client spans only; no literals, keys or values | GATE-04, GATE-08 |
| 8. No secrets, tokens, bodies or PII; Key Vault references; body capture 0 | GATE-03, GATE-04 |
| 9. Entra IDs kept separate; HMAC pseudonym for user analytics | GATE-10, GATE-04 (with IDN-01, IDN-02) |
| 10. 100% sampling only in bounded certification mode | GATE-12 |
| 11. Azure Managed Redis; preview kept off the certification path | GATE-07 |

### Brief §24 certification criteria → proof

| Criterion | Proved by |
|---|---|
| Coverage | GATE-08, GATE-09, DEM-01 to DEM-15 |
| Trace identity | GATE-08, DEM-01 |
| Span identity | GATE-08, DEM-01, DEM-06 |
| No falsification | GATE-01, GATE-10, DEM-03 |
| Async honesty | GATE-09, DEM-06 to DEM-10 |
| Durable lookup | OBS-02, DEM-04, GATE-10 |
| Data safety | GATE-03, GATE-04, DEM-12, DEM-13 |
| Operational stability | OBS-04, GATE-05, DEM-15 |
| Backend usability | OBS-02, OBS-03, DEM-01, DEM-14 |
| Governance | INF-01, INF-07, OBS-01, GATE-07, CRT-02 |
| Repeatability | GATE-11, GATE-12, GATE-13 |

### Prompt §8 required outputs → items

| Output | Delivered by |
|---|---|
| 1. Executive summary | CRT-02 |
| 2. Architecture diagram (Mermaid) | DOC-01 (from ARC-01) |
| 3. Full repository per §4 | all INF, WEB, API, JVM, DAT, MSG, IDN, OBS, DEM cards; README in DOC-02; VERSIONS.md in JVM-05 |
| 4. DEMO_RUNBOOK.md with talk track | DOC-03, DOC-04 |
| 5. CERTIFICATION_REPORT.md template | CRT-01 |
| 6. DECISIONS.md: ADRs A01 to A06 and adjudication log | ADR-01, ADR-02, GOV-01 |
| 7. VERIFY register | GATE-06 |
| 8. Residual limitations | CRT-03 |

### Brief §22 atomic plan → items

| Brief action | Delivered by |
|---|---|
| A01 | ADR-01 |
| A02 | ADR-01 |
| A03 | ADR-01 |
| A04 | ADR-02 |
| A05 | ADR-02 |
| A06 | ADR-02 |
| B01 | INF-01 |
| B02 | INF-01 |
| B03 | INF-04 |
| B04 | INF-04 |
| B05 | INF-01 |
| B06 | INF-07 |
| B07 | INF-05 |
| C01 | ARC-01 |
| C02 | WEB-01 |
| C03 | WEB-01 |
| C04 | WEB-02 |
| C05 | WEB-02 |
| C06 | IDN-02 |
| C07 | WEB-01 |
| C08 | WEB-03 |
| D01 | INF-04 |
| D02 | INF-04 |
| D03 | API-02 |
| D04 | GATE-04, INF-04 |
| D05 | GATE-01, API-01 |
| D06 | GATE-01, API-01 |
| D07 | API-01, DEM-03 |
| D08 | OBS-04 |
| E01 | JVM-05 |
| E02 | JVM-05 |
| E03 | JVM-01 |
| E04 | JVM-01 |
| E05 | JVM-02 |
| E06 | GATE-02 |
| E07 | JVM-03 |
| E08 | GATE-05 |
| E09 | JVM-04 |
| E10 | JVM-04 |
| F01 | DAT-01 |
| F02 | GATE-04, DAT-01 |
| F03 | DAT-01 |
| F04 | DAT-02 |
| F05 | GATE-04, DAT-02 |
| F06 | Deferred: this is a new Managed Redis POC, not an authorized existing-estate migration; recorded in CRT-03 |
| G01 | MSG-01 |
| G02 | MSG-02 |
| G03 | MSG-05 |
| G04 | MSG-06 |
| G05 | MSG-07 |
| G06 | MSG-02 |
| G07 | MSG-03 |
| G08 | MSG-04 |
| G09 | MSG-08 |
| G10 | MSG-01 |
| H01 | IDN-01 |
| H02 | IDN-02 |
| H03 | GATE-04 |
| H04 | INF-07 |
| H05 | INF-07 |
| I01 | OBS-01 |
| I02 | OBS-01 |
| I03 | GATE-08, DEM-01 |
| I04 | DEM-05 |
| I05 | GATE-09, DEM-06, DEM-07 |
| I06 | GATE-09, DEM-08, DEM-09 |
| I07 | OBS-02, DEM-04 |
| I08 | OBS-03, DEM-14, OBS-06 |
| I09 | OBS-04, DEM-15 |
| J01 | CRT-02 |
| J02 | OBS-07 |
| J03 | Deferred: outside the Prompt's build sequence (§7 stops at J01); recorded in CRT-03 |
| J04 | Deferred: outside the Prompt's build sequence (§7 stops at J01); recorded in CRT-03 |
| J05 | Deferred: outside the Prompt's build sequence (§7 stops at J01); recorded in CRT-03 |
| J06 | Deferred: outside the Prompt's build sequence (§7 stops at J01); recorded in CRT-03 |
| J07 | EVL-A |
| J08 | EVL-B |
| J09 | Deferred: outside the Prompt's build sequence (§7 stops at J01); recorded in CRT-03 |
| J10 | Deferred: outside the Prompt's build sequence (§7 stops at J01); recorded in CRT-03 |

### Unproven-claim ledger → cards

Every claim that the repository, its local evidence or its review reports make without native proof maps to the acceptance clauses that must close it. The ledger adds no cards, clauses or estimates; each gap that needs bounded work is carried by an atomic child task named in the third column; its sources are `README.md`, `docs\RESIDUAL_LIMITATIONS.md`, `docs\CERTIFICATION_REPORT.md`, `apim\README.md`, `services\security-core\docs\AV23.md`, `DECISIONS.md`, the board state and an execution review at commit `7279cd3`. A clause marked *(updated)* was tightened in that review because it was silent on the claim. Local fixtures never close a live facet.

| ID | Unproven or unplanned claim | Accounted for by | Evidence still required |
|---|---|---|---|
| UC-01 | One trace from browser or Portal through the Gateway, Orders and Inventory to the data stores. No captured local trace contains a Gateway or browser row, and every end-to-end local trace begins at the Orders request. | GATE-08 clauses 1-3, DEM-01 clauses 1-3, DEM-01.1, OBS-02.1 | Deployed capture bound to one UTC window with source-emitted and native row correspondence |
| UC-02 | APIM native extraction, parent advancement, absent/invalid root timing and strict `-00`; Demo 03 vectors are carrier-only (`liveAcceptance` To Do). | API-01 clauses 1-4, DEM-03, DEM-03.1, INF-04 clauses 3-4, GATE-01 clause 4 | Real inbound/outbound carriers, Gateway backend dependency ID and SDK sampled/recording state |
| UC-03 | Dual-token chain: caller token at the Gateway, Gateway managed-identity proof, Orders → Inventory token, workload without human pseudonym, demo/control role. | IDN-01 clause 1 *(updated)*, IDN-01.1, DEM-13, DEM-13.1 | Native negative controls through the deployed Gateway |
| UC-04 | No W3C or business headers reach identity endpoints on JWKS or managed-identity attempts (AV-23 server side). Historical Java failures are preserved; current-source, worker default-client and installed-consumer lineage is unverified. | IDN-01 clause 3 *(updated)*, IDN-01.2, IDN-01.3, IDN-01.4, GATE-04 clauses 1-2, WEB-02 (browser side) | Per-JVM and Portal native wire evidence on the current build |
| UC-05 | Real PostgreSQL and Redis operations. Local evidence uses H2 in PostgreSQL mode, a RESP fixture, synthetic JWTs and an unavailable broker. | INF-05, INF-05.1, DAT-01, DAT-02, DAT-01.1, DAT-01.3, DAT-02.1, DEM-12, DEM-12.1 | Private Entra-authenticated operations with exported CLIENT spans |
| UC-06 | The Orders workflow/outbox store and each worker messaging store emit PostgreSQL CLIENT spans that the boundary map does not declare. | ARC-01 clause 1, ARC-01.1, GATE-08.1, DAT-01 clause 1, DEM-12 clause 1, INF-05 clause 3 *(all updated)* | Map extension plus native spans for every store-consuming tier |
| UC-07 | Durable-outbox publication keeps the persisted request context across delayed and retried publish attempts without re-parenting or re-sampling it. | MSG-02 clause 1 *(updated)*, MSG-02.1, MSG-05 clause 3 | Real broker publish attempts, including an uncertain-publish retry |
| UC-08 | Real brokers and Functions host. The selected path is timer-polled and SDK-managed; native trigger-binding parity is not claimed. | INF-06, MSG-02 clause 3 and MSG-07 clause 3 *(updated)*, MSG-03 to MSG-08, DEM-06 to DEM-10 | Real delivery, DLQ, replay, fan-in and batch rows; parity stays a separate qualification |
| UC-09 | Event Hubs checkpoint recovery under the fenced partition lease. | MSG-06 clause 1 *(updated)*, MSG-06.1 | Restart and replay that neither drops nor double-counts a contributor |
| UC-10 | Sampling: Contoso-owned guard 1.1.0 is not a vendor-supported sampler; strict `-00` and linked-root behaviour, complete participant ACKs and loss accounting remain unproven natively. | OBS-01, GATE-02.1, GATE-06 clause 1, GATE-09 clauses 2-3, GATE-12, GATE-13 clauses 1-3, OBS-04 clause 3 | Native roster ACKs, independent emission ledger and bracketing canaries |
| UC-11 | Runnable demos. At commit `7279cd3` all fifteen `Run.ps1` entry points return `FAIL D_MISSING_ADAPTER` and no adapter ships; the harness fails closed by design. | DEM-00 clauses 1-4 *(updated)*, DEM-00.1, DEM-00.2, DEM-02 to DEM-15 closing clause *(updated)*, DEM-02.1, DEM-03.1, DEM-04.1, DEM-05.1, DEM-05.2, DEM-06.1, DEM-07.1, DEM-08.1, DEM-09.1, DEM-10.1, DEM-11.1, DEM-12.1, DEM-13.1, DEM-14.1, DEM-15.1 | Shipped per-demo adapters and two consecutive run/reset cycles |
| UC-12 | Backend usability: Application Map and Transaction Diagnostics captures are NOT CAPTURED; the three KQL procedures and the workbook have not run on a real workspace. | DEM-00 clause 1, DEM-01 clause 3, OBS-02, OBS-03, OBS-05, DEM-14 | Live queries, workbook import and render, and screenshots |
| UC-13 | All-table privacy; arbitrary URL, header, body and exception privacy; public browser telemetry injection is a disclosed limit. | GATE-04 clauses 1-3, DEM-12, DEM-13, CRT-03 | Full workspace raw-column classification and negative effects |
| UC-14 | Deployability. Bicep 0.48.1 has no type definitions for `Microsoft.Cache/redisEnterprise@2026-09-01` or `Microsoft.DBforPostgreSQL/flexibleServers@2026-10-01` (BCP081), so provider property validation happens only at deployment. | GATE-11 clauses 1 and 4, INF-05 clause 1, INF-05.2, GATE-06 clause 1 | Empty-group deployment, no-change second what-if and teardown/redeploy |
| UC-15 | Repeatability by another engineer: tool-root defaults that point at another operator's session folder (six Java scripts, the Inventory fixture script, the AV-23 probe, the security client qualification and the messaging infrastructure test), the default PowerShell execution policy, and the missing `azure.yaml`, every-PR CI workflows and pull-request template. | DOC-02.1 *(updated)*, GATE-11.1, GATE-11.2, GATE-05.1, GATE-05.2, DAT-01.2, GATE-13.1, IDN-01.2, INF-06.1, GATE-03.1, GATE-12.1, GOV-01.1, INF-01 clause 4, GATE-11 clause 1 *(updated)*, GATE-01 clause 1, GATE-03 clause 1, GATE-05 clause 4, GATE-12 clause 3, GOV-01 clause 2 | Fresh-clone reproduction, a running CI workflow and a committed review template |
| UC-16 | 628 numeric version, API and SKU pins remain OPEN, including the Node exporter beta dependency and the user-approved Contoso sampler. | GATE-06 clauses 1-4, GATE-06.1, JVM-05 clause 3 | Official-source content, support/GA review and deployed values |
| UC-17 | Status-report currency: `verify:report` reported the certification report stale at `7279cd3` (refreshed by `verify:invalidate` in this review, which demoted the linked-root local qualification to UNVERIFIED because its sources changed), and `docs\TEST_COVERAGE_REPORT.md` cites commit `63a2a5d` with Node 419 and Java 182 tests where the suites at `7279cd3` run Node 492 and Java 213. | GATE-12 clause 3, GATE-12.1, CRT-03 clause 3 *(updated)*, CRT-03.1, GATE-02.1, CRT-01 | Re-qualified local evidence on current sources and a refreshed or historical-labelled coverage report |
| UC-18 | RBAC, retention, purge and six accountable owner signoffs. | INF-07, CRT-01 clause 3, CRT-02 clauses 1-3 | Real access tests, purge evidence and signed decisions |
| UC-19 | Explicit non-claims: F06, J03-J10, native Functions-binding parity, automatic JDBC/Redis instrumentation, third-party exporter parity and the Eval A/B lanes. | CRT-03 clause 2 *(updated)*, EVL-A, EVL-B | Recorded as deferrals; never certified by this POC |
| UC-20 | No single local run joins the browser, a Gateway stand-in, Orders, Inventory and both data boundaries, and the data-tier local evidence cannot reveal real PostgreSQL or Redis behaviour (H2 in PostgreSQL mode and a RESP fixture). | JVM-01.1, WEB-01.1, OBS-02.2, DEM-01.2, DAT-01.3, DAT-02.1 | A one-command local rehearsal tree and opt-in real-store lanes, each labelled local; neither closes a live facet |
| UC-21 | Reader orientation: no document names the tier that fronts the Storefront and orchestrates Inventory and messaging (the Orders API), and the verification tooling and repository-level tests are larger, by source size, than the product code they verify. | DOC-01 clause 1 *(updated)*, DOC-01.1, DOC-02 clause 3 *(updated)*, DOC-02.2 | A generated tier table checked against the boundary map and a tested, classified repository map |

## Definition of Done (every item)

1. Acceptance criteria met, with evidence linked (test output or `evidence/` path).
2. Every applicable gate facet for the artifact's declared completion scope has current passing evidence. Design/static facets can be evaluated while runtime facets remain NOT RUN. All own acceptance clauses and completion dependencies still apply; final certification requires all applicable facets of all 13 gates to pass on the frozen deployed environment.
3. Reviewed by at least two other roles; every material technical claim is labelled Verified, Partially verified, Unsupported, Incorrect or Outdated; any conflict is resolved in DECISIONS.md by the evidence hierarchy, never by majority vote.
4. Merged into the single `contoso-corr-poc/` repository; no competing version of the same artifact remains.
5. Contoso names only; `service.name` equals the cloud role name and the §3 identifier.
6. No placeholders except `VERIFY:` entries and Key Vault references.
7. The §5 non-negotiables hold for the artifact.

## Scope notes

- **In scope:** build phases A to I and the J01 sign-off package (Prompt §7), plus Contoso Eval A/B as optional, isolated lanes ranked last.
- **Deferred, recorded in CRT-03:** F06 (the POC is a new build; any existing Contoso cache needs its own migration plan), J03 to J06, J09 and J10. OBS-07 drafts the J02 production sampling profile for Demo 15 but doesn't roll it out.
- **Naming conflict between sources:** the reference pattern uses `x-business-correlation-id` / `business.correlation_id`; the Prompt fixes `x-business-invocation-id` / `business.invocation_id`. GOV-01 logs the conflict and GATE-11 blocks the wrong names.
- **Unpinned values:** anything marked `VERIFY:` is deliberately not pinned. GATE-06 holds each one with its official source and a fail-closed test.
