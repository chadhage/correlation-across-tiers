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
  for (const boundary of ['aggregator.fanin', 'aggregator.batch', 'fulfillment.replay.process', 'notify.replay.process', 'fulfillment.replay.send', 'notify.replay.send']) {
    assert.ok(map.deliberateRoots.some((item) => item.boundary === boundary));
    assert.equal(map.edges.filter((edge) => edge.to === boundary && edge.type === 'parent').length, 0);
  }
});

test('conditional A03 roots cannot waive valid parents or replace actual native receipts', () => {
  const gateway = map.conditionalRoots.find(item => item.boundary === 'gateway.request');
  assert.deepEqual(gateway.allowedDispositions, ['absent', 'duplicate', 'invalid']);
  assert.equal(gateway.parentMustBeNull, true);
  assert.equal(gateway.sourceProofRequired, true);
  assert.equal(map.deliberateRoots.some(item => item.boundary === 'gateway.request'), false);
  const broken = structuredClone(map);
  broken.conditionalRoots[0].allowedDispositions.push('valid');
  assert.throws(() => renderArchitecture(broken), /Invalid conditional root/);
  assert.equal(map.spans.some(item => ['aggregator.replay', 'orders.replay.send'].includes(item.id)), false);
  assert.equal(map.spans.find(item => item.id === 'notify.replay.send').roleName, 'contoso-notify-worker');
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
