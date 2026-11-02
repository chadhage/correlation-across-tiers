import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const HASH = /^(?!0{64}$)[a-f0-9]{64}$/;
export const TRACE = /^(?!0{32}$)[a-f0-9]{32}$/;
export const SPAN = /^(?!0{16}$)[a-f0-9]{16}$/;
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const GUARD_POLICY = 'DROP_VALID_UNSAMPLED_PARENT_AND_ALL_VALID_UNSAMPLED_LINKS';
export const GUARD_ARTIFACT_VERSION = '1.1.0';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const TELEMETRY_CONTRACT_SOURCE_SHA256 = sha256(await readFile(fileURLToPath(import.meta.url)));
export function canonicalJson(value) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new TypeError('Owned configuration requires finite canonical JSON values');
}
export const ownedConfigurationHash = value => sha256(canonicalJson(value));
const KIND = new Map([
  ['AppRequests', 'span'], ['AppDependencies', 'span'], ['AppTraces', 'log'],
  ['AppExceptions', 'exception'], ['AppPageViews', 'view'], ['AppEvents', 'event'],
  ['requests', 'span'], ['dependencies', 'span'], ['traces', 'log'],
  ['exceptions', 'exception'], ['pageViews', 'view'], ['customEvents', 'event']
]);
const SAFE_PROPERTIES = new Set([
  'business.invocation_id', 'contoso.span.kind', 'contoso.run.id', 'contoso.workflow.id',
  'contoso.branch', 'contoso.outcome', 'contoso.transport', 'contoso.process.attempt',
  'contoso.publish.attempt', 'contoso.message.id', 'contoso.original.message.id', 'contoso.causation.id',
  'contoso.context.rejection', 'contoso.link.count', 'error.type',
  'db.system', 'db.system.name', 'db.namespace', 'db.name', 'db.operation.name',
  'contoso.data.operation', 'contoso.cache.outcome', 'messaging.system',
  'messaging.destination.name', 'messaging.operation.name', 'messaging.message.id',
  'messaging.destination.partition.id', 'messaging.eventhubs.message.offset',
  'messaging.batch.message_count', 'user.pseudonym', 'auth.outcome', 'user.pseudonym.epoch'
]);

