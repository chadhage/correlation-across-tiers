# Contoso public Node host

One process cohosts the Vite Storefront and workload-only Portal. One
`@microsoft/opentelemetry` **1.5.0** provider instruments the native Node HTTP(S)
SSR path. No MSAL Node, Portal delegated login, caller-claim forwarding or
fabricated human pseudonym is used.

OpenTelemetry API is pinned to **1.9.1**, matching the published NodeSDK
0.221.0 peer constraint `>=1.3.0 <1.10.0`; blindly choosing latest API1.10.0
creates an incompatible split API graph. HTTP hook configuration is typed with
the published `HttpInstrumentationConfig`/Node `RequestOptions`, not a guessed
ClientRequest signature. Real fixture CLIENT headers and emitted parent joins
are regression assertions.

## Local build and focused checks

From the repository root, after the root-owned workspace restore:

```powershell
npm run build --workspace @contoso/storefront-spa
npm run build --workspace @contoso/portal-ssr
npm run typecheck --workspace @contoso/portal-ssr
npm run test --workspace @contoso/portal-ssr
npm run test --workspace @contoso/storefront-spa
```

Browser fixtures require the already-declared Playwright 1.64.1 package and its
pinned Chromium revision 1248. Build the fixture entry separately; it is not in
the production Vite input/deployment:

```powershell
Set-Location .\web\portal-ssr
.\node_modules\.bin\vite.cmd build --config .\tests\browser\vite.fixture.config.ts
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PWD '.cache\browsers'
.\node_modules\.bin\playwright.cmd test --config .\playwright.config.ts
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
| `CONTOSO_CERT_START` / `CONTOSO_CERT_END` / `CONTOSO_CERT_WINDOW_ID` | Explicit bounded UTC certification window |
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

## Locally verified implementation

On Windows/Node **22.23.4**, both production packages and the separate fixture
bundle build/typecheck with the pinned TypeScript/Vite versions. **11 native
unit/server/auth tests and 9 real Chromium tests pass**. The browser is the
Playwright-pinned **156.0.8078.4 / revision1248**. Checks include genuine JS SDK
Fetch/XHR state and dependency receipts, active veto with a throwing reporter,
browser-enforced CORS denial, actual emitted Node request/CLIENT parent joins,
sampled=00 preservation/parent advancement, authenticated controller/CSRF, and
truthful staged SSR rendering without a human pseudonym.

The session/run-lifecycle follow-up separately passes **2 focused native
checks and 5 real Chromium checks**, including anonymous bursts, authenticated
capacity/expiry, sequential-run isolation, reuse/in-progress rejection and
bounded page capacity. These are fixture qualifications, not additional live
certificates. Build Portal before its test typecheck, since tests consume the
actual compiled adapter declarations.

These are labeled local fixtures, not a live Azure pass. Production startup,
scope/client/role grants, managed identity, Node24 platform image and live
workspace/visualization/reset evidence require the separately approved live
actions above.
