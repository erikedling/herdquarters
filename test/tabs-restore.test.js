// On launch the tab saved in settings is already active, so its terminal must
// open from the first render, not only when the user clicks to another tab.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'tabs.js'), 'utf8');

function el() {
  return { innerHTML: '', hidden: false, dataset: {}, style: { setProperty() {} }, addEventListener() {} };
}

function load({ activeTab, desks, tabPanes = {} }) {
  let settings = { activeTab };
  const opened = [];
  const window = {
    officeSettings: { get: () => settings, set: (p) => { settings = { ...settings, ...p }; } },
    officeActions: { find: (id) => desks.find((d) => d.id === id) },
    officeTerminal: { isOpenFor: () => false },
    officeOpenDesk: (id) => opened.push(id),
    officeView: { activeAlerts: () => [], ticketCard: () => ({ state: 'idle', done: 0, total: 0, flag: null }) },
  };
  const elements = { tabs: el(), taskbar: el() };
  const store = { 'agent-office.tabPanes': JSON.stringify(tabPanes) };
  vm.runInNewContext(src, {
    window,
    document: { getElementById: (id) => elements[id] || null },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
  });
  return { tabs: window.officeTabs, opened };
}

const boss = { id: 'p_boss', orch: { slug: 'fix' } };
const orchestrators = [{ slug: 'fix', name: 'Fix', color: '#fc3', boss: { pane_id: 'p_boss' } }];
const floors = [{ rooms: [{ desks: [boss] }] }];

test('the saved orchestrator tab opens its boss terminal on the first render', () => {
  const { tabs, opened } = load({ activeTab: 'fix', desks: [boss] });
  tabs.render(orchestrators, floors);
  tabs.render(orchestrators, floors);
  assert.deepStrictEqual(opened, ['p_boss']);
});

test('a boss desk that shows up after the first render still opens', () => {
  const desks = [];
  const { tabs, opened } = load({ activeTab: 'fix', desks });
  tabs.render(orchestrators, []);
  assert.deepStrictEqual(opened, []);
  desks.push(boss);
  tabs.render(orchestrators, floors);
  assert.deepStrictEqual(opened, ['p_boss']);
});

test('a saved Office tab opens nothing on restart', () => {
  const shell = { id: 'p_shell' };
  const { tabs, opened } = load({ activeTab: 'office', desks: [boss, shell], tabPanes: { office: 'p_shell' } });
  tabs.render(orchestrators, [{ rooms: [{ desks: [boss, shell] }] }]);
  assert.deepStrictEqual(opened, []);
});

test('switching to an orchestrator tab opens its boss', () => {
  const { tabs, opened } = load({ activeTab: 'office', desks: [boss] });
  tabs.render(orchestrators, floors);
  tabs.setActive('fix');
  tabs.render(orchestrators, floors);
  assert.deepStrictEqual(opened, ['p_boss']);
});

test('switching tabs before the saved boss shows up cancels the restore', () => {
  const other = { id: 'p_other', orch: { slug: 'other' } };
  const two = [...orchestrators, { slug: 'other', name: 'Other', color: '#3cf', boss: { pane_id: 'p_other' } }];
  const desks = [];
  const { tabs, opened } = load({ activeTab: 'fix', desks });
  tabs.render(two, []);
  tabs.setActive('other');
  desks.push(boss, other);
  tabs.render(two, [{ rooms: [{ desks: [boss, other] }] }]);
  assert.deepStrictEqual(opened, []);
});
