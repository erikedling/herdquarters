// shell/rebuild.js: building the app again for another Electron (at most once
// per commit), and keeping the bundle's copy of shell/ in line with the checkout.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const rebuild = require('../shell/rebuild');
const launch = require('../shell/launch');

function checkoutWithElectron(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-rebuild-'));
  const checkout = path.join(dir, 'app');
  fs.mkdirSync(checkout);
  fs.writeFileSync(path.join(checkout, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/electron': { version } } }));
  return { root: dir, checkout };
}

test('no rebuild while the running Electron has the major version the checkout wants', () => {
  const { root, checkout } = checkoutWithElectron('45.2.0');
  assert.strictEqual(rebuild.rebuildPlan({ root, checkout, current: 'abc', running: '45.0.0' }), 'none');
  assert.strictEqual(rebuild.rebuildPlan({ root, checkout: path.join(root, 'missing'), current: 'abc', running: '45.0.0' }), 'none');
});

test('another major is rebuilt for once; if it still does not match, the plan is to give up', async () => {
  const { root, checkout } = checkoutWithElectron('46.0.1');
  assert.strictEqual(rebuild.rebuildPlan({ root, checkout, current: 'abc', running: '45.0.0' }), 'rebuild');
  const calls = [];
  await rebuild.rebuild({
    root, checkout, bundle: '/Apps/Herdquarters.app', current: 'abc', execPath: '/Apps/Herdquarters.app/Contents/MacOS/Electron',
    npm: async (dir) => { calls.push(['npm', dir]); fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true }); },
    run: async (cmd, args, opts) => { calls.push([cmd, ...args.map((a) => path.basename(a))]); assert.strictEqual(opts.env.ELECTRON_RUN_AS_NODE, '1'); },
  });
  assert.deepStrictEqual(calls.map((c) => c.slice(0, 2)), [['npm', checkout], ['/Apps/Herdquarters.app/Contents/MacOS/Electron', 'install.js'], ['/Apps/Herdquarters.app/Contents/MacOS/Electron', 'make-app.js']]);
  assert.ok(calls[2].includes('Herdquarters.app'));
  assert.strictEqual(launch.readState(root).rebuildTried, 'abc:46');
  // Relaunched and still on 45: no second multi-minute rebuild.
  assert.strictEqual(rebuild.rebuildPlan({ root, checkout, current: 'abc', running: '45.0.0' }), 'gaveUp');
  // A newer commit gets its own try.
  assert.strictEqual(rebuild.rebuildPlan({ root, checkout, current: 'def', running: '45.0.0' }), 'rebuild');
});

test('a failed rebuild is still counted, so it is not retried at every launch', async () => {
  const { root, checkout } = checkoutWithElectron('46.0.0');
  await assert.rejects(rebuild.rebuild({ root, checkout, bundle: '/x.app', current: 'abc', npm: async () => { throw new Error('offline'); }, run: async () => {} }), /offline/);
  assert.strictEqual(rebuild.rebuildPlan({ root, checkout, current: 'abc', running: '45.0.0' }), 'gaveUp');
});

test('syncShell() copies changed shell/ files into the bundle, drops removed ones and signs again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-sync-'));
  const checkout = path.join(dir, 'app');
  const appDir = path.join(dir, 'Herdquarters.app', 'Contents', 'Resources', 'app');
  fs.mkdirSync(path.join(checkout, 'shell'), { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });
  fs.writeFileSync(path.join(checkout, 'shell', 'bootstrap.js'), 'new\n');
  fs.writeFileSync(path.join(checkout, 'shell', 'launch.js'), 'same\n');
  fs.writeFileSync(path.join(appDir, 'bootstrap.js'), 'old\n');
  fs.writeFileSync(path.join(appDir, 'launch.js'), 'same\n');
  fs.writeFileSync(path.join(appDir, 'gone.js'), 'removed upstream\n');
  fs.writeFileSync(path.join(appDir, 'shell.json'), '{}\n');
  fs.writeFileSync(path.join(appDir, 'package.json'), '{}\n');
  const signed = [];
  const run = (cmd, args) => signed.push([cmd, args.at(-1)]);
  const bundle = path.join(dir, 'Herdquarters.app');
  assert.strictEqual(rebuild.shellDiffers(checkout, appDir), true);
  assert.strictEqual(rebuild.syncShell({ checkout, appDir, bundle, run }), true);
  assert.deepStrictEqual(fs.readdirSync(appDir).sort(), ['bootstrap.js', 'launch.js', 'package.json', 'shell.json']);
  assert.strictEqual(fs.readFileSync(path.join(appDir, 'bootstrap.js'), 'utf8'), 'new\n');
  assert.deepStrictEqual(signed, [['codesign', bundle]]);
  assert.strictEqual(rebuild.syncShell({ checkout, appDir, bundle, run }), false, 'nothing to do the second time');
  assert.strictEqual(signed.length, 1);
});
