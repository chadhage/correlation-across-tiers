import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectReceipt, loadMicrositeData, renderMicrosite, serializeForHtml } from '../web/demo-microsite/build.mjs';
import { createMicrositeServer } from '../web/demo-microsite/serve.mjs';
import { filterDemos, graphEdgePath, projectGraph, projectSequence, sequenceEdgePath, validateLaunchUrl } from '../web/demo-microsite/site.mjs';

const data = await loadMicrositeData({ builtAt: '2026-11-02T05:00:00.000Z' });

test('microsite includes every current catalog entry, its README and exact required boundaries', async () => {
  const catalog = JSON.parse(await readFile(new URL('../demos/catalog.json', import.meta.url), 'utf8'));
  assert.deepEqual(data.demos.map(demo => demo.id), catalog.demos.map(demo => demo.id));
  for (const demo of data.demos) {
    const original = catalog.demos.find(item => item.id === demo.id);
    const boundaries = typeof original.requiredBoundaries === 'string'
      ? data.boundaryMap[original.requiredBoundaries] : original.requiredBoundaries;
    assert.deepEqual(demo.boundaries, boundaries);
    assert.ok(data.sources.some(source => source.path === `demos\\${demo.id}\\README.md`));
  }
  assert.equal(data.certification, 'NOT CERTIFIED');
  assert.equal(data.evidence.conditional.fullGraphVerified, false);
  assert.equal(data.evidence.conditional.azureAccepted, false);
});

test('every graph projects source-defined edges only, with distinct parent/link semantics', () => {
  for (const demo of data.demos) {
    const graph = projectGraph(data.boundaryMap, demo.boundaries);
    assert.equal(graph.nodes.length, demo.boundaries.length);
    assert.deepEqual(graph.edges, data.boundaryMap.edges.filter(edge =>
      demo.boundaries.includes(edge.from) && demo.boundaries.includes(edge.to)));
    for (const node of graph.nodes) {
      assert.ok(Number.isFinite(node.x) && node.x >= 0);
      assert.ok(Number.isFinite(node.y) && node.y >= 0);
      assert.ok(node.x + 176 <= graph.width && node.y + 76 <= graph.height);
    }
  }
  const replay = projectGraph(data.boundaryMap, data.demos.find(demo => demo.id === '07').boundaries);
  assert.equal(replay.edges.some(edge => edge.from.endsWith('replay.process') && edge.to.endsWith('replay.send')), false);
  const batch = projectGraph(data.boundaryMap, data.demos.find(demo => demo.id === '09').boundaries);
  assert.equal(batch.edges.find(edge => edge.to === 'aggregator.batch').type, 'link');
  for (const id of ['postgres.logical', 'redis.logical']) {
    assert.equal(data.boundaryMap.spans.find(span => span.id === id).serverContinuation, false);
  }
  assert.throws(() => projectGraph(data.boundaryMap, ['unknown']), /Unknown boundary/);
});

test('graph rejects cycles rather than rendering a plausible incomplete layout', () => {
  const map = {
    spans: [{ id: 'a', roleName: 'one' }, { id: 'b', roleName: 'two' }],
    edges: [{ from: 'a', to: 'b', type: 'parent' }, { from: 'b', to: 'a', type: 'link' }]
  };
  assert.throws(() => projectGraph(map, ['a', 'b']), /cycle/);
});

test('parallel data-client edges route around intervening nodes rather than implying a database chain', () => {
  const demo = data.demos.find(item => item.id === '01');
  const graph = projectGraph(data.boundaryMap, demo.boundaries);
  const from = graph.nodes.find(node => node.id === 'inventory.request');
  const postgres = graph.nodes.find(node => node.id === 'postgres.logical');
  const redis = graph.nodes.find(node => node.id === 'redis.logical');
  assert.match(graphEdgePath(from, postgres), / L /);
  assert.match(graphEdgePath(from, redis), / C /);
  assert.ok(graphEdgePath(from, redis).includes(String(from.x + 204)));
  assert.equal(graph.edges.some(edge => edge.from === postgres.id && edge.to === redis.id), false);
});

