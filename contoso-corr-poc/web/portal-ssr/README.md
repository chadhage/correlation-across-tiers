# Contoso public Node host

One process cohosts the Vite Storefront and workload-only Portal. One
`@microsoft/opentelemetry` **1.5.0** provider instruments the native Node HTTP(S)
SSR path. No MSAL Node, Portal delegated login, caller-claim forwarding or
fabricated human pseudonym is used.
Public resource API **2.12.0** pins the canonical server role and an opaque
instance identity. Azure logger **1.4.0** is explicitly disabled, including its
diagnostic sink. HTTP hooks replace raw user-agent, caller Host URL and client
IP metadata; request/response header capture lists are empty. The
`enableSensitiveData` vendor option alone is not a blanket HTTP privacy guard.

## WEB-01.1 local Storefront rehearsal

This is **LOCAL REHEARSAL**, not Entra, APIM, real-store, Azure or certification
evidence. It does not initialize a second telemetry provider/exporter. The
test-only entrypoint builds the current Storefront source into a unique output
directory, uses the actual JS SDK and the existing real-click browser adapter,
and supplies synthetic pair credentials only in memory. It admits only Demo 01
and clicks the real **Run selected Contoso demo** button, not Create order.
The test-only click receipt requires one trusted click on `contoso-run-demo`.

After R4's `tools\java\Start-LocalPair.ps1` produces a ready `local-pair.json`,
run from `contoso-corr-poc` with a **new** repository-local output directory:

```powershell
node web\portal-ssr\scripts\local-rehearsal.mjs --pair evidence\local-pair\local-pair.json --out evidence\reviews\swarm-20261102\R2\local-browser-UNIQUE
```

The manifest must declare `schemaVersion: 1`, `profile: "LOCAL REHEARSAL"`,
`ready: true`, literal HTTP loopback `ordersOrigin`, `inventoryOrigin`,
`receiverOrigin` and `controlOrigin`, and `telemetryPath` / `ingressPath`
(relative to the manifest or absolute inside this repository). `GET controlOrigin/token`
returns synthetic `accessToken` and `gatewayAccessToken`; neither belongs in
the manifest, files, logs or evidence. The browser sends the former; the
loopback forwarder adds only the local gateway proof. Production authentication
is unchanged.

The uninstrumented forwarder maps `/contoso/v1/orders` to `/api/orders`,
preserving the browser's actual W3C carrier, request body and backend response.
It creates **no Gateway span**. It rejects foreign origins, unsafe preflights,
unapproved paths and redirects. A browser-wide allowlist permits only this run's
three loopback origins. Excluded-origin Fetch/XHR must send no correlation or
authorization headers, and a real second-origin CORS preflight must not reach
Orders.

PASS requires one successful actual browser click, its current SDK dependency,
the captured browser `RemoteDependencyData`, and an **actual agent-emitted**
Orders `RequestData` with the same trace and ParentId equal to that dependency's
span. The separate actual Orders ingress receipt must also preserve the whole
browser `traceparent`, including flags, and `tracestate` (including absence),
and join that actual emitted Orders span. An ingress echo, business-ID match alone, absent export, stale run,
unsampled carrier or synthesized row cannot satisfy the join. The driver
waits at most 45 seconds for the pair's incrementally written telemetry.
Original browser envelope IDs, time and optional parent are preserved;
missing context is never filled from an expected graph.

`browser-evidence.json`, `browser-telemetry.ndjson`,
`forwarder-observations.json`, before/after hashes of the 16 declared current
inputs, and `local-browser-rehearsal.json` contain no tokens or connection
configuration. The last receipt is BLOCKED on a missing join or changing
source. Browser/server cleanup runs on success and failure. The driver does
not own or stop R4's pair; its launcher owner must stop that separate process
after all consumers finish.

Focused source/unit checks (including a dedicated real Chromium, not a shared
browser page) run without writing shared `dist`, Maven targets or caches:

