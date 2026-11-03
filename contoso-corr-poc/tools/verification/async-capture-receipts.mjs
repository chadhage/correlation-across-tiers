import path from 'node:path';
import { projectRoot, relativeFile } from './files.mjs';
import { immutableReceiptMetadata } from './observers.mjs';

const prefix = 'ASYNC_NATIVE_CAPTURE_RECEIPT ';
const string = '"(?:[^"\\\\\\u0000-\\u001f]|\\\\(?:["\\\\/bfnrt]|u[0-9a-fA-F]{4}))*"';
const pair = `(${string})\\s*:\\s*(${string})`;
const object = new RegExp(`^\\s*\\{\\s*${pair}\\s*,\\s*${pair}\\s*,\\s*${pair}\\s*\\}\\s*$`);
const epoch = '\\d{8}T\\d{9}Z-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const nativePath = new RegExp(`^workers\\\\messaging-core\\\\target\\\\native-agent\\\\epochs\\\\${epoch}\\\\native-proof\\.json$`);
const linkedPath = new RegExp(`^workers\\\\messaging-core\\\\target\\\\linked-root-sampling\\\\1\\.1\\.0\\\\epochs\\\\${epoch}\\\\qualification\\.json$`);
const fail = () => { throw Object.assign(new Error('E_ASYNC_CAPTURE_RECEIPT'), { code: 'E_ASYNC_CAPTURE_RECEIPT' }); };

export function selectAsyncCaptureReceipts(stdout) {
  if (typeof stdout !== 'string' || Buffer.byteLength(stdout) > 2 * 1024 * 1024) fail();
  const found = {};
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(prefix)) continue;
    if (Buffer.byteLength(line) > 8192) fail();
    const fields = object.exec(line.slice(prefix.length));
    if (!fields) fail();
    const pairs = [[fields[1], fields[2]], [fields[3], fields[4]], [fields[5], fields[6]]]
      .map(([key, value]) => [JSON.parse(key), JSON.parse(value)]);
    if (new Set(pairs.map(([key]) => key)).size !== 3 ||
        pairs.some(([key]) => !['path', 'sha256', 'certification'].includes(key))) fail();
    const receipt = Object.fromEntries(pairs);
    if (!path.win32.isAbsolute(receipt.path) || !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
        receipt.certification !== 'NOT_CERTIFIED' ||
        receipt.path.split(/[\\/]/).some(part => part === '.' || part === '..')) fail();
    let relative;
    try { relative = relativeFile(path.win32.relative(projectRoot, receipt.path)); }
    catch { fail(); }
    const kind = nativePath.test(relative) ? 'nativeProof' : linkedPath.test(relative) ? 'linkedQualification' : null;
    if (!kind || found[kind]) fail();
    found[kind] = { path: relative, sha256: receipt.sha256 };
  }
  if (!Object.keys(found).length) fail();
  return immutableReceiptMetadata({ ...found, receiptClaimOnly: true, sourceAcceptanceIsCertification: false });
}
