// worktree.list for every repo with an open workspace, for the renderer's
// room labels and branches. Keyed by repo_key.
//
// A worker room is on its orchestrator's tab only while its branch is known,
// so a list that fails must not blank the branch: the last answer for the
// repo stands until herdr answers again, says none of its open checkouts is a
// git checkout any more, or the repo has no open workspace.

// herdr answers worktree_busy beyond about 8 pending checks, a budget shared
// with every other client (a second app, the herdr CLI), so ask a few at a time.
const MAX_PENDING = 3;

// At most maxPending calls of fn run at once; the rest wait their turn.
function createLimiter(maxPending) {
  let running = 0;
  const waiting = [];
  return async function limit(fn) {
    if (running < maxPending) running++;
    else await new Promise((resolve) => waiting.push(resolve));
    try {
      return await fn();
    } finally {
      // A finished call passes its slot straight to the next waiter, so running only drops when nobody waits.
      const next = waiting.shift();
      if (next) next(); else running--;
    }
  };
}

function createWorktreeLister(client, { maxPending = MAX_PENDING } = {}) {
  const limit = createLimiter(maxPending);
  const ask = (workspace_id) => limit(() => client.request('worktree.list', { workspace_id }));

  const lastList = new Map(); // repo_key -> { source, worktrees }
  const lastFill = new Map(); // workspace_id -> worktree

  // herdr does not always attach `worktree` to a workspace even when its
  // directory is a git checkout (seen with workspaces opened before herdr
  // started tracking them). worktree.list still answers for those, so fill the
  // gap from its `source` and the entry for the checkout itself. Workspaces
  // that really are not repos are remembered for a while so the poll does not
  // keep asking.
  const notARepo = new Map(); // workspace_id -> until (ms)
  async function fillMissingWorktrees(snapshot) {
    const now = Date.now();
    await Promise.all((snapshot.workspaces || []).map(async (ws) => {
      if (ws.worktree || (notARepo.get(ws.workspace_id) || 0) > now) return;
      let r;
      try {
        r = await ask(ws.workspace_id);
      } catch (err) {
        // Only not_git_worktree makes it a non-repo; busy, a failed git call or a timeout says nothing.
        if (err.code === 'not_git_worktree') { notARepo.set(ws.workspace_id, now + 60_000); lastFill.delete(ws.workspace_id); return; }
        // Only the workspace's repo comes from the cache; the list is left to
        // list(), so a fresh answer from another workspace of the repo wins.
        if (lastFill.has(ws.workspace_id)) ws.worktree = lastFill.get(ws.workspace_id);
        return;
      }
      const src = r.source;
      if (!src?.repo_key) { notARepo.set(ws.workspace_id, now + 60_000); lastFill.delete(ws.workspace_id); return; }
      const checkout = src.source_checkout_path;
      const me = (r.worktrees || []).find((w) => w.path === checkout);
      ws.worktree = {
        repo_key: src.repo_key, repo_name: src.repo_name, repo_root: src.repo_root,
        checkout_path: checkout, is_linked_worktree: me ? !!me.is_linked_worktree : checkout !== src.repo_root,
      };
      ws._worktreeList = { source: src, worktrees: r.worktrees || [] };
      lastFill.set(ws.workspace_id, ws.worktree);
    }));
    const live = new Set((snapshot.workspaces || []).map((ws) => ws.workspace_id));
    for (const id of lastFill.keys()) if (!live.has(id)) lastFill.delete(id);
  }

  // Asks the repo's open workspaces in turn: not_git_worktree from one only
  // means that checkout is gone, and another may still answer for the repo.
  async function listRepo(key, ids) {
    let err;
    for (const id of ids) {
      try {
        const r = await ask(id);
        return { source: r.source, worktrees: r.worktrees || [] };
      } catch (e) {
        err = e;
        if (e.code !== 'not_git_worktree') break;
      }
    }
    if (err.code === 'not_git_worktree') lastList.delete(key);
    return lastList.get(key) || { error: String(err.message || err), worktrees: [] };
  }

  async function list(snapshot) {
    await fillMissingWorktrees(snapshot);
    const byRepo = new Map(); // repo_key -> open workspace ids
    const out = {};
    for (const ws of snapshot.workspaces || []) {
      const key = ws.worktree?.repo_key;
      if (!key) continue;
      if (ws._worktreeList) { out[key] = ws._worktreeList; delete ws._worktreeList; }
      if (!byRepo.has(key)) byRepo.set(key, []);
      byRepo.get(key).push(ws.workspace_id);
    }
    await Promise.all([...byRepo].filter(([key]) => !out[key]).map(async ([key, ids]) => { out[key] = await listRepo(key, ids); }));
    for (const key of lastList.keys()) if (!byRepo.has(key)) lastList.delete(key);
    for (const [key, v] of Object.entries(out)) if (!v.error) lastList.set(key, v);
    return out;
  }

  return { list };
}

module.exports = { createWorktreeLister };