```powershell
node --test --test-reporter=tap web\portal-ssr\tests\local-rehearsal.test.mjs
```

Those tests use an explicitly labelled HTTP test responder, **not JVM Orders**.
They assert that missing actual Orders export fails; they cannot close
WEB-01.1 before JVM-01.1 runs. Optional
`CONTOSO_LOCAL_REHEARSAL_CAPTURE_DIRECTORY` saves only their sanitized real
browser records in a new repository-local directory, labelled
`BROWSER_ONLY_NOT_JVM_PARENT_JOIN`. Every helper and unique build scratch tree
is cleaned up. The full WEB-01 native parent remains **To Do**.

OpenTelemetry API is pinned to **1.9.1**, matching the published NodeSDK
0.221.0 peer constraint `>=1.3.0 <1.10.0`; blindly choosing latest API1.10.0
creates an incompatible split API graph. HTTP hook configuration is typed with
the published `HttpInstrumentationConfig`/Node `RequestOptions`, not a guessed
ClientRequest signature. Real fixture CLIENT headers and emitted parent joins
are regression assertions.

## Local build and focused checks

From the repository root, after the root-owned workspace restore:

```powershell
npm run compile --workspace @contoso/portal-ssr
npm run build --workspace @contoso/storefront-spa
npm run build --workspace @contoso/portal-ssr
npm run typecheck --workspace @contoso/portal-ssr
npm run test --workspace @contoso/portal-ssr
npm run test --workspace @contoso/storefront-spa
npm run test:browser --workspace @contoso/portal-ssr
```

The first command emits the shared Portal declarations before Storefront's
test typecheck consumes them. It uses the same declared compiler as the build,
not an install; stale declarations must not be mistaken for the new contract.
The following two builds still create the actual production/cohost artifact.

Browser fixtures require the already-declared Playwright 1.64.1 package and its
pinned Chromium revision 1248. The browser script rebuilds production and fixture entrypoints before running;
fixtures are not production Vite input/deployment:

```powershell
Set-Location .\web\portal-ssr
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PWD '.cache\browsers'
npm run test:browser
```

If the declared binary is missing, install that local browser with
`playwright.cmd install chromium`, setting TEMP/TMP to a project-local
`.cache\download-work` first. No global install is needed. Fixture collectors
retain SDK identities/allowlisted headers in memory; tests never persist
configurations, credentials, whole HARs or browser storageState.

## Runtime inputs

Set these through approved runtime settings; do not write actual values into
source, parameters, command lines, snapshots or evidence:

| Setting | Purpose |
|---|---|
| `CONTOSO_PUBLIC_ORIGIN` | Fixed public HTTPS frontend origin, never caller Host/Forwarded input |
| `CONTOSO_GATEWAY_ORIGIN` | Fixed public HTTPS APIM origin |
| `CONTOSO_TENANT_ID` / `CONTOSO_SPA_CLIENT_ID` | Approved public identity identifiers |
| `CONTOSO_ORDERS_API_CLIENT_ID` | v2 Orders audience GUID |
| `CONTOSO_DELEGATED_SCOPE` | Full resource-qualified SPA scope; align with R3/R8's actual short scope (`Orders.Invoke` after adjudication) |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | Server-resolved Key Vault reference; browser-public routing config, never persisted as a resolved value |
| `CONTOSO_EXECUTION_MODE` | `live` or `local`; production bootstrap rejects `fixture` |
| `CONTOSO_DEPLOYMENT_STAMP` | Safe non-sensitive build identifier |
| `CONTOSO_CERT_START` / `CONTOSO_CERT_END` / `CONTOSO_CERT_WINDOW_ID` | UTC `Z` timestamps, UUIDv4 lease, positive duration at most 7200 seconds; partial/malformed values fail closed |
| `CONTOSO_DEMOS_ENABLED` / `CONTOSO_PORTAL_DEMO_ENABLED` | Explicit enablement, not authorization |
| `CONTOSO_BROWSER_SAMPLING_PERCENTAGE` / `CONTOSO_SERVER_SAMPLING_PERCENTAGE` | Production values below 100; active declared certification uses 100 |
| `CONTOSO_PORTAL_MI_CLIENT_ID` | Optional user-assigned Portal identity selection; otherwise explicit system-assigned ManagedIdentityCredential |
| `CONTOSO_PORTAL_CONTROL_CLIENT_ID` / `CONTOSO_PORTAL_CONTROL_PRINCIPAL_ID` | Separate fixed authorized app-only controller actor; server-only config, not browser identity or evidence |
| `PORT` | Native host listening port; default 3000 |

