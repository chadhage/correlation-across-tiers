import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { validateCertificationManifest } from "./certification-path.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const owned = [
  "infra/main.bicep", "infra/params/poc.bicepparam", "infra/params/frozen-names.v1.json",
  "infra/modules/network.bicep", "infra/modules/root-access.bicep",
  "contracts/expected-boundary-map.v1.json", "config/certification-dependencies.json",
  "tools/architecture.mjs", "tools/names.mjs", "tools/root-preflight.mjs", "tools/Prepare-Root.ps1",
  "tools/root-candidate.mjs", "tools/certification-path.mjs",
  "tools/Prepare-DeploymentPackages.ps1",
  "tests/root-composition.test.mjs", "tests/architecture.test.mjs", "tests/names.test.mjs", "tests/certification-path.test.mjs",
  "README.md", "DECISIONS.md", "docs/ARCHITECTURE.md"
];
const modules = [
  "apim-service", "apim-observability", "apim-api-policies", "compute", "data-postgres", "data-managed-redis",
  "messaging", "messaging-roles", "network", "root-access", "security-keyvault", "security-secret-readers", "telemetry"
];
const artifacts = ["workbooks/contoso-correlation.workbook.json"];

async function hashes(files) {
  return Promise.all(files.map(async name => ({ path: name, sha256: sha256(await readFile(path.join(root, ...name.split("/")))) })));
}

export function assertRootWorkbookComposition(main, workbookText, mapSha256) {
  const workbook = JSON.parse(workbookText);
  const telemetry = main.resources?.telemetry?.properties;
  const resources = telemetry?.template?.resources;
  const values = Array.isArray(resources) ? resources : Object.values(resources ?? {});
  const ofType = type => values.filter(resource => resource.type === type);
  const workspaces = ofType("Microsoft.OperationalInsights/workspaces");
  const insights = ofType("Microsoft.Insights/components");
  const books = ofType("Microsoft.Insights/workbooks");
  const input = telemetry?.parameters?.workbookSerializedData?.value;
  const variable = typeof input === "string" ? /^\[variables\('([^']+)'\)\]$/.exec(input) : null;
  const serializedData = variable ? main.variables?.[variable[1]] : input;
  if (workbook.version !== "Notebook/1.0" || workbook.metadata?.certificationEligible !== false ||
      workbook.metadata?.sourceBoundaryMapSha256 !== mapSha256 ||
      serializedData !== workbookText ||
      workspaces.length !== 1 || insights.length !== 1 || books.length !== 1 ||
      books[0].properties?.sourceId !== telemetry.template.outputs.applicationInsightsResourceId.value ||
      insights[0].properties?.WorkspaceResourceId !== telemetry.template.outputs.logAnalyticsWorkspaceResourceId.value ||
      books[0].properties?.serializedData !== "[parameters('workbookSerializedData')]" ||
      main.outputs?.workbookResourceId?.value !== "[reference('telemetry').outputs.workbookResourceId.value]") {
    throw new Error("ROOT_WORKBOOK_COMPOSITION_INVALID");
  }
  return {
    workbookArtifactSha256: sha256(Buffer.from(workbookText)),
    sourceBoundaryMapSha256: mapSha256,
    compiledTextBinding: variable ? "fixed-string-compiler-variable" : "literal",
    declaredResourceCounts: { logAnalyticsWorkspaces: workspaces.length, applicationInsights: insights.length, workbooks: books.length },
    sameTelemetryResourceBindings: true,
    azureResourceObservationOrImport: "NOT_RUN",
    certification: "NOT_CERTIFIED"
  };
}

