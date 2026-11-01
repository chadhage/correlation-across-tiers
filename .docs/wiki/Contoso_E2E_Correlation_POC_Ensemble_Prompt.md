# Ensemble Prompt — Contoso End-to-End Correlation POC and Demo Suite

> Source of record: *Azure End-to-End Correlation Architecture* (evidence cutoff 31 October 2026), referred to below as **"the Brief"**. Section references (§) point to it. Attach the Brief to every model in the ensemble.

---

## 0. Mission

Build a **deployable proof of concept (POC)** and a **suite of repeatable, presenter-ready demos** that prove the Brief's recommended correlation architecture works end to end. Use **Contoso** for every demo, resource, service, and artifact name.

The POC passes when it meets the Brief's certification criteria (§24) in a bounded 100%-fidelity certification mode (§12). The demos must let a presenter show each invariant live and then show the matching evidence in Application Insights and KQL.

---

## 1. Ensemble operating protocol

Each model gets one primary role. Every model also reviews the whole output.

| Role | Owns |
|---|---|
| **R1 Lead Architect** | Topology, ADRs (Brief §22 Phase A), naming, the final merge |
| **R2 Front-end Engineer** | SPA (Application Insights JS SDK), server-rendered App Service, CORS, correlation-domain allow/exclude lists (§5) |
| **R3 API Platform Engineer** | APIM logger, diagnostics, policies, header allowlist, inbound-context handling (§7) |
| **R4 Java/OTel Engineer** | Java JDK 25 services, Azure Monitor Java agent, manual spans, MDC logging, business-ID edge logic (§6, §11, §18) |
| **R5 Async/Integration Engineer** | Service Bus, Event Grid (CloudEvents), Event Hubs, Storage Queue, Java Functions worker, retry/DLQ/replay/fan-out/fan-in/batch (§8, §17) |
| **R6 Data-Tier Engineer** | Azure Database for PostgreSQL (JDBC), Azure Managed Redis client spans, attribute safety (§9) |
| **R7 Observability/KQL Engineer** | Application Insights and Log Analytics topology, sampling matrix, the three KQL procedures, workbooks (§12, §13, §18) |
| **R8 Security & Privacy Red Team** | Entra enrichment, HMAC pseudonymization, secret handling, telemetry data-classification scan, spoofing tests (§10, §20, Phase H) |
| **R9 Verifier / Adjudicator** | Claim labelling, invariant checks, conflict resolution, final certification report (§19, §24) |

**Process (run in order):**
1. **Independent draft.** Each role produces its part without reading the others' drafts.
2. **Cross-review.** Each model reviews at least two other roles' outputs. It labels every material technical claim using the Brief's scheme: **Verified / Partially verified / Unsupported / Incorrect / Outdated**.
3. **Adjudication (R9).** Resolve conflicts using the evidence hierarchy below. Record each resolution in a `DECISIONS.md` log with the winning rationale. Majority vote is not evidence.
4. **Merge (R1).** Produce one coherent repository and one demo runbook. Don't keep competing versions of the same artifact.
5. **Self-check.** Run the §5 Non-negotiables and §9 Acceptance checklists below against the merged output before returning it.

**Evidence hierarchy (from the Brief):** (1) W3C Trace Context and OpenTelemetry specifications → (2) Microsoft Learn, Azure product documentation, and REST schemas → (3) official Microsoft GitHub repositories and issues → (4) field reports → (5) explicit inference, labelled as inference.

---

## 2. Grounding and honesty rules

- Don't invent product versions, API versions, SKU capabilities, GA dates, or support-matrix entries. If a value has to be pinned (for example, the Java agent version, the APIM API version, the JS SDK version, or the Functions Java worker or JDK 25 support), write `VERIFY:` plus the official source to check. Add a test that fails closed if the assumption is wrong.
- Treat any preview capability as a separate **evaluation lane**, outside the certification dependency path (§14, Phase J07–J08). This includes Azure Monitor Traces/Trace Analytics and any native OTLP ingestion path that isn't confirmed GA for the target region.
- Don't carry forward claims the Brief removed (§21). Specifically: no .NET Service Bus 7.13.0 or `Azure.Experimental.EnableActivitySource` requirements, no "classic adaptive sampling" for Java, no APIM native-OTLP assumption, and no Azure Cache for Redis for new builds.
- When the documentation and the deployed behavior disagree, the demo shows the **observed** behavior and the gap is logged. Don't write code that papers over it.

---

## 3. Contoso naming convention

