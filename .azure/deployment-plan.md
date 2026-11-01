# Contoso Azure Deployment Plan

> **Status:** Approved

## 1. Project overview

Build the Contoso end-to-end correlation POC and repeatable demo suite described
in the ensemble prompt, using the existing 78-card backlog and kanban.
This is a new application; the workspace initially contains documentation only.

## 2. Confirmed requirements

| Attribute | Value |
|-----------|-------|
| Classification | Bounded proof of concept, not a production certification |
| Workload / environment | `contoso-corr` / `poc` |
| Subscription | `474c40eb-d385-40d8-baa2-06883dbdca2d` (confirmed by user) |
| Preferred location | `centralus` (availability and quota verification required) |
| Hosting | New Azure App Service APIs/Portal and Java Functions workers |
| Infrastructure | Bicep, azd-compatible |
| Cost authorization | Preparation approved; provisioning requires separate cost and quota approval |
| Daily budget target | USD 1000, explicitly supplied by user; alert target, not a hard spend cap |
| Intended resource lifetime | 720 hours, explicitly supplied by user; no automatic teardown authorized |

## 3. Source documents

- Ensemble prompt, force-ranked backlog, and atomic kanban in `.docs/wiki/`.
- Architecture Brief: user-provided PDF in Downloads, cutoff 31 October 2026.
- Reference pattern: user-provided PDF in Downloads, supporting source only.
- Source precedence: W3C/OpenTelemetry specifications, official Azure
  documentation and schemas, official repositories, field reports, labelled
  inference. The Brief and prompt govern conflicts with the reference pattern.

| Source | SHA-256 |
|--------|---------|
| Architecture Brief PDF | `69a50cc9138a93da4588845ff575b6b5316bc892a47f6caf3fd706b46fb6b3a5` |
| Reference-pattern PDF | `d1bef4b11a39bd29543483416b32c9796757fb97235b257d9454946999e4bbb9` |

Both PDFs were extracted locally for the ensemble; no source document was
uploaded to an external service.

## 4. Planned topology

- Contoso Storefront SPA and Contoso Portal SSR through Contoso Gateway.
- Contoso Orders API and Contoso Inventory API on verified JDK 25 hosts.
- PostgreSQL and Azure Managed Redis with private data-tier connectivity.
- Service Bus, Event Grid CloudEvents, Event Hubs, and Storage Queue.
- Fulfillment, Notification, and Aggregator Java Functions; dead-letter replay.
- One workspace-based Application Insights resource, Log Analytics, Key Vault,
  managed identities, least-privilege RBAC, retention, budgets, and alerts.
- Microsoft Entra authentication and HMAC-pseudonymized identity enrichment.
- Isolated evaluation lanes, never on the certification dependency path.

## 5. Preparation sequence

1. Extract and ground both PDFs; confirm the exact acceptance boundaries.
2. Independently draft role-owned artifacts and cross-review each with two roles.
3. Resolve conflicts in `DECISIONS.md`; council votes select actions, not facts.
4. Freeze verified versions and explicit fail-closed `VERIFY:` entries.
5. Generate the single `contoso-corr-poc/` implementation and regression gates.
6. Build and test locally; verify functional behavior and negative controls.
7. Validate infrastructure, regional availability, policy, quota, and cost.
8. Obtain explicit provisioning approval before any resource creation.
9. Deploy only after validation; run live certification and owner sign-offs.

## 6. Provisioning checklist

VERIFY: Resource quantities, concrete SKUs, service availability in `centralus`,
subscription policy and quota, and estimated cost must be recorded before the
deployment plan is approved for provisioning.

### Observed read-only preflight

These observations were obtained on 31 October 2026. Quotas and availability
must be refreshed immediately before deployment.

