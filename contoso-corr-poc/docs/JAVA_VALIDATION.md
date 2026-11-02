# Java implementation and validation

**Status: NOT CERTIFIED.** Construction, a successful local build, and a
bounded sampling lease are not Azure certification or accountable-owner approval.

## Ownership and real integration

R4 owns Maven/version inventory, non-data correlation helpers, Orders and
Inventory HTTP shells, the sampler extension, Java tooling, and compute Bicep.
R6 owns the data subpackage and inventory-data, R8 security-core, and R5
messaging-core and workers. R1 owns composition/decisions and R9 acceptance.

The reactor includes all eleven real modules: correlation-core, security-core,
inventory-data, messaging-core, both APIs, fulfillment, notification,
aggregation, replay, and the sampler. The old construction-header fixture was
removed. No throw-only security/messaging implementation is installed or shipped.
Production factories use the actual verified identity, data, and messaging
implementations. Authenticators, API clients and messaging clients close once;
the messaging port borrows the separately owned PostgreSQL factory.

## Historical local baseline and current qualification limits

The integration baseline completed `mvn -B -ntp verify` on 1 November 2026,
06:13:45 UTC: **all twelve projects succeeded, 136 tests, zero failures or
skips**. Evidence: `evidence\java-local\reactor-verify.log` and `validation.json`.
Per-module counts are 28/29/21/27/14/4/1/1/1/1/9 in reactor order.

R3 subsequently identified targeted-replay correctness finding
`R3-R5-FINAL-01`. R5 corrected it and R3 accepted the local 30-Java/11-Node
runtime/state re-review. **The baseline is not a post-correction or current
source/build-lineage receipt.** Affected artifacts and final acceptance still
require a fresh source-bound build and their current reviews.

The subsequent coherent clean-reactor execution on 2 November 2026 passed
**182 tests across all eleven modules, with zero failures, errors or skips**.
Its [actual build witness](../evidence/java-local/source-builds/20261102T020237806Z-integrated-reactor-bbf3e7ef-36b8-4d66-b009-df47b708d6d3/source-build.json)
records stable before/after source inputs, the observed Maven Java process,
eleven newly created JARs, and the fresh 133-component runtime SBOM.
All eleven production JARs are byte-identical to the earlier 166-test reactor;
the additional tests do not imply a new runtime dependency or provider.
The [support preservation ledger](../evidence/java-local/source-builds/20261102T020237806Z-integrated-reactor-bbf3e7ef-36b8-4d66-b009-df47b708d6d3/support-preservation.json)
binds 59 actual JAR/XML/SBOM/native-metadata copies, including the exact
stdout-located async captures and their original safe inspection sidecar.
All six deployment ZIPs were rebuilt from these artifacts. The
[fresh packaged launch checks](../evidence/java-local/packaged-launch-guards/20261102T021846197Z-14587d8c-bb9e-42df-8ec5-d365bf06928a.json)
verify actual missing-agent rejection for both APIs, the three Functions
entries and replay; these negative controls are not healthy-host checks.
This is a current local build fact, not Azure or full-graph certification.

Other locally executed checks:

- GATE-02 scans every declared module artifact, every dependency scope,
  recursively nested libraries and throw-only construction bytecode. The
  approved extension is not excluded from inspection.
- Ten Java Node controls pass, including SDK/provider, compiler scope/ABI,
  nested-JAR, startup transformation/export failures and deterministic ZIPs.
- Two actual independently agent-attached Boot JVMs authenticated generated
  RS256 JWTs through the real R8 implementation. Orders forwarded the opaque
  business header to Inventory; the actual HTTP CLIENT span ID was the
  Inventory SERVER parent ID. Real JDBC/H2 and Lettuce/loopback-RESP operations
  changed stock **20 → 18**, preserved idempotency, then released to **20**.
  Orders staged and retrieved actual PostgreSQL-adapter workflow/outbox rows.
  The test broker was explicitly unavailable: no broker delivery is claimed.
