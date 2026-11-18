// Plan limits: reading Claude's /usage text and Codex's app-server answer,
// the reset times in them, and the monitor that polls both. No real CLI and
// no network: the CLIs are stubs and the clock is fixed.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  UsageMonitor, readClaude, readCodex, codexRpc, parseClaudeUsage, parseReset, claudeResult, claudeSignInNote,
  parseCodexLimits, codexResult, cleanInterval, run, KILL_NOW, CLAUDE_ARGS, CODEX_ARGS,
} = require('../usage');

// Wed Nov 18 2026, 11:23 in Stockholm (CET, UTC+1).
const NOW = Date.UTC(2026, 10, 18, 10, 23);
const MIN = 60_000;

// What `claude -p /usage` prints, trimmed.
const USAGE_TEXT = `You are currently using your subscription to power your Claude Code usage

Current session: 10% used · resets Nov 18 at 1:30pm (Europe/Stockholm)
Current week (all models): 9% used · resets Nov 24 at 6am (Europe/Stockholm)
Current week (Fable): 0% used · resets Nov 24 at 6am (Europe/Stockholm)

What's contributing to your usage?
Approximate · sessions on this machine only · shares overlap

Last 24h · 1017 requests · 17 sessions
  72%  Start fresh when you switch tasks · run /clear`;

test('Claude /usage text: session, week and the per-model week, tips left out', () => {
  const w = parseClaudeUsage(USAGE_TEXT, NOW);
  assert.deepStrictEqual(w.map((x) => [x.id, x.label, x.short, x.usedPercent]), [
    ['session', 'Session', '5h', 10],
    ['week', 'Week', 'wk', 9],
    ['week:fable', 'Week Fable', 'wk Fable', 0],
  ]);
  assert.strictEqual(w[0].resetsAt, Date.UTC(2026, 10, 18, 12, 30));
  assert.strictEqual(w[1].resetsAt, Date.UTC(2026, 10, 24, 5, 0));
});

test('Claude /usage text: "% left", "only" models and a label on its own line', () => {
  const text = 'Current session\n  85% left · resets 3pm (Europe/Stockholm)\nCurrent week (Sonnet only): 40.5% used · resets Nov 20 at 9:15am (Europe/Stockholm)';
  const w = parseClaudeUsage(text, NOW);
  assert.deepStrictEqual(w.map((x) => [x.id, x.label, x.usedPercent]), [['session', 'Session', 15], ['week:sonnet', 'Week Sonnet', 40.5]]);
  assert.strictEqual(w[0].resetsAt, Date.UTC(2026, 10, 18, 14, 0));
  assert.strictEqual(w[1].resetsAt, Date.UTC(2026, 10, 20, 8, 15));
});

test('Claude /usage text: a block ends at a blank line, so a later section lends it nothing', () => {
  const text = 'Current session: 10% used · resets 3pm (Europe/Stockholm)\nCurrent week (all models)\n\nExtra usage: 50% of credits · resets Dec 1 at 9am (UTC)';
  const w = parseClaudeUsage(text, NOW);
  assert.deepStrictEqual(w.map((x) => x.id), ['session'], 'a week with no percentage of its own is no window');
  const text2 = 'Current week (all models): 0% used\n\nExtra usage resets Dec 1 at 9am (UTC)';
  assert.strictEqual(parseClaudeUsage(text2, NOW)[0].resetsAt, null);
});

test('Claude /usage text without limits gives no windows, not zeros', () => {
  assert.deepStrictEqual(parseClaudeUsage('Estimated cost:        $0.0000\nUsage:                 0 input, 0 output', NOW), []);
  assert.deepStrictEqual(parseClaudeUsage('', NOW), []);
});

test('reset times: undated ones roll to tomorrow once passed, January ones to next year', () => {
  // 6am Stockholm today has passed at 11:23: tomorrow's.
  assert.strictEqual(parseReset('resets 6am (Europe/Stockholm)', NOW), Date.UTC(2026, 10, 19, 5, 0));
  assert.strictEqual(parseReset('resets 12:00pm (UTC)', NOW), Date.UTC(2026, 10, 18, 12, 0));
  assert.strictEqual(parseReset('resets 12am (UTC)', NOW), Date.UTC(2026, 10, 19, 0, 0));
  const dec30 = Date.UTC(2026, 11, 30, 12);
  assert.strictEqual(parseReset('resets Jan 2 at 9am (UTC)', dec30), Date.UTC(2027, 0, 2, 9, 0));
  assert.strictEqual(parseReset('resets Jan 2, 2027 at 9am (UTC)', dec30), Date.UTC(2027, 0, 2, 9, 0));
});

