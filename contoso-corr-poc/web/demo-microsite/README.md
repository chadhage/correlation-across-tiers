# Correlation engineering microsite

A separate, read-only presenter surface for this repository. It does not change
the Storefront or Portal applications, create telemetry, run demos, query Azure,
or grant execution/deployment authority.

## Build and preview

From `contoso-corr-poc`, using the repository's Node runtime:

```powershell
npm run microsite:build
npm run microsite:serve
```

Open `http://127.0.0.1:4174`. An alternate port can be supplied with
`npm run microsite:serve -- --port 4175`. The server binds to loopback only and
serves only the generated page. It builds once at startup, not in watch mode.

The generated [dist/index.html](dist/index.html) is self-contained and also opens
directly from disk. There are no external scripts, fonts, assets, analytics, or
network requests. The page's content security policy disallows connections.
Rebuild after changing source files or receipts. Generated output is ignored;
the build scripts and template are the persistent source.

```powershell
npm run microsite:test
```

The focused tests also participate in the existing repository test discovery.
They do not run native probes or cloud workloads.

## Presenter flow

1. Establish scope using the source-inventory counts and **NOT CERTIFIED** label.
2. Select a catalog scenario, or search by title, ID, criterion or boundary.
   `#demo-08` opens a specific scenario.
3. Inspect the graph and select a boundary. Solid arrows are declared parent
   edges; dashed arrows are declared links. No observed IDs, timings, repeated
   deliveries, or completed Azure runs are fabricated.
4. Review recorded local evidence and its limits. Receipt digest comparison is
   file consistency at build time, not current source/runtime attestation.
5. Open embedded source documents or inspect the manual run/reset/KQL templates.
   Templates contain review placeholders and are not executable controls.

## Environment launch links

Use **Environment settings** to configure Storefront, Portal SSR and optional
Gateway base URLs. Empty entries leave launch controls disabled. URLs are stored
only in this browser's local storage; blocked storage is reported and settings
remain page-session-only. Clearing settings removes the stored URLs.

HTTPS is required except for HTTP on `localhost`, `127.0.0.1`, or `[::1]`.
Credentials, query parameters and fragments are rejected. Do not enter secrets,
tokens or signed URLs. Links open in a separate tab with no opener or referrer.
The microsite does not check reachability, authentication, deployment status, or
telemetry. Opening a Gateway URL is not an authenticated API test.

Theme follows the browser preference. `?clawpilotTheme=light` and
`?clawpilotTheme=dark` select a theme explicitly; a theme control is available
in the desktop header.

## Source and evidence boundaries

- Scenarios and required boundaries come from
  [the catalog](../../demos/catalog.json).
- Graph nodes, roles, edges and root rules come from
  [the single boundary map](../../contracts/expected-boundary-map.v1.json).
  The existing architecture validator is reused during the build.
- Counts and scopes of historical local execution come from the
  [verification register](../../config/verification-register.v1.json).
  Selected register fields are embedded, not the entire claim inventory.
- Referenced receipt bytes are hashed at build time. Missing or changed receipts
  are visibly flagged, not treated as accepted evidence. Other read errors fail
  the build. Raw execution payloads are never embedded.
- Selected repository documentation, all catalog scenario READMEs and the three
  KQL templates are embedded with source hashes for offline inspection.

The site remains **NOT CERTIFIED**. Current source/runtime parity, full graph,
Azure acceptance, global privacy, performance, loss accounting and accountable
owner signoffs are not established by this artifact. A changed certification
status requires a deliberate review of the site's scope before it can build.
