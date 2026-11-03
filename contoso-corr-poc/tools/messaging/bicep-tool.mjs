import { spawnSync } from 'node:child_process';

export function resolveBicepCompiler({ env = process.env, run = spawnSync } = {}) {
  const configured = ['CONTOSO_BICEP_PATH', 'CONTOSO_BICEP_EXE']
    .find(name => typeof env[name] === 'string' && env[name].trim());
  const source = configured ?? 'PATH';
  const executable = configured ? env[configured].trim() : 'bicep';
  const result = run(executable, ['--version'], {
    encoding: 'utf8', windowsHide: true, timeout: 10_000, env
  });
  if (!configured && result.error?.code === 'ENOENT') {
    return {
      executable, source,
      skipReason: 'NOT VERIFIED: Bicep is absent from PATH. Set CONTOSO_BICEP_PATH ' +
        '(or CONTOSO_BICEP_EXE) to the existing compiler; required compilation assertions were not executed.'
    };
  }
  if (result.error) {
    throw new Error(`Bicep compiler from ${source} could not run: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`Bicep compiler from ${source} failed its version probe: ${result.stderr || result.status}`);
  }
  if (!/^Bicep CLI version \d+\.\d+\.\d+\b/m.test(result.stdout ?? '')) {
    throw new Error(`Bicep compiler from ${source} returned an unrecognized version response`);
  }
  return { executable, source, skipReason: false };
}
