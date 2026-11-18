// scripts/make-app.js and install-app.js: the bundle they replace is renamed away
// and deleted, so they must only ever touch a .app they made. And --reset.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeApp, checkTarget, args } = require('../scripts/make-app');
const { resetCheckout } = require('../scripts/install-app');
const launch = require('../shell/launch');
const { repos } = require('./helpers/git-repos');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-make-app-'));

test('--out must name a .app: a folder like ~/Applications is refused and left alone', () => {
  const dir = tmp();
  const apps = path.join(dir, 'Applications');
  fs.mkdirSync(path.join(apps, 'Something.app'), { recursive: true });
  assert.throws(() => checkTarget(apps), /must name a \.app bundle/);
  assert.throws(() => makeApp({ out: apps, root: dir, checkout: dir }), /must name a \.app bundle/);
  assert.ok(fs.existsSync(path.join(apps, 'Something.app')));
  assert.strictEqual(fs.existsSync(`${apps}.old`), false);
});

test('an existing .app that make-app did not build is refused and left alone', () => {
  const dir = tmp();
  const other = path.join(dir, 'Herdquarters.app');
  fs.mkdirSync(path.join(other, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(other, 'Contents', 'Info.plist'), 'someone else\n');
  assert.throws(() => makeApp({ out: other, root: dir, checkout: dir }), /was not built by make-app\.js/);
  assert.strictEqual(fs.readFileSync(path.join(other, 'Contents', 'Info.plist'), 'utf8'), 'someone else\n');
});

test('a new path or one of ours is fine', () => {
  const dir = tmp();
  assert.doesNotThrow(() => checkTarget(path.join(dir, 'Herdquarters.app')));
  assert.doesNotThrow(() => checkTarget(`${path.join(dir, 'Herdquarters.app')}/`));
  const ours = path.join(dir, 'Ours.app');
  fs.mkdirSync(path.join(ours, 'Contents', 'Resources', 'app'), { recursive: true });
  fs.writeFileSync(path.join(ours, 'Contents', 'Resources', 'app', 'shell.json'), '{}');
  assert.doesNotThrow(() => checkTarget(ours));
});

test('flags without a value parse as true', () => {
  assert.deepStrictEqual(args(['--root', '/r', '--reset']), { root: '/r', reset: true });
  assert.deepStrictEqual(args(['--reset', '--out', '/x.app']), { reset: true, out: '/x.app' });
  assert.throws(() => args(['stray']), /unexpected argument/);
});

test('--reset puts a dirty, diverged checkout back on origin/main and clears the update state', () => {
  const r = repos();
  fs.writeFileSync(path.join(r.checkout, 'local.txt'), 'mine\n');
  r.git(r.checkout, 'add', 'local.txt');
  r.git(r.checkout, 'commit', '-q', '-m', 'local');
  fs.writeFileSync(path.join(r.checkout, 'main.js'), 'edited\n');
  const upstream = r.commit({ 'main.js': 'two\n' });
  launch.updateState(r.root, { lastGood: 'x', bad: 'y', pending: 'z', booting: 'w', notice: { kind: 'rolledBack' }, rebuildTried: 'a:46', modulesFor: 'h' });
  resetCheckout({ root: r.root, checkout: r.checkout });
  assert.strictEqual(r.head(), upstream);
  assert.strictEqual(fs.readFileSync(path.join(r.checkout, 'main.js'), 'utf8'), 'two\n');
  assert.strictEqual(r.git(r.checkout, 'status', '--porcelain', '--untracked-files=no'), '');
  assert.deepStrictEqual(launch.readState(r.root), { lastGood: null, bad: null, pending: null, booting: null, notice: null, rebuildTried: null, modulesFor: null });
});
