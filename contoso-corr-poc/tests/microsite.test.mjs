import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectReceipt, loadMicrositeData, renderMicrosite, serializeForHtml } from '../web/demo-microsite/build.mjs';
import { createMicrositeServer } from '../web/demo-microsite/serve.mjs';
import { filterDemos, graphEdgePath, projectGraph, validateLaunchUrl } from '../web/demo-microsite/site.mjs';

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
