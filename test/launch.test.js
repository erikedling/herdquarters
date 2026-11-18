// shell/launch.js: what the Dock app checks out before main.js loads, and the
// way back when a commit never gets its window up. Real git repos in a temp folder.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const launch = require('../shell/launch');
const { repos } = require('./helpers/git-repos');

function setup() {
  const r = repos();
  const npmCalls = [];
  const npm = (dir) => { npmCalls.push(dir); };
  const fetch = () => r.git(r.checkout, 'fetch', '-q', 'origin');
  return { ...r, npm, npmCalls, fetch };
}

test('a first launch runs what is checked out and records it as booting', () => {
  const r = setup();
  assert.strictEqual(launch.prepareLaunch({ root: r.root, checkout: r.checkout, npm: r.npm }), r.first);
  assert.deepStrictEqual(launch.readState(r.root), { pending: null, booting: r.first });
  launch.markGood(r.root, r.first);
  assert.deepStrictEqual(launch.readState(r.root), { pending: null, booting: null, lastGood: r.first });
});

test('a pending update is checked out at launch, without npm when the lockfile is the same', () => {
  const r = setup();
  launch.markGood(r.root, r.first);
  const next = r.commit({ 'main.js': 'two\n' });
  r.fetch();
  launch.updateState(r.root, { pending: next });
  assert.strictEqual(launch.prepareLaunch({ root: r.root, checkout: r.checkout, npm: r.npm }), next);
  assert.strictEqual(r.head(), next);
  assert.strictEqual(r.git(r.checkout, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.deepStrictEqual(r.npmCalls, []);
  const state = launch.readState(r.root);
  assert.strictEqual(state.pending, null);
  assert.strictEqual(state.booting, next);
});

test('a pending update that changes the lockfile runs npm ci', () => {
  const r = setup();
  const next = r.commit({ 'package-lock.json': '{"packages":{"node_modules/electron":{"version":"45.1.0"}}}\n' });
  r.fetch();
  launch.updateState(r.root, { pending: next });
  launch.prepareLaunch({ root: r.root, checkout: r.checkout, npm: r.npm });
  assert.deepStrictEqual(r.npmCalls, [r.checkout]);
});

test('a failed npm ci leaves the old commit checked out and says why', () => {
  const r = setup();
  const next = r.commit({ 'package-lock.json': '{}\n' });
  r.fetch();
  launch.updateState(r.root, { pending: next });
  let calls = 0;
  const npm = () => { calls += 1; if (calls === 1) throw Object.assign(new Error('npm failed'), { stderr: 'npm ERR! network\nnpm ERR! offline\n' }); };
  assert.strictEqual(launch.prepareLaunch({ root: r.root, checkout: r.checkout, npm, now: 5 }), r.first);
  assert.strictEqual(r.head(), r.first);
  assert.strictEqual(calls, 2, 'installs the old lockfile again');
  assert.deepStrictEqual(launch.readState(r.root).notice, { kind: 'applyFailed', to: next, error: 'npm ERR! offline', at: 5 });
  assert.strictEqual(launch.readState(r.root).pending, null);
});

test('local changes in the checkout block an update instead of being overwritten', () => {
  const r = setup();
  const next = r.commit({ 'main.js': 'two\n' });
  r.fetch();
  fs.writeFileSync(path.join(r.checkout, 'main.js'), 'edited by hand\n');
  launch.updateState(r.root, { pending: next });
  launch.prepareLaunch({ root: r.root, checkout: r.checkout, npm: r.npm });
  assert.strictEqual(r.head(), r.first);
  assert.match(launch.readState(r.root).notice.error, /local changes/);
  assert.strictEqual(fs.readFileSync(path.join(r.checkout, 'main.js'), 'utf8'), 'edited by hand\n');
});

test('a commit whose window never loaded is rolled back at the next launch and marked bad', () => {
  const r = setup();
  launch.markGood(r.root, r.first);
  const broken = r.commit({ 'main.js': 'throw\n' });
  r.fetch();
  launch.updateState(r.root, { pending: broken });
  assert.strictEqual(launch.prepareLaunch({ root: r.root, checkout: r.checkout, npm: r.npm }), broken);
  // That launch died before its window loaded, so booting is still set.
  assert.strictEqual(launch.prepareLaunch({ root: r.root, checkout: r.checkout, npm: r.npm, now: 9 }), r.first);
  assert.strictEqual(r.head(), r.first);
  const state = launch.readState(r.root);
  assert.strictEqual(state.bad, broken);
  assert.strictEqual(state.booting, r.first);
  assert.deepStrictEqual(state.notice, { kind: 'rolledBack', from: broken, to: r.first, error: 'the window never finished loading', at: 9 });
});

test('rollBack() goes to the last good commit right away, as the bootstrap does when main.js throws', () => {
  const r = setup();
  launch.markGood(r.root, r.first);
  const broken = r.commit({ 'main.js': 'throw\n' });
  r.fetch();
  launch.moveTo(r.checkout, broken, { npm: r.npm });
  assert.strictEqual(launch.rollBack({ root: r.root, checkout: r.checkout, npm: r.npm, error: 'boom', now: 1 }), r.first);
  assert.strictEqual(r.head(), r.first);
  assert.strictEqual(launch.readState(r.root).notice.error, 'boom');
});

test('with no good commit yet there is nothing to roll back to', () => {
  const r = setup();
  launch.prepareLaunch({ root: r.root, checkout: r.checkout, npm: r.npm });
  assert.strictEqual(launch.prepareLaunch({ root: r.root, checkout: r.checkout, npm: r.npm }), r.first);
  assert.strictEqual(launch.rollBack({ root: r.root, checkout: r.checkout, npm: r.npm, error: 'x' }), r.first);
  assert.strictEqual(launch.readState(r.root).notice, undefined);
});

test('a launch after a good one does not roll anything back', () => {
  const r = setup();
  launch.markGood(r.root, r.first);
  const next = r.commit({ 'main.js': 'two\n' });
  r.fetch();
  launch.updateState(r.root, { pending: next });
  launch.prepareLaunch({ root: r.root, checkout: r.checkout, npm: r.npm });
  launch.markGood(r.root, next);
  assert.strictEqual(launch.prepareLaunch({ root: r.root, checkout: r.checkout, npm: r.npm }), next);
  assert.strictEqual(launch.readState(r.root).bad, undefined);
});
