# Local correlation workshop: prove one request before Azure

**Engineer-to-engineer, executable Demo 01. LOCAL REHEARSAL / NOT CERTIFIED.**
Run the sample unchanged, inspect the actual IDs, then attach a debugger and
repeat. This is a fresh local execution, not the microsite's expected diagram
or a replay of checked-in telemetry.

## What you will demonstrate

```text
Storefront / real browser SDK
  -> span-free loopback forwarder
  -> Orders / real Spring app + Java agent
       -> Inventory HTTP CLIENT / agent-created child
            -> Inventory / real Spring app + separate Java agent
                 -> Redis GET / logical CLIENT (cold miss)
                 -> PostgreSQL SELECT / logical CLIENT
                 -> Redis SET / logical CLIENT
       -> durable local order/outbox staging
  <- HTTP 202
Separate authenticated local GET -> verify the stored workflow identity
```

The production handlers, downstream client, data adapter, browser SDK and
agent instrumentation run. The test-only
[bootstrap](../../services/orders-api/src/test/java/com/contoso/orders/NativeApiFixture.java)
supplies synthetic signed JWTs, disposable in-memory H2 databases and a
loopback RESP peer used by the real Lettuce client. No Azure account, Docker,
cloud connection string or Azure CLI sign-in is required.

There is **no APIM span**, Entra token issuance, real PostgreSQL/Managed Redis,
broker/worker processing or Azure telemetry ingestion in this lane. Data spans
are logical CLIENT operations, not database server spans. Orders is staged,
**not fulfilled**. These distinctions must stay on screen and in the handoff.
Other scenarios and Azure acceptance remain separate; do not claim that one
golden-path run qualifies all fifteen demos.

## 1. Prepare your workstation, once

