# Contoso real asynchronous runtime

This is the one `com.contoso:messaging-core:1.0.0` implementation consumed by
Orders and all four worker modules. It is not a construction stub.

## Frozen API and runtime

`MessagingWorkflowPort.fromEnvironment(PgConnectionFactory)` returns the real
`WorkflowPort` and is `AutoCloseable`. It borrows the supplied PostgreSQL
factory and owns the Azure clients and bounded background outbox dispatcher.
Production API responses do not wait on broker I/O. The two-argument
`MessagingWorkflowPort(MessagingStore, MessagingTransport)` constructor remains
a synchronous integration seam, not a claim of broker delivery.

`PgMessagingStore(PgConnectionFactory, EnvelopeCodec)` uses the shared
`PgOperations` boundary with explicit commit/rollback and no implicit retry.
`MessagingRuntime.fromEnvironment(canonicalServiceName)` owns its factory.
Real SDK receive/dispatch/process/replay/partition work uses
`RuntimeGuard.admitWork()`, not merely the timer invocation.

The production transports are Azure Service Bus, Event Grid CloudEvents,
Event Hubs, and Storage Queue SDK clients authenticated with
the one shared security-core `IdentityHttpClients.managedIdentity` factory.
That is used only where managed identity was already the intended auth mode;
explicit injected `TokenCredential` constructors remain intact. They never
read connection strings. Grid and Storage Queue business REST clients explicitly
select the existing Netty transport; the identity-only OkHttp plugin cannot
silently change business behavior through HTTP provider discovery.
`businessHttpClient()` exposes the actual configured object for bounded
source/wire qualification, not proof that an instance has already sent a request.

The approved `header_isolation_only` mode uses the shared factory's public
REST/network header filters, not an OkHttp native-disable switch. The
source-bound security-core loopback probe observed all seven protected headers
absent on every JWKS/MI attempt, including the MI retry, with trusted JDK
propagation and parent advancement intact. Raw unfiltered OkHttp is an explicit
negative control: native context remains present rather than silently suppressed.

The mode keeps eligible identity CLIENT instrumentation in the same existing
provider. Actual identity CLIENT exports/counts and parent/trace retention
remain unmeasured by the header probe; interceptor presence or `providerActive`
alone does not prove them. Worker managed-identity wire behavior, default
business Netty use and source/build/loaded-instance lineage still need current
qualification. SDK presence, startup flags, unit tests or this finite header
observation do not establish full AV23, factory API READY or Azure acceptance.

`ClientOptions(TracingOptions.enabled=false)` and the pinned agent's explicit
native suppressions leave one semantic instrumentation owner. SDK logging is
OFF and checked before client construction; `HttpLogDetailLevel.NONE` is an
additional carrier safeguard, not the whole privacy policy.

Required non-secret settings:

| Setting | Value |
|---|---|
| `CONTOSO_SERVICE_BUS_NAMESPACE` | Legal frozen alias's `*.servicebus.windows.net` |
| `CONTOSO_EVENT_GRID_ENDPOINT` | Frozen `https://*.eventgrid.azure.net/api/events` |
| `CONTOSO_EVENT_HUBS_NAMESPACE` | Frozen `*.servicebus.windows.net` |
| `CONTOSO_STORAGE_QUEUE_ENDPOINT` | `https://<account>.queue.core.windows.net`, no trailing slash |
| `CONTOSO_DB_ROLE_ORDERS/FULFILLMENT/NOTIFY/AGGREGATOR` | Separately registered fixed database roles |
| `CONTOSO_MESSAGING_MAX_LINKS` | 2–32, default 32; fan-in needs at least four |
| `CONTOSO_MESSAGING_BATCH_SIZE` | 2–link bound, default 16 |
| `AZURE_CLIENT_ID` | Optional fixed user-assigned managed identity GUID |

The managed PostgreSQL configuration is the existing `inventory-data` factory
contract. The worker schedule is supplied by root compute configuration.

