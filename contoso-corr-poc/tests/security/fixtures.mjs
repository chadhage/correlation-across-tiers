import { randomBytes, randomUUID } from 'node:crypto';
import { telemetryPolicy } from '../../tools/security/telemetry.mjs';

export function rawFixture() {
  const tables = telemetryPolicy.requiredTables.map(name => ({
    name, columns: [{ name: 'TimeGenerated', type: 'datetime' }], rows: []
  }));
  const requests = tables.find(table => table.name === 'AppRequests');
  requests.columns = ['TimeGenerated', 'Id', 'OperationId', 'ParentId', 'AppRoleName', 'IKey', 'ClientIP', 'Properties']
    .map(name => ({ name, type: name === 'Properties' ? 'dynamic' : 'string' }));
  requests.rows = [[new Date().toISOString(), randomBytes(8).toString('hex'), randomBytes(16).toString('hex'), '',
    'contoso-orders-api', randomUUID(), '0.0.0.0', { 'business.invocation_id': randomUUID() }]];
  const receipt = {
    schema: 'contoso.raw-query-capture.v1', sourceKind: 'fixture-check',
    tableInventoryComplete: true, complete: true, paginationComplete: true, warnings: [],
    rowCount: 1, tables: tables.map(table => ({ name: table.name, count: table.rows.length, complete: true, pages: [] }))
  };
  return { tables, receipt, canaryDisposition: 'PASS' };
}

export function fakeJwt() {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [encode({ alg: 'RS256', typ: 'JWT' }), encode({ subject: 'canary-not-a-credential' }),
    randomBytes(32).toString('base64url')].join('.');
}
