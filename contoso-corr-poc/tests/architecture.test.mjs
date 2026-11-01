import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { renderArchitecture } from '../tools/architecture.mjs';
import { projectRoot } from '../tools/kanban.mjs';

const map = JSON.parse(await readFile(path.join(projectRoot, 'contracts', 'expected-boundary-map.v1.json'), 'utf8'));

test('declares all eight synchronous boundaries and separate SSR, replay, fan-in and batch roots', () => {
  assert.equal(map.coreSynchronousBoundaries.length, 8);
  assert.ok(map.deliberateRoots.some((item) => item.boundary === 'portal.request'));
  for (const boundary of ['aggregator.fanin', 'aggregator.batch', 'aggregator.replay']) {
    assert.ok(map.deliberateRoots.some((item) => item.boundary === boundary));
    assert.equal(map.edges.filter((edge) => edge.to === boundary && edge.type === 'parent').length, 0);
  }
});

test('data tiers are client boundaries and actual contributors are bounded links', () => {
  for (const id of ['postgres.logical', 'redis.logical']) {
    const span = map.spans.find((item) => item.id === id);
    assert.equal(span.semanticKind, 'CLIENT');
    assert.equal(span.serverContinuation, false);
  }
  assert.equal(map.linkLimit, 32);
  assert.ok(map.edges.some((edge) => edge.from === 'fulfillment.process' && edge.to === 'aggregator.fanin' && edge.type === 'link'));
  assert.ok(map.edges.some((edge) => edge.from === 'notify.process' && edge.to === 'aggregator.fanin' && edge.type === 'link'));
});

test('renders the graph from one map and rejects unknown/malformed edges', () => {
  const text = renderArchitecture(map);
  assert.match(text, /```mermaid/);
  assert.match(text, /gateway_backend -->\|parent\| orders_request/);
  assert.match(text, /fulfillment_process -\.->\|link\| aggregator_fanin/);
  const broken = structuredClone(map);
  broken.edges.push({ from: 'missing', to: 'orders.request', type: 'parent' });
  assert.throws(() => renderArchitecture(broken), /Invalid boundary edge/);
});