test('every sequence covers the selected boundaries and each exact source relationship in dependency order', () => {
  for (const demo of data.demos) {
    const sequence = projectSequence(data.boundaryMap, demo.boundaries);
    const spans = data.boundaryMap.spans.filter(span => demo.boundaries.includes(span.id));
    const edges = data.boundaryMap.edges.filter(edge =>
      demo.boundaries.includes(edge.from) && demo.boundaries.includes(edge.to));
    assert.deepEqual(sequence.participants.map(participant => participant.id), [...new Set(spans.map(span => span.roleName))]);
    assert.deepEqual(new Set(sequence.steps.map(step => step.span.id)), new Set(demo.boundaries));
    assert.equal(sequence.steps.filter(step => step.edge).length, edges.length);
    for (const edge of edges) assert.equal(sequence.steps.filter(step => step.edge === edge).length, 1);
    const seen = new Set();
    sequence.steps.forEach((step, index) => {
      assert.equal(step.number, index + 1);
      assert.ok(step.y > 56 && step.y + 40 < sequence.height);
      for (const x of [step.fromX, step.toX, step.labelX]) assert.ok(x > 0 && x < sequence.width);
      if (step.edge) {
        assert.ok(seen.has(step.edge.from), `Source must precede ${step.span.id}`);
        assert.equal(step.edge.to, step.span.id);
      } else {
        assert.equal(edges.some(edge => edge.to === step.span.id), false);
      }
      seen.add(step.span.id);
    });
  }
});

test('sequence links never become parents, replay PROCESS-to-SEND edges, or a multi-parent instance', () => {
  const replay = projectSequence(data.boundaryMap, data.demos.find(demo => demo.id === '07').boundaries);
  assert.equal(replay.steps.some(step => step.edge?.from.endsWith('replay.process')
    && step.edge.to.endsWith('replay.send')), false);
  assert.ok(replay.steps.filter(step => step.span.id.endsWith('replay.send'))
    .every(step => step.edge.type === 'link' && step.edge.from === 'orders.servicebus.send'));
  const batch = projectSequence(data.boundaryMap, data.demos.find(demo => demo.id === '09').boundaries);
  const batchRoot = batch.steps.find(step => step.span.id === 'aggregator.batch');
  assert.equal(batchRoot.edge.type, 'link');
  assert.equal(batchRoot.edge.cardinality, 'each-contributor');
  const fanin = projectSequence(data.boundaryMap, data.demos.find(demo => demo.id === '08').boundaries);
  const results = fanin.steps.filter(step => step.span.id === 'aggregator.result');
  assert.equal(results.length, 2);
  assert.deepEqual(results.map(step => step.edge.from), ['fulfillment.result', 'notify.result']);
  assert.ok(results.every(step => step.edge.type === 'parent'));
  assert.ok(fanin.steps.filter(step => step.span.id === 'aggregator.fanin').every(step => step.edge.type === 'link'));
});

test('sequence data operations stay on the Inventory lifeline without invented database or broker actors', () => {
  const sequence = projectSequence(data.boundaryMap, data.demos.find(demo => demo.id === '12').boundaries);
  assert.deepEqual(sequence.participants.map(participant => participant.id), ['contoso-inventory-api']);
  for (const id of ['postgres.logical', 'redis.logical']) {
    const step = sequence.steps.find(item => item.span.id === id);
    assert.equal(step.span.semanticKind, 'CLIENT');
    assert.equal(step.edge.from, 'inventory.request');
    assert.equal(step.fromX, step.toX);
    assert.equal(sequenceEdgePath(step), `M ${step.fromX} ${step.y} L ${step.fromX + 64} ${step.y} L ${step.fromX + 64} ${step.y + 18} L ${step.toX + 4} ${step.y + 18}`);
  }
});

test('a single selected boundary gets no invented inbound arrow or external initiator', () => {
  const sequence = projectSequence(data.boundaryMap, ['orders.request']);
  assert.equal(sequence.participants.length, 1);
  assert.equal(sequence.steps.length, 1);
  assert.equal(sequence.steps[0].edge, null);
  assert.throws(() => sequenceEdgePath(sequence.steps[0]), /no relationship arrow/);
});

