// Every room's branch is listed while its workspace exists, even when herdr
// refuses some checks or fails one; a workspace herdr says is not a git
// checkout is left out and not asked about again for a while. Runs against a
// fake herdr with the same limit of about 8 pending checks.
const test = require('node:test');
const assert = require('node:assert');
const { createWorktreeLister } = require('../worktrees');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BRANCH = 'mia/search-relevance';

// n repos, each with a worker workspace on BRANCH, plus `bosses` workspaces
// that are not git checkouts. attached: false leaves out the `worktree` herdr
// sometimes does not attach. fail(code) makes herdr answer every check with
// that error until calm(); busy() is fail('worktree_busy'), as when another
// client fills its queue. sourceless() makes it answer with no repo source;
// checkoutGone(id) makes it answer not_git_worktree for that workspace;
// busyFor(id) makes only that workspace's checks busy. addWorktree(i, path)
// adds a worktree on BRANCH to repo i.
function fakeHerdr({ repos = 12, limit = 8, attached = true, bosses = 0 } = {}) {
  let pending = 0, refuseWith = null, noSource = false;
  const asked = new Map();
  const gone = new Set(), busyIds = new Set(), added = new Map();
  const ws = Array.from({ length: repos }, (_, i) => ({
    workspace_id: `w${i}`, label: `repo${i}`,
    worktree: { repo_key: `k${i}`, repo_name: `repo${i}`, repo_root: `/r/repo${i}`, checkout_path: `/wt/repo${i}`, is_linked_worktree: true },
  }));
  for (let i = 0; i < bosses; i++) ws.push({ workspace_id: `b${i}`, label: `boss: ${i}` });
  const answer = (i) => ({
    source: { repo_key: `k${i}`, repo_name: `repo${i}`, repo_root: `/r/repo${i}`, source_checkout_path: `/wt/repo${i}` },
    worktrees: [
      { path: `/r/repo${i}`, branch: 'main', is_linked_worktree: false },
      { path: `/wt/repo${i}`, branch: BRANCH, is_linked_worktree: true, open_workspace_id: `w${i}` },
      ...(added.get(i) || []).map((path) => ({ path, branch: BRANCH, is_linked_worktree: true })),
    ],
  });
  const refuse = (code) => Object.assign(new Error(`worktree.list: ${code}`), { answered: true, code });
  const client = {
    async request(method, { workspace_id }) {
      assert.strictEqual(method, 'worktree.list');
      asked.set(workspace_id, (asked.get(workspace_id) || 0) + 1);
      await sleep(1);
      if (workspace_id.startsWith('b') || gone.has(workspace_id)) throw refuse('not_git_worktree');
      if (refuseWith || busyIds.has(workspace_id) || pending >= limit) throw refuse(refuseWith || 'worktree_busy');
      if (noSource) return { worktrees: [] };
      pending++;
      try { await sleep(5); return answer(Number(workspace_id.slice(1))); } finally { pending--; }
    },
  };
  const snapshot = () => ({ workspaces: ws.map((w) => (attached && w.worktree ? structuredClone(w) : { workspace_id: w.workspace_id, label: w.label })) });
  return {
    client, snapshot, asked,
    fail: (code) => { refuseWith = code; }, sourceless: () => { noSource = true; }, checkoutGone: (id) => { gone.add(id); }, busyFor: (id) => { busyIds.add(id); },
    addWorktree: (i, path) => { added.set(i, [...(added.get(i) || []), path]); }, busy: () => { refuseWith = 'worktree_busy'; }, calm: () => { refuseWith = null; },
  };
}

const branchOf = (out, i) => out[`k${i}`]?.worktrees.find((w) => w.path === `/wt/repo${i}`)?.branch;
const missing = (out, n) => Array.from({ length: n }, (_, i) => i).filter((i) => branchOf(out, i) !== BRANCH);

test('one poll over more repos than herdr checks at once lists every branch', async () => {
  const h = fakeHerdr({ repos: 12 });
  const out = await createWorktreeLister(h.client).list(h.snapshot());
  assert.deepStrictEqual(missing(out, 12), []);
});

test('a poll herdr is too busy to answer keeps the branches it last listed', async () => {
  const h = fakeHerdr({ repos: 12 });
  const lister = createWorktreeLister(h.client);
  assert.deepStrictEqual(missing(await lister.list(h.snapshot()), 12), []);
  h.busy();
  assert.deepStrictEqual(missing(await lister.list(h.snapshot()), 12), []);
});

