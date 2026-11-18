// shell/launch.js: what the Dock app checks out before main.js loads, its
// packages, and the way back when a commit never comes up. Real git repos in a temp folder.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const launch = require('../shell/launch');
const { repos } = require('./helpers/git-repos');

function setup() {
  const r = repos();
  const fetch = () => r.git(r.checkout, 'fetch', '-q', 'origin');
  const modules = path.join(r.checkout, 'node_modules');
  const marker = () => { try { return fs.readFileSync(path.join(modules, 'marker'), 'utf8'); } catch { return null; } };
  const npmCalls = [];
  const npm = async (dir) => {
    npmCalls.push(dir);
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'marker'), `for ${launch.lockHash(dir).slice(0, 8)}`);
  };
  return { ...r, fetch, modules, marker, npm, npmCalls };
}

async function installed(r) {
  await launch.installModules(r.root, r.checkout, { npm: r.npm });
  r.npmCalls.length = 0;
}

test('a first launch needs its packages; once installed they are recorded against the lockfile', async () => {
  const r = setup();
  assert.deepStrictEqual(launch.prepareLaunch({ root: r.root, checkout: r.checkout }), { current: r.first, needsModules: true });
  assert.strictEqual(await launch.installModules(r.root, r.checkout, { npm: r.npm }), true);
  assert.strictEqual(launch.readState(r.root).modulesFor, launch.lockHash(r.checkout));
  assert.deepStrictEqual(launch.prepareLaunch({ root: r.root, checkout: r.checkout }), { current: r.first, needsModules: false });
  assert.strictEqual(await launch.installModules(r.root, r.checkout, { npm: r.npm }), false, 'nothing to do');
  assert.strictEqual(r.npmCalls.length, 1);
});

