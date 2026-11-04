// Exercise the real wizard and desk menu in a small DOM harness.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = (name) => fs.readFileSync(path.join(__dirname, '..', 'renderer', name), 'utf8');
const element = (value = '') => ({ value, style: {}, addEventListener() {}, getBoundingClientRect: () => ({ width: 100, height: 100 }) });

test('the orchestrator wizard offers Codex, restores its saved selection and sends/persists it', async () => {
  const elements = Object.fromEntries(Object.entries({
    tabs: '', taskbar: '', 'wz-root': '/repos', 'wz-name': 'Codex Team',
    'wz-branch': 'feature/codex', 'wz-base': '', 'wz-list': '',
    'wz-branch-warn': '', 'wz-progress': '',
  }).map(([id, value]) => [id, element(value)]));
  let prefs = { orchAgent: 'codex', orchRoot: '/repos' };
  let modal, created;
  const window = {
    officeSettings: { get: () => prefs, set: (patch) => Object.assign(prefs, patch) },
    officeActions: { showModal: (options) => { modal = options; } },
    office: { orchestrator: {
      scanRepos: async () => ({ ok: true, repos: [] }),
      onProgress: () => () => {},
      create: async (spec) => { created = spec; return { ok: true, orchestrator: { slug: 'codex-team', boss: { status: 'started' } } }; },
    } },
  };
  vm.runInNewContext(source('tabs.js'), {
    window,
    document: { getElementById: (id) => elements[id], querySelector: () => ({ value: 'codex' }) },
    localStorage: { getItem: () => null },
  });
  window.officeTabs.wizard();
  assert.match(modal.body, /name="wz-agent" value="codex" checked/);
  for (const kind of ['claude', 'pi']) assert.ok(modal.body.includes(`value="${kind}"`));
  await modal.onOk();
  assert.equal(created.agent, 'codex');
  assert.equal(prefs.orchAgent, 'codex');
  assert.equal(prefs.activeTab, 'codex-team');
});

test('the shell desk context menu starts Codex without changing Claude/Pi choices', () => {
  const menu = element();
  const tree = element();
  const listeners = {};
  tree.addEventListener = (event, callback) => { listeners[event] = callback; };
  const desk = { id: 'p1', kind: 'shell', cwd: '/repo' };
  const starts = [];
  const window = {
    innerWidth: 1200, innerHeight: 800, addEventListener() {},
    officeActions: { find: () => desk, hireAgent: (d, kind) => starts.push([d.id, kind]) },
  };
  vm.runInNewContext(source('sidebar.js'), {
    window,
    document: {
      getElementById: (id) => ({ 'sidebar-tree': tree, ctxmenu: menu }[id] || null),
      addEventListener() {},
    },
    localStorage: { getItem: () => null },
  });
  listeners.contextmenu({
    preventDefault() {}, clientX: 10, clientY: 20,
    target: { closest: () => ({ dataset: { pane: 'p1' } }) },
  });
  for (const kind of ['Claude', 'Pi', 'Codex']) assert.ok(menu.innerHTML.includes(`Start ${kind} here`));
  menu._items.find((item) => item.label === 'Start Codex here').run();
  assert.deepEqual(starts, [['p1', 'codex']]);
});
