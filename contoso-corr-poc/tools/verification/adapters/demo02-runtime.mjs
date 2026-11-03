import path from "node:path";
import { fileURLToPath } from "node:url";
import { HASH, UUID, validateBoundaryMap } from "../../observability/telemetry-contract.mjs";
import { readBoundFile, sha256 } from "../files.mjs";
import { VerificationFailure } from "../invariants.mjs";
import { immutableReceiptMetadata } from "../observers.mjs";

const fail = (code, message) => { throw new VerificationFailure(code, message); };
export const DEMO02_SOURCE_PATHS = Object.freeze([
  "tools\\verification\\adapters\\demo02-runtime.mjs",
  "tools\\verification\\adapters\\demo01-runtime.mjs",
  "tools\\verification\\demo.mjs",
  "tools\\verification\\files.mjs",
  "tools\\verification\\invariants.mjs",
  "tools\\verification\\observers.mjs",
  "tools\\verification\\trust-roots.mjs",
  "tools\\verification\\sampling-qualification.mjs",
  "tools\\verification\\conditional-observer.mjs",
  "tools\\observability\\telemetry-contract.mjs",
  "tools\\observability\\raw-query.mjs",
  "tools\\observability\\sampler-native-intake.mjs",
  "tools\\security\\av23-check.mjs",
  "tools\\security\\native-payload.mjs",
  "tools\\security\\values.mjs",
  "contracts\\expected-boundary-map.v1.json",
  "demos\\catalog.json",
  "demos\\02\\Run.ps1",
  "demos\\02\\Reset.ps1",
  "demos\\02\\demo.json",
  "web\\portal-ssr\\src\\browser-adapter.ts",
  "web\\portal-ssr\\src\\browser\\portal-client.ts",
  "web\\portal-ssr\\src\\shared\\contracts.ts",
  "web\\portal-ssr\\src\\shared\\browser-telemetry.ts",
  "web\\portal-ssr\\src\\bootstrap.ts",
  "web\\portal-ssr\\src\\config.ts",
  "web\\portal-ssr\\src\\control-auth.ts",
  "web\\portal-ssr\\src\\gateway.ts",
  "web\\portal-ssr\\src\\server.ts",
  "web\\portal-ssr\\src\\telemetry.ts",
  "web\\portal-ssr\\package.json",
  "web\\storefront-spa\\src\\app.ts"
]);
const sourceSnapshot = () => Promise.all(DEMO02_SOURCE_PATHS.map(async file => ({
  path: file, sha256: sha256(await readBoundFile(file))
})));
const loadedSources = await sourceSnapshot();
const exactKeys = (value, names) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));

export async function verifyDemo02Sources(sources) {
  if (!Array.isArray(sources) || sources.length !== loadedSources.length
    || sources.some((source, index) => !exactKeys(source, ["path", "sha256"])
      || source.path !== loadedSources[index].path || !HASH.test(source.sha256 ?? "")
      || source.sha256 !== loadedSources[index].sha256)
    || JSON.stringify(loadedSources) !== JSON.stringify(await sourceSnapshot())) {
    fail("D_DEMO02_SOURCE", "The exact declared loaded Demo 02 construction sources must remain unchanged");
  }
  return immutableReceiptMetadata(loadedSources);
}

export function demo02PortalSpec(context, sku) {
  if (context?.schema !== "contoso.demo-context.v1" || context.demoId !== "02" || !UUID.test(context.runId ?? "")
    || !["LocalValidate", "BootstrapValidate", "Certify"].includes(context.mode)
    || context.spec?.id !== "02" || context.spec.scenario !== "SYNC" || context.spec.assertion !== "ssr"
    || !/^CONTOSO-[A-Z0-9-]{1,40}$/.test(sku ?? "")) {
    fail("D_DEMO02_INPUT", "Demo 02 requires its own context, fresh run ID and prepared single-SKU lease");
  }
  if (context.signal?.aborted) fail("D_DEMO02_ABORTED", "Demo 02 trigger input was cancelled");
  return immutableReceiptMetadata({ schemaVersion: 1, runId: context.runId, demoId: 2, kind: "portal", sku, quantity: 1 });
}

