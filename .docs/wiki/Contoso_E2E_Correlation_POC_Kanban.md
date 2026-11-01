# Contoso End-to-End Correlation POC: atomic kanban

**Board state:** Rehydrated from the 78-card backlog and board-acceptance revision 1. No certification is implied by construction progress.
**Columns:** Avoid doing · To Do · In Progress · Done

| Avoid doing | To Do | In Progress | Done |
|---|---|---|---|
| 25 anti-patterns | 74 cards | 4 of 9 (WIP limit) | 0 |

## Board rules

1. Pull the highest-ranked executable facet. Reviewed interface construction may precede dependency Done; completion still requires every needs edge to be Done.
2. One active card per role, maximum nine. Evaluate applicable gate facets first.
3. Independent draft, two other-role reviews with claim labels, evidence-based adjudication, then merge and validation.
4. If work cannot progress, return it to To Do with waitingOn and the next action. There is no Blocked state.
5. A council votes on next actions; the evidence hierarchy, never majority vote, adjudicates technical claims.
6. Done requires all own acceptance clauses, completion dependencies, current evidence and two accepted other-role reviews. Fixtures never close live requirements.
7. Bootstrap traffic is NOT CERTIFIED. Final certification requires every applicable facet of all thirteen gates on the frozen deployed environment.

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

## To Do (74)

### R1: 10 cards

- [ ] **#2 GATE-07 · Removed-claims and preview-isolation lint**
  Dissatisfier · R1 · CD3 82.0 · 0.5 d · needs none
  - Phase: returned; scope: construction.
  - Next action: Run live deployment what-if for evaluation isolation and obtain two code reviews; the static guard and seeded tests pass locally.
  - Waiting on: Complete root infrastructure; Live what-if evidence; Two accepted code reviews
  - [ ] Fails on any requirement or dependency on .NET Service Bus 7.13.0, `Azure.Experimental.EnableActivitySource`, "classic adaptive sampling" for Java, APIM native OTLP, or an Azure Cache for Redis resource.
  - [ ] A certification dependency manifest lists every component on the certification path with its GA or preview status and source; the lint fails on any preview entry, including Azure Monitor Traces / Trace Analytics and any OTLP ingestion path not confirmed GA for the target region.
  - [ ] Contoso Eval A/B code and parameters sit in isolated folders the certification deployment never references; a deployment what-if proves it.
  - [ ] A seeded fixture for each forbidden item makes the lint fail.

- [ ] **#4 GATE-11 · Deployability and naming-conformance gate**
  Dissatisfier · R1 · CD3 53.0 · 1 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] `azd up` (or the documented equivalent) deploys the full topology into an empty resource group with no manual steps beyond the README prerequisites; a second run shows no changes in what-if.
  - [ ] A naming lint checks the frozen logical-to-physical map: use the `contoso-corr-poc-` prefix where legal, documented storage/Key Vault/global-name and fixed-child exceptions, and an availability-checked discriminator where required. Every `service.name` and cloud role name still equals its §3 identifier: `contoso-storefront-spa`, `contoso-portal-ssr`, `contoso-orders-api`, `contoso-inventory-api`, `contoso-fulfillment-worker`, `contoso-notify-worker`, `contoso-order-aggregator`. The provider rejects a Service Bus namespace ending in `-sb`; its approved legal physical alias must be frozen.
  - [ ] Fails on instance IDs in role names (they belong only in `service.instance.id`) and on the reference pattern's header names (`x-business-correlation-id`, `business.correlation_id`).
  - [ ] Teardown and redeploy reproduce the same names.

- [ ] **#18 ADR-01 · ADRs A01-A03: causality, business ID, trust policy**
  Satisfier · R1 · CD3 48.0 · 1 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] DECISIONS.md holds signed ADRs A01, A02 and A03 with context, decision, consequences and Brief references.
  - [ ] A01 names W3C `traceparent`/`tracestate` and span links as the only technical-causality mechanism.
  - [ ] A02 defines when `business.invocation_id` is used, its format (UUIDv4 or ULID), the trusted edge, retention, privacy and cardinality controls, and whether the response header is exposed.
  - [ ] A03 gives testable rules for valid, absent, invalid and oversized context, deliberate trust-boundary breaks and safe hashing of rejected values, precise enough to write the Demo 03 and Demo 11 assertions.

- [ ] **#19 ARC-01 · Expected correlation boundary map**
  Satisfier · R1 · CD3 68.0 · 0.5 d · needs ADR-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Lists every hop with its expected span kind and edge type (parent or link) across the sync path, the SSR path, each transport, each worker, the Aggregator and replay.
  - [ ] Lists every API origin the Storefront calls and every SSR hop, and marks each deliberate new-root point with its ADR A03 rule.
  - [ ] GATE-08 (Invariant C), the orphan-candidate query, Demo 02 and the Mermaid diagram all read this one file; no second copy exists.

- [ ] **#20 ADR-02 · ADRs A04-A06: export baseline, telemetry topology, cache**
  Satisfier · R1 · CD3 66.0 · 0.5 d · needs ADR-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] A04 picks direct Azure Monitor export as the baseline, compares the Collector and third-party options, and lists the documented triggers that would justify Contoso Eval A.
  - [ ] A05 fixes one workspace-based Application Insights resource for `contoso-corr` / `poc` on the shared Log Analytics workspace, with a naming, RBAC and retention map.
  - [ ] A06 selects Azure Managed Redis, cites the Azure Cache for Redis retirement dates (Basic/Standard/Premium 30 Sep 2028; Enterprise and Enterprise Flash 30 Mar 2027) and marks the target SKU and region `VERIFY:`.

- [ ] **#40 DOC-01 · Architecture diagram (Mermaid)**
  Satisfier · R1 · CD3 32.0 · 0.5 d · needs ARC-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Shows every §3 component by its Contoso name, the trust boundaries and the deliberate new roots.
  - [ ] Sync parent edges and async link edges are visually distinct.
  - [ ] Generated from, or checked against, the boundary map, and renders on GitHub.

- [ ] **#52 DEM-01 · Contoso Demo 01: Synchronous golden path**
  Satisfier · R1 · CD3 45.0 · 1 d · needs GATE-08, API-01, DAT-01, DAT-02, DEM-00, JVM-02, JVM-04, WEB-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] `./demos/01/run.sh` drives Storefront → Gateway → Orders → Inventory → PostgreSQL + Redis with a known business ID.
  - [ ] GATE-08 passes: one trace-id/OperationId on all rows, unique non-zero span-ids, each child ParentId equals its parent's Id; logs carry the same IDs.
  - [ ] The live show finds the expected nodes in Application Map and the expected graph in Transaction Diagnostics.
  - [ ] Assertion, evidence pack and reset run through DEM-00, and the demo fits 3-5 minutes.

