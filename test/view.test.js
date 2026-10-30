// Which desks a tab shows and who is waiting for the user. The Office tab is
// only for agents no orchestrator owns; reception sees every tab; a finished
// worker reports to its boss, not to the user.
const test = require('node:test');
const assert = require('node:assert');
const { officeFloors, orchestratorFloors, needsAttention, workerPose, archivedNotice } = require('../renderer/view');

const desk = (id, pose, extra = {}) => ({ id, pose, seq: 0, ...extra });
const orch = { slug: 'fix', color: '#fc3', name: 'Fix proxy' };
const model = () => [
  { name: 'Fix proxy', isBoss: true, orchestrator: orch, rooms: [{ id: 'b', isBoss: true, desks: [desk('boss', 'done', { role: 'boss', orch })] }] },
  { name: 'infra', rooms: [
    { id: 'i1', desks: [desk('patrik', 'idle')] },
    { id: 'i2', orch, desks: [desk('linnea', 'done', { role: 'worker', orch })] },
  ] },
  { name: 'subs', rooms: [{ id: 's1', orch, desks: [desk('jonas', 'blocked', { role: 'worker', orch })] }] },
];

test('Office tab hides boss floors and orchestrator rooms, keeps the repo', () => {
  const view = officeFloors(model());
  assert.deepStrictEqual(view.map((f) => f.name), ['infra', 'subs']);
  assert.deepStrictEqual(view[0].rooms.map((r) => r.id), ['i1']);
  assert.deepStrictEqual(view[1].rooms, []);
});

test('an orchestrator tab shows its rooms and its boss floor last', () => {
  const view = orchestratorFloors(model(), 'fix');
  assert.deepStrictEqual(view.map((f) => f.name), ['infra', 'subs', 'Fix proxy']);
  assert.deepStrictEqual(view[0].rooms.map((r) => r.id), ['i2']);
});

test('reception lists blocked and done desks from every tab, blocked first', () => {
  const ids = needsAttention(model()).map((d) => d.id);
  assert.deepStrictEqual(ids, ['jonas', 'boss', 'linnea']);
});

test('a boss with a relayed question is not double-listed', () => {
  const m = model(); m[0].rooms[0].desks[0].pose = 'blocked'; m[0].rooms[0].desks[0].escalated = true;
  assert.ok(!needsAttention(m).some((d) => d.id === 'boss'));
});

test('a finished worker sits idle; a blocked worker still needs the user', () => {
  assert.strictEqual(workerPose('done'), 'idle');
  assert.strictEqual(workerPose('blocked'), 'blocked');
  assert.strictEqual(workerPose('working'), 'working');
});

test('the archive notice gives each orchestrator its own reason', () => {
  assert.strictEqual(archivedNotice([{ name: 'Fix proxy', reason: 'boss workspace gone' }]), 'Archived Fix proxy: boss workspace is gone');
  assert.strictEqual(archivedNotice([{ name: 'A', reason: 'boss workspace gone' }, { name: 'B', reason: 'interrupted' }]),
    'Archived A: boss workspace is gone; B: its start was interrupted');
});

// ---- QA / Ops desks and alerts ----
const { helperRole, seatsFor, activeAlerts, newAlertKeys, recoveredAlerts } = require('../renderer/view');
const boss = { slug: 'fix', color: '#fc3', name: 'Fix proxy', folder: '/data/orchestrators/fix' };

test('helperRole() tells the ops agent from the QA reviewer by folder, then by name', () => {
  assert.strictEqual(helperRole({ cwd: '/data/orchestrators/fix/ops' }, boss), 'ops');
  assert.strictEqual(helperRole({ cwd: '/data/orchestrators/fix/qa' }, boss), 'qa');
  assert.strictEqual(helperRole({ cwd: '/elsewhere', agentName: 'fix-ops' }, boss), 'ops');
  assert.strictEqual(helperRole({ cwd: '/data/orchestrators/fix/opsx' }, boss), 'qa');
  assert.strictEqual(helperRole({ cwd: '/data/orchestrators/fix/slack' }, boss), 'slack');
  assert.strictEqual(helperRole({ cwd: '/elsewhere', agentName: 'fix-slack' }, boss), 'slack');
});