export function requireUtc(value, name) {
  if (typeof value !== 'string' || !value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${name} requires a UTC datetime`);
  }
  return new Date(value).toISOString();
}

export function validateBoundaryMap(map) {
  if (map?.schema !== 'contoso.expected-boundary-map.v1' || map.linkLimit !== 32 ||
      !Array.isArray(map.spans) || !Array.isArray(map.edges) || !Array.isArray(map.coreSynchronousBoundaries)) {
    throw new TypeError('Unsupported/incomplete root boundary map');
  }
  const ids = new Set();
  for (const boundary of map.spans) {
    if (!boundary.id || ids.has(boundary.id) || !boundary.roleName?.startsWith('contoso-') ||
        !['SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER', 'INTERNAL'].includes(boundary.semanticKind)) {
      throw new TypeError('Invalid root boundary identity');
    }
    ids.add(boundary.id);
  }
  for (const edge of map.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to) || !['parent', 'link'].includes(edge.type)) {
      throw new TypeError('Invalid root boundary edge');
    }
  }
  if (map.coreSynchronousBoundaries.length !== 8 ||
      map.coreSynchronousBoundaries.some(id => !ids.has(id))) throw new TypeError('Missing mandatory core boundary');
  return map;
}

export function canonicalSpanId(raw, traceId, mapping = null) {
  if (raw === '' || raw === null || raw === undefined) return null;
  if (typeof raw !== 'string' || !TRACE.test(traceId)) throw new TypeError('Invalid native trace/span identity');
  if (SPAN.test(raw)) return raw;
  if (mapping?.format === 'ai-composite' && HASH.test(mapping.evidenceSha256 ?? '')) {
    const parts = /^\|([a-f0-9]{32})\.([a-f0-9]{16})\.?$/.exec(raw);
    if (parts && parts[1] === traceId && SPAN.test(parts[2])) return parts[2];
  }
  throw new TypeError('Unverified native ID serialization; no arbitrary ID conversion');
}

export function nativeLinks(value) {
  if (value === undefined || value === null || value === '') return [];
  const links = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(links) || links.length > 32) throw new TypeError('Invalid/truncated native links');
  return links.map((link, linkIndex) => {
    if (!TRACE.test(link?.operation_Id ?? '') || !SPAN.test(link?.id ?? '')) throw new TypeError('Invalid native link context');
    return { targetTraceId: link.operation_Id, targetSpanId: link.id, linkIndex,
      linkAttributes: null, sampledFlag: null, tracestate: null, nativeRawLink: { ...link } };
  });
}

export function legacyDurationMilliseconds(value) {
  if (value === undefined || value === null) return null;
  if (Number.isFinite(value) && value >= 0) return value;
  const match = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?$/.exec(value);
  if (!match || Number(match[3]) >= 60 || Number(match[4]) >= 60) throw new TypeError('Unverified native duration');
  return ((Number(match[1] ?? 0) * 24 + Number(match[2])) * 3600 + Number(match[3]) * 60 + Number(match[4])) * 1000
    + (match[5] ? Number(match[5]) / 10 ** match[5].length * 1000 : 0);
}

export function normalizeTelemetryRows(rows, {
  schema, scope, captureId, capturedAtUtc, privacyDisposition, serializationByRole = {}, sourceKind
}) {
  if (!['workspace', 'legacy'].includes(schema) || privacyDisposition?.result !== 'PASS' ||
      !HASH.test(privacyDisposition.policySha256 ?? '') || !captureId || !scope?.workspaceId || !scope?.resourceId) {
    throw new TypeError('Reviewed schema/scope and pre-persistence privacy disposition required');
  }
  requireUtc(capturedAtUtc, 'capturedAtUtc');
  if (!['azure-monitor-logs', 'real-local-agent-loopback', 'fixture-check'].includes(sourceKind)) {
    throw new TypeError('Unknown telemetry provenance');
  }
  return rows.flatMap((row, index) => {
    const table = row.nativeTable ?? row.SourceTable ?? row.Type;
    const recordKind = KIND.get(table);
    if (!recordKind) throw new TypeError(`Unreviewed table ${table}`);
    if ((schema === 'workspace') !== table.startsWith('App')) throw new TypeError('Mixed telemetry schemas');
    const props = row[schema === 'workspace' ? 'Properties' : 'customDimensions'] ?? {};
    const trace = row[schema === 'workspace' ? 'OperationId' : 'operation_Id'] ?? '';
    const role = row[schema === 'workspace' ? 'AppRoleName' : 'cloud_RoleName'] ?? '';
    const rawId = row[schema === 'workspace' ? 'Id' : 'id'] ?? null;
    const rawParent = row[schema === 'workspace' ? 'ParentId' : 'operation_ParentId'] ?? null;
    const mapping = serializationByRole[role] ?? null;
    const hasTrace = trace !== '';
    if (hasTrace && !TRACE.test(trace)) throw new TypeError('Malformed native OperationId');
    const safeProperties = Object.fromEntries(Object.entries(props).filter(([key]) => SAFE_PROPERTIES.has(key)));
    const item = {
      schemaVersion: 'contoso.telemetry-evidence.v1', recordKind,
      recordLocator: { ...scope, captureId, nativeTable: table, rowOrdinal: index },
      sourceKind, certificationEligible: false,
      workspaceId: scope.workspaceId, resourceId: row._ResourceId ?? scope.resourceId,
      subscriptionId: scope.subscriptionId, resourceIdProvenance: row._ResourceId ? 'native' : 'query-scope',
      nativeTable: table, capturedAtUtc,
      timeGeneratedUtc: row[schema === 'workspace' ? 'TimeGenerated' : 'timestamp'] ?? null,
      ingestedAtUtc: row.IngestedAt ?? row.ingestedAtUtc ?? null,
      nativeOperationId: trace, nativeId: rawId, nativeParentId: rawParent,
      traceId: hasTrace ? trace : null, roleName: role, instanceId: row.AppRoleInstance ?? row.cloud_RoleInstance ?? null,
      nativeProperties: safeProperties, nativeItemCount: row.ItemCount ?? row.itemCount ?? null,
      nativeBilledSizeBytes: row._BilledSize ?? null, privacyPolicySha256: privacyDisposition.policySha256
    };
    if (recordKind === 'span') {
      if (!hasTrace) throw new TypeError('Span record lacks trace identity');
      item.spanId = canonicalSpanId(rawId, trace, mapping);
      if (!item.spanId) throw new TypeError('Span record lacks native identity');
      item.parentSpanId = canonicalSpanId(rawParent, trace, mapping);
      item.semanticKind = props['contoso.span.kind'] ?? null;
      if (item.semanticKind !== null && !['SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER', 'INTERNAL'].includes(item.semanticKind)) {
        throw new TypeError('Unreviewed native semantic kind');
      }
      item.kindEvidence = item.semanticKind ? 'native-contoso-attribute' : null;
      item.businessInvocationId = props['business.invocation_id'] ?? null;
      item.durationMs = schema === 'workspace' ? row.DurationMs ?? null : legacyDurationMilliseconds(row.durationMs ?? row.duration);
      item.success = row.Success ?? row.success ?? null;
      item.resultCode = row.ResultCode ?? row.resultCode ?? null;
      item.operationName = row.Name ?? row.name ?? null;
      item.linksDropped = null;
      item.nativeLinksJson = props['_MS.links'] ?? null;
      const decodedLinks = nativeLinks(props['_MS.links']);
      if (Number.isInteger(props['contoso.link.count']) && props['contoso.link.count'] !== decodedLinks.length) {
        throw new TypeError('Declared/native link count mismatch');
      }
      const links = decodedLinks.map(link => ({
        ...item, recordKind: 'link', spanId: undefined, parentSpanId: undefined,
        sourceTraceId: trace, sourceSpanId: item.spanId, ...link,
        nativeRepresentationPath: `${schema === 'workspace' ? 'Properties' : 'customDimensions'}["_MS.links"]`
      }));
      return [item, ...links];
    }
    if (['log', 'exception', 'event'].includes(recordKind)) {
      item.associatedSpanId = hasTrace ? canonicalSpanId(rawParent, trace, mapping) : null;
      item.businessInvocationId = props['business.invocation_id'] ?? null;
      if (recordKind === 'exception') item.exceptionType = row.ExceptionType ?? row.type ?? null;
    } else if (recordKind === 'view') {
      if (rawId !== null && (typeof rawId !== 'string' || rawId.length > 256)) {
        throw new TypeError('Unreviewed native view display identity');
      }
      item.viewId = rawId;
      item.contextSpanId = null;
    }
    return [item];
  });
}

export function validateSamplingControlAck(ack, expected) {
  if (ack?.schema !== 'contoso.sampling-control-ack.v1' || !HASH.test(ack.configSha256 ?? '') ||
      ack.layerId !== expected.layerId || ack.revision !== expected.revision ||
      ack.guardPresent !== expected.guardRequired || ack.guardSha256 !== expected.guardSha256) {
    throw new TypeError('Sampling acknowledgement does not match the approved participant');
  }
  if (expected.eligibleFull && (ack.percentage !== 100 || ack.requestsPerSecond !== null)) {
    throw new TypeError('Eligible-full native sampling requires 100 and absent RPS');
  }
  if (expected.guardRequired && (ack.guardPolicy !== (expected.guardPolicy ?? GUARD_POLICY) ||
      ack.guardArtifactVersion !== (expected.guardArtifactVersion ?? GUARD_ARTIFACT_VERSION))) {
    throw new TypeError('Native acknowledgement does not identify the actual approved parent/link guard policy');
  }
  if (ack.privacyChanged !== false || ack.secretsIncluded !== false || ack.providerConstruction !== false || ack.extraExporter !== false) {
    throw new TypeError('Unsafe sampling acknowledgement');
  }
  if (expected.runId) {
    const observedAt = Date.parse(requireUtc(ack.observedAtUtc, 'observedAtUtc'));
    if (ack.runId !== expected.runId || ack.activeLeaseId !== expected.activeLeaseId ||
        typeof ack.runtimeInstanceId !== 'string' || !ack.runtimeInstanceId ||
        observedAt < Date.parse(expected.observedNotBeforeUtc) ||
        ownedConfigurationHash(ack.ownedConfiguration) !== ack.configSha256 ||
        ack.sourceKind !== 'trusted-runtime-observation') {
      throw new TypeError('Stale/unbound or configuration-only runtime acknowledgement');
    }
    if (expected.independentProvider && (ack.providerCount !== 1 || ack.exporterCount !== 1)) {
      throw new TypeError('Independent runtime provider/exporter ownership is unproven');
    }
  }
  return ack;
}