## Envelope, provenance and effects

`contracts/message-envelope.v1.json` is strict UTF-8 JSON, at most 32,768
bytes before optional Queue Base64 encoding. Trace context is parsed by the
W3C propagator, never for log correlation. Business, message, causation and
workflow identities are separate UUIDv4 fields. Unknown/duplicate/missing/
coerced/oversized fields fail closed. Invalid context is a declared root with
a finite rejection category; no rejected header/body is logged.

Service Bus uses `Diagnostic-Id`, `tracestate`, `business.invocation_id`,
`message-id` and `causation-id`, plus native MessageId. CloudEvents use
`traceparent`/`tracestate`/`businessinvocationid`/`messageid`/`causationid`
extensions; the CloudEvent ID is the message UUID, not a trace ID. EventData
properties and Queue JSON carriers enforce the same immutable identities.

Fixed entity permissions plus exact protected publication records establish
the closed boundary. `publisher`, `owner`, `creator` and `receiver` defaults
come from PostgreSQL `CURRENT_USER`, not claimed producer fields. Runtime
grants **must exclude** these columns from INSERT/UPDATE. Publication and
contributor rows are immutable to workload writers. The canonical-envelope
SHA-256 is private integrity matching, not a pseudonym, credential, metric or
telemetry field. Authorized-writer/receiver compromise remains a limitation.

Separately authorized migration: `db/messaging/V002__messaging.sql`.
There is **no startup migration or grant**. Its eleven tables are
`async_workflow`, `async_fault`, `async_outbox`, `async_publication`,
`async_inbox`, `async_attempt`, `async_effect`, `async_contributor`,
`async_checkpoint`, `async_replay`, and `async_quarantine` in `contoso`.
Exact installation, target marker, principal creation, grants and purge belong
to the approved R6/R8/root bootstrap, not application startup.

Every received attempt has a fresh PROCESS span and durable attempt ordinal.
N injected failures followed by success are N+1 deliveries. Broker locks are
renewed and settlement is serialized; Queue pop receipts rotate and the
latest receipt is used. Effects, contributors and result outboxes commit
together. Uncertain settlement cannot undo committed effects; redelivery is
idempotent. Database fencing prevents a stale worker or outbox sender from
settling newer work.

`RunControl.target` scopes faults to actual named branches/transports. Pause
is effect admission, not a claim of indefinitely suspended broker deliveries:
paused/busy receives are abandoned and real broker delivery counts/TTL still
apply. Use bounded controlled pauses; actual excess redeliveries must be
reported, not hidden.

Replay creates one durable new message/outbox before completing the original
DLQ delivery. It retains business identity, records the original message and
causation, and starts linked new work. The actual publisher is the owning
Fulfillment/Notification managed identity, never impersonated Orders.

Replay requests are persisted per target and checked again under the workflow
transaction lock for the exact DLQ source. `ORDER`, `FULFILLMENT`, `NOTIFY` and
`STORAGE_QUEUE` select respectively orders DLQ, Fulfillment subscription DLQ,
Notification subscription DLQ and legacy poison. `SERVICE_BUS` selects only
the three Service Bus DLQs. `AGGREGATOR`, `EVENT_GRID` and `EVENT_HUBS` replay
targets are rejected before state mutation in this selected replay lane.
Unrelated branch faults/global pause are not cleared. Shared-topic replay
still physically broadcasts, but protected replay-source state makes
non-target subscribers settle without domain effects. Replay deduplication
is per original message **and source**, not one cross-subscription record.

Fan-in waits for both protected branch effects **and both accepted result
receipts**. It creates an INTERNAL root with four native links: both PROCESS
contexts and both actual received result SEND contexts. It never chooses an
arrival-order parent or truncates links. Mixed Event Hubs batches are
root-with-bounded-links plus durable per-item PROCESS work. The batch receive
ordinal is persisted in the partition checkpoint, including empty polls;
per-item attempt ordinals are independently durable. Poison records retain
only actual partition/offset/sequence and a finite category, not raw context
or payload. Checkpoints advance only after durable outcomes/quarantine.

