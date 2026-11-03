import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HASH, TRACE, SPAN, UUID, sha256, requireUtc, validateBoundaryMap, ownedConfigurationHash } from './telemetry-contract.mjs';
import { requireVerifiedTrustRootBindings } from '../verification/pipeline.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rootMapPath = join(project, 'contracts', 'expected-boundary-map.v1.json');
export const PROCEDURES = ['trace-reconstruct', 'business-lookup', 'orphan-candidates'];
const quote = value => JSON.stringify(value);
const table = (columns, rows) => `datatable(${columns})[\n${rows.map(row => row.map(quote).join(',')).join(',\n')}\n]`;

export async function loadRootMap() {
  const bytes = await readFile(rootMapPath);
  return { map: validateBoundaryMap(JSON.parse(bytes.toString('utf8'))), mapSha256: sha256(bytes), path: rootMapPath };
}

export function conditionalRootPolicies(map) {
  validateBoundaryMap(map);
  const boundaries = new Set(map.spans.map(value => value.id));
  const deliberate = new Set((map.deliberateRoots ?? []).map(value => value.boundary));
  const seen = new Set();
  const keys = ['boundary', 'allowedDispositions', 'policyRef', 'receiptType', 'parentMustBeNull', 'sourceProofRequired'];
  const dispositions = new Set(['absent', 'duplicate', 'invalid', 'ABSENT', 'INVALID_CONTEXT',
    'UNTRUSTED_PUBLICATION', 'INVALID_ENVELOPE', 'INVALID_CARRIER', 'ENVELOPE_TOO_LARGE']);
  if (map.conditionalRoots !== undefined && !Array.isArray(map.conditionalRoots)) throw new TypeError('Invalid conditional-root map');
  return (map.conditionalRoots ?? []).map(rule => {
    if (!rule || Object.keys(rule).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(rule, key)) ||
        !boundaries.has(rule.boundary) || deliberate.has(rule.boundary) || seen.has(rule.boundary) ||
        typeof rule.policyRef !== 'string' || !rule.policyRef.trim() || rule.policyRef.length > 512 ||
        rule.receiptType !== 'source-bound-native-trust-root' || rule.parentMustBeNull !== true ||
        rule.sourceProofRequired !== true || !Array.isArray(rule.allowedDispositions) || !rule.allowedDispositions.length ||
        new Set(rule.allowedDispositions).size !== rule.allowedDispositions.length ||
        rule.allowedDispositions.some(value => !dispositions.has(value))) {
      throw new TypeError('Conditional roots require exact source policy, bounded dispositions and native null-parent proof');
    }
    seen.add(rule.boundary);
    return rule;
  });
}

export function compileBoundaryBindings(map, assignments = [], proofs = []) {
  validateBoundaryMap(map);
  const ids = new Set(map.spans.map(value => value.id));
  const unique = new Set();
  const assigned = assignments.map(value => {
    const key = `${value.traceId}:${value.spanId}`;
    if (!TRACE.test(value.traceId ?? '') || !SPAN.test(value.spanId ?? '') || !ids.has(value.boundaryId) ||
        !HASH.test(value.evidenceSha256 ?? '') || unique.has(key)) throw new TypeError('Invalid/ambiguous observed boundary assignment');
    unique.add(key);
    return [value.traceId, value.spanId, value.boundaryId, value.evidenceSha256];
  });
  const roots = new Set(map.deliberateRoots.map(value => value.boundary));
  const conditional = conditionalRootPolicies(map);
  const candidates = new Set(conditional.map(value => value.boundary));
  const boundaries = map.spans.map(value => [value.id, value.roleName, value.semanticKind,
    roots.has(value.id) ? 'root' : candidates.has(value.id) ? 'conditional'
      : map.edges.some(edge => edge.to === value.id && edge.type === 'parent') ? 'parent' : 'unspecified',
    JSON.stringify(map.edges.filter(edge => edge.to === value.id && edge.type === 'parent').map(edge => edge.from))]);
  const proofKeys = new Set();
  const proofRows = proofs.map(value => {
    const key = `${value.childTraceId}:${value.childSpanId}:${value.targetTraceId}:${value.targetSpanId}:${value.relation}`;
    if (!TRACE.test(value.childTraceId ?? '') || !SPAN.test(value.childSpanId ?? '') ||
        !TRACE.test(value.targetTraceId ?? '') || !SPAN.test(value.targetSpanId ?? '') ||
        !['parent', 'link'].includes(value.relation) || !HASH.test(value.evidenceSha256 ?? '') ||
        !['expected-remote', 'cross-resource', 'sampled', 'outside-window', 'outside-retention'].includes(value.classification) ||
        proofKeys.has(key)) {
      throw new TypeError('Unverified reference disposition');
    }
    proofKeys.add(key);
    return [value.childTraceId, value.childSpanId, value.targetTraceId, value.targetSpanId,
      value.relation, value.classification, value.evidenceSha256];
  });
  return {
    Assignments: table('AssignedTrace:string,AssignedSpan:string,BoundaryId:string,AssignmentEvidence:string', assigned),
    BoundaryMap: table('BoundaryId:string,ExpectedRole:string,ExpectedKind:string,ParentMode:string,AllowedParentsJson:string', boundaries),
    ConditionalRootPolicies: table('BoundaryId:string,ConditionalPolicyRef:string,AllowedRootDispositionsJson:string,RequiredRootReceiptType:string',
      conditional.map(rule => [rule.boundary, rule.policyRef, JSON.stringify(rule.allowedDispositions), rule.receiptType])),
    ReferenceProofs: table('ChildTrace:string,ChildSpan:string,TargetTrace:string,TargetSpan:string,Relation:string,ProvenClass:string,ReferenceEvidence:string', proofRows)
  };
}

