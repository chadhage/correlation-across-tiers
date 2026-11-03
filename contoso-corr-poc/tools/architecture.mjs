import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mapPath = path.join(root, 'contracts', 'expected-boundary-map.v1.json');
const outputPath = path.join(root, 'docs', 'ARCHITECTURE.md');
const nodeId = (id) => id.replaceAll('.', '_');

export function renderArchitecture(map) {
  if (map.schema !== 'contoso.expected-boundary-map.v1') throw new Error('Unsupported boundary-map schema');
  const spans = new Map(map.spans.map((span) => [span.id, span]));
  if (spans.size !== map.spans.length || map.linkLimit !== 32) throw new Error('Invalid boundary IDs/link limit');
  for (const id of map.coreSynchronousBoundaries) if (!spans.has(id)) throw new Error(`Missing core boundary: ${id}`);
  const lines = ['# Contoso correlation architecture', '',
    'Generated from the single expected boundary map. This is the declared topology, not a claim of observed certification.',
    '', '```mermaid', 'flowchart LR'];
  for (const span of map.spans) {
    if (!['SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER', 'INTERNAL'].includes(span.semanticKind)) throw new Error(`Invalid span kind: ${span.id}`);
    if (!span.label.startsWith('Contoso ') || !span.roleName.startsWith('contoso-')) throw new Error(`Non-Contoso identity: ${span.id}`);
    lines.push(`  ${nodeId(span.id)}["${span.label}<br/>${span.semanticKind}"]`);
  }
  for (const edge of map.edges) {
    if (!spans.has(edge.from) || !spans.has(edge.to) || !['parent', 'link'].includes(edge.type)) throw new Error('Invalid boundary edge');
    lines.push(edge.type === 'parent'
      ? `  ${nodeId(edge.from)} -->|parent| ${nodeId(edge.to)}`
      : `  ${nodeId(edge.from)} -.->|link| ${nodeId(edge.to)}`);
  }
  lines.push('  Entra["Microsoft Entra authentication"]',
    '  Vault["Contoso Key Vault references / HMAC storage"]',
    '  Appi["Contoso Application Insights"]',
    '  Law["Contoso Log Analytics"]',
    '  Entra -.->|authorization, not trace identity| gateway_request',
    '  Vault -.->|safe configuration, never secret evidence| orders_request',
    '  orders_request -.->|direct Azure Monitor export| Appi',
    '  portal_request -.->|independent Node export| Appi',
    '  storefront_http -.->|public browser ingestion| Appi',
    '  Appi --> Law', '```', '',
    'Solid edges are parent relationships; dotted edges are links or labelled non-causal configuration/export flows.',
    'PostgreSQL and Redis nodes are CLIENT operations, not database server continuations.', '',
    '## Declared new-root boundaries', '');
  for (const boundary of map.deliberateRoots) lines.push(`- ${boundary.boundary}: ${boundary.reason}`);
  lines.push('', '## Conditional A03 root candidates', '',
    'These are not unconditional parent-edge exemptions. R7/R9 must verify a separately source-bound native trust-root receipt, actual null parent and real native IDs before accepting an edge break.',
    'Policy deletion, a caller label, valid context with invalid state, or business-ID replacement is not such a receipt.', '');
  for (const boundary of map.conditionalRoots ?? []) {
    if (!spans.has(boundary.boundary) || typeof boundary.policyRef !== 'string' || !boundary.policyRef
      || boundary.receiptType !== 'source-bound-native-trust-root'
      || boundary.parentMustBeNull !== true || boundary.sourceProofRequired !== true
      || !Array.isArray(boundary.allowedDispositions) || boundary.allowedDispositions.length === 0
      || boundary.allowedDispositions.some(value => ['valid', 'NONE', 'invalid-tracestate', 'generated-untrusted'].includes(value))) {
      throw new Error('Invalid conditional root contract');
    }
    lines.push(`- ${boundary.boundary}: ${boundary.allowedDispositions.join(', ')}; native receipt required.`);
  }
  lines.push('', '## Transport and trust limits', '',
    '- Service Bus, Event Hubs, Event Grid, and Queue carry context; no invented broker spans.',
    '- VNet-integrated workers use the selected authenticated TLS transport endpoints. Integration is not Private Link.',
    '- PostgreSQL and Managed Redis private connectivity is independent of application ingress and SCM deployment.',
    '- Result/outbox work retains real contributor contexts; fan-in and mixed batches have no arbitrary input parent.',
    '- Browser telemetry is publicly injectable; controlled synthetic certification is not universal actor attestation.',
    '- Complete sampled positive vectors and strict unsampled propagation are separate, mandatory assertions.', '');
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (!['--check', '--write'].includes(mode) || process.argv.length !== 3) throw new Error('Usage: node tools\\architecture.mjs --check|--write');
  const text = renderArchitecture(JSON.parse(await readFile(mapPath, 'utf8')));
  if (mode === '--write') await writeFile(outputPath, text, 'utf8');
  else if ((await readFile(outputPath, 'utf8')).replaceAll('\r\n', '\n') !== text) throw new Error('Architecture is stale; regenerate from the map');
}