Publication validation's PostgreSQL read is a deliberate pre-trust root with
a fresh opaque lookup identity; it does not pretend to have authenticated the
claimed context before reading the protected record.

## Build and qualification

```powershell
. .\contoso-corr-poc\tools\java\Use-Portable.ps1
Set-Location .\contoso-corr-poc
$env:CONTOSO_AGENT_JAR = & .\tools\java\Get-Agent.ps1
$guard = (Get-Content -Raw .\config\versions.lock.json | ConvertFrom-Json).extensions |
    Where-Object artifactId -EQ 'contoso-parent-safe-sampler'
$env:CONTOSO_PARENT_SAFE_JAR = (Resolve-Path (Join-Path .\extensions\parent-safe-sampler $guard.file.Replace('/', '\'))).Path
mvn -B -ntp -f workers\messaging-core\pom.xml test install
node --test tests\messaging\async-honesty.test.mjs tests\messaging\contracts.test.mjs tests\messaging\infra.test.mjs
```

`AsyncNativeAgentTest` executes `AsyncNativeProbe` under the one hash-pinned
agent/extension and independently collects actual native AI envelopes at a
loopback endpoint. It checks retry IDs/parentage/ordinals, new linked replay,
four-link fan-in, mixed-context links and seven real H2 effects. Safe scalar
output is `target/native-agent/native-proof.json`. Its scope is **actual
agent/API export + H2 + an in-memory SDK-carrier fixture**, one actual canonical
cloud role. It is not Azure broker, Functions host, multi-JVM role, MI/RBAC or
certification proof.

That fixed-path receipt and the earlier fixed-path
`target/linked-root-sampling/1.1.0/qualification.json` are historical functional
evidence. Their receiver did not establish original-first privacy or bounded
native intake; later source corrections do not retroactively qualify them.

The supporting tests now use the test-only `NativeTestCapture` adapter:
1-MiB original/gzip-decoded bodies, 4-MiB aggregate raw **and decoded** bytes,
16 payloads and 512 total envelopes per complete execution. Linked sampling
keeps one cumulative capture across all three vectors; it does not reset a
session to evade a bound. JSON/NDJSON uses strict duplicate detection, fatal
UTF-8, depth/key/scalar bounds and actual generated publisher membership.
Carriers and decision controls have separate bounded, exact schemas.

Before any native projection or proof persistence, the same original packets
go over stdin to security's generic `Scan-NativePayloads.mjs` port. The adapter
checks the actual Node PID/executable bytes, current CLI/module/shared-policy
hashes before/after, every original-packet SHA/byte/envelope count and complete
original scan receipts. Explicit synthetic token/OID markers also apply to
fields that projection would remove. Errors are fixed codes, not raw payloads
or child diagnostics. Generic privacy checks do not attest a telemetry producer
or prove global capture completeness.

New outputs use CREATE_NEW under
`target/native-agent/epochs/<UTC-UUID>/` and
`target/linked-root-sampling/1.1.0/epochs/<UTC-UUID>/`.
`ASYNC_NATIVE_CAPTURE_RECEIPT` on test stdout supplies the actual path and SHA;
consumers must not substitute old fixed-path files. The actual IDs, kinds,
parents, contributor links, state assertions and `00`/`01`/mixed/unlinked
decisions remain assertions on observed output, never invented fields.
The original-safe intake source epoch `native-intake-source-freeze.v2.json`
was subsequently compiled and executed by the coordinator: selected-module
40/40 tests, including eight intake units and two native tests, with seven
JUnit XML suites. The retained `d8107119…` build and `cdc8441f…` /
`37c68a92…` native receipts remain immutable. That native proof contains
only the actual Fulfillment cloud role; it does not prove Notify execution.