| Element | Contoso name |
|---|---|
| Workload / environment | `contoso-corr` / `poc` |
| Resource prefix | `contoso-corr-poc-` |
| Browser SPA | **Contoso Storefront** (`contoso-storefront-spa`) |
| Server-rendered App Service | **Contoso Portal** (`contoso-portal-ssr`) |
| APIM instance | **Contoso Gateway** (`contoso-corr-poc-apim`) |
| Java service A (App Service, JDK 25) | **Contoso Orders API** (`contoso-orders-api`) |
| Java service B (App Service, JDK 25) | **Contoso Inventory API** (`contoso-inventory-api`) |
| Async producer | `contoso-orders-api` (SEND/PRODUCER spans) |
| Java Functions consumer(s) | **Contoso Fulfillment Worker** (`contoso-fulfillment-worker`), **Contoso Notification Worker** (`contoso-notify-worker`) |
| Fan-in aggregator | **Contoso Order Aggregator** (`contoso-order-aggregator`) |
| PostgreSQL | `contoso-corr-poc-pg` (database `contoso_orders`) |
| Azure Managed Redis | `contoso-corr-poc-amr` |
| Messaging | `contoso-corr-poc-sb` (queue `contoso-orders`, topic `contoso-order-events`), `contoso-corr-poc-egt`, `contoso-corr-poc-eh` (hub `contoso-telemetry-batch`), storage queue `contoso-legacy-jobs` |
| Application Insights | `contoso-corr-poc-appi` (one per workload and environment) |
| Log Analytics | `contoso-corr-poc-law` |
| Key Vault | `contoso-corr-poc-kv` |
| Business ID header / attribute | `x-business-invocation-id` / `business.invocation_id` |
| Demo IDs | **Contoso Demo 01 … Contoso Demo 15** |

`service.name` and the Application Insights cloud role name must equal the service identifiers above. Instance identity goes only in `service.instance.id` (§6).

---

## 4. POC scope (build all of it)

Reference topology (Brief Figure 1 and §17):

**Synchronous path:** Contoso Storefront (JS SDK, W3C mode) and Contoso Portal (SSR) → Contoso Gateway (APIM, `httpCorrelationProtocol: W3C`) → Contoso Orders API → Contoso Inventory API → PostgreSQL (JDBC CLIENT spans) and Azure Managed Redis (CLIENT spans) → Application Insights and Log Analytics.

**Asynchronous path:** Contoso Orders API produces → Service Bus, Event Grid CloudEvents, Event Hubs, and Storage Queue → Contoso workers consume and create PROCESS spans per attempt → fan-out to Fulfillment and Notification → fan-in at Contoso Order Aggregator using span links → dead-letter and replay path.

**Identity:** Microsoft Entra ID authenticates the SPA and the APIs. Telemetry gets safe enrichment only (§10).

### Required deliverables (one repository)

```
contoso-corr-poc/
├─ README.md                      # quick start, prerequisites, VERIFY register
├─ DECISIONS.md                   # ADRs A01–A06 + ensemble adjudication log
├─ VERSIONS.md                    # inventory freeze (§19): every SDK/agent/runtime/API version + source link
├─ infra/                         # Bicep (preferred) or Terraform; azd-compatible
│  ├─ main.bicep, modules/…       # AI+LAW, APIM logger+diagnostic, App Service JDK 25, Functions,
│  │                              # PostgreSQL, Azure Managed Redis, SB/EG/EH/Storage, KV, RBAC, budgets/alerts
│  └─ params/poc.bicepparam
├─ apim/policies/                 # inbound context validation, business-ID allowlist, NO -00→-01 rewrite,
│                                 # NO traceparent from context.RequestId; body bytes = 0
├─ web/storefront-spa/            # AI JS SDK, W3C mode, correlation allow/exclude domains, CORS-ready
├─ web/portal-ssr/                # server-rendered app, instrumented independently
├─ services/orders-api/           # Java 25, agent-attached once, trusted-edge business-ID logic, producers
├─ services/inventory-api/        # Java 25, JDBC + Redis clients, safe attributes
├─ workers/                       # Java Functions: fulfillment, notify, aggregator (links), DLQ replay tool
├─ contracts/message-envelope.v1.json   # versioned envelope: W3C context, business ID, message identity, size limits
├─ kql/                           # trace-reconstruct.kql, business-lookup.kql, orphan-candidates.kql (+ legacy-schema variants)
├─ workbooks/contoso-correlation.workbook.json
├─ demos/                         # one folder per Contoso Demo: run script, expected output, evidence capture
├─ tests/                         # invariant tests A/B/C, sampling, logging, async, data-tier, privacy scan, load
├─ evidence/                      # generated: headers, AI rows, KQL results, App Map/TxDiag exports, config snapshots
└─ docs/
   ├─ DEMO_RUNBOOK.md             # presenter script, timings, talk track, reset steps
   ├─ CERTIFICATION_REPORT.md     # §24 criteria → evidence links → pass/fail
   └─ SAMPLING_MATRIX.md          # browser / APIM / JVM / (optional) Collector / ingestion
```