- [ ] **#59 DOC-02 · README quick start**
  Satisfier · R1 · CD3 32.0 · 0.5 d · needs DEM-01, INF-04, INF-05, INF-06
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Lists prerequisites (tools, Azure roles, quotas, region) and the steps from clone to `azd up` to a passing Demo 01.
  - [ ] Links the VERIFY register and lists the open items.
  - [ ] Includes a repository map that matches §4.

- [ ] **#71 DOC-03 · DEMO_RUNBOOK.md: operations**
  Satisfier · R1 · CD3 18.0 · 1 d · needs DEM-00
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] A pre-show checklist covers the certification window, sampling state, seed data and a baseline check.
  - [ ] Gives the demo order with a 3-5 minute budget and the reset steps for each demo.
  - [ ] Gives recovery steps for a demo that fails mid-show.

- [ ] **#74 DOC-04 · Presenter talk track for Demos 01-15**
  Delighter · R1 · CD3 9.3 · 1.5 d · needs DOC-03
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] For each demo: the claim proven (Brief §), what to click in Application Map and Transaction Diagnostics, which evidence to point at, and what the demo rules out.
  - [ ] Two likely audience questions per demo, with answers grounded in the Brief.
  - [ ] A timed dry run keeps each segment within 3-5 minutes.

### R2: 4 cards

- [ ] **#36 WEB-01 · Contoso Storefront SPA instrumentation**
  Satisfier · R2 · CD3 22.7 · 1.5 d · needs INF-01
  - Phase: returned; scope: construction.
  - Next action: Deploy the verified cohost artifact with real Entra/runtime configuration, run the first authenticated browser-to-Gateway trace, and obtain two code reviews.
  - Waiting on: Root infrastructure and Entra grants; Live Application Insights rows; Two accepted code reviews
  - [ ] The SDK version is pinned in the lockfile and in VERSIONS.md (`VERIFY:`); the connection string is injected at deploy time.
  - [ ] `distributedTracingMode` is W3C and the SDK initializes before the first network call; a browser network capture shows a valid `traceparent` on the first call to the Gateway.
  - [ ] Route changes produce page views, and each order action produces an AJAX dependency whose Id is the Gateway request's ParentId.
  - [ ] All Storefront telemetry carries role name `contoso-storefront-spa`.

- [ ] **#39 WEB-02 · Correlation domains and CORS**
  Satisfier · R2 · CD3 34.0 · 1 d · needs ARC-01, INF-04, WEB-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] `enableCorsCorrelation` is on and `correlationHeaderDomains` lists only the Gateway origin; CDN, analytics, identity and other third-party domains are excluded.
  - [ ] An automated browser test proves `traceparent`, `tracestate` and `x-business-invocation-id` reach only approved origins; a call to an excluded domain carries none of them.
  - [ ] The Gateway CORS policy allows those headers on preflight for the Storefront origin only; preflight from any other origin is refused.

- [ ] **#60 WEB-03 · Contoso Portal SSR instrumentation**
  Satisfier · R2 · CD3 26.0 · 1 d · needs INF-03, INF-04
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Server requests and outbound calls appear under the stable role name `contoso-portal-ssr`.
  - [ ] Outbound calls to the Gateway carry a valid `traceparent` from the server span, and the Gateway continues it.
  - [ ] Where browser page telemetry and the server render form separate roots, the boundary map records it as expected.
  - [ ] The process runs exactly one telemetry provider.

- [ ] **#61 DEM-02 · Contoso Demo 02: Portal SSR path vs SPA path**
  Satisfier · R2 · CD3 32.0 · 0.5 d · needs ARC-01, DEM-00, WEB-01, WEB-03
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] SSR requests appear under the stable role name `contoso-portal-ssr`.
  - [ ] Separate roots between browser page telemetry and the server render are shown and explained from the boundary map.
  - [ ] Assertion, evidence pack and reset run through DEM-00, and the demo fits 3-5 minutes.

### R3: 5 cards

- [ ] **#5 GATE-01 · Protocol-integrity static scan**
  Dissatisfier · R3 · CD3 53.0 · 1 d · needs none
  - Phase: returned; scope: construction.
  - Next action: Obtain two code reviews and link current protocol-scan evidence; APIM modules, XML and local tests are implemented.
  - Waiting on: Two accepted code reviews; Current integrated scan evidence
  - [ ] Runs on every pull request over `apim/policies/`, `infra/`, `web/`, `services/` and `workers/`, and fails on: a trace-flags change from `-00` to `-01`; a `traceparent` or trace-id built from `context.RequestId`; an APIM diagnostic `httpCorrelationProtocol` other than `W3C`; a Storefront `distributedTracingMode` other than W3C (the SDK default `AI_AND_W3C` also fails).
  - [ ] Fails when the forbidden logic sits behind a feature flag, named value or disabled policy fragment.
  - [ ] Seeded fixtures in `tests/fixtures/` (excluded from every deployable path) make the scan fail; with them removed it passes.
  - [ ] Output is saved under `evidence/` and linked from the No falsification row of CERTIFICATION_REPORT.md.

- [ ] **#23 INF-04 · APIM IaC: Contoso Gateway, logger and W3C diagnostic**
  Satisfier · R3 · CD3 39.0 · 1 d · needs INF-01, INF-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] The logger points to `contoso-corr-poc-appi` through the Key Vault-backed named value (managed identity only if validated for the pinned API version: `VERIFY:`).
  - [ ] The diagnostic sets `httpCorrelationProtocol: W3C`, fixed sampling as a parameter (100 in certification), `alwaysLog: allErrors`, frontend and backend logged headers limited to `x-business-invocation-id`, and body bytes 0 (property shape `VERIFY:` against the pinned API version).
  - [ ] The diagnostic scope (all APIs or per API) is documented and the export shows no conflicting diagnostic at another scope.
  - [ ] The exported resource state and its API version are saved under `evidence/config/`; the GATE-01 and GATE-04 config checks pass against it.

- [ ] **#24 API-02 · Gateway business-ID and header policy**
  Satisfier · R3 · CD3 58.0 · 0.5 d · needs ADR-01, INF-04
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] `x-business-invocation-id` is the only business header forwarded; values that fail the ADR A02 length, charset or format rules, or that come from untrusted callers, are removed so the trusted edge issues a new one.
  - [ ] Duplicate header values are overwritten, never appended.
  - [ ] A policy test shows Authorization headers, cookies and tokens are never logged.

