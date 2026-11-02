import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  captureNativePayloads, nativePayloadErrorCode, NATIVE_LIMITS, parseNativeCaptureInput
} from '../security/native-payload.mjs';

export const MAX_NATIVE_SCALAR_LENGTH = NATIVE_LIMITS.scalarBytes;

export function captureNativeApiPayloads(input) {
  if (!Array.isArray(input?.publisherKeys) || input.publisherKeys.length !== 2) {
    throw new Error('NATIVE_CAPTURE_SCHEMA');
  }
  return captureNativePayloads(input);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const timer = setTimeout(() => process.stdin.destroy(new Error('NATIVE_CAPTURE_TIMEOUT')), 10000);
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > NATIVE_LIMITS.inputBytes) throw new Error('NATIVE_CAPTURE_BOUND');
      chunks.push(chunk);
    }
    const input = parseNativeCaptureInput(Buffer.concat(chunks));
    process.stdout.write(JSON.stringify(captureNativeApiPayloads(input)));
  } catch (error) {
    process.stderr.write(`${nativePayloadErrorCode(error)}\n`);
    process.exitCode = 1;
  } finally { clearTimeout(timer); }
}