---

## 5. Non-negotiable invariants (apply to every artifact)

1. W3C Trace Context is the **only** protocol for technical causality. A shared GUID in logs is a search key, not a trace (P1).
2. Extract and validate inbound context. Create a new root only when the context is absent or invalid, or at a deliberate trust boundary (P2).
3. **One OpenTelemetry provider per JVM**: the Azure Monitor Java agent, attached once. Manual spans use `GlobalOpenTelemetry` from that provider. Never add a second SDK or exporter (P3).
4. Never rewrite the `traceparent` sampled flag from `-00` to `-01`. Never synthesize a trace-id from APIM `context.RequestId`.
5. `business.invocation_id` is created or validated at the first trusted edge. It's opaque (UUIDv4/ULID), allowlisted, never an auth credential, and never a metric dimension.
6. Retries create **new** PROCESS spans with an attempt count. Replay links back to the original context or starts a new linked trace. Fan-in and batches use **links**, never one arbitrary parent.
7. JDBC and Redis spans are CLIENT spans only, never claimed as server-native continuation. Don't capture SQL literals, parameters, cache keys, values, or scripts.
8. No secrets, tokens, raw claims, Authorization headers, cookies, request/response bodies, or PII in telemetry. Load the Application Insights connection string from Key Vault references. Default APIM body capture is 0 bytes.
9. Entra request and correlation IDs stay in a separate security-approved field and never replace W3C IDs. User analytics uses a secret-keyed HMAC pseudonym.
10. Use 100% sampling only in bounded **certification mode**. Each layer's production sampling is documented separately (§12).
11. Use Azure Managed Redis for the new cache. Keep preview features outside the certification path.

---

## 6. Contoso demo suite

Each demo is a folder under `demos/` with these parts:
- **Purpose** and the Brief section(s) it proves
- **Pre-state / setup** (feature flags, seed data)
- **Run**: a single command (for example `./demos/01/run.sh`) that drives synthetic traffic with a known `business.invocation_id`
- **Live show**: what the presenter clicks in Application Map and Transaction Diagnostics
- **Evidence capture**: raw `traceparent` at trusted test points, AI rows, KQL output, and screenshots saved to `evidence/demo-XX/<timestamp>/`
- **Automated pass/fail assertion**, mapped to §19 and §24
- **Reset**: returns the environment to its baseline

| Demo | Title | Proves (Brief) | Pass condition |
|---|---|---|---|
| **Contoso Demo 01** | Synchronous golden path: Storefront → Gateway → Orders → Inventory → PostgreSQL + Redis | §17 sync, §19 Invariants A/B/C | One trace-id/OperationId across all rows. Every span-id is unique and non-zero. Each child ParentId equals the actual parent Id. The expected graph appears in App Map and TxDiag. |
| **Contoso Demo 02** | Portal SSR path vs. SPA path | §5 | SSR requests appear under a stable role name. Separate roots are shown and explained where context isn't propagated. |
| **Contoso Demo 03** | Inbound context at the Gateway: valid, absent, invalid, `-00` | §7, D05–D07, sampling invariant | Valid context is continued. Absent or invalid context gets a new compliant root. `-00` is never rewritten. A policy scan finds no rewrite or RequestId conversion. |
| **Contoso Demo 04** | Trusted-edge business invocation ID | §11, §18 edge logic, E09–E10 | An untrusted or malformed ID is replaced. A trusted, valid ID is accepted and propagated over HTTP and messages. The business-lookup KQL returns every intended trace and nothing extra. |
| **Contoso Demo 05** | Error and timeout correlation | I04 | Injected Inventory timeout and DB error keep trace and business correlation. Exceptions link to the right span. |
| **Contoso Demo 06** | Service Bus retry semantics | §8, G02, G07 | Transient failure × N creates N distinct PROCESS spans with a visible attempt/delivery count. Message and business identity are preserved. No span-id is reused. |
| **Contoso Demo 07** | Dead-letter and replay | G08, §17 async step 5 | DLQ keeps the safe identity and reason. Replay either links to the original context or starts a new trace linked to it. `business.invocation_id` stays unchanged. |
| **Contoso Demo 08** | Fan-out and fan-in | G09, §17 async step 6 | Fulfillment and Notify each create their own PROCESS span. The Aggregator has at most one parent plus links to every contributor (bounded). |
| **Contoso Demo 09** | Event Hubs mixed-context batch | G04, batch test | Batch processing uses links or a bounded per-item representation. The first message is never chosen as the parent. |
| **Contoso Demo 10** | Event Grid CloudEvents and Storage Queue envelope | G03, G05, `contracts/` | CloudEvent `id` ≠ trace-id. Context survives delivery through the distributed-tracing extension or envelope. Size and validation limits are enforced. Duplicate delivery is handled. |
| **Contoso Demo 11** | Spoofed and malformed message context | G10, A03 | Malformed or spoofed context follows the trust policy, for example a new root with a safely hashed rejected value. |
| **Contoso Demo 12** | Data-tier safety | §9, F01–F05 | JDBC and Redis CLIENT spans are present with safe attributes. The privacy scan finds no SQL literals or parameters and no Redis keys, values, or scripts. Spans wrap the logical operation, not just pool acquisition. |
| **Contoso Demo 13** | Identity and privacy enrichment | §10, H01–H03 | Telemetry contains the HMAC pseudonym and auth outcome category only. No JWTs, claims, or Entra IDs are used as trace IDs. The classification scan is clean. |
| **Contoso Demo 14** | Orphan-candidate triage | §18 orphan KQL, I08 | Every candidate is classified as expected-remote, cross-resource, sampled, delayed, or defect, with justification. Defects = 0. |
| **Contoso Demo 15** | Sampling, overhead, and certification-to-production switch | §12, I01, I09, J02 | Shows the documented sampling matrix. 100% certification mode is toggled on and off via config. The load test reports latency, CPU, memory, throughput, ingestion volume, and cost against thresholds. The production sampling config is version-controlled with a rollback. |

