// shell/loader.js, the bundle's entry point that a sync never replaces: when
// the synced bootstrap throws, or never gets a window up, it puts the old set back.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { load, MAX_TRIES } = require('../shell/loader');
const launch = require('../shell/launch');
const { repos } = require('./helpers/git-repos');

const realLaunch = fs.readFileSync(path.join(__dirname, '..', 'shell', 'launch.js'), 'utf8');

function bundle(r, { bootstrap, prev = true }) {
  const here = path.join(r.dir, 'Herdquarters.app', 'Contents', 'Resources', 'app');
  const prevDir = path.join(here, '..', 'app.prev');
  fs.mkdirSync(here, { recursive: true });
  fs.writeFileSync(path.join(here, 'shell.json'), JSON.stringify({ root: r.root, checkout: r.checkout, branch: 'main' }));
  fs.writeFileSync(path.join(here, 'bootstrap.js'), bootstrap);
  fs.writeFileSync(path.join(here, 'launch.js'), `${realLaunch}\n// synced\n`);
  if (prev) {
    fs.mkdirSync(prevDir);
    fs.writeFileSync(path.join(prevDir, 'bootstrap.js'), 'global.hqOldBootstrap = true;\n');
    fs.writeFileSync(path.join(prevDir, 'launch.js'), realLaunch);
  }
  const calls = [];
  const app = { relaunch: () => calls.push('relaunch'), exit: (code) => calls.push(`exit ${code}`) };
  return { here, prevDir, app, calls };
}

test('a synced bootstrap that throws is replaced by the old one, and the commit rolled back', () => {
  const r = repos();
  launch.markGood(r.root, r.first);
  const next = r.commit({ 'shell/bootstrap.js': 'throw new Error("broken bootstrap")\n' });
  r.git(r.checkout, 'fetch', '-q', 'origin');
  r.git(r.checkout, 'checkout', '-q', '-B', 'main', next);
  const b = bundle(r, { bootstrap: 'throw new Error("broken bootstrap");\n' });
  load({ here: b.here, app: b.app });
  assert.deepStrictEqual(b.calls, ['relaunch', 'exit 0']);
  assert.strictEqual(fs.readFileSync(path.join(b.here, 'bootstrap.js'), 'utf8'), 'global.hqOldBootstrap = true;\n');
  assert.strictEqual(fs.readFileSync(path.join(b.here, 'launch.js'), 'utf8'), realLaunch);
  assert.strictEqual(fs.existsSync(b.prevDir), false);
  assert.strictEqual(r.head(), r.first);
  const state = launch.readState(r.root);
  assert.strictEqual(state.bad, next);
  assert.match(state.notice.error, /own files in this version did not start \(broken bootstrap\)/);
  assert.ok(state.shellFailed, 'the bootstrap will not sync that set again');
});

test('a synced set that never reaches a ready window is given back after a few launches', () => {
  const r = repos();
  const b = bundle(r, { bootstrap: 'global.hqTries = (global.hqTries || 0) + 1;\n' });
  for (let i = 1; i <= MAX_TRIES; i++) {
    load({ here: b.here, app: b.app });
    assert.strictEqual(fs.readFileSync(path.join(b.prevDir, '.tries'), 'utf8'), String(i));
  }
  assert.deepStrictEqual(b.calls, []);
  load({ here: b.here, app: b.app });
  assert.deepStrictEqual(b.calls, ['relaunch', 'exit 0']);
  assert.strictEqual(fs.existsSync(b.prevDir), false);
});

test('without app.prev the loader just runs the bootstrap, and its errors are not swallowed', () => {
  const r = repos();
  const ok = bundle(r, { bootstrap: 'global.hqLoaded = "yes";\n', prev: false });
  load({ here: ok.here, app: ok.app });
  assert.strictEqual(global.hqLoaded, 'yes');
  const r2 = repos();
  const bad = bundle(r2, { bootstrap: 'throw new Error("no way back");\n', prev: false });
  assert.throws(() => load({ here: bad.here, app: bad.app }), /no way back/);
});
