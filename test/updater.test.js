// updater.js: sorting incoming commits by what applying them takes, and the
// check / apply / restart flow against a real bare repo standing in for origin.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Updater, classify } = require('../updater');
const launch = require('../shell/launch');
const { repos } = require('./helpers/git-repos');

// The undo runs git, which can take well over 100 ms on a busy CI runner.
async function until(cond, ms = 10_000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('renderer-only changes apply with a reload', () => {
  assert.strictEqual(classify(['renderer/app.js', 'renderer/style.css']), 'live');
  assert.strictEqual(classify(['renderer/index.html', 'docs/GUIDE.md', 'test/view.test.js', 'README.md', '.github/workflows/ci.yml']), 'live');
  assert.strictEqual(classify(['docs/images/app.png', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', '.gitignore']), 'live');
});

test('anything main.js or preload.js loads needs a restart, also when it lives under renderer/', () => {
  for (const f of ['main.js', 'preload.js', 'orchestrators.js', 'orchestrator-brief.md', 'assistant-brief.md', 'fixture/orchestrators/x/orchestrator.json', 'scripts/brand.js', 'package.json', 'renderer/note-rows.js']) {
    assert.strictEqual(classify(['renderer/app.js', f]), 'restart', f);
  }
});

test('a change to shell/ is its own kind: the bundle has to take the new files', () => {
  assert.strictEqual(classify(['shell/bootstrap.js']), 'bootstrap');
  assert.strictEqual(classify(['renderer/app.js', 'main.js', 'shell/launch.js']), 'bootstrap');
  assert.strictEqual(classify(['shell/launch.js', 'package-lock.json']), 'deps', 'npm ci at launch, which syncs shell/ too');
});

test('a lockfile change needs npm ci, and another Electron major needs a new app', () => {
  assert.strictEqual(classify(['package-lock.json', 'package.json']), 'deps');
  assert.strictEqual(classify(['package-lock.json'], { electronNow: 45, electronNext: 45 }), 'deps');
  assert.strictEqual(classify(['package-lock.json'], { electronNow: 45, electronNext: 46 }), 'shell');
  // An unreadable lockfile is not a reason to rebuild.
  assert.strictEqual(classify(['package-lock.json'], { electronNow: 45, electronNext: null }), 'deps');
});

function updater(r, sent = []) {
  return new Updater({ shell: { root: r.root, checkout: r.checkout, branch: 'main' }, send: (s) => sent.push(s), electronVersion: '45.0.0', now: () => 1000 });
}

test('without the Dock app there is nothing to check', async () => {
  const u = new Updater({ shell: null });
  assert.strictEqual(u.view().enabled, false);
  assert.strictEqual((await u.check()).status, 'idle');
  assert.deepStrictEqual(await u.apply('abc'), { ok: false, error: 'nothing to apply' });
});

test('up to date when origin has nothing new', async () => {
  const r = repos();
  const s = await updater(r).check();
  assert.strictEqual(s.status, 'current');
  assert.strictEqual(s.current.sha, r.first.slice(0, 7));
  assert.strictEqual(s.checkedAt, 1000);
});

test('a renderer change is offered, then applied by checking it out', async () => {
  const r = repos();
  const next = r.commit({ 'renderer/app.js': 'two\n' }, 'Terminal: a nicer cursor (#40)');
  const u = updater(r);
  const s = await u.check();
  assert.strictEqual(s.status, 'available');
  assert.strictEqual(s.kind, 'live');
  assert.strictEqual(s.target, next);
  assert.deepStrictEqual(s.commits, [{ sha: next.slice(0, 7), subject: 'Terminal: a nicer cursor (#40)' }]);
  assert.deepStrictEqual(await u.apply(next), { ok: true, reload: true });
  assert.strictEqual(r.head(), next);
  await u.loaded();
  assert.strictEqual(launch.readState(r.root).lastGood, next);
  assert.strictEqual(u.view().status, 'current');
});

test('a live update whose window never says it is ready is put back and reloaded again', async () => {
  const r = repos();
  const broken = r.commit({ 'renderer/app.js': 'throw\n' });
  const u = updater(r);
  await u.check();
  await u.apply(broken);
  assert.strictEqual(r.head(), broken);
  let reloads = 0;
  await new Promise((resolve) => { u.watchReload(() => { reloads += 1; resolve(); }, 20); });
  assert.strictEqual(reloads, 1);
  assert.strictEqual(r.head(), r.first);
  const state = launch.readState(r.root);
  assert.strictEqual(state.bad, broken);
  assert.strictEqual(state.notice.kind, 'rolledBack');
  assert.strictEqual(u.view().notice.to, r.first);
  assert.strictEqual((await u.check()).status, 'current', 'not offered again');
});

test('when even the undone update brings no window back, the user is told to restart', async () => {
  const r = repos();
  const broken = r.commit({ 'renderer/app.js': 'throw\n' });
  let stuck = 0;
  const u = new Updater({ shell: { root: r.root, checkout: r.checkout, branch: 'main' }, onStuck: () => { stuck += 1; }, electronVersion: '45.0.0' });
  await u.check();
  await u.apply(broken);
  let reloads = 0;
  u.watchReload(() => { reloads += 1; }, 20);
  await until(() => stuck > 0);
  assert.strictEqual(reloads, 1);
  assert.strictEqual(stuck, 1);
  assert.strictEqual(r.head(), r.first);
});

test('a window that comes back after the undo needs no restart prompt', async () => {
  const r = repos();
  const broken = r.commit({ 'renderer/app.js': 'throw\n' });
  let stuck = 0;
  const u = new Updater({ shell: { root: r.root, checkout: r.checkout, branch: 'main' }, onStuck: () => { stuck += 1; }, electronVersion: '45.0.0' });
  await u.check();
  await u.apply(broken);
  let reloads = 0;
  u.watchReload(() => { reloads += 1; setTimeout(() => u.loaded(), 5); }, 20);
  await until(() => reloads > 0 && r.head() === r.first);
  assert.strictEqual(r.head(), r.first);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.strictEqual(stuck, 0);
});

test('a ready message in time keeps the live update', async () => {
  const r = repos();
  const next = r.commit({ 'renderer/app.js': 'two\n' });
  const u = updater(r);
  await u.check();
  await u.apply(next);
  let reloads = 0;
  u.watchReload(() => { reloads += 1; }, 30);
  await u.loaded();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.strictEqual(reloads, 0);
  assert.strictEqual(r.head(), next);
});

test('a main-process change is only recorded for the next launch', async () => {
  const r = repos();
  const next = r.commit({ 'renderer/app.js': 'two\n' });
  const later = r.commit({ 'main.js': 'two\n' });
  const u = updater(r);
  const s = await u.check();
  assert.strictEqual(s.kind, 'restart');
  assert.strictEqual(s.commits.length, 2);
  assert.deepStrictEqual(await u.apply(later), { ok: true, restart: true });
  assert.strictEqual(r.head(), r.first, 'nothing changes under the running app');
  assert.strictEqual(launch.readState(r.root).pending, later);
  assert.strictEqual(u.view().status, 'restart');
  assert.strictEqual(u.later().status, 'pending');
  // A later check keeps the choice instead of asking again.
  assert.strictEqual((await u.check()).status, 'pending');
  assert.ok(next);
});

test('a commit that failed to start is not offered again', async () => {
  const r = repos();
  const broken = r.commit({ 'main.js': 'throw\n' });
  launch.updateState(r.root, { bad: broken });
  const u = updater(r);
  const s = await u.check();
  assert.strictEqual(s.status, 'current');
  assert.strictEqual(s.skipped, broken);
  const fixed = r.commit({ 'main.js': 'fixed\n' });
  const next = await u.check();
  assert.strictEqual(next.status, 'available');
  assert.strictEqual(next.target, fixed);
  assert.strictEqual(next.skipped, null);
});

test('a failed fetch keeps the last result and reports the error', async () => {
  const r = repos();
  r.commit({ 'renderer/app.js': 'two\n' });
  const u = updater(r);
  await u.check();
  fs.renameSync(r.origin, `${r.origin}.gone`);
  const s = await u.check();
  assert.strictEqual(s.status, 'available');
  assert.ok(s.error);
  assert.strictEqual(s.checking, false);
});

test('local changes in the checkout stop a live update', async () => {
  const r = repos();
  const next = r.commit({ 'renderer/app.js': 'two\n' });
  const u = updater(r);
  await u.check();
  fs.writeFileSync(path.join(r.checkout, 'renderer', 'app.js'), 'mine\n');
  const res = await u.apply(next);
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /local changes/);
  assert.strictEqual(u.view().status, 'available');
  assert.strictEqual(r.head(), r.first);
});

test('a live update refuses to drop commits that only the checkout has', async () => {
  const r = repos();
  fs.writeFileSync(path.join(r.checkout, 'renderer', 'local.js'), 'mine\n');
  r.git(r.checkout, 'add', 'renderer/local.js');
  r.git(r.checkout, 'commit', '-q', '-m', 'local');
  const local = r.head();
  const next = r.commit({ 'renderer/app.js': 'two\n' });
  const u = updater(r);
  assert.strictEqual((await u.check()).kind, 'live');
  const res = await u.apply(next);
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /has commits that .* does not.*--reset/);
  assert.strictEqual(r.head(), local);
});

test('state goes through the launch module the bundle passes in', async () => {
  const r = repos();
  const calls = [];
  const fake = { ...launch, readState: (root) => { calls.push('read'); return launch.readState(root); }, updateState: (root, patch) => { calls.push(Object.keys(patch).join()); return launch.updateState(root, patch); } };
  const later = r.commit({ 'main.js': 'two\n' });
  const u = new Updater({ shell: { root: r.root, checkout: r.checkout, branch: 'main', launch: fake }, electronVersion: '45.0.0' });
  await u.check();
  await u.apply(later);
  assert.deepStrictEqual(calls, ['read', 'pending']);
});

test('a notice from the last launch is shown until dismissed', async () => {
  const r = repos();
  launch.updateState(r.root, { notice: { kind: 'rolledBack', from: 'b', to: 'a', error: 'x', at: 1 } });
  const u = updater(r);
  await u.start({ firstCheckMs: 1e9, everyMs: 1e9 });
  u.stop();
  assert.strictEqual(u.view().notice.kind, 'rolledBack');
  u.dismissNotice();
  assert.strictEqual(u.view().notice, null);
  assert.strictEqual(launch.readState(r.root).notice, null);
});

// Holds the git checkout that puts the previous commit back, so a test can act while the undo runs.
function holdUndo(u, previous) {
  const real = u.git;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const held = { started: false, release };
  u.git = async (args) => {
    if (args[0] === 'checkout' && args.includes(previous) && !held.started) { held.started = true; await gate; }
    return real(args);
  };
  return held;
}

test('an undone live update is marked bad before its checkout, so a check meanwhile cannot offer it again', async () => {
  const r = repos();
  const broken = r.commit({ 'renderer/app.js': 'throw\n' });
  const u = updater(r);
  await u.check();
  await u.apply(broken);
  const held = holdUndo(u, r.first);
  let reloads = 0;
  u.watchReload(() => { reloads += 1; }, 20);
  await until(() => held.started);
  assert.strictEqual(launch.readState(r.root).bad, broken);
  assert.notStrictEqual((await u.check()).status, 'available');
  assert.deepStrictEqual(await u.apply(broken), { ok: false, error: 'nothing to apply' });
  held.release();
  await until(() => reloads > 0);
  assert.strictEqual(r.head(), r.first);
  const after = await u.check();
  assert.strictEqual(after.status, 'current');
  assert.strictEqual(after.skipped, broken);
  await u.loaded();
});

test('a ready message that arrives while the undo runs keeps the update and marks it good', async () => {
  const r = repos();
  launch.updateState(r.root, { bad: 'older-bad' });
  const slow = r.commit({ 'renderer/app.js': 'slow but fine\n' });
  const u = updater(r);
  await u.check();
  await u.apply(slow);
  const held = holdUndo(u, r.first);
  let reloads = 0;
  let stuck = 0;
  u.onStuck = () => { stuck += 1; };
  u.watchReload(() => { reloads += 1; }, 20);
  await until(() => held.started);
  await u.loaded();
  held.release();
  await until(() => u.view().status === 'current' && !u.reverting);
  assert.strictEqual(r.head(), slow);
  const state = launch.readState(r.root);
  assert.strictEqual(state.lastGood, slow);
  assert.strictEqual(state.bad, 'older-bad');
  assert.strictEqual(state.notice, null);
  assert.strictEqual(u.view().notice, null);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.strictEqual(reloads, 0);
  assert.strictEqual(stuck, 0);
});

test('newer commits do not hide a restart that is already waiting, and applying them replaces it', async () => {
  const r = repos();
  const first = r.commit({ 'main.js': 'two\n' }, 'Main: a change (#50)');
  const u = updater(r);
  await u.check();
  await u.apply(first);
  u.later();
  assert.strictEqual(u.view().status, 'pending');

  const second = r.commit({ 'renderer/app.js': 'two\n' }, 'Terminal: a later change (#51)');
  let s = await u.check();
  assert.strictEqual(s.status, 'pending', 'still on show as waiting for the next launch');
  assert.strictEqual(s.target, first);
  assert.strictEqual(s.newer.target, second);
  assert.strictEqual(s.newer.kind, 'restart', 'it carries the waiting main.js change too');
  assert.deepStrictEqual(s.newer.commits.map((c) => c.subject), ['Terminal: a later change (#51)', 'Main: a change (#50)']);
  assert.strictEqual(s.newer.added, 1, 'the bar counts only what came after the waiting restart');
  assert.strictEqual(launch.readState(r.root).pending, first);

  u.set({ status: 'restart' });
  s = await u.check();
  assert.strictEqual(s.status, 'restart');
  assert.strictEqual(s.newer.target, second);

  assert.deepStrictEqual(await u.apply(second), { ok: true, restart: true });
  assert.strictEqual(launch.readState(r.root).pending, second);
  s = u.view();
  assert.strictEqual(s.status, 'restart');
  assert.strictEqual(s.target, second);
  assert.strictEqual(s.newer, null);
  assert.strictEqual((await u.check()).status, 'restart');
  assert.strictEqual(r.head(), r.first, 'nothing is checked out before the restart');
});

test('Automatic taking newer commits keeps the user’s On next launch, and a force-push back keeps the waiting restart', async () => {
  const r = repos();
  const first = r.commit({ 'main.js': 'two\n' }, 'Main: a change (#50)');
  const u = updater(r);
  await u.check();
  await u.apply(first);
  u.later();
  const second = r.commit({ 'renderer/app.js': 'two\n' }, 'Terminal: a later change (#51)');
  const third = r.commit({ 'renderer/app.js': 'three\n' }, 'Terminal: another (#52)');
  let s = await u.check();
  assert.strictEqual(s.newer.target, third);
  assert.strictEqual(s.newer.added, 2);
  assert.deepStrictEqual(await u.apply(third, { keepPending: true }), { ok: true, restart: true });
  s = u.view();
  assert.strictEqual(s.status, 'pending', 'no new Restart now prompt');
  assert.strictEqual(s.target, third);
  assert.strictEqual(launch.readState(r.root).pending, third);
  assert.notStrictEqual(second, third);

  r.git(r.work, 'push', '-q', '-f', 'origin', `${r.first}:refs/heads/main`);
  s = await u.check();
  assert.strictEqual(s.status, 'pending');
  assert.strictEqual(s.target, third);
  u.set({ status: 'restart' });
  launch.updateState(r.root, { bad: second });
  r.git(r.work, 'push', '-q', '-f', 'origin', `${second}:refs/heads/main`);
  s = await u.check();
  assert.strictEqual(s.status, 'restart');
  assert.strictEqual(s.target, third);
  assert.strictEqual(s.skipped, second);
});

test('reverting starts out unset, next to the other updater state', () => {
  const u = new Updater({ shell: null });
  assert.strictEqual(u.reverting, null);
  assert.strictEqual(u.awaitingLoad, null);
});

test('Update now on newer commits after On next launch asks for the restart again', async () => {
  const r = repos();
  const first = r.commit({ 'main.js': 'two\n' }, 'Main: a change (#50)');
  const u = updater(r);
  await u.check();
  await u.apply(first);
  u.later();
  const second = r.commit({ 'renderer/app.js': 'two\n' }, 'Terminal: a later change (#51)');
  await u.check();
  assert.deepStrictEqual(await u.apply(second), { ok: true, restart: true });
  assert.strictEqual(u.view().status, 'restart');
  assert.strictEqual(launch.readState(r.root).pending, second);
});

test('origin moving back to a commit the waiting restart already has offers nothing newer', async () => {
  const r = repos();
  const between = r.commit({ 'renderer/app.js': 'two\n' }, 'Terminal: a change (#50)');
  const waiting = r.commit({ 'main.js': 'two\n' }, 'Main: a change (#51)');
  const u = updater(r);
  await u.check();
  await u.apply(waiting);
  u.later();
  r.git(r.work, 'push', '-q', '-f', 'origin', `${between}:refs/heads/main`);
  const s = await u.check();
  assert.strictEqual(s.status, 'pending');
  assert.strictEqual(s.target, waiting);
  assert.strictEqual(s.newer, null);
  assert.strictEqual(launch.readState(r.root).pending, waiting);
});