test('a pending update is checked out at launch and needs no packages when the lockfile is the same', async () => {
  const r = setup();
  await installed(r);
  launch.markGood(r.root, r.first);
  const next = r.commit({ 'main.js': 'two\n' });
  r.fetch();
  launch.updateState(r.root, { pending: next });
  assert.deepStrictEqual(launch.prepareLaunch({ root: r.root, checkout: r.checkout }), { current: next, needsModules: false });
  assert.strictEqual(r.head(), next);
  assert.strictEqual(r.git(r.checkout, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.strictEqual(launch.readState(r.root).pending, null);
});

test('a lockfile change needs packages, installed over the old ones only when npm succeeds', async () => {
  const r = setup();
  await installed(r);
  const before = r.marker();
  const next = r.commit({ 'package-lock.json': '{"packages":{"node_modules/electron":{"version":"45.1.0"}}}\n' });
  r.fetch();
  launch.updateState(r.root, { pending: next });
  assert.strictEqual(launch.prepareLaunch({ root: r.root, checkout: r.checkout }).needsModules, true);
  await launch.installModules(r.root, r.checkout, { npm: r.npm });
  assert.notStrictEqual(r.marker(), before);
  assert.strictEqual(fs.existsSync(`${r.modules}.prev`), false);
  assert.strictEqual(launch.modulesReady(r.root, r.checkout), true);
});

test('a failing npm ci leaves the previous node_modules in place', async () => {
  const r = setup();
  await installed(r);
  const before = r.marker();
  const recorded = launch.readState(r.root).modulesFor;
  r.commit({ 'package-lock.json': '{}\n' });
  r.fetch();
  r.git(r.checkout, 'checkout', '-q', '-B', 'main', 'origin/main');
  const failing = async (dir) => {
    fs.mkdirSync(path.join(dir, 'node_modules', 'half'), { recursive: true });
    throw Object.assign(new Error('npm failed'), { stderr: 'npm ERR! network\nnpm ERR! offline\n' });
  };
  await assert.rejects(launch.installModules(r.root, r.checkout, { npm: failing }), /npm failed/);
  assert.strictEqual(r.marker(), before);
  assert.strictEqual(fs.existsSync(path.join(r.modules, 'half')), false);
  assert.strictEqual(fs.existsSync(`${r.modules}.prev`), false);
  assert.strictEqual(launch.readState(r.root).modulesFor, recorded);
  assert.strictEqual(launch.modulesReady(r.root, r.checkout), false, 'the new lockfile still needs its install');
});

test('an install that was cut short is redone at the next launch, starting from the old modules', async () => {
  const r = setup();
  await installed(r);
  const before = r.marker();
  const next = r.commit({ 'package-lock.json': '{"v":2}\n' });
  r.fetch();
  launch.updateState(r.root, { pending: next });
  launch.prepareLaunch({ root: r.root, checkout: r.checkout });
  // A force quit in the middle of npm ci: the old modules aside, a half-made new folder.
  fs.renameSync(r.modules, `${r.modules}.prev`);
  fs.mkdirSync(path.join(r.modules, 'half'), { recursive: true });
  const again = launch.prepareLaunch({ root: r.root, checkout: r.checkout });
  assert.deepStrictEqual(again, { current: next, needsModules: true }, 'no rollback: the window never got a chance');
  await launch.installModules(r.root, r.checkout, { npm: r.npm });
  assert.strictEqual(r.npmCalls.length, 1);
  assert.notStrictEqual(r.marker(), before);
  assert.strictEqual(fs.existsSync(`${r.modules}.prev`), false);
});

test('a cut-short install with the lockfile back where it was just restores the old modules', async () => {
  const r = setup();
  await installed(r);
  const before = r.marker();
  fs.renameSync(r.modules, `${r.modules}.prev`);
  fs.mkdirSync(path.join(r.modules, 'half'), { recursive: true });
  assert.strictEqual(launch.modulesReady(r.root, r.checkout), false);
  assert.strictEqual(await launch.installModules(r.root, r.checkout, { npm: r.npm }), false);
  assert.strictEqual(r.npmCalls.length, 0);
  assert.strictEqual(r.marker(), before);
});

test('local changes in the checkout block an update instead of being overwritten', async () => {
  const r = setup();
  const next = r.commit({ 'main.js': 'two\n' });
  r.fetch();
  fs.writeFileSync(path.join(r.checkout, 'main.js'), 'edited by hand\n');
  launch.updateState(r.root, { pending: next });
  launch.prepareLaunch({ root: r.root, checkout: r.checkout });
  assert.strictEqual(r.head(), r.first);
  assert.match(launch.readState(r.root).notice.error, /local changes.*--reset/);
  assert.strictEqual(fs.readFileSync(path.join(r.checkout, 'main.js'), 'utf8'), 'edited by hand\n');
});

test('an update refuses to drop commits that only the checkout has', () => {
  const r = setup();
  fs.writeFileSync(path.join(r.checkout, 'local.txt'), 'mine\n');
  r.git(r.checkout, 'add', 'local.txt');
  r.git(r.checkout, 'commit', '-q', '-m', 'local');
  const local = r.head();
  const next = r.commit({ 'main.js': 'two\n' });
  r.fetch();
  launch.updateState(r.root, { pending: next });
  launch.prepareLaunch({ root: r.root, checkout: r.checkout });
  assert.strictEqual(r.head(), local);
  assert.match(launch.readState(r.root).notice.error, /has commits that .* does not.*--reset/);
});

test('a commit whose window never came up is rolled back at the next launch and marked bad', async () => {
  const r = setup();
  await installed(r);
  launch.markGood(r.root, r.first);
  const broken = r.commit({ 'main.js': 'throw\n' });
  r.fetch();
  launch.updateState(r.root, { pending: broken });
  assert.strictEqual(launch.prepareLaunch({ root: r.root, checkout: r.checkout }).current, broken);
  launch.markBooting(r.root, broken);
  // That launch died before the renderer said it was ready, so booting is still set.
  assert.deepStrictEqual(launch.prepareLaunch({ root: r.root, checkout: r.checkout, now: 9 }), { current: r.first, needsModules: false });
  assert.strictEqual(r.head(), r.first);
  const state = launch.readState(r.root);
  assert.strictEqual(state.bad, broken);
  assert.deepStrictEqual(state.notice, { kind: 'rolledBack', from: broken, to: r.first, error: 'the window never came up', at: 9 });
});

test('rollBack() goes to the last good commit right away, as the bootstrap does when main.js throws', () => {
  const r = setup();
  launch.markGood(r.root, r.first);
  const broken = r.commit({ 'main.js': 'throw\n' });
  r.fetch();
  launch.checkoutTo(r.checkout, broken, { forward: true });
  assert.strictEqual(launch.rollBack({ root: r.root, checkout: r.checkout, error: 'boom', now: 1 }), r.first);
  assert.strictEqual(r.head(), r.first);
  assert.strictEqual(launch.readState(r.root).notice.error, 'boom');
});

test('with no good commit yet there is nothing to roll back to', () => {
  const r = setup();
  launch.prepareLaunch({ root: r.root, checkout: r.checkout });
  launch.markBooting(r.root, r.first);
  assert.strictEqual(launch.prepareLaunch({ root: r.root, checkout: r.checkout }).current, r.first);
  assert.strictEqual(launch.rollBack({ root: r.root, checkout: r.checkout, error: 'x' }), r.first);
  assert.strictEqual(launch.readState(r.root).notice, undefined);
});

test('a launch after a good one does not roll anything back', () => {
  const r = setup();
  launch.markGood(r.root, r.first);
  const next = r.commit({ 'main.js': 'two\n' });
  r.fetch();
  launch.updateState(r.root, { pending: next });
  launch.prepareLaunch({ root: r.root, checkout: r.checkout });
  launch.markBooting(r.root, next);
  launch.markGood(r.root, next);
  assert.strictEqual(launch.prepareLaunch({ root: r.root, checkout: r.checkout }).current, next);
  assert.strictEqual(launch.readState(r.root).bad, undefined);
});

test('shortError() gives npm’s actual complaint, not the path of its log', () => {
  const stderr = [
    'npm error code ETARGET',
    'npm error notarget No matching version found for @xterm/addon-fit@^0.99.0.',
    "npm error notarget In most cases you or one of your dependencies are requesting a package version that doesn't exist.",
    'npm error A complete log of this run can be found in: /Users/me/.npm/_logs/x-debug-0.log',
  ].join('\n');
  assert.strictEqual(launch.shortError({ stderr }), 'No matching version found for @xterm/addon-fit@^0.99.0.');
  assert.strictEqual(launch.shortError({ stderr: 'hint: x\nfatal: not a git repository\n' }), 'fatal: not a git repository');
  assert.strictEqual(launch.shortError(new Error('boom')), 'boom');
});

function fakeNpm(script) {
  const bin = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hq-npm-'));
  fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return bin;
}

async function withPath(bin, fn) {
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  try { return await fn(); } finally { process.env.PATH = oldPath; }
}

async function lockChanged(r) {
  await installed(r);
  r.commit({ 'package-lock.json': `{"v":${Date.now()}}\n` });
  r.fetch();
  r.git(r.checkout, 'checkout', '-q', '-B', 'main', 'origin/main');
}

test('stopping an install waits for npm to exit before the old modules go back', async () => {
  const r = setup();
  await lockChanged(r);
  const before = r.marker();
  // A stand-in npm that, told to stop, still writes into node_modules for a moment before it exits.
  const pidFile = path.join(r.dir, 'npm.pid');
  const bin = fakeNpm([
    'mkdir -p node_modules/half',
    `trap 'sleep 0.4; echo late > node_modules/late; exit 143' TERM`,
    `echo $$ > "${pidFile}"`,
    'sleep 30 & wait $!',
  ].join('\n'));
  const controller = new AbortController();
  await withPath(bin, async () => {
    const install = launch.installModules(r.root, r.checkout, { signal: controller.signal });
    while (!fs.existsSync(pidFile)) await new Promise((res) => setTimeout(res, 20));
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    controller.abort();
    await assert.rejects(install, { name: 'AbortError' });
    assert.throws(() => process.kill(pid, 0), /ESRCH/, 'npm had exited before installModules gave up');
  });
  assert.strictEqual(r.marker(), before);
  assert.strictEqual(fs.existsSync(path.join(r.modules, 'late')), false, 'the late write went into the half-made folder, which is gone');
  assert.strictEqual(fs.existsSync(path.join(r.modules, 'half')), false);
  assert.strictEqual(fs.existsSync(`${r.modules}.prev`), false);
});

test('npmCi() reports a failing npm with its stderr, and a hung one after its timeout', async () => {
  const r = setup();
  const failing = fakeNpm('echo "npm error code ETARGET" >&2; echo "npm error notarget No matching version found for x@9." >&2; exit 1');
  await withPath(failing, async () => {
    const err = await launch.npmCi(r.checkout).then(() => null, (e) => e);
    assert.strictEqual(launch.shortError(err), 'No matching version found for x@9.');
  });
  const hung = fakeNpm('exec sleep 30');
  await withPath(hung, async () => {
    await assert.rejects(launch.npmCi(r.checkout, { timeoutMs: 100 }), /timed out after 0\.1 s/);
  });
});