- `native-api-receipts.json` and `native-api-capture.json` contain received
  native envelopes, with publisher keys and unneeded machine/user identifiers
  removed. This historical baseline did not scan all original payload values
  before projection and must not be treated as current original-privacy proof.
  Technical IDs, parentage and native links are not manufactured.
- R7's earlier parent-guard qualification preserves strict `00`, verifies actual
  native on/off/on counts **[2, 0, 2]**, fixed 0/100, actual RPS 5 and PID/loader
  provenance. This remains local Contoso qualification.
- CycloneDX 2.9.3 generated a validated aggregate runtime BOM with 125
  components under `target\sbom`; it contains no additional SDK, exporter,
  classic AI client or Azure tracing bridge.
- Compute compiles with portable Bicep 0.48.1. Two API, three Functions and one
  replay ZIPs contain the pinned agent/extension outside application libraries.

## Reproduce

From the repository root:

```powershell
. .\contoso-corr-poc\tools\java\Use-Portable.ps1
Set-Location .\contoso-corr-poc
$env:CONTOSO_AGENT_JAR = & .\tools\java\Get-Agent.ps1
$env:CONTOSO_PARENT_SAFE_JAR = & .\tools\java\Get-Extension.ps1
mvn -B -ntp verify
mvn -B -ntp cyclonedx:makeAggregateBom
.\tools\java\Gate-02.ps1 -RequireArtifacts
node --test .\tests\java\gates.test.mjs
.\tools\java\Validate-Compute.ps1
.\tools\java\Test-PackagedLaunch.ps1
```

Re-source portable tools in every shell. Existing checksum-verified
Temurin 25.0.5+8/Maven 3.10.0/Bicep are reused, without global installation.
New scratch files are project-local in `.java-work`; prior tool/cache resources
are preserved. The legacy `BuildStartedAtUtc` argument to
`Write-ValidationReport.ps1` is an observation cutoff with an explicit ISO
UTC/offset; stale or skipped test outputs fail. This convenience reader reports
passing module files, which may belong to different executions. Its v2 output
explicitly does **not** verify one full-reactor execution or a shared source,
test and artifact epoch. Only an independently captured actual clean-reactor
execution with stable source inputs can establish that separate build fact.
Qualification uses a serial reactor without `-T`: Inventory is built before
Orders so the two-JVM fixture loads the freshly compiled Inventory application,
not a leftover target from an earlier build.

The current two-JVM API test bounds original and decompressed payloads, rejects
duplicate fields, and sends the unchanged original bytes to the shared
`tools\security\native-payload.mjs` decoder and credential policy before any
projection or persistence. The API-specific adapter requires its two known
publishers; it does not duplicate the original-value/privacy policy. Exact
publisher keys, JWT/object markers, original-byte hashes, payload/envelope
counts and the actual validator PID are checked. Only scanned projections are
saved; publisher and unneeded machine/user fields cannot hide unsafe original
values. Each original scalar is capped at 4096 characters before credential
pattern evaluation; oversized fields fail rather than stall the checker.
Its focused Node tests are checker controls, not a native or Azure run.
The test-only Node validator installs no telemetry provider.
Only POSTs to the native `/v2/track` and `/v2.1/track` routes are telemetry
payloads. Other HTTP requests receive 404 and are counted separately, not
silently treated as exported envelopes or scanned-native evidence.
An absolute five-second HTTP-body deadline stops this dedicated receiver and
poisons the entire capture, even if an earlier payload succeeded. A real Java
socket test keeps sending bytes continuously and verifies connection closure
and refusal to finalize that earlier prefix; an idle timeout is not substituted.
Before scanning or writing any receipt, finalization seals new admissions,
closes the dedicated listener, and awaits every admitted handler within a
bounded completion budget. The regression attempts finalization while the
second body is still active, before its deadline; the earlier prefix cannot
be approved while that work remains in flight.