- [ ] **#25 API-01 · Gateway inbound-context policy**
  Satisfier · R3 · CD3 46.0 · 1 d · needs ADR-01, INF-04
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Policy does not manually rewrite a valid inbound carrier. The gateway request continues the inbound trace ID; its backend dependency advances parentage, and Orders ParentId equals that actual backend dependency Id. Assert ingress/outbound wire carriers and real gateway spans separately; never manufacture missing gateway rows.
  - [ ] Absent or malformed context (all-zero IDs, wrong length, forbidden version `ff`) gets a compliant root from supported tracing, never one built in policy or from `context.RequestId`. Higher versions follow verified forward-compatible parsing; invalid `tracestate` can be discarded independently. Any stricter restart is an explicit A03 trust boundary. Rejected raw values are never logged; a digest requires a reviewed safe-input/key policy.
  - [ ] An inbound `-00` flag is forwarded as `-00`.
  - [ ] Evidence for the valid, absent, invalid and `-00` cases is saved; any documented-versus-observed difference goes to the gap log.

- [ ] **#47 DEM-03 · Contoso Demo 03: Inbound context at the Gateway**
  Satisfier · R3 · CD3 52.0 · 0.5 d · needs GATE-01, API-01, DEM-00
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Four cases run: valid context is continued; absent and invalid context get a new compliant root; `-00` is forwarded unchanged.
  - [ ] The GATE-01 scan result is shown live: no rewrite, no RequestId conversion.
  - [ ] Negative control: GATE-01 run against the rewrite fixture fails, showing the guard firing.
  - [ ] Assertion, evidence pack and reset run through DEM-00, and the demo fits 3-5 minutes.

### R4: 10 cards

- [ ] **#6 GATE-02 · Single-provider-per-JVM check**
  Dissatisfier · R4 · CD3 53.0 · 1 d · needs none
  - Phase: returned; scope: construction.
  - Next action: Build the real complete reactor after security/messaging/sampler artifacts arrive, then verify every deployed JVM and obtain two code reviews.
  - Waiting on: Real security and messaging modules; Parent-safe extension proof; Per-JVM live startup/export evidence
  - [ ] Runtime dependency/artifact scans of every Java build reject an additional OpenTelemetry SDK implementation, provider/global construction, classic Application Insights SDK, extra exporter or competing attachment. The explicitly approved hash-pinned Contoso sampler extension alone may compile against public sampler/autoconfigure-SPI APIs with `provided` scope resolved to the agent ABI; those classes/libraries are never packaged as a second runtime SDK. Its only customization wraps the supplied sampler, with loader/service/classloader/content and strict positive/unsampled proof. Unknown extensions or `setSampler`/provider-builder workarounds fail closed.
  - [ ] A startup-log assertion fails on a second agent load, a duplicate provider, a bytecode transformation error or an exporter rejection, including App Service built-in autoinstrumentation running alongside an explicit `-javaagent`.
  - [ ] A code scan fails on in-process SDK construction (`OpenTelemetrySdk.builder`, `SdkTracerProvider`); manual spans use `GlobalOpenTelemetry` only.
  - [ ] A seeded fixture with a second SDK makes both the dependency check and the startup check fail.
  - [ ] Per-JVM output is saved under `evidence/` and satisfies the §9 one-provider check.

- [ ] **#13 GATE-05 · JDK 25 compatibility gate**
  Dissatisfier · R4 · CD3 30.0 · 2 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Covers HTTP server, HTTP client, JDBC, the selected Redis client, logging MDC, each messaging SDK in use, shutdown flush and redeploy/restart on the exact JDK 25 image and agent version recorded in VERSIONS.md.
  - [ ] Each test compares emitted spans with an expected-span oracle (count, kind, parent); a service that starts but drops spans fails.
  - [ ] A seeded fixture with one instrumentation module disabled makes the gate fail.
  - [ ] CI blocks certification of any demo that exercises a Java service or worker until the gate passes on the deployed build.
  - [ ] Results are saved per service under `evidence/`.

- [ ] **#15 JVM-05 · VERSIONS.md, Java SBOM and agent pin**
  Satisfier · R4 · CD3 68.0 · 0.5 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] VERSIONS.md lists every SDK, agent, runtime, image and API version in use (browser SDK, APIM SKU and API version, App Service JDK 25 image, Java agent, frameworks and clients, messaging SDKs, Functions runtime and worker, resource API versions), each with an official source link.
  - [ ] A Java SBOM covers the HTTP, JDBC, Redis and messaging libraries of every service and worker.
  - [ ] The agent binary is pinned with its checksum and release/support evidence, and has a GATE-06 `VERIFY:` entry.
  - [ ] A change to any listed version triggers GATE-12 invalidation.

- [ ] **#26 INF-03 · Compute IaC: App Service on JDK 25 and Java Functions**
  Satisfier · R4 · CD3 34.0 · 1 d · needs INF-01, INF-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] App Service apps `contoso-orders-api` and `contoso-inventory-api` run the JDK 25 image recorded in VERSIONS.md (`VERIFY:` until confirmed); `contoso-portal-ssr` runs on its documented stack.
  - [ ] Function apps host `contoso-fulfillment-worker`, `contoso-notify-worker` and `contoso-order-aggregator` on the Java worker recorded in VERSIONS.md (`VERIFY:` JDK 25 support).
  - [ ] Every app has a managed identity and the Key Vault-referenced connection string, and sets its role name to its §3 identifier through the agent's supported setting (`VERIFY:` the setting for the pinned agent).
  - [ ] Each app has exactly one agent-attach mechanism (never built-in autoinstrumentation plus an explicit `-javaagent`).

- [ ] **#27 JVM-01 · Java service baseline: Orders API and Inventory API**
  Satisfier · R4 · CD3 35.3 · 1.5 d · needs INF-03, JVM-05
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Both services run on JDK 25 with the pinned agent attached exactly once through the supported App Service startup mechanism.
  - [ ] Role names equal `contoso-orders-api` and `contoso-inventory-api`; instance identity appears only in `service.instance.id`.
  - [ ] Startup logs show one agent, one provider and a working exporter (GATE-02 passes).
  - [ ] An Orders → Inventory call produces a client span in Orders and a server child span in Inventory whose ParentId matches.

- [ ] **#28 JVM-02 · Structured logging correlation (MDC)**
  Satisfier · R4 · CD3 52.0 · 0.5 d · needs JVM-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Logs carry trace-id and span-id from the instrumentation-supplied MDC fields, plus `business.invocation_id`; no code parses `traceparent` by hand.
  - [ ] A test matches each log line's IDs to the active span, including work handed to thread pools.
  - [ ] Logs contain no credentials, tokens, raw claims, query parameters, cache keys or bodies (GATE-04).