| Check | Observed result | Meaning |
|-------|-----------------|---------|
| Operator authorization | Owner at the confirmed subscription through the Azure CLI | Does not authorize spending or destructive actions |
| Resource groups | 17 currently present | A new POC group will not approach the published group limit |
| P1v3 App Service quota / usage | 360 / 0 in `centralus` | Candidate capacity, not a reserved allocation |
| EP1 Functions quota / usage | 10 / 0 in `centralus` | Candidate capacity, not a reserved allocation |
| Storage account quota / usage | 250 / 0 in `centralus` | Candidate capacity |
| VNet quota / usage | 1000 / 2 in `centralus` | Candidate capacity |
| NSG quota / usage | 5000 / 4 in `centralus` | Candidate capacity |
| Private endpoint quota / usage | 65536 / 1 in `centralus` | Candidate capacity |
| APIM, PostgreSQL Flexible Server, Managed Redis | `centralus` present in provider metadata | SKU capacity still requires verification |
| App Service Linux JDK | `JAVA|25-java25`, Active | Hosting support is separate from agent compatibility |
| Functions Java | Java 25 GA; Linux Consumption stops at Java 21 | Do not select Linux Consumption |
| App Service Node | `NODE|24-lts`, Active | Local Node 22 is not the deployed runtime |
| Canonical Orders host name | Available at the time of the read-only name check | Does not reserve the global name |

Inherited-policy enumeration returned three Defender provisioning initiatives.
One enables advanced threat protection for PostgreSQL Flexible Server; its cost
must be included in the estimate. No policy exclusion or exemption is proposed.

The Azure MCP policy lookup returned AuthorizationFailed in its own
authentication context. The separately authorized Azure CLI successfully read
the confirmed subscription, effective assignments, quotas, and operator roles.
These contexts are not treated as interchangeable, and no global MCP
authentication change was made.

### Council review in progress

R1 has an independent architecture draft. R2-R9 are independently grounding
their designs against both PDFs and official sources. Implementation waits for
integration interfaces and adjudication of acceptance conflicts, including
resource naming restrictions, real-span uniqueness versus associated log rows,
gateway tracer parent advancement, and gate-bootstrap dependencies.

### Candidate preparation architecture for approval

| Component | Candidate | Planned quantity |
|-----------|-----------|------------------|
| Compute | Linux P1v3 Dedicated App Service plan, Always On | 1 shared plan initially; bounded JVM heaps; capacity tested before certification |
| Web hosts | Storefront/Portal, Orders, Inventory | Final SPA packaging decided by R2; canonical telemetry roles remain separate |
| Functions hosts | Fulfillment, Notify, Aggregator, Java 25 | 3 apps on the Dedicated plan; SDK-managed timer delivery, not native-binding parity |
| Gateway | Classic APIM Developer, external VNet | 1 |
| PostgreSQL | Flexible Server 18, Standard_B1ms/Burstable, 32 GiB, 7-day backup | 1 server and `contoso_orders`; HA off for this bounded POC |
| Managed Redis | Balanced_B0, EnterpriseCluster, TLS, Entra auth | 1 disposable cache; HA off; private endpoint |
| Messaging | Service Bus Standard, Event Hubs Standard, Event Grid custom topic | 1 of each; required queues/topic/hub plus result/relay entities |
| Storage | Standard_LRS StorageV2, managed-identity host/queue access | 1 account, owned containers/queues |
| Secrets | Standard Key Vault, RBAC and purge protection | 1 |
| Telemetry | Workspace-based Application Insights and Log Analytics | 1 of each |
| Networking | VNet, delegated compute/PG subnets, PE subnet, private DNS, ingress controls | One coherent root-owned topology; exact subordinate inventory follows module freeze |

No numeric price has been claimed. The user approved these candidate tiers and
all relevant centralus pricing lookup before any retail-rate request.
The cost estimate includes PostgreSQL Defender/ATP imposed by inherited policy,
private endpoints, storage, and telemetry, not just compute.

Listed fixed meters are USD 257.6573/month at 730 hours, approximately
USD 8.4709/day, before variable meters/open estimate items. Analytics Logs
ingestion is USD 2.76/GB without a free-tier assumption. Empty initial pricing
filters were retried against actual retail meter names; they were never treated
as zero cost. Publisher contact was supplied for local deployment configuration
only and must not appear in committed configuration or telemetry evidence.