test('reset times follow the zone across daylight saving', () => {
  // Summer time (UTC+2) starts Mar 29 2026, ends Oct 25 2026.
  const march = Date.UTC(2026, 2, 20);
  assert.strictEqual(parseReset('resets Mar 28 at 6am (Europe/Stockholm)', march), Date.UTC(2026, 2, 28, 5, 0));
  assert.strictEqual(parseReset('resets Mar 30 at 6am (Europe/Stockholm)', march), Date.UTC(2026, 2, 30, 4, 0));
  assert.strictEqual(parseReset('resets Oct 26 at 1pm (Europe/Stockholm)', Date.UTC(2026, 9, 20)), Date.UTC(2026, 9, 26, 12, 0));
  assert.strictEqual(parseReset('resets Nov 18 at 1:30pm (America/New_York)', NOW), Date.UTC(2026, 10, 18, 18, 30));
});

test('reset times: relative, without a zone, and nonsense', () => {
  assert.strictEqual(parseReset('resets in 2h 5m', NOW), NOW + 125 * MIN);
  assert.strictEqual(parseReset('resets in 3d', NOW), NOW + 3 * 1440 * MIN);
  // No zone, or one Intl does not know: this machine's local time.
  const local = new Date(2026, 10, 25, 6, 0).getTime();
  assert.strictEqual(parseReset('resets Nov 25 at 6am', NOW), local);
  assert.strictEqual(parseReset('resets Nov 25 at 6am (Mars/Olympus)', NOW), local);
  assert.strictEqual(parseReset('resets soon', NOW), null);
  assert.strictEqual(parseReset('resets 25:00', NOW), null);
  assert.strictEqual(parseReset('', NOW), null);
});

const json = (o) => ({ code: 0, stdout: JSON.stringify(o), stderr: '' });

test('claude result: limits, signed out, an error, and output that is not JSON', () => {
  const ok = claudeResult(json({ type: 'result', is_error: false, result: USAGE_TEXT, credential_expires_at: '2027-01-30T09:00:00Z' }), NOW);
  assert.strictEqual(ok.status, 'ok');
  assert.strictEqual(ok.windows.length, 3);
  assert.strictEqual(ok.signInEndsAt, null);
  const out = claudeResult(json({ is_error: false, result: 'Estimated cost: $0.0000\nUsage: 0 input' }), NOW);
  assert.strictEqual(out.status, 'signed-out');
  assert.match(out.error, /claude auth login/);
  assert.deepStrictEqual(claudeResult(json({ is_error: true, result: 'API Error: 500\nmore' }), NOW), { status: 'error', error: 'API Error: 500' });
  assert.deepStrictEqual(claudeResult({ code: 1, stdout: '', stderr: 'boom\n' }, NOW), { status: 'error', error: 'boom' });
  assert.strictEqual(claudeResult(json({ is_error: false, result: 'Failed to load usage data' }), NOW).status, 'error');
});

test('claude result: a CLI without --safe-mode is told to update', () => {
  assert.deepStrictEqual(claudeResult({ code: 1, stdout: '', stderr: "error: unknown option '--safe-mode'\n" }, NOW),
    { status: 'error', error: 'Claude Code is too old for the usage check: run claude update.' });
});

test('claude result: a sign-in ending within a week is flagged', () => {
  const ends = '2026-11-21T09:37:47.443Z';
  const r = claudeResult(json({ is_error: false, result: USAGE_TEXT, credential_expires_at: ends }), NOW);
  assert.strictEqual(r.signInEndsAt, Date.parse(ends));
  const warn = 'Warning: this sign-in ends between 2026-11-21 and 2026-11-24 (in 3 days at the earliest). Renewing it does not move those dates. Run claude auth login before then.\n';
  assert.strictEqual(claudeSignInNote(warn), 'This sign-in ends between 2026-11-21 and 2026-11-24 (in 3 days at the earliest). Run claude auth login before then.');
  assert.strictEqual(claudeSignInNote('some other warning\n'), null);
});