export function inspectDemo02BoundaryContract(map, catalog) {
  try { validateBoundaryMap(map); } catch { fail("D_DEMO02_BOUNDARY", "The single reviewed boundary-map schema is required"); }
  if (!exactKeys(catalog, ["schema", "boundaryMap", "sourceAcceptanceIsCertification", "defaultMode", "demos"])
    || catalog.schema !== "contoso.demo-catalog.v1" || catalog.boundaryMap !== "contracts\\expected-boundary-map.v1.json"
    || catalog.sourceAcceptanceIsCertification !== false || catalog.defaultMode !== "LocalValidate"
    || !Array.isArray(catalog.demos)) fail("D_DEMO02_CATALOG", "The source catalog cannot grant runtime authority");
  const specs = catalog.demos.filter(item => item.id === "02");
  const spec = specs[0];
  if (specs.length !== 1 || !exactKeys(spec, ["id", "title", "brief", "criteria", "scenario", "paths", "requiredBoundaries", "assertion", "purpose"])
    || spec.scenario !== "SYNC" || spec.assertion !== "ssr" || JSON.stringify(spec.paths) !== '["ssr","sync"]'
    || !Array.isArray(spec.requiredBoundaries)
    || ["portal.request", "portal.gateway", "gateway.request", "gateway.backend"].some(id => !spec.requiredBoundaries.includes(id))) {
    fail("D_DEMO02_CATALOG", "Demo 02 must retain its own SSR scenario and required Gateway boundaries");
  }
  const roles = [
    ["storefront.http", "contoso-storefront-spa", "CLIENT"],
    ["portal.request", "contoso-portal-ssr", "SERVER"],
    ["portal.gateway", "contoso-portal-ssr", "CLIENT"],
    ["gateway.request", "contoso-corr-poc-apim", "SERVER"]
  ];
  for (const [id, role, kind] of roles) {
    const boundary = map.spans.find(item => item.id === id);
    if (boundary?.roleName !== role || boundary.semanticKind !== kind)
      fail("D_DEMO02_BOUNDARY", "Stable browser, SSR and Gateway roles and semantic kinds must remain distinct");
  }
  const edges = [
    ["portal.request", "portal.gateway", "ssr"],
    ["portal.gateway", "gateway.request", "ssr"],
    ["storefront.http", "gateway.request", "spa"]
  ];
  for (const [from, to, route] of edges) {
    if (map.edges.filter(item => item.from === from && item.to === to && item.type === "parent" && item.path === route).length !== 1)
      fail("D_DEMO02_BOUNDARY", "Actual SSR and SPA parent assertions must not be deleted, relabelled or duplicated");
  }
  const roots = map.deliberateRoots?.filter(item => item.boundary === "portal.request") ?? [];
  if (roots.length !== 1 || typeof roots[0].reason !== "string"
    || !/document render/i.test(roots[0].reason) || !/browser page telemetry/i.test(roots[0].reason)
    || !/distinct roots/i.test(roots[0].reason) || map.edges.some(item => item.to === "portal.request")) {
    fail("D_DEMO02_BOUNDARY", "The declared SSR root must not manufacture a browser-to-render parent");
  }
  return immutableReceiptMetadata({
    sourceKind: "expected-boundary-contract-only", demoId: "02", nativeExecution: "NOT RUN",
    browserPageTelemetryRole: "contoso-storefront-spa", serverRenderRole: "contoso-portal-ssr",
    requiredParentEdges: edges.map(([from, to, route]) => ({ from, to, path: route })),
    separateRootBoundary: "portal.request", separateRootExplanation: roots[0].reason,
    browserPageViewIdentity: "Original page-view context only; a 32-hex display Id is not a request/dependency span",
    observedRoots: "NOT CAPTURED; different role names alone do not prove separate roots"
  });
}

