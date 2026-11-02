import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemo01Collector, DEMO01_COLLECTOR_SOURCE_SHA256 } from '../../observability/demo01-collector.mjs';
import { scanGraphIntake, policySha256 } from '../../security/telemetry.mjs';
import { readBoundFile, sha256 } from '../files.mjs';
import { VerificationFailure } from '../invariants.mjs';
import { immutableReceiptMetadata } from '../observers.mjs';
import { BROWSER_SOURCE_PATHS } from './demo01-browser.mjs';

export { demo01BrowserSpec, driveDemo01Page, stopDemo01Page, drainDemo01Page } from './demo01-browser.mjs';

const sourcePaths = [
  'tools\\verification\\adapters\\demo01-runtime.mjs',
  'tools\\verification\\adapters\\demo01-browser.mjs',
  'tools\\verification\\demo.mjs',
  'tools\\verification\\raw-intake.mjs',
  'tools\\verification\\observers.mjs',
  'tools\\observability\\demo01-collector.mjs',
  'tools\\observability\\raw-query.mjs',
  'tools\\observability\\sampling-controller.mjs',
  'tools\\observability\\runtime-adapters.mjs',
  'tools\\security\\telemetry.mjs',
  'tools\\security\\telemetry-policy.v1.json',
  'contracts\\verification-observer-registry.v1.json',
  'services\\inventory-data\\src\\main\\java\\com\\contoso\\inventory\\data\\InventoryFixtureRun.java',
  'services\\inventory-data\\src\\main\\java\\com\\contoso\\inventory\\data\\InventoryFixtureStdio.java',
  'services\\inventory-data\\tools\\InventoryFixtureContract.md',
  'web\\storefront-spa\\src\\app.ts',
  ...BROWSER_SOURCE_PATHS
];
const authorFrozenSources = new Map([
  [BROWSER_SOURCE_PATHS[0], 'ed6616eed2ef9ab8e428837f4d978d8985e70239f5968f7b3651b4271d76fc62'],
  [BROWSER_SOURCE_PATHS[2], '4c756dc29696018e00d30df22129f3db1daef6cce982d48f4b755e41b949e944'],
  ['web\\storefront-spa\\src\\app.ts', '2f4eee79496b3f0f089f78bb48ef4986e2b33389b13d9c145affec2f604185ac'],
  ['tools\\observability\\demo01-collector.mjs', 'dcb5f95d247a385c6760a595ef97073613ea927f70e125f9e42dfc3966cb82ad'],
  ['tools\\observability\\raw-query.mjs', 'a63fae68076a40b67f9fe8807ecc4fbbcc558ccac2a2aa677f3a2bf9524940e3'],
  ['services\\inventory-data\\src\\main\\java\\com\\contoso\\inventory\\data\\InventoryFixtureRun.java',
    '829fa86e661ffaca01dafcb13528539566312322a3380f52f3f32ba8244a2041'],
  ['services\\inventory-data\\src\\main\\java\\com\\contoso\\inventory\\data\\InventoryFixtureStdio.java',
    'bf28812f7910c3d3ceae27b6ad554bb9ff2bae209c1b6612e51a3237628f4389'],
  ['services\\inventory-data\\tools\\InventoryFixtureContract.md',
    'd65bec32b8ad03024a05ce87fc8a89d79aaa1f9d343322e65269249bf972d626']
]);
const fail = (code, detail) => { throw new VerificationFailure(code, detail); };