Current native API outputs are immutable: each execution creates a new
UTC/UUID directory below `evidence\java-local\native-api`, then writes
`capture.json` and `receipts.json` with `CREATE_NEW`. Collisions fail; historical
fixed-path captures and receipts are never overwritten. The emitted
`CONTOSO_NATIVE_API_RECEIPT` path and its execution/capture hash identify the
actual result. Pass that exact fresh path to `Write-ValidationReport.ps1`
with `-ApiReceiptPath`; its validation output also uses exclusive creation in
the same epoch. No latest-file search or fallback to historical evidence is used.
Packaged missing-agent launch checks likewise emit a new exclusive report under
`evidence\java-local\packaged-launch-guards` rather than overwrite an earlier
run. These negative launch checks do not claim a healthy Azure application.

The test fixture additionally supports the opt-in
`CONTOSO_TRUST_ROOT_OBSERVER=true` for Orders only. A test-source-only,
highest-precedence servlet filter emits the finite contract's actual
`Span.current()` IDs/decisions, process/start/time and public class origins and
class-resource hashes before application/authentication handling. It accepts
only the fixed runner's bounded technical GET `/api/me` controls and never
prints authorization, arbitrary strings, query values or bodies. Unsupported
diagnostic input is rejected with a static code. Ordinary requests without the
case header still run the unchanged authentication/application chain. The
filter adds no provider or production endpoint and never infers an SDK parent
from a header; only matching native RequestData can establish parentage.
Compilation and its four CPU controls do not establish native enrollment or
all-layer trust-root certification.

Mutation responses preserve both identities. `businessInvocationId` is the
current action's ID and matches the response header;
`workflowBusinessInvocationId` is the immutable original workflow ID. Repeated
submissions and controls never overwrite the durable workflow identity.
GET retains the original workflow `businessInvocationId`, independently of the
fresh HTTP request/header ID. The native API test exercises repeated orders,
repeated demo runs, a control action, and subsequent unchanged durable reads.

## Isolated default Netty verification

The user-approved local TLS boundary exercises the unchanged default
`AzureMessagingTransport` business HTTP factory, not an injected HTTP client.
It supplies an explicit fixture credential, not production managed identity.
The test verifies the actual Netty proxy configuration before any SDK send,
permits only fixture authorities and the local native receiver, and creates a
temporary JVM-only trust store. No system trust, hosts file, or Azure resource
is changed. The temporary private key/store is deleted with the owned scratch
directory after execution.

`Run-DefaultNettyWireProbe.mjs` requires explicit `--java`, `--classpath-file`
and `--source-build` inputs plus the pinned `CONTOSO_AGENT_JAR`. The classpath
file is a JSON array of existing runtime JAR paths; the genuine reactor witness
must match all four owned libraries. Test-only read access to the pinned Netty
client configuration fails closed if its expected version-specific shape
changes; it is not a vendor-supported production control.

Both untrusted-CA and trusted-but-wrong-host certificates must fail before an
SDK HTTP request reaches the fixture. The positive case performs actual Event
Grid and Storage Queue SDK sends over TLS, checks the same default Netty
instance in the Queue pipeline, and records the actual used archive/member
origins and executing class/PID. Unchanged original native envelopes pass the
shared strict scanner before projection. Native HTTP CLIENT IDs must match
outgoing wire parents, remain children of the actual PRODUCER IDs, and retain
the same native root trace. Extra W3C trace-flag bits are preserved: the sampled
bit is tested with a mask, not by requiring the complete byte to equal `01`.

The first successful isolated run is under
`evidence\java-local\default-netty\20261102T000941074Z-53628968-45db-487c-8246-b077db6b5193`.
It observed two actual default Netty SDK sends, two TLS-negative cases, and 11
original-scanned native envelopes. Earlier rejected retakes remain separate:
the first blocked native-export proxy routing; the later checker incorrectly
required `01` instead of accepting the observed sampled `03`. No carrier flags,
IDs or parents were rewritten to make the check pass. This finite proof is not
Azure service acceptance, production worker managed-identity wire evidence,
global provider/export completeness, or certification.
The current-source retake under
`evidence\java-local\default-netty\20261102T003448132Z-03cacdc4-c1a6-4666-95a0-5e3ab9a3436f`
also binds all 100 supplied classpath archives before/after, executing tool
hashes/PIDs/UTC times, and the actual compiled probe member. Classpath presence
is not treated as use; the report separately identifies the concrete instances
that performed the SDK sends. Test passwords and tokens are generated at
runtime without static credential literals.