The user approved the bounded load profile: 10 requests/second for 120 seconds,
p95 at most 1000 ms, p99 at most 2500 ms, unexpected errors at most 1%,
average CPU at most 70%, peak CPU at most 90%, memory at most 80% of limit,
instrumentation p95 overhead at most 20%, and no missing declared certification
spans. Injected failures have separate explicit expected outcomes.

### Evidence-backed refinements requiring approval

1. Preserve the 78 card IDs, ranks, and completion dependencies. Allow reviewed
   interfaces and construction/bootstrap validation to precede dependency Done;
   that does not close a predecessor or certify bootstrap traffic.
2. Actual request/dependency spans require unique IDs; associated log/event/
   exception rows can refer to their active span without becoming new spans.
3. Policies preserve valid inbound context; participating tracers advance
   parentage. Assert the real gateway/backend/Orders graph, never unchanged
   parent IDs or manufactured gateway rows.
4. Retain Contoso's stricter no-sampled-bit-promotion vector. W3C itself permits
   some tracer-originated sampled-bit changes; a contrary observed Contoso
   vector fails and is never repaired by header surgery.
5. Keep exact canonical role/service identifiers, but approve a frozen legal
   physical naming map with global discriminators, storage normalization,
   shorter Key Vault discriminator, and fixed platform-child exceptions.
   The provider rejected `contoso-corr-poc-sb` with `InvalidSuffix` because
   `-sb` is reserved; the actual namespace must use an approved legal alias.
6. Standard Key Vault stores HMAC material; it does not generate secret entropy.
   An explicitly approved SDK bootstrap generates 256-bit key material in
   memory and SETs a version without plaintext files/parameters/argv/logging.
7. Certify Java Functions hosting with SDK-managed delivery/settlement. Disable
   and verify the pinned `ai-azure-functions` bridge that recalculates host RPC
   flags; native messaging-trigger qualification remains separately labelled.
8. Use one safe logical JDBC/Redis CLIENT span through the existing provider,
   with automatic data collection disabled. Automatic instrumentation can be
   qualified separately; never run both at the same logical boundary.
9. Accept the documented Event Grid authenticated public-TLS delivery relay
   before private consumer pulls; do not claim every async hop is private-only.
10. Browser telemetry configuration is public at runtime, never committed or
    captured in evidence. One shared AI resource therefore has an explicitly
    untrusted browser-ingestion boundary; no confidential-browser-config claim.
11. A bounded retry with N failures followed by success expects N+1 attempts;
    unknown W3C versions and invalid tracestate follow standards-aware rules.

The user explicitly approved these preparation refinements, safe manual data
spans, SDK-managed workers, legal physical names, Standard Key Vault client-SDK
HMAC generation, disclosed browser/relay boundaries, and phase-aware work.
Construction can proceed; completed cross-reviews and evidence-based
adjudication remain merge requirements. None of this is a certification result.

### Open sampler prerequisite

VERIFY: Agent 3.7.10 remote-parent sampling is not assumed safe by default.
R7 is checking documented non-preview controls or a supported existing-provider
customizer. No extra runtime SDK/provider/exporter, agent fork, header rewrite,
preview dependency, or pass-by-vote is permitted. Any compiler-only SDK API
exception requires source classification, actual artifact/classloader proof
and explicit approval. The user approved one hash-pinned Contoso-owned outer
sampler wrapper with compiler-only `provided` SDK sampler/SPI APIs. It must
remain outside provider construction, preserve the lazy delegate, and pass
real positive/strict-unsampled tests. This is not a Microsoft sampler-specific
GA/support guarantee; that claim remains open.

## 7. Completion rules

Cards move to Done only with their acceptance criteria, required cross-reviews,
applicable gates, and linked evidence satisfied. Work that cannot progress
returns to To Do, with the next action recorded. There is no Blocked state.
Local fixtures test guards; they never substitute for live Azure certification.

## 8. Current authorization and validation

- Authorized: source analysis, deployment preparation, local implementation,
  tests, backlog/kanban maintenance, approved scope refinements, and full
  centralus pricing lookup for the approved candidates.
- Not yet authorized: Azure provisioning, paid evaluation lanes, teardown,
  purge, or changes to existing resources.
- Validation status: not run; no deployment or certification claim is made.