Startup, from `web\portal-ssr`, is `node .\dist\bootstrap.js` or
`.\start.ps1`. It binds 0.0.0.0 and honors PORT. Missing configuration leaves
business actions disabled and `/health/ready` unavailable, without a dummy
connection string or credential. App Service deployment requires Node24-lts;
local validation on Node22.23.4 is not a deployed-image certification.

**Leaf deployment artifact:** build Storefront first, then Portal. The Portal
build copies the compiled SPA into `dist\storefront`; the server reads that
directory by default, not an external monorepo sibling. The artifact rooted at
`web\portal-ssr` therefore contains both surfaces and starts with
`node dist/bootstrap.js`. The monorepo-root local command remains
`node web/portal-ssr/dist/bootstrap.js`. Packaging fails closed if the SPA is
missing or contains statically resolved runtime config. It does not run Azure
deployment or write any secret value.
It also refuses missing redirect/assets, source maps, fixture/cache payloads,
symlinks and static connection strings/JWTs before replacing the generated
cohost directory.

For a source-free production package, run `npm run package:deployment` after
both builds. `deployment-artifact` contains only `dist`, `package.json` and a
frozen lockfile; its manifest has only the runtime start script and production
dependencies, not dev build/test entrypoints. From that artifact run
`npm ci --omit=dev --ignore-scripts --workspaces=false`, then `npm start`.
The production-only restore and standalone loopback missing-config smoke have
actually passed locally. Packaging is not Azure deployment or certification.
The root deployment owner must use this artifact or an equivalent explicit
exclusion/restore pipeline; do not upload `.cache`, tests or browser binaries.

## Identity and controller separation

Portal business calls use only ManagedIdentityCredential 4.14.1 requesting
`api://{OrdersClientId}/.default`, with Portal.Invoke assigned/validated at
the gateway/backend. APIM preserves that original app token and adds its own
independently validated gateway proof. The Portal never supplies the internal
gateway proof or trusts caller business-ID headers.

Before a real browser can submit a workload order, the fixed authorized
controller authenticates `POST /portal/session`. JOSE 6.2.13 verifies RS256,
fixed tenant issuer/JWKS, Orders audience, v2, idtyp=app, no scp, Portal.Invoke,
and exact configured client/principal. It issues a rotated, short-lived
HttpOnly/SameSiteStrict session. The subsequent form additionally needs a
matching origin, one-use CSRF value and active window. Missing actor settings
deny by default. A window, human token, trusted-looking header or Portal
identity label is not controller authorization.

Anonymous Portal landings are stateless and issue no session cookie. Only
successful controller authentication allocates one of the **100** active
session slots. Sessions expire after at most **15 minutes**, clamped to the
certification deadline; expired entries are reaped during lookup and login
allocation. Authenticated overflow returns bounded `429 PORTAL_DISABLED`,
without weakening actor authorization, origin or CSRF checks.

Portal form pages use same-origin referrer policy, preserving a nonopaque
Origin for strict CSRF checking without sending a cross-origin referrer.
Business URLs reject query strings and fragments. Other public pages default
to no-referrer.

## Current action and original workflow identity

Successful workflow mutations preserve `schemaVersion: 1`, ID, state and
details. `businessInvocationId` identifies the **current HTTP action** and
must match its validated response header. A separate required
`workflowBusinessInvocationId` identifies the **original stored workflow**.
Both are UUIDv4 values; a missing or invalid original identity rejects the
mutation, even if the action identity and header agree. It is never inferred
from the action ID.

