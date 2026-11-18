// Plan usage limits for the status bar: how much of the Claude and Codex
// windows (5 hours, a week, a week per model) is used and when each resets.
// Both come from the providers' own CLIs, never from their tokens: Claude's
// `/usage` command run headless, and Codex's app-server `account/rateLimits/read`.
// A provider whose CLI is not installed is left out.

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { findBin } = require('./assistant-session');

const MIN = 60_000;
const INTERVALS = [5, 10, 15, 30];
const DEFAULT_INTERVAL = 10;
const BACKOFF_MIN = [5, 10, 30];
const FOCUS_STALE_MS = 2 * MIN;
const SIGN_IN_WARN_MS = 7 * 1440 * MIN;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Wall-clock parts of `ms` in `tz`, or null for a zone Intl does not know.
function zoneParts(ms, tz) {
  let fmt;
  try { fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }); } catch { return null; }
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, Number(x.value)]));
  return { y: p.year, mo: p.month - 1, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}

// Epoch ms of a wall-clock time in `tz` (local time when tz is empty or unknown).
function zonedTime(y, mo, d, h, mi, tz) {
  const local = () => new Date(y, mo, d, h, mi).getTime();
  if (!tz || !zoneParts(0, tz)) return local();
  const guess = Date.UTC(y, mo, d, h, mi);
  const offset = (ms) => { const p = zoneParts(ms, tz); return Date.UTC(p.y, p.mo, p.d, p.h, p.mi, p.s) - ms; };
  let t = guess - offset(guess);
  const again = guess - offset(t); // the other side of a DST switch
  if (again !== t) t = again;
  return t;
}

