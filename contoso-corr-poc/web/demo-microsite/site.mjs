export function validateLaunchUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  let url;
  try {
    url = new URL(trimmed);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new Error('Enter an absolute HTTPS URL, or HTTP on localhost.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Use HTTPS; HTTP is allowed only on localhost, 127.0.0.1, or [::1].');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Use a base URL without credentials, query parameters, or a fragment.');
  }
  return url.href;
}

export function filterDemos(demos, query, group) {
  const needle = query.trim().toLowerCase();
  return demos.filter(demo => {
    const category = ['01', '02', '03', '12'].includes(demo.id) ? 'http'
      : ['06', '07', '08', '09', '10'].includes(demo.id) ? 'async' : 'controls';
    const text = [demo.id, demo.title, demo.purpose, ...demo.criteria, ...demo.boundaries].join(' ').toLowerCase();
    return (group === 'all' || group === category) && text.includes(needle);
  });
}

function ranks(ids, edges) {
  const result = new Map(ids.map(id => [id, 0]));
  const incoming = new Map(ids.map(id => [id, 0]));
  for (const edge of edges) incoming.set(edge.to, incoming.get(edge.to) + 1);
  const ready = ids.filter(id => incoming.get(id) === 0);
  let visited = 0;
  while (ready.length) {
    const id = ready.shift();
    visited++;
    for (const edge of edges.filter(edge => edge.from === id)) {
      result.set(edge.to, Math.max(result.get(edge.to), result.get(id) + 1));
      incoming.set(edge.to, incoming.get(edge.to) - 1);
      if (incoming.get(edge.to) === 0) ready.push(edge.to);
    }
  }
  if (visited !== ids.length) throw new Error('This boundary selection contains a cycle; inspect the source map.');
  return result;
}

export function projectGraph(map, boundaries) {
  const selected = new Set(boundaries);
  const spans = map.spans.filter(span => selected.has(span.id));
  if (spans.length !== selected.size) throw new Error('Unknown boundary in graph selection');
  const edges = map.edges.filter(edge => selected.has(edge.from) && selected.has(edge.to));
  const nodeRanks = ranks(spans.map(span => span.id), edges);
  const roleIds = [...new Set(spans.map(span => span.roleName))];
  const byId = new Map(spans.map(span => [span.id, span]));
  const roleEdges = edges
    .map(edge => ({ from: byId.get(edge.from).roleName, to: byId.get(edge.to).roleName }))
    .filter(edge => edge.from !== edge.to);
  const roleRanks = ranks(roleIds, roleEdges);
  const columnBottom = new Map();
  const roles = [];
  const nodes = [];
  for (const role of roleIds) {
    const column = roleRanks.get(role);
    const x = 28 + column * 224;
    const top = columnBottom.get(column) ?? 24;
    roles.push({ id: role, x, y: top });
    const members = spans.filter(span => span.roleName === role)
      .sort((a, b) => nodeRanks.get(a.id) - nodeRanks.get(b.id));
    members.forEach((span, index) => nodes.push({ ...span, x, y: top + 20 + index * 100 }));
    columnBottom.set(column, top + members.length * 100 + 52);
  }
  return {
    nodes,
    edges,
    roles,
    width: 224 * (Math.max(...roleRanks.values()) + 1) + 12,
    height: Math.max(...columnBottom.values()) + 4
  };
}