// No contoso.demo-adapter.v1/createAdapter is advertised until every production
// operation exists. In particular, saved hashes cannot restore a private baseline.
const blockingInterfaces = [
  {
    id: 'independent-native-execution',
    requiredBy: ['execute', 'collect', 'observeSampling'],
    missing: 'An original independently observed emission/canary/gateway-wire operation supplying execution.expectation, trafficLedger and proofArtifacts',
    supplied: 'driveContosoBrowser returns the observed browser action only; createDemo01Collector consumes observations and does not create independent producer authority'
  },
  {
    id: 'native-query-enrollment',
    requiredBy: ['collect'],
    missing: 'Independently enrolled authenticated query/transport capability accepted by verifyQueryExecutorReceipt',
    supplied: 'createDemo01Collector uses the pinned native RAW executor, original scan and private query verifier; source hashes and observer selectors are not enrollment'
  },
  {
    id: 'native-sampling-control',
    requiredBy: ['prepare', 'drain', 'observeSampling', 'stopTraffic', 'reset'],
    missing: 'Reviewed native apply/observe/restore/stopTraffic command entrypoints and a full native inventory/admission/fidelity observer for every sampling participant',
    supplied: 'sampling-controller owns finite windows; createRestartRuntimeHooks still requires owner callbacks and is not a supplied native command implementation'
  },
  {
    id: 'reviewed-preparation-process',
    requiredBy: ['prepare', 'reset'],
    missing: 'An independently verified integrated operator-runtime classpath, authentication/resources and bounded execution window; local source acceptance is not runtime readiness',
    supplied: 'Corrected R6 live-handle construction is locally source-reviewed; only the original live child owns its baseline, with no readiness method or cross-service reset claims'
  },
  {
    id: 'durable-owned-recovery',
    requiredBy: ['restoreCapturedRun'],
    missing: 'A reviewed authenticated durable recovery operation available to the new Reset.ps1 process',
    supplied: 'R6 explicitly retains baseline values only in the original live child; demo.mjs persists baselineHashes, which cannot reconstruct them'
  }
];

export function scanDemo01Capture(capture) {
  const original = capture?.originalCapture ?? capture;
  if (!Array.isArray(original?.rawTables) || !original.scanReceipt) {
    fail('E_PRIVACY', 'Original table columns and the original scan receipt are required; a caller PASS is not a scan');
  }
  const privacy = scanGraphIntake({ tables: original.rawTables, receipt: original.scanReceipt });
  if (privacy.result !== 'PASS' || privacy.scannedAllColumns !== true) {
    fail('E_PRIVACY', 'Original-column Demo 01 graph intake failed the trusted scanner');
  }
  return privacy;
}

async function sourceSnapshot() {
  return Promise.all(sourcePaths.map(async file => ({ path: file, sha256: sha256(await readBoundFile(file)) })));
}