export async function inspectDemo02Construction(...args) {
  if (args.length) fail("D_ARGUMENT", "The source inspector accepts no callbacks, observations, targets or authority options");
  await verifyDemo02Sources(loadedSources);
  const map = JSON.parse((await readBoundFile("contracts\\expected-boundary-map.v1.json")).toString("utf8"));
  const catalog = JSON.parse((await readBoundFile("demos\\catalog.json")).toString("utf8"));
  const boundaryContract = inspectDemo02BoundaryContract(map, catalog);
  const bridge = (await readBoundFile("web\\portal-ssr\\src\\browser-adapter.ts")).toString("utf8");
  const portal = (await readBoundFile("web\\portal-ssr\\src\\browser\\portal-client.ts")).toString("utf8");
  if (!bridge.includes("export async function authorizeContosoPortalController(")
    || !bridge.includes("export async function driveContosoBrowser(") || !bridge.includes("contoso-submit-ssr-order")
    || !portal.includes('value.kind !== "portal" || value.demoId !== 2')) {
    fail("D_DEMO02_SOURCE", "The shipped Demo 02 controller and real form-navigation interfaces changed");
  }
  const pattern = (await readBoundFile("tools\\verification\\adapters\\demo01-runtime.mjs")).toString("utf8");
  const appPath = "web\\storefront-spa\\src\\app.ts";
  const bindingLine = pattern.split(/\r?\n/).find(line => line.includes(JSON.stringify(appPath).slice(1, -1)) && /[a-f0-9]{64}/.test(line));
  const authorFrozenAppSha256 = bindingLine?.match(/['"]([a-f0-9]{64})['"]/)?.[1] ?? null;
  const sources = await verifyDemo02Sources(loadedSources);
  const currentAppSha256 = sources.find(item => item.path === appPath).sha256;
  return immutableReceiptMetadata({
    schema: "contoso.demo02-runtime-construction.v1", result: "BLOCKED", runnableDemoAdapter: false,
    nativeExecution: "NOT RUN", sourceAcceptanceIsCertification: false, certificationStatus: "NOT CERTIFIED",
    sourceBinding: "DECLARED LOADED CONSTRUCTION BYTES ONLY; NOT COMPLETE TRANSITIVE RUNTIME CLOSURE, REVIEW OR NATIVE ENROLLMENT",
    boundaryContract,
    availableSourceInterfaces: {
      triggerInput: "demo02PortalSpec; request input only, never observed identity or native execution",
      controllerAuthentication: "authorizeContosoPortalController; separate fixed app-only controller session before business action",
      portalAction: "driveContosoBrowser with kind portal/demoId 2; real contoso-submit-ssr-order click and next document result",
      storefrontObservation: "Capture original Storefront PageviewData separately; never borrow Portal browser role or convert its display Id to a span",
      server: ["createContosoServer", "createPortalGateway", "initializeTelemetry"],
      providerScope: "Existing bootstrap/telemetry implementation; source presence is not runtime provider or deployed-image proof"
    },
    coupledDemo01Source: {
      module: "tools\\verification\\adapters\\demo01-runtime.mjs", authorFrozenAppSha256, currentAppSha256,
      sourceBindingMatches: authorFrozenAppSha256 === currentAppSha256,
      nativeReadinessInherited: false, composition: "No Demo 01 adapter or PASS is composed or exported"
    },
    blockingInterfaces: [
      { id: "approved-deployed-portal-and-storefront", requiredBy: ["prepare", "execute"],
        missing: "Reviewed WEB-01/WEB-03 runtime, pinned Portal host image, actual controller authorization and separately approved target/window" },
      { id: "independent-two-root-and-gateway-observation", requiredBy: ["execute", "collect"],
        missing: "Independent actual Storefront page and SSR render captures, original emission ledger, Gateway wire and SSR-to-Gateway parent join" },
      { id: "native-query-and-privacy-capability", requiredBy: ["collect", "scanPrivacy"],
        missing: "Enrolled authenticated RAW query transport, original capture capabilities and full original-column privacy scan" },
      { id: "native-sampling-and-drain", requiredBy: ["prepare", "drain", "observeSampling", "stopTraffic", "reset"],
        missing: "Concrete bounded native inventory/admission/apply/observe/restore/stop operations; browser settings are insufficient" },
      { id: "run-owned-baseline-and-reset", requiredBy: ["prepare", "reset"],
        missing: "Concrete original live baseline handle, owned traffic drain and restoration leaving unowned state unchanged" },
      { id: "durable-authenticated-recovery", requiredBy: ["restoreCapturedRun"],
        missing: "Separate-process authenticated recovery operation; saved hashes cannot restore baseline values" },
      { id: "reviewed-native-dem00-predecessor", requiredBy: ["prepare", "execute", "collect", "reset"],
        missing: "DEM-00.1 native-ready operations and current reviewed predecessor closure; stale Demo 01 source pins remain rejected, never blindly repinned" }
    ],
    exactChildAcceptance: "UNMET_NATIVE_PREREQUISITES; demos\\02\\Run.ps1 still cannot load a concrete native adapter",
    sources
  });
}

export async function demo02ConstructionMain(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== "--check") fail("D_ARGUMENT", "Only the source-only --check operation is available");
  return inspectDemo02Construction();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(await demo02ConstructionMain(), null, 2)}\n`); process.exitCode = 2; }
  catch (error) { process.stderr.write(`${error instanceof VerificationFailure ? error.code : "D_DEMO02_CONSTRUCTION"}\n`); process.exitCode = 1; }
}