export async function writeRootCandidate(revision = "v4") {
  if (!/^v[2-9][0-9]*$/.test(revision)) throw new Error("A new revision must preserve historical v1 evidence.");
  const destination = path.join(root, "infra", `root-preparation-candidate.${revision}.json`);
  let existing = false;
  try { await access(destination); existing = true; }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (existing) throw new Error("ROOT_CANDIDATE_REVISION_ALREADY_EXISTS");
  const lock = JSON.parse(await readFile(path.join(root, "config", "versions.lock.json"), "utf8"));
  const beforeSources = await hashes(owned);
  const beforeModules = await hashes(modules.map(name => `infra/modules/${name}.bicep`));
  const beforeArtifacts = await hashes(artifacts);
  const compiledMain = await readFile(path.join(root, ".cache", "acting-r1", "main.json"));
  const compiledParams = await readFile(path.join(root, ".cache", "acting-r1", "foundation-parameters.json"));
  const mainTemplate = JSON.parse(compiledMain.toString("utf8").replace(/^\uFEFF/, ""));
  JSON.parse(compiledParams.toString("utf8").replace(/^\uFEFF/, ""));
  const workbookText = await readFile(path.join(root, "workbooks", "contoso-correlation.workbook.json"), "utf8");
  const workbookComposition = assertRootWorkbookComposition(mainTemplate, workbookText,
    beforeSources.find(source => source.path === "contracts/expected-boundary-map.v1.json").sha256);
  const dependencies = JSON.parse(await readFile(path.join(root, "config", "certification-dependencies.json"), "utf8"));
  let dependencyGatePassed = true;
  try { validateCertificationManifest(dependencies); } catch { dependencyGatePassed = false; }
  const testFiles = ["root-composition", "architecture", "names", "certification-path"].map(name => path.join(root, "tests", `${name}.test.mjs`));
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...testFiles], {
    cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 2 * 1024 * 1024, windowsHide: true
  });
  await writeFile(path.join(root, ".cache", "acting-r1", `root-tests-${revision}.tap`), run.stdout ?? "");
  if (run.status !== 0) throw new Error("Actual root test execution failed; no candidate PASS is recorded.");
  const count = field => {
    const match = new RegExp(`^# ${field} (\\d+)$`, "m").exec(run.stdout);
    if (!match) throw new Error("Actual root test summary missing.");
    return Number(match[1]);
  };
  const tests = { tests: count("tests"), passed: count("pass"), failures: count("fail"), skipped: count("skipped") };
  if (tests.tests === 0 || tests.failures !== 0 || tests.skipped !== 0 || tests.passed !== tests.tests) throw new Error("Root tests incomplete.");
  const afterSources = await hashes(owned);
  const afterModules = await hashes(modules.map(name => `infra/modules/${name}.bicep`));
  const afterArtifacts = await hashes(artifacts);
  if (!isDeepStrictEqual(beforeSources, afterSources) || !isDeepStrictEqual(beforeModules, afterModules) ||
      !isDeepStrictEqual(beforeArtifacts, afterArtifacts))
    throw new Error("Source changed during root validation.");
  const report = {
    schema: "contoso.root-structural-candidate.v1", revision, generatedAtUtc: new Date().toISOString(),
    historicalCandidatePreserved: "infra/root-preparation-candidate.v1.json",
    historicalAcceptedCompositionPreserved: "infra/root-preparation-candidate.v3.json",
    readiness: "READY_FOR_OTHER_ROLE_REVIEW", deploymentReady: false, certification: "NOT_CERTIFIED",
    implementationExecutor: "original-R3-acting-R1", logicalOwner: "R1", independentReviewers: ["original-R5", "original-R8"],
    target: { subscriptionId: "474c40eb-d385-40d8-baa2-06883dbdca2d", location: "centralus", workload: "contoso-corr", environment: "poc" },
    validationScope: "current-source-local-Bicep-compile-and-Node-root-guards-no-Azure-no-Maven-no-native",
    compiler: lock.portableTools.bicep,
    compiledOutputSha256: { main: sha256(compiledMain), foundationParameters: sha256(compiledParams) },
    ownSources: afterSources,
    mergedModuleInputs: afterModules,
    mergedArtifactInputs: afterArtifacts,
    workbookComposition,
    commands: [
      ".\\tools\\Prepare-Root.ps1 -BicepPath <existing-frozen-Bicep>",
      "node --test --test-reporter=spec .\\tests\\root-composition.test.mjs .\\tests\\architecture.test.mjs .\\tests\\names.test.mjs .\\tests\\certification-path.test.mjs",
      "node .\\tools\\architecture.mjs --check"
    ],
    observedRootGuardTests: tests,
    rootTestOutputSha256: sha256(Buffer.from(run.stdout)),
    sourcesStableBeforeAfterTests: true,
    certificationDependencyGatePassed: dependencyGatePassed,
    compilerWarnings: [
      "BCP081: existing PostgreSQL2026-10-01 and ManagedRedis2026-09-01 resource families lack compiler type schemas; compile is not ARM/SKU validation"
    ],
    unmetPrerequisites: [
      "approved publisher contact and provisioning/cost/quota/policy/name-availability evidence",
      "actual post-foundation Entra registrations/client-object/role/controller bindings",
      "approved SDK KeyVault secret SET/existing HMAC version/named-reader reference resolution",
      "separate SQL migration/dataset marker/OID-user/column-restricted grants",
      "authenticated SCM runner route, host container permissions and API ingress live proof",
      "unverified Node1.0.0-beta.46 exporter support/GA",
      "source-bound native trust-root receipts and actual runtime/carrier observer enrollment",
      "actual Azure workbook import/render, resource parameter selection and live screenshots",
      "current-source/build/loaded-used-instance/native/identity/all-role/artifact/retention and live certification evidence",
      "two accepted independent root source reviews"
    ],
    booleansAndReferencesAreNotEvidenceAuthority: true
  };
  await writeFile(destination, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await writeRootCandidate(process.argv[2] ?? "v4");
  console.log(JSON.stringify({ readiness: report.readiness, ownSources: report.ownSources.length,
    mergedModules: report.mergedModuleInputs.length, mergedArtifacts: report.mergedArtifactInputs.length,
    deploymentReady: false, certification: report.certification }));
}