// "resets Nov 18 at 1:30pm (Europe/Stockholm)", "resets 6am (UTC)", "resets in 2h 5m" → epoch ms.
function parseReset(text, now = Date.now()) {
  const s = String(text || '');
  const rel = s.match(/resets\s+in\s+((?:\d+\s*[dhm]\w*\s*)+)/i);
  if (rel) {
    let ms = 0;
    for (const [, n, u] of rel[1].matchAll(/(\d+)\s*([dhm])/gi)) ms += Number(n) * { d: 1440, h: 60, m: 1 }[u.toLowerCase()] * MIN;
    return ms ? now + ms : null;
  }
  const m = s.match(/resets\s+(?:([a-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?(?:\s+at|,)?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i);
  if (!m) return null;
  const [, monName, dayStr, yearStr, hStr, miStr, ap, tzRaw] = m;
  const tz = (tzRaw || '').trim();
  let h = Number(hStr);
  const mi = Number(miStr || 0);
  if (ap) h = (h % 12) + (ap.toLowerCase() === 'pm' ? 12 : 0);
  if (h > 23 || mi > 59) return null;
  const today = zoneParts(now, tz) || (() => { const d = new Date(now); return { y: d.getFullYear(), mo: d.getMonth(), d: d.getDate() }; })();
  if (monName) {
    const mo = MONTHS.indexOf(monName.slice(0, 3).toLowerCase());
    if (mo < 0) return null;
    let t = zonedTime(yearStr ? Number(yearStr) : today.y, mo, Number(dayStr), h, mi, tz);
    // "Jan 2" read on Dec 30 is next year's.
    if (!yearStr && t < now - 1440 * MIN) t = zonedTime(today.y + 1, mo, Number(dayStr), h, mi, tz);
    return t;
  }
  let t = zonedTime(today.y, today.mo, today.d, h, mi, tz);
  if (t < now - MIN) t = zonedTime(today.y, today.mo, today.d + 1, h, mi, tz);
  return t;
}

// One "Current …" block of `/usage` → a window, or null when it has no percentage.
function claudeWindow(label, body, now) {
  const pct = body.match(/(\d{1,3}(?:\.\d+)?)\s*%\s*(used|left|remaining)?/i);
  if (!pct) return null;
  const n = Number(pct[1]);
  const used = /left|remaining/i.test(pct[2] || '') ? 100 - n : n;
  const lm = label.match(/^Current\s+(\w+)(?:\s*\(([^)]*)\))?/i);
  const kind = lm[1].toLowerCase();
  const model = (lm[2] || '').replace(/\s+only$/i, '').trim();
  const allModels = !model || /^all models$/i.test(model);
  const base = kind === 'session' ? { id: 'session', label: 'Session', short: '5h' }
    : kind === 'week' ? { id: 'week', label: 'Week', short: 'wk' }
      : { id: kind, label: kind[0].toUpperCase() + kind.slice(1), short: kind.slice(0, 2) };
  const win = allModels ? base : { id: `${base.id}:${model.toLowerCase()}`, label: `${base.label} ${model}`, short: `${base.short} ${model}` };
  return { ...win, usedPercent: Math.max(0, Math.min(100, used)), resetsAt: parseReset(body, now) };
}

// The text `claude -p /usage` prints → its windows, in order. A block ends at
// a blank line, so a later section's "resets" or "%" is never read as a limit's.
function parseClaudeUsage(text, now = Date.now()) {
  const head = String(text || '').split(/what's contributing/i)[0];
  const blocks = [];
  let open = null;
  for (const line of head.split('\n')) {
    const t = line.trim();
    const label = t.match(/^Current\s+\w+(?:\s*\([^)]*\))?/i);
    if (label) blocks.push(open = { label: label[0], body: t.slice(label[0].length) });
    else if (!t) open = null;
    else if (open) open.body += ` ${t}`;
  }
  return blocks.map((b) => claudeWindow(b.label, b.body, now)).filter(Boolean);
}

// The warning Claude prints on stderr when its sign-in is about to end.
function claudeSignInNote(stderr) {
  const line = String(stderr || '').split('\n').find((l) => /sign-in|log ?in/i.test(l) && /end|expire/i.test(l));
  if (!line) return null;
  const first = line.replace(/^\s*warning:\s*/i, '').split(/(?<=\.)\s/)[0].trim();
  return `${first[0].toUpperCase()}${first.slice(1)} Run claude auth login before then.`;
}

// `claude -p /usage --output-format json` → a provider result.
function claudeResult({ code, stdout, stderr }, now = Date.now()) {
  let out;
  try { out = JSON.parse(String(stdout).slice(String(stdout).indexOf('{'))); } catch { /* below */ }
  if (/unknown option '--safe-mode'/.test(stderr)) return { status: 'error', error: 'Claude Code is too old for the usage check: run claude update.' };
  if (!out) return { status: 'error', error: firstLine(stderr) || `claude exited ${code}` };
  if (out.is_error) return { status: 'error', error: firstLine(out.result) || 'claude reported an error' };
  const windows = parseClaudeUsage(out.result, now);
  if (!windows.length) {
    if (/subscription|usage/i.test(out.result) && /fail|unavailable|couldn't|could not/i.test(out.result)) return { status: 'error', error: firstLine(out.result) };
    return { status: 'signed-out', error: 'No plan limits: not signed in with a Claude subscription. Run claude auth login.' };
  }
  const ends = Date.parse(out.credential_expires_at || '');
  const signInEndsAt = ends && ends - now < SIGN_IN_WARN_MS ? ends : null;
  return { status: 'ok', windows, note: claudeSignInNote(stderr), signInEndsAt };
}

const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 200) || '';

function windowName(mins) {
  if (!mins) return { label: 'Limit', short: '' };
  if (mins === 10080) return { label: 'Week', short: 'wk' };
  if (mins === 1440) return { label: 'Day', short: '1d' };
  if (mins % 1440 === 0) return { label: `${mins / 1440} days`, short: `${mins / 1440}d` };
  if (mins % 60 === 0) return { label: `${mins / 60} hours`, short: `${mins / 60}h` };
  return { label: `${mins} min`, short: `${mins}m` };
}

const planName = (p) => (p && p !== 'unknown' ? String(p)[0].toUpperCase() + String(p).slice(1) : null);

// account/rateLimits/read's result → windows: the main bucket's two, then any
// other metered bucket (a model with its own limit), named after it.
function parseCodexLimits(result) {
  const main = result?.rateLimits;
  if (!main) return { windows: [], plan: null };
  const windows = [];
  const add = (snap, prefix, idPrefix) => {
    for (const key of ['primary', 'secondary']) {
      const w = snap?.[key];
      if (!w || typeof w.usedPercent !== 'number') continue;
      const name = windowName(w.windowDurationMins);
      windows.push({
        id: `${idPrefix}${key}`, label: prefix ? `${name.label} ${prefix}` : name.label, short: prefix ? `${name.short} ${prefix}` : name.short,
        usedPercent: Math.max(0, Math.min(100, w.usedPercent)), resetsAt: w.resetsAt ? w.resetsAt * 1000 : null,
      });
    }
  };
  add(main, '', '');
  for (const [id, snap] of Object.entries(result.rateLimitsByLimitId || {})) {
    if (!snap || id === main.limitId) continue;
    add(snap, snap.limitName || id, `${id}:`);
  }
  return { windows, plan: planName(main.planType) };
}

function codexResult(res) {
  if (res.error) {
    const msg = firstLine(res.error.message || res.error);
    return /auth|log ?in|sign/i.test(msg) ? { status: 'signed-out', error: `Not signed in: run codex login. (${msg})` } : { status: 'error', error: msg };
  }
  const { windows, plan } = parseCodexLimits(res.result);
  if (!windows.length) return { status: 'signed-out', error: 'No plan limits: Codex is not signed in with ChatGPT. Run codex login.' };
  return { status: 'ok', windows, plan };
}

// PATH for the CLIs: a Dock launch has almost none, and a CLI may start helpers.
const cliEnv = (bin, extra = {}) => ({ ...process.env, PATH: [path.dirname(bin), String(process.env.PATH || ''), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean).join(':'), ...extra });

const KILL_GRACE_MS = 2000;

// SIGTERM, then SIGKILL if it is still there after a grace period (none: SIGKILL now).
function end(proc, graceMs = KILL_GRACE_MS) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;
  try { proc.kill(graceMs > 0 ? 'SIGTERM' : 'SIGKILL'); } catch { return; }
  if (graceMs <= 0) return;
  const t = setTimeout(() => { if (proc.exitCode === null && proc.signalCode === null) try { proc.kill('SIGKILL'); } catch { /* gone */ } }, graceMs);
  t.unref?.();
  proc.once('exit', () => clearTimeout(t));
}

// The monitor's stop({ now: true }) aborts with this: on quit there is no time for a grace period.
const KILL_NOW = 'kill-now';
const graceFor = (signal, graceMs) => (signal?.reason === KILL_NOW ? 0 : graceMs);

// Runs a CLI to the end. `signal` (the monitor's stop) ends it early.
function run(bin, args, { cwd, env, timeoutMs = 30_000, signal, graceMs } = {}) {
  return new Promise((resolve) => {
    let stdout = '', stderr = '', done = false, timer, proc;
    const onAbort = () => { end(proc, graceFor(signal, graceMs)); finish({ code: -1, stdout, stderr: 'stopped' }); };
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(r); } };
    if (signal?.aborted) return finish({ code: -1, stdout, stderr: 'stopped' });
    try { proc = spawn(bin, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (err) { return finish({ code: -1, stdout, stderr: String(err.message) }); }
    timer = setTimeout(() => { end(proc, graceMs); finish({ code: -1, stdout, stderr: `${path.basename(bin)} took longer than ${timeoutMs / 1000} s` }); }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.on('error', (err) => finish({ code: -1, stdout, stderr: String(err.message) }));
    proc.on('close', (code) => finish({ code, stdout, stderr }));
  });
}

// Safe mode keeps hooks, MCP servers, plugins and CLAUDE.md off: a usage check
// should not chime, start servers or read a project. It also saves no session.
const CLAUDE_ARGS = ['-p', '/usage', '--output-format', 'json', '--no-session-persistence', '--safe-mode'];

async function readClaude({ dir, find = findBin, exec = run, now = Date.now, signal } = {}) {
  const bin = find('claude');
  if (!bin) return { status: 'missing' };
  return claudeResult(await exec(bin, CLAUDE_ARGS, { cwd: dir, signal, env: cliEnv(bin, { CLAUDE_CODE_ENTRYPOINT: 'herdquarters-usage' }) }), now());
}

// No sandbox flags: app-server ignores the root -s/-a, and only
// account/rateLimits/read is asked, so no thread starts and no tool runs.
const CODEX_ARGS = ['app-server'];

// One app-server conversation: initialize, then account/rateLimits/read, then
// stop it. Newline-delimited JSON-RPC without the "jsonrpc" field, as Codex speaks it.
function codexRpc(bin, { cwd, env, timeoutMs = 15_000, version = '0', signal, graceMs } = {}) {
  return new Promise((resolve) => {
    let proc, timer, buf = '', stderr = '', done = false;
    const onAbort = () => finish({ error: { message: 'stopped' } });
    const finish = (r) => {
      if (done) return;
      done = true; clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try { proc?.stdin.end(); } catch { /* gone */ }
      end(proc, graceFor(signal, graceMs));
      resolve(r);
    };
    if (signal?.aborted) return finish({ error: { message: 'stopped' } });
    timer = setTimeout(() => finish({ error: { message: firstLine(stderr) || `codex app-server took longer than ${timeoutMs / 1000} s` } }), timeoutMs);
    try { proc = spawn(bin, CODEX_ARGS, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (err) { return finish({ error: { message: err.message } }); }
    signal?.addEventListener('abort', onAbort, { once: true });
    const send = (o) => { try { proc.stdin.write(`${JSON.stringify(o)}\n`); } catch { /* closed */ } };
    proc.on('error', (err) => finish({ error: { message: err.message } }));
    proc.on('close', (code) => finish({ error: { message: firstLine(stderr) || `codex app-server exited ${code}` } }));
    proc.stdin.on('error', () => {});
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (d) => { stderr += d; });
    proc.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 1) {
          if (msg.error) return finish({ error: msg.error });
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'account/rateLimits/read' });
        } else if (msg.id === 2) finish(msg.error ? { error: msg.error } : { result: msg.result });
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'herdquarters', version } } });
  });
}

