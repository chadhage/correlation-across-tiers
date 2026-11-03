import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeConditionalSourceProbe, executeLocalConditionalObserver, requireConditionalExecution,
  requireLocalConditionalCapture, conditionalFailureDiagnostics } from './conditional-observer.mjs';
import { assertVerifiedScenario, requireVerifiedTrustRootBindings, verifyGraphIntake } from './pipeline.mjs';
import { createBoundDirectory, jsonBytes, projectRoot, readBoundFile, sha256, writeManifest } from './files.mjs';
import { snapshotQualificationMetadata } from './sampling-qualification.mjs';

export async function conditionalObserverMain(args = process.argv.slice(2)) {
  const command = snapshotQualificationMetadata({ args }).args;
  if (!Array.isArray(command) || command.length !== 1 || !['--source-check', '--execute'].includes(command[0])) {
    throw Object.assign(new Error('E_CONDITIONAL_ARGUMENT'), { code: 'E_CONDITIONAL_ARGUMENT' });
  }
  const native = command[0] === '--execute';
  const capability = native ? await executeLocalConditionalObserver() : await executeConditionalSourceProbe();
  const execution = requireConditionalExecution(capability, { nativeRequired: native });
  let artifact;
  if (native) {
    const captured = requireLocalConditionalCapture(capability);
    const graph = await verifyGraphIntake({ map: captured.map, spec: { assertion: 'conditional-native' },
      mode: 'LocalValidate', localObserverCapability: capability });
    const bindings = requireVerifiedTrustRootBindings(graph, {
      map: captured.map, rows: captured.rows, mode: 'LocalValidate'
    });
    const selected = assertVerifiedScenario(graph);
    if (bindings.actualSourceVerified !== true || bindings.nativeRuntimeCarrierObserverEnrolled !== true ||
        bindings.checkerOnly !== false || bindings.roots.length !== 3 ||
        selected.invariants.result !== 'NOT_FULL_GRAPH' || selected.coverage.fullGraphVerified !== false) {
      throw Object.assign(new Error('E_CONDITIONAL_GRAPH_BINDING'), { code: 'E_CONDITIONAL_GRAPH_BINDING' });
    }
    const directory = path.join(projectRoot, 'evidence', 'verification', 'conditional-graph',
      `${new Date().toISOString().replaceAll(/[-:.]/g, '')}-${randomUUID()}`);
    await createBoundDirectory(directory);
    const nativeManifest = path.join(execution.evidenceDirectory, 'manifest.json');
    await writeFile(path.join(directory, 'bindings.json'), jsonBytes({
      schema: 'contoso.executed-local-conditional-bindings.v1',
      nativeExecutionManifest: nativeManifest, nativeExecutionManifestSha256: sha256(await readBoundFile(nativeManifest)),
      bindings, result: selected.assertion.result, fullGraphVerified: false,
      azureAuthority: false, certification: 'NOT_CERTIFIED', savedJsonCanEnroll: false
    }), { flag: 'wx' });
    await writeManifest(directory, { sourceAcceptanceIsCertification: false, certification: 'NOT_CERTIFIED' });
    artifact = path.relative(projectRoot, path.join(directory, 'bindings.json'));
  }
  return {
    result: native ? 'LOCAL_SELECTED_CASES_VERIFIED' : 'GENUINE_CPU_SOURCE_ONLY',
    observerId: execution.observerId, nativeRuntime: execution.nativeRuntime,
    certification: 'NOT_CERTIFIED', azureAuthority: false, fullPathVerified: false,
    ...(artifact ? { artifact } : {})
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await conditionalObserverMain())); }
  catch (error) {
    console.error(JSON.stringify({ result: 'FAIL_OR_UNVERIFIED',
      ...conditionalFailureDiagnostics(error),
      certification: 'NOT_CERTIFIED' }));
    process.exitCode = 1;
  }
}
