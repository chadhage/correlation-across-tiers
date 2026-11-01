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

### Native adapter handshake

`contoso.sampling-adapter-request.v1` contains layer/id, operation/revision,
runtime target and **owned** patch, frozen guard hash/ABI/provider, no secrets.
An approved hash-pinned command gets that request-file path as its final argv.
Observe is read-only. Live acknowledgement is
`contoso.sampling-control-ack.v1`: layerId, revision, owned-config SHA256,
percentage/RPS, guard presence/hash where required, provenance
`trusted-runtime-observation`, no SDK/provider/exporter/privacy construction
or secret values. File adapters return local-config status only.

Production restoration invokes the same full safety validator as activation;
unsafe/omitted privacy/provider/exporter/secret flags never satisfy restoration.
The independent watchdog schedules drain at **expiry minus120 seconds** for
native plans. Their traffic interval must leave that reserve; a120-second
load needs a longer lease. Local checker plans can explicitly use a shorter
drain interval and never assert live drain proof. Native traffic owners require
`stopTraffic` hooks and `contoso.sampling-drain-ack.v1` (no new synthetic work,
zero in-flight work, safe runtime provenance). Failed drain remains nonpassing
even when owned configuration fields were restored.

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
.\tools\observability\Restore-KqlCompiler.ps1
.\tools\observability\Validate-Kql.ps1
node .\tools\observability\workbook.mjs --check
```

The missing KQL compiler was actually restored privately, hash-pinned
Microsoft.Azure.Kusto.Language **12.4.1**, from Microsoft's public package
mirror after NuGet TLS failure. It analyzed all six rendered queries against
the documented source schema. This is compiler/checker proof, **not live LAW**.

Final focused run: **25 Node tests passed** (including actual compiler-backed
Bicep validation, every layer's local config rollback, interruption/expiry
watchdog and partial-activation recovery), **8 Maven sampler unit tests passed**,
**6 actual local Kusto syntax/declared-schema analyses passed**, and generated
workbook single-map drift checks passed. None is an Azure runtime gate.

R6's subsequent CODE cross-review corrections are implemented and owner-tested:
complete production-ack safety parity; preserved R2 SSR base below100;
pre-expiry drain scheduling; absolute expiry-plus-budget recovery failure;
post-hook activation checks; resumable per-owner drain completion after crashes.
The latest focused controller suite has **14 passing tests**, and the complete
R7 Node suite has **33 passing tests**. Reviewer source/hash recheck is separate
from these local results; no automatic card or live approval is implied.

## Executed approved load

`node tools\observability\measure-parent-safe.mjs` runs two actual Java processes:
API-only baseline and actual pinned-agent/sampler, each **10 RPS for120s**.
Both perform the declared real loopback HTTP operation with controlled25ms
work. It measures exact-PID CPU/working-set and actual native agent envelopes;
no dummy telemetry or second SDK. Two-core/8GiB local normalization is
**not observed Azure shared-P1 capacity**.

Observed instrumented1200 requests; p95 **34.4623ms**, p99 **46.9906ms**,
unexpected errors **0%**, CPU mean **9.2253%**, measured interval peak
**69.6076%**, working-set **4.3242%** of explicit8GiB limit,
p95 instrumentation overhead **2.2772%**. Received **2400/2400** unique real
native SERVER/CLIENT records with correct per-request parents.

Result is deliberately **INCONCLUSIVE** for unavailable actual Azure
`_BilledSize`/variable daily meters. Encoded payload cost is explicitly an
estimate, not billing. No absent metric is filled0. Reports:
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