GET retains the stored `businessInvocationId`, may have a different current
ingress response header, and does not need the added field. Refresh compares
the durable workflow identity, not the previous mutation's action identity;
session/invocation generation fences remain in force. SSR HTML and browser
controller backend results preserve the two identities separately. These
values are not authentication claims, HMAC pseudonyms or manufactured trace
IDs; telemetry still uses its actual validated current-action carrier.

No frontend control API was added. Existing order/demo methods and the shared
workflow mutation parser implement this approved contract; Java control
responses are the backend owner's separate interface.

`authorizeContosoPortalController(context, config, bearer)` in the built
browser adapter authenticates that actual session in memory using the context's
request/cookie jar. It never writes a cookie/token file. This setup HTTP call
is **not** the demo-driving browser dependency. `driveContosoBrowser` then
drives the actual UI/form clicks and emits only sanitized context/identity
observations. Control actor grants require separate approval; no directory or
Azure writes occur here.

The SPA controller's `prepare(spec)` returns a positive page-local
`invocationVersion`; results and evidence include that version, but backend
request DTOs do not. Preparation clears the prior result/dependency view.
Reused IDs, replacement during execution and more than 100 prepared IDs per
page reject visibly with `RUN_ID_REUSED`, `RUN_IN_PROGRESS` or
`RUN_CAPACITY_EXCEEDED`. No rolling eviction weakens reuse protection.
Dependency callbacks retain their send-time run/version, and the adapter
exports only identities matching the current action's captured POST
trace/span IDs. It requires that action's actual response and completion;
Portal completion still comes from genuine native navigation.

## Routes and contracts

* `/storefront/`, `/storefront/orders`, `/storefront/demos`
* `/storefront/auth/redirect.html`: MSAL v5 bridge only, no router/RUM
* `/storefront/runtime-config.v1.json`, `/portal/runtime-config.v1.json`
* `/portal/`, `POST /portal/session`, `POST /portal/orders`
* `/health/live`, `/health/ready`

Public config is injected as escaped nonexecutable JSON **before** the first
business Fetch, never through VITE_ bundling. Schema:
`contracts\public-runtime-config.v1.schema.json`. Typed cross-field validation
and public API DTOs: `src\shared\contracts.ts`.

R4 public DTOs are consumed exactly: `/contoso/v1/orders`, `/me`,
`/demo-runs`; backend `/api` is R3/R4-owned. A response state
`DURABLE_STAGED`/202 is displayed as staged, not broker/worker completion.
Only real returned identifiers/state are rendered. SAFE_DETAIL_KEYS excludes
arbitrary/raw payload metadata.

## Telemetry and live work still To Do

Published browser SDK 3.4.5 uses actual `DistributedTracingModes.W3C_TRACE`
(18). Its Request-Context metadata behavior remains separate from W3C/auth;
R3 CORS must allow it when emitted. Exact-origin veto explicitly returns false,
including when a reporter throws. Fetch/XHR exclusions do not pretend to scrub
arbitrary manually supplied headers; application transport offers no such
caller-header API.

Node preloads the published ESM loader before HTTP/application modules, uses
tracecontext-only propagation and the published sampler spelling
`parentbased_trace_id_ratio` (not a guessed standard alias), disables the
default rate cap for the explicit ratio profile, unused/GenAI/console/browser
autoinstrumentation, Live Metrics, SDK stats and disk retries. Identity and
query-bearing requests are ignored before injection/capture. At expiry the
single provider is shut down; the approved production restart/profile must be
verified by the coordinator. Browser RUM is unloaded at its window deadline.

The fixture receiver understands genuine SDK Azure envelopes, gzip and NDJSON.
The fixture-only public exporter endpoint override and loopback HTTP client
keep every test transmission local; they do not forge rows. The tests compare
the automatically injected CLIENT span ID with actual emitted SDK request/
dependency IDs and parentage. Production uses the unmodified vendor transport
and approved HTTPS ingestion endpoint; its live export/MI/GA path remains To Do.