test('readClaude runs /usage headless in safe mode, saving no session, in the probe folder', async () => {
  const calls = [];
  const exec = async (bin, args, opts) => { calls.push({ bin, args, opts }); return json({ is_error: false, result: USAGE_TEXT }); };
  const r = await readClaude({ dir: '/probe', find: () => '/opt/x/bin/claude', exec, now: () => NOW });
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(calls[0].bin, '/opt/x/bin/claude');
  assert.deepStrictEqual(calls[0].args, ['-p', '/usage', '--output-format', 'json', '--no-session-persistence', '--safe-mode']);
  assert.deepStrictEqual(calls[0].args, CLAUDE_ARGS);
  assert.strictEqual(calls[0].opts.cwd, '/probe');
  // A Dock launch has almost no PATH: the CLI's own folder goes first.
  assert.ok(calls[0].opts.env.PATH.startsWith('/opt/x/bin:'));
  assert.deepStrictEqual(await readClaude({ find: () => null, exec }), { status: 'missing' });
  assert.strictEqual(calls.length, 1);
});

// account/rateLimits/read as Codex 0.170 answers it, trimmed.
const CODEX_LIMITS = {
  ordinaryUsageAllowed: true,
  rateLimits: { limitId: 'codex', limitName: null, primary: { usedPercent: 6, windowDurationMins: 300, resetsAt: 1795010410 }, secondary: { usedPercent: 2, windowDurationMins: 10080, resetsAt: 1795186710 }, planType: 'team' },
  rateLimitsByLimitId: {
    codex: { limitId: 'codex', primary: { usedPercent: 6, windowDurationMins: 300, resetsAt: 1795010410 } },
    codex_spark: { limitId: 'codex_spark', limitName: 'Spark', primary: { usedPercent: 50, windowDurationMins: 1440, resetsAt: 1795000000 } },
  },
};

test('Codex limits: the main bucket\'s windows, then other buckets by name', () => {
  const { windows, plan } = parseCodexLimits(CODEX_LIMITS);
  assert.strictEqual(plan, 'Team');
  assert.deepStrictEqual(windows.map((w) => [w.id, w.label, w.short, w.usedPercent, w.resetsAt]), [
    ['primary', '5 hours', '5h', 6, 1795010410_000],
    ['secondary', 'Week', 'wk', 2, 1795186710_000],
    ['codex_spark:primary', 'Day Spark', '1d Spark', 50, 1795000000_000],
  ]);
  assert.deepStrictEqual(parseCodexLimits({}), { windows: [], plan: null });
});

test('Codex result: ok, not signed in, and other errors', () => {
  assert.strictEqual(codexResult({ result: CODEX_LIMITS }).status, 'ok');
  assert.strictEqual(codexResult({ error: { message: 'Authentication required: please log in' } }).status, 'signed-out');
  assert.strictEqual(codexResult({ result: { rateLimits: { limitId: 'codex' } } }).status, 'signed-out');
  assert.deepStrictEqual(codexResult({ error: { message: 'stream disconnected' } }), { status: 'error', error: 'stream disconnected' });
});

const FAKE = path.join(__dirname, 'fixtures', 'usage', 'fake-codex.js');

test('codexRpc talks to app-server: initialize, initialized, then the read', async () => {
  assert.deepStrictEqual(CODEX_ARGS, ['app-server'], 'app-server ignores the root -s/-a flags');
  const r = await codexRpc(FAKE, { env: { ...process.env, FAKE_CODEX: '' }, timeoutMs: 10_000 });
  assert.strictEqual(r.result.rateLimits.primary.usedPercent, 6);
  const res = await readCodex({ find: () => FAKE, rpc: (bin, opts) => codexRpc(bin, { ...opts, env: { ...opts.env, FAKE_CODEX: '' } }) });
  assert.strictEqual(res.status, 'ok');
  assert.strictEqual(res.plan, 'Plus');
});

test('codexRpc: a CLI that dies or refuses gives an error, never a hang', async () => {
  const died = await codexRpc(FAKE, { env: { ...process.env, FAKE_CODEX: 'exit' }, timeoutMs: 10_000 });
  assert.match(died.error.message, /not logged in/);
  const refused = await codexRpc(FAKE, { env: { ...process.env, FAKE_CODEX: 'uninit' }, timeoutMs: 10_000 });
  assert.strictEqual(refused.error.message, 'Not initialized');
  const missing = await codexRpc('/nonexistent/codex', { timeoutMs: 10_000 });
  assert.ok(missing.error);
  assert.deepStrictEqual(await readCodex({ find: () => null }), { status: 'missing' });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { assert.ok(pid > 0, 'the CLI printed its pid'); try { process.kill(pid, 0); return true; } catch { return false; } };
async function gone(pid) { for (let i = 0; i < 40 && alive(pid); i++) await wait(50); return !alive(pid); }
// A CLI that ignores SIGTERM, writes its pid to a file and never ends.
function stuck() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'usage-test-')), 'pid');
  const args = ['-e', "process.on('SIGTERM', () => {}); require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)", file];
  const pid = async () => { for (let i = 0; i < 200 && !fs.existsSync(file); i++) await wait(50); return Number(fs.readFileSync(file, 'utf8')); };
  return { args, pid };
}

