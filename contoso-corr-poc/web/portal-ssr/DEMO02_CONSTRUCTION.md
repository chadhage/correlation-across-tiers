# Demo 02 source construction — BLOCKED

`tools\verification\adapters\demo02-runtime.mjs` consumes the existing
`contoso.demo-adapter.v1` construction contract. It deliberately exports no
`createAdapter` or `adapter`: required concrete native operations are missing.
It is **not** a runnable adapter, a completed DEM-02.1 child or native evidence.

From `contoso-corr-poc`:

```powershell
node tools\verification\adapters\demo02-runtime.mjs --check
node --test --test-reporter=tap web\portal-ssr\tests\demo02-construction.test.mjs
```

`--check` exits **2**, with `BLOCKED`, `runnableDemoAdapter: false`,
`nativeExecution: "NOT RUN"` and `NOT CERTIFIED`. It performs no network,
controller authentication, traffic, configuration, reset or deployment.
Other commands/authority options fail. The existing Demo 02 Run wrapper still
cannot load a concrete adapter; `D_MISSING_ADAPTER` is not claimed resolved.

## Actual source interfaces

`demo02PortalSpec` constructs only the existing Portal form input:
`kind: "portal"`, `demoId: 2`, the run's fresh UUID and owned synthetic SKU.
Requested business identity never becomes observed identity.
`authorizeContosoPortalController` authenticates the separate app-only
controller; `driveContosoBrowser` clicks the actual SSR form and observes the
next document. No arbitrary callback, fake HTTP result or inherited Demo 01
PASS fills a missing operation.

The source inspector binds the single map/catalog and requires:

- Stable Storefront browser and Portal server roles.
- `portal.request → portal.gateway → gateway.request` actual parent assertions.
- The SPA `storefront.http → gateway.request` parent assertion, separately.
- The map's explicit Portal render/root explanation, not a fabricated browser
  parent. Different roles alone do not demonstrate independent roots.
- Original Storefront page-view context separately from native SSR spans.
  A browser's 32-hex page-view display Id is not a manufactured span.

The declared loaded source snapshot is checked before/after inspection.
It is not a claim of complete transitive runtime closure, independent review,
deployed bytes or native enrollment. Stale Demo 01 author-frozen component
pins are reported, not silently updated or treated as runtime readiness.

## Exact unfinished native remainder

DEM-00.1 native-ready operations and reviewed WEB-01/WEB-03 runtime contracts;
approved deployed Storefront/Portal and pinned host image; real controller
authorization; a separately approved bounded window; independent browser/SSR
root, emission and Gateway-wire observations; authenticated RAW query/privacy
capabilities; concrete sampling/admission/drain operations; original run-owned
baseline/reset and authenticated separate-process recovery.

Source/unit success is construction only. It cannot satisfy this native child,
the shipped Run/reset acceptance, Bootstrap certification or any Azure claim.
