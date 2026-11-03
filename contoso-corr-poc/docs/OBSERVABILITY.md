# Contoso observability implementation / integration

## Owned executable interfaces

- `infra\modules\telemetry.bicep`: Root `names.law/appi`, centralus, retention,
  LAW daily cap, approved monthly telemetry budget, R8 action-group IDs,
  optional workbook JSON; outputs only identifiers/configuration, no secrets
  or role assignments. Root cost/provisioning remains separate.
- `extensions\parent-safe-sampler`: same-provider immutable JAR; R4 registers
  artifact/ABI/hash and startup loader. See its real probe README.
- `tools\observability\kql.mjs`: three current plus three separate legacy query
  templates → fully bound KQL, query/root-map hashes. Root's sole topology is
  `contracts\expected-boundary-map.v1.json`; observed assignments have real IDs
  and evidence hashes, not values copied from an expected graph.
- `telemetry-contract.mjs`: native span/log/view/event/link normalization and
  sampling acknowledgement validation. R8 pre-persistence privacy disposition
  is required; physical span duplicates remain; unsupported link fields null.
  Normalization **never grants certification**, even for authenticated source.
- `workbook.mjs --write|--check`: generated Notebook/1.0 artifact, hashed source
  map, validated expansion; native Azure import/render/screenshots still needed.
- `sampling-controller.mjs`: enter/hold, restore, independent watchdog;
  `contracts\sampling-window.v1.schema.json`. `LocalValidate` never certifies;
  BootstrapValidate/Certify require complete hash-pinned apply/observe/restore
  hooks and every layer. The `Certify` name grants no auth or certificate.
- `load.mjs`: bounded approved real HTTP and exact-PID process measurement;
  process CPU seconds/working-set sampled by `process-metrics.ps1`. Missing
  metrics stay null and fail/inconclude, never default0.
- `runtime-lease.mjs` / `runtime-adapters.mjs`: immutable startup lease,
  actual owner-runtime observations and bounded web control-body projection.
  Apply/restore use controlled process restart or document reload, not a hot
  sampler setter. Actual revision/configuration/time/admission come from the
  initialized owner instance, never from the requested patch.
- `raw-query.mjs`: six-table graph-intake capture, original-column R8 scan,
  query-text manifests and private source-bound response/capture identities.
  JSON labels, hashes, clones and injected fixtures cannot mint native identity.
  R9's empty observer registry currently blocks Azure source acceptance.
- `local-trace-tree.mjs`: browser/JVM capture merger for **LOCAL REHEARSAL**
  (OBS-02.2). It reuses the bounded loopback intake, preserves actual IDs and
  parents, and runs the unchanged GATE-08 invariant library. Its named local
  profile excludes only `gateway.request` and `gateway.backend`; the untouched
  full-chain assertion must still fail on those missing hops.

### Local rehearsal trace tree

After the local pair and browser driver have produced their actual captures,
run from the project directory (replace the paths and invocation):

```powershell
node .\tools\observability\local-trace-tree.mjs `
  --browser .cache\local-run\browser-evidence.json `
  --browser-telemetry .cache\local-run\browser-telemetry.ndjson `
  --jvm .cache\local-run\telemetry.ndjson `
  --invocation 11111111-1111-4111-8111-111111111111 `
  --profile LOCAL_REHEARSAL `
  --controls seeded `
  --output-directory .cache\local-run\merged