- [ ] **#32 JVM-04 · Trusted-edge business invocation ID and HTTP propagation**
  Satisfier · R4 · CD3 34.0 · 1 d · needs ADR-01, JVM-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Orders API accepts an inbound `x-business-invocation-id` only from a trusted caller and only if it matches the approved length, charset and namespace; otherwise it generates a new opaque UUIDv4 or ULID.
  - [ ] Property-based tests cover length, charset, namespace and trust cases.
  - [ ] The value is set on the active span and logs and sent to Inventory API as the allowlisted header; an integration test proves continuity without using the trace-id.
  - [ ] The ID is returned in a response header only if ADR A02 allows it.

- [ ] **#41 JVM-03 · Manual spans for uncovered business boundaries**
  Satisfier · R4 · CD3 32.0 · 0.5 d · needs JVM-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Manual spans (for example `orders.validate`) use `GlobalOpenTelemetry` from the agent.
  - [ ] Each records exceptions and error status and carries `business.invocation_id`.
  - [ ] Code review and a trace show no span duplicates an auto-instrumented one.

- [ ] **#48 DEM-04 · Contoso Demo 04: Trusted-edge business invocation ID**
  Satisfier · R4 · CD3 52.0 · 0.5 d · needs GATE-10, API-02, DEM-00, JVM-04, MSG-02, OBS-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] An untrusted or malformed ID is replaced; a trusted valid ID is accepted and carried over HTTP and Service Bus.
  - [ ] Business-lookup KQL returns every intended trace and nothing extra.
  - [ ] Negative control: an untrusted caller's ID is visibly rejected and replaced.
  - [ ] Assertion, evidence pack and reset run through DEM-00, and the demo fits 3-5 minutes.

- [ ] **#69 DEM-05 · Contoso Demo 05: Error and timeout correlation**
  Satisfier · R4 · CD3 18.0 · 1 d · needs DAT-01, DEM-00, JVM-03
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Feature flags inject an Inventory timeout and a PostgreSQL error.
  - [ ] Trace and business correlation hold; exceptions attach to the right span; APIM error telemetry appears (alwaysLog).
  - [ ] Assertion, evidence pack and reset run through DEM-00, and the demo fits 3-5 minutes.

### R5: 14 cards

- [ ] **#29 INF-06 · Messaging IaC: Service Bus, Event Grid, Event Hubs, Storage Queue**
  Satisfier · R5 · CD3 34.0 · 1 d · needs INF-03
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] The frozen legal physical alias for logical `contoso-corr-poc-sb` (queue `contoso-orders`; topic `contoso-order-events` with Fulfillment and Notify subscriptions), `contoso-corr-poc-egt` (CloudEvents schema), `contoso-corr-poc-eh` (hub `contoso-telemetry-batch`) and storage queue `contoso-legacy-jobs` deploy. Required Contoso result/relay entities are in the same declared topology; no reserved `-sb` suffix or unreviewed private-only Event Grid delivery claim is used.
  - [ ] Producers and workers use managed identity with least-privilege data roles; no connection strings in settings.
  - [ ] Max delivery count, lock duration and dead-lettering are parameters (used by Demos 06 and 07).
  - [ ] Deploys idempotently under GATE-11.

- [ ] **#30 MSG-01 · Message envelope v1, validator and untrusted-context handling**
  Satisfier · R5 · CD3 34.0 · 1 d · needs ADR-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] The schema defines version, `traceparent`, `tracestate`, `business.invocation_id`, message identity and size limits.
  - [ ] A shared validator rejects malformed, oversized and schema-invalid envelopes, with a test per rule.
  - [ ] Consumers apply ADR A03 to spoofed or malformed context: new root and bounded rejection category, never a raw rejected value. An optional digest requires the approved safe-input/key policy; a plain hash is not automatically a safe pseudonym for arbitrary personal input.
  - [ ] A schema change requires a version bump and triggers GATE-12 invalidation.

- [ ] **#31 MSG-07 · Storage Queue envelope path**
  Satisfier · R5 · CD3 42.0 · 0.5 d · needs INF-06, JVM-01, MSG-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Jobs use envelope v1; the worker extracts the envelope context and starts its PROCESS span explicitly.
  - [ ] The envelope round-trips within size and privacy limits; oversized or invalid envelopes are rejected.
  - [ ] Trigger binding behaviour is tested for the properties it does and does not expose; gaps go to the gap log.

- [ ] **#42 MSG-02 · Service Bus send and process path**
  Satisfier · R5 · CD3 22.7 · 1.5 d · needs INF-06, JVM-01, MSG-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Orders API sends with a producer span and W3C context in application properties through supported Azure SDK instrumentation or an explicit propagator (`VERIFY:` property name and behaviour for the pinned Java SDK); `business.invocation_id` travels as an application property.
  - [ ] Fulfillment Worker creates a PROCESS span per delivery, parented or linked to the producer context as the boundary map defines.
  - [ ] The Functions host and the Java worker do not emit duplicate spans; trigger parentage is verified.
  - [ ] Message ID, delivery count and dead-letter reason are recorded as safe attributes.

- [ ] **#43 MSG-03 · Retry attempt semantics**
  Satisfier · R5 · CD3 58.0 · 0.5 d · needs MSG-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Each redelivery creates a new PROCESS span with a new span-id and an attempt or delivery-count attribute, keeping the original propagated context.
  - [ ] Message and business identity are unchanged across attempts.
  - [ ] GATE-09 retry checks pass after N injected transient failures.

- [ ] **#49 DEM-06 · Contoso Demo 06: Service Bus retry semantics**
  Satisfier · R5 · CD3 52.0 · 0.5 d · needs GATE-09, DEM-00, MSG-03
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Declare injectedFailures, expectedAttempts, terminal outcome and delivery-count convention. N injected failures followed by success produce N+1 distinct PROCESS attempts; a run stopping after N failed deliveries has N attempts and no success. Actual extra redeliveries are classified, not hidden.
  - [ ] Message and business identity are preserved and no span-id is reused (GATE-09).
  - [ ] Assertion, evidence pack and reset run through DEM-00, and the demo fits 3-5 minutes.

- [ ] **#54 MSG-04 · Dead-letter preservation and replay tool**
  Satisfier · R5 · CD3 29.0 · 1 d · needs MSG-03
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Dead-lettered messages keep the original MessageId, `business.invocation_id`, trace context and dead-letter reason, with no tokens or payload data in attributes.
  - [ ] The replay tool in `workers/` re-submits with the original MessageId recorded and either links to the original context or starts a new trace linked to it.
  - [ ] `business.invocation_id` is unchanged after replay; GATE-09 replay checks pass.

