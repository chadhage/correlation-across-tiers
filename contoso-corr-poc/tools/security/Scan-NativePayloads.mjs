import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { captureNativePayloads, nativePayloadErrorCode, NATIVE_LIMITS, parseNativeCaptureInput } from './native-payload.mjs';
import { digest } from './values.mjs';

export async function scanNativePayloadStdin() {
  if (process.argv.length !== 2) throw new Error('NATIVE_CAPTURE_SCHEMA');
  const chunks = [];
  let size = 0;
  const timer = setTimeout(() => process.stdin.destroy(new Error('NATIVE_CAPTURE_TIMEOUT')), 10000);
  try {
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > NATIVE_LIMITS.inputBytes) throw new Error('NATIVE_CAPTURE_BOUND');
      chunks.push(chunk);
    }
  } finally { clearTimeout(timer); }
  const result = captureNativePayloads(parseNativeCaptureInput(Buffer.concat(chunks)));
  result.validatorCliSourceSha256 = digest(readFileSync(fileURLToPath(import.meta.url)));
  process.stdout.write(JSON.stringify(result) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await scanNativePayloadStdin(); }
  catch (error) {
    process.stderr.write(nativePayloadErrorCode(error) + '\n');
    process.exitCode = 1;
  }
}
