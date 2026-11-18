// renderer/updates.js: Automatic mode reloads the window for a live update, which
// closes every terminal stream, so it waits while the user is typing anywhere.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'updates.js'), 'utf8');

function load({ mode = 'auto' } = {}) {
  const listeners = {};
  const el = () => ({ hidden: true, innerHTML: '', textContent: '', disabled: false, classList: { toggle() {}, remove() {} }, addEventListener() {}, querySelectorAll: () => [] });
  const els = { updatebar: el(), 'set-updates-row': el(), 'set-updates-info': el(), 'set-update-check': el(), settings: el(), modal: el() };
  const applied = [];
  const document = {
    activeElement: null,
    getElementById: (id) => els[id] || null,
    querySelector: () => null,
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const window = {
    office: {
      updates: { onState() {}, get: () => new Promise(() => {}), apply: async (t) => { applied.push(t); return { ok: true }; } },
      onSnapshot: () => () => {},
    },
    officeSettings: { get: () => ({ updateMode: mode }) },
    getSelection: () => '',
  };
  vm.runInNewContext(src, { window, document, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, setInterval() {}, setTimeout, Date });
  return { updates: window.officeUpdates, document, listeners, els };
}

test('a quiet window counts as idle', () => {
  const { updates } = load();
  assert.strictEqual(updates.idle(), true);
});

test('focus inside a terminal is busy, even with xterm’s helper textarea empty', () => {
  const { updates, document } = load();
  document.activeElement = { tagName: 'TEXTAREA', value: '', closest: (sel) => (sel === '.xterm' ? {} : null) };
  assert.strictEqual(updates.idle(), false);
  document.activeElement = { tagName: 'BUTTON', closest: () => null };
  assert.strictEqual(updates.idle(), true);
});

test('a key press in the last minute is busy', () => {
  const { updates, listeners } = load();
  const now = Date.now();
  listeners.keydown({ key: 'a' });
  assert.strictEqual(updates.idle(now + 5_000), false);
  assert.strictEqual(updates.idle(now + 61_000), true);
});

test('settings or a dialog open is busy, as is half-typed text', () => {
  const { updates, els, document } = load();
  els.settings.hidden = false;
  assert.strictEqual(updates.idle(), false);
  els.settings.hidden = true;
  els.modal.hidden = false;
  assert.strictEqual(updates.idle(), false);
  els.modal.hidden = true;
  document.activeElement = { tagName: 'INPUT', type: 'text', value: 'half', closest: () => null };
  assert.strictEqual(updates.idle(), false);
});
