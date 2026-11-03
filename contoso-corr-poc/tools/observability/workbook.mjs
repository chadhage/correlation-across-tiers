import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderKql, loadRootMap, conditionalRootPolicies } from './kql.mjs';
import { sha256 } from './telemetry-contract.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const output = join(project, 'workbooks', 'contoso-correlation.workbook.json');
const from = '2026-01-01T00:00:00.000Z';
const to = '2026-01-01T02:00:00.000Z';
const trace = '11111111111111111111111111111111';
const invocation = '12345678-1234-4234-8234-123456789abc';
const scope = '/subscriptions/12345678-1234-4234-8234-123456789abc/resourceGroups/render-sentinel/providers/Microsoft.Insights/components/render-sentinel';
const parameter = (name, type, extra = {}) => ({ id: name, name, type, isRequired: true, ...extra });
const queryItem = (name, query) => ({ type: 3, name, content: {
  version: 'KqlItem/1.0', query, size: 0, queryType: 0,
  resourceType: 'microsoft.operationalinsights/workspaces',
  crossComponentResources: ['{Workspace}'], visualization: 'table',
  showExportToExcel: false
} });

function workbookQuery(query) {
  return query.replaceAll(from, '{TimeRange:start}').replaceAll(to, '{TimeRange:end}')
    .replaceAll(scope, '{ApplicationInsights:escapejson}')
    .replaceAll(trace, '{TraceId:escapejson}').replaceAll(invocation, '{InvocationId:escapejson}')
    .replace(/let queryTime=datetime\([^)]+\);/, 'let queryTime=now();');
}