test('seatsFor() gives the boss room a QA and an Ops desk until someone sits there', () => {
  assert.deepStrictEqual(seatsFor([{ role: 'boss' }], boss).map((d) => [d.id, d.role, d.pose, d.seat]), [['seat:fix:qa', 'qa', 'empty', true], ['seat:fix:ops', 'ops', 'empty', true], ['seat:fix:slack', 'slack', 'empty', true]]);
  assert.deepStrictEqual(seatsFor([{ role: 'boss' }, { role: 'ops' }, { role: 'slack' }], boss).map((d) => d.role), ['qa']);
});

test('activeAlerts() keeps open, undismissed alerts, newest first', () => {
  const list = [{ ...boss, alerts: [
    { file: 'a.md', status: 'open', title: 'old', at: 1 },
    { file: 'b.md', status: 'open', title: 'new', at: 2 },
    { file: 'c.md', status: 'resolved', title: 'gone', at: 3 },
    { file: 'd.md', status: 'open', dismissed: 'true', title: 'hidden', at: 4 },
  ] }];
  assert.deepStrictEqual(activeAlerts(list).map((a) => [a.key, a.title]), [['fix/b.md', 'new'], ['fix/a.md', 'old']]);
  assert.deepStrictEqual(activeAlerts([{ ...boss }]), []);
});

test('newAlertKeys() and recoveredAlerts() drive the sound and the recovered notice', () => {
  const active = activeAlerts([{ ...boss, alerts: [{ file: 'a.md', status: 'open', at: 1 }, { file: 'b.md', status: 'open', at: 2 }] }]);
  assert.deepStrictEqual(newAlertKeys(new Set(['fix/a.md']), active), ['fix/b.md']);
  const previous = new Map(active.map((a) => [a.key, a]));
  const later = [{ ...boss, alerts: [{ file: 'a.md', status: 'resolved' }, { file: 'b.md', status: 'open', dismissed: 'true' }] }];
  assert.deepStrictEqual(recoveredAlerts(previous, later).map((a) => a.key), ['fix/a.md']);
});

// ---- several worktrees of one repo in an orchestrator ----
const { orchestratorForBranch, fromWorker } = require('../renderer/view');

test('orchestratorForBranch() claims the branch and its --variant branches only', () => {
  const list = [{ slug: 'fix', branch: 'mia/abc-1-fix' }, { slug: 'other', branch: 'mia/abc-1-fix-more' }];
  assert.strictEqual(orchestratorForBranch('mia/abc-1-fix', list).slug, 'fix');
  assert.strictEqual(orchestratorForBranch('mia/abc-1-fix--a', list).slug, 'fix');
  assert.strictEqual(orchestratorForBranch('mia/abc-1-fix--zustand', list).slug, 'fix');
  assert.strictEqual(orchestratorForBranch('mia/abc-1-fix-more', list).slug, 'other');
  assert.strictEqual(orchestratorForBranch('mia/abc-1-fixed', list), null);
  assert.strictEqual(orchestratorForBranch(null, list), null);
});

test('fromWorker() tells two workers in one repo apart by agent name', () => {
  assert.strictEqual(fromWorker('fix-web-a', { agentName: 'fix-web-a' }, 'fix-web'), true);
  assert.strictEqual(fromWorker('fix-web-b', { agentName: 'fix-web-a' }, 'fix-web'), false);
  // herdr dropped the name: any worker of the repo counts, as before
  assert.strictEqual(fromWorker('fix-web-b', { agentName: null }, 'fix-web'), true);
  assert.strictEqual(fromWorker('fix-api', { agentName: null }, 'fix-web'), false);
});