async function readCodex({ dir, find = findBin, rpc = codexRpc, version, signal } = {}) {
  const bin = find('codex');
  if (!bin) return { status: 'missing' };
  return codexResult(await rpc(bin, { cwd: dir, env: cliEnv(bin), version, signal }));
}

const cleanInterval = (n) => (INTERVALS.includes(Number(n)) ? Number(n) : DEFAULT_INTERVAL);

// Polls the providers one after the other, every `interval` minutes while
// enabled, and sends the renderer a view after each. A failing provider keeps
// its last numbers (marked stale) and is retried after 5, 10, then 30 minutes;
// signed out or not installed clears them.
class UsageMonitor {
  constructor({ providers, send, now = Date.now, timers = { set: setTimeout, clear: clearTimeout } }) {
    this.providers = providers; // [{ id, name, read: async ({ signal }) => result }]
    this.send = send;
    this.now = now;
    this.timers = timers;
    this.enabled = false;
    this.interval = DEFAULT_INTERVAL;
    this.state = {};
    this.lastRun = 0;
    this.running = null;
    this.ctl = null;
    this.timer = null;
  }

  configure({ enabled, interval } = {}) {
    const was = this.enabled, wasInterval = this.interval;
    if (enabled !== undefined) this.enabled = !!enabled;
    if (interval !== undefined) this.interval = cleanInterval(interval);
    if (!this.enabled) { this.stop(); this.publish(); return this.view(); }
    if (!was) this.refresh();
    else if (wasInterval !== this.interval && !this.running) this.schedule();
    this.publish();
    return this.view();
  }