## Compute composition boundary

Compute exposes Orders/Inventory URLs and the Portal origin from each resource's
reported `defaultHostName`; physical names are not substituted for actual DNS.
The root supplies Orders' `CONTOSO_INVENTORY_BASE_URL` through `serviceSettings`
after obtaining the foundation Inventory URL. It must not feed a module's output
back into that same module's inputs within one deployment.

API and Functions main-site ingress deny unmatched requests. Every SCM endpoint
also denies unmatched requests, uses its own approved runner rules, and never
inherits the public Portal's main-site access. The three rule arrays default to
empty; the root must supply approved rules at creation rather than relying on a
later restriction update. Portal main-site access remains public as designed.
`Validate-Compute.ps1` checks the pinned compiler and compiled ARM properties,
parameter defaults and dynamic hostname outputs. These local checks do not
qualify Azure network behavior or grant provisioning/deployment approval.

## Single-agent and sampling boundary

Agent 3.7.10 SHA-256:
`93a70c8f5d364c7e777f6c4d1b235dba91aef8448bd3fa94359f1d7f3e2eb0ec`.
Applications use exposed OTel API/context 1.65.0 and no SDK implementation.
Only the sampler may compile against the approved PROVIDED trace/common/SPI
APIs. No dependency or SDK classes are bundled in that extension.

Current sampler **1.1.0** SHA-256:
`bb829be676bdc86e9a0657391764a419c7665c47542c2e53f64c37761f45193f`.
The user-approved same-provider policy drops a valid unsampled parent, or a
no-parent root whose nonempty linked inputs are all valid and unsampled.
Sampled/mixed linked inputs and unlinked roots otherwise retain the existing
agent's decision.

R5's actual current-byte local retake asserts every required linked-work `00`
output remains unsampled; `01`, mixed and unlinked controls retain their
documented behavior. Each execution emits its exact immutable
`ASYNC_NATIVE_CAPTURE_RECEIPT` locator. The current clean-build support ledger
above preserves that execution's qualification and native proof; no historical
fixed path or latest-file search is used.
This is bounded SDK/carrier/H2 qualification, not Azure, all-role source/build
lineage, identity-header isolation or certification.

The selected sampler report in `config\versions.lock.json` is the permanent
connection-close epoch with actual native on/off/on counts **[2, 0, 2]** and
the independent RPS 5 observation. Its dedicated receiver closes successful
native/echo HTTP connections; every aborted-body, parser, reset and capture
poison rule remains enforced. Three earlier failed receiver epochs remain
failed evidence and were not selected or rewritten.

The earlier `c3f552...` parent-only sampler and its failed linked-root
qualification remain historical, unchanged evidence. Loader observation shares
the supplied `DelegatingSampler`; the shaded loader's `otel:` remapping
connection binds its actual JarFile/class entry rather than an expected/CLI
hash. Earlier empty-hash failures were not converted to passes.

The production profile remains RPS 5. A fixed-100 process requires the immutable
same-directory `contoso.sampling-runtime-lease.v1` contract, exact config/guard
hashes, a canonical service identity and finite UTC bounds. Java admission
counts real guarded work, quiesces at drain time, and has independent
monotonic/UTC expiry shutdown and a hard restoration deadline. No hot sampler,
second provider, or sampled-bit rewrite is used.

`SamplingRuntimeMBean` and `Observe-Sampling.ps1` read actual in-memory sampler,
PID, guard and admission state. Provider/exporter enumeration remains **null**,
not an invented one. Structural ownership and native-export proof are separate.
`CONTOSO_CERTIFICATION_MODE=true` cannot bypass certification requirements.

