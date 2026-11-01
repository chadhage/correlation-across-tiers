# Contoso Storefront

Vite 8.3.5 / TypeScript 7.0.2, Application Insights JS 3.4.5 and MSAL Browser
5.27.0. The production bundle has no connection-string/credential value:
the public Node host resolves settings and injects validated, escaped runtime
JSON before the SDK and business Fetch calls initialize.

The Entra flow is authorization code + PKCE with a dedicated
`/storefront/auth/redirect.html` bridge, no RUM/router on that bridge and no
MSAL result/account/token logging. The configured resource-qualified scope and
bare Orders audience must agree with the approved R8/R3 identity contract.

The app drives real order/demo API calls, renders returned durable state and
canonical business identity, and displays only the own-user HMAC pseudonym
from `/me`. Public clients cannot claim trusted invocation IDs. The Portal is
a separate workload principal, not a delegated user or human pseudonym.

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

Run `npm run build --workspace @contoso/storefront-spa` and
`npm run test --workspace @contoso/storefront-spa` from the root after its
approved restore/build. See the Portal README for full cohost inputs and
fixture browser commands. Fixture entrypoints live only under Portal tests and
`.cache`; the production `main.ts` explicitly rejects fixture configuration.

Live authentication, actual browser-to-gateway rows/KQL, domain/CORS negative
controls against APIM and visualizations remain **To Do**. Browser fixture
success and 202/staged state are not Azure certification.
