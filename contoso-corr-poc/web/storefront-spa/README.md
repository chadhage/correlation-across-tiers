# Contoso Storefront

Vite 8.3.5 / TypeScript 7.0.2, Application Insights JS 3.4.5 and MSAL Browser
5.27.0. The production bundle has no connection-string/credential value:
the public Node host resolves settings and injects validated, escaped runtime
JSON before the SDK and business Fetch calls initialize.

The Entra flow is authorization code + PKCE with a dedicated
`/storefront/auth/redirect.html` bridge, no RUM/router on that bridge and no
MSAL result/account/token logging. The configured resource-qualified scope and
bare Orders audience must agree with the approved R8/R3 identity contract.
The scope is exactly `api://{OrdersClientId}/Orders.Invoke`. Ambiguous cached
accounts are not silently selected; interactive sign-in explicitly selects an
account. An interaction-required result remains an error until the user signs
in again, and no business request is sent.

The app drives real order/demo API calls, renders returned durable state and
canonical business identity, and displays only the own-user HMAC pseudonym
from `/me`. Public clients cannot claim trusted invocation IDs. The Portal is
a separate workload principal, not a delegated user or human pseudonym.
The actual identity response uses `user` / `workload`; only `user` can expose
`h1:<32-lowercase-hex-version>:<43-base64url-HMAC>`. POST success requires the
exposed business header to match the returned **current-action**
`businessInvocationId` and the requested workflow ID to match the returned ID.
Every successful workflow mutation must also return a valid UUIDv4
`workflowBusinessInvocationId` for the original stored workflow; missing or
invalid values fail rather than falling back to the action identity. Repeated
order/demo submissions can therefore return new action B with unchanged
workflow A. Both are displayed with distinct labels and preserved in the
controller's backend result, not used as authentication or trace identities.
A GET retains the workflow's original business ID even when its current
ingress response header is different and omits the added field. Refresh
checks workflow A, not the previous action B, without relaxing result fences.
There is no newly introduced frontend control method.

Route changes produce actual page-view telemetry. SDK W3C_TRACE (18) generates
Fetch/XHR context. Exact-origin checks **return false** to veto SDK injection;
request transport rejects unapproved paths/redirects. Request/response header
and raw exception capture, persistent analytics cookies/storage are disabled;
URL query/fragment/userinfo and sensitive metadata are stripped.

Stable real UI selectors and `window.contosoDemos` support the sibling Portal
package's browser adapter. It drives real clicks, not mocked HTTP results;
only sanitized context/header/SDK identity observations leave the adapter.
SSR form navigation completion is observed on the next document, never
fabricated when the button is clicked.

`prepare(spec)` invalidates the previous result/dependency view and returns a
page-local invocation version. Send-time SDK identities are scoped to the
current action; the adapter additionally matches its actual POST trace/span
IDs. Reused run IDs, replacement during execution and more than 100 prepared
IDs per page reject visibly instead of returning stale evidence or evicting
reuse protection. Normal subsequent clicks use fresh run IDs.
Delayed refresh successes and failures are fenced by invocation version,
workflow/collection and refresh generation. They cannot repaint a newer order.
Both credential acquisition and response reading have an absolute deadline
clamped to the active lease; redirects and oversized/non-JSON responses fail.

`runtimeState()`, `observeSampling({runId, revision})`, `stopTraffic()` and
`drain()` expose only safe existing-instance configuration/admission. The
approved maximum window is **7200 seconds**, with UTC timestamps and UUIDv4
window identity. Expiry also fences programmatic sends. There is no hot
sampler setter or resume: configuration changes require a fresh document.
Observations remain `NOT_CERTIFIED`, with `ownershipPending` and
`certificationEligible: false`.

`browserContextIdentity()` reads `core.getTraceCtx(false)` without creating
IDs. The adapter preserves these snapshots in `browserContexts`. An observed
SDK 3.4.5 initial page view has a **32-hex display Id** equal to its OperationId,
with no parent/context span ID. It is not a manufactured request/dependency
span; a missing context parent remains unproven rather than filled from a map.

Run `npm run build --workspace @contoso/storefront-spa` and
`npm run test --workspace @contoso/storefront-spa` from the root after its
approved restore/build. See the Portal README for full cohost inputs and
fixture browser commands. Fixture entrypoints live only under Portal tests and
`.cache`; the production `main.ts` explicitly rejects fixture configuration.

Live authentication, actual browser-to-gateway rows/KQL, domain/CORS negative
controls against APIM and visualizations remain **To Do**. Browser fixture
success and 202/staged state are not Azure certification.

Local-mode pages explicitly display **LOCAL REHEARSAL**, including the bounded
window. The local browser driver uses the actual Storefront source and SDK with
an in-memory synthetic identity seam, never the production Entra entrypoint.
See the Portal README for the loopback pass-through driver and its required
actual Orders exported parent join. Its local UI/SDK checks alone cannot close
WEB-01.1, and neither local result closes a live WEB-01 facet.
