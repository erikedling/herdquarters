// shell/quit-guard.js: a quit while packages install asks first, and only a
// confirmed stop aborts the install.
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { guardQuit } = require('../shell/quit-guard');

function setup(response) {
  const app = new EventEmitter();
  const asked = [];
  const dialog = { showMessageBox: (win, opts) => { asked.push(opts); return Promise.resolve({ response }); } };
  const controller = new AbortController();
  const release = guardQuit({ app, dialog, win: {}, controller });
  const quit = () => { let prevented = false; app.emit('before-quit', { preventDefault: () => { prevented = true; } }); return prevented; };
  return { app, asked, controller, release, quit };
}

test('a quit is held and asked about; "Keep updating" carries on', async () => {
  const g = setup(0);
  assert.strictEqual(g.quit(), true);
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(g.asked[0].buttons, ['Keep updating', 'Stop and quit']);
  assert.strictEqual(g.controller.signal.aborted, false);
});

test('"Stop and quit" aborts the install', async () => {
  const g = setup(1);
  g.quit();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(g.controller.signal.aborted, true);
  assert.strictEqual(g.quit(), true, 'still held while the install winds down');
  assert.strictEqual(g.asked.length, 1, 'not asked twice');
});

test('once released, quitting is not held any more', () => {
  const g = setup(1);
  g.release();
  assert.strictEqual(g.quit(), false);
  assert.strictEqual(g.app.listenerCount('before-quit'), 0);
});
