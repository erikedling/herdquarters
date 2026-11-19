// scripts/make-app.js and install-app.js: the bundle they replace is renamed away
// and deleted, so they must only ever touch a .app they made. And --reset.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { makeApp, checkTarget, args } = require('../scripts/make-app');
const { resetCheckout, remoteFor, branchFor, DEFAULT_REMOTE } = require('../scripts/install-app');
const { Updater } = require('../updater');
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

test('the app’s checkout tracks the public repo over HTTPS unless --remote says otherwise', () => {
  assert.strictEqual(DEFAULT_REMOTE, 'https://github.com/erikedling/herdquarters.git');
  assert.strictEqual(remoteFor(args([])), DEFAULT_REMOTE, 'not this checkout’s origin, which may be SSH');
  assert.strictEqual(remoteFor(args(['--root', '/r'])), DEFAULT_REMOTE);
  assert.strictEqual(remoteFor(args(['--remote', '/tmp/origin.git'])), '/tmp/origin.git');
  assert.strictEqual(remoteFor(args(['--remote'])), DEFAULT_REMOTE, 'a bare flag is not a URL');
});

test('--branch picks the branch for a new checkout; a rerun keeps the one it tracks, and --reset goes back to main', () => {
  assert.strictEqual(branchFor(args([]), null), 'main');
  assert.strictEqual(branchFor(args(['--branch', 'fregus/try-this']), null), 'fregus/try-this');
  assert.strictEqual(branchFor(args([]), 'fregus/try-this'), 'fregus/try-this', 'a plain rebuild must not move it to main');
  assert.strictEqual(branchFor(args(['--branch', 'fregus/try-this']), 'fregus/try-this'), 'fregus/try-this');
  assert.throws(() => branchFor(args(['--branch', 'other']), 'fregus/try-this'), /tracks fregus\/try-this; add --reset to switch it to other/);
  assert.strictEqual(branchFor(args(['--reset']), 'fregus/try-this'), 'main');
  assert.strictEqual(branchFor(args(['--reset', '--branch', 'other']), 'fregus/try-this'), 'other');
  assert.throws(() => branchFor(args(['--branch']), null), /--branch needs a name/);
});

test('--branch refuses names git would not take, and ones git would read as an option', () => {
  for (const name of ['-oProxyCommand=x', '-x', 'two..dots', 'with space', 'ends.lock', 'trailing/']) {
    assert.throws(() => branchFor(args(['--branch', name]), null), /is not a valid branch name/, name);
  }
  assert.strictEqual(branchFor(args(['--branch', 'fregus/a-b--c']), null), 'fregus/a-b--c');
});

test('make-app refuses a bare --branch rather than writing true into shell.json', () => {
  const dir = tmp();
  assert.throws(() => makeApp({ out: path.join(dir, 'Herdquarters.app'), root: dir, checkout: dir, branch: true }), /--branch needs a name/);
  assert.throws(() => makeApp(args(['--out', path.join(dir, 'H.app'), '--root', dir, '--checkout', dir, '--branch'])), /--branch needs a name/);
  assert.strictEqual(fs.existsSync(path.join(dir, 'Herdquarters.app')), false);
});

test('a checkout on an unmerged branch gets what is pushed to that branch, and --reset takes it back to main', async () => {
  const r = repos();
  const branch = 'fregus/try-this';
  r.git(r.work, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(r.work, 'renderer', 'app.js'), 'branch\n');
  r.git(r.work, 'commit', '-q', '-am', 'Try: a branch change');
  r.git(r.work, 'push', '-q', 'origin', branch);
  resetCheckout({ root: r.root, checkout: r.checkout, branch });
  assert.strictEqual(r.git(r.checkout, 'symbolic-ref', '--short', 'HEAD'), branch);
  assert.strictEqual(r.head(), r.git(r.work, 'rev-parse', 'HEAD'));

  fs.writeFileSync(path.join(r.work, 'renderer', 'app.js'), 'branch two\n');
  r.git(r.work, 'commit', '-q', '-am', 'Try: another change');
  r.git(r.work, 'push', '-q', 'origin', branch);
  const next = r.git(r.work, 'rev-parse', 'HEAD');
  const u = new Updater({ shell: { root: r.root, checkout: r.checkout, branch }, send() {}, electronVersion: '45.0.0', now: () => 1000 });
  const s = await u.check();
  assert.strictEqual(s.status, 'available');
  assert.strictEqual(s.target, next);
  assert.deepStrictEqual(await u.apply(next), { ok: true, reload: true });
  assert.strictEqual(r.git(r.checkout, 'symbolic-ref', '--short', 'HEAD'), branch);
  assert.strictEqual(r.head(), next);

  resetCheckout({ root: r.root, checkout: r.checkout });
  assert.strictEqual(r.git(r.checkout, 'symbolic-ref', '--short', 'HEAD'), 'main');
  assert.strictEqual(r.head(), r.first);
});

test('once the tracked branch is deleted, a check says so and points to --reset, and the app stays where it is', async () => {
  const r = repos();
  const branch = 'fregus/try-this';
  r.git(r.work, 'checkout', '-q', '-b', branch);
  fs.writeFileSync(path.join(r.work, 'renderer', 'app.js'), 'branch\n');
  r.git(r.work, 'commit', '-q', '-am', 'Try: a branch change');
  r.git(r.work, 'push', '-q', 'origin', branch);
  resetCheckout({ root: r.root, checkout: r.checkout, branch });
  const head = r.head();
  launch.updateState(r.root, { lastGood: head });
  const u = new Updater({ shell: { root: r.root, checkout: r.checkout, branch }, send() {}, electronVersion: '45.0.0', now: () => 1000 });
  assert.strictEqual((await u.check()).status, 'current');

  r.git(r.work, 'push', '-q', 'origin', '--delete', branch);
  const s = await u.check();
  assert.strictEqual(s.status, 'gone');
  assert.strictEqual(s.branch, branch);
  assert.strictEqual(s.error, `The branch ${branch} is gone, probably merged. Run npm run install-app -- --reset to go back to main.`);
  assert.strictEqual(r.head(), head);
  assert.strictEqual(r.git(r.checkout, 'symbolic-ref', '--short', 'HEAD'), branch);
  assert.strictEqual(launch.readState(r.root).lastGood, head);
});

test('a missing main is an ordinary failed check, not a gone branch', async () => {
  const r = repos();
  const u = new Updater({ shell: { root: r.root, checkout: r.checkout, branch: 'main' }, send() {}, electronVersion: '45.0.0', now: () => 1000 });
  assert.strictEqual((await u.check()).status, 'current');
  r.git(r.work, 'push', '-q', 'origin', 'HEAD:refs/heads/other');
  execFileSync('git', ['-C', r.origin, 'symbolic-ref', 'HEAD', 'refs/heads/other']);
  r.git(r.work, 'push', '-q', 'origin', '--delete', 'main');
  const s = await u.check();
  assert.strictEqual(s.status, 'current');
  assert.match(s.error, /couldn't find remote ref main/);
});
