# Demo 01: build, run, deploy and reuse

**Status: runnable local rehearsal; Azure acceptance NOT COMPLETE / NOT CERTIFIED.**
See the [completion assessment and atomic backlog](COMPLETION.md). This guide
does not authorize Azure spending, directory changes, secrets access or traffic.

**Current shared-workspace caveat:** the combined Java profile and integrated
local rehearsal passed in a later validation epoch after earlier concurrent-edit
failures. The checkout remains modified/uncommitted and is not tied to a clean
commit or immutable full-source snapshot. See the assessment for exact scope,
historical failures and current limitations.

## 1. Choose the right lane

| Lane | What actually runs | What it does not prove |
|---|---|---|
| Local application rehearsal | Real Chromium/Storefront SDK, real Orders and Inventory Spring applications in two agent-instrumented JVMs, signed synthetic JWT validation, JDBC against H2 and Lettuce against a RESP peer | APIM, Entra issuance, PostgreSQL, Managed Redis, broker delivery or Azure ingestion |
| Optional local real-data tests | Production data adapters against an explicitly supplied PostgreSQL 18 or Redis 7+ server | The browser/API path, Entra, TLS/private Azure networking or native Azure data spans |
| Azure scenario | Actual Storefront, APIM, Orders, Inventory, PostgreSQL and Managed Redis using the shared workspace | Nothing until deployment, original telemetry, exact graph, reset and owner acceptance are actually measured |

The local forwarder creates **no Gateway span**. Never add two synthetic spans
to make the local result look like Azure.

### The scenario's contract

1. Sign in to Storefront with an approved delegated identity.
2. Select Demo 01 and click **Run selected Contoso demo**. This submits an
   ordinary `POST /contoso/v1/orders`, not `POST /demo-runs`.
3. The browser SDK creates the HTTP dependency and its W3C carrier.
4. APIM validates the caller, preserves caller Authorization and adds its
   independent managed-identity Gateway proof. Its tracer creates the actual
   Gateway request and backend dependency.
5. Orders independently validates both identities, resolves the business
   invocation, validates the order and calls Inventory with its own credential.
6. Inventory independently authenticates Orders and performs the safe logical
   cache/database CLIENT operations. Database server continuations are not
   invented.
7. Orders persists the workflow/outbox and returns `202`. **QUEUED/staged is
   not fulfilled.** A GET verifies durable order identity separately.
8. Reconstruct the observed trace and restore only the captured run-owned
   state. Do not equate an HTTP response or a plausible diagram with acceptance.

The eight required boundary types and their exact parent relationships are in
the [root boundary map](../../contracts/expected-boundary-map.v1.json).
`businessInvocationId` is the current HTTP action; `workflowBusinessInvocationId`
is the original stored workflow identity. Neither is a trace ID or credential.

## 2. Prerequisites and first checkout

Already have an application with default ARM/Application Insights wiring?
Use the [stock-boilerplate adoption checklist](BOILERPLATE_INTEGRATION.md).
It distinguishes what to retain from the browser, Gateway, runtime, business-ID,
data-privacy and sampling changes needed to match this scenario.

Use Windows PowerShell **7** (`pwsh`), Git and a short checkout path. The current
manifests require Node 22.23.4+ within the declared supported range, JDK 25,
Maven 3.10 and the checksum-locked Java agent/sampler. Do not substitute newer
versions without updating and validating the [version lock](../../config/versions.lock.json).

```powershell
git -c core.longpaths=true clone https://github.com/chadhage/correlation-across-tiers.git C:\src\correlation-across-tiers
Set-Location C:\src\correlation-across-tiers\contoso-corr-poc
$env:CONTOSO_PORTABLE_TOOLS_ROOT = Join-Path $PWD '.tools\java'
```

For a checkout missing its declared tools/dependencies, restore them explicitly:

```powershell
.\tools\java\Install-Portable.ps1
.\tools\java\Get-Agent.ps1
npm --prefix .\web\portal-ssr ci --workspaces=false --ignore-scripts --no-audit --no-fund
npm --prefix .\web\storefront-spa ci --workspaces=false --ignore-scripts --no-audit --no-fund
Push-Location .\web\portal-ssr
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PWD '.cache\browsers'
.\node_modules\.bin\playwright.cmd install chromium
Pop-Location
```

These are local downloads, not Azure provisioning. Reuse an existing verified
tool installation when available. Do not install a second global JDK/Maven.
The launcher defaults to offline Maven. If it reports missing artifacts, repeat
it with `-RestoreDependencies`; that restores the existing declared dependencies,
not new versions. An explicit `-MavenRepository` can select an existing cache.
The browser builder uses the leaf Portal dependencies; it does not require an
untracked monorepo-root lockfile.

### Sample code walkthrough

Use this order to learn the implementation before modifying your application:

1. Open [Storefront app.ts](../../web/storefront-spa/src/app.ts). Demo 01 uses
   the ordinary order action, not the asynchronous demo-run endpoint.
   [browser-api.ts](../../web/portal-ssr/src/shared/browser-api.ts) owns the bounded
   authenticated POST/GET; [browser-telemetry.ts](../../web/portal-ssr/src/shared/browser-telemetry.ts)
   owns SDK initialization, approved-origin propagation and safe telemetry.
2. Follow the route into [OrdersApplication](../../services/orders-api/src/main/java/com/contoso/orders/OrdersApplication.java):
   authentication filter -> canonical business ID -> `submit` -> durable staging.
   Follow [InventoryHttpClient](../../services/orders-api/src/main/java/com/contoso/orders/InventoryHttpClient.java)
   into [InventoryApplication](../../services/inventory-api/src/main/java/com/contoso/inventory/InventoryApplication.java)
   and [PgRedisInventoryDataAdapter](../../services/inventory-data/src/main/java/com/contoso/inventory/data/PgRedisInventoryDataAdapter.java).
