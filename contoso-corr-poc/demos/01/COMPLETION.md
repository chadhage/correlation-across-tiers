# Synchronous Golden Path: completion assessment and atomic backlog

## Scenario score: **75/100**

**As of 17 November 2026, 08:50 EST.** This is a rubric-based assessment of
Demo 01's completeness, accuracy and boundary coverage—not a percentage of code
complete, a certification result, or a score for all fifteen demos.

| Dimension | Score | Basis |
|---|---:|---|
| Completeness | 67/100 | Executable local browser/two-JVM rehearsal, deployment guards and reuse guides exist; Azure acceptance, integrated real-store execution, native v1 adapter and safe worker-free reset remain open. |
| Accuracy | 92/100 | Local/cloud scopes and limits are clearly separated; current verification is recorded below. Azure behavior, fresh-checkout reproducibility and an immutable commit snapshot are not established. |
| Coverage | 66/100 | Six of eight synchronous boundaries were exercised locally. The two Gateway boundaries, native Azure evidence, full recovery and owner acceptance remain unverified. |

The overall score is the equal-weighted mean of these dimensions, rounded to the
nearest whole number. It reflects useful, mostly precise implementation and
documentation, discounted for the uncompleted Azure/native acceptance path.
**Azure status remains NOT CERTIFIED.**

Assessment refreshed **17 November 2026**. Scope: **Demo 01**, not certification
of all fifteen scenarios. [Run/reuse guide](GETTING_STARTED.md).

**Completion boundary:** the later combined Java profile and integrated local
rehearsal passed on 17 November 2026 after the earlier concurrent-edit failures.
The checkout remains modified/uncommitted; these results are not tied to a clean
commit or an immutable full-source snapshot. Azure acceptance remains open.

## Verdict

The core implementation is substantial, but the original scenario was **not a
complete executable handoff**: its native adapter explicitly reports BLOCKED,
and its documented local two-JVM launcher did not exist.

This change supplies that launcher and a verified local browser-to-two-JVM
rehearsal, deployment/packaging guards, a reusable order client, a Java debugger
configuration and a step-by-step reuse guide. **Azure execution, native
acceptance and durable reset remain incomplete.**

Intentional parallel work was subsequently included in the assessment: an opt-in Azure
operator module, a durable inventory/cache run store, an observation-only
client/runner, bounded JSON decoding and explicit controller authentication.
These are real implementation candidates, not absent code. They do not yet
provide an enrolled v1 acceptance adapter or complete native reset proof.

There is no defensible single code-completion percentage without defining and
weighting the remaining acceptance work. Measurable facts are more useful:

- **8 required boundary types** in the unchanged root synchronous contract.
- **6/8 exercised locally**, with actual browser/JVM exports and strict joins;
  the two Gateway types are explicitly absent. This is **75% of boundary
  types in a local rehearsal**, not 75% of implementation/acceptance.
- **0 accepted complete Azure Demo-01 executions** established by this work.
- The native adapter remains non-runnable; the independent Azure query registry
  remains unenrolled. No canonical board card or historical receipt was closed/
  rewritten to manufacture completion.

## Evidence-grounded component assessment

| Component | Existing implementation / gap | Current result |
|---|---|---|
| Scenario/routing | [Catalog](../catalog.json), Storefront ordinary order POST, [browser driver](../../tools/verification/adapters/demo01-browser.mjs) | Real Demo-01 button exercised locally; deployed UI unrun |
| Orders | [Controller/filter](../../services/orders-api/src/main/java/com/contoso/orders/OrdersApplication.java), bounded [Inventory client](../../services/orders-api/src/main/java/com/contoso/orders/InventoryHttpClient.java), durable workflow/outbox | Production handlers run in the local fixture; Azure MI/JWT/data configuration unproved |
| Inventory/data | [API](../../services/inventory-api/src/main/java/com/contoso/inventory/InventoryApplication.java), [adapter](../../services/inventory-data/src/main/java/com/contoso/inventory/data/PgRedisInventoryDataAdapter.java), migrations and narrow grants | Real application/client code with H2/RESP; real local/Azure stores remain separate work |
| Gateway | [APIM modules/policies](../../apim/README.md) and exact eight-hop map | Source exists; no live Gateway request/backend/Orders wire join established |
| Authentication/privacy | Dual-token validators, HMAC, Key Vault references and original-payload scanner | Synthetic signed local identities and scoped original-byte scanning exercised; no live Entra/KV/global privacy claim |
| Local execution | Missing `Start-LocalPair.ps1` referenced by the Portal guide | Implemented; two successful complete rehearsals, including ephemeral JDWP enablement |
| Native adapter | [Construction inspector](../../tools/verification/adapters/demo01-runtime.mjs) lists five missing interfaces | Still BLOCKED; the local launcher deliberately does not pretend to implement it |
| Sampling/control | Finite Java leases and reusable controller/management hooks | Local finite configuration/stop exercised; actual Azure inventory, native acknowledgements, watchdog and restoration unproved |
| Deployment | Coherent staged [Bicep root](../../infra/main.bicep), existing Java/Node package builders | New no-cloud plan and guarded publish/provision entrypoints; real Azure deployment unrun and dependency-gated |
| Backend usability | [KQL](../../kql/README.md), workbook and graph checker | Local structural graph passes; live KQL/App Map/Transaction Diagnostics unrun |
| Recovery | Inventory fixture retains its private live baseline; the parallel operator now persists inventory/cache checkpoints | New-store-instance H2 recovery is implemented; approved full-scenario Azure/v1 recovery remains missing |
| Documentation | Short demo wrapper/readme and distributed owner handoffs | Full lane-specific [getting-started/reuse guide](GETTING_STARTED.md) and atomic work below |

### What the new artifacts are, and are not

- [Local launcher](../../tools/java/Start-LocalPair.ps1) and
  [controller](../../tools/java/local-pair.mjs): a bounded **LOCAL REHEARSAL**,
  not `contoso.demo-adapter.v1`. The production authentication factories remain
  unchanged; the synthetic seam/observer is test source only.