export async function buildWorkbook() {
  const { map, mapSha256 } = await loadRootMap();
  const items = [{
    type: 1, name: 'safety-status',
    content: { json: '# Contoso Correlation\n\nDiagnostic views only. Source-supported loader/custom sampler proof is distinct from Azure live certification. Strict sampled-positive completeness and unsampled propagation remain mandatory. No row, screenshot or viewer-supplied metadata certifies origin. Missing data/unknown mappings remain To Do.\n\nFiltered trace/business queries are not the all-table privacy scan. Export only R8-approved safe fields after scanning original intake.' }
  }, {
    type: 9, name: 'parameters', content: { version: 'KqlParameterItem/1.0', style: 'pills', parameters: [
      parameter('Workspace', 5, { value: [], typeSettings: { resourceTypeFilter: { typeString: 'microsoft.operationalinsights/workspaces' }, multiSelect: false } }),
      parameter('ApplicationInsights', 5, { value: [], typeSettings: { resourceTypeFilter: { typeString: 'microsoft.insights/components' }, multiSelect: false } }),
      parameter('TimeRange', 4, { value: { durationMs: 7200000 } }),
      parameter('TraceId', 1, { value: '', typeSettings: { validationRegex: '^(?!0{32}$)[a-f0-9]{32}$', validationMessage: 'Nonzero lowercase W3C trace ID required' } }),
      parameter('InvocationId', 1, { value: '', typeSettings: { validationRegex: '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$', validationMessage: 'Trusted canonical UUIDv4 required' } })
    ] }
  }];
  for (const procedure of ['trace-reconstruct', 'business-lookup', 'orphan-candidates']) {
    const rendered = await renderKql(procedure, {
      schema: 'workspace', fromUtc: from, toUtc: to, traceId: trace, invocationId: invocation,
      appResourceId: scope, asOfUtc: to, assignments: [], referenceProofs: []
    });
    items.push(queryItem(procedure, workbookQuery(rendered.query)));
  }
  items.push({
    type: 1, name: 'boundary-input-status', content: { json:
      '## Boundary triage input contract\n\nThe compiled declared boundaries below are generated solely from `contracts\\expected-boundary-map.v1.json`. Actual observed trace/span assignments and reference evidence must be bound by the reviewed R9 capture/renderer; this default viewer does not invent them. Empty assignments cannot produce a green certificate. Composite ID mapping must be source/role proven before the assertion pipeline accepts it.\n\nUse the R7 query renderer with the sealed run inputs for final candidate results; select the actual Application Insights resource for Application Map and Transaction Diagnostics. Their real screenshots remain required live assets.' }
  });
  items.push(queryItem('root-boundary-map', `datatable(Boundary:string,Role:string,Kind:string)[${map.spans.map(value =>
    [value.id, value.roleName, value.semanticKind].map(JSON.stringify).join(',')).join(',')}]\n| order by Boundary asc`));
  items.push(queryItem('conditional-root-candidates',
    `datatable(Boundary:string,PolicyRef:string,AllowedDispositionsJson:string,ReceiptType:string)[${conditionalRootPolicies(map)
      .map(rule => [rule.boundary, rule.policyRef, JSON.stringify(rule.allowedDispositions), rule.receiptType]
        .map(JSON.stringify).join(',')).join(',')}]\n| extend NativeEvidenceStatus="UNVERIFIED",ParentMustBeNull=true,SourceProofRequired=true\n| order by Boundary asc`));
  items.push(queryItem('ingestion-delay', `union AppRequests,AppDependencies
| where TimeGenerated {TimeRange}
| where _ResourceId =~ "{ApplicationInsights:escapejson}"
| extend ObservedIngestion=ingestion_time(),EndTime=TimeGenerated+DurationMs*1ms
| where isnotnull(ObservedIngestion)
| extend DelaySeconds=(ObservedIngestion-EndTime)/1s
| summarize PhysicalSpans=count(),P95=percentile(DelaySeconds,95),P99=percentile(DelaySeconds,99) by AppRoleName`));
  items.push(queryItem('physical-volume', `union AppRequests,AppDependencies,AppTraces,AppExceptions,AppEvents,AppPageViews
| where TimeGenerated {TimeRange}
| where _ResourceId =~ "{ApplicationInsights:escapejson}" and _IsBillable =~ "true"
| summarize PhysicalRows=count(),BillableBytes=sum(_BilledSize) by Type,AppRoleName
| extend BillableGB=BillableBytes/1000000000.0`));
  items.push(queryItem('workspace-usage', `Usage
| where TimeGenerated {TimeRange} and IsBillable
| summarize BillableGB=sum(Quantity)/1000.0 by DataType,bin(StartTime,1h)
| order by StartTime asc`));
  items.push(queryItem('ingestion-health', `_LogOperation
| where TimeGenerated {TimeRange}
| where Level in ("Warning","Error")
| project TimeGenerated,Category,Operation,Level`));
  items.push({ type: 1, name: 'operational-status', content: { json:
    '## Profiles, load and cost\n\nThe bounded controller records desired/observed hashes, all-layer expiry/restore and independent-watchdog status. Missing acknowledgements/reset block PASS. Actual CPU/memory/native URL privacy/ingestion scope require measured supported metrics, not zeros.\n\nApproved OBS-04/15 load: 10 requests/s for 120 seconds; p95 ≤1000 ms, p99 ≤2500 ms; unexpected errors ≤1%; CPU mean ≤70%, peak ≤90%; memory ≤80% limit; instrumentation p95 overhead ≤20%; no missing declared certification spans. Fault vectors are separate.\n\nCost uses approved R1 price/budget input, physical billed sizes and actual variable meters. `ItemCount` never multiplies billed bytes. Caps can overshoot and blind ingestion, Usage is hourly/delayed, and budgets do not stop resources. Target is 1000 USD/day, intended lifetime 720 hours; this page is not an invoice or a provisioning approval.' } });
  return {
    version: 'Notebook/1.0', items, fallbackResourceIds: [],
    metadata: {
      schema: 'contoso.correlation-workbook.v1', sourceBoundaryMap: 'contracts\\expected-boundary-map.v1.json',
      sourceBoundaryMapSha256: mapSha256, generatedFromSingleMap: true,
      certificationEligible: false, azureLiveState: 'To Do', queryRenderer: 'tools\\observability\\kql.mjs'
    }
  };
}

export function validateWorkbook(workbook) {
  if (workbook?.version !== 'Notebook/1.0' || workbook.metadata?.certificationEligible !== false ||
      !Array.isArray(workbook.items) || workbook.items.length < 8) throw new TypeError('Incomplete workbook');
  const text = JSON.stringify(workbook);
  if (text.includes('{{') || text.includes('InstrumentationKey=') || text.includes('render-sentinel') ||
      text.includes('api.loganalytics.azure.com/v1/workspaces/')) throw new TypeError('Unsafe/unbound workbook content');
  for (const item of workbook.items.filter(value => value.type === 3)) {
    if (item.content.version !== 'KqlItem/1.0' || !item.content.query ||
        !item.content.crossComponentResources.includes('{Workspace}')) throw new TypeError('Invalid query binding');
  }
  return workbook;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (!['--write', '--check'].includes(mode)) throw new Error('Use --write or --check');
  const workbook = validateWorkbook(await buildWorkbook());
  const serialized = JSON.stringify(workbook, null, 2) + '\n';
  if (mode === '--write') await writeFile(output, serialized);
  else if ((await readFile(output, 'utf8')).replaceAll('\r\n', '\n') !== serialized) throw new Error('Workbook root-map/query drift');
  console.log(JSON.stringify({ result: 'PASS', sourceMapSha256: workbook.metadata.sourceBoundaryMapSha256,
    workbookSha256: sha256(serialized), certificationEligible: false, azureImport: 'To Do' }));
}