test('codexRpc: an app-server that ignores SIGTERM is killed after the grace period', async () => {
  const r = await codexRpc(FAKE, { env: { ...process.env, FAKE_CODEX: 'stuck' }, timeoutMs: 3000, graceMs: 200 });
  const pid = Number(r.error.message.match(/pid (\d+)/)[1]);
  assert.ok(await gone(pid));
});

test('run: a spawn that throws resolves with its error', async () => {
  const r = await run('bad\0name', []);
  assert.strictEqual(r.code, -1);
  assert.doesNotMatch(r.stderr, /before initialization/);
  assert.match(r.stderr, /null bytes|\\0|must be a string/i);
});

test('run: a CLI past its time limit is ended, SIGKILL if it ignores SIGTERM', async () => {
  const cli = stuck();
  const p = run(process.execPath, cli.args, { timeoutMs: 3000, graceMs: 200 });
  const pid = await cli.pid();
  const r = await p;
  assert.strictEqual(r.code, -1);
  assert.match(r.stderr, /took longer than 3 s/);
  assert.ok(await gone(pid));
});

test('run: the signal ends a running CLI', async () => {
  const ctl = new AbortController();
  const cli = stuck();
  const p = run(process.execPath, cli.args, { signal: ctl.signal, graceMs: 200 });
  const pid = await cli.pid();
  ctl.abort();
  assert.strictEqual((await p).stderr, 'stopped');
  assert.ok(await gone(pid));
  assert.strictEqual((await run(process.execPath, ['-e', ''], { signal: ctl.signal })).stderr, 'stopped');
});

test('run: a stop on quit kills at once, with no grace period', async () => {
  const ctl = new AbortController();
  const cli = stuck();
  const p = run(process.execPath, cli.args, { signal: ctl.signal, graceMs: 60_000 });
  const pid = await cli.pid();
  ctl.abort(KILL_NOW);
  await p;
  assert.ok(await gone(pid), 'SIGKILL, not a SIGTERM it ignores');
});

// A monitor with a hand-driven clock and timer.
function monitor(results) {
  let now = NOW;
  const timer = { fn: null, ms: null };
  const sent = [];
  const reads = { claude: 0, codex: 0 };
  const provider = (id) => ({ id, name: id, read: async (opts) => { reads[id]++; const r = results[id]; return typeof r === 'function' ? r(opts) : r; } });
  const m = new UsageMonitor({
    providers: [provider('claude'), provider('codex')],
    send: (v) => sent.push(v),
    now: () => now,
    timers: { set: (fn, ms) => { timer.fn = fn; timer.ms = ms; return 1; }, clear: () => { timer.fn = null; } },
  });
  return { m, sent, reads, timer, tick: (ms) => { now += ms; } };
}
const okClaude = { status: 'ok', windows: [{ id: 'session', label: 'Session', short: '5h', usedPercent: 10, resetsAt: NOW + 60 * MIN }] };

test('monitor: turning it on reads both, then polls at the interval', async () => {
  const { m, reads, timer, tick } = monitor({ claude: okClaude, codex: { status: 'missing' } });
  m.configure({ enabled: true, interval: 15 });
  await m.running;
  assert.deepStrictEqual(reads, { claude: 1, codex: 1 });
  assert.strictEqual(timer.ms, 15 * MIN);
  const v = m.view();
  assert.strictEqual(v.providers[0].status, 'ok');
  assert.strictEqual(v.providers[0].at, NOW);
  assert.strictEqual(v.providers[1].status, 'missing');
  tick(15 * MIN);
  await timer.fn();
  assert.deepStrictEqual(reads, { claude: 2, codex: 2 });
});

test('monitor: off stops the timer and reads nothing', async () => {
  const { m, reads, timer, sent } = monitor({ claude: okClaude, codex: okClaude });
  m.configure({ enabled: true });
  await m.running;
  m.configure({ enabled: false });
  assert.strictEqual(timer.fn, null);
  assert.strictEqual(sent.at(-1).enabled, false);
  await m.refresh({ force: true });
  assert.deepStrictEqual(reads, { claude: 1, codex: 1 });
});

