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

function load(stored) {
  const vars = {};
  const classes = new Set();
  const $pop = settingsWindow();
  const store = stored ? { 'agent-office.settings': JSON.stringify(stored) } : {};
  const window = {
    office: {},
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
  return { settings: window.officeSettings, vars, classes, $width: $pop.els['#set-width'] };
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