The APIs attach through one startup-script `JAVA_TOOL_OPTIONS`; selected
Functions use one explicit `JAVA_OPTS`. Platform attachment flags are disabled.
All selected JDBC/datasource/Lettuce/Jedis/Redisson/Azure SDK/Functions bridge
native modules are explicitly disabled. OkHttp, business JDK, Netty/Reactor-Netty
and framework instrumentation stays enabled. Disable overrides, including aliases
and the common instrumentation default, are rejected. Implicit JDK options and
extra exporters fail.

## HTTP, identity and privacy contracts

Orders requires independently verified original `Authorization` and
`X-Contoso-Gateway-Authorization`; Inventory requires the allowlisted Orders
workload token. Actor values are `user`/`workload`, with a user-only
`h1:<32hex-version>:<43base64url-HMAC>` pseudonym.

`CONTOSO_INVENTORY_AUDIENCE` is the actual JWT audience: v2 GUID, or an explicit
supported v1/v2 list. **It is not an acquisition scope.**
`CONTOSO_INVENTORY_TOKEN_RESOURCE` is separately required and supplies only
`<registered-resource>/.default`. There is no fallback, CSV scope or duplicated
`/.default`. Actual signed-JWT positive/wrong-audience tests and credential
scope-list tests verify this locally, not against deployed Entra.
The default Orders-to-Inventory token path uses the shared isolated managed
identity factory; explicit injected credentials remain supported. Its business
HTTP client remains JDK HTTP, separate from the credential-only transport.

One absolute operation deadline survives the HTTP chain. Inventory lookup
bounds token acquisition, scheduling, headers, bounded reactive body reception
and strict JSON parsing. It rejects a changed downstream business ID, foreign
SKU, oversized/ambiguous body and redirect. Structured logs retain safe
instrumentation MDC; SDK/MSAL/Netty diagnostic sinks are OFF and error categories
are finite, without raw exceptions, JWTs, SQL parameters or cache values.

The user-approved identity-only OkHttp transport uses public header controls
while retaining CLIENT spans inside the application. Actual fresh-source wire
observations show no trace/business headers on JWKS and MI retry calls, with
trusted JDK propagation intact. The requested upstream OkHttp disable did not
prevent native context on the unfiltered diagnostic client, so that ineffective
switch was removed rather than presented as isolation proof. Business Azure HTTP
clients retain explicit Netty selection. Current all-attempt wire, source/build
binding, retry, TLS and deadline qualification remains required; an unfiltered
diagnostic client is a negative control, never a production authentication path.

POST `businessInvocationId` is the current action ID and equals the response
header. Its separate `workflowBusinessInvocationId` is the durable original
workflow ID, including repeated submissions and controls. Neither is an
order/run ID. GET preserves the workflow's durable ID, which may differ from
the current ingress response header.

**Observed capability gap:** automatic HTTP CLIENT telemetry does not directly
inherit `business.invocation_id`. Real header continuity, server/manual/log
attributes and native OperationId joins are retained. Microsoft's inherited
attributes feature is explicitly preview and is not added to the certification
dependency path. No expected property is backfilled into native records.

## Reviews and live work

R4's stable R9 source review found acceptance-scope weakening despite an
unchanged backlog hash. R9 regenerated exact authoritative facets/evidence
kinds; the original counterexample is rejected and focused tests pass.
Whole-runtime/catalog review remains limited to the author's ready scope.
Source/local reviews remain distinct from deployed acceptance and accountable
owner approval.

Live qualification still requires deployed image/vendor/worker/instance roster;
Entra/KV/RBAC/ingress;
PostgreSQL/Managed Redis and four real broker delivery/settlement paths;
authenticated Azure ingestion, full native links/ownership; independent
watchdog/restore and overhead/SLO; governance owner approvals and provisioning
authorization. No Azure resource, grant, deployment or global auth changes were
performed, and no card was marked Done by R4.