  // The timer, and any CLI still running. now: on quit, SIGKILL without a grace period.
  stop({ now = false } = {}) {
    this.clearTimer();
    this.ctl?.abort(now ? KILL_NOW : undefined);
    this.ctl = null;
    this.running = null;
  }

  clearTimer() { if (this.timer) this.timers.clear(this.timer); this.timer = null; }

  // When a provider is next due: its backoff after a failure, else a full interval after its last check.
  dueAt(id) {
    const s = this.state[id];
    if (!s) return 0;
    return s.retryAt || s.checked + this.interval * MIN;
  }

  schedule() {
    this.clearTimer();
    if (!this.enabled) return;
    const next = Math.min(...this.providers.map((p) => this.dueAt(p.id)));
    const wait = Math.max(MIN / 2, Math.min(this.interval * MIN, next - this.now()));
    this.timer = this.timers.set(() => this.refresh({ due: true }), wait);
  }

  focus() { if (this.enabled && !this.running && this.now() - this.lastRun > FOCUS_STALE_MS) this.refresh(); }

  // force: the ↻ button, past any backoff. due: the timer, only the providers whose time has come.
  refresh({ force = false, due = false } = {}) {
    if (!this.enabled) return Promise.resolve(this.view());
    if (this.running) return this.running;
    const ctl = new AbortController();
    this.ctl = ctl;
    const run = (async () => {
      this.lastRun = this.now();
      for (const p of this.providers) {
        const prev = this.state[p.id];
        if (!force && prev?.retryAt && this.now() < prev.retryAt) continue;
        // A timer a little early still counts.
        if (due && !force && this.dueAt(p.id) - this.now() > 5000) continue;
        let res;
        try { res = await p.read({ signal: ctl.signal }); } catch (err) { res = { status: 'error', error: String(err.message || err) }; }
        if (!this.enabled || ctl.signal.aborted) break;
        this.state[p.id] = this.merge(prev, res);
        this.publish();
      }
    })().finally(() => {
      if (this.ctl !== ctl) return;
      this.ctl = null; this.running = null; this.schedule(); this.publish();
    });
    this.running = run.then(() => this.view());
    return this.running;
  }