3. Run section 3 unchanged first. Inspect its result files before editing.
   The launcher supplies local identities/data; do not try to configure real
   Entra credentials or a cloud connection string for this lane.
4. Use section 4 to attach a debugger at the Orders handler and Inventory
   lookup. Inspect how the request context and canonical business ID survive
   the downstream executor and how `202` differs from completed fulfillment.
5. Make one application change in a private branch, run the focused tests and
   repeat section 3 with a new output directory. Compare actual parent edges
   and canonical IDs, not generated IDs against a previous run.
6. For real data use section 5; for Azure use section 6 in order. Copying the
   sample's local test authentication, H2/RESP fixture or observer into a
   production package is not an Azure implementation.

To adapt existing stock Application Insights code rather than run the sample,
continue with [the step-by-step boilerplate changes](BOILERPLATE_INTEGRATION.md#2-inventory-the-out-of-box-integration).

#### Submit an order and verify durable identity

Copy this into the Storefront after its telemetry SDK and authenticated
browser `api` have been initialized. Use a seeded SKU in an owned fixture:
the POST writes durable state.

```typescript
const staged = await api.order({
  schemaVersion: 1, orderId: crypto.randomUUID(), sku: "CONTOSO-001", quantity: 1
}); // Requires HTTP 202: accepted and staged, not fulfilled.
const stored = await api.workflow("orders", staged.id); // Requires HTTP 200.
const actionId = staged.businessInvocationId;          // The POST action.
const workflowId = staged.workflowBusinessInvocationId; // The stored workflow.
if (stored.businessInvocationId !== workflowId) {
  throw new Error("Order read-back returned a different workflow identity");
}
// Use actionId to look up the POST; use workflowId to identify the durable order.
// The IDs can match for a new order. Do not compare the GET action header to either.
```

#### Follow the correlation at `InventoryHttpClient`

1. [The browser SDK](../../web/portal-ssr/src/shared/browser-telemetry.ts)
   creates the Fetch dependency and injects its W3C carrier for the approved
   API origin. The application does not set `traceparent`.
2. The Java agent extracts the incoming context for the Orders server span.
   [InventoryHttpClient.java](../../services/orders-api/src/main/java/com/contoso/orders/InventoryHttpClient.java)
   restores that context on its executor thread before `sendAsync`. The agent
   creates the child HTTP client span and injects its context; the Inventory
   agent extracts it for the Inventory server span. A deployed APIM adds its
   own request and backend spans before Orders; the local forwarder does not.
3. `x-business-invocation-id` is sent separately for business lookup. It is
   neither the W3C trace ID nor a credential. The GET response header identifies
   the GET action, while the GET body identifies the stored workflow.

#### See what hit, miss, and fallback actually emit

The [isolated agent test](../../services/inventory-data/src/test/java/com/contoso/inventory/data/DataAgentQualificationTest.java)
uses a fresh loopback RESP peer and H2 database per case. It checks exported
logical CLIENT spans under each lookup's parent, not synthetic export rows.

| Lookup | Inventory-side CLIENT spans |
|---|---|
| Cold cache | Redis `GET` (miss), PostgreSQL `SELECT`, Redis `SET` |
| Warm cache | Redis `GET` (hit) only; no Inventory PostgreSQL lookup |
| Cache read error | Failed Redis `GET`, PostgreSQL `SELECT`, Redis `SET` if cache population succeeds |

These are Inventory lookup spans, not all database spans in an order request.
The full Demo 01 graph uses a cold fixture when it expects the Inventory
PostgreSQL span. The adapter reports `inventory.cache.get_fallback` or
`inventory.cache.put_failed` with a bounded error category, not cache keys,
values, or exception messages. It still falls back or returns the database
result as before.

## 3. One-command local scenario

From the POC root:

```powershell
$run = ".cache\golden-path\run-$([Guid]::NewGuid())"
.\tools\java\Start-LocalPair.ps1 -OutputDirectory $run -RunBrowser
# On a cold Maven cache, only after the missing-dependency diagnostic:
# repeat with a NEW output directory and -RestoreDependencies.
```

The command:

1. Compiles/packages the eight selected reactor modules and runs the focused
   API/client/ingress tests. A fresh Surefire property supplies the actual
   classpath; an implicit current-directory classpath is rejected.
2. Checks the agent/sampler hashes and launches Inventory, then Orders, on
   ephemeral numeric-loopback ports. Both must answer `/health/ready`.
3. Creates short-lived synthetic identities entirely in memory. It does not
   change production authentication or use an Azure token.
4. Builds the current local Storefront entrypoint and drives a real trusted
   browser click. The forwarder preserves the actual carrier without creating
   a span.
5. Joins the browser's emitted dependency to the agent-emitted Orders request
   and to a separate actual Orders ingress observation. Async servlet body
   dispatch is observed exactly once.
6. Stops both JVMs gracefully, collects their final flush and seals the shared
   original-payload privacy scanner before checking the downstream graph.
7. Reuses the existing A/B/C checker and nine seeded checker-negative controls.
   Missing hops, changed trace, repeated span IDs or wrong parents fail.

Expected output includes:

```text
A PASS | B PASS | C PASS (LOCAL_REHEARSAL only)
FULL_CHAIN C FAIL C_MISSING_HOP: gateway.request, gateway.backend
LOCAL_GOLDEN_PATH_PASS ... NOT CERTIFIED.
```

The full-chain failure is **required**, not a defect to mask.

### Result files

Under your new `$run` directory:

| File | Meaning |
|---|---|
| `local-pair.json` | Actual origins, owned PIDs, deadline and optional debug ports; becomes `ready:false` after stop |
| `ingress.ndjson` | Allowlisted received carrier and actual Orders SDK context, not an echo substituted for an export |
| `telemetry.ndjson` | Privacy-minimized real local Java exports; publisher/credential values are not retained |
| `capture-summary.json` | Original-payload scan counters/receipts and receiver completion, not global privacy clearance |
| `browser\local-browser-rehearsal.json` | Real click, exact browser/Orders join, excluded-origin and CORS controls |
| `browser\local-trace-tree.json` / `.txt` | Structural result, actual spans, nine seeded negative controls and explicit missing Azure hops |

Browser assets/build scratch are local test output, **not deployment packages**.
The saved graph is a structural check of captured records; it does not enroll
an observer or grant certification. The browser's before/after hashes cover
its declared browser inputs, not every Java source or an entire build lineage.

## 4. Local development and debugging

### Edit/run loop

Edit the existing application classes, then repeat section 3 with a fresh output
directory. Ordinary order submission is implemented in
[OrdersApplication](../../services/orders-api/src/main/java/com/contoso/orders/OrdersApplication.java);
the bounded downstream call is in
[InventoryHttpClient](../../services/orders-api/src/main/java/com/contoso/orders/InventoryHttpClient.java);
the Inventory routes are in
[InventoryApplication](../../services/inventory-api/src/main/java/com/contoso/inventory/InventoryApplication.java).

For a long enough local inspection window, start just the pair in terminal A:

```powershell
$run = ".cache\golden-path\debug-$([Guid]::NewGuid())"
.\tools\java\Start-LocalPair.ps1 -OutputDirectory $run -DebugJava -DurationSeconds 900
```

After `LOCAL_PAIR_READY`, terminal B can execute the browser driver:

```powershell
node .\web\portal-ssr\scripts\local-rehearsal.mjs `
  --pair '<the printed run directory>\local-pair.json' `
  --out ".cache\golden-path\browser-debug-$([Guid]::NewGuid())"
```

That standalone driver stops its own browser/forwarder, **not terminal A's
pair**. Stop terminal A with Ctrl+C when finished. Its finite watchdog also
stops owned processes before the lease ends. Do not reuse the stopped manifest.

### VS Code Java attach

1. Install the Java debugger extension if it is absent.
2. Merge the configurations/inputs from [launch.example.json](launch.example.json)
   into your workspace's VS Code launch configuration; do not overwrite existing
   configurations.
3. Read the actual `debugPorts.orders` and `debugPorts.inventory` from the
   printed manifest. No fixed/shared debug ports are assumed.
4. Start **Demo 01: attach local Orders** and/or **Inventory**, entering those
   ports. Listeners bind only `127.0.0.1`.
5. Set breakpoints in `submit`, `lookup`, the Inventory route and
   [PgRedisInventoryDataAdapter](../../services/inventory-data/src/main/java/com/contoso/inventory/data/PgRedisInventoryDataAdapter.java).
6. Run the browser driver in terminal B. Inspect `OperationContext`, current
   span context, deadlines and the returned canonical business ID. Do not dump
   credentials, full requests, secret settings or raw telemetry.
7. Resume promptly: production-like 5/10-second request deadlines are
   intentionally retained. Pausing beyond them should fail, not disable guards.

For frontend-only stepping, use the existing Playwright fixture runner:

```powershell
Push-Location .\web\portal-ssr
npm run test:browser -- --debug
Pop-Location
```

This opens Playwright's inspector for **frontend fixtures**, not an Azure or
two-JVM qualification. The integrated rehearsal normally runs headless.

### Focused tests

```powershell
node --test --test-reporter=spec `
  .\tests\golden-path.test.mjs `
  .\tests\observability\local-trace-tree.test.mjs `
  .\tests\verification\demo01-runtime.test.mjs `
  .\web\portal-ssr\tests\local-rehearsal.test.mjs

# Supply the existing frozen compiler to exercise deployment-plan compilation:
$env:CONTOSO_BICEP_PATH = '<absolute path to the locked bicep.exe>'
node --test --test-reporter=spec .\tests\golden-path-deployment.test.mjs
```

The deployment tests replace `az` with a rejecting local function. A successful
test is not a successful Azure deployment. Without the compiler, the compiler
case explicitly skips and supplies no compilation evidence.

## 5. Optional real local PostgreSQL and Redis

The two-JVM rehearsal intentionally uses H2/RESP. It does **not** silently switch
to real stores when these servers are present.

Use approved existing loopback servers, or, if Docker with Linux containers is
installed and starting disposable local containers is approved, use the
optional [data-only Compose file](compose.data.yml). Docker was absent on the
assessment machine; this Compose lane has **not** been executed here.

```powershell
$env:CONTOSO_LOCAL_PG_HOST = '127.0.0.1'
$env:CONTOSO_LOCAL_PG_PORT = '<unused numeric local port>'
$env:CONTOSO_LOCAL_PG_USERNAME = '<disposable local administrator name>'
$secure = Read-Host 'Disposable local-only PostgreSQL password' -AsSecureString
$env:CONTOSO_LOCAL_PG_PASSWORD = [Net.NetworkCredential]::new('', $secure).Password
$project = "contoso-demo01-$([Guid]::NewGuid().ToString('N'))"
docker compose --project-name $project --file .\demos\01\compose.data.yml config --quiet
docker compose --project-name $project --file .\demos\01\compose.data.yml up --wait
```

Do not print rendered Compose configuration: it contains the local password.
Images use major-version tags for this optional development example; record
their resolved digests and qualify/pin them before treating a run as reproducible.
Redis is disposable, unauthenticated and numeric-loopback-only; never put real
data in it. PostgreSQL/Redis data uses container tmpfs, not a shared host volume.
Port 10000 must be free because the current Redis adapter reports that port.

Then follow the exact opt-in contracts:

```powershell
. .\tools\java\Use-Portable.ps1
$env:CONTOSO_LOCAL_PG_ALLOW_CREATE_DROP = 'run-owned-only'
$env:CONTOSO_LOCAL_PG_RUN_ID = [Guid]::NewGuid().ToString()
mvn -o -B -ntp -pl services\inventory-data -am test `
  '-Dtest=LocalPostgresLane' '-Dsurefire.failIfNoSpecifiedTests=false'

$env:CONTOSO_LOCAL_REDIS_ALLOW_OWNED_KEYS = 'run-owned-only'
$env:CONTOSO_LOCAL_REDIS_HOST = '127.0.0.1'
$env:CONTOSO_LOCAL_REDIS_PORT = '10000'
$env:CONTOSO_LOCAL_REDIS_RUN_ID = [Guid]::NewGuid().ToString()
node .\tools\data\local-redis-preflight.mjs
mvn -o -B -ntp -pl services\inventory-data -am test `
  '-Dtest=LocalRedisLane' '-Dsurefire.failIfNoSpecifiedTests=false'
```

Read [PostgreSQL ownership/cleanup](../../tools/data/LocalPostgresLane.md) and
[Redis ownership/cleanup](../../tools/data/LocalRedisLane.md) first. They refuse
existing objects/keys, check real server identity and remove only successfully
created/claimed objects. A configuration preflight is not a connection test.

For containers you created under that exact `$project`:

```powershell
docker compose --project-name $project --file .\demos\01\compose.data.yml down
Remove-Item Env:\CONTOSO_LOCAL_PG_PASSWORD
```

Do not use global Docker prune, shared Redis flush, broad SQL cleanup or guessed
run ownership. An integrated two-JVM **real-store** fixture remains an explicit
backlog task; passing the two separate data lanes does not create one.

## 6. Azure: approvals and deployment stages

### Preconditions: stop rather than invent values

The existing root is the **whole POC infrastructure**, not a newly invented
cheap Demo-01-only template. It includes messaging and worker hosts even when
you publish only the three synchronous application packages. Review its full
cost, quota, network, retention and lifecycle implications.

Current deployment blockers include the unresolved Node beta-exporter
classification/support gate, missing live bootstrap/identity inputs, absent
approved sampling/recovery operations and empty native-observer registry.
Parallel work now supplies an isolated Azure operator/example implementation
candidate; see section H below. Its source and fixture checks are not approved
native control/recovery operations.
The scripts do not waive those blockers. **Plan** can run locally;
**WhatIf** needs separately approved Azure reads; **Provision/Publish** remain
blocked by the existing certification dependency gate until it is genuinely
resolved.

Obtain separate authorization for:

- The exact subscription/resource group, region, SKUs, cost/quota/policy and
  approved runner routes.
- Entra registrations, app-role assignments and consent; Key Vault SET and
  named-secret readers; PostgreSQL administrator/principal grants.
- Code deployment/restarts and ordinary application traffic.
- Bounded sampling changes, original-column telemetry reads/privacy review and
  run-owned reset.

An approval-reference string locates external authorization; it is not proof.
No script changes the global Azure account/subscription or enables Basic SCM.

### A. Sign in and select the target subscription

Use your own Azure CLI sign-in. A VS Code Azure sign-in alone does not establish
CLI authentication. Obtain approval for subscription inventory, regional
Microsoft.Web quota, existing App Service plans and Linux SKU location reads,
plus access to Microsoft's public retail-price endpoint. Then run from the
POC root:

```powershell
az login
# For an account in a specific directory, use az login --tenant '<tenant GUID>'.
New-Item -ItemType Directory -Force .\.cache\golden-path | Out-Null
.\demos\01\Select-AzureTarget.ps1 `
  -OutputPath .\.cache\golden-path\foundation-input.json `
  -PublisherEmail '<approved contact email>' `
  -AllowAzureRead -ApprovalReference '<approved-target-read-reference>'
```

The [selector](Select-AzureTarget.ps1) refreshes `az account list` from your
CLI session, filters to enabled subscriptions, and displays name, subscription
ID and tenant ID. Enter a subscription GUID or its list number, or `q` to cancel. No active/default
subscription is silently selected, even when only one is available. If no
enabled subscriptions are returned, sign in with the appropriate account or
tenant and retry. Subscription visibility is not evidence of deployment RBAC,
quota, policy or spending approval.

The selector checks per-SKU regional **Instances** usage/limits and the Linux
regional listing for the [supported compute catalogue](../../infra/compute-skus.json).
If no eligible candidate remains, it shows the statuses and prompts for another
subscription ID. Missing/unknown quota is not treated as available. An existing
same-SKU, one-instance Linux plan with the exact generated name/group/location
can be reused without one additional unused instance; a mismatched existing
plan is rejected.

For eligible candidates, the script fetches current public USD PAYG hourly
Linux prices, displays a cost-ranked table and recommends the lowest price.
Press Enter to accept it, or enter another listed SKU. The comparison preserves
the current **one-plan, six-app topology and at least 2 vCPUs / 8 GB**, including
VNet integration and Always On. It compares supported Premium v3/v4 candidates,
not every Azure architecture. Basic/Standard downsizing or splitting the apps
requires separate sizing and workload qualification; the existing capacity
floor is not a measured minimum. Prices are fetched live, not hardcoded; a
failed lookup or missing/conflicting price stops selection without writing an
input.

The displayed monthly estimate is **one plan's hourly retail price times 730**.
It excludes APIM, databases/cache, storage, messaging, telemetry, network,
operator/watchdog hosts, taxes and negotiated/reservation discounts. It is not
a total deployment quote. Reported per-SKU quota does not reserve physical
capacity or qualify other/aggregate quotas, policies, RBAC or the complete root.

For CI or a noninteractive shell, pass an explicit ID from the authenticated
inventory and a supported SKU, with `-NonInteractive`. The script still checks
access, quota, regional listing and live prices; an explicit choice is not
silently replaced by its recommendation:

```powershell
.\demos\01\Select-AzureTarget.ps1 `
  -SubscriptionId '<accessible subscription GUID>' `
  -ComputeSku P1v3 -NonInteractive `
  -OutputPath .\.cache\golden-path\foundation-input-ci.json `
  -PublisherEmail '<approved contact email>' `
  -AllowAzureRead -ApprovalReference '<approved-target-read-reference>'
```

The output is a **private, untracked** `contoso.root-inputs.v1` foundation input
using the [root contract](../../README.md#exact-inputoutput-contract). Physical
names are generated by the existing naming helper from the selected
subscription, `centralus` and `poc`; the checked-in
[historical frozen map](../../infra/params/frozen-names.v1.json) is not edited.
Region selection is not added: the root still supports only `centralus`.
Use a new output path for a different selection; existing inputs are never
overwritten. The output's parent directory must already exist.

Review the generated subscription, resource group, names and `computeSku` with
the owners. Keep the chosen SKU when promoting foundation inputs to application
inputs. Older inputs that omit `computeSku` retain the original `P1v3` default;
run the selector to obtain a live recommendation rather than treating that
default as the cheapest currently eligible choice.
Application/admin bindings, runner CIDRs, notification routes and deployment
approval start empty and require the separate approvals/bootstrap below.
The read approval is deliberately not reused as a deployment approval.
Do not insert credentials, resolved connection strings, tokens, private keys or
fake client/object IDs. Keep input and plan directories private and out of
packages/evidence.

Selection performs read-only Azure CLI discovery/quota/plan/location calls and
public retail-price HTTPS requests; it creates no resources and never runs
`az account set`. Subsequent **Plan** and package inspection use
the saved input offline. WhatIf, Provision and publishing recheck the selected
subscription against the signed-in inventory; application input must also
match its actual tenant. Deployment commands explicitly pass `--subscription`,
without changing your CLI default.
WhatIf and Provision also recheck the selected compute SKU immediately before
ARM validation and WhatIf. If quota/region availability changed, they stop:
rerun selection with a quota-capable subscription, save a new input, and review
a new plan and its target-specific approvals. They never automatically retarget
an already reviewed deployment. The quota recheck is not a reservation or a
replacement for complete target qualification.

### B. Compile, validate and review

```powershell
$env:CONTOSO_BICEP_PATH = '<absolute path to the locked bicep.exe>'
.\demos\01\Deploy-Azure.ps1 -InputPath .\.cache\golden-path\foundation-input.json
# Record the returned planDirectory and planSha256; no Azure call occurred.

# Only with separately approved Azure reads and an existing approved target RG:
.\demos\01\Deploy-Azure.ps1 -InputPath .\.cache\golden-path\foundation-input.json `
  -Action WhatIf -AllowAzureRead -ApprovalReference '<approved-read-reference>'
```

Plan schema v2 binds the selected subscription, resource group and region as
well as the template/parameter hashes (including `computeSku`) into `planSha256`. Regenerate and review
plans made before this change; an old digest is not a current authorization.
Changing targets requires a new input, plan, target-specific bootstrap and
approval; do not carry application identities or secret references across
subscriptions without revalidation.

The script uses the frozen compiler and existing `infra\main.bicep`; it does not
replace IaC with imperative resource creation. Review the actual live diff.
If the resource group does not exist, its separately authorized owner must
create the exact approved group first; this helper does not adopt/create groups
or perform subscription-scope writes.

### C. Provision foundation, then application infrastructure

**Do not run while the dependency gate is open.** After actual resolution and
external approval:

```powershell
.\demos\01\Deploy-Azure.ps1 -InputPath .\.cache\golden-path\foundation-input.json `
  -Action Provision -AllowAzureRead -AllowAzureWrite `
  -ApprovalReference '<matching-input-approval-reference>' `
  -ReviewedPlanSha256 '<reviewed-plan-sha256>'
```

The script recompiles current inputs, checks the reviewed digest and dependency
gate, executes ARM validation/what-if and requests confirmation before create.
It saves only the root's non-secret ARM outputs. A different input/source epoch
requires another plan/review.

Then:

1. Capture the actual foundation `inventoryBaseUrl`, `portalOrigin`, compute
   principal object IDs and Gateway object ID. Do not derive dynamic hostnames.
2. Have the identity owner establish actual registrations/client-object pairs:
   Storefront delegated `Orders.Invoke`; Gateway app-only `Gateway.Invoke`;
   Orders app-only `Inventory.Invoke`; Portal/controller roles only if used.
   API v2 audiences are bare GUIDs; requested scopes/resources are separate.
   Register the actual SPA redirect URI. See the
   [identity preparation contract](../../services/security-core/identity/entra-preparation.v1.json).
3. Have the approved operator create/reference the App Insights configuration
   secret and an expiring HMAC version without printing values. Existing
   [HmacSecretBootstrap](../../services/security-core/src/main/java/com/contoso/security/HmacSecretBootstrap.java)
   generates entropy in memory; its `storeAfterExplicitApproval` method is a
   **separately approved write**, not an application-startup operation.
   A reviewed operator executable for this remains a completion task.
4. Construct application input with actual approved IDs, observed frontend/
   Inventory URLs, existing HMAC version, administrator and approved SQL role
   names. Generate/review a new plan with `deploymentPhase='application'`.
5. Provision application **infrastructure without code**. Important: the root's
   PostgreSQL/Managed Redis modules run in the application phase, not foundation.
   Approved SQL role names are configuration, not evidence that SQL bootstrap
   has already happened.
6. Bootstrap the newly provisioned data tier before publishing code, as below.
   Do not attempt SQL bootstrap against nonexistent foundation data resources.

### D. Bootstrap and check data/security

From the independently approved private-network operator:

- Connect to the actual PostgreSQL server using Entra/TLS and the administrator,
  not a runtime service account.
- Apply [V001](../../services/inventory-data/src/main/resources/db/migration/V001__inventory.sql)
  and [V002](../../workers/messaging-core/src/main/resources/db/messaging/V002__messaging.sql).
  V002 is needed even for synchronous order staging/read-back.
- Use the existing
  [InventorySchemaHooks](../../services/inventory-data/src/main/java/com/contoso/inventory/data/InventorySchemaHooks.java)
  `install`, `registerPrincipal`, `grantInventory` and `grantWorkflow(ORDERS)`
  operations through a reviewed operator, with the actual resource/database
  permit and actual managed-identity object IDs. Reuse its narrow grants and
  marker binding; do not grant broad runtime DDL/admin permissions.
- Read back dataset markers and effective positive/negative privileges.
- Verify Inventory's actual Redis Entra access policy, private DNS/TLS and
  identity connectivity. Do not substitute a Redis password in app settings.
- Verify the actual named-secret references resolve for each exact reader and
  the APIM logger, without dumping resolved settings.

These APIs/SQL files are implemented, but an approved end-to-end bootstrap CLI
and live receipts are **not shipped as complete**. Stop here until the relevant
backlog tasks are fulfilled; do not improvise an unaudited secret/grant script.

### E. Build and publish the three application packages

Java packages, from the POC root after the approved current build:

```powershell
. .\tools\java\Use-Portable.ps1
mvn -B -ntp -pl services\inventory-api,services\orders-api,extensions\parent-safe-sampler -am verify
.\tools\java\Package-Service.ps1 -ModulePath services\inventory-api `
  -JarName inventory-api-1.0.0.jar -ServiceName contoso-inventory-api
.\tools\java\Package-Service.ps1 -ModulePath services\orders-api `
  -JarName orders-api-1.0.0.jar -ServiceName contoso-orders-api
```

`Package-Service.ps1` enforces the root's existing artifact gate, including
other declared reactor artifacts. On a clean checkout, build the full reactor
first if that gate reports missing artifacts; do not disable it.
Native environment-gated tests require the approved agent/sampler inputs and
finite local test window described in [Java validation](../../docs/JAVA_VALIDATION.md).
A successful build with skipped required tests is not qualification.

Build the cohost:

```powershell
npm run compile --workspace @contoso/portal-ssr
npm run build --workspace @contoso/storefront-spa
npm run build --workspace @contoso/portal-ssr
npm run package:deployment --workspace @contoso/portal-ssr
```

The resulting `web\portal-ssr\deployment-artifact` is source-free but **not yet
runnable without production dependencies**. On the approved Node 24 Linux
packaging runner, restore its frozen runtime manifest with
`npm ci --omit=dev --ignore-scripts --workspaces=false`, smoke-test it, then ZIP
the artifact's **contents**, including production dependencies, at archive
root. Do not ZIP the enclosing directory/repository or include browser caches.
Do not use Windows development `node_modules` as Linux runtime qualification.
The deployed root has remote build automation disabled; a package containing
only `dist` and a manifest is insufficient.

Review the actual ZIP bytes and record each SHA-256 independently. Inspect
without sending anything:

```powershell
.\demos\01\Publish-App.ps1 -Role Inventory `
  -InputPath .\.cache\golden-path\application-input.json `
  -ZipPath .\services\inventory-api\target\contoso-inventory-api.zip `
  -ExpectedSha256 '<reviewed-sha256>'
```

After code-deployment approval and successful dependency/bootstrap checks:

```powershell
.\demos\01\Publish-App.ps1 -Role Inventory -ZipPath '<reviewed-inventory-zip>' `
  -InputPath .\.cache\golden-path\application-input.json `
  -ExpectedSha256 '<reviewed-sha256>' -Execute -ApprovalReference '<code-approval>'
# Repeat for Orders, then Portal, with their own role/path/hash.
```

The publisher requires the same target input used for provisioning; there is
no hardcoded subscription or fallback target. It pins the input's target names,
checks archive layout/member
hashes, uses `az webapp deploy`, waits for deployment and requires actual
`/health/ready` HTTP 200 on the ARM-returned default hostname. The deployment
runner needs both its approved SCM route and an approved main-site route.
A main-site 403 fails; it is not converted into readiness.

Use Azure CLI 2.48.1+ with Entra-capable deployment, an approved identity and
the existing deny-default SCM rules. Never enable Basic SCM/FTP or request
publish profiles to bypass access problems. No Functions code is needed to
claim the synchronous HTTP slice; background broker activity remains disabled/
separately authorized.

### F. Exercise and test Azure

1. Obtain a finite, approved sampling/admission/drain/restore window covering
   browser, Gateway and both Java roles. Management-plane `100` settings alone
   are not native acknowledgements. The missing controller/observer interfaces
   in the backlog must be implemented and approved first.
2. Open the **actual** `portalOrigin` plus `/storefront/`, sign in through MSAL,
   select Demo 01 and click its run button.
3. Record only the observed canonical IDs. Expect durable staging, then use
   refresh to check the stored workflow identity.
4. Run the approved native adapter through the existing
   [Run.ps1](Run.ps1) entrypoint, preserving all evidence and reset checks:

```powershell
pwsh -NoProfile -File .\demos\01\Run.ps1 --mode BootstrapValidate `
  --adapter '<reviewed-runnable-adapter-relative-path>' `
  --adapter-sha256 '<reviewed-adapter-sha256>'
```

**That runnable v1 native acceptance adapter is currently missing.** The shipped
`demo01-runtime.mjs` is an inspector, not an adapter; passing it here is not a
workaround. BootstrapValidate remains NOT CERTIFIED.
The explicit `--azure-examples` route described below is a different,
observation-only path, not a way to make this v1 verifier pass.

For an independently approved **API-only smoke**, a reusable
[Node client](order-client.mjs) posts and reads an order with bounded responses,
no redirects, no fabricated carriers and separate action/workflow identities:

```powershell
$secure = Read-Host 'Approved Orders access token' -AsSecureString
$env:CONTOSO_ORDERS_ACCESS_TOKEN = [Net.NetworkCredential]::new('', $secure).Password
try {
  node .\demos\01\order-client.mjs --origin '<actual-https-gateway-origin-without-trailing-slash>' `
    --approval-reference '<traffic-approval>' --allow-traffic
} finally { Remove-Item Env:\CONTOSO_ORDERS_ACCESS_TOKEN }
```

Use an actually approved caller/audience/scope; an arbitrary default Azure CLI
token is not a Storefront token or an allowlisted client. Do not pass tokens in
arguments, keep transcripts/HAR capture off, and never persist the token.
This client is **not browser or graph acceptance**, and it does not capture/
restore a baseline. Use it only in an owned fixture whose cleanup is explicitly
managed by the approved operator; do not run it against shared data casually.

### G. Observe, debug, reset and roll back Azure

- Reconstruct the trace with the actual eight boundary types and strict direct
  ParentIds. Gateway role mapping, wire advancement and business-ID attachment
  must be observed; no child directly parented to the browser can substitute.
- Use the [trace, business lookup and orphan KQL procedures](../../kql/README.md)
  with actual trace/business IDs, finite time bounds, original-column scans and
  complete sealed capture. Do not paste raw query output into chat/evidence.
- In the actual Application Insights resource, filter Transaction Diagnostics
  and Application Map by those observed IDs; capture approved sanitized views.
  A static workbook import or screenshot placeholder is not execution.
- For failures, inspect safe `orders.request` / `inventory.request` categories,
  health and deployment status from the approved runner. A 401/403 suggests
  identity/route gates; a 503 needs dependency/deadline investigation. Do not
  dump app settings, JWTs, request bodies, SQL parameters or raw Redis values.
- Prefer local Java attach for stepping. Azure JDWP is **not enabled** by these
  artifacts. Remote debugging requires a separately approved isolated slot/
  tunnel, a complete agent/launcher review, a finite window and restoration.
  Never open a public JDWP port or add a competing Java agent.
- Stop admission, drain/flush, reset only the captured run and independently
  verify the before/after hashes and production sampling configuration.

```powershell
pwsh -NoProfile -File .\demos\01\Reset.ps1 --pack '<actual-run-pack-relative-path>' `
  --adapter '<same-reviewed-native-adapter>' --adapter-sha256 '<same-reviewed-hash>'
```

Saved baseline hashes cannot reconstruct private baseline values. The new
operator candidate persists an inventory/cache baseline and has H2 tests that
restore it from a new store instance. Adoption and full Azure/native recovery
qualification remain missing; that candidate is not the v1 adapter's approved
`restoreCapturedRun` operation.

For code rollback, republish the independently approved prior role ZIP/hash
through the same publisher, verify health and requalify affected traces.
For infrastructure rollback, review a fresh what-if of the prior approved IaC;
do not use Complete mode or delete the resource group as a reset.
Teardown/spending decisions require separate resource-owner approval. No
automatic resource-group delete or broad purge script is supplied.

### H. Integrated parallel Azure operator example: candidate, not acceptance

The parallel implementation is retained and included in this assessment:

- [Operator application](../../examples/azure-operator/src/main/java/com/contoso/demo/operator/OperatorApplication.java):
  independently authenticated controller API, a finite server window and an
  optional separate watchdog mode.
- [Durable run store](../../examples/azure-operator/src/main/java/com/contoso/demo/operator/OperatorRunStore.java):
  persisted run lease, inventory/cache baseline, owned workflow allocation,
  checkpointed recovery and explicitly retained workflow audit.
- [Azure example client](../../tools/verification/azure-examples.mjs) and
  [operator transport](../../tools/verification/adapters/azure-operator.mjs):
  explicit traffic approval/config hash, bounded RAW-query paging/scans,
  safe observation packs and server-side stop/reset.

Inspect without Azure:

```powershell
npm run examples:azure -- --list
Copy-Item .\examples\azure-operator\client.example.json .\.cache\golden-path\azure-client.json
# Edit only the copy, with actual approved origins/scopes and environment-variable
# NAMES for tokens. The shipped null destinations deliberately fail validation.
npm run examples:azure -- --check --config .\.cache\golden-path\azure-client.json

. .\tools\java\Use-Portable.ps1
mvn -o -B -ntp -Pazure-examples -pl :contoso-azure-demo-operator -am package
```

The Maven profile is opt-in. The operator is **not provisioned by the existing
root**, nor published by the three-role publisher. Before execution, its owner
must separately provision/protect the isolated host and independent watchdog,
apply its operator migration with the approved operator identity, and configure
the exact controller audience/client-object pair, Entra app roles, SQL/Redis
permissions and Azure read/control permissions. The production backend operator
pair is explicit opt-in via `CONTOSO_DEMO_OPERATOR_CLIENT_ID` /
`CONTOSO_DEMO_OPERATOR_OBJECT_ID`; it is not enabled by default or by a UUID.

The root and operator configuration use a **service-level all-APIs** APIM
diagnostic; API-scoped overrides are rejected by operator configuration.
That source contract has local regression coverage, not live Azure proof.

The server additionally requires actual `CONTOSO_OPERATOR_*` resource IDs,
start/end times and approval reference, plus
`CONTOSO_ISOLATED_DEMO_OPERATOR=true`; inspect
[OperatorConfig](../../examples/azure-operator/src/main/java/com/contoso/demo/operator/OperatorConfig.java)
for the exact required fields. No default live target is invented. Browser
credential state, if used, must remain in a private path **outside** this repo,
and the real authenticated browser flow still needs qualification.

Only after that separate setup and explicit execution approval:

```powershell
$config = '.\.cache\golden-path\azure-client.json'
$hash = (Get-FileHash -LiteralPath $config -Algorithm SHA256).Hash.ToLowerInvariant()
pwsh -NoProfile -File .\demos\01\Run.ps1 --azure-examples `
  --mode BootstrapValidate --execute --config $config `
  --config-sha256 $hash --approval-ref '<matching-approved-server-reference>'
```

The result is `OBSERVED` or `FAIL`, always **NOT CERTIFIED**, with
`independentlyEnrolledObserver:false` and no complete independent emission
ledger. It cannot select Certify. Its reset route uses the durable **server
run ID**, not a v1 evidence pack:

```powershell
pwsh -NoProfile -File .\demos\01\Reset.ps1 --azure-examples --execute `
  --config $config --config-sha256 $hash `
  --approval-ref '<matching-approved-server-reference>' --run-id '<actual-server-run-id>'
```

Two material gaps prevent treating this example as the finished synchronous
scenario:

1. Demo 01 now reads back the durable order identity without waiting for
   asynchronous completion. Reset still fences on sent/drained outbox work:
   a `QUEUED` order with pending work fails reset and retains its run lease.
   Safe worker-free cleanup/recovery remains open; do not bypass the fence.
2. Its scenario assertions check the eight-boundary direct-parent structure for
   Demo 01, but do not enforce every v1 role/type constraint or integrate with
   the full v1 acceptance pipeline. Independent canaries/emission provenance,
   native sampling acknowledgements and observer enrollment remain required.

No Azure command in this section was executed during the assessment.

## 7. Reuse the artifacts in another application/environment

| Reuse | Keep | Replace/requalify |
|---|---|---|
| Existing POC locally | Test-only launcher, actual source handlers, single agent, privacy intake, local graph profile | Fresh output/run IDs and selected verified local tool/cache paths |
| Exact approved POC on Azure | Root/modules, role names, dual-token trust, version lock, safe data spans, strict graph | Actual tenant/client/object IDs, observed URLs, approved secret references, SQL role mappings, owner inputs and new native receipts |
| Another application | API-only correlation helpers; bounded HTTP pattern; request-vs-workflow identity; safe client spans and regression approach | Business DTOs, identity contracts, boundaries, resource names/IDs, deployment policy and measured acceptance |
| Another subscription/region | Architecture principles and reusable modules | Root preflight target, generated frozen names, target guards such as `InventorySchemaHooks.Permit`, policy/quota/SKU/version checks and all source/evidence bindings |

This repository deliberately pins its approved target. Changing a parameter
file alone does **not** retarget all safety guards. Do not search-and-replace
subscription IDs, disable guards, edit old evidence hashes or relabel historical
receipts. Make reviewed source changes and create a fresh evidence epoch.

Never copy the local JWT seam, H2/RESP fixture, token endpoint or test observer
into production artifacts. Java `src\test` is intentionally outside production
JARs. Retain the repository's MIT notices and third-party notices when reusing
the sample.

### Small implementation example

Use the existing provider/API, not a second SDK:

```java
try (var span = Correlation.start("orders.validate", SpanKind.INTERNAL,
        context.parentContext(), context.invocationId(), Map.of());
     var scope = span.makeCurrent()) {
    command = new OrderCommand(orderId, sku, quantity);
}
inventory.lookup(command.sku(), context);
```

This is the existing Orders pattern, not a replacement controller or an Azure
proof. Let instrumented HTTP create/inject its actual span/carrier; never copy
business IDs into technical context, repair sampled flags or add fake database
server spans.

## 8. Troubleshooting and authoritative references

| Symptom | Action |
|---|---|
| Offline Maven misses a plugin/artifact | Use an existing explicit cache, or approve the declared restore and retry with `-RestoreDependencies`; never disable enforcer rules |
| `LOCAL_PAIR_OUTPUT_ALREADY_EXISTS` | Choose a new run directory; preserve the failed result |
| `LOCAL_PAIR_PRODUCT_HASH` / `GATE_*` | Rebuild/check the exact locked product; do not refresh hashes to fit unknown bytes |
| Missing Orders join | Check actual ingress **and** exports, correct servlet async dispatch, drain/expiry and exact current browser action; do not synthesize rows |
| Full-chain missing Gateway locally | Expected local limitation; use actual Azure native evidence for full-chain acceptance |
| `AZURE_DEPENDENCY_GATE_UNMET` | Resolve the real dependency/support decision and qualification; a command-line approval cannot bypass it |
| Package missing production dependencies | Restore/package on the approved runtime runner; do not enable unreviewed remote builds |
| SCM/main-site 403 | Repair the approved identity/network route; do not enable Basic auth or `0.0.0.0/0` |
| SQL/Redis test cleanup fails | Preserve the exact owned run ID for operator reconciliation; no global cleanup |

Official deployment references, checked for this handoff:
[ZIP/package layout](https://learn.microsoft.com/azure/app-service/deploy-zip),
[Entra deployment authentication](https://learn.microsoft.com/azure/app-service/deploy-authentication-types),
[Bicep what-if](https://learn.microsoft.com/azure/azure-resource-manager/bicep/deploy-what-if).
Product support/GA and the deployed runtime still require independent current
qualification; linking documentation does not close that gate.