export async function inspectDemo01Construction() {
  const sources = await sourceSnapshot();
  const registry = JSON.parse((await readBoundFile('contracts\\verification-observer-registry.v1.json')).toString('utf8'));
  if (registry.schema !== 'contoso.verification-observer-registry.v1' ||
      registry.sourceAcceptanceIsCertification !== false || !Array.isArray(registry.observers)) {
    fail('E_OBSERVER_REGISTRY', 'The existing independent observer registry must be intact');
  }
  if (typeof createDemo01Collector !== 'function' ||
      sources.some(source => authorFrozenSources.has(source.path) && authorFrozenSources.get(source.path) !== source.sha256) ||
      sources.find(source => source.path === 'tools\\observability\\demo01-collector.mjs').sha256 !== DEMO01_COLLECTOR_SOURCE_SHA256 ||
      sources.find(source => source.path === 'tools\\security\\telemetry-policy.v1.json').sha256 !== policySha256 ||
      JSON.stringify(sources) !== JSON.stringify(await sourceSnapshot())) {
    fail('E_SOURCE_DRIFT', 'Loaded construction source, original privacy policy or inspected source changed');
  }
  return immutableReceiptMetadata({
    schema: 'contoso.demo01-runtime-construction.v1',
    result: 'BLOCKED',
    runnableDemoAdapter: false,
    sourceAcceptanceIsCertification: false,
    certificationStatus: 'NOT CERTIFIED',
    nativeExecution: 'NOT RUN',
    sourceBinding: 'AUTHOR-FROZEN COMPONENT BYTES ONLY; INDEPENDENT REVIEW AND NATIVE AUTHORITY ARE NOT INHERITED',
    availableOperations: {
      browser: {
        module: 'web\\portal-ssr\\dist\\browser-adapter.js',
        export: 'driveContosoBrowser',
        input: 'Authenticated Playwright Page; {schemaVersion:1,runId:freshUUID4,demoId:1,kind:"demo",sku:ownedSku,quantity:1}',
        route: 'POST /contoso/v1/orders; orderId === runId; businessInvocationId is observed, never requested',
        output: 'ContosoBrowserEvidenceV1; staged response and joined SDK identity, not a full native execution ledger'
      },
      collector: {
        module: 'tools\\observability\\demo01-collector.mjs',
        export: 'createDemo01Collector',
        configuration: ['workspaceId', 'resourceId', 'azureCliExecutable', 'azureCliExecutableSha256',
          'allowAzureReads', 'readApprovalRef', 'observerId'],
        collect: {
          parameters: ['fromUtc', 'toUtc', 'ingestionWatermarkUtc', 'pageSize', 'maxRows', 'maxPages', 'mode'],
          observations: ['execution', 'browserEvidence', 'proofArtifacts', 'serializationByRole'],
          controls: ['signal']
        },
        output: 'Original in-memory RAW capture, stable repeated read, source-located assignments and checked evidence; no original rows are persisted'
      },
      preparation: {
        contract: 'services\\inventory-data\\tools\\InventoryFixtureContract.md',
        mainClass: 'com.contoso.inventory.data.InventoryFixtureStdio',
        argv: ['--approved-operator-stdio'],
        input: {
          encoding: 'ASCII; TAB-separated; newline-terminated; at most 1024 bytes/line and 64 commands/process',
          CAPTURE: ['runUUID', 'freshOrderUUID', 'approvedSKU', 'preparationInvocationUUID', 'budgetMs:1..30000', 'witnessSKUsCSV-or-"-"'],
          PREPARE: ['sameRunUUID', 'preparationInvocationUUID', 'budgetMs:1..30000'],
          RESET: ['sameRunUUID', 'observedMeasuredInvocationUUID', 'budgetMs:1..30000'],
          QUIT: ['sameRunUUID']
        },
        outputSchema: 'contoso.inventory-fixture-stdio.v1',
        hashFields: ['ownedRowsSha256', 'unownedRowsSha256', 'cacheContentSha256', 'unownedCacheContentSha256'],
        states: { CAPTURE: 'CAPTURED', PREPARE: 'PREPARED', RESET: 'RESTORED', QUIT: 'RESTORED' },
        configuration: ['CONTOSO_PG_HOST', 'CONTOSO_PG_DATABASE', 'CONTOSO_PG_USERNAME',
          'CONTOSO_PG_RESOURCE_ID', 'CONTOSO_REDIS_HOST', 'CONTOSO_REDIS_PRINCIPAL_ID', 'AZURE_CLIENT_ID (optional)'],
        scope: 'One live private baseline; V001 inventory tables and declared cache witnesses only. Explicit same-handle retry revalidates its private checkpoint; no automatic replay. RESET expected/observed hashes require real read-back equality.',
        restoreCapturedRun: 'UNSUPPORTED: authenticated durable recovery has no supplied operation',
        invocationStatus: 'NOT RUN: no approved operator-runtime classpath/authentication/resource lease or real-store window'
      },
      privacy: {
        export: 'scanDemo01Capture',
        input: 'The original rawTables and scanReceipt (or originalCapture retained by adaptR7Capture)',
        output: 'Trusted R8 graph-intake disposition; never global privacy, producer authority or native acceptance'
      },
      browserCleanup: {
        exports: ['stopDemo01Page', 'drainDemo01Page'],
        operations: ['window.contosoDemos.stopTraffic()', 'window.contosoDemos.drain()', 'window.contosoDemos.flushTelemetry()', 'window.contosoDemos.runtimeState()'],
        scope: 'The attached browser page only; no messages, data, sampling or saved-run reset claim'
      }
    },
    blockingInterfaces,
    authorFrozenSources: [...authorFrozenSources].map(([file, hash]) => ({ path: file, sha256: hash })),
    nativeQueryObserverCount: registry.observers.length,
    externalPrerequisites: [
      'Actual authenticated isolated Storefront browser session and reviewed connection/ownership configuration',
      'Approved target resources, operator authentication and finite traffic/read/control/drain/restore window',
      'Independent source review of this construction and the frozen sibling handoffs'
    ],
    sources
  });
}

export async function demo01ConstructionMain(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== '--check') {
    fail('D_ARGUMENT', 'Only --check is available for this blocked source construction; no native execution is enabled');
  }
  return inspectDemo01Construction();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await demo01ConstructionMain()));
    process.exitCode = 2;
  } catch (error) {
    console.error(error instanceof VerificationFailure ? error.code : 'D_DEMO01_CONSTRUCTION');
    process.exitCode = 1;
  }
}