  merge(prev, res) {
    const at = this.now();
    if (res.status !== 'error') return { ...res, at, checked: at, failures: 0 };
    const failures = (prev?.failures || 0) + 1;
    const retryAt = at + BACKOFF_MIN[Math.min(failures, BACKOFF_MIN.length) - 1] * MIN;
    const keep = prev?.windows?.length ? { windows: prev.windows, plan: prev.plan, note: prev.note, signInEndsAt: prev.signInEndsAt, at: prev.at, stale: true } : {};
    return { status: 'error', error: res.error, failures, retryAt, checked: at, ...keep };
  }

  view() {
    return {
      enabled: this.enabled, interval: this.interval, refreshing: !!this.running,
      providers: this.providers.map((p) => {
        const s = this.state[p.id];
        if (!s) return { id: p.id, name: p.name, status: 'loading' };
        return { id: p.id, name: p.name, status: s.status, windows: s.windows || [], plan: s.plan || null, note: s.note || null, signInEndsAt: s.signInEndsAt || null, error: s.error || null, at: s.at || null, stale: !!s.stale };
      }),
    };
  }

  publish() { this.send(this.view()); }
}

// The folder the CLIs run in: empty, so no project's settings or files are read.
function probeDir(userData) {
  const dir = path.join(userData, 'usage-probe');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = {
  UsageMonitor, readClaude, readCodex, codexRpc, parseClaudeUsage, parseReset, claudeResult, claudeSignInNote,
  parseCodexLimits, codexResult, cleanInterval, probeDir, zonedTime, run, KILL_NOW, INTERVALS, DEFAULT_INTERVAL, CLAUDE_ARGS, CODEX_ARGS,
};
