import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { projectRoot, sha256 } from '../../tools/verification/files.mjs';
import { selectAsyncCaptureReceipts } from '../../tools/verification/async-capture-receipts.mjs';
import { assertLocalNativeAsync, checkLocalInspectionBinding } from '../../tools/verification/local-native.mjs';

const epoch = '20261102T001204863Z-162cd21f-76c1-4e80-8733-c59f28f972cc';
const native = path.join(projectRoot, 'workers', 'messaging-core', 'target', 'native-agent', 'epochs', epoch, 'native-proof.json');
const linked = path.join(projectRoot, 'workers', 'messaging-core', 'target', 'linked-root-sampling', '1.1.0', 'epochs', epoch, 'qualification.json');
const receipt = (file = native, change = {}) => ({ sha256: 'a'.repeat(64), certification: 'NOT_CERTIFIED', path: file, ...change });
const line = value => `ASYNC_NATIVE_CAPTURE_RECEIPT ${JSON.stringify(value)}`;

test('actual printed native and linked epoch locators are distinct, key-order independent receipt claims only', () => {
  const selected = selectAsyncCaptureReceipts(`normal log\r\n${line(receipt())}\r\n${line(receipt(linked))}\n`);
  assert.equal(selected.nativeProof.path, path.relative(projectRoot, native));
  assert.equal(selected.linkedQualification.path, path.relative(projectRoot, linked));
  assert.equal(selected.receiptClaimOnly, true);
  assert.equal(selected.sourceAcceptanceIsCertification, false);
  assert.ok(Object.isFrozen(selected.nativeProof));
  assert.throws(() => assertLocalNativeAsync(selected), /authority/);
  assert.equal(selected.nativeProof.inspectionSha256, undefined);
});

test('missing receipts, old fixed paths, caller-relative, foreign and traversal paths never fall back', () => {
  for (const text of [
    '', 'native-proof.json',
    line(receipt(path.join(projectRoot, 'workers', 'messaging-core', 'target', 'native-agent', 'native-proof.json'))),
    line(receipt(path.relative(projectRoot, native))),
    line(receipt('C:\\foreign\\native-proof.json')),
    line(receipt(native.replace('\\epochs\\', '\\epochs\\unused\\..\\')))
  ]) assert.throws(() => selectAsyncCaptureReceipts(text), /E_ASYNC_CAPTURE_RECEIPT/);
});

test('receipt JSON rejects duplicate and escaped-equivalent keys, extras, wrong hashes and certification', () => {
  for (const text of [
    line(receipt(native, { sha256: 'not-a-hash' })),
    line(receipt(native, { certification: 'CERTIFIED' })),
    line({ ...receipt(), kind: 'trusted-native' }),
    line(receipt()).replace('"sha256":', '"path":"C:\\\\foreign","sha256":'),
    line(receipt()).replace('"sha256":', '"pa\\u0074h":"C:\\\\foreign","sha256":'),
    'ASYNC_NATIVE_CAPTURE_RECEIPT {"path":null,"sha256":"x","certification":"NOT_CERTIFIED"}'
  ]) assert.throws(() => selectAsyncCaptureReceipts(text), /E_ASYNC_CAPTURE_RECEIPT/);
});

test('multiple same-kind epochs, oversized stdout and fabricated inspection records reject', () => {
  assert.throws(() => selectAsyncCaptureReceipts(`${line(receipt())}\n${line(receipt())}`), /E_ASYNC_CAPTURE_RECEIPT/);
  assert.throws(() => selectAsyncCaptureReceipts('x'.repeat(2 * 1024 * 1024 + 1)), /E_ASYNC_CAPTURE_RECEIPT/);
  assert.throws(() => selectAsyncCaptureReceipts(line(receipt(native.replace('native-proof.json', 'native-safe-inspection.json')))),
    /E_ASYNC_CAPTURE_RECEIPT/);
});

test('new current proof must bind its actual sibling inspection hash, not merely a printed proof receipt', () => {
  const bytes = Buffer.from('[{"fixtureOnly":true}]');
  const result = checkLocalInspectionBinding(sha256(bytes), bytes);
  assert.equal(result.inspectionSha256, sha256(bytes));
  assert.equal(result.sourceAcceptanceIsCertification, false);
  for (const hash of [undefined, 'not-a-hash', 'a'.repeat(64)]) {
    assert.throws(() => checkLocalInspectionBinding(hash, bytes), /E_LOCAL_BINARY_EVIDENCE/);
  }
  assert.throws(() => checkLocalInspectionBinding(sha256(bytes), Buffer.from('different fixture')), /E_LOCAL_BINARY_EVIDENCE/);
  assert.throws(() => assertLocalNativeAsync(result), /authority/);
});
