# Contoso correlation decisions

Source of record: the user-supplied Architecture Brief, evidence cutoff
31 October 2026, SHA-256
`69a50cc9138a93da4588845ff575b6b5316bc892a47f6caf3fd706b46fb6b3a5`.
The supporting reference pattern is not authoritative where it conflicts with
the [ensemble prompt](../.docs/wiki/Contoso_E2E_Correlation_POC_Ensemble_Prompt.md).

**Design approval:** the user explicitly approved phase-aware construction,
legal physical aliases, in-memory client-SDK HMAC generation stored in Standard
Key Vault, SDK-managed Functions, safe manual data CLIENT spans, disclosed public
ingestion/relay boundaries, workload-only Portal/Storefront cohosting, and one
hash-pinned same-provider sampler extension with compiler-only SDK APIs.
These approvals are not provisioning, vendor-support, or certification claims.

## ADR A01: technical causality

**Context:** a shared business GUID alone cannot establish a trace graph.

**Decision:** W3C Trace Context is the technical propagation protocol. Real
spans have new nonzero IDs and actual parent relationships; many-to-one
causality uses bounded native links. Never derive trace IDs from business,
broker, APIM, or Entra identifiers.

**Consequences:** the expected boundary map is the single graph source.
Associated logs/events may repeat an active span ID; they are not new spans.
Missing rows/parents/links fail coverage rather than being fabricated.