- [ ] **#55 DEM-07 · Contoso Demo 07: Dead-letter and replay**
  Satisfier · R5 · CD3 52.0 · 0.5 d · needs GATE-09, DEM-00, MSG-04
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] The dead-lettered message keeps its safe identity and reason.
  - [ ] Replay links to the original context or starts a new trace linked to it; `business.invocation_id` is unchanged (GATE-09); the reset drains the dead-letter queue.
  - [ ] Assertion, evidence pack and reset run through DEM-00, and the demo fits 3-5 minutes.

- [ ] **#56 MSG-08 · Fan-out and fan-in with links**
  Satisfier · R5 · CD3 29.0 · 1 d · needs MSG-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] An event on `contoso-order-events` fans out to Fulfillment and Notify; each creates its own PROCESS span from the propagated context.
  - [ ] `contoso-order-aggregator` creates one span with at most one parent and links to every contributor, within the bound.
  - [ ] Links show in exported telemetry and in the trace-reconstruction query.

- [ ] **#57 DEM-08 · Contoso Demo 08: Fan-out and fan-in**
  Satisfier · R5 · CD3 52.0 · 0.5 d · needs GATE-09, DEM-00, MSG-08
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Fulfillment and Notify each show their own PROCESS span.
  - [ ] The Aggregator has at most one parent plus bounded links to every contributor (GATE-09).
  - [ ] Assertion, evidence pack and reset run through DEM-00, and the demo fits 3-5 minutes.

- [ ] **#62 MSG-06 · Event Hubs mixed-context batch path**
  Satisfier · R5 · CD3 24.0 · 1 d · needs INF-06, JVM-01, MSG-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Events from different traces go to `contoso-telemetry-batch` and are consumed as one batch.
  - [ ] The batch span links to each contributing context within a configured bound, or uses a documented bounded per-item representation; the first message is never the parent.
  - [ ] Partition and offset are recorded as safe attributes; the link bound is a parameter.

- [ ] **#63 DEM-09 · Contoso Demo 09: Event Hubs mixed-context batch**
  Satisfier · R5 · CD3 36.0 · 0.5 d · needs GATE-09, DEM-00, MSG-06
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Batch processing uses links or a bounded per-item representation.
  - [ ] The first message is never the parent (GATE-09).
  - [ ] Assertion, evidence pack and reset run through DEM-00, and the demo fits 3-5 minutes.

- [ ] **#67 MSG-05 · Event Grid CloudEvents path**
  Satisfier · R5 · CD3 24.0 · 1 d · needs INF-06, JVM-01, MSG-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Orders API publishes to `contoso-corr-poc-egt` with context in the CloudEvents distributed-tracing extension; the event `id` is never the trace-id.
  - [ ] The subscriber extracts the context and creates a PROCESS span; propagation is validated end to end.
  - [ ] Duplicate deliveries are detected by event `id` and handled idempotently; size and validation limits are enforced.

- [ ] **#70 DEM-10 · Contoso Demo 10: Event Grid CloudEvents and Storage Queue envelope**
  Satisfier · R5 · CD3 18.0 · 1 d · needs GATE-09, DEM-00, MSG-05, MSG-07
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] CloudEvent `id` differs from the trace-id; context survives through the distributed-tracing extension and through the envelope.
  - [ ] Size and validation limits are enforced and a duplicate delivery is handled.
  - [ ] Assertion, evidence pack and reset run through DEM-00, and the demo fits 3-5 minutes.

### R6: 4 cards

- [ ] **#33 INF-05 · Data-tier IaC: PostgreSQL and Azure Managed Redis**
  Satisfier · R6 · CD3 29.0 · 1 d · needs ADR-02, INF-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] `contoso-corr-poc-pg` with database `contoso_orders` and `contoso-corr-poc-amr` (Azure Managed Redis; SKU and region `VERIFY:`) deploy with private connectivity from the App Service apps.
  - [ ] Credentials use Microsoft Entra authentication or Key Vault references, never source or logs.
  - [ ] A connection smoke test from Inventory API passes and its logs contain no secrets.
  - [ ] No Azure Cache for Redis resource exists (GATE-07 passes).

- [ ] **#34 DAT-01 · PostgreSQL JDBC client spans**
  Satisfier · R6 · CD3 39.0 · 1 d · needs INF-05, JVM-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] The selected safe JDBC logical-operation wrapper uses the existing provider to produce one CLIENT dependency under Inventory, with only database system, approved logical namespace, endpoint and fixed operation/outcome attributes. Automatic JDBC capture is disabled on this path; any automatic qualification is separate and never runs in parallel at the same logical boundary.
  - [ ] SQL text and parameter capture are off or sanitized; GATE-04 finds no literals, parameters or credentials.
  - [ ] The span wraps the logical operation, not just pool acquisition, and driver retries are visible as a count.
  - [ ] A runbook note states these are client spans, not PostgreSQL server spans, and gives the time-correlation method for server logs.

- [ ] **#35 DAT-02 · Azure Managed Redis client spans**
  Satisfier · R6 · CD3 39.0 · 1 d · needs INF-05, JVM-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] The Redis client version is checked against the pinned agent's supported list (`VERIFY:`); if unsupported, a manual client span wraps a safe abstraction boundary.
  - [ ] Spans record operation category, endpoint and outcome only; keys, values, scripts, command arguments and session IDs are never captured.
  - [ ] Each cache call appears once; hit or miss is a bounded attribute or a metric.

- [ ] **#50 DEM-12 · Contoso Demo 12: Data-tier safety**
  Satisfier · R6 · CD3 52.0 · 0.5 d · needs GATE-04, DAT-01, DAT-02, DEM-00
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] JDBC and Redis client spans are present with safe attributes and wrap the logical operation.
  - [ ] GATE-04 finds no SQL literals or parameters and no Redis keys, values or scripts.
  - [ ] Negative control: a seeded SQL literal and Redis key are not captured, and the scan proves it.
  - [ ] Assertion, evidence pack and reset run through DEM-00, and the demo fits 3-5 minutes.

### R7: 11 cards

- [ ] **#22 OBS-03 · KQL: orphan-candidate detection**
  Satisfier · R7 · CD3 48.0 · 0.5 d · needs ARC-01, INF-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Returns spans whose ParentId has no matching Id in scope over a parameterized lookback, plus a legacy-schema variant.
  - [ ] Cross-resource scope is explicit, so orphans caused by query scope are visible.
  - [ ] Output joins to the expected boundary map so known remote or broker parents are pre-labelled.

- [ ] **#44 OBS-01 · Sampling matrix and bounded certification switch**
  Satisfier · R7 · CD3 29.0 · 1 d · needs INF-04, JVM-01, WEB-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] docs/SAMPLING_MATRIX.md covers browser, APIM, each JVM, the optional Collector and ingestion, for certification and production separately.
  - [ ] The Java row records the pinned agent's documented default and override (`VERIFY:`), never "classic adaptive sampling".
  - [ ] One configuration switch sets 100% on every layer for a declared window and reverts afterwards; the change record and config snapshots are saved.

