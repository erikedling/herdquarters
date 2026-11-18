// The terminal opens beside the office (split) unless the user picked the full
// window, also for settings saved before the layout setting came back.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'settings.js'), 'utf8');

// The settings window, as far as syncForm reads and writes it.
function settingsWindow() {
  const els = {};
  const el = () => ({ value: '', textContent: '', disabled: false, classList: { toggle() {} }, addEventListener() {} });
  return {
    els, addEventListener() {},
    querySelector: (sel) => (els[sel] ||= el()),
    querySelectorAll: () => [],
  };
}

function load(stored, office = {}, extra = {}) {
  const vars = {};
  const classes = new Set();
  const $pop = settingsWindow();
  const store = stored ? { 'agent-office.settings': JSON.stringify(stored) } : {};
  const window = {
    office, ...extra,
    matchMedia: () => ({ matches: true, addEventListener() {} }),
  };
  vm.runInNewContext(src, {
    window,
    document: {
      documentElement: { style: { setProperty: (k, v) => { vars[k] = v; } } },
      body: { classList: { add: (...c) => c.forEach((x) => classes.add(x)), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } },
      getElementById: (id) => (id === 'settings' ? $pop : null),
      querySelectorAll: () => [],
      addEventListener() {},
    },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
  });
  return { settings: window.officeSettings, vars, classes, $pop, $width: $pop.els['#set-width'] };
}

test('a fresh install opens the terminal as a split panel at 46%', () => {
  const { settings, vars, classes } = load();
  assert.strictEqual(settings.get().termLayout, 'split');
  assert.strictEqual(vars['--panel-width'], '46%');
  assert.ok(!classes.has('term-full'));
  assert.ok(classes.has('layout-office'));
  // the divider's double-click resets to this
  assert.strictEqual(settings.defaults.panelWidth, 46);
});

test('settings saved without a terminal layout fall back to split', () => {
  const { settings, classes } = load({ theme: 'forest', sidebar: false });
  assert.strictEqual(settings.get().termLayout, 'split');
  assert.strictEqual(settings.get().theme, 'forest');
  assert.ok(!classes.has('term-full'));
});

test('full window sets term-full, and switching back to split clears it', () => {
  const { settings, classes } = load({ termLayout: 'full' });
  assert.ok(classes.has('term-full'));
  settings.set({ termLayout: 'split' });
  assert.ok(!classes.has('term-full'));
});

test('the panel width follows the setting', () => {
  const { settings, vars } = load({ panelWidth: 60 });
  assert.strictEqual(vars['--panel-width'], '60%');
  settings.set({ panelWidth: 35 });
  assert.strictEqual(vars['--panel-width'], '35%');
});

test('the width slider is disabled in full mode, not only greyed out', () => {
  const { settings, $width } = load({ termLayout: 'full' });
  assert.strictEqual($width.disabled, true);
  settings.set({ termLayout: 'split' });
  assert.strictEqual($width.disabled, false);
});

test('the assistant gets its days: Mon-Fri on a fresh install, the saved ones after', () => {
  const sent = [];
  const office = { assistant: { configure: (c) => sent.push(c) } };
  load(undefined, office);
  assert.deepStrictEqual([...sent.at(-1).days], [1, 2, 3, 4, 5]);
  const { settings } = load({ assistantDays: [0, 6] }, office);
  assert.deepStrictEqual([...sent.at(-1).days], [0, 6]);
  settings.set({ assistantDays: [] });
  assert.deepStrictEqual([...sent.at(-1).days], []);
});

test('the dart board is off on a fresh install and follows the setting', () => {
  let shown = null;
  const officeBird = { setDartBoard: (on) => { shown = on; } };
  const { settings } = load(undefined, {}, { officeBird });
  assert.strictEqual(settings.get().dartBoard, false);
  assert.strictEqual(shown, false);
  settings.set({ dartBoard: true });
  assert.strictEqual(shown, true);
  load({ dartBoard: true }, {}, { officeBird });
  assert.strictEqual(shown, true);
});

test('animals hidden with the old paw button come back: the button is gone', () => {
  const { settings } = load({ petsHidden: true, cats: true });
  assert.strictEqual(settings.get().petsHidden, false);
});

test('a fresh install opens in the Toybox style', () => {
  const { settings } = load();
  assert.strictEqual(settings.get().style, 'toybox');
});

test('plan usage is on at 10 minutes, and main hears it at startup and on change', () => {
  const calls = [];
  // JSON: objects made inside the vm context have another Object prototype.
  const { settings } = load(undefined, { usage: { configure: (p) => calls.push(JSON.parse(JSON.stringify(p))) } });
  assert.strictEqual(settings.get().usageMeter, true);
  assert.strictEqual(settings.get().usageInterval, 10);
  assert.deepStrictEqual(calls.at(-1), { enabled: true, interval: 10 });
  settings.set({ usageInterval: 30 });
  assert.deepStrictEqual(calls.at(-1), { enabled: true, interval: 30 });
  settings.set({ usageMeter: false });
  assert.deepStrictEqual(calls.at(-1), { enabled: false, interval: 30 });
});

test('a saved usage interval main would not accept shows, and is sent, as 10 minutes', () => {
  const calls = [];
  const { $pop } = load({ usageInterval: 7 }, { usage: { configure: (p) => calls.push(JSON.parse(JSON.stringify(p))) } });
  assert.strictEqual($pop.els['#set-usage-interval'].value, '10');
  assert.deepStrictEqual(calls.at(-1), { enabled: true, interval: 10 });
});

test('usage shows what is left by default; the choice reaches the view and the form', () => {
  const shows = [];
  const { settings, $pop } = load(undefined, {}, { officeUsageView: { setShow: (s) => shows.push(s) } });
  assert.strictEqual(settings.get().usageShow, 'remaining');
  assert.strictEqual(shows.at(-1), 'remaining');
  assert.strictEqual($pop.els['#set-usage-show'].value, 'remaining');
  settings.set({ usageShow: 'used' });
  assert.strictEqual(shows.at(-1), 'used');
  assert.strictEqual($pop.els['#set-usage-show'].value, 'used');
  settings.set({ usageMeter: false });
  assert.strictEqual($pop.els['#set-usage-show'].disabled, true);
});

test('a saved usage display that is neither used nor remaining shows remaining', () => {
  const shows = [];
  const { $pop } = load({ usageShow: 'tokens' }, {}, { officeUsageView: { setShow: (s) => shows.push(s) } });
  assert.strictEqual(shows.at(-1), 'remaining');
  assert.strictEqual($pop.els['#set-usage-show'].value, 'remaining');
});