**Optional, isolated evaluation lanes** (label them **Contoso Eval A/B**; they're not part of certification):
- **Contoso Eval A:** OpenTelemetry Collector tail-sampling lane. It's justified only by a documented trigger (J07) and must report HA, capacity, and late-span behavior.
- **Contoso Eval B:** Azure Monitor Traces / Trace Analytics preview (J08). It records terms, region, schema, and rollback, and has no production dependency.

**Negative controls:** Where a demo proves a guard (Demos 03, 04, 11, 12, 13), include a test that shows the guard firing. For example, attempt a forbidden header capture or an untrusted business ID and confirm it's rejected or redacted. **Don't** ship an anti-pattern implementation such as a `-00→-01` rewrite policy in deployable code, even when it's behind a flag.

---

## 7. Build sequence (follow the Brief's atomic plan)

Run the phases in this order, keeping the dependencies listed in the Brief: **A** (decisions/ADRs) → **B** (platform IaC) → **C** (browser and front end) → **D** (APIM) → **E** (Java services and JDK 25 compatibility suite, E08) → **F** (PostgreSQL/Redis) → **G** (async) → **H** (identity, privacy, governance) → **I** (sampling and validation, which runs the demos) → **J01** (certification sign-off package only).

The **JDK 25 compatibility gate (§6)** must pass before any Java demo is certified. Required coverage: HTTP server and client, JDBC, the selected Redis client, logging MDC, messaging SDKs, shutdown flush, and redeploy/restart. A service that starts but silently drops spans fails the gate.

---

## 8. Required output from the ensemble (return in this order)

1. **Executive summary** (≤10 lines): what was built, certification status, open VERIFY items.
2. **Architecture diagram** (Mermaid) of the Contoso topology with correlation boundaries, using sync parent edges and async link edges.
3. **Full repository contents** per §4, with complete files and no placeholders except `VERIFY:` items and Key Vault references.
4. **DEMO_RUNBOOK.md** with the presenter talk track for Contoso Demo 01–15. Each demo should run in 3–5 minutes and include its reset steps.
5. **CERTIFICATION_REPORT.md** template that maps each §24 criterion to its demo(s), test(s), evidence path, and pass/fail result.
6. **DECISIONS.md** with ADRs A01–A06 and the ensemble adjudication log (claim, labels from each reviewer, resolution, source).
7. **VERIFY register**: every assumption that needs confirmation against official docs, with the exact page or source to check.
8. **Residual limitations** (§20 failure modes the POC doesn't cover, and why).

---

## 9. Acceptance checklist (R9 must confirm before returning)

- [ ] §23 production-ready checklist is addressed item by item (in the POC scope or explicitly deferred).
- [ ] §24 criteria are all mapped: Coverage, Trace identity, Span identity, No falsification, Async honesty, Durable lookup, Data safety, Operational stability, Backend usability, Governance, Repeatability.
- [ ] All 15 Contoso demos have a runnable script, an automated assertion, evidence capture, and a reset step.
- [ ] The three KQL procedures run against the current workspace schema, with legacy-schema variants kept separate.
- [ ] No secrets or tokens appear anywhere in the repository. The connection string is a Key Vault reference only.
- [ ] Exactly one telemetry provider per JVM is proven by startup logs and a dependency scan.
- [ ] No preview component is on the certification path.
- [ ] The certification statement is scoped to the named environment, versions, paths, and sampling config. Any dependency, runtime, agent, policy, or schema change invalidates the affected portion until the regression suite passes again.