**Fixtures are not certification.** Real Entra grants, controller proof,
Portal MI token acquisition, Node24 deployed image, APIM parent advancement
and `00` preservation, ingestion/KQL, canonical-header visibility, actual
Application Map/Transaction Diagnostics, resource privacy/cost/retention and
restart/reset remain live To Do until independently observed. Never substitute
fixture gateway responses or SDK collector summaries for Azure rows.

## Earlier locally verified implementation

On Windows/Node **22.23.4**, both production packages and the separate fixture
bundle built/typechecked with the pinned TypeScript/Vite versions. **23 Portal
Node tests, 3 Storefront Node tests and 24 Chromium tests passed** before the
current-action/original-workflow contract addition. These are historical counts,
not tests retroactively attached to the updated parser. The full
corrected browser suite was also independently rerun by the assigned core
reviewer. Checks cover actual SDK Fetch/XHR and native request/CLIENT parent
joins, strict unsampled propagation, domain/CORS veto, authenticated
controller/CSRF, generation-fenced refresh, absolute streaming/token deadlines,
foreign-lease refusal, independent expiry, response-free CLIENT business
enrichment, metadata privacy and truthful staged SSR results. Packaging
negative controls and isolated production-only restore/smoke also passed.

These are local qualifications, not live certificates. Use the compile/build
sequence above before test typecheck; tests consume the actual declarations.

## Scoped runtime control and observed identities

The fixed signed app controller can call `POST /portal/runtime-state`,
`/portal/runtime-stop-traffic`, or `/portal/runtime-drain` with exactly
`{schemaVersion:1, runId, revision:"cert-"+runId}`, fixed `Origin`, JSON content
type and an in-memory bearer. Authentication runs independently of those
fields. Mutating calls must match the original startup certification lease:
foreign requests are rejected before quiescing; the same expired lease can
drain, but a restored production process with no original lease rejects it.
Node drain uses the vendor's official shutdown; apply/restore require a process
restart, and browser apply/restore require reload. Delayed Portal reads cannot
overwrite a newer admitted mutation.

The response discriminator is `contoso.sampling-runtime-observation.v1`.
`actualRevision` is distinct from `requestedRevision`; safe observations report
actual PID/page identity, mode, initialized configuration, admission and time.
Global Node provider/exporter enumeration stays **null**, not 1; observations
are `ownershipPending`, `certificationEligible: false`, `NOT_CERTIFIED`.
Host `/health/ready` covers configuration/provider readiness, not backend,
Entra, complete graph or certification readiness.

Outbound credential acquisition plus HTTP/body handling has one absolute,
lease-clamped abort deadline, including continuously active responses. The
CLIENT business attribute comes from the actual validated outbound header
before a response, with response enrichment retained. No expected-ID or
normalizer backfill is used. A failed SERVER invocation keeps its own generated
opaque business header without pretending it reached the backend.

The public `/me` shape is `user` / `workload`, with a user-only colon HMAC
format. Native page-view IDs are preserved as context/display identities;
`browserContexts` reads the existing SDK context and never mints a span or
normalizes a view's 32-hex Id into a 16-hex span ID.

## Remaining qualification boundary

The actually resolved Node exporter is
`@azure/monitor-opentelemetry-exporter` **1.0.0-beta.46**. Its support/GA
classification must be adjudicated against the frozen certification path;
the distro's version/name does not certify its transitive dependencies.
Local SDK/HTTP/browser checks do not prove deployed Node24, real Entra/MI
grants, APIM parentage/CORS, Application Insights/KQL/visualizations, independent
ownership, full-path fidelity, approved retention or operational reset.

These are labeled local fixtures, not a live Azure pass. Production startup,
scope/client/role grants, managed identity, Node24 platform image and live
workspace/visualization/reset evidence require the separately approved live
actions above.