export function graphEdgePath(from, to) {
  if (from.x === to.x) {
    if (to.y - from.y === 100) {
      return `M ${from.x + 88} ${from.y + 78} L ${to.x + 88} ${to.y - 2}`;
    }
    const side = from.x + 204;
    return `M ${from.x + 178} ${from.y + 38} C ${side} ${from.y + 38}, ${side} ${to.y + 38}, ${to.x + 178} ${to.y + 38}`;
  }
  const x1 = from.x + 178;
  const y1 = from.y + 38;
  const x2 = to.x - 3;
  const y2 = to.y + 38;
  const middle = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`;
}

function initializeMicrosite() {
  const data = JSON.parse(document.getElementById('site-data').textContent);
  const $ = id => document.getElementById(id);
  const map = data.boundaryMap;
  const storageKey = 'contoso-demo-microsite.environment.v1';
  const environmentKeys = ['storefront', 'portal', 'gateway'];
  let selectedDemo = data.demos[0];
  let selectedBoundary = selectedDemo.boundaries[0];
  let group = 'all';
  let environment = {};
  const notice = message => {
    $('notice').textContent = message;
    $('notice').hidden = false;
  };
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, className, onClick) => {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  };
  const svgElement = (tag, attributes = {}, text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const badge = text => element('span', 'tag', text);
  const sourceFor = path => {
    const source = data.sources.find(item => item.path === path);
    if (!source) throw new Error(`Source is not in this snapshot: ${path}`);
    return source;
  };
  const showSource = path => {
    $('source-select').value = path;
    renderSource();
    if (!$('source-dialog').open) $('source-dialog').showModal();
  };
  const copy = async text => {
    if (!navigator.clipboard?.writeText) {
      notice('Clipboard access is unavailable. Select the displayed text and copy it manually.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      notice('Copied to clipboard. Commands are templates; nothing was executed.');
    } catch (error) {
      notice(`Clipboard write failed (${error.name}). Select the displayed text and copy it manually.`);
    }
  };

  function renderSource() {
    const source = sourceFor($('source-select').value);
    $('source-text').textContent = source.content;
    $('source-digest').textContent = `SHA-256 ${source.sha256}`;
    $('source-excerpt').hidden = !source.excerpt;
  }

  function renderList() {
    const filtered = filterDemos(data.demos, $('demo-search').value, group);
    $('demo-count').textContent = `${filtered.length} of ${data.demos.length} scenarios`;
    $('demo-list').replaceChildren(...filtered.map(demo => {
      const item = button('', 'demo-item', () => selectDemo(demo.id));
      item.setAttribute('aria-pressed', String(demo.id === selectedDemo.id));
      item.append(element('span', 'demo-number', demo.id), element('span', 'demo-item-title', demo.title));
      return item;
    }));
    $('empty-search').hidden = filtered.length !== 0;
    renderNavigation();
  }

  function renderNavigation() {
    const visible = filterDemos(data.demos, $('demo-search').value, group);
    const index = visible.indexOf(selectedDemo);
    $('previous-demo').disabled = index <= 0;
    $('next-demo').disabled = index < 0 || index === visible.length - 1;
  }

  function runTemplate() {
    return `powershell -NoProfile -File .\\demos\\${selectedDemo.id}\\Run.ps1 --mode LocalValidate --adapter <reviewed-relative-module> --adapter-sha256 <reviewed-sha256>`;
  }

  function resetTemplate() {
    return `powershell -NoProfile -File .\\demos\\${selectedDemo.id}\\Reset.ps1 --pack <run-owned-evidence-pack> --adapter <reviewed-relative-module> --adapter-sha256 <reviewed-sha256>`;
  }

  function renderDemo() {
    $('selected-demo-number').textContent = `DEMO ${selectedDemo.id} / ${String(data.demos.length).padStart(2, '0')}`;
    $('selected-demo-title').textContent = selectedDemo.title;
    $('selected-demo-purpose').textContent = selectedDemo.purpose;
    $('demo-scenario').textContent = selectedDemo.scenario;
    $('demo-criteria').replaceChildren(...selectedDemo.criteria.map(badge));
    $('demo-boundaries').replaceChildren(...selectedDemo.boundaries.map(id =>
      button(id, 'boundary-chip', () => {
        selectedBoundary = id;
        renderGraph();
        $('topology').scrollIntoView({ behavior: 'instant', block: 'start' });
        $('boundary-title').focus({ preventScroll: true });
      })));
    $('owner-effect').hidden = !selectedDemo.requiresOwnerEffect;
    $('owner-effect').textContent = selectedDemo.requiresOwnerEffect ? `Separate owner action required: ${selectedDemo.requiresOwnerEffect}.` : '';
    $('run-template').textContent = runTemplate();
    $('reset-template').textContent = resetTemplate();
    $('graph-demo-label').textContent = `Demo ${selectedDemo.id} / ${selectedDemo.title}`;
    renderNavigation();
  }

  function renderInspector() {
    const span = map.spans.find(item => item.id === selectedBoundary);
    $('boundary-title').textContent = span.label.replace(/^Contoso /, '');
    $('boundary-id').textContent = span.id;
    $('boundary-role').textContent = span.roleName;
    $('boundary-kind').textContent = span.semanticKind;
    const root = map.deliberateRoots.find(item => item.boundary === span.id);
    const conditional = map.conditionalRoots.find(item => item.boundary === span.id);
    const notes = [];
    if (span.serverContinuation === false) notes.push('CLIENT operation only. No database server continuation is declared.');
    if (root) notes.push(root.reason);
    if (conditional) notes.push(`Conditional root candidate (${conditional.allowedDispositions.join(', ')}). Actual null-parent and source-bound native receipts are required; this map is not that evidence.`);
    if (span.roleMappingRequiresLiveEvidence) notes.push('The Gateway role mapping still requires live evidence.');
    if (!notes.length) notes.push('Evaluate the declared parent or link against actual native rows. This definition is not an observed span.');
    $('boundary-notes').replaceChildren(...notes.map(text => element('p', '', text)));
    const relationships = map.edges.filter(edge => selectedDemo.boundaries.includes(edge.from)
      && selectedDemo.boundaries.includes(edge.to) && [edge.from, edge.to].includes(span.id));
    $('boundary-edges').replaceChildren(...relationships.map(edge => {
      const row = element('li');
      row.append(element('code', '', `${edge.from} ${edge.type === 'link' ? '-- link -->' : '-- parent -->'} ${edge.to}`));
      return row;
    }));
    $('no-edges').hidden = relationships.length !== 0;
    document.querySelectorAll('[data-boundary]').forEach(node => {
      node.setAttribute('aria-pressed', String(node.dataset.boundary === selectedBoundary));
    });
    document.querySelectorAll('[data-edge-from]').forEach(node => {
      node.classList.toggle('related', [node.dataset.edgeFrom, node.dataset.edgeTo].includes(selectedBoundary));
    });
  }

  function renderGraph() {
    const graph = projectGraph(map, selectedDemo.boundaries);
    const svg = svgElement('svg', {
      viewBox: `0 0 ${graph.width} ${graph.height}`,
      'aria-labelledby': 'graph-title graph-description',
      role: 'group'
    });
    svg.append(svgElement('title', { id: 'graph-title' }, 'Declared boundary relationships'),
      svgElement('desc', { id: 'graph-description' }, 'Source definitions, not an observed trace. Solid arrows are parents. Dashed arrows are links. Select a boundary for its contract.'));
    const defs = svgElement('defs');
    const marker = svgElement('marker', { id: 'edge-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
    marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'arrow-head' }));
    defs.append(marker);
    svg.append(defs);
    const byId = new Map(graph.nodes.map(node => [node.id, node]));
    for (const edge of graph.edges) {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      const line = svgElement('path', {
        d: graphEdgePath(from, to),
        class: `graph-edge ${edge.type}`,
        'marker-end': 'url(#edge-arrow)',
        'data-edge-from': edge.from,
        'data-edge-to': edge.to
      });
      line.append(svgElement('title', {}, `${edge.from} -> ${edge.to} (${edge.type}; ${edge.path})`));
      svg.append(line);
    }
    for (const role of graph.roles) {
      svg.append(svgElement('text', { x: role.x, y: role.y + 6, class: 'graph-role' }, role.id.replace(/^contoso-/, '')));
    }
    for (const span of graph.nodes) {
      const node = svgElement('g', {
        transform: `translate(${span.x},${span.y})`,
        class: 'graph-node',
        role: 'button',
        tabindex: 0,
        'data-boundary': span.id,
        'aria-label': `${span.label}, ${span.semanticKind}`,
        'aria-pressed': String(span.id === selectedBoundary)
      });
      node.append(svgElement('rect', { width: 176, height: 76, rx: 10 }));
      const words = span.label.replace(/^Contoso /, '').split(' ');
      const lines = [''];
      for (const word of words) {
        const last = lines.length - 1;
        if (`${lines[last]} ${word}`.trim().length > 23) lines.push(word);
        else lines[last] = `${lines[last]} ${word}`.trim();
      }
      lines.forEach((line, index) => node.append(svgElement('text', { x: 12, y: 22 + index * 16, class: 'graph-label' }, line)));
      node.append(svgElement('text', { x: 12, y: 64, class: 'graph-kind' }, span.semanticKind));
      const select = () => {
        selectedBoundary = span.id;
        renderInspector();
      };
      node.addEventListener('click', select);
      node.addEventListener('keydown', event => {
        if (['Enter', ' '].includes(event.key)) {
          event.preventDefault();
          select();
        }
      });
      svg.append(node);
    }
    $('graph-canvas').replaceChildren(svg);
    renderInspector();
    for (const shortcut of document.querySelectorAll('[data-graph-demo]')) {
      shortcut.setAttribute('aria-pressed', String(shortcut.dataset.graphDemo === selectedDemo.id));
    }
  }

  function selectDemo(id, updateHash = true) {
    const demo = data.demos.find(item => item.id === id);
    if (!demo) {
      notice(`Unknown demo "${id}". Choose a scenario from the catalog.`);
      return;
    }
    selectedDemo = demo;
    selectedBoundary = demo.boundaries[0];
    renderList();
    renderDemo();
    renderGraph();
    if (updateHash) history.replaceState(null, '', `#demo-${id}`);
  }

  function renderEvidence() {
    const { local, conditional, receipts } = data.evidence;
    const records = [
      { title: 'Node regression run', count: local.rootNode.actualTests, unit: 'tests recorded', text: `${local.rootNode.actualFailures} failures; ${local.rootNode.actualSkips} skips; ${local.rootNode.actualCancelled} cancelled.`, scope: local.rootNode.scope, receipt: receipts.node },
      { title: 'Java reactor build', count: local.javaReactor.actualTests, unit: `tests / ${local.javaReactor.actualModules} modules`, text: `${local.javaReactor.actualFailures} failures; ${local.javaReactor.actualErrors} errors; ${local.javaReactor.actualSkips} skips.`, scope: local.javaReactor.scope, receipt: receipts.java },
      { title: 'Orders conditional v7', count: conditional.actualWireSdkCases, unit: 'local wire / SDK cases', text: `${conditional.actualNativeRequestMatches} native request matches; ${conditional.privateRootBindings} local root bindings.`, scope: conditional.scope, receipt: receipts.conditional }
    ];
    $('evidence-cards').replaceChildren(...records.map(record => {
      const card = element('article', 'evidence-card');
      card.append(element('p', 'eyebrow', 'RECORDED LOCAL RESULT'), element('h3', '', record.title));
      const metric = element('p', 'evidence-metric', String(record.count));
      metric.append(element('span', '', record.unit));
      card.append(metric, element('p', 'small', record.text), element('p', 'evidence-scope', record.scope));
      const label = record.receipt.state === 'matches' ? 'Receipt digest matches at build'
        : record.receipt.state === 'missing' ? 'Receipt unavailable at build; metadata only' : 'Receipt differs at build; investigate before use';
      card.append(element('p', `receipt-state ${record.receipt.state === 'matches' ? '' : 'warning-text'}`, label),
        element('code', 'receipt-path', record.receipt.path),
        button('Inspect registered scope', 'text-button', () => showSource('config\\verification-register.v1.json')));
      return card;
    }));
    $('package-note').textContent = `${local.packages.recordedActualZipPackages} ZIP packages and ${local.missingAgentGuards.actualMissingAgentNegativeLaunches} missing-agent negative launches are recorded. The package record is not an independent rehash of current target ZIPs or evidence of healthy hosted applications.`;
    $('conditional-note').textContent = `${conditional.scope}. The execution window is ${conditional.executionWindow}. A saved receipt cannot enroll a live observer or authorize a rerun.`;
    $('remaining-work').replaceChildren(...conditional.remaining.map(text => element('li', '', text)));
    $('receipt-list').replaceChildren(...Object.entries(receipts).map(([id, receipt]) => {
      const row = element('li');
      row.append(element('strong', '', `${id}: ${receipt.state}`), element('code', '', receipt.path));
      return row;
    }));
  }

  function renderEnvironment() {
    const count = environmentKeys.filter(key => environment[key]).length;
    $('environment-status').textContent = count ? `${count}/3 URLs configured` : 'URLs not configured';
    for (const key of environmentKeys) {
      const link = $(`launch-${key}`);
      const disabled = $(`launch-${key}-disabled`);
      link.hidden = !environment[key];
      disabled.hidden = Boolean(environment[key]);
      if (environment[key]) link.href = environment[key];
      else link.removeAttribute('href');
      $(`environment-${key}`).value = environment[key] ?? '';
    }
  }

  function loadEnvironment() {
    let saved;
    try {
      saved = localStorage.getItem(storageKey);
    } catch (error) {
      notice(`Saved URLs are unavailable (${error.name}). You can still configure them for this page session.`);
      return;
    }
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
        || Object.keys(parsed).some(key => !environmentKeys.includes(key))) throw new Error('Unexpected settings shape');
      const checked = {};
      for (const key of environmentKeys) {
        if (parsed[key] !== undefined && typeof parsed[key] !== 'string') throw new Error('Invalid URL value');
        checked[key] = validateLaunchUrl(parsed[key] ?? '');
      }
      environment = checked;
    } catch (error) {
      notice(`Saved environment settings were rejected: ${error.message} Reconfigure the URLs before launching.`);
    }
  }

  function queryCommand() {
    const procedure = $('query-select').value;
    return `node .\\tools\\observability\\kql.mjs ${procedure} .\\approved-parameters.json .\\${procedure}.rendered.kql`;
  }

  $('environment-form').addEventListener('submit', event => {
    event.preventDefault();
    const checked = {};
    for (const key of environmentKeys) {
      const field = $(`environment-${key}`);
      try {
        checked[key] = validateLaunchUrl(field.value);
        field.setCustomValidity('');
      } catch (error) {
        field.setCustomValidity(error.message);
        $('environment-error').textContent = `${key}: ${error.message}`;
        field.reportValidity();
        return;
      }
    }
    environment = checked;
    let persisted = true;
    try {
      localStorage.setItem(storageKey, JSON.stringify(environment));
    } catch (error) {
      persisted = false;
      notice(`URLs are active for this page session only; browser storage failed (${error.name}).`);
    }
    renderEnvironment();
    $('environment-dialog').close();
    if (persisted) notice('Environment URLs saved in this browser. Reachability, authorization, and deployment status were not checked.');
  });
  for (const key of environmentKeys) {
    $(`environment-${key}`).addEventListener('input', event => {
      event.target.setCustomValidity('');
      $('environment-error').textContent = '';
    });
  }
  document.querySelectorAll('[data-open-environment]').forEach(node => node.addEventListener('click', () => {
    $('environment-error').textContent = '';
    $('environment-dialog').showModal();
  }));
  $('clear-environment').addEventListener('click', () => {
    environment = {};
    try {
      localStorage.removeItem(storageKey);
    } catch (error) {
      notice(`Active URLs cleared, but saved settings could not be removed (${error.name}). Clear this site's browser storage before reloading.`);
    }
    renderEnvironment();
    for (const key of environmentKeys) $(`environment-${key}`).setCustomValidity('');
    $('environment-error').textContent = '';
  });
  document.querySelectorAll('[data-close-dialog]').forEach(node => node.addEventListener('click', () => $(node.dataset.closeDialog).close()));
  document.querySelectorAll('[data-source]').forEach(node => node.addEventListener('click', () => showSource(node.dataset.source)));
  $('source-select').replaceChildren(...data.sources.map(source => {
    const option = element('option', '', source.path);
    option.value = source.path;
    return option;
  }));
  $('source-select').addEventListener('change', renderSource);
  $('copy-source').addEventListener('click', () => copy(sourceFor($('source-select').value).content));
  $('copy-run').addEventListener('click', () => copy(runTemplate()));
  $('copy-reset').addEventListener('click', () => copy(resetTemplate()));
  $('copy-checks').addEventListener('click', () => copy($('local-checks').textContent));
  $('demo-readme').addEventListener('click', () => showSource(`demos\\${selectedDemo.id}\\README.md`));
  $('inspect-demo-topology').addEventListener('click', () => $('topology').scrollIntoView({ behavior: 'instant' }));
  $('query-select').addEventListener('change', () => { $('query-command').textContent = queryCommand(); });
  $('copy-query').addEventListener('click', () => copy(queryCommand()));
  $('view-query').addEventListener('click', () => showSource(`kql\\${$('query-select').value}.kql`));
  $('demo-search').addEventListener('input', renderList);
  $('clear-search').addEventListener('click', () => {
    $('demo-search').value = '';
    setGroup('all');
  });
  function setGroup(value) {
    group = value;
    document.querySelectorAll('[data-group]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.group === group)));
    renderList();
  }
  document.querySelectorAll('[data-group]').forEach(node => node.addEventListener('click', () => setGroup(node.dataset.group)));
  document.querySelectorAll('[data-graph-demo]').forEach(node => node.addEventListener('click', () => {
    $('demo-search').value = '';
    setGroup('all');
    selectDemo(node.dataset.graphDemo);
  }));
  for (const [id, direction] of [['previous-demo', -1], ['next-demo', 1]]) {
    $(id).addEventListener('click', () => {
      const visible = filterDemos(data.demos, $('demo-search').value, group);
      selectDemo(visible[visible.indexOf(selectedDemo) + direction].id);
    });
  }
  const syncThemeControl = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    $('theme-toggle').textContent = dark ? 'Light theme' : 'Dark theme';
    $('theme-toggle').setAttribute('aria-label', dark ? 'Use light theme' : 'Use dark theme');
  };
  $('theme-toggle').addEventListener('click', () => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    syncThemeControl();
  });
  const useHash = () => {
    const match = /^#demo-(.+)$/.exec(location.hash);
    if (match) selectDemo(match[1], false);
  };
  addEventListener('hashchange', useHash);
  loadEnvironment();
  renderEnvironment();
  renderEvidence();
  renderList();
  renderDemo();
  renderGraph();
  syncThemeControl();
  useHash();
  $('query-command').textContent = queryCommand();
}

if (typeof document !== 'undefined') initializeMicrosite();