test('sequence ordering supports re-entering an application role but rejects unknown, empty and cyclic selections', () => {
  const map = {
    spans: [{ id: 'a', roleName: 'one' }, { id: 'b', roleName: 'two' }, { id: 'c', roleName: 'one' }],
    edges: [{ from: 'a', to: 'b', type: 'parent' }, { from: 'b', to: 'c', type: 'parent' }]
  };
  const sequence = projectSequence(map, ['c', 'b', 'a']);
  assert.deepEqual(sequence.steps.map(step => step.span.id), ['a', 'b', 'c']);
  assert.equal(sequence.participants.length, 2);
  const returning = sequence.steps[2];
  assert.ok(returning.fromX > returning.toX);
  assert.equal(sequenceEdgePath(returning), `M ${returning.fromX - 4} ${returning.y} L ${returning.toX + 6} ${returning.y}`);
  assert.throws(() => projectSequence(map, ['unknown']), /Unknown boundary/);
  assert.throws(() => projectSequence(map, []), /at least one boundary/);
  assert.throws(() => projectSequence({ ...map, edges: [...map.edges, { from: 'c', to: 'a', type: 'link' }] }, ['a', 'b', 'c']), /cycle/);
});

test('catalog filtering supports titles, IDs, boundaries, criteria, and empty results', () => {
  assert.equal(filterDemos(data.demos, '', 'all').length, data.demos.length);
  assert.deepEqual(filterDemos(data.demos, '08', 'all').map(demo => demo.id), ['08']);
  assert.ok(filterDemos(data.demos, 'postgres.logical', 'http').some(demo => demo.id === '12'));
  assert.ok(filterDemos(data.demos, 'Durable lookup', 'async').length > 0);
  assert.deepEqual(filterDemos(data.demos, 'no-such-scenario', 'all'), []);
});

test('launch URLs allow HTTPS and explicit local HTTP without credential/context-bearing suffixes', () => {
  assert.equal(validateLaunchUrl(''), '');
  assert.equal(validateLaunchUrl('  https://demo.example.test/portal  '), 'https://demo.example.test/portal');
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(validateLaunchUrl(`http://${host}:8080`), `http://${host}:8080/`);
  }
  for (const value of [
    'javascript:alert(1)', 'data:text/html,test', '//demo.example.test', 'not a URL',
    'http://example.test', 'https://user:password@example.test', 'https://example.test/?token=secret',
    'https://example.test/#access_token=secret', 'file:///C:/test.html'
  ]) {
    assert.throws(() => validateLaunchUrl(value));
  }
});