- [ ] **#45 OBS-02 · KQL: trace reconstruction and business lookup**
  Satisfier · R7 · CD3 29.0 · 1 d · needs INF-01, JVM-04
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Both queries run against the current workspace tables (`AppRequests`, `AppDependencies`, `AppTraces`, `AppExceptions`, `AppEvents`, `AppPageViews`) and return results for a known trace-id and business ID.
  - [ ] Legacy variants (`requests`, `dependencies`, `traces`, `exceptions`) live in separate files; no query mixes schemas.
  - [ ] Business lookup returns every intended trace for a known ID and nothing extra, checked against the demo's expected trace list.
  - [ ] Saved outputs carry the timestamp and workspace configuration.

- [ ] **#58 DEM-14 · Contoso Demo 14: Orphan-candidate triage**
  Satisfier · R7 · CD3 36.0 · 0.5 d · needs ARC-01, DEM-00, OBS-03
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Every candidate is classified as expected-remote, cross-resource, sampled, delayed or defect, with justification.
  - [ ] Defects = 0.
  - [ ] Assertion, evidence pack and reset run through DEM-00, and the demo fits 3-5 minutes.

- [ ] **#64 OBS-04 · Load, overhead and cost test**
  Satisfier · R7 · CD3 22.7 · 1.5 d · needs DAT-01, DAT-02, MSG-02, OBS-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] A repeatable load profile measures latency, CPU, memory, throughput, ingestion volume, exporter backpressure and cost at certification and production sampling.
  - [ ] Gateway diagnostic and policy overhead is reported before and after.
  - [ ] Restart and shutdown under load show no unacceptable span loss.
  - [ ] Results are compared with thresholds agreed in advance and saved under `evidence/`.

- [ ] **#65 OBS-07 · Production sampling profile with rollback**
  Delighter · R7 · CD3 30.0 · 0.5 d · needs OBS-01, OBS-04
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Per-layer production rates and error and critical-path rules are version-controlled and based on OBS-04 measurements.
  - [ ] A one-step rollback restores the previous profile and is tested.
  - [ ] Labelled as a proposal for Brief J02, outside the certification scope.

- [ ] **#66 DEM-15 · Contoso Demo 15: Sampling, overhead and certification-to-production switch**
  Satisfier · R7 · CD3 26.0 · 1 d · needs GATE-12, DEM-00, OBS-01, OBS-04, OBS-07
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Shows the sampling matrix and toggles 100% certification mode on and off through configuration, inside the GATE-12 window.
  - [ ] Shows the load-test report against thresholds: latency, CPU, memory, throughput, ingestion volume and cost.
  - [ ] Shows the version-controlled production profile and its tested rollback.
  - [ ] Assertion, evidence pack and reset run through DEM-00, and the demo fits 3-5 minutes.

- [ ] **#73 OBS-05 · Correlation workbook**
  Delighter · R7 · CD3 11.0 · 1 d · needs OBS-02, OBS-03
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Deploys with the IaC and offers trace reconstruction by trace-id, business lookup by ID, orphan-candidate triage and ingestion volume against budget.
  - [ ] Driven by parameters only; no hard-coded identifiers or secrets.
  - [ ] A presenter can run every demo's live-show step from the workbook instead of raw KQL.

- [ ] **#76 OBS-06 · Orphan-candidate triage classifier**
  Delighter · R7 · CD3 13.0 · 1 d · needs OBS-03
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Each candidate is classified as expected-remote, cross-resource, sampled, delayed or defect, with the evidence used.
  - [ ] An unexplained candidate defaults to defect until a reviewer records a justification.
  - [ ] Demo 14 reruns and the regression suite can use its output in place of manual triage.

- [ ] **#77 EVL-B · Contoso Eval B: Azure Monitor Traces / Trace Analytics preview lane**
  Delighter · R7 · CD3 5.0 · 1 d · needs CRT-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Records preview terms, regional availability, schema and rollback.
  - [ ] Has no production or certification dependency; GATE-07 passes.
  - [ ] Findings are dated and flagged for re-check.

- [ ] **#78 EVL-A · Contoso Eval A: Collector tail-sampling lane**
  Delighter · R7 · CD3 4.7 · 1.5 d · needs ADR-02, CRT-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Runs only if an ADR A04 trigger is documented; otherwise the card closes with "rejected: no trigger" recorded.
  - [ ] Reports high availability, capacity and late-span behaviour.
  - [ ] Isolated from certification: GATE-07 passes and no certification component references it.

### R8: 8 cards

- [ ] **#8 GATE-04 · Telemetry data-safety scan**
  Dissatisfier · R8 · CD3 40.0 · 1.5 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] A scan over every Application Insights / Log Analytics table in the certification window fails on JWT-shaped strings, `Authorization` or cookie values, request or response bodies, email addresses, UPNs, raw Entra object IDs, SQL literals or bound parameters, and Redis keys, values, scripts or arguments.
  - [ ] A config check fails unless APIM frontend and backend body bytes are 0, the logged-header allowlist holds only `x-business-invocation-id`, JDBC statement capture is sanitized or off, and Redis argument capture is off.
  - [ ] Seeded forbidden values sent through the negative controls of Demos 12 and 13 are caught: the seeded run fails and the clean run passes.
  - [ ] Results are saved under `evidence/` and linked from the Data safety row.

- [ ] **#10 GATE-10 · Identifier-integrity guard**
  Dissatisfier · R8 · CD3 39.0 · 1 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] A query over the certification window fails if any OperationId, Id or ParentId equals an APIM request ID, an Entra request or correlation ID, a CloudEvent `id`, a Service Bus MessageId or a `business.invocation_id`.
  - [ ] Fails if `business.invocation_id` appears as a custom-metric dimension or is read on any authentication or authorization code path.
  - [ ] Fails on any business ID that is not an opaque UUIDv4 or ULID, or that embeds customer, user or order data.
  - [ ] Fails if Entra request or correlation IDs appear anywhere except the separate security-approved attribute.
  - [ ] A seeded fixture for each case makes it fail.

- [ ] **#14 INF-02 · Key Vault and Key Vault-reference wiring**
  Satisfier · R8 · CD3 68.0 · 0.5 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] `contoso-corr-poc-kv` deploys with RBAC authorization and purge protection, and no secret values in templates or parameters.
  - [ ] A reusable Bicep module grants each app's managed identity read access to named secrets only and emits `@Microsoft.KeyVault(...)` reference strings for app settings.
  - [ ] An explicitly approved SDK bootstrap generates at least 256 bits of HMAC material with a cryptographically strong RNG in memory and stores it as a named Standard Key Vault secret version. Generation is client-side, not falsely described as vault-side entropy. No secret value enters source, parameters, files, argv, transcripts, logs or evidence; provenance, version/epoch, readers and rotation are reviewed.
  - [ ] GATE-03 passes against the module and its parameters.