- [Deploy-Azure.ps1](Deploy-Azure.ps1): compiles the existing root and renders
  exact validated inputs. Plan makes zero Azure calls. WhatIf requires explicit
  read approval. Provision also requires a reviewed digest, matching write
  reference, a successful dependency gate and confirmation.
- [Select-AzureTarget.ps1](Select-AzureTarget.ps1): lists enabled subscriptions
  from the user's Azure CLI authentication, prompts for a target with reported
  App Service SKU quota and recommends the lowest USD PAYG retail-price
  supported, quota/region-eligible Premium v3/v4 SKU. New root inputs bind the
  confirmed `computeSku` and subscription-derived names. Discovery requires
  approved reads and public pricing access; saved-input Plan remains offline.
  Deployment rechecks exact-SKU quota before ARM validation/WhatIf without
  silently retargeting a reviewed plan. Selection grants no deployment authority.
- [Publish-App.ps1](Publish-App.ps1): rejects wrong hash/role/layout, missing
  production dependencies and wrong Java member hashes before deployment.
  Execute retains the existing dependency gate and requires real readiness.
- [order-client.mjs](order-client.mjs): ordinary API smoke, with bounded JSON
  and correct mutation-versus-workflow identity. It is not a browser, a tracing
  SDK, a reset implementation or graph acceptance.
- [Optional Compose data lane](compose.data.yml): disposable loopback test
  stores, **not executed here** because Docker was absent. It does not change
  the H2/RESP application fixture.
- [Parallel Azure operator](../../examples/azure-operator/pom.xml) and
  [example runner](../../tools/verification/azure-examples.mjs): concrete
  observation/control/recovery candidates, opt-in and NOT CERTIFIED. The
  explicit `--azure-examples` dispatch does not implement the v1 native adapter.

### Integration findings from the parallel work

The operator/client adds genuine useful construction:

- A committed baseline before mutation, persisted owned-run allocation, an
  independent store-instance recovery checkpoint and unowned inventory/cache
  witnesses.
- Exact workload controller JWT validation and optional, explicit backend
  operator principal configuration; default callers are unchanged.
- Original dynamic-column duplicate-key rejection and bounded query-response
  parsing before graph-intake scanning.
- A separate observation result/manifest, with `formalAcceptance:false`,
  no enrolled observer and no independent full emission ledger.

`OperatorConfig` now accepts the root's service-level all-APIs APIM diagnostic
and rejects an API-scoped override in a local regression. Demo 01 now reads
back its durable order identity after staging without waiting for async
`COMPLETED`. The candidate's `assertObservedHttpPath` checks the browser,
Gateway, Orders, Inventory and both data direct-parent relationships; it is
not the v1 invariant/acceptance pipeline.

