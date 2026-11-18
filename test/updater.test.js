// updater.js: sorting incoming commits by what applying them takes, and the
// check / apply / restart flow against a real bare repo standing in for origin.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { Updater, classify } = require('../updater');
const launch = require('../shell/launch');
const { repos } = require('./helpers/git-repos');

test('renderer-only changes apply with a reload', () => {
  assert.strictEqual(classify(['renderer/app.js', 'renderer/style.css']), 'live');
  assert.strictEqual(classify(['renderer/index.html', 'docs/GUIDE.md', 'test/view.test.js', 'README.md', '.github/workflows/ci.yml']), 'live');
  assert.strictEqual(classify(['docs/images/app.png', '.pr-media/x/shot.png', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', '.gitignore']), 'live');
});

test('anything main.js or preload.js loads needs a restart', () => {
  for (const f of ['main.js', 'preload.js', 'orchestrators.js', 'orchestrator-brief.md', 'assistant-brief.md', 'fixture/orchestrators/x/orchestrator.json', 'shell/launch.js', 'scripts/brand.js', 'package.json']) {
    assert.strictEqual(classify(['renderer/app.js', f]), 'restart', f);
  }
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