**Evidence:** Brief P1/P2/P4/P5, sections 4/17/19/24;
[W3C Trace Context](https://www.w3.org/TR/trace-context/);
[OTel trace API](https://opentelemetry.io/docs/specs/otel/trace/api/).
Signed for construction by R1; runtime acceptance remains evidence-gated.

## ADR A02: durable business identity

**Context:** retry, replay, and aggregation can outlive a single trace.

**Decision:** use only `x-business-invocation-id` / `business.invocation_id`.
The trusted gateway generates a UUIDv4 for public user invocations. Only
explicitly authenticated, allowlisted workload/test issuers can supply an
accepted valid UUID. Overwrite duplicates or invalid/untrusted candidates;
never append. The opaque response header may be exposed to the approved origin.

Business identity is not authentication, a trace ID, a cache key, SQL comment,
or metric dimension. The declared POC state is synthetic. Telemetry retention
is explicitly configured, not assumed to equal message-state retention.
VERIFY: privacy-owner approval of exact retention/purge and cryptoperiod values
is required for the Governance certification row.

**Consequences:** durable state and lookup preserve the ID across declared
attempts/linked traces. Public inputs do not control trusted identity.

**Evidence:** prompt section 3 wins over reference-pattern naming; Brief
sections 10/11/19/24. Signed for construction by R1.

## ADR A03: context trust and sampling honesty

**Context:** valid syntax is not authenticated provenance; invalid state does
not always invalidate a valid parent.

**Decision:** use standards-aware parsing. Continue valid trusted contexts;
create a root only for absent/invalid context or a declared trust break.
Higher versions follow verified forward-compatible handling; `ff` is invalid.
Discard invalid `tracestate` independently where the parent remains valid.
Never record raw rejected context; any digest requires a reviewed safe policy.

For messaging, fixed entity/writer permissions and protected publication/
effect records establish the closed boundary. Claimed producer fields do not
authenticate a sender. A compromised authorized writer is a residual limitation.

Contoso's no `00 -> 01` promotion is deliberately stricter than W3C's permitted
tracer mutations. Preserve every required outbound sampled bit on the strict
unsampled vector. Run positive `01` completeness separately. Missing unsampled
export is reported, not called complete collection.

**Consequences:** the approved Contoso sampler wraps the existing agent's
supplied sampler, drops any valid unsampled parent, and delegates other inputs
unchanged. It never constructs/registers another SDK/provider/exporter or
rewrites headers. Its SDK sampler/SPI dependencies are compiler-only `provided`
and must not be packaged. The exact JAR/hash/ABI/loader joins the version freeze.
VERIFY: actual loader, reconfiguration, provider, and both vector tests.
No Microsoft sampler-specific GA/support guarantee is asserted.

**Evidence:** [W3C sampled flag](https://www.w3.org/TR/trace-context/#sampled-flag);
Brief A03/sections 8/12/19; pinned agent 3.7.10 source and R7/R9 adjudication.
Signed for construction by R1; extension approval is not a live pass.

## ADR A04: export and instrumentation ownership

**Context:** duplicated providers/exporters produce ambiguous span ownership.

**Decision:** one Azure Monitor Java agent per workload JVM, attached once.
Manual spans use its `GlobalOpenTelemetry`. Disable automatic semantic messaging
and JDBC/Redis collection where the approved manual safe boundary owns the span.
HTTP/framework instrumentation remains independently verified.

Use direct Azure Monitor export as the baseline. The Portal Node process has
one independently initialized Microsoft distro. The browser uses the pinned
JS SDK's explicit W3C-only mode, not a remembered legacy enum.

SDK-managed Java Functions consumers use real SDK receives/settlement, not
unproved native-trigger parity. Verify suppression of `ai-azure-functions`,
whose pinned source recalculates host RPC flags. Host and worker are different
processes; separately declared real host work is not fabricated duplication.

**Collector triggers:** a demonstrated routing, tail-sampling, data-boundary or
multi-backend requirement plus approved capacity/HA/late-span evidence.
No trigger has been approved for this POC; Eval A cannot silently enter the
certification deployment. Preview Trace Analytics/OTLP remains isolated.

**Evidence:** Brief P3/P8, sections 6/8/14/15/21;
[Java configuration](https://learn.microsoft.com/en-us/azure/azure-monitor/app/java-standalone-config).
Signed for construction by R1. Automatic/native qualification is separate.

## ADR A05: telemetry topology, names, and governance

**Decision:** one workspace-based `contoso-corr-poc-appi` for `contoso-corr/poc`,
one governed LAW, stable canonical role/service names, scoped identities, and
explicit retention/budgets/alerts. Server configuration uses Key Vault
references; the APIM logger uses a named value plus independently granted
Monitoring Metrics Publisher.

Browser configuration is public at runtime and never committed or saved in
evidence. The shared AI resource therefore accepts untrusted browser ingestion;
neither a key nor a resource name is cryptographic proof of the telemetry actor.
Certification uses controlled synthetic traffic and independent real carrier/
state/query evidence, not a universal adversarial-integrity guarantee.

Physical names follow a frozen legal map and availability checks. Storage
normalization, Key Vault's 24-character limit, fixed child names, and globally
scoped names are explicit exceptions. The observed provider rejects a namespace
ending `-sb`; a legal physical alias retains the logical Contoso identity.
Never use an instance ID as a role.

API main-site ingress is independently restricted to the authorized network/
identity path. SCM deployment remains separately authenticated/reachable; DNS
alone does not route a private deployment runner. PostgreSQL/Redis are private.
Standard messaging uses authenticated TLS endpoints; VNet integration is egress,
not a claim that every broker hop has Private Link.

**Evidence:** Brief sections 13/19/23/24;
[resource naming rules](https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules);
[APIM Insights](https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-app-insights).
Signed for construction by R1. VERIFY: six owner approvals/access/purge tests.

## ADR A06: new cache and data boundaries

**Decision:** Azure Managed Redis Balanced_B0, EnterpriseCluster, Entra/TLS,
private endpoint, disposable HA-off POC; PostgreSQL 18/B1ms is a bounded
synthetic candidate, not production sizing. GA Redis default access is broad;
private isolation and limited principals are compensating controls, not custom
command/key ACL equivalence. No preview ACL feature is on certification.

Datastore spans represent completed logical CLIENT operations with an allowlist
of operation/system/namespace/endpoint/outcome. No SQL literals/parameters or
cache keys/values/scripts/arguments/raw exceptions are captured.

Azure Cache for Redis Basic/Standard/Premium retirement is 30 September 2028;
Enterprise/Enterprise Flash is 30 March 2027. Existing-estate migration is
deferred because no migration was authorized, not because F06 occurs after J01
or because an unperformed inventory proved there is no legacy estate.

**Evidence:** Brief sections 9/21/22/23;
[Managed Redis](https://learn.microsoft.com/en-us/azure/redis/overview);
[retirement](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/retirement-faq).
Signed for construction by R1. VERIFY: regional SKU, real auth/renewal/safety.

## Ensemble adjudication log

Majority vote is not evidence. Votes choose next actions; disputed facts use:
W3C/OTel -> official Azure docs/schemas -> official repositories -> field
reports -> explicitly labelled inference.

| Claim / conflict | Reviewer labels | Resolution | Winning evidence |
|------------------|-----------------|------------|------------------|
| Reference-pattern business header wins | R1 Incorrect; R8 Incorrect; R9 Incorrect | Exact prompt names retained | Prompt section 3, local source-of-record precedence |
| Every associated row needs a new span ID | R1 Incorrect; R7 Incorrect; R9 Incorrect | Real-span uniqueness; associated context is not a new span | OTel API/log model, hierarchy 1; Brief 19/24 |
| APIM must forward the whole parent header unchanged while emitting a backend span | R1 Incorrect; R3 Incorrect; R9 Partially verified for pass-through only | Policy preservation, tracer advancement; actual wire graph still VERIFY | W3C, hierarchy 1; APIM docs, 2 |
| W3C universally forbids sampled-bit mutation | R3 Incorrect; R7 Incorrect; R9 Incorrect | Retain stricter local no-promotion test, no false standards claim | W3C sampled-flag rule, hierarchy 1 |
| Standard Key Vault generates random secret entropy server-side | R1 Unsupported; R8 Incorrect; R9 Incorrect | Approved in-memory client-SDK generation/storage | Secret SET schema, hierarchy 2 |
| Literal `contoso-corr-poc-sb` is deployable | R1 Incorrect observed; R5 Partially verified before query; R9 required verification | Freeze legal alias; provider returned InvalidSuffix | Authenticated provider name check, 2026-01-01 |
| Every runtime gate must pass before construction/capture machinery exists | R1 Unsupported; R5 Unsupported; R9 Unsupported | Construction versus completion; bootstrap NOT CERTIFIED | Brief atomic phases, observed dependency semantics |
| SDK-managed consumers prove native Java binding parity | R1 Incorrect; R4 Incorrect; R5 Incorrect | Selected SDK lane only; native qualification separate | Functions/SDK sources, hierarchy 2/3 |
| Parent-safe wrapper is a Microsoft-endorsed GA sampler | R1 Unsupported; R7 Unsupported | Approved Contoso-owned extension; no invented vendor guarantee | Loader/SPI source supports mechanism only, hierarchy 2/3 |
| N failures plus success equals N attempts | R1 Incorrect; R5 Incorrect; R9 Incorrect | N+1 actual attempts; declare terminal outcome | Actual delivery semantics and Brief retry model |

All runtime, privacy, sampling, performance, backend-UX, and owner sign-off
claims remain NOT RUN or VERIFY until their actual evidence is produced.

### Reported local sampler qualification

R7 reported a real pinned-agent/JDK 25 loopback experiment, not fabricated
telemetry rows: Contoso sampler JAR SHA-256
`08592fa4f8fea7b7d259efd2ea38753d9ddc0e9abed05c2e42b62d7bbf2218ce`,
one SPI invocation per process, the upstream ExtensionClassLoader and existing
Microsoft DelegatingSampler, and actual native counts `[2, 0, 2]` across
100/0/100 restarts. The sampled positive probe retained actual native parent
relationships; valid unsampled context remained unsampled with no exported span.
R4 froze the same artifact/ABI/startup argument and reran local guard checks.

This evidence is `real-local-agent-loopback`, explicitly not Azure
certification. It does not establish the full gateway/worker/data path,
Microsoft sampler-specific endorsement, production overhead, or owner sign-off.
Those acceptance clauses remain To Do until the declared live evidence passes.