Still open: the operator is not deployed/wired by the root; browser
authentication/native sampling is unqualified; and reset still refuses pending
or leased outbox work. The execution fix does not provide safe worker-free
reset or full v1 acceptance. See
[the candidate usage and exact limitations](GETTING_STARTED.md#h-integrated-parallel-azure-operator-example-candidate-not-acceptance).

## Exact validation performed

### Azure target discovery (partial GP20)

On 17 November 2026, read-only Azure CLI discovery found the requested
subscription `474c40eb-d385-40d8-baa2-06883dbdca2d` enabled and listed
`centralus` for that subscription. A Microsoft.Web regional usage query
reported **P1v3: 0 used / 0 limit**; the root's
[compute module](../../infra/modules/compute.bicep) at that epoch specified one
P1v3 instance. The Linux P1v3 region list includes Central US, but this does not
establish capacity or override the quota. Treat this as a deployment blocker
until the owner obtains quota
or approves and validates a different design. This single quota result does
not qualify the other resource types, availability, policy, budget or target
authorization; GP20 and the subsequent Azure gates remain open.

The Azure MCP subscription inventory used a different authentication context
and did not list this subscription; the explicitly scoped Azure CLI queries
did. No default subscription was changed and no resources were modified.

#### Candidate SKU redesign (not approved or implemented)

The same regional usage query reported B1 **2 used / 14 limit**. Azure CLI's
Linux B1 location list included Central US. Microsoft's
[VNet integration guidance](https://learn.microsoft.com/en-us/azure/app-service/overview-vnet-integration)
includes Basic, and its [Linux pricing table](https://azure.microsoft.com/en-us/pricing/details/app-service/linux/)
lists B1 at **1 vCPU / 1.75 GB**, versus P1v3 at **2 vCPU / 8 GB**.
These are regional/SKU observations, not proof of capacity, effective policy,
deployment eligibility or performance.

Proposed investigation: split the six existing apps across two new,
independently named Linux B1 plans: Orders and Inventory on the first; Portal
and the three worker hosts on the second. Preserve the existing ingress,
managed-identity and VNet settings. The existing compute subnet is `/24`;
the VNet guidance requires at least `/26` for multi-plan subnet join. Verify
that feature, remaining applicable quotas and actual networking for both
plans rather than assuming subnet size alone is sufficient. The separate
operator/watchdog hosts are not included in this two-plan estimate.

The configured API heap maxima total 768 MiB; Portal and three worker heap
maxima total 1,024 MiB. These are limits, not measured memory usage or
reservations: agents, Functions hosts, native memory and the OS need additional
headroom on each 1.75 GB instance. Run approved readiness and the full
10 requests/second, 120-second latency, error, CPU, memory and overhead
qualification before treating B1 as suitable. Obtain owner approval for the
two-plan names, cost, topology and reviewed new plan digest. If either plan
fails qualification, pursue appropriate quota or a separately approved
architecture; do not lower acceptance thresholds. No IaC change or Azure
write has been made for this candidate.

On 17 November 2026 the user chose to retain P1v3 and pursue a quota increase;
the B1 redesign remains unimplemented. A quota request, its approved limit,
effective-quota read-back and the remaining Azure approvals are still needed.
That selected P1v3 target requires at least one plan instance; account for the
separately planned operator host when deciding the requested limit. The owner
can use the Azure portal's support request flow for **Web App (Windows and
Linux)** quotas, specifying the subscription, Central US and P1v3. No quota
request has been submitted by this work.

### Controller-death cleanup observation

On 17 November 2026 an independent PowerShell observer started the local Node
controller with a 180-second lease, confirmed its two recorded JVM PIDs were
running Java processes, then forcibly stopped only the controller PID. Both
recorded JVM PIDs became absent within the 80-second observation window.
The run directory is
`.cache\golden-path\controller-death-96da48838d5b47d690a4c16709f93929`.
The checkout was modified and the launcher used the existing test classpath.
This proves only the observed local child cleanup after controller death;
it does not prove native expiry, successful telemetry flush, in-flight traffic
draining or a clean-checkout run. **GP13 remains OPEN.**

### Quota-aware target and SKU validation (latest deployment-script epoch)

The selector now checks per-SKU regional instance quota and Linux location
listings, retries subscription selection when no eligible choice remains, and
ranks supported candidates using current primary USD hourly PAYG Linux retail
meters. It preserves the single-plan, six-app topology and at least 2 vCPUs /
8 GB; this is the existing capacity floor, not a measured minimum or the
globally cheapest architecture. Noninteractive selection requires explicit
subscription and SKU. Legacy root inputs still default to P1v3. This does not
supersede the historical P1v3 quota result or approve the B1 redesign above.

On the modified/uncommitted checkout, the following command passed:

```powershell
$env:CONTOSO_BICEP_PATH = (Resolve-Path .\.cache\r6-tools\bicep.exe).Path
node --test --test-reporter=spec `
  .\tests\root-composition.test.mjs `
  .\tests\golden-path-deployment.test.mjs `
  .\tests\names.test.mjs `
  .\tests\golden-path.test.mjs
```

**41/41 passed, zero skips.** Azure CLI and retail-price requests were mocked
in these tests; the real locked Bicep compiler ran. Coverage includes exhausted
quota retry, missing quota, unavailable Linux regions, explicit noninteractive
selection, malformed responses, incompatible existing plans, unchanged
one-instance plan reuse, paginated/current Linux PAYG price filtering,
missing/conflicting price rejection, exact compiled SKU allowlists and binding,
quota failure before ARM validation, target-bound digests, offline planning and
the existing local/API safety regressions.

A separate real public-price parser smoke check returned P1v3 at **USD
0.17/hour (124.10 per 730-hour month)** and P1v4 at **USD 0.18/hour (131.40)**.
These are transient compute-only public prices, not hardcoded rates, total
root costs or a target-qualified recommendation: that parser check supplied
synthetic eligible capacity and made no authenticated Azure calls.

No Azure resource, quota request or approval was created. Per-SKU usage and a
Linux listing do not reserve physical capacity, qualify other/aggregate quotas,
prove effective policy/RBAC or close GP20 for the complete root. Missing prices
fail explicitly rather than choosing an unpriced fallback. The existing
**75/100** score and **NOT CERTIFIED** status remain unchanged.

### Dynamic target selection validation (historical, before quota-aware selection)

The authenticated picker, reusable root target, target-bound v2 plan digest
and explicit-input publisher passed this focused command on 17 November 2026:

```powershell
$env:CONTOSO_BICEP_PATH = (Resolve-Path .\.cache\r6-tools\bicep.exe).Path
node --test --test-reporter=spec `
  .\tests\root-composition.test.mjs `
  .\tests\golden-path-deployment.test.mjs `
  .\tests\names.test.mjs
```

**27/27 passed, zero skips.** Azure CLI discovery and WhatIf were mocked;
the real locked Bicep compiler ran. Tests cover interactive and explicit
subscription selection, disabled/inaccessible targets, invalid/cancelled
choices, missing read approval, failed login discovery, tenant mismatch,
subscription-derived names, target-bound digest and offline publishing
inspection. No real subscription was listed, selected or deployed here.
The existing scenario score and NOT CERTIFIED status are unchanged.

Commands below ran from `contoso-corr-poc`. Local tools: Node 22.23.5,
PowerShell 7 and the existing checksum-locked JDK/Maven/agent/sampler/Bicep.
No Azure provisioning, application traffic, directory/grant/secret operation
or real PostgreSQL/Redis connection was performed.

### Latest combined checkout validation

On 17 November 2026, after the historical failures below, the following passed
on the modified/uncommitted checkout:

```powershell
. .\tools\java\Use-Portable.ps1
mvn -q -B -ntp -Pazure-examples verify

$env:CONTOSO_BICEP_PATH = (Resolve-Path .\.cache\r6-tools\bicep.exe).Path
node --test --test-reporter=spec `
  .\tests\golden-path.test.mjs `
  .\tests\golden-path-deployment.test.mjs `
  .\tests\verification\azure-examples.test.mjs `
  .\tests\verification\demo01-runtime.test.mjs `
  .\tests\observability\local-trace-tree.test.mjs `
  .\web\portal-ssr\tests\local-rehearsal.test.mjs
```

The Java profile passed after Maven resolved a missing declared Azure Functions
plugin; the Node selection passed **91/91**, including the Bicep plan test.
The Java operator tests cover service diagnostic acceptance/API override
rejection and the pending-outbox reset fence. The Node tests cover queued
durable read-back, `202` enforcement, and wrong original business identity.
These are local and fixture results, not Azure acceptance or proof that
environment-gated native tests all ran.

The integrated local command was rerun after these changes with output
directory `.cache\golden-path\review-20261117-0849`: **19 selected Java tests**
passed with zero failures/errors/skips; the browser produced a 12-span local
tree covering the six local boundaries. The two missing Gateway hops failed
the full-chain check as required. The run is not a clean-commit or Azure
execution.

### Java build and real application/browser execution

```powershell
.\tools\java\Start-LocalPair.ps1 `
  -ToolsRoot (Join-Path $PWD '.tools\java') `
  -OutputDirectory '.cache\golden-path\local-validation-03' `
  -RunBrowser -DurationSeconds 300

.\tools\java\Start-LocalPair.ps1 `
  -ToolsRoot (Join-Path $PWD '.tools\java') `
  -OutputDirectory '.cache\golden-path\local-validation-04-debug' `
  -RunBrowser -DebugJava -DurationSeconds 300
```

**Both passed.** Each selected build ran **19 Java tests**, zero failures/errors/
skips, across the eight selected reactor modules. This was not an all-module,
all-native-test qualification.

The repeated debug-enabled execution observed:

- Actual Chromium `156.0.8078.4` and browser SDK `3.4.5`.
- One trace/tree with **12 actual spans**, covering all six local required
  boundary types; extra connected application spans were not discarded.
- Exactly **9/9 seeded checker controls** rejected the mutated graph as
  expected. These were checker mutations, not runtime fault injection.
- Scoped scanner accepted **7 original payloads / 45 native envelopes** before
  persisting their safe projections. This is not an exporter-loss denominator.
- Browser excluded-origin Fetch/XHR and CORS controls passed.
- Original ingress preserved the observed browser carrier and joined the real
  Orders export; browser input hashes were unchanged before/after.
- Actual ephemeral Orders/Inventory JDWP ports were recorded. No interactive
  debugger attach is claimed.
- Both owned JVM PIDs were independently confirmed absent after shutdown;
  the manifest reports STOPPED/`ready:false`.
- The unchanged full-chain check **failed as required** with `C_MISSING_HOP`
  for `gateway.request` and `gateway.backend`.

The generated detailed receipts remain in those local ignored directories.
They are not shipped source, an independently approved native capability or
portable certification evidence.

### Focused Node/browser/deployment regressions

```powershell
$env:CONTOSO_BICEP_PATH = (Resolve-Path .\.cache\r6-tools\bicep.exe).Path
node --test --test-reporter=spec `
  .\tests\golden-path.test.mjs `
  .\tests\golden-path-deployment.test.mjs `
  .\tests\observability\local-trace-tree.test.mjs `
  .\tests\verification\demo01-runtime.test.mjs `
  .\web\portal-ssr\tests\local-rehearsal.test.mjs
```

**79/79 passed**, zero failures/skips/cancellations. The plan test compiled the
actual Bicep root and exercised the no-cloud/reviewed-digest guard with `az`
replaced by a function that throws if called. Publisher tests rejected changed,
incomplete and wrong-role packages. Original Demo-01 source-binding/closed-
adapter tests still passed.

PowerShell parsing passed for all three new/updated PowerShell entrypoints,
and the VS Code launch template parsed as JSON. This establishes syntax, not
execution of the Azure write paths.

### Additional scoped checks and historical joint validation

The existing API/native/production-guard selection also passed:

```powershell
mvn -q -o -B -ntp -pl services\inventory-api,services\orders-api -am test `
  '-Dtest=NativeApiIntegrationTest,ProductionLaunchGuardTest,NativeTrustRootObservationFilterTest,InventoryAuthenticationTest,LocalPairIngressFilterTest' `
  '-Dsurefire.failIfNoSpecifiedTests=false'
```

**12/12 passed**, zero failures/errors/skips; this overlaps three ingress tests
from the 19-test rehearsal selection and is not a unique-total count.
The real local API test wrote a separately scoped
[safe native receipt](../../evidence/java-local/native-api/20261117T042939764Z-505dbd05-563a-4ed8-a4e8-7da8719b1bbb/receipts.json).
It remains H2/RESP/local identity evidence, not Azure acceptance.

Both current Java ZIPs were built with `Package-Service.ps1` and accepted by
`Publish-App.ps1` in its default no-cloud mode: **zero Azure calls, not
deployed**. Archive inspection confirmed test-only local authentication/
observer classes were excluded from the production Orders JAR.
The optional Compose file parsed as YAML, but Docker execution was not run.
The new scenario scripts/configuration/literature passed the existing targeted
secret-text scanner. Local documentation link targets resolved.

The focused Node command above was then extended with
`tests\verification\azure-examples.test.mjs`: **85/85 passed**, zero skips/
failures/cancellations. Example discovery listed all fifteen source examples
without Azure calls. These do not imply a clean integrated Java build.

Two earlier broader checks failed while the other writer was still active:

| Exact command | Observed result |
|---|---|
| `mvn -q -o -B -ntp -Pazure-examples verify` | **FAILED** in `AsyncNativeAgentTest`, baseline child exit 1. The changed DLQ topic route conflicts with the existing Orders-queue native primitive; reconcile its fixture/coverage without reverting the intended two-subscription route. |
| `mvn -q -o -B -ntp -pl :messaging-core -am test '-Dtest=AsyncNativeAgentTest,DemoWorkflowRoutingTest' '-Dsurefire.failIfNoSpecifiedTests=false'` | **FAILED TO COMPILE** in the concurrently edited `RequestAuthenticatorTest` (line 29 at that time); the selected native tests did not execute. |

A before/after hash check also observed three shared sources change during
that earlier validation. The later Java profile passed as recorded above; the
earlier failures remain historical evidence, not current failure claims.
Whitespace checking passed with `git -c core.whitespace=cr-at-eol diff --check`,
respecting this repository's literal LF/CRLF byte-preservation policy.

### Failures retained, not relabelled

- Initial offline Maven resolution failed on missing cached plugins. The
  declared Maven dependencies were then restored with the existing toolchain;
  subsequent offline builds passed. No dependency manifest/version was changed.
- The first integrated attempt failed because the test ingress filter missed
  the asynchronous servlet body dispatch. The filter and a regression were
  fixed.
- The second failed because Java's actual nanosecond-precision ISO timestamp
  was rejected by an overly narrow millisecond-only persistence guard.
  The guard now accepts bounded canonical ISO-Z precision and rejects invalid
  calendars/offsets.
- Both failed attempts stopped their owned helpers and remain separately
  labelled under `local-validation-01` / `02`. Their results were not rewritten.

## Plan to raise completeness to 100/100

The target is to earn the points through evidence, not to raise the number by
changing its interpretation. Completeness remains **67/100 until each exit
criterion is accepted**. The scorer must use the same rubric at every
checkpoint and retain the source commit, command output, owners, dates and
evidence links for each decision.

### Completeness scoring gates

| Gate | Available points | Evidence required for full credit |
|---|---:|---|
| Reproducible handoff and local/data lanes | 15 | Clean-checkout Windows run, controlled stop/recovery, real PostgreSQL and Redis, and all applicable local tests pass |
| Build and platform delivery | 15 | Reviewed packages, approved Azure plan, healthy deployed tiers, exact identities and least-privilege bootstrap |
| Native adapter and lifecycle | 25 | Enrolled v1 adapter, independent ledger/query path, controlled sampling, durable prepare/reset/restore, and process-death recovery |
| End-to-end acceptance evidence | 30 | Two complete fresh-source Azure runs prove all eight boundary types, privacy, sampling controls, business lookup and emission reconciliation |
| Operational qualification and closure | 15 | Performance, failure/rollback, security, retention, backend usability and accountable owner signoffs |

All 100 points are required. No category may use partial credit to offset a
failed mandatory property. Missing Gateway evidence, a blocked native adapter,
unsafe reset, an unaccepted clean epoch, only one Azure rehearsal, an
unresolved waiver or missing owner approval is a blocking failure regardless
of the arithmetic.

### Phase plan and exit criteria

| Phase | Tasks and accountable work | Exit evidence | Target score after acceptance |
|---|---|---|---:|
| 1. Make the handoff reproducible | Close GP11-GP18: run a clean Windows checkout, exercise watchdog/process-death cleanup, qualify the Compose or approved-store lane, and execute the browser through the two-JVM fixture with real PostgreSQL/Redis | Fresh runner manifest; immutable commit; 19-test Java selection plus focused Node suite; positive and negative store-grant evidence; six local boundary types including both real-store CLIENT operations; no owned processes/resources left behind | 72 |
| 2. Complete build and operator code gates | Close GP19, GP27, GP30, GP36-GP37 and GP41-GP50, including GP72-GP73; resolve the exporter decision; finish v1 prepare, sampling, ledger, drain, reset, recovery and invariant integration | Build/package/SBOM or equivalent provenance; adapter conformance and fault-injection tests; direct-parent checks executed by the v1 invariant process; pending/outbox-safe reset test; genuinely new-process recovery; reviewed code with no test-only seam in production | 82 |
| 3. Provision and deploy the approved target | Close GP20-GP26, GP28-GP29, GP31-GP35, GP38-GP40, GP45 and GP69-GP70, using the Phase 2 prerequisites: approve names, quota, policy, cost and digest; bootstrap identities, secrets, SQL and Redis; publish and verify Storefront, Gateway, Orders, Inventory and the operator | Reviewed Bicep what-if and deployment receipt; exact resource/identity/package map; readiness checks; positive and negative RBAC/authentication probes; private-store connectivity; all secrets referenced rather than persisted | 88 |
| 4. Prove the native synchronous path | Close GP51-GP63 and GP71, GP74-GP76: bind the deployed epoch; run sampled and strict-unsampled controls; prove the two Gateway hops and all eight direct-parent boundaries; reconcile independent emissions/queries and privacy scans; measure the approved load profile | One accepted Azure run with raw manifests, carriers, parent/trace IDs, business IDs, KQL/export/query pagination, actual privacy negatives and performance/overhead results; zero missing declared spans or unexplained duplicates/orphans | 94 |
| 5. Prove repeatability and obtain closure | Close GP64-GP68 and GP77: interrupt/fail/recover, repeat from a fresh run-owned baseline, exercise rollback, and obtain all accountable signoffs | Second accepted Azure run from the same documented clean checkout path; restoration and rollback read-backs; scoped acceptance report; Architecture/Application/Platform/SRE/Security-Privacy/Data approval; canonical owner process updated | 95 |
| 6. Close the final audit gate | Independently replay the declared getting-started path on a clean machine, reconcile every GP01-GP77 exit and every score-gate point to immutable evidence, resolve all defects and waivers, and verify the published status links to that evidence | Independent clean-machine replay passes without undocumented intervention; full backlog/evidence traceability; zero open scenario defects or waivers; immutable final source and package digests; approved final assessment and canonical receipt | 100 |

The target checkpoints are ceilings, not automatic awards: an accepted phase
contributes only the points whose evidence passes review. A phase may be
partially credited, but no dependent phase can be called accepted on fixture,
source-review or configuration evidence alone.

### CD3 force ranking

The table ranks the six plan phases as **portfolio-sized bundles**, not
individual GP cards. CD3 uses the existing
[backlog method](../../../.docs/wiki/Contoso_E2E_Correlation_POC_Backlog.md#cd3-scoring):
**(value + time criticality + risk reduction/enablement) / duration**.
V, T and R use its relative 1, 3, 5, 8, 13, 20 scale; R reflects the higher
of risk retired or work enabled. Duration is a rough sum of ideal
role-days for the remaining work, including verification but excluding
approval and queue wait. It is not elapsed time, a commitment or a financial
estimate. Inputs are provisional planning judgments, not measured costs;
owners should re-estimate them before scheduling and after major discoveries.

| CD3 rank | Phase | V | T | R | CoD | Ideal role-days | CD3 | Rationale |
|---:|---|---:|---:|---:|---:|---:|---:|---|
| 1 | 3. Approved target and deployment | 20 | 20 | 20 | 60 | 8 | 7.50 | Unblocks deployed identity, infrastructure, operator and native evidence; external approvals may have long lead times. |
| 2 | 1. Reproducible handoff | 13 | 13 | 13 | 39 | 6 | 6.50 | Quickly reduces fresh-checkout, lifecycle and real-store integration uncertainty. |
| 3 | 2. Build and operator code | 20 | 20 | 20 | 60 | 12 | 5.00 | Makes the native adapter, safe reset and independently observed acceptance possible. |
| 4 | 4. Native synchronous proof | 20 | 8 | 20 | 48 | 10 | 4.80 | Retires the core eight-boundary, sampling, privacy and loss risks. |
| 5 | 5. Repeatability and closure | 20 | 5 | 13 | 38 | 10 | 3.80 | Establishes recovery, rollback, repeatability and accountable approval. |
| 6 | 6. Final audit | 13 | 3 | 13 | 29 | 8 | 3.63 | Independently verifies reproducibility and evidence before the 100-point claim. |

This is a **raw CD3 priority ranking**, not a dependency-ordered board or a
replacement for the backlog's Kano and prerequisite rules. These bundles
contain multiple owners and cards larger in aggregate than the board's
two-day atomic limit. Apply the board's rules to the individual ready GP
cards when scheduling; do not compare these bundle scores directly with the
canonical card scores or add their CoD values as financial savings.

In particular, Phase 3 cannot finish before Phase 2's GP19, GP27, GP30,
GP36 and GP37. Conversely, Phase 2's GP43-GP50 require Phase 3's deployed
operator, application or query executor. Start eligible work in both lanes in
parallel; neither whole phase is a prerequisite for starting the other. The
GP dependency column governs qualification and completion. Phase 4 requires
the deployed target and runnable adapter; Phase 5 follows the accepted first
run; Phase 6 follows closure. The numerical phase score checkpoints above are
judgmental forecasts, not outputs of CD3.

**Start now:** prioritize the independent GP19 exporter decision, GP20
target/quota discovery, GP27 secret bootstrap and GP30 SQL entrypoint; in
parallel start eligible local GP11-GP14. Advance GP21-GP24 after their listed
prerequisites and approvals. Do not start cloud writes or incur costs without
the required approval and reviewed plan. Re-rank ready work if owner estimates
or dependencies change.

### Execution sequence and parallel lanes

1. **Application lane:** complete the v1 adapter, real-store fixture, lifecycle
   controls and package provenance.
2. **Platform lane:** in parallel, approve the Azure target and perform
   foundation, identity, secret, data, deployment and operator bootstrap.
3. **Acceptance lane:** only after both lanes meet their gates, run the native
   sampled/unsampled/negative controls and reconcile the independent ledger
   with raw backend queries.
4. **Recovery lane:** repeat on a new process and rerun from a fresh source
   epoch; validate rollback without replacing the failed receipt.
5. **Closure lane:** rescore the completed rubric, publish the evidence index
   and obtain owner signoffs before updating any canonical status.
6. **Final audit lane:** an independent operator replays the documented path
   from an untouched checkout, confirms all evidence is tied to the same
   approved source/resource epoch, and verifies that no defect, exception or
   manual-only step remains.

The first blocked gate stops the acceptance claim. Do not work around it by
substituting H2 for Azure stores, constructing missing spans, waiting for
`COMPLETED` after a synchronous `202`, bypassing the reset fence, or rewriting
historical evidence. Any change to the workload, instrumentation, infrastructure
or acceptance rules begins a new source epoch and invalidates dependent
receipts.

## Definition of 100% done

Demo 01 is done only when **all** of the following hold for a fresh approved
target/source epoch:

1. A new developer can reproduce the documented local application and
   real-store lanes; fixture/native scopes are unmistakable.
2. The actual Azure environment can be provisioned and packages published from
   reviewed inputs, with complete identity/secret/SQL/network bootstrap and
   healthy deployed runtimes.
3. The reviewed runnable adapter drives the real browser and all eight actual
   boundary types; independent source/canary/emission/query/privacy facts are
   accepted through the existing verifier.
4. Sampled-positive and strict-unsampled controls, direct parent edges, unique
   span IDs, durable lookup, safe logging and privacy all satisfy the declared
   clauses. A percentage setting or missing export alone cannot pass.
5. Every owned side effect and sampling/control setting is restored, including
   process-crash/new-process recovery. A second fresh run also passes.
6. Approved load/loss/overhead evidence, backend usability, required accountable
   signoffs and current-source receipts are recorded without waiving shared
   gates. This does not certify unrelated asynchronous scenarios.

## Atomic task backlog

**LOCAL** = delivered and locally checked in this change, not canonical board
Done. **OPEN** = implementation/qualification remains.
**EXTERNAL** = actual target/input/approval/native operation is needed.
Dependencies are real prerequisites, not an implied order within a table.
The existing 78-card board and immutable historical evidence are unchanged.

### A. Reusable developer handoff

| ID | Status | Atomic activity and measurable exit | Depends on |
|---|---|---|---|
| GP01 | LOCAL | Bind the scope to the unchanged eight-boundary Demo-01 contract; distinguish staging from fulfillment | - |
| GP02 | LOCAL | Implement the missing launcher using the existing real two-API fixture; both actual readiness endpoints must return 200 | GP01 |
| GP03 | LOCAL | Capture an allowlisted Orders ingress record across async dispatch; one record must join the actual exported Orders span | GP02 |
| GP04 | LOCAL | Drive the actual Demo-01 UI button; the SDK dependency must equal the sent carrier | GP02, GP03 |
| GP05 | LOCAL | Seal the shared original-byte scanner after JVM flush; unsafe originals must fail before persistence | GP02 |
| GP06 | LOCAL | Merge the six local boundary types with the existing checker and reject all nine seeded mutations | GP04, GP05 |
| GP07 | LOCAL | Supply ephemeral loopback JDWP listeners and attach configurations without changing production launchers | GP02 |
| GP08 | LOCAL | Supply/test an API client that validates current-action and durable-workflow identity separately | GP01 |
| GP09 | LOCAL | Supply/test local deployment planning and reject unreviewed plans/packages before cloud operations | GP01 |
| GP10 | LOCAL | Publish explicit local/Azure/test/debug/reuse instructions and acceptance limitations | GP01-GP09 |
| GP11 | OPEN | Exercise cold-checkout restore on an independent Windows machine/CI runner with no pre-existing build outputs | GP02, GP04 |
| GP12 | OPEN | Execute the local expiry watchdog with in-flight traffic; verify admission stop, flush and owned PID cleanup | GP02, GP05 |
| GP13 | OPEN | Kill the owning controller in a bounded test; independently verify stdin-EOF/native-expiry child cleanup | GP02 |
| GP14 | OPEN | Validate Compose syntax/resolved image digests on Docker with Linux containers | - |
| GP15 | EXTERNAL | Execute the real PostgreSQL lane; verify actual server identity, positive/negative grants and exact owned cleanup | GP14 or approved existing PG18 |
| GP16 | EXTERNAL | Execute the real Redis lane; verify actual server identity, TTL/restore behavior and exact owned cleanup | GP14 or approved existing Redis7+ |
| GP17 | OPEN | Add an opt-in two-JVM real-PG/Redis fixture through the existing injection seams; no production auth downgrade | GP15, GP16 |
| GP18 | EXTERNAL | Run the browser-to-two-JVM real-store fixture and verify both actual data CLIENT boundary types | GP17, GP04 |

### B. Platform and application delivery

| ID | Status | Atomic activity and measurable exit | Depends on |
|---|---|---|---|
| GP19 | OPEN | Resolve the Node beta-exporter GA/support policy decision using official evidence or an approved replacement; do not relabel it GA | - |
| GP20 | EXTERNAL | Refresh approved region/SKU availability and quota for the complete root inventory | - |
| GP21 | EXTERNAL | Review effective Azure policy and the complete fixed/variable cost estimate; record provisioning approval | GP20 |
| GP22 | EXTERNAL | Verify/reserve the approved physical names and establish the exact owned resource group | GP21 |
| GP23 | EXTERNAL | Review the actual foundation what-if and provision the foundation from the reviewed digest | GP19, GP22 |
| GP24 | EXTERNAL | Capture actual ARM hostnames/compute/Gateway object IDs as non-secret foundation outputs | GP23 |
| GP25 | EXTERNAL | Create/verify the Storefront and API registrations, v2 audiences, scope and actual redirect URI | GP24 |
| GP26 | EXTERNAL | Assign/verify Gateway.Invoke and Inventory.Invoke for the exact actual managed-identity pairs | GP24, GP25 |
| GP27 | OPEN | Ship/review a bounded operator HMAC/App-Insights-secret bootstrap executable using the existing SDK hooks, with no secret persistence | - |
| GP28 | EXTERNAL | Execute approved secret SET/reference selection and independently verify named-secret readers/logger resolution | GP23, GP27 |
| GP29 | EXTERNAL | Review/provision application infrastructure from actual bindings; create PG/Redis before SQL bootstrap, without deploying code early | GP24-GP26, GP28 |
| GP30 | OPEN | Ship/review the SQL operator entrypoint reusing V001/V002 and InventorySchemaHooks, with exact target/identity permits | - |
| GP31 | EXTERNAL | Apply migrations and bind the actual dataset marker, then read back the schema/version/resource identity | GP29, GP30 |
| GP32 | EXTERNAL | Register exact Inventory/Orders SQL object-ID principals and apply the existing role-specific narrow grants | GP26, GP31 |
| GP33 | EXTERNAL | Measure effective SQL positive/negative privileges and absence of runtime administrator/DDL access | GP32 |
| GP34 | EXTERNAL | Verify Managed Redis Entra policy, private DNS, TLS and actual Inventory identity connectivity | GP26, GP29 |
| GP35 | EXTERNAL | Verify both authenticated SCM and main-site runner routes without Basic auth or broad ingress exceptions | GP23, GP29 |
| GP36 | OPEN | Produce current Java source/build/package correspondence and qualify the deployed JDK/agent/single-provider bytes | GP19 |
| GP37 | OPEN | Build a Linux Node24 source-free cohost ZIP with frozen production-only dependencies; standalone smoke must pass | GP19 |
| GP38 | EXTERNAL | Publish Inventory, verify actual readiness and record deployed package/runtime identity | GP28, GP33-GP37 |
| GP39 | EXTERNAL | Publish Orders, verify actual readiness and the independently authenticated Inventory call | GP38 |
| GP40 | EXTERNAL | Publish the cohost and verify actual Storefront sign-in, runtime config and approved-origin CORS | GP25, GP28, GP35, GP37, GP39 |

### C. Complete the native adapter, not an adapter-shaped stub

The exact missing interfaces originate in the
[construction inspector](../../tools/verification/adapters/demo01-runtime.mjs).

| ID | Status | Atomic activity and measurable exit | Depends on |
|---|---|---|---|
| GP41 | OPEN | Adopt/review the candidate persisted baseline for v1 prepare, extending it to the exact order/workflow/cache/flags/sampling state and unowned witnesses | GP30 |
| GP42 | OPEN | Implement the actual participant inventory plus native sampling apply/read-back acknowledgements for browser/APIM/Orders/Inventory | GP36, GP37 |
| GP43 | OPEN | Qualify the candidate independent watchdog and complete native expiry/admission/drain/restore operations; prove initiating-process death recovery | GP42, GP69 |
| GP44 | OPEN | Adopt the browser/operator execution with strict synchronous staging semantics, an independent emission ledger and distinct before/after full-path canaries | GP40, GP41, GP43, GP72 |
| GP45 | EXTERNAL | Enroll the independent authenticated RAW query executor with accepted provenance; no caller JSON or hash-only authority | GP29 |
| GP46 | OPEN | Bind the existing collector to actual execution/ledger/canary/query observations with exhaustive watermark/paging checks | GP44, GP45 |
| GP47 | OPEN | Implement stopTraffic/drain/flush using real producer admissions and observed in-flight completion | GP42-GP44 |
| GP48 | OPEN | Adopt/extend candidate inventory/cache reset to exact owned workflow/outbox/flags read-back; preserve every declared unowned witness | GP41, GP47, GP72 |
| GP49 | OPEN | Bind the candidate authenticated persisted recovery to v1 restoreCapturedRun and qualify a genuinely new process, not only a new H2 store instance | GP48 |
| GP50 | OPEN | Compose/review all adapter operations and current source bindings; only then export createAdapter/schema v1 | GP41-GP49, GP70-GP73 |

### D. Native qualification and operational acceptance

| ID | Status | Atomic activity and measurable exit | Depends on |
|---|---|---|---|
| GP51 | EXTERNAL | Bind actual deployed resources/roles/instances, source/package/loaded bytes and an approved finite native execution window | GP36-GP40, GP50 |
| GP52 | EXTERNAL | Observe browser dependency -> actual APIM request ParentId with the original inbound carrier | GP51 |
| GP53 | EXTERNAL | Observe actual APIM request -> backend dependency -> Orders request ParentIds and strict flags | GP52 |
| GP54 | EXTERNAL | Observe Orders -> HTTP CLIENT -> Inventory ParentIds and exact technical trace continuity | GP53 |
| GP55 | EXTERNAL | Observe actual PG and Redis CLIENT operations parented to Inventory, with no invented database server spans | GP54 |
| GP56 | EXTERNAL | Verify unique IDs for every actual request/dependency and correct active log/error association; retain duplicates as defects | GP52-GP55 |
| GP57 | EXTERNAL | Verify canonical business identity at ingress/data and complete business lookup without conflating action/workflow IDs | GP55 |
| GP58 | EXTERNAL | Run original-column graph and required all-table privacy checks with actual sensitive-input negatives and accountable clearance | GP46, GP51 |
| GP59 | EXTERNAL | Run strict incoming-00 and sampled-positive controls, observing actual SDK sampled/recording state and outgoing carriers | GP51-GP55 |
| GP60 | EXTERNAL | Reconcile the independent emission ledger with exhaustive backend capture and both canaries; missing spans/loss remain defects | GP46, GP56, GP59 |
| GP61 | EXTERNAL | Execute trace/business/orphan KQL procedures and independently classify every unexplained orphan candidate | GP57, GP60 |
| GP62 | EXTERNAL | Capture approved actual Application Map/Transaction Diagnostics views and show required parent edges | GP61 |
| GP63 | EXTERNAL | Measure approved load latency/error/CPU/memory thresholds and instrumentation overhead, rather than copying configured limits | GP51, GP60 |
| GP64 | EXTERNAL | Exercise normal, failed and interrupted run reset/new-process recovery; verify production sampling and all owned/unowned read-backs | GP43, GP48-GP50, GP60 |
| GP65 | EXTERNAL | Repeat a fresh end-to-end Azure run/reset from the documented checkout/deployment inputs with a new run-owned baseline | GP58-GP64 |
| GP66 | EXTERNAL | Verify actual least privilege, retention/purge policy, key rotation, budget/alert route and run evidence access controls | GP28, GP33-GP35 |
| GP67 | EXTERNAL | Obtain Architecture, Application, Platform, SRE, Security/Privacy and Data signoffs for this exact scope/epoch | GP65, GP66, GP74-GP77 |
| GP68 | OPEN | Publish the scoped acceptance report/evidence manifests and update canonical status only through its actual owner process | GP67 |

### E. Integrate and qualify the parallel operator candidate

| ID | Status | Atomic activity and measurable exit | Depends on |
|---|---|---|---|
| GP69 | EXTERNAL | Provision/protect the separately approved operator host and independent watchdog without altering the canonical application roles | GP21-GP24 |
| GP70 | EXTERNAL | Wire the actual isolated operator/controller audiences, exact principal pairs and least-privilege SQL/Redis/Azure permissions; defaults must stay denied | GP26, GP29, GP69 |
| GP71 | LOCAL | Accept the root service-level all-APIs APIM diagnostic and reject API-scoped overrides in a local regression; live scope remains unverified | GP01 |
| GP72 | OPEN | Qualify safe worker-free staging/reset: Demo-01 execution now reads durable identity without waiting for completion, but pending or leased outbox work still blocks reset | GP41 |
| GP73 | OPEN | Integrate the candidate's eight-boundary direct-parent observations with the v1 invariant engine and independent native acceptance evidence | GP46, GP71 |
| GP74 | EXTERNAL | Execute actual APIM caller expiry/audience/scope/client-denial controls, not only assignment read-backs | GP40, GP51 |
| GP75 | EXTERNAL | Execute actual Orders dual-token negatives: missing/spoofed Gateway proof and independently preserved original caller | GP39, GP51 |
| GP76 | EXTERNAL | Execute actual Inventory wrong-principal/role negatives and verify no delegated-user credential forwarding | GP38, GP51 |
| GP77 | EXTERNAL | Exercise a reviewed prior-package rollback and revalidate actual readiness/runtime identity without erasing the failed epoch | GP65 |

### Thresholds, critical path and exclusions

The existing approved load profile is **10 requests/second for 120 seconds**:
p95 <= 1000 ms, p99 <= 2500 ms, unexpected errors <= 1%, average CPU <= 70%,
peak CPU <= 90%, memory <= 80% of limit, instrumentation p95 overhead <= 20%,
and no missing declared certification spans. These are acceptance targets,
**not measured results of this work**. A complete emission ledger and sealed
capture are still required; an empty query or unknown denominator is not zero
loss. Any broadened production claim needs its own scope and evidence.

Highest-value next sequence:

1. Resolve GP19 and approve the real target/bootstrap inputs.
2. Complete GP27/GP30 and GP41-GP50 while platform owners perform GP20-GP40.
3. Prove the actual eight-boundary sampled graph, native-00/privacy/loss controls.
4. Prove durable recovery and a second run, then obtain scoped signoffs.

Async retry/replay/fan-in/worker certification is not silently added to Demo 01.
However, ordinary order creation writes workflow/outbox state, so its migrations,
run-owned cleanup and protection against unapproved background delivery are
direct dependencies. HTTP 202 is never evidence that asynchronous processing
completed. Local source reviews or this backlog cannot close unrelated gates.