const emptyConditionalProofs = () => table(
  'ConditionalTrace:string,ConditionalSpan:string,ConditionalBoundary:string,ConditionalRole:string,RootDisposition:string,RootPolicyRef:string,RootEvidence:string,CarrierEvidence:string,RootSourceEvidence:string', []);

export function compileVerifiedConditionalRootBindings(map, capability, { rows, mode } = {}) {
  const bindings = requireVerifiedTrustRootBindings(capability, { map, rows, mode });
  if (bindings.schema !== 'contoso.verified-trust-root-bindings.v1' ||
      bindings.mapSha256 !== ownedConfigurationHash(map) || bindings.mode !== mode ||
      bindings.checkerOnly !== false || bindings.actualSourceVerified !== true ||
      bindings.nativeRuntimeCarrierObserverEnrolled !== true) {
    throw new TypeError('Conditional roots remain unverified without native runtime/carrier enrollment; checker-only bindings cannot waive parents');
  }
  const rules = new Map(conditionalRootPolicies(map).map(rule => [rule.boundary, rule]));
  const seen = new Set();
  const roots = bindings.roots.map(root => {
    const rule = rules.get(root.boundaryId);
    const boundary = map.spans.find(value => value.id === root.boundaryId);
    const locator = root.sourceLocator;
    const key = `${root.traceId}:${root.spanId}`;
    if (!rule || !boundary || root.parentSpanId !== null || root.roleName !== boundary.roleName ||
        root.policyRef !== rule.policyRef || !rule.allowedDispositions.includes(root.disposition) ||
        !TRACE.test(root.traceId ?? '') || !SPAN.test(root.spanId ?? '') || seen.has(key) ||
        !HASH.test(root.rootEvidenceSha256 ?? '') || !HASH.test(root.carrierEvidenceSha256 ?? '') ||
        !HASH.test(root.nativeRowSha256 ?? '') || !locator?.captureId ||
        !['AppRequests', 'AppDependencies', 'requests', 'dependencies'].includes(locator.nativeTable) ||
        !Number.isInteger(locator.rowOrdinal) || locator.rowOrdinal < 0) {
      throw new TypeError('Native conditional root binding differs from its exact policy, parent, role or source row');
    }
    seen.add(key);
    return [root.traceId, root.spanId, root.boundaryId, root.roleName, root.disposition, root.policyRef,
      root.rootEvidenceSha256, root.carrierEvidenceSha256, ownedConfigurationHash(locator)];
  });
  return table(
    'ConditionalTrace:string,ConditionalSpan:string,ConditionalBoundary:string,ConditionalRole:string,RootDisposition:string,RootPolicyRef:string,RootEvidence:string,CarrierEvidence:string,RootSourceEvidence:string', roots);
}

export function compileViewContextBindings(proofs = []) {
  const keys = new Set();
  const rows = proofs.map(proof => {
    const locator = proof.sourceLocator;
    const key = `${proof.traceId}:${proof.nativeViewId}:${proof.roleName}`;
    if (!TRACE.test(proof.traceId ?? '') || !SPAN.test(proof.contextSpanId ?? '') ||
        typeof proof.nativeViewId !== 'string' || !proof.nativeViewId || proof.nativeViewId.length > 256 ||
        !/^contoso-[a-z0-9-]+$/.test(proof.roleName ?? '') || !HASH.test(proof.evidenceSha256 ?? '') ||
        proof.observed !== true || proof.observationKind !== 'sdk-context-and-outbound-carrier' ||
        !locator?.captureId || !['AppPageViews', 'pageViews'].includes(locator.nativeTable) ||
        !Number.isInteger(locator.rowOrdinal) || locator.rowOrdinal < 0 || keys.has(key)) {
      throw new TypeError('Browser context requires separately source-located actual SDK/carrier evidence');
    }
    keys.add(key);
    return [proof.traceId, proof.nativeViewId, proof.roleName, proof.contextSpanId, proof.evidenceSha256];
  });
  return table('ContextTrace:string,NativeViewId:string,ContextRole:string,ContextSpan:string,ContextEvidence:string', rows);
}

