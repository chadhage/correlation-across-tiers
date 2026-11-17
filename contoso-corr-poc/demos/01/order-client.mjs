import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const requireValue = (condition, code) => { if (!condition) throw new Error(code); };

export async function runOrderClient({ gatewayOrigin, accessToken, allowTraffic, approvalReference,
  sku = 'CONTOSO-001', quantity = 1, orderId = randomUUID() }, fetcher = globalThis.fetch) {
  requireValue(allowTraffic === true && typeof approvalReference === 'string' && approvalReference.trim().length > 0,
    'GOLDEN_PATH_TRAFFIC_APPROVAL_REQUIRED');
  let origin;
  try { origin = new URL(gatewayOrigin); } catch { throw new Error('GOLDEN_PATH_EXACT_HTTPS_ORIGIN_REQUIRED'); }
  requireValue(origin.protocol === 'https:' && origin.origin === gatewayOrigin && !origin.username && !origin.password,
    'GOLDEN_PATH_EXACT_HTTPS_ORIGIN_REQUIRED');
  requireValue(typeof accessToken === 'string' && accessToken.length > 0 && accessToken.length <= 16384 &&
    !/[\x00-\x20\x7f]/.test(accessToken), 'GOLDEN_PATH_TOKEN_REQUIRED');
  requireValue(UUID.test(orderId) && typeof sku === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(sku) &&
    Number.isInteger(quantity) && quantity >= 1 && quantity <= 100, 'GOLDEN_PATH_ORDER_INVALID');
  async function request(method, suffix, expectedStatus, body) {
    const response = await fetcher(`${gatewayOrigin}/contoso/v1/orders${suffix}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${accessToken}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    try {
    requireValue(response.status === expectedStatus, `GOLDEN_PATH_HTTP_STATUS_${response.status}`);
    requireValue(response.headers.get('content-type')?.split(';')[0].trim() === 'application/json', 'GOLDEN_PATH_JSON_REQUIRED');
    const businessHeader = response.headers.get('x-business-invocation-id');
    requireValue(UUID.test(businessHeader), 'GOLDEN_PATH_CANONICAL_BUSINESS_HEADER_REQUIRED');
    requireValue(response.body, 'GOLDEN_PATH_JSON_REQUIRED');
    const reader = response.body.getReader();
    const parts = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        requireValue(length <= 16384, 'GOLDEN_PATH_RESPONSE_BOUND');
        parts.push(value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    let result;
    try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); }
    catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError) throw new Error('GOLDEN_PATH_JSON_INVALID');
      throw error;
    }
    requireValue(result?.schemaVersion === 1 && result.id === orderId && UUID.test(result.businessInvocationId) &&
      typeof result.state === 'string' && /^[A-Z_]{1,32}$/.test(result.state), 'GOLDEN_PATH_RESPONSE_IDENTITY_MISMATCH');
    if (method === 'POST') {
      requireValue(UUID.test(result.workflowBusinessInvocationId) && result.businessInvocationId === businessHeader,
        'GOLDEN_PATH_MUTATION_IDENTITY_MISMATCH');
    }
    return result;
    } finally { if (response.body && !response.body.locked) await response.body.cancel(); }
  }
  const created = await request('POST', '', 202, { schemaVersion: 1, orderId, sku, quantity });
  const stored = await request('GET', `/${orderId}`, 200);
  requireValue(stored.businessInvocationId === created.workflowBusinessInvocationId, 'GOLDEN_PATH_DURABLE_IDENTITY_MISMATCH');
  return { orderId, businessInvocationId: created.businessInvocationId,
    workflowBusinessInvocationId: stored.businessInvocationId, state: stored.state,
    scope: 'HTTP_API_SMOKE_NOT_BROWSER_OR_TRACE_ACCEPTANCE', certification: 'NOT_CERTIFIED' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    requireValue(args.length === 5 && args[0] === '--origin' && args[2] === '--approval-reference' &&
      args[4] === '--allow-traffic', 'GOLDEN_PATH_ARGUMENTS');
    console.log(JSON.stringify(await runOrderClient({ gatewayOrigin: args[1], approvalReference: args[3],
      allowTraffic: true, accessToken: process.env.CONTOSO_ORDERS_ACCESS_TOKEN })));
  } catch (error) {
    const code = error?.message;
    console.error(/^GOLDEN_PATH_[A-Z0-9_]+$/.test(code) ? code : 'GOLDEN_PATH_HTTP_FAILED');
    process.exitCode = 1;
  }
}