// ---- Slack watcher ----
const { slackWaiting, slackTicket } = require('../renderer/view');
const DAY = 24 * 3600_000;
const T = Date.parse('2026-10-28T12:00:00Z');
const msg = (file, found, extra = {}) => ({ file, status: 'open', title: file, found, at: 0, ...extra });

test('slackWaiting() keeps open, undismissed messages, newest first', () => {
  const o = { ...boss, slack: { waiting: [
    msg('a.md', '2026-10-28T10:00:00Z'),
    msg('b.md', '2026-10-28T11:00:00Z'),
    msg('c.md', '2026-10-28T11:30:00Z', { status: 'answered' }),
    msg('d.md', '2026-10-28T11:40:00Z', { dismissed: 'true' }),
  ] } };
  assert.deepStrictEqual(slackWaiting(o).map((m) => m.file), ['b.md', 'a.md']);
  assert.deepStrictEqual(slackWaiting({ ...boss }), []);
});

test('slackTicket(): new until the user looks, quiet after, and back once a day', () => {
  const waiting = [msg('a.md', '2026-10-28T10:00:00Z'), msg('b.md', '2026-10-28T11:00:00Z')];
  assert.strictEqual(slackTicket({ ...boss, slack: { waiting: [] } }, T), null);
  // never looked
  assert.deepStrictEqual(slackTicket({ ...boss, slack: { waiting } }, T), { state: 'new', count: 2, newest: waiting[1] });
  // looked after both arrived
  assert.strictEqual(slackTicket({ ...boss, slack: { waiting, seen_at: '2026-10-28T11:30:00Z' } }, T).state, 'quiet');
  // one arrived after the user looked
  assert.strictEqual(slackTicket({ ...boss, slack: { waiting, seen_at: '2026-10-28T10:30:00Z' } }, T).state, 'new');
  // still waiting a day after the user last looked
  assert.strictEqual(slackTicket({ ...boss, slack: { waiting, seen_at: '2026-10-28T11:30:00Z' } }, T + DAY).state, 'reminder');
  // no found: the file time counts
  assert.strictEqual(slackTicket({ ...boss, slack: { waiting: [{ file: 'x.md', status: 'open', at: T - 1000 }], seen_at: new Date(T - 5000).toISOString() } }, T).state, 'new');
});

// ---- ticket cards in the top bar ----
const { ticketCard } = require('../renderer/view');
const tasks = (done, open) => [...Array(done).fill({ done: true }), ...Array(open).fill({ done: false })];

test('ticketCard(): the pill says what the team is doing, the count is the board', () => {
  const working = [{ pose: 'idle' }, { pose: 'working' }];
  assert.deepStrictEqual(ticketCard({ ...boss, board: { tasks: tasks(3, 2) } }, working, T), { state: 'working', done: 3, total: 5, flag: null });
  assert.strictEqual(ticketCard({ ...boss, board: { tasks: tasks(1, 2) } }, [{ pose: 'idle' }], T).state, 'idle');
  // every task ticked off and nobody working: done
  assert.strictEqual(ticketCard({ ...boss, board: { tasks: tasks(4, 0) } }, [{ pose: 'done' }], T).state, 'done');
  // no board yet
  assert.deepStrictEqual(ticketCard({ ...boss }, [], T), { state: 'idle', done: 0, total: 0, flag: null });
});