function nativeSource(schema) {
  const names = schema === 'workspace'
    ? ['AppRequests', 'AppDependencies', 'AppTraces', 'AppExceptions', 'AppPageViews', 'AppEvents']
    : ['requests', 'dependencies', 'traces', 'exceptions', 'pageViews', 'customEvents'];
  const kinds = ['span', 'span', 'log', 'exception', 'view', 'event'];
  const time = schema === 'workspace' ? 'TimeGenerated' : 'timestamp';
  const operation = schema === 'workspace' ? 'OperationId' : 'operation_Id';
  const parent = schema === 'workspace' ? 'ParentId' : 'operation_ParentId';
  const props = schema === 'workspace' ? 'Properties' : 'customDimensions';
  const role = schema === 'workspace' ? 'AppRoleName' : 'cloud_RoleName';
  const id = schema === 'workspace' ? 'Id' : 'id';
  return `union\n${names.map((name, index) => `(${name}
| where ${time} >= searchFrom and ${time} < windowEnd
${schema === 'workspace' ? '| where _ResourceId =~ appResourceId' : ''}
| extend NativeTable=${quote(name)}, RecordKind=${quote(kinds[index])}, IngestedAt=ingestion_time()
| project NativeTable, RecordKind, EventTime=${time}, IngestedAt, TraceId=${operation},
    RawId=tostring(column_ifexists(${quote(id)},"")), RawParentId=${parent}, RoleName=${role},
    OperationName=coalesce(tostring(column_ifexists(${quote(schema === 'workspace' ? 'Name' : 'name')},"")),tostring(column_ifexists(${quote(schema === 'workspace' ? 'ExceptionType' : 'type')},""))),
    Success=column_ifexists(${quote(schema === 'workspace' ? 'Success' : 'success')},bool(null)),
    ResultCode=tostring(column_ifexists(${quote(schema === 'workspace' ? 'ResultCode' : 'resultCode')},"")),
    BillableBytes=column_ifexists("_BilledSize",real(null)),IsBillable=tostring(column_ifexists("_IsBillable","")),
    NativeProperties=${props}, DurationMs=${schema === 'workspace' ? 'column_ifexists("DurationMs",real(null))' : 'toreal(column_ifexists("duration",totimespan(""))/1ms)'},
    ItemCount=column_ifexists(${quote(schema === 'workspace' ? 'ItemCount' : 'itemCount')},long(null)))`).join(',\n')}`;
}

const canonical = `
let CanonicalId=(raw:string,trace:string,role:string) {
    case(raw matches regex "^[a-f0-9]{16}$" and raw!="0000000000000000",raw,
         role in (compositeRoles) and compositeMappingApproved
             and raw matches regex "^\\\\|[a-f0-9]{32}\\\\.[a-f0-9]{16}\\\\.?$"
             and extract("^\\\\|([a-f0-9]{32})\\\\.",1,raw)==trace
             and extract("^\\\\|[a-f0-9]{32}\\\\.([a-f0-9]{16})",1,raw)!="0000000000000000",
         extract("^\\\\|[a-f0-9]{32}\\\\.([a-f0-9]{16})\\\\.?$",1,raw),"")
};
let Records = NativeRecords
| extend SpanId=iff(RecordKind=="span",CanonicalId(RawId,TraceId,RoleName),""),
         ParentSpanId=iff(RecordKind=="span",CanonicalId(RawParentId,TraceId,RoleName),""),
         AssociatedSpanId=iff(RecordKind in ("log","exception","event"),CanonicalId(RawParentId,TraceId,RoleName),""),
         ViewId=iff(RecordKind=="view",RawId,""),
         InvocationId=tostring(NativeProperties["business.invocation_id"]),
         LinksText=tostring(NativeProperties["_MS.links"])
| extend Links=iff(RecordKind=="span" and isnotempty(LinksText),parse_json(LinksText),dynamic([])),
         InvalidSpanMapping=RecordKind=="span" and (isempty(SpanId) or not(TraceId matches regex "^[a-f0-9]{32}$") or TraceId=="00000000000000000000000000000000"
             or (isnotempty(RawParentId) and isempty(ParentSpanId)));
`;