### Notify replay native construction

The newer **test-source-only** Notify facet retains the original Fulfillment
probe and then launches three sequential, separate one-agent JVM phases:

1. Fulfillment publishes an actual SDK-carried topic message and processes
   its subscription to the DLQ with two production attempts.
2. Notify processes its own subscription to `NOTIFY_DLQ`, runs the production
   `ReplayProcessor` with the Notify store, publishes the replay through the
   production outbox, and commits exactly one Notify effect.
3. Fulfillment receives the same new replay from the other topic subscription
   and settles `SKIPPED_TARGET` before an inbox/effect. Its original DLQ,
   pause and failure budget remain unchanged.

A project-epoch H2 file and SDK-carrier queue connect the sequential phases;
no extra server, broker span, provider, SDK or credential is introduced. H2
tracing is disabled and the fixture database is removed in `finally`; raw
native originals remain memory-only. Fixture principals are not Azure/RBAC
evidence. The two replay roots each link
the actual original producer independently; replay PROCESS message attributes
are not invented, and SEND is not parented to replay PROCESS.

The actual native role tags must include both `contoso-fulfillment-worker`
and `contoso-notify-worker`. The existing receipt prefix, three receipt keys
and output basenames stay unchanged. `nativeChildren` records actual child
PIDs/configured phases separately from native rows;
`notifyReplayRuntimeResults` holds bounded, sealed observations of the actual
fixture state, not synthetic native attributes. The proof additionally binds
the actual `native-safe-inspection.json` bytes using
`nativeSafeInspectionSha256`.

The shared capture limits and original-first policy are unchanged across all
four child JVMs. The first Notify source epoch `d324922a…` was actually compiled (15 test
sources) and its selected 13 tests ran: one failure and one error. The fixture
incorrectly expected ordinary ORDER inbox `source_publisher` to be populated;
production populates that field only for accepted RESULT/AGGREGATOR receipts.
No H2 capitalization or actual failed-row value is inferred from that error.
The failed four-XML bundle remains under `evidence/java-local/notify-native-failures/`;
the separately successful linked-root test is not a successful combined run.

The corrected fixture keeps the protected principal checks: an actual typed
`SELECT CURRENT_USER` on the Notify factory connection must match the effect
owner, inbox receiver, and **exact** protected publication publisher for the
replay message, topic destination, canonical envelope hash and JSON bytes.
The ordinary ORDER inbox's result-only `source_publisher` must remain null;
it is never filled or treated as the publication record.

This corrected source is **not yet compiled or executed**.
The coordinator must explicitly retake
`NotifyTopicReplayFixtureTest,NativeTestCaptureTest,AsyncNativeAgentTest,LinkedRootSamplingTest`;
source/Node checks alone cannot close the two-actor native gap. Existing
40/103-span, linked-sampling and older 32/166 receipts are not rewritten or
promoted. This facet does not expand the other demo scenarios or establish
Azure broker/Functions/MI/global privacy coverage.

Observed pinned-agent gaps are retained, not papered over: semantic
`messaging.message.id`/`messaging.operation.name` do not appear as AI custom
properties; actual `contoso.message.id`/branch/attempt/workflow/kind do.
Consumer item names can inherit the batch operation's name. Native parent IDs,
links and actual safe attributes distinguish root and children; expected
names/roles/IDs are never substituted into observations.

`assertAsyncStructure`/`assertLinkedAggregation` are structural helpers only.
The legacy `assertAsyncEvidence` intentionally refuses standalone origin
acceptance. R9's independently source-bound carrier/state/native pipeline
must gate the usable structural checker in demo/certification paths.

**NOT CERTIFIED.** Azure provisioning/cost/quota approval, actual principals/
grants, broker settlement/restart/DLQ/relay delivery, Functions host/extension,
current sampler hash/loader/strict-unsampled vectors, exported full-role graph,
all-table privacy, retention/purge and owner sign-offs remain evidence-gated.
