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

function bundleWithShell() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-sync-'));
  const checkout = path.join(dir, 'app');
  const bundle = path.join(dir, 'Herdquarters.app');
  const appDir = path.join(bundle, 'Contents', 'Resources', 'app');
  fs.mkdirSync(path.join(checkout, 'shell'), { recursive: true });
  fs.mkdirSync(appDir, { recursive: true });
  const write = (dir2, files) => { for (const [f, t] of Object.entries(files)) fs.writeFileSync(path.join(dir2, f), t); };
  write(path.join(checkout, 'shell'), { 'bootstrap.js': '// new\n', 'launch.js': '// same\n', 'loader.js': '// loader from the checkout\n' });
  write(appDir, { 'bootstrap.js': '// old\n', 'launch.js': '// same\n', 'gone.js': '// removed upstream\n', 'loader.js': '// the bundle loader\n', 'shell.json': '{}\n', 'package.json': '{}\n' });
  const calls = [];
  const run = (cmd, args) => { calls.push([path.basename(cmd), ...args.map((a) => path.basename(a))]); };
  return { dir, checkout, bundle, appDir, calls, run, prev: path.join(bundle, 'Contents', 'Resources', 'app.prev') };
}

test('syncShell() checks, then swaps in changed files, keeps the old set in app.prev and never touches loader.js', () => {
  const b = bundleWithShell();
  assert.strictEqual(rebuild.shellDiffers(b.checkout, b.appDir), true);
  assert.strictEqual(rebuild.syncShell({ checkout: b.checkout, appDir: b.appDir, bundle: b.bundle, run: b.run, execPath: '/x/Electron' }), true);
  assert.deepStrictEqual(fs.readdirSync(b.appDir).sort(), ['bootstrap.js', 'launch.js', 'loader.js', 'package.json', 'shell.json']);
  assert.strictEqual(fs.readFileSync(path.join(b.appDir, 'bootstrap.js'), 'utf8'), '// new\n');
  assert.strictEqual(fs.readFileSync(path.join(b.appDir, 'loader.js'), 'utf8'), '// the bundle loader\n');
  assert.deepStrictEqual(fs.readdirSync(b.prev).sort(), ['bootstrap.js', 'gone.js', 'launch.js']);
  assert.strictEqual(fs.readFileSync(path.join(b.prev, 'bootstrap.js'), 'utf8'), '// old\n');
  assert.deepStrictEqual(b.calls, [['Electron', '--check', 'bootstrap.js'], ['Electron', '--check', 'launch.js'], ['codesign', '--force', '--deep', '--sign', '-', 'Herdquarters.app']]);
  assert.strictEqual(rebuild.syncShell({ checkout: b.checkout, appDir: b.appDir, bundle: b.bundle, run: b.run }), false, 'nothing to do the second time');
});

test('a second sync before any ready window keeps the first old set in app.prev', () => {
  const b = bundleWithShell();
  rebuild.syncShell({ checkout: b.checkout, appDir: b.appDir, bundle: b.bundle, run: b.run });
  fs.writeFileSync(path.join(b.checkout, 'shell', 'bootstrap.js'), '// newer\n');
  rebuild.syncShell({ checkout: b.checkout, appDir: b.appDir, bundle: b.bundle, run: b.run });
  assert.strictEqual(fs.readFileSync(path.join(b.prev, 'bootstrap.js'), 'utf8'), '// old\n');
  rebuild.confirmShell(b.appDir);
  assert.strictEqual(fs.existsSync(b.prev), false);
});

test('a file that does not parse never reaches the bundle', () => {
  const b = bundleWithShell();
  fs.writeFileSync(path.join(b.checkout, 'shell', 'bootstrap.js'), 'const = ;\n');
  assert.throws(() => rebuild.syncShell({ checkout: b.checkout, appDir: b.appDir, bundle: b.bundle, run: require('node:child_process').execFileSync }));
  assert.strictEqual(fs.readFileSync(path.join(b.appDir, 'bootstrap.js'), 'utf8'), '// old\n');
  assert.ok(fs.readdirSync(b.appDir).every((f) => !f.endsWith('.new')));
  assert.strictEqual(fs.existsSync(b.prev), false);
});

test('loader.js hashes shell/ the same way as rebuild.js', () => {
  const b = bundleWithShell();
  const src = path.join(b.checkout, 'shell');
  assert.strictEqual(require('../shell/loader').shellHash(src), rebuild.shellHash(src));
  assert.notStrictEqual(rebuild.shellHash(src), rebuild.shellHash(b.appDir));
});