export async function renderKql(procedure, parameters) {
  if (!PROCEDURES.includes(procedure) || !['workspace', 'legacy'].includes(parameters.schema)) throw new TypeError('Unknown procedure/schema');
  const start = requireUtc(parameters.fromUtc, 'fromUtc');
  const end = requireUtc(parameters.toUtc, 'toUtc');
  if (Date.parse(end) <= Date.parse(start)) throw new TypeError('Invalid event window');
  const lookbackMinutes = parameters.lookbackMinutes ?? 10080;
  if (!Number.isInteger(lookbackMinutes) || lookbackMinutes < 0 || lookbackMinutes > 43200) throw new TypeError('Unapproved lookback');
  if (!/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[^"'\\]+\/providers\/Microsoft\.Insights\/components\/[^"'\\]+$/i.test(parameters.appResourceId ?? '')) {
    throw new TypeError('Approved Application Insights ARM scope required');
  }
  if (procedure === 'trace-reconstruct' && !TRACE.test(parameters.traceId ?? '')) throw new TypeError('Nonzero W3C trace required');
  if (procedure === 'business-lookup' && !UUID.test(parameters.invocationId ?? '')) throw new TypeError('Trusted canonical UUIDv4 required');
  const { map, mapSha256 } = await loadRootMap();
  if (parameters.boundaryMapSha256 && parameters.boundaryMapSha256 !== mapSha256) throw new TypeError('Root boundary-map drift');
  if (parameters.conditionalRootProofs !== undefined || parameters.conditionalRootBindings !== undefined) {
    throw new TypeError('Caller conditional-root JSON cannot replace private verified native bindings');
  }
  const bindings = compileBoundaryBindings(map, parameters.assignments, parameters.referenceProofs);
  const conditionalProofs = parameters.verifiedGraphCapability === undefined ? emptyConditionalProofs()
    : compileVerifiedConditionalRootBindings(map, parameters.verifiedGraphCapability, {
      rows: parameters.verifiedGraphRows, mode: parameters.verificationMode
    });
  if (parameters.compositeMappingApproved && !HASH.test(parameters.serializationEvidenceSha256 ?? '')) throw new TypeError('Serialization proof required');
  const compositeRoles = parameters.compositeMappingApproved ? parameters.compositeRoleNames : [];
  if (!Array.isArray(compositeRoles) || (parameters.compositeMappingApproved && compositeRoles.length === 0) ||
      compositeRoles.some(value => typeof value !== 'string' || !/^contoso-[a-z0-9-]+$/.test(value))) {
    throw new TypeError('Explicit approved serialization roles required');
  }
  const asOf = requireUtc(parameters.asOfUtc ?? new Date().toISOString(), 'asOfUtc');
  const grace = parameters.graceSeconds ?? 600;
  if (!Number.isInteger(grace) || grace < 60 || grace > 1800) throw new TypeError('Invalid ingestion grace');
  const values = {
    FromUtc: start, ToUtc: end, AsOfUtc: asOf, LookbackMinutes: String(lookbackMinutes),
    GraceSeconds: String(grace), AppResourceId: quote(parameters.appResourceId),
    TraceId: quote(parameters.traceId ?? ''), InvocationId: quote(parameters.invocationId ?? ''),
    CompositeApproved: String(parameters.compositeMappingApproved === true),
    WorkspaceTelemetry: nativeSource('workspace'), LegacyTelemetry: nativeSource('legacy'),
    CanonicalProjection: `let compositeRoles=dynamic(${JSON.stringify(compositeRoles)});\n${canonical}`,
    ViewContexts: compileViewContextBindings(parameters.viewContextProofs ?? []), ...bindings,
    ConditionalRootProofs: conditionalProofs
  };
  const path = join(project, 'kql', ...(parameters.schema === 'legacy' ? ['legacy'] : []), `${procedure}.kql`);
  const template = await readFile(path, 'utf8');
  const query = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in values)) throw new TypeError(`Unresolved KQL binding ${key}`);
    return values[key];
  });
  if (query.includes('{{')) throw new TypeError('Incomplete query');
  return { procedure, schema: parameters.schema, query, querySha256: sha256(query), mapSha256,
    scope: parameters.appResourceId, certificationEligible: false, azureExecution: 'To Do' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [procedure, parameterPath, outputPath] = process.argv.slice(2);
  if (!parameterPath || !outputPath) throw new Error('Usage: node tools\\observability\\kql.mjs procedure parameters.json output.kql');
  const result = await renderKql(procedure, JSON.parse(await readFile(parameterPath, 'utf8')));
  await writeFile(outputPath, result.query);
  console.log(JSON.stringify({ procedure, schema: result.schema, querySha256: result.querySha256,
    mapSha256: result.mapSha256, azureExecution: 'To Do' }));
}
