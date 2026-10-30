// The Slack watcher: the watch list both the office and the boss write, and
// the timer that tells the watcher agent when to check.
const test = require('node:test');
const assert = require('node:assert');
const { parseWatches, watchFromInput, addWatchLine, removeWatchLine, slackDue, findSlackAgent, runSlack } = require('../slack');

// ---- the watch list ----

test('parseWatches() reads kind, target and note, and skips anything else', () => {
  const raw = [
    '# Watches',
    '- thread https://example.slack.com/archives/C0123/p1729680000123 — ABC-1732 discount pricing',
    '- channel #checkout-redesign',
    '* dm @patrik - reviews',
    '- folder /tmp',
    'some prose',
  ].join('\n');
  assert.deepStrictEqual(parseWatches(raw), [
    { kind: 'thread', target: 'https://example.slack.com/archives/C0123/p1729680000123', note: 'ABC-1732 discount pricing' },
    { kind: 'channel', target: '#checkout-redesign', note: '' },
    { kind: 'dm', target: '@patrik', note: 'reviews' },
  ]);
  assert.deepStrictEqual(parseWatches(''), []);
});

test('watchFromInput() knows thread, channel and DM links, #channel and @name', () => {
  const cases = [
    ['https://example.slack.com/archives/C0123ABC/p1729680000123456', { kind: 'thread', target: 'https://example.slack.com/archives/C0123ABC/p1729680000123456' }],
    // a reply's link points into its thread; the query is kept, Slack needs it to open the reply
    ['https://example.slack.com/archives/C0123ABC/p1729680000999999?thread_ts=1729680000.123456&cid=C0123ABC', { kind: 'thread', target: 'https://example.slack.com/archives/C0123ABC/p1729680000999999?thread_ts=1729680000.123456&cid=C0123ABC' }],
    ['https://example.slack.com/archives/C0123ABC', { kind: 'channel', target: 'https://example.slack.com/archives/C0123ABC' }],
    ['https://example.slack.com/archives/D0456/p1729680000123456', { kind: 'thread', target: 'https://example.slack.com/archives/D0456/p1729680000123456' }],
    ['https://example.slack.com/archives/D0456', { kind: 'dm', target: 'https://example.slack.com/archives/D0456' }],
    ['  #Checkout-Redesign ', { kind: 'channel', target: '#checkout-redesign' }],
    ['@patrik.l', { kind: 'dm', target: '@patrik.l' }],
  ];
  for (const [input, want] of cases) assert.deepStrictEqual(watchFromInput(input), want, input);
});

test('watchFromInput() refuses what it cannot watch', () => {
  for (const bad of ['', 'checkout', 'https://example.com/archives/C1', 'https://example.slack.com/team/U1', '#', '@', '#a b', 'javascript:alert(1)']) {
    assert.strictEqual(watchFromInput(bad), null, JSON.stringify(bad));
  }
});

test('addWatchLine() appends once and keeps the rest of the file as written', () => {
  const raw = '- channel #a — ours\n\n- dm @b\n';
  const once = addWatchLine(raw, { kind: 'thread', target: 'https://example.slack.com/archives/C1/p1', note: '' });
  assert.strictEqual(once, '- channel #a — ours\n\n- dm @b\n- thread https://example.slack.com/archives/C1/p1\n');
  assert.strictEqual(addWatchLine(once, { kind: 'channel', target: '#a', note: 'again' }), once);
  assert.strictEqual(addWatchLine('', { kind: 'channel', target: '#c', note: 'Checkout' }), '- channel #c — Checkout\n');
  assert.strictEqual(addWatchLine('- dm @b', { kind: 'channel', target: '#c', note: '' }), '- dm @b\n- channel #c\n');
});