test('a busy answer for a workspace without an attached worktree does not take it for a non-repo', async () => {
  const h = fakeHerdr({ repos: 3, attached: false });
  const lister = createWorktreeLister(h.client);
  h.busy();
  await lister.list(h.snapshot());
  h.calm();
  const out = await lister.list(h.snapshot());
  assert.deepStrictEqual(missing(out, 3), []);
});

test('a repo whose workspaces are gone is no longer listed', async () => {
  const h = fakeHerdr({ repos: 2 });
  const lister = createWorktreeLister(h.client);
  await lister.list(h.snapshot());
  const out = await lister.list({ workspaces: h.snapshot().workspaces.slice(0, 1) });
  assert.deepStrictEqual(Object.keys(out), ['k0']);
});

test('a workspace without an attached worktree keeps its branch through a busy poll', async () => {
  const h = fakeHerdr({ repos: 3, attached: false });
  const lister = createWorktreeLister(h.client);
  assert.deepStrictEqual(missing(await lister.list(h.snapshot()), 3), []);
  h.busy();
  assert.deepStrictEqual(missing(await lister.list(h.snapshot()), 3), []);
});

test('a failed check for a workspace without an attached worktree does not hide it on later polls', async () => {
  const h = fakeHerdr({ repos: 3, attached: false });
  const lister = createWorktreeLister(h.client);
  assert.deepStrictEqual(missing(await lister.list(h.snapshot()), 3), []);
  for (const code of ['worktree_list_failed', 'server_unavailable']) {
    h.fail(code);
    assert.deepStrictEqual(missing(await lister.list(h.snapshot()), 3), [], code);
    h.calm();
    assert.deepStrictEqual(missing(await lister.list(h.snapshot()), 3), [], `after ${code}`);
  }
});

test('a workspace herdr says is not a git checkout is left out and not asked again', async () => {
  const h = fakeHerdr({ repos: 2, bosses: 1 });
  const lister = createWorktreeLister(h.client);
  const snap = h.snapshot();
  const out = await lister.list(snap);
  assert.deepStrictEqual(Object.keys(out).sort(), ['k0', 'k1']);
  assert.strictEqual(snap.workspaces.find((w) => w.workspace_id === 'b0').worktree, undefined);
  await lister.list(h.snapshot());
  assert.strictEqual(h.asked.get('b0'), 1);
});

test('a workspace herdr answers with no repo source is not brought back from an earlier answer', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const h = fakeHerdr({ repos: 1, attached: false });
  const lister = createWorktreeLister(h.client);
  assert.deepStrictEqual(missing(await lister.list(h.snapshot()), 1), []);
  h.sourceless();
  assert.deepStrictEqual(missing(await lister.list(h.snapshot()), 1), [0]);
  t.mock.timers.tick(61_000);
  h.busy();
  assert.deepStrictEqual(missing(await lister.list(h.snapshot()), 1), [0]);
});

test('a repo whose only open checkout stops being a git checkout loses its cached list', async () => {
  const h = fakeHerdr({ repos: 2 });
  const lister = createWorktreeLister(h.client);
  assert.deepStrictEqual(missing(await lister.list(h.snapshot()), 2), []);
  h.checkoutGone('w0');
  assert.deepStrictEqual(missing(await lister.list(h.snapshot()), 2), [0]);
  h.busy();
  assert.deepStrictEqual(missing(await lister.list(h.snapshot()), 2), [0]);
});

test('a repo still lists when one of its checkouts is gone and another is not', async () => {
  const h = fakeHerdr({ repos: 1 });
  const lister = createWorktreeLister(h.client);
  h.checkoutGone('x0');
  const snapshot = () => {
    const s = h.snapshot();
    s.workspaces.unshift({ workspace_id: 'x0', label: 'old', worktree: { ...s.workspaces[0].worktree, checkout_path: '/wt/repo0-old' } });
    return s;
  };
  assert.deepStrictEqual(missing(await lister.list(snapshot()), 1), []);
  h.busy();
  assert.deepStrictEqual(missing(await lister.list(snapshot()), 1), []);
});

test('a fresh answer for a repo is not replaced by a cached one from another workspace of it', async () => {
  const h = fakeHerdr({ repos: 1, attached: false });
  const lister = createWorktreeLister(h.client);
  const snapshot = () => {
    const s = h.snapshot();
    s.workspaces.push({ workspace_id: 'y0', label: 'repo0 again' });
    return s;
  };
  assert.deepStrictEqual(missing(await lister.list(snapshot()), 1), []);
  h.addWorktree(0, '/wt/repo0-new');
  h.busyFor('y0');
  const out = await lister.list(snapshot());
  assert.ok(out.k0.worktrees.some((w) => w.path === '/wt/repo0-new'), JSON.stringify(out.k0.worktrees.map((w) => w.path)));
});
