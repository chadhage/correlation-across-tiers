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

## GitHub Pages

The published walkthrough is available at
[chadhage.github.io/correlation-across-tiers](https://chadhage.github.io/correlation-across-tiers/).

The [Pages workflow](../../../.github/workflows/pages.yml) runs the focused tests,
builds the committed source snapshot, and deploys only the generated microsite
on pushes to `main`. It can also be run manually from the repository's Actions
tab. Generated output remains ignored; no repository files outside the built
page are uploaded.

GitHub Pages must use **GitHub Actions** as its source under
**Settings > Pages > Build and deployment**. Publishing does not run demos,
query telemetry, configure environment launch URLs, or change certification
status.

## Start here guide

The **Start here** modal opens on every document load, including direct scenario
links. No seen/dismissed flag is stored. Incoming scenario selection is applied
before the guide opens; **Continue exploring**, Close, Escape or the backdrop
dismisses it without changing that selection. Reopen it with
**Menu > Start here / Site guide**.

The guide covers purpose, contents, audience, a repeatable scenario workflow,
observations, considerations and embedded references. Its scenario links come
from the current catalog. Section and scenario links close the guide and focus
their destination; source controls hand off to the existing source viewer
without stacking dialogs. The scrollable guide keeps its heading and exit
controls visible, contains keyboard focus and locks background scrolling.

## Presenter flow

Use the header's **Menu** button to open the navigation drawer on desktop or
mobile. Section links close the drawer and focus their destination. Escape,
the Close button, or the backdrop dismisses it; keyboard focus stays inside
while open, and background scrolling is locked. Theme and environment settings
are also available in the drawer. The **GitHub repository** link opens
[this repository](https://github.com/chadhage/correlation-across-tiers) in a
new tab without changing the walkthrough.

1. Establish scope using the source-inventory counts and **NOT CERTIFIED** label.
2. Select a catalog scenario, or search by title, ID, criterion or boundary.
   `#demo-08` opens a specific scenario.
3. Switch between **Boundary graph** and **Sequence diagram**, then select a
   boundary or sequence row for its shared contract inspector. Solid arrows are
   declared parent edges; dashed arrows are links, never return messages.
4. Review recorded local evidence and its limits. Receipt digest comparison is
   file consistency at build time, not current source/runtime attestation.
5. Open embedded source documents or inspect the manual run/reset/KQL templates.
   Templates contain review placeholders and are not executable controls.

## Sequence diagrams

Every catalog scenario has an offline SVG sequence diagram derived from its
required boundaries and the same boundary map as the graph. Lifelines are
application roles; PostgreSQL/Redis remain CLIENT self-operations, and no
database, broker, initiator or response spans are invented.

Numbered rows follow dependency order, not observed timing, concurrency,
delivery counts or durations. Each relationship appears separately; multiple
parent rows targeting one boundary describe invocation templates, not a span
with multiple parents. A dot means no incoming relationship is in the selection,
not proof that the boundary is a root. Link cardinality is retained. The selected
view persists while browsing scenarios, supports keyboard boundary inspection,
and scrolls horizontally on narrow screens.

## Environment launch links

Use **Menu > Environment settings** to configure Storefront, Portal SSR and optional
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
in the navigation drawer at every screen size.

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