test('removeWatchLine() drops only that target', () => {
  const raw = '# mine\n- channel #a — ours\n- dm @b\n- channel #ab\n';
  assert.strictEqual(removeWatchLine(raw, '#a'), '# mine\n- dm @b\n- channel #ab\n');
  assert.strictEqual(removeWatchLine(raw, '#zzz'), raw);
});

// ---- when to check ----

const MIN = 60_000;
const now = 1_800_000_000_000;
const base = { watches: 1, slack: { interval: 10 }, now };
const idle = { pane_id: 'wB:p3', status: 'idle' };

test('slackDue(): nothing to do without watches', () => {
  assert.strictEqual(slackDue({ ...base, watches: 0, agent: idle }), 'none');
  assert.strictEqual(slackDue({ ...base, watches: 0, agent: null }), 'none');
});

test('slackDue(): starts the watcher when there is none, but not again while it boots', () => {
  assert.strictEqual(slackDue({ ...base, agent: null }), 'start');
  assert.strictEqual(slackDue({ ...base, slack: { interval: 10, started_at: now - 30_000 }, agent: null }), 'none');
  assert.strictEqual(slackDue({ ...base, slack: { interval: 10, started_at: now - 3 * MIN }, agent: null }), 'start');
});

test('slackDue(): an idle watcher is cleared first, then checked', () => {
  // never checked: due at once
  assert.strictEqual(slackDue({ ...base, agent: idle }), 'clear');
  // cleared a moment ago: give /clear time to land
  assert.strictEqual(slackDue({ ...base, slack: { interval: 10, phase: 'cleared', cleared_at: now - 500 }, agent: idle }), 'none');
  assert.strictEqual(slackDue({ ...base, slack: { interval: 10, phase: 'cleared', cleared_at: now - 3000 }, agent: idle }), 'check');
});

test('slackDue(): waits out the interval, which the user sets', () => {
  assert.strictEqual(slackDue({ ...base, slack: { interval: 10, last_tick: now - 9 * MIN }, agent: idle }), 'none');
  assert.strictEqual(slackDue({ ...base, slack: { interval: 10, last_tick: now - 10 * MIN }, agent: idle }), 'clear');
  assert.strictEqual(slackDue({ ...base, slack: { interval: 5, last_tick: now - 6 * MIN }, agent: idle }), 'clear');
  // no interval saved: 10 minutes
  assert.strictEqual(slackDue({ ...base, slack: { last_tick: now - 9 * MIN }, agent: idle }), 'none');
});

test('slackDue(): leaves a working or blocked watcher alone', () => {
  for (const status of ['working', 'blocked', 'unknown']) {
    assert.strictEqual(slackDue({ ...base, agent: { ...idle, status } }), 'none', status);
    assert.strictEqual(slackDue({ ...base, slack: { interval: 10, phase: 'cleared', cleared_at: now - 3000 }, agent: { ...idle, status } }), 'none', status);
  }
  // done counts as idle
  assert.strictEqual(slackDue({ ...base, agent: { ...idle, status: 'done' } }), 'clear');
});

test('findSlackAgent() finds the watcher by its folder, or by name', () => {
  const folder = '/o/x/slack';
  const snap = { agents: [
    { pane_id: 'a', cwd: '/o/x', agent_status: 'idle' },
    { pane_id: 'b', cwd: '/o/x/slackish', agent_status: 'idle' },
    { pane_id: 'c', cwd: '/elsewhere', foreground_cwd: folder, agent_status: 'working' },
  ] };
  assert.deepStrictEqual(findSlackAgent(snap, folder, 'x-slack'), { pane_id: 'c', status: 'working' });
  assert.deepStrictEqual(findSlackAgent({ agents: [{ pane_id: 'd', cwd: '/z', name: 'x-slack', agent_status: 'idle' }] }, folder, 'x-slack'), { pane_id: 'd', status: 'idle' });
  assert.strictEqual(findSlackAgent({ agents: [] }, folder, 'x-slack'), null);
});

// ---- the runner ----