```

The browser file uses the existing schema-1 local browser evidence contract:
one successful `POST /orders` observation, its SDK dependency identity and
context-not-span receipt. NDJSON inputs contain sanitized original
`RequestData`/`RemoteDependencyData` envelopes, including actual UTC time,
role, operation ID, span ID and parent ID. The browser dependency envelope
is mandatory; a wire carrier or context receipt alone is not a span.
No missing IDs, parent relationships, roles or Gateway spans are fabricated.
Unrelated invocation records and non-span records are counted, not represented
as extra spans. Split traces within the selected invocation, duplicate span
exports, broken edges and missing local hops fail.

Output includes the printed tree, A/B/C results, explicit expected-remote
boundaries, map/profile/source hashes and the deliberately failing full-chain
check. `--profile FULL_CHAIN` instead requires the actual Gateway hops.
Both profiles remain local structural checks, never GATE-08 native acceptance.
Saved files are labelled `SAVED_CAPTURE_STRUCTURAL_CHECK_ONLY`; JSON or cloned
receipts cannot recreate the receiver's in-process local provenance. Mixing
any caller-supplied browser/JVM envelopes with an original receiver capture
downgrades the entire merge to this structural scope (`fixture-check` rows).
An empty original capture cannot lend provenance to caller-only spans. The real
loopback intake scans originals before projection and closes before returning
a capture. It adds no telemetry provider or second exporter.

The existing receiver also accepts an optional numeric `port` (default `0`,
always bound to `127.0.0.1`) and async `onCapture(capture)` callback. Each
callback receives only the newly scanned, immutable safe envelopes and their
payload receipt, before HTTP acceptance. Callback errors or the fixed
five-second callback deadline poison the capture. A streaming NDJSON file is
provisional until `finish()` succeeds; a previously written safe fragment is
not a completed capture after any later receive/callback failure.

`--controls seeded` also checks copied inputs with a split trace, duplicate
span, wrong parent and each missing local hop. Every control must produce its
expected failure code. Originals remain unchanged. These are labelled seeded
checker mutations, not runtime fault injection or additional application runs.

Focused source/seeded-failure and actual HTTP-intake checks:

```powershell
node --test --test-reporter=tap .\tests\observability\local-trace-tree.test.mjs
```

These tests send synthetic envelopes through a real loopback socket. Their
passing result does not establish a current browser/JVM local-pair run, an
Azure query, a native collector enrollment or certification.

### Native adapter handshake

`contoso.sampling-adapter-request.v1` contains layer/id, operation/revision,
runtime target and **owned** patch, frozen guard hash/ABI/provider, no secrets.
An approved hash-pinned command gets that request-file path as its final argv.
Observe is read-only. Live acknowledgement is
`contoso.sampling-control-ack.v1`: layerId, revision, owned-config SHA256,
percentage/RPS, guard presence/hash where required, provenance
`trusted-runtime-observation`, no SDK/provider/exporter/privacy construction
or secret values. File adapters return local-config status only.

Interpreter hooks pin `codeFiles` (entry point/dependencies), reject inline
evaluation and clear implicit Node/Java launcher options in their child
environment. An executable hash alone is insufficient. Requests include
immutable `lease`/`leaseFile`, actual role, issued UTC, owned-field CAS hash
and safe baseline. Canonical hashes recursively sort object keys, preserve
array order and use `{"$contosoAbsent":true}` for missing fields. Failed hook
output is discarded, not copied into errors or evidence.

Unsupported global provider/exporter enumeration stays null, never one.
Finite local/bootstrap activation may prove actual control effects while
`ownershipPending=true` / `certificationEligible=false`; independent
launch/dependency/startup/SPI/native-export ownership and full-path evidence
remain separate gates. `Certify` requires a trusted prerequisite verifier for
the actual roster/current gates. The CLI has no implicit verifier/enrollment.

Production restoration invokes the same full safety validator as activation;
unsafe/omitted privacy/provider/exporter/secret flags never satisfy restoration.
The independent watchdog schedules drain at **expiry minus120 seconds** for
native plans. Their traffic interval must leave that reserve; a120-second
load needs a longer lease. Local checker plans can explicitly use a shorter
drain interval and never assert live drain proof. Native traffic owners require
`stopTraffic` hooks and `contoso.sampling-drain-ack.v1` (no new synthetic work,
zero in-flight work, safe runtime provenance). Failed drain remains nonpassing
even when owned configuration fields were restored.
Drain adapters share sampling ACK origin/layer/instance and observed-role
checks, and reject contradictory ownership/privacy/provider claims. A genuine
expired or restored runtime may acknowledge stopped admission and zero work
without an active sampler or the old leased configuration; file/management
observations, foreign leases and stale observations still fail. Missing global
ownership evidence is not supplied by this local control acknowledgement.

SSR's configured production base percentage is preserved below100, matching
R2's actual initialization ABI; validated CERT window fields derive effective100.
Activation checks completion after hooks/persistence against drain-start/expiry.
Restore's primary deadline is the **absolute lease expiry plus its approved
restore budget**, not a fresh allowance after a delayed drain/lock. Late recovery
can restore best-effort but records a missed cutoff and is nonpassing.

The drain journal is resumable per inventoried participant. An attempted flag
is not completion: recovery resumes missing/unsafe acknowledgements, checks
every traffic owner plus a completed marker, and only then can restoration
satisfy the predicate. Interrupted-mid-drain persisted-state controls and
partial-native-ack rejection are part of the focused owner regression suite.

Journal ownership is now a fully published immutable hard link, with exclusive
dead-owner recovery records fencing competing recoveries. There is no empty
directory/owner-file publication gap. Duplicate enter cannot rewrite the
original rollback journal. Narrow, bounded Windows sharing-error retries
cover journal/config reads and atomic replacement; permanent I/O/schema
failures remain errors. Unowned legacy locks require explicit owner recovery.

For Java JSON the controller clears stale RPS before percentage100. Browser
runtime paths match R2's `telemetry`/`certification`/`demos`; SSR environment
keys match `CONTOSO_SERVER/BROWSER_SAMPLING_PERCENTAGE` and finite CERT window.
APIM body/capture keys match the all-API diagnostic; host/backend normalized
manifests require the owner-supplied actual native command/ack before live use.

No script implicitly creates Azure resources, grants roles, increases quotas,
retrieves credential bags or installs global tools. Azure-capable hook execution
requires a separate explicit approval/caller opt-in; it is not run by this
local preparation. Generated runtime/request/cache files stay under project
`.cache`/approved runtime paths; no OS Temp or `/tmp` operations.

## Focused local validation

Use existing R4 portable tools, without a global install:

```powershell
. .\tools\observability\Use-Portable.ps1 -ToolsRoot <existing-R4-tools>
$env:CONTOSO_AGENT_JAR = <pinned-3.7.10-agent>
$env:CONTOSO_BICEP_EXE = <existing-bicep.exe>
& $env:CONTOSO_MAVEN_EXE -s $env:CONTOSO_MAVEN_SETTINGS -B -f .\extensions\parent-safe-sampler\pom.xml package
node .\tools\observability\probe-parent-safe.mjs
node .\tools\observability\test.mjs
node .\tools\observability\Render-KqlChecks.mjs
.\tools\observability\Validate-Kql.ps1
node .\tools\observability\workbook.mjs --check
```

Restore only after a missing-dependency failure. The existing compiler was
previously restored privately, hash-pinned
Microsoft.Azure.Kusto.Language **12.4.1**, from Microsoft's public package
mirror after NuGet TLS failure. It analyzed all six rendered queries against
the documented source schema. This is compiler/checker proof, **not live LAW**.

Historical core validation: **55 Node tests passed, zero skipped**, including
actual portable Bicep compilation, interruption/expiry/partial rollback,
real Windows `FileShare.None` contention and actually interrupted child-PID
lock recovery. **38 rendered Kusto analyses passed** for that snapshot: six current/legacy
procedures,24 raw schema/count/key/page queries and all eight workbook
expansions. These are local compiler/checker results, not deployed-schema gates.
The later `9fa00880...` postfix snapshot executed **65 Node tests and39 Kusto
analyses**, including the ninth conditional-root workbook query and committed
workbook drift-check against `aefab352...`. These results apply to their recorded
source/dependency closure; subsequent input changes require fresh before/test/
after validation and current reviews, never a rehash of the earlier PASS.

R6's subsequent CODE cross-review corrections are implemented and owner-tested:
complete production-ack safety parity; preserved R2 SSR base below100;
pre-expiry drain scheduling; absolute expiry-plus-budget recovery failure;
post-hook activation checks; resumable per-owner drain completion after crashes.
Reviewer source/hash recheck is separate from local results; no automatic
card or live approval is implied.

The historical eight-second activation failure cannot be attributed exactly:
the old test discarded controller output. Its isolated run passed, while the
controller suite separately reproduced failed watchdog restoration. New
deterministic regressions proved duplicate-entry journal loss, the old
ownership publication gap and actual Windows sharing errors; these are fixed
without increasing the original activation timeout. Safe state/heartbeat
diagnostics now distinguish failed activation from a test merely waiting.

## Source-safe capture and browser context

RAW capture includes every original column of six App* graph tables under one
component scope and immutable ingestion watermark. Partial HTTP200 errors,
warnings, missing schemas/columns, short pages, changed counts, late ingestion
and unwatermarked rows are nonpassing. Multipage capture requires an actually
discovered, nonempty, exactly unique native `_ItemId`; duplicate trace/span
records remain separate physical rows. Without a stable key only a bounded
single page is accepted. Unordered Kusto dynamic-bag string serialization is
never a pagination identity.

Actual R8 `scanPrivacy` runs on original table columns/rows in memory.
`assessmentScope=graph-intake` may approve the sealed slice while
`tableInventoryComplete=false` / `globalTelemetrySafetyVerified=false`.
It cannot close the all-table privacy gate. Originals and publisher keys stay
in memory; only approved normalization is persisted. Whole-row/page digests
follow the original privacy scan. Pre/post canaries bind an owner ledger;
`droppedSpans=null` because queries alone cannot prove exporter loss.

AppPageViews `Id` is an opaque display/context identity, not a request/dependency
span. Actual SDK3.4.5 local capture used a32-hex view ID and exposed no context
span ID. Normalization preserves it without minting a span. Orphan KQL indexes
browser parent context only with separately source-located SDK-context/
outbound-carrier proof; default missing proof remains a candidate. R9 verifies
the artifacts independently of the expected map.

Historical1.0.0 pinned real-agent probe at `c3f552d170f599a625ef25a2974e32ccc9215fa849038d49aad654d8c53a9ee7`
passed on/off/on with actual native span counts **2/0/2**, strict00 wire identity/
parent advancement/non-export, native fixed0/100 and actual RPS5 observation.
Ten rate observations remained read-only. The initial guard hash was actually
empty under the SDK's shaded `otel:/` loader; R4 qualified its actual backing
JarFile/entry provenance, never copying the expected hash. Reports:
`extensions\parent-safe-sampler\target\agent-probe\result.json` and
`native-sampling-observation.json`. All remain local-only, **NOT CERTIFIED**.

The subsequent actual c3 linked-root00 experiment failed the literal
Matrix#2 vector: ordinary-parent00 stayed0/non-export, but no-parent
replay/result/fan-in/batch became1. Its `b81339...` qualification is retained
by R9 as historical failure, never replaced with a pass label. The user
explicitly authorized same-provider guard1.1.0 to DROP roots with nonempty
all-valid/all-unsampled links while sampled/mixed/invalid/unlinked sets keep
the existing delegate decision. New native ACKs/leases require actual
version1.1.0, policy
`DROP_VALID_UNSAMPLED_PARENT_AND_ALL_VALID_UNSAMPLED_LINKS` and the sole current
lock hash. Actual native00/01/mixed retake is required; oldc3 evidence does not
qualify the new artifact.

The actual1.1.0/BB829 byte-frozen R5 retake subsequently asserted required
linked00 outputs unsampled and unexported, ordinary00 same-trace/export0,
and preserved actual01/MIX/unlinked delegation. Its new `a0eb3028...`
qualification is separate from untouched historical `b81339...`. Consumer00
still had41 unrelated/unlinked native rows; this is **not**100%-fidelity
export of the strict00 workflow.

R7 completed and explicitly released the third ordered1.1.0/BB829 window.
Its2026-11-01T10:04:16Z report observed ordinary on/off/on **2/0/2**,
fixed0/100, actual RPS5 and ten read-only observations with actual
MBean guard policy/version/hash, child PID and backing-JAR provenance.
Report: `extensions\parent-safe-sampler\target\agent-probe\1.1.0-bb829be676bd\result.json`,
SHA-256 `6bfa1d1e8904e795b22b161ca80cb08663ff0c63b5b7a607296e500c4a5d687e`;
`native-sampling-observation.json` SHA-256
`fd5d6931f8f3b54a87332fb0c99a82747623160e1e9bad65a881acc853916c8a`.
This is local ordinary/JDK sampling-control qualification, not complete
role/matrix coverage, global provider/exporter ownership, identity-header
isolation or owned Core/Data source/build lineage. Unknown global counts
remain null. The separate R9 selected-binary103-span algorithm likewise
does not establish source/build/loaded-code lineage.

The initial `approve_okhttp` scope included identity-only official Azure
OkHttp SDK transport/public controls and narrow native exclusion. The
subsequent fresh security-only A witness `67fbfe67...` and parent B observed
protected JWKS1/MI2 physical requests with all seven context/business headers
absent, two logical SDK sends, actual used wrapper/delegate origins and
trusted JDK propagation/parent advancement intact. However, raw unfiltered
OkHttp still propagated native context despite the disable setting.
`services\security-core\docs\av23-java-okhttp-parent-20261101T170633366Z.json`
remains an unchanged overall **FAIL**, separate from historical `990a9b06...`.

The user then selected `header_isolation_only`: remove the ineffective
native-disable switch, retain identity CLIENT spans inside the application,
and enforce proven public header isolation on every protected identity
wire attempt. The raw unfiltered transport remains an explicit negative
control with native context expected; its observations are never dropped
or relabelled as suppressed. Logical sends and physical retries are
reported separately. The AV23 protected-path no-headers requirement is
unchanged; no flag repair, sampling suppression, masks, extra provider or
scope waiver is authorized. Existing sampling decisions remain unchanged.
Business JDK/Netty/Reactor propagation and default/injected/operator modes
must remain protected.

Historical FAIL reports are not promoted under the new decision. Updated
source and any fresh selected-module A build require a separately granted
B retake without `--okhttp-exclusion`, actual used-source/package binding,
all-attempt protected-header checks, raw negative control, trusted positives
and independent current reviews before API_READY. None of these local
slices certifies unused Core/Data/workers, full-path fidelity or Azure.
Further native/Maven execution requires a coordinator-granted serial
window; cloud provisioning, spend and grants remain unapproved.

## Original-safe sampler intake — source preparation

`probe-parent-safe.mjs` and `measure-parent-safe.mjs` use the shared R8
`tools\security\native-payload.mjs` session through
`tools\observability\sampler-native-intake.mjs`. Each actual JVM gets its own
loopback receiver, known fixture publisher, exact forbidden markers and one
non-resettable session. Only exact `POST /v2/track` and
`POST /v2.1/track` requests enter native capture; the separate `GET /echo`
control is not telemetry.

The receiver bounds the body while reading, before concatenation, with a
fixed five-second absolute deadline and a maximum of eight connections.
The shared port enforces 1MiB raw and decompressed bodies, strict decoded-key
duplicate rejection for JSON/NDJSON, UTF8 keys128/scalars4096, depth32,
512 envelopes per body and fixed session limits of128 POSTs,16MiB raw and
decoded totals,8192 envelopes and1,048,576 parsed nodes. These are safety
ceilings, not a promise that an unmeasured exporter cadence fits. There is
no session rotation, caller limit waiver, truncation or partial-success
fallback.

Every original value, including non-span envelopes and subsequently omitted
publisher/machine/user metadata, passes the shared policy and exact-marker
checks before projection, span selection or native evidence persistence.
Wire/decode/privacy failure poisons the complete JVM intake; previous good
rows cannot produce a partial PASS. Finalization closes the receiver and
awaits in-flight requests before exposing the scanned projection. Receipts
retain original wire hashes/counts, actual validator PID/source and declared
input-check scope, never raw bodies or publisher values. Zero observed
payloads have an explicit unverified-empty record, not a fabricated privacy
scan. `allTablePrivacyGateVerified` and producer/certification authority
remain false.

Future executions write exclusive fresh epochs. Default output is an
execution-ID subdirectory beneath the version/hash probe or approved-load
directory; probe `--output` or load `CONTOSO_OBSERVABILITY_OUTPUT` must name
a **new** directory. Existing directories/files are rejected, not replaced.
This does not update Root's locked Gate02 report selection: the parent must
explicitly preserve/select any later native epoch. The actual post-clean
parent probe and historical reports are not rerun or requalified by this
source-only preparation.

The ordinary2/0/2, RPS5,00 carrier, native ID/parent, same-provider ABI,
checksum and loader assertions are unchanged. New source/CPU checks do not
reexecute Java or establish loaded-runtime/privacy authority. A separately
granted parent native retake and independent original-role source reviews
remain necessary.

### Safe failure stages and echo contract

The parent's first actual strict-intake retake of the reviewed `9d24...`
source failed during `eligible-on`. Its immutable
`original-intake-20261102T004653210Z-76cede49-c6e8-44b6-938d-caf808074149`
epoch retains the actual BB/1.1/ABI1.65 sampler observation, effective100,
RPSnull and child PID53672. The old catch omitted its cause/stage: neither a
sampling/byte failure nor an echo regression is established by that record.
It is not a new native PASS and must not replace the selected Gate02 proof.

The diagnostic successor always writes exclusive `failed-observation.json`
with a fixed stage and static reason code, bounded numeric context and safe
sampler scalars. It never writes raw error messages, assertion values,
stacks/causes, child stdout/stderr or arbitrary URLs. The rethrown diagnostic
contains only the fixed stage/code; it does not silently erase the failure.
Native-intake errors retain their shared static reason, while native-count,
wire/SDK-state, startup and shutdown assertions remain unchanged.

The reviewed receiver already returns
`x-contoso-observed-traceparent` from the actual incoming header after the
echo callback. Source/CPU regression checks exercise both01/00 and missing
input against `ParentSafeProbeApplication.java`'s actual header name and wire
acceptance pattern; they do not compile/run Java or prove the failed
runtime's cause. Scoped native selection still includes both SERVER/CLIENT
records for the actual sampled and unsampled request traces: a related00
export remains a count failure, not a filtered-away success. Only a new
parent-authorized immutable native epoch can qualify this successor.

The parent's subsequent actual `cdb6...` retake also failed `eligible-on`,
now at `native-intake` with `NATIVE_RECEIVER_INCOMPLETE`, child PID60396.
Its `diagnostic-retake-20261102T011520125Z-071ca232-9cb1-4d21-afb0-6b04828adc4d`
epoch observed HTTP200 and actual echo/carrier-presence/carrier-validity all
true. That disproves the echo hypothesis for this run, not the remaining
receiver cause. No sampling flag, SDK class or byte-policy change follows
from it, and neither failed epoch is a selected Gate02 success.

Receiver diagnostics now preserve the **first** poison event separately
from its public fail-closed code: `receive`, `parse`, `finish`,
`clientError`, `drop`, `serverError` or `close`, with a static underlying
code and listening/closing/closed state. A pending-finish barrier remains
an error without inventing a permanent poison; later cleanup errors cannot
replace an earlier cause. Error-code/message descriptors are read without
invoking accessors or proxies. Only fixed method/route classes, bounded
numeric declared length, observed/accepted byte-payload-envelope counts and
pending counts are retained. Raw URLs/queries, headers, packets, bodies,
error messages, stacks and causes are never diagnostic output.

The eight-connection ceiling, all poison conditions, absolute body
deadline, original privacy policy, pending-close barrier and native
assertions are unchanged. Metadata remains diagnostic-only, not producer
authority, exporter completeness or native qualification. Source/CPU
controls distinguish actual loopback parser-error/drop events and
synthetic read/parse/close/finish failures; only the parent's next granted
immutable native run can identify the actual preceding receiver cause.

The parent's third actual attempt,
`receiver-cause-20261102T013548273Z-25337df5-f58b-443f-9fc8-8e82bb5e12b9`,
preserved outside `target`, identified `clientError / ECONNRESET` while
listening, after two accepted payloads/four envelopes and with no pending
receives or drops. Echo and sampler observations remained good. This
identifies the reset event, **not** which socket or an idle-keep-alive cause.
All three failed epochs remain failed and unselected.

The bounded lifecycle successor uses the public `Connection: close` header
on successful native and echo responses, matching the existing rejected-route
close behavior. It does not ignore resets or clear a poisoned prefix.
Actual Node HTTP CPU controls check orderly response/socket completion with
a keep-alive client and verify that an aborted unfinished native upload
still poisons a prior good prefix. The four transport controls added in the
preceding test epoch are now independent top-level tests, not unawaited
children of the evidence-file test; their assertions are retained. The
five-second deadline, eight-connection cap, original UTF8/privacy policy,
pending drain and all sampling/wire/count assertions are unchanged. Only a
new parent native retake can establish this lifecycle change's runtime result.

## Executed approved load

`node tools\observability\measure-parent-safe.mjs` runs two actual Java processes:
API-only baseline and actual pinned-agent/sampler, each **10 RPS for120s**.
Both perform the declared real loopback HTTP operation with controlled25ms
work. It measures exact-PID CPU/working-set and actual native agent envelopes;
no dummy telemetry or second SDK. Two-core/8GiB local normalization is
**not observed Azure shared-P1 capacity**.
Load fetches reject redirects, including same-origin redirects. Target approval
does not authorize forwarding correlation headers, request bodies or credentials
to a Location endpoint; redirect failures remain explicit unexpected errors.

Historical `c3f552...` run measured instrumented1200 requests; p95 **35.4958ms**,
p99 **52.6688ms**, unexpected errors **0%**, CPU mean **9.2653%**, measured peak
**64.9320%**, working-set **4.2863%** of explicit8GiB limit.
Measured p95 overhead was **-13.9391%** against this run's baseline; local
variance/lower measured latency is not a promised improvement. Received
**2400/2400** unique real
native SERVER/CLIENT records with correct per-request parents.

Result is deliberately **INCONCLUSIVE** for unavailable actual Azure
`_BilledSize`/variable daily meters. Encoded payload cost is explicitly an
estimate, not billing. The safe-intake successor counts privacy-minimized
native JSON projection bytes, not original wire bytes; original raw and
decoded payload byte totals remain separate shared-port receipts.
No absent metric is filled0. Reports:
`extensions\parent-safe-sampler\target\approved-load\result.json` plus actual
baseline/candidate measurements. User thresholds/input reside in
`config\observability-load.v1.json`; Root's257.6573USD/month (730h),
8.4709/day,2.76/billableGB quote and final variable cost remain R1-owned.
Budget target1000USD/day, intended lifetime720h, no resources approved.

## Specific residual live actions — To Do

Actual cloud resource approval/quota/cost; all effective native SDK/host/APIM
sampler acknowledgements; strict01 eight-core/async completeness and strict00
propagation; all SDK/JDK/host mappings after deployment; complete native LAW
schemas/permissions/query/latency/retention/cap/alert/receivers; real Azure
P1/aggregate CPU/memory/billing/variable meters; native URL and all-table
privacy/source checks; actual Application Map/TxDiag screenshots; R9 seals,
origin/oracles/sign-off and approved all-layer deployed watchdog/revert.

Local fixtures/checkers/compiler/loopback probes do not mark these clauses or
cards Done. Neither user code approval nor source loader facts invent a vendor
GA/support endorsement. No `.docs`, root board, DECISIONS, root POM/version,
network, deployment entrypoint or root package file was edited by R7.
