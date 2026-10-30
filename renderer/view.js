// Pure helpers over the floor model: which floors a tab shows, who is waiting
// for the user, how a boss's worker is posed. No DOM, so test/view.test.js can
// run them in node; the browser gets them as window.officeView.
(function () {
  // The Office tab is for agents no orchestrator owns. Boss floors go, and so
  // do rooms on an orchestrator's branch. A repo whose rooms are all taken
  // stays as an empty floor so a plain worktree can still be opened there.
  function officeFloors(floors) {
    const out = [];
    for (const f of floors) {
      if (f.isBoss) continue;
      const rooms = f.rooms.filter((r) => !r.orch);
      out.push(rooms.length === f.rooms.length ? f : { ...f, rooms });
    }
    return out;
  }

  // An orchestrator's tab: its rooms in each repo, then its boss floor so it
  // renders last.
  function orchestratorFloors(floors, slug) {
    const out = [];
    let boss = null;
    for (const f of floors) {
      if (f.orchestrator?.slug === slug) { boss = f; continue; }
      const rooms = f.rooms.filter((r) => r.orch?.slug === slug);
      if (rooms.length) out.push({ ...f, rooms, closed: [] });
    }
    if (boss) out.push(boss);
    return out;
  }

  // Desks waiting for the user, on every tab: blocked ones (except a boss
  // relaying a board question, which reception lists from the board) and done
  // ones. Blocked before done, newest first.
  function needsAttention(floors) {
    const out = [];
    for (const f of floors) for (const r of f.rooms) for (const d of r.desks) {
      if ((d.pose === 'blocked' && !d.escalated) || d.pose === 'done') out.push(d);
    }
    return out.sort((a, b) => (a.pose === b.pose ? b.seq - a.seq : a.pose === 'blocked' ? -1 : 1));
  }

  // A boss's worker reports to the boss, not to the user: when it finishes it
  // sits idle instead of waving. A permission prompt still needs the user,
  // since only the worker's terminal can answer it.
  function workerPose(pose) { return pose === 'done' ? 'idle' : pose; }

  // The top-bar notice for orchestrators reconcile() archived: [{ name, reason }].
  function archivedNotice(archived) {
    const why = (reason) => (reason === 'interrupted' ? 'its start was interrupted' : 'boss workspace is gone');
    return `Archived ${archived.map((a) => `${a.name}: ${why(a.reason)}`).join('; ')}`;
  }

  // Which helper an agent in a boss room is, by the folder it runs in (herdr
  // drops the agent name when the process is replaced; the folder stays).
  // o.folder is the boss's folder; the QA reviewer, ops agent and Slack watcher
  // sit in its qa/, ops/ and slack/ subfolders. Anything else there is taken for the reviewer.
  function helperRole(desk, o) {
    const cwd = String(desk.cwd || '');
    const inside = (sub) => !!o.folder && (cwd === `${o.folder}/${sub}` || cwd.startsWith(`${o.folder}/${sub}/`));
    if (inside('ops') || desk.agentName === `${o.slug}-ops`) return 'ops';
    if (inside('slack') || desk.agentName === `${o.slug}-slack`) return 'slack';
    return 'qa';
  }

  // The specialist desks every boss room has, so the user sees the team:
  // one per role nobody sits at yet. Clicking one asks the boss to start it
  // (the Slack desk opens the Slack dialog instead: the office starts that one).
  const SEATS = {
    qa: { title: 'QA', about: 'Reads the diff in every worktree and reviews it before you open the PR.' },
    ops: { title: 'Ops', about: 'Watches CI and prod after a deploy and raises the alarm when something breaks.' },
    slack: { title: 'Slack', about: 'Keeps an eye on the Slack threads and channels you give it and tells you when someone is waiting for your answer.' },
  };
  function seatsFor(desks, o) {
    const taken = new Set(desks.filter((d) => d.role in SEATS).map((d) => d.role));
    return Object.keys(SEATS).filter((role) => !taken.has(role)).map((role) => ({
      id: `seat:${o.slug}:${role}`, seat: true, kind: 'seat', role, pose: 'empty', character: null,
      title: SEATS[role].title, about: SEATS[role].about, orch: { slug: o.slug, color: o.color, name: o.name }, seq: 0,
    }));
  }

  // Alerts the office shows: open and not dismissed, across every
  // orchestrator, newest first. key: stable per alert file.
  function activeAlerts(orchestrators) {
    const out = [];
    for (const o of orchestrators || []) {
      for (const a of o.alerts || []) {
        if (String(a.status || 'open').toLowerCase() !== 'open' || String(a.dismissed || '').toLowerCase() === 'true') continue;
        out.push({ ...a, key: `${o.slug}/${a.file}`, slug: o.slug, orchName: o.name, color: o.color, title: a.title || a.text?.split('\n')[0] || 'Alert' });
      }
    }
    return out.sort((x, y) => y.at - x.at);
  }

  // Keys in active that are not in seen: the alerts to play the sound for.
  function newAlertKeys(seen, active) { return active.map((a) => a.key).filter((k) => !seen.has(k)); }

  // Alerts that were active last time and are now resolved by the ops agent
  // (not dismissed by the user): the office says they recovered.
  function recoveredAlerts(previous, orchestrators) {
    const now = new Map();
    for (const o of orchestrators || []) for (const a of o.alerts || []) now.set(`${o.slug}/${a.file}`, a);
    return [...previous.values()].filter((p) => String(now.get(p.key)?.status || '').toLowerCase() === 'resolved');
  }

  // Slack messages the watcher found waiting on the user: open and not
  // dismissed, newest first. found: when the watcher wrote it (file time if missing).
  const foundAt = (m) => Date.parse(m.found || '') || m.at || 0;
  function slackWaiting(o) {
    return (o.slack?.waiting || [])
      .filter((m) => String(m.status || 'open').toLowerCase() === 'open' && String(m.dismissed || '').toLowerCase() !== 'true')
      .sort((a, b) => foundAt(b) - foundAt(a));
  }

  // The reception ticket for an orchestrator's waiting Slack messages, or null.
  // state: 'new' (something came in since the user last opened the Slack
  // dialog), 'reminder' (still waiting a day after that) or 'quiet'.
  const DAY_MS = 24 * 3600_000;
  function slackTicket(o, now = Date.now()) {
    const waiting = slackWaiting(o);
    if (!waiting.length) return null;
    const seen = Date.parse(o.slack?.seen_at || '') || 0;
    const state = waiting.some((m) => foundAt(m) > seen) ? 'new' : now - seen >= DAY_MS ? 'reminder' : 'quiet';
    return { state, count: waiting.length, newest: waiting[0] };
  }

  // The orchestrator a checkout belongs to, by its branch: the orchestrator's
  // branch, `<branch>--<variant>` for another worktree in the same repo (git
  // allows one worktree per branch), such as two alternative implementations,
  // or a branch it claimed (o.branches, see orchestratorForRoom).
  function orchestratorForBranch(branch, orchestrators) {
    if (!branch) return null;
    return (orchestrators || []).find((o) => (o.branch && (branch === o.branch || branch.startsWith(`${o.branch}--`))) || (o.branches || []).includes(branch)) || null;
  }

  // The orchestrator a room belongs to: by branch, else by one of its workers
  // at a desk there (named `<slug>-<repo>`, see workerName). That is a
  // sub-ticket's worktree, on the branch its ticket got: claim: true asks the
  // caller to save the branch, so the room stays after the worker leaves.
  function orchestratorForRoom(room, orchestrators) {
    const byBranch = orchestratorForBranch(room.branch, orchestrators);
    if (byBranch || !room.branch) return { o: byBranch, claim: false };
    const names = room.desks.filter((d) => d.kind === 'agent' && d.agentName).map((d) => d.agentName);
    // Longest slug first: "abc-1485-api" is abc-1485's worker, not abc's.
    const bySlug = [...(orchestrators || [])].sort((a, b) => b.slug.length - a.slug.length);
    const mine = (o, n) => n.startsWith(`${o.slug}-`) || Object.values(o.workerNames || {}).some((w) => n === w || n.startsWith(`${w}-`));
    const o = bySlug.find((x) => names.some((n) => mine(x, n)));
    return o ? { o, claim: true } : { o: null, claim: false };
  }

  // Whether an inbox message is from the worker at this desk. With two workers
  // in one repo only the agent name tells them apart; herdr can drop the name,
  // and then any worker of the repo (`<expected>` or `<expected>-…`) counts.
  function fromWorker(from, desk, expected) {
    if (!from) return false;
    if (desk.agentName) return from === desk.agentName;
    return !!expected && (from === expected || from.startsWith(`${expected}-`));
  }

  // How many things of an orchestrator wait on the user: the boss's
  // questions, stuck workers and new Slack messages.
  function waitingCount(o, desks, now = Date.now()) {
    const slack = slackTicket(o, now);
    return (o.board?.questions?.length || 0) + desks.filter((d) => d.pose === 'blocked' && !d.escalated).length + (slack && slack.state !== 'quiet' ? slack.count : 0);
  }

  // An orchestrator's card in the top bar. desks: the orchestrator's desks.
  // state: what the team is doing (working / idle / done); done/total: the
  // board's tasks. flag: what waits on the user (the boss's questions, stuck
  // workers, new Slack messages), else an open deploy alert, else null.
  function ticketCard(o, desks, now = Date.now()) {
    const tasks = o.board?.tasks || [];
    const done = tasks.filter((t) => t.done).length, total = tasks.length;
    const state = desks.some((d) => d.pose === 'working') ? 'working' : total && done === total ? 'done' : 'idle';
    const questions = o.board?.questions?.length || 0;
    const waiting = waitingCount(o, desks, now);
    let flag = null;
    if (waiting) flag = { kind: 'waiting', text: waiting === questions ? `${waiting} ${waiting === 1 ? 'question' : 'questions'} for you` : `${waiting} waiting on you` };
    else if (activeAlerts([o]).length) flag = { kind: 'alert', text: '⚠ deploy alert' };
    return { state, done, total, flag };
  }

  // Tickets whose tasks were not all done last time and are now. seen: slug
  // -> whether it was done; a ticket seen for the first time is never new.
  function justFinished(seen, orchestrators) {
    const next = new Map(), slugs = [];
    for (const o of orchestrators || []) {
      const tasks = o.board?.tasks || [];
      const done = tasks.length > 0 && tasks.every((t) => t.done);
      if (done && seen.get(o.slug) === false) slugs.push(o.slug);
      next.set(o.slug, done);
    }
    return { slugs, seen: next };
  }

  const api = { justFinished, ticketCard, waitingCount, officeFloors, orchestratorFloors, needsAttention, workerPose, archivedNotice, orchestratorForBranch, orchestratorForRoom, fromWorker, helperRole, seatsFor, activeAlerts, newAlertKeys, recoveredAlerts, slackWaiting, slackTicket, SEATS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.officeView = api;
})();