- [ ] **#37 IDN-01 · Entra authentication and safe identity attributes**
  Satisfier · R8 · CD3 34.0 · 1 d · needs ADR-01, JVM-01, WEB-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Microsoft Entra ID authenticates the Storefront and the APIs; authorization failures stay correlated to the request span.
  - [ ] An attribute allowlist permits only authentication outcome and policy or role category; no JWTs, refresh tokens, Authorization headers or claims bundles.
  - [ ] Entra request and correlation IDs, when kept, sit only in the separate security-approved attribute and never replace W3C IDs.

- [ ] **#38 IDN-02 · HMAC pseudonymization and key rotation**
  Satisfier · R8 · CD3 58.0 · 0.5 d · needs IDN-01, INF-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] User analytics uses a secret-keyed HMAC over a stable internal subject; the key lives in Key Vault.
  - [ ] Key rotation, access control and retention are documented and approved by the privacy owner.
  - [ ] A test proves no plain hash of an email address or object ID appears in telemetry.

- [ ] **#51 DEM-13 · Contoso Demo 13: Identity and privacy enrichment**
  Satisfier · R8 · CD3 52.0 · 0.5 d · needs GATE-04, GATE-10, DEM-00, IDN-01, IDN-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Telemetry carries only the HMAC pseudonym and the authentication-outcome category.
  - [ ] No JWTs, claims or Entra IDs are used as trace IDs (GATE-10) and the classification scan is clean (GATE-04).
  - [ ] Negative control: an attempt to capture a forbidden header is rejected or redacted.
  - [ ] Assertion, evidence pack and reset run through DEM-00, and the demo fits 3-5 minutes.

- [ ] **#53 DEM-11 · Contoso Demo 11: Spoofed and malformed message context**
  Satisfier · R8 · CD3 42.0 · 0.5 d · needs DEM-00, MSG-01, MSG-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Spoofed and malformed message context follows ADR A03: a new root and bounded rejection outcome; raw values are absent. Any displayed digest follows the reviewed safe-input/key policy, rather than treating an arbitrary unkeyed personal-data hash as safe.
  - [ ] Negative control: the spoofed context is visibly refused.
  - [ ] Assertion, evidence pack and reset run through DEM-00, and the demo fits 3-5 minutes.

- [ ] **#68 INF-07 · Access and retention governance**
  Satisfier · R8 · CD3 24.0 · 1 d · needs ADR-01, INF-01
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Resource-context RBAC follows the ADR A05 map; an access test shows an unauthorized identity cannot query or export telemetry, with audit evidence saved.
  - [ ] Retention for tables that carry `business.invocation_id` follows ADR A02.
  - [ ] A purge procedure is documented and tested on synthetic data.
  - [ ] Owners for topology, RBAC, retention and purge are named for the Governance row.

### R9: 8 cards

- [ ] **#9 GATE-08 · Trace and span identity assertions (Invariants A, B, C)**
  Dissatisfier · R9 · CD3 40.0 · 1.5 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Given a known business ID or trace-id and a time window, asserts Invariant A: every row shares one non-zero 32-hex trace-id/OperationId, except documented trust-boundary roots.
  - [ ] Asserts Invariant B: every actual request/dependency span has a non-zero unique span-id, and every strict child's ParentId equals its parent's Id. Associated logs/events/exceptions may reference the same active span; their display/context IDs are not counted as new spans. Duplicate emitted span records are never hidden by de-duplication.
  - [ ] Asserts Invariant C: browser dependency → Gateway request → Gateway backend dependency → Orders server → Inventory server → JDBC and Redis client chain matches the expected boundary map; JDBC and Redis spans are client/dependency kind; no APIM request ID appears as a trace-id.
  - [ ] Fixture sets for each failure (split trace, duplicate span-id, wrong ParentId, missing hop) fail with a message naming the broken edge.
  - [ ] Linked from the Trace identity and Span identity rows.

- [ ] **#11 GATE-12 · Certification-boundary gate**
  Dissatisfier · R9 · CD3 34.0 · 1 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] 100% sampling on browser, APIM, JVMs and workers can only be switched on with a declared start and end; the check fails if any layer is still at 100% outside the window.
  - [ ] The certification statement names only the environment, the VERSIONS.md versions, the tested paths and the sampling configuration.
  - [ ] A CI rule marks the affected CERTIFICATION_REPORT.md rows "invalidated" when a dependency, runtime, agent, policy or message-schema file changes, until the regression suite passes again.
  - [ ] A seeded agent-version bump flips the affected rows to "invalidated".

- [ ] **#12 GATE-13 · Evidence-integrity and gap-log gate**
  Dissatisfier · R9 · CD3 34.0 · 1 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Certification assertions read live Application Insights / Log Analytics rows only; a run fails if any assertion is fed by mocks or fixture rows.
  - [ ] Every pack under `evidence/demo-XX/<timestamp>/` carries the query text, non-secret resource identifiers, UTC timestamps, a config snapshot, the VERSIONS.md hash and a SHA-256 manifest; a tampered file fails verification.
  - [ ] A gap log records each case where documented and observed behaviour differ (claim, source, observed evidence, impact); the affected demo shows the observed behaviour and no code compensates for it.
  - [ ] Linked from the Repeatability row.

- [ ] **#16 CRT-01 · CERTIFICATION_REPORT.md template**
  Satisfier · R9 · CD3 58.0 · 0.5 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] One row per §24 criterion (Coverage, Trace identity, Span identity, No falsification, Async honesty, Durable lookup, Data safety, Operational stability, Backend usability, Governance, Repeatability) with demo(s), test(s) or gate(s), evidence path and pass/fail.
  - [ ] Includes the scoped certification statement block from GATE-12.
  - [ ] Includes sign-off rows for architecture, application, platform, SRE/observability, security/privacy and data owners.

- [ ] **#17 GOV-01 · Adjudication log and claim-labelling workflow**
  Delighter · R9 · CD3 82.0 · 0.5 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] DECISIONS.md has an adjudication log with: claim, each reviewer's label (Verified / Partially verified / Unsupported / Incorrect / Outdated), resolution, winning source and its evidence-hierarchy level.
  - [ ] The pull-request template requires review by at least two other roles and a label on every material technical claim.
  - [ ] The log states that majority vote is not evidence; a resolution without a source is rejected in review.
  - [ ] The first conflict between the two attached sources (`x-business-correlation-id` in the reference pattern versus `x-business-invocation-id` in prompt §3) is logged and resolved in favour of the prompt.