Use Windows PowerShell 7, Git, the manifest-supported Node version and the
checksum-locked portable JDK/Maven/agent. Start with the exact checkout and
dependency restore instructions in
[Getting started, section 2](GETTING_STARTED.md#2-prerequisites-and-first-checkout).
Restore only missing declared tools/dependencies; do not install a second
global JDK/Maven or change version pins just to make the demo pass.

From the repository root:

```powershell
Set-Location .\contoso-corr-poc
$env:CONTOSO_PORTABLE_TOOLS_ROOT = Join-Path $PWD '.tools\java'
# If you keep the verified portable tools elsewhere, select that directory instead.
```

For Java stepping, install VS Code's Java debugger if missing. Merge the
configurations and inputs from [launch.example.json](launch.example.json) into
your existing workspace launch configuration; do not overwrite other launches.
Open the repository in VS Code so the Java debugger can resolve its sources.
If Java sources/breakpoints remain unbound, import the Maven projects and use
**Java: Configure Java Runtime** to select the project JDK from your verified
portable tools directory, rather than installing another global JDK.

**Say:** "The cloud configuration is not being changed. Each run owns its
loopback ports, short-lived test identities and fresh data. We will reject
missing spans rather than manufacture an Azure-shaped trace."

## 2. First prove the unattended path

```powershell
$run = ".cache\local-demo\verify-$([Guid]::NewGuid())"
.\demos\01\Run-Local.ps1 -OutputDirectory $run
# Equivalent entry point: npm run demo:local -- -OutputDirectory $run
```

The [runner](Run-Local.ps1) builds the selected reactor modules, runs focused
Java tests, verifies agent/sampler hashes, probes both APIs, builds Storefront,
drives one real Chromium click, captures exports and closes its owned helpers.
Maven is offline by default. If the build explicitly reports missing artifacts,
rerun with a **new** output directory and `-RestoreDependencies`.
`-ToolsRoot` and `-MavenRepository` can select existing verified tools/caches.

Require all three lines, not just an HTTP 202:

```text
A PASS | B PASS | C PASS (LOCAL_REHEARSAL only)
FULL_CHAIN C FAIL C_MISSING_HOP: gateway.request, gateway.backend
LOCAL_DEMO_VERIFIED trace=<observed trace> business=<observed UUID> spans=<observed count>
```

The second line is an intentional guard: a local forwarder must not pass as
APIM. Any other failure blocks the demonstration. IDs and extra application
spans change on each run; never compare IDs to yesterday's capture.

## 3. Present and step through the same implementation

Keep this terminal open:

```powershell
$run = ".cache\local-demo\present-$([Guid]::NewGuid())"
.\demos\01\Run-Local.ps1 -OutputDirectory $run -Present -DebugJava -DurationSeconds 900
```

### Checkpoint A: loaded browser, no order POST yet

At `LOCAL_DEMO_CHECKPOINT BEFORE_REQUEST`, Chromium is visible and the command
waits for **Enter**. The terminal prints the manifest path and actual Orders
and Inventory debug ports. All listeners bind `127.0.0.1`; ports are not fixed.
The presentation shares the pair's finite lease, with 60 seconds reserved for
cleanup. Ctrl+C cancels; a closed input or expired checkpoint is a failure.

1. Attach **Demo 01: attach local Orders** and **Inventory** from VS Code,
   entering the corresponding printed ports.
2. In Chromium, open DevTools **Sources**. Source maps expose the original
   Storefront and shared TypeScript, including
   [browser-api.ts](../../web/portal-ssr/src/shared/browser-api.ts).
3. Walk the source before sending traffic. Use the following breakpoints or,
   preferably for an audience, ID-only **logpoints**:

| Stop | Inspect only these safe values | What to explain |
|---|---|---|
| [Orders `AuthFilter.authenticateAndHandle`](../../services/orders-api/src/main/java/com/contoso/orders/OrdersApplication.java), after `InvocationIds.resolve` | `request.getHeader("traceparent")`, `id.value()`, current SDK trace/span IDs | Caller and independent gateway proof are validated; business identity is separate from the technical carrier |
| [Orders `Api.submit`](../../services/orders-api/src/main/java/com/contoso/orders/OrdersApplication.java), after `context` is assigned | `context.invocationId().value()`, `context.deadline()`, current SDK IDs | Ordinary order submission validates and calls Inventory, rather than invoking `/demo-runs` |
| [InventoryHttpClient `execute`](../../services/orders-api/src/main/java/com/contoso/orders/InventoryHttpClient.java), before `sendAsync` | `context.invocationId().value()`, current SDK IDs | The executor restores the Orders context; the agent creates/injects the HTTP child. Application code does not set `traceparent` |
| [Inventory `AuthFilter.authenticateAndHandle`](../../services/inventory-api/src/main/java/com/contoso/inventory/InventoryApplication.java), after resolving `id` | `request.getHeader("traceparent")`, `id.value()`, current SDK IDs | Same trace, a new server span, parent equal to the Orders HTTP CLIENT span; same trusted business ID |
| [PgRedisInventoryDataAdapter `lookupInventory`](../../services/inventory-data/src/main/java/com/contoso/inventory/data/PgRedisInventoryDataAdapter.java) | `context.invocationId().value()`, `outcome`, `value.isPresent()` where in scope | Cold cache: GET miss, SELECT, SET. Data operations are children of the Inventory request |

Java Watch expressions for the current SDK context:

```java
io.opentelemetry.api.trace.Span.current().getSpanContext().getTraceId()
io.opentelemetry.api.trace.Span.current().getSpanContext().getSpanId()
```

**Important:** production request deadlines remain **5 seconds in Inventory
and 10 seconds in Orders/browser**. Set one stopping breakpoint per fresh run,
inspect briefly and resume; do not pause every hop for a lecture. Use logpoints
for a continuous successful walkthrough and the before/after checkpoints for
long discussion. A long debugger pause should time out, not silently relax
guards. The 900-second process lease is not a 900-second request timeout.

Do not expand full requests, credentials, Authorization headers, JWT claims or
raw telemetry. Watch the named scalar values above. Do not click the browser's
Run button yourself while paused: **Enter** drives the single measured click.

**Say:** "A trace ID stays constant, but every operation gets its own span ID.
The wire parent identifies the sending dependency, not the receiving server.
The business UUID is searchable business context, not authentication."

### Checkpoint B: actual carrier and staged result

Press Enter in the terminal, step/resume promptly, and wait for
`LOCAL_DEMO_CHECKPOINT AFTER_REQUEST`.

The terminal now shows the **observed** order ID, business UUID, trace ID,
received W3C carrier, browser dependency span and Orders span/parent, plus the
successful GET read-back's stored workflow ID and separate action business ID.
Compare the carrier's middle fields with the printed trace and browser span;
the Orders parent must equal that browser span, not the Orders span itself.
The browser/Orders join includes both exported SDK records and an independent
received-carrier observation.

Show the local execution label and staged order in Storefront. The ordinary
POST writes state; the runner separately authenticates `GET /api/orders/{id}`
against the local Orders API and requires the original stored workflow ID and
state. It sends neither `traceparent` nor a business-ID override for that GET.
The GET ingress has its own trace and does not claim a browser/gateway
dependency. Storefront's Refresh button is a separate
manual UI action, not a click the runner performs; leave other controls alone
during the measured presentation. The GET action business header is not the
stored workflow business identity.

The local bootstrap uses an inline outbox publisher. Submission and read-back
both attempt pending sends, using the workflow's persisted original context;
the fixture's unavailable broker rejects delivery. Consequently additional
`contoso.servicebus.send` and Orders SQL spans can appear in the original POST
tree even though the GET ingress is a separate root. These are real local
attempts, not Service Bus SDK/broker or worker proof; the order remains queued.

**Say:** "We have observed the first cross-runtime join. We still need the
final JVM flush and downstream graph check. Staged means durable acceptance
in this local process, not message delivery or fulfillment."

Press Enter again. The browser closes, both JVMs flush and stop, and the
complete observed local parent tree is printed and checked. Extra
`unclassified` rows are actual application/outbox operations, not invented
tiers. Use their `operationName` in the JSON rather than assigning a new role.
The printed tree shows parent relationships, not chronological delivery order
or measured concurrency.

## 4. Show and independently inspect the saved evidence

After `LOCAL_DEMO_VERIFIED`, from the same POC directory:

```powershell
Get-Content -LiteralPath (Join-Path $run 'browser\local-trace-tree.txt')
$tree = Get-Content -Raw -LiteralPath (Join-Path $run 'browser\local-trace-tree.json') | ConvertFrom-Json
$tree.rows | Select-Object roleName, operationName, traceId, spanId, parentSpanId, businessInvocationId | Format-Table -AutoSize
$tree.seededFailureControls | Select-Object name, result, failureCode | Format-Table -AutoSize
```

Verify: one POST invocation trace, unique span IDs, the declared parent edges,
both API roles, and Inventory's cache/database CLIENT spans. The nine seeded
negative controls must be `EXPECTED_FAILURE`; they test the checker by mutating
copies, **not** by injecting runtime failures or altering original captures.

Keep the whole output directory together:

| Result | Use it for |
|---|---|
| `browser\local-trace-tree.json` / `.txt` | Observed spans/parents, local A/B/C, negative controls and explicit Azure gaps |
| `browser\local-browser-rehearsal.json` | Actual browser/Orders/carrier join, independent authenticated workflow read-back, browser version, cleanup, source stability and headed/source-map flags |
| `ingress.ndjson` | Allowlisted carrier actually received by Orders and its actual SDK context |
| `telemetry.ndjson`, `browser\browser-telemetry.ndjson` | Privacy-minimized real local exported records, not a source-derived expected trace |
| `capture-summary.json` | Original-payload scan/receiver receipts; scoped capture, not global privacy clearance |
| `local-pair.json` | Actual origins/debug ports/PIDs; must finish `ready:false`, `processesStopped:true` |

The output is local development evidence and contains technical/business IDs.
Share only the approved minimized results, not browser profiles, build scratch,
agent settings or debugger/credential dumps. Saved checks do not enroll native
observers or certify the source tree or Azure environment.

## 5. Failure, cleanup and the next engineering step

- **Missing tool, agent, dependency or Chromium:** follow the named diagnostic
  and the explicit restore steps in [Getting started](GETTING_STARTED.md).
  Do not turn a failed run into PASS by dropping a hop or reusing old evidence.
- **Debugger timeout:** resume/detach, let cleanup finish, then use a new run
  directory with fewer stopping breakpoints or logpoints.
- **Interrupted presenter:** Ctrl+C and the finite watchdog stop only owned
  helpers. Verify the manifest's stopped state and the named PIDs; never kill
  processes by name or purge a shared database, queue or cache.
- **Data reset:** each pair owns fresh in-memory data/RESP state; stopping the
  pair discards it. Keep result files, not a reusable "ready" manifest.
- **Reuse:** make one application change, run the focused checks below, and
  repeat the unattended command before showing it again:

```powershell
node --test --test-reporter=spec `
  .\tests\golden-path.test.mjs `
  .\tests\observability\local-trace-tree.test.mjs `
  .\web\portal-ssr\tests\local-rehearsal.test.mjs
```

Then use the [boilerplate integration checklist](BOILERPLATE_INTEGRATION.md)
to port the production correlation/auth/data patterns into your application.
Keep the test bootstrap, synthetic token endpoint, H2/RESP and local observer
out of deployment packages. Only after local evidence is accepted should the
team separately authorize the real-data/Azure lanes in
[Getting started](GETTING_STARTED.md#5-optional-real-local-postgresql-and-redis)
and [assess the remaining acceptance work](COMPLETION.md).