test('ticketCard(): the flag says what waits on the user, alerts after that', () => {
  const q = (n) => ({ ...boss, board: { tasks: [], questions: Array(n).fill('?') } });
  assert.deepStrictEqual(ticketCard(q(1), [], T).flag, { kind: 'waiting', text: '1 question for you' });
  assert.deepStrictEqual(ticketCard(q(2), [], T).flag, { kind: 'waiting', text: '2 questions for you' });
  // a stuck worker is not a question: the wider wording, counting both
  assert.deepStrictEqual(ticketCard(q(1), [{ pose: 'blocked' }], T).flag, { kind: 'waiting', text: '2 waiting on you' });
  // a boss relaying a question is counted once, from the board
  assert.deepStrictEqual(ticketCard(q(1), [{ pose: 'blocked', escalated: true }], T).flag, { kind: 'waiting', text: '1 question for you' });
  // new Slack messages wait on the user too; quiet ones do not
  const slack = { waiting: [msg('a.md', '2026-10-28T10:00:00Z')] };
  assert.deepStrictEqual(ticketCard({ ...boss, slack }, [], T).flag, { kind: 'waiting', text: '1 waiting on you' });
  assert.strictEqual(ticketCard({ ...boss, slack: { ...slack, seen_at: '2026-10-28T11:00:00Z' } }, [], T).flag, null);
  // an open alert, with nothing waiting
  const alerts = [{ file: 'a.md', status: 'open', at: 1 }];
  assert.deepStrictEqual(ticketCard({ ...boss, alerts }, [], T).flag, { kind: 'alert', text: '⚠ deploy alert' });
  assert.strictEqual(ticketCard({ ...q(1), alerts }, [], T).flag.kind, 'waiting');
});

// ---- sub-tickets: a worktree on its own branch, worked by the boss's worker ----
const { orchestratorForRoom } = require('../renderer/view');

test('orchestratorForRoom(): a claimed branch, or the boss\'s worker at a desk there', () => {
  const parent = { slug: 'abc-1485', branch: 'mia/abc-1485-parent', workerNames: { 'web-app': 'abc-1485-web-app' }, branches: ['mia/abc-1490-old'] };
  const other = { slug: 'abc', branch: 'mia/abc' };
  const list = [other, parent];
  const room = (branch, ...names) => ({ branch, desks: names.map((n) => ({ kind: 'agent', agentName: n })) });
  // its own branch, as before: nothing to claim
  assert.deepStrictEqual(orchestratorForRoom(room('mia/abc-1485-parent'), list), { o: parent, claim: false });
  // a branch it claimed earlier, with nobody there now
  assert.deepStrictEqual(orchestratorForRoom(room('mia/abc-1490-old'), list), { o: parent, claim: false });
  // a sub-ticket's branch with the boss's worker in it: claim it
  assert.deepStrictEqual(orchestratorForRoom(room('mia/abc-1491-sub', 'abc-1485-web-app'), list), { o: parent, claim: true });
  assert.deepStrictEqual(orchestratorForRoom(room('mia/abc-1491-sub', 'abc-1485-web-app-2'), list), { o: parent, claim: true });
  // the longest slug wins: abc-1485-… is not the "abc" orchestrator's
  assert.strictEqual(orchestratorForRoom(room('mia/x', 'abc-1485-api'), list).o, parent);
  assert.strictEqual(orchestratorForRoom(room('mia/x', 'abc-api'), list).o, other);
  // nobody's
  assert.deepStrictEqual(orchestratorForRoom(room('main', 'patrik'), list), { o: null, claim: false });
  assert.deepStrictEqual(orchestratorForRoom(room(null, 'abc-1485-web-app'), list), { o: null, claim: false });
});

// ---- PiPi celebrates a ticket whose tasks were just all done ----
const { justFinished } = require('../renderer/view');

test('justFinished(): tickets whose last task got ticked off since last time, not ones already done', () => {
  const o = (slug, done, open) => ({ slug, board: { tasks: [...Array(done).fill({ done: true }), ...Array(open).fill({ done: false })] } });
  let seen = new Map();
  // first look: nothing is new, even a ticket that is done already
  let r = justFinished(seen, [o('a', 2, 1), o('b', 3, 0)]);
  assert.deepStrictEqual(r.slugs, []);
  seen = r.seen;
  r = justFinished(seen, [o('a', 3, 0), o('b', 3, 0), o('c', 1, 0)]);
  assert.deepStrictEqual(r.slugs, ['a']); // c is new, b was done already
  r = justFinished(r.seen, [o('a', 3, 0)]);
  assert.deepStrictEqual(r.slugs, []);
  // a ticket with no tasks is never done
  assert.deepStrictEqual(justFinished(new Map([['d', false]]), [o('d', 0, 0)]).slugs, []);
});