- [ ] **#46 DEM-00 · Demo harness: one-command run, evidence capture, reset**
  Delighter · R9 · CD3 24.0 · 1.5 d · needs GATE-13, INF-01, OBS-01, OBS-02
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] `./demos/XX/run.sh` drives synthetic traffic with a known `business.invocation_id`, then saves raw `traceparent` at trusted test points, AI rows, KQL output, screenshot slots for Application Map and Transaction Diagnostics, and config snapshots to `evidence/demo-XX/<timestamp>/`.
  - [ ] Before asserting, it confirms certification mode (OBS-01) is on for the run window; if not, the run is marked inconclusive rather than passed or failed.
  - [ ] It runs the demo's assertion and prints PASS or FAIL with the §19 and §24 IDs.
  - [ ] `./demos/XX/reset.sh` returns flags, seed data, queues and sampling to baseline and verifies it.
  - [ ] A demo folder template carries Purpose, Pre-state, Run, Live show, Evidence capture, Assertion and Reset.

- [ ] **#72 CRT-03 · Residual limitations and §23 coverage map**
  Satisfier · R9 · CD3 18.0 · 1 d · needs none
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] Every §20 failure mode is marked covered (with the card, demo or gate) or not covered (with the reason).
  - [ ] Every §23 production-ready item is marked in scope (with evidence) or explicitly deferred, including the Azure Cache for Redis migration plan (F06) and production rollout (J03-J10).
  - [ ] Delivered as §8 item 8 and satisfies the first §9 check.

- [ ] **#75 CRT-02 · Certification run, sign-off package and executive summary**
  Satisfier · R9 · CD3 19.0 · 2 d · needs GATE-01, GATE-02, GATE-03, GATE-04, GATE-05, GATE-06, GATE-07, GATE-08, GATE-09, GATE-10, GATE-11, GATE-12, GATE-13, CRT-01, CRT-03, DEM-01, DEM-02, DEM-03, DEM-04, DEM-05, DEM-06, DEM-07, DEM-08, DEM-09, DEM-10, DEM-11, DEM-12, DEM-13, DEM-14, DEM-15, DOC-01, DOC-02, DOC-03, DOC-04, INF-07, OBS-05
  - Phase: not-started; scope: construction.
  - Next action: Pull the next executable facet; completion still requires every dependency and acceptance clause.
  - [ ] With GATE-05 passed, a bounded certification window runs all 15 demos with every gate green; VERSIONS.md is frozen and hashed.
  - [ ] CERTIFICATION_REPORT.md has evidence links and pass/fail for every §24 row.
  - [ ] R9 confirms the §5 non-negotiables and every §9 checklist item with evidence.
  - [ ] The executive summary (10 lines or fewer) states what was built, the certification status and the open VERIFY items, and the output is returned in §8 order; Contoso Eval A/B stay outside it.

## In Progress (4 of 9)

### R5: 1 cards

- [ ] **#7 GATE-09 · Async-honesty assertions**
  Dissatisfier · R5 · CD3 46.0 · 1 d · needs none
  - Phase: draft; scope: construction.
  - Next action: Implement the real async contracts and retry/link assertions with isolated checker fixtures.
  - [ ] Asserts each delivery attempt has its own PROCESS span with a new span-id and an attempt or delivery-count attribute.
  - [ ] Asserts replay either links to the original context or starts a new trace linked to it, with `business.invocation_id` unchanged, and never continues an old parent as if it were active.
  - [ ] Asserts the Aggregator span has at most one parent plus links to every contributor, batch processing never makes the first message the parent, and link counts stay within the configured bound.
  - [ ] A fixture for each anti-pattern (span-id reuse, old-parent continuation, single-parent fan-in, first-message parent, unbounded links) makes it fail.
  - [ ] Called by Demos 06-10 and linked from the Async honesty row.

### R7: 1 cards

- [ ] **#21 INF-01 · Telemetry backbone IaC: Application Insights, Log Analytics, budgets**
  Satisfier · R7 · CD3 39.0 · 1 d · needs ADR-02, INF-02
  - Phase: draft; scope: construction.
  - Next action: Finish the typed telemetry/budget/alert module and sampling integration for root assembly.
  - [ ] One workspace-based `contoso-corr-poc-appi` is connected to `contoso-corr-poc-law`, with retention set per ADR A05.
  - [ ] The connection string is written to `contoso-corr-poc-kv` from deployment outputs; it is never emitted in plain text.
  - [ ] An ingestion budget and an ingestion-volume alert exist.
  - [ ] `infra/main.bicep`, `infra/params/poc.bicepparam` and `azure.yaml` exist and deploy this module under GATE-11.

### R8: 1 cards

- [ ] **#1 GATE-03 · Secret-free repository and Key Vault-reference check**
  Dissatisfier · R8 · CD3 106.0 · 0.5 d · needs none
  - Phase: draft; scope: construction.
  - Next action: Implement source/history/evidence secret checks and named-secret Key Vault wiring.
  - [ ] A secret scanner runs on every pull request and over the full history of the merged repository; zero findings allowed.
  - [ ] A config lint fails unless the Application Insights connection string appears only as a `@Microsoft.KeyVault(...)` reference in App Service and Functions settings and as a Key Vault-backed named value for the APIM logger; the Storefront receives it at deploy time, never from a committed file.
  - [ ] `infra/params/poc.bicepparam`, `demos/` scripts and generated `evidence/` are inside the scan scope.
  - [ ] A seeded fake secret in a fixture makes the job fail.

### R9: 1 cards

- [ ] **#3 GATE-06 · VERIFY register with fail-closed assumption tests**
  Dissatisfier · R9 · CD3 53.0 · 1 d · needs none
  - Phase: draft; scope: construction.
  - Next action: Finish the source-bound verification register, exact acceptance-scope mapping, and real evidence harness.
  - [ ] Each pinned or assumed value (Java agent version, APIM API version and SKU behaviour, JS SDK version, Functions Java worker and JDK 25 support, Azure Managed Redis SKU and region, Java messaging SDK versions, workspace table schema) has a `VERIFY:` entry with the exact official page, an owner and a status.
  - [ ] Each entry has an automated test that fails closed when the deployed or locked value differs from the recorded value or the source link is missing.
  - [ ] A lint fails on any version, API version, SKU capability, GA date or support-matrix claim in the repository that has no register entry.
  - [ ] Open items are listed in README.md and in the executive summary.

## Done (0)

No card has met every acceptance and review requirement yet.

## Definition of Done

Acceptance, current evidence, required other-role reviews, approved naming/safety invariants, and completion dependencies must all be satisfied. NOT RUN, stale, fixture-only, or unsupported evidence is never a pass.
