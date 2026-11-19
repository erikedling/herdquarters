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
  const push = {};
  const document = {
    activeElement: null,
    getElementById: (id) => els[id] || null,
    querySelector: () => null,
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const window = {
    office: {
      updates: { onState: (cb) => { push.state = cb; }, get: () => new Promise(() => {}), apply: async (t) => { applied.push(t); return { ok: true }; } },
      onSnapshot: () => () => {},
    },
    officeSettings: { get: () => ({ updateMode: mode }) },
    getSelection: () => '',
  };
  vm.runInNewContext(src, { window, document, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, setInterval() {}, setTimeout, Date });
  return { updates: window.officeUpdates, document, listeners, els, push };
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

test('the restart bar says when the app updates itself first', () => {
  const { push, els } = load({ mode: 'ask' });
  push.state({ enabled: true, status: 'restart', kind: 'bootstrap', commits: [] });
  assert.match(els.updatebar.innerHTML, /Restart Herdquarters to finish updating/);
  assert.match(els.updatebar.innerHTML, /It updates the app itself first\./);
  push.state({ enabled: true, status: 'restart', kind: 'restart', commits: [] });
  assert.doesNotMatch(els.updatebar.innerHTML, /updates the app itself/);
});

test('the settings line names a branch other than main', () => {
  const { push, els } = load({ mode: 'ask' });
  const current = { sha: 'abc1234', date: '2026-11-19T10:00:00+01:00' };
  push.state({ enabled: true, branch: 'fregus/try-this', status: 'current', current, checkedAt: Date.now(), commits: [] });
  assert.match(els['set-updates-info'].textContent, /^Running abc1234 on fregus\/try-this from /);
  assert.match(els['set-updates-info'].textContent, /Up to date\./);
  push.state({ enabled: true, branch: 'main', status: 'current', current, checkedAt: Date.now(), commits: [] });
  assert.match(els['set-updates-info'].textContent, /^Running abc1234 from /);
});

test('a gone branch shows a warning with the way back, and never "Up to date"', () => {
  const { push, els } = load({ mode: 'ask' });
  const error = 'The branch fregus/try-this is gone, probably merged. Run npm run install-app -- --reset to go back to main.';
  push.state({ enabled: true, branch: 'fregus/try-this', status: 'gone', error, current: { sha: 'abc1234', date: '2026-11-19T10:00:00+01:00' }, checkedAt: Date.now(), commits: [] });
  assert.strictEqual(els.updatebar.hidden, false);
  assert.match(els.updatebar.innerHTML, /No more updates from fregus\/try-this/);
  assert.match(els.updatebar.innerHTML, /npm run install-app -- --reset/);
  const info = els['set-updates-info'].textContent;
  assert.ok(info.includes(error), info);
  assert.doesNotMatch(info, /Up to date|failed:/);
});

test('a failed check does not claim to be up to date', () => {
  const { push, els } = load({ mode: 'ask' });
  push.state({ enabled: true, branch: 'main', status: 'current', error: 'Could not resolve host: github.com', current: { sha: 'abc1234', date: '2026-11-19T10:00:00+01:00' }, checkedAt: Date.now(), commits: [] });
  assert.doesNotMatch(els['set-updates-info'].textContent, /Up to date/);
  assert.match(els['set-updates-info'].textContent, /failed: Could not resolve host/);
});

test('a waiting restart stays on show when newer commits come in', () => {
  const { push, els } = load({ mode: 'ask' });
  const current = { sha: 'abc1234', date: '2026-11-19T10:00:00+01:00' };
  const newer = { target: 'def5678', kind: 'restart', added: 1, commits: [{ sha: 'def5678', subject: 'Terminal: a later change (#51)' }, { sha: 'aaa1111', subject: 'Main: a change (#50)' }] };
  push.state({ enabled: true, branch: 'main', status: 'restart', kind: 'restart', target: 'aaa1111', newer, current, checkedAt: Date.now(), commits: [] });
  assert.match(els.updatebar.innerHTML, /Restart Herdquarters to finish updating/);
  assert.match(els.updatebar.innerHTML, /data-act="apply-newer">Include 1 change more/);
  assert.match(els['set-updates-info'].textContent, /applies at the next launch\. 1 change newer available\./);

  push.state({ enabled: true, branch: 'main', status: 'pending', kind: 'restart', target: 'aaa1111', newer, current, checkedAt: Date.now(), commits: [] });
  assert.match(els.updatebar.innerHTML, /Update available/);
  assert.match(els.updatebar.innerHTML, /An earlier update already applies at the next launch/);
  assert.match(els.updatebar.innerHTML, /data-act="apply-newer">Update now/);
});
