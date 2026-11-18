// renderer/errors.js and ready.js: a version counts as started when the window's
// own code set itself up. A rejected IPC call is outside that and only logged.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'renderer', f), 'utf8');
const PARTS = ['officeView', 'officeTerminal', 'officeSidebar', 'officeTabs', 'officeSettings', 'officeUpdates', 'officeWelcome', 'officeNotice'];

function page({ missing = [] } = {}) {
  const handlers = {};
  const logged = [];
  let readySent = 0;
  const window = { addEventListener: (type, fn) => { handlers[type] = fn; }, office: { ready: () => { readySent += 1; } } };
  for (const p of PARTS) if (!missing.includes(p)) window[p] = {};
  const console = { error: (m) => logged.push(['error', m]), warn: (m) => logged.push(['warn', m]) };
  const ctx = vm.createContext({ window, console });
  vm.runInContext(read('errors.js'), ctx);
  return {
    window, logged, handlers,
    ready: () => { vm.runInContext(read('ready.js'), ctx); return readySent; },
  };
}

test('a rejection recorded before ready.js runs is logged, and ready is still sent', () => {
  const p = page();
  p.handlers.unhandledrejection({ reason: new Error('herdr is still starting') });
  assert.deepStrictEqual([...p.window.__errors], ['rejection: herdr is still starting']);
  assert.strictEqual(p.ready(), 1);
  assert.deepStrictEqual(p.logged, [['warn', "ready, with errors outside the window's code: rejection: herdr is still starting"]]);
});

test('an error thrown by one of the window’s own scripts keeps ready back', () => {
  const p = page();
  p.handlers.error({ message: 'Uncaught TypeError: x is undefined', filename: 'file:///Users/me/app/renderer/app.js', lineno: 3 });
  assert.strictEqual(p.ready(), 0);
  assert.match(p.logged[0][1], /not ready: Uncaught TypeError: x is undefined @app\.js:3/);
});

test('an error from a script outside renderer/ is only logged', () => {
  const p = page();
  p.handlers.error({ message: 'WebGL lost', filename: 'file:///Users/me/app/node_modules/@xterm/addon-webgl/lib/addon-webgl.js', lineno: 1 });
  assert.strictEqual(p.ready(), 1);
});

test('a part that never set itself up keeps ready back', () => {
  const p = page({ missing: ['officeTabs'] });
  assert.strictEqual(p.ready(), 0);
  assert.match(p.logged[0][1], /officeTabs missing/);
});