function fakeStore(orchs) {
  const ticks = [];
  return {
    ticks,
    list: () => orchs,
    slackFolder: (slug) => `/o/${slug}/slack`,
    slackTick: (slug, fields) => { ticks.push({ slug, ...fields }); Object.assign(orchs.find((o) => o.slug === slug).slack, fields); },
    startAgent: async (pane, name) => name,
    prepared: [],
    prepareSlack(slug) { this.prepared.push(slug); },
  };
}
function fakeClient() {
  const calls = [];
  return { calls, request: async (method, params) => { calls.push({ method, params }); return method === 'tab.create' ? { root_pane: { pane_id: 'wB:p9' } } : {}; } };
}
const orch = (slack, watches = [{ kind: 'channel', target: '#a', note: '' }]) => ({ slug: 'x', status: 'running', boss: { workspace_id: 'wB', status: 'started' }, slack: { watches, ...slack } });

test('runSlack() clears an idle watcher by typing /clear, then prompts the check', async () => {
  const o = orch({ interval: 10 });
  const store = fakeStore([o]); const client = fakeClient();
  const snap = { agents: [{ pane_id: 'wB:p3', cwd: '/o/x/slack', agent_status: 'idle' }] };
  await runSlack({ store, client, snapshot: snap, now });
  assert.deepStrictEqual(client.calls.map((c) => [c.method, c.params]), [
    ['pane.send_text', { pane_id: 'wB:p3', text: '/clear' }],
    ['pane.send_keys', { pane_id: 'wB:p3', keys: ['enter'] }],
  ]);
  assert.strictEqual(o.slack.phase, 'cleared');
  assert.strictEqual(o.slack.last_tick, now);
  await runSlack({ store, client, snapshot: snap, now: now + 3000 });
  assert.strictEqual(client.calls[2].method, 'agent.prompt');
  assert.strictEqual(client.calls[2].params.target, 'wB:p3');
  assert.match(client.calls[2].params.text, /check/i);
  assert.strictEqual(o.slack.phase, null);
  // and then nothing until the interval is over
  await runSlack({ store, client, snapshot: snap, now: now + 6000 });
  assert.strictEqual(client.calls.length, 3);
});

test('runSlack() opens a tab in the boss workspace in the slack folder and starts the watcher', async () => {
  const o = orch({ interval: 10 });
  const store = fakeStore([o]); const client = fakeClient();
  const started = [];
  store.startAgent = async (pane, name) => { started.push([pane, name]); return name; };
  await runSlack({ store, client, snapshot: { agents: [] }, now });
  assert.deepStrictEqual(client.calls[0], { method: 'tab.create', params: { workspace_id: 'wB', cwd: '/o/x/slack', label: 'slack', focus: false } });
  assert.deepStrictEqual(store.prepared, ['x']); // brief, permissions and trust before Claude starts there
  assert.deepStrictEqual(started, [['wB:p9', 'x-slack']]);
  assert.strictEqual(o.slack.started_at, now);
});

test('runSlack() skips orchestrators that are not running or have no watches', async () => {
  const store = fakeStore([orch({}, []), { ...orch({}), status: 'creating' }, { ...orch({}), boss: { status: 'not_started' } }]);
  const client = fakeClient();
  await runSlack({ store, client, snapshot: { agents: [] }, now });
  assert.deepStrictEqual(client.calls, []);
});

test('runSlack() does not overlap with itself for one orchestrator', async () => {
  const o = orch({ interval: 10 });
  const store = fakeStore([o]); const client = fakeClient();
  let release; const gate = new Promise((r) => { release = r; });
  store.startAgent = async (pane, name) => { await gate; return name; };
  const first = runSlack({ store, client, snapshot: { agents: [] }, now });
  await runSlack({ store, client, snapshot: { agents: [] }, now: now + 200_000 });
  release(); await first;
  assert.strictEqual(client.calls.filter((c) => c.method === 'tab.create').length, 1);
});