test('receipt checks distinguish exact bytes, changed records, missing records and unsafe paths', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'contoso-microsite-receipt-'));
  try {
    const content = '{"scope":"local"}';
    const sha256 = createHash('sha256').update(content).digest('hex');
    const receipt = { artifact: 'record.json', sha256 };
    await writeFile(path.join(root, 'record.json'), content);
    assert.equal((await inspectReceipt(root, receipt)).state, 'matches');
    await writeFile(path.join(root, 'record.json'), '{"scope":"changed"}');
    assert.equal((await inspectReceipt(root, receipt)).state, 'differs');
    assert.equal((await inspectReceipt(root, { ...receipt, artifact: 'missing.json' })).state, 'missing');
    await assert.rejects(inspectReceipt(root, { ...receipt, artifact: '..\\outside.json' }), /inside/);
    await assert.rejects(inspectReceipt(root, { ...receipt, artifact: 'C:\\outside.json' }), /relative/);
    await assert.rejects(inspectReceipt(root, { ...receipt, sha256: 'invalid' }), /digest/);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('header navigation lives in a hamburger-controlled modal drawer at every viewport', async () => {
  const template = await readFile(new URL('../web/demo-microsite/template.html', import.meta.url), 'utf8');
  const header = template.match(/<header\b[^>]*>([\s\S]*?)<\/header>/)[1];
  assert.match(header, /id="navigation-toggle"[^>]+aria-controls="navigation-drawer" aria-expanded="false" aria-haspopup="dialog"/);
  assert.doesNotMatch(header, /<nav\b|id="theme-toggle"|data-open-environment/);
  const drawer = template.match(/<dialog id="navigation-drawer"[^>]*>([\s\S]*?)<\/dialog>/)[1];
  assert.match(drawer, /aria-label="Close navigation menu" autofocus/);
  assert.match(drawer, /<nav class="drawer-nav" aria-label="Main navigation">/);
  assert.match(drawer, /href="https:\/\/github\.com\/chadhage\/correlation-across-tiers" target="_blank" rel="noopener noreferrer" aria-label="GitHub repository \(opens in a new tab\)"/);
  for (const id of ['walkthrough', 'topology', 'evidence', 'operations']) {
    assert.match(drawer, new RegExp(`href="#${id}"`));
    assert.match(template, new RegExp(`<section id="${id}"[^>]+tabindex="-1"`));
  }
  assert.match(drawer, /id="theme-toggle"/);
  assert.match(drawer, /data-open-environment/);
  assert.equal((template.match(/id="navigation-toggle"/g) ?? []).length, 1);
  assert.equal((template.match(/id="navigation-drawer"/g) ?? []).length, 1);
  assert.match(template, /prefers-reduced-motion: reduce/);
});

test('hero retains its introduction and actions without a scope aside or reserved column', async () => {
  const template = await readFile(new URL('../web/demo-microsite/template.html', import.meta.url), 'utf8');
  const hero = template.match(/<div class="hero">([\s\S]*?)<div class="inventory-strip"/)[1];
  assert.match(hero, /<h1>Follow a request\.<br>Inspect the boundaries\.<\/h1>/);
  for (const id of ['walkthrough', 'evidence']) {
    assert.match(hero, new RegExp(`href="#${id}"`));
  }
  assert.doesNotMatch(hero, /<aside\b/);
  assert.doesNotMatch(template, /scope-card|scope-row|scope-note/);
  assert.doesNotMatch(template, /\.hero\s*\{[^}]*grid-template-columns/);
});

test('standalone output embeds source data safely, applies the required theme, and blocks network connections', async () => {
  const [template, script] = await Promise.all([
    readFile(new URL('../web/demo-microsite/template.html', import.meta.url), 'utf8'),
    readFile(new URL('../web/demo-microsite/site.mjs', import.meta.url), 'utf8')
  ]);
  const html = renderMicrosite(data, template, script);
  const windowsHtml = renderMicrosite(data,
    template.replace(/\r\n?/g, '\n').replaceAll('\n', '\r\n'),
    script.replace(/\r\n?/g, '\n').replaceAll('\n', '\r\n'));
  assert.equal(windowsHtml, html);
  assert.doesNotMatch(html, /\r/);
  assert.doesNotMatch(html, /\{\{(?:SITE_|CSP|BUILT_AT|DEMO_COUNT|BOUNDARY_COUNT|ROLE_COUNT)/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /clawpilotTheme/);
  assert.match(html, /--cp-bg: #f7f4ef/);
  assert.match(html, /html\[data-theme="dark"\]/);
  assert.match(html, /data-diagram-view="graph" aria-controls="graph-panel" aria-pressed="true"/);
  assert.match(html, /data-diagram-view="sequence" aria-controls="sequence-panel" aria-pressed="false"/);
  assert.match(html, /id="sequence-panel"[^>]+hidden/);
  assert.match(html, /Dependency order only, not observed timing or attempt counts/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|<iframe|<img[^>]+src=/i);
  const payload = JSON.parse(html.match(/<script id="site-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(payload.demos.length, data.demos.length);
  assert.ok(data.sources.find(source => source.path === 'config\\verification-register.v1.json').excerpt);
  assert.equal(JSON.parse(serializeForHtml({ text: '</script><script>alert(1)</script>\u2028' })).text, '</script><script>alert(1)</script>\u2028');
  assert.doesNotMatch(serializeForHtml({ text: '</script>' }), /<\/script>/);
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const hash = createHash('sha256').update(match[1]).digest('base64');
    assert.ok(html.includes(`'sha256-${hash}'`));
  }
  const componentStyles = html.slice(html.indexOf('* { box-sizing'));
  assert.doesNotMatch(componentStyles.split('</style>')[0], /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
});

test('preview serves only the generated artifact and never repository files or execution endpoints', async () => {
  const server = createMicrositeServer('<!doctype html><title>Microsite test</title>');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/?clawpilotTheme=dark`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Microsite test/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await fetch(`${base}/index.html`, { method: 'HEAD' })).status, 200);
    for (const route of ['/config/verification-register.v1.json', '/execute', '/..%2fREADME.md']) {
      assert.equal((await fetch(`${base}${route}`)).status, 404);
    }
    assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