test('monitor: a failure keeps the last numbers as stale and backs off 5, 10, 30 min', async () => {
  let claude = okClaude;
  const { m, reads, tick, timer } = monitor({ claude: () => claude, codex: { status: 'missing' } });
  m.configure({ enabled: true });
  await m.running;
  claude = { status: 'error', error: 'offline' };
  tick(MIN);
  await m.refresh();
  let p = m.view().providers[0];
  assert.strictEqual(p.status, 'error');
  assert.strictEqual(p.stale, true);
  assert.strictEqual(p.windows[0].usedPercent, 10);
  assert.strictEqual(p.at, NOW, 'the age of the numbers, not of the failure');
  assert.strictEqual(timer.ms, 5 * MIN, 'the retry comes before the 10-min tick');
  tick(4 * MIN);
  await m.refresh();
  assert.strictEqual(reads.claude, 2, 'still backing off');
  tick(MIN);
  await m.refresh();
  assert.strictEqual(reads.claude, 3);
  tick(9 * MIN);
  await m.refresh();
  assert.strictEqual(reads.claude, 3, 'second failure waits 10 min');
  await m.refresh({ force: true });
  assert.strictEqual(reads.claude, 4, '↻ skips the wait');
  claude = { status: 'signed-out', error: 'log in' };
  tick(31 * MIN);
  await m.refresh();
  p = m.view().providers[0];
  assert.strictEqual(p.status, 'signed-out');
  assert.deepStrictEqual(p.windows, [], 'signed out clears the old numbers');
});

test('monitor: the timer retries a failing provider at its backoff and leaves a fresh one alone', async () => {
  let claude = okClaude;
  const { m, reads, timer, tick } = monitor({ claude: () => claude, codex: okClaude });
  m.configure({ enabled: true, interval: 30 });
  await m.running;
  claude = { status: 'error', error: 'offline' };
  tick(30 * MIN);
  await timer.fn();
  assert.deepStrictEqual(reads, { claude: 2, codex: 2 });
  assert.strictEqual(timer.ms, 5 * MIN);
  claude = okClaude;
  tick(5 * MIN);
  await timer.fn();
  assert.deepStrictEqual(reads, { claude: 3, codex: 2 }, 'only the provider that was due');
  assert.strictEqual(m.view().providers[0].status, 'ok');
  assert.strictEqual(timer.ms, 25 * MIN, 'codex is next, 30 min after its last check');
});

test('monitor: stop ends a running check, keeps nothing from it, and on starts afresh', async () => {
  const signals = [];
  const read = ({ signal }) => { signals.push(signal); return new Promise((r) => signal.addEventListener('abort', () => r({ status: 'error', error: 'stopped' }))); };
  const { m, timer, sent } = monitor({ claude: read, codex: okClaude });
  m.configure({ enabled: true });
  const first = m.running;
  m.configure({ enabled: false });
  assert.strictEqual(signals[0].aborted, true);
  assert.strictEqual(m.running, null);
  await first;
  assert.strictEqual(m.view().providers[0].status, 'loading', 'the stopped read is not taken as a failure');
  assert.strictEqual(timer.fn, null);
  assert.strictEqual(sent.at(-1).refreshing, false);
  m.configure({ enabled: true });
  assert.ok(m.running, 'a new check, not the stopped one');
  assert.strictEqual(signals.length, 2);
  m.stop({ now: true });
  assert.strictEqual(signals[1].aborted, true);
  assert.strictEqual(signals[1].reason, KILL_NOW, 'quit kills without waiting');
  assert.notStrictEqual(signals[0].reason, KILL_NOW);
});

test('monitor: one run at a time, and focus refreshes only old data', async () => {
  let release;
  const slow = () => new Promise((r) => { release = () => r(okClaude); });
  const { m, reads, tick } = monitor({ claude: slow, codex: { status: 'missing' } });
  m.configure({ enabled: true });
  const again = m.refresh({ force: true });
  m.focus();
  release();
  await again;
  assert.strictEqual(reads.claude, 1);
  tick(MIN);
  m.focus();
  assert.strictEqual(m.running, null);
  tick(2 * MIN);
  m.focus();
  assert.ok(m.running);
  release();
  await m.running;
  assert.strictEqual(reads.claude, 2);
});

test('only 5, 10, 15 and 30 minutes; anything else is 10', () => {
  assert.strictEqual(cleanInterval(5), 5);
  assert.strictEqual(cleanInterval('30'), 30);
  assert.strictEqual(cleanInterval(1), 10);
  assert.strictEqual(cleanInterval(undefined), 10);
});
