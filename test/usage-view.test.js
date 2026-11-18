// The status bar's usage meter and its popover: countdowns, reset times, which
// providers get a place, and what a failure looks like.
const test = require('node:test');
const assert = require('node:assert');
const { countdown, resetTime, level, statusHtml, popoverHtml } = require('../renderer/usage');

const MIN = 60_000;
// Local time, so the clock texts follow this machine's zone: Wed Nov 18 2026 11:23.
const NOW = new Date(2026, 10, 18, 11, 23).getTime();

test('countdown: minutes, hours and minutes, days and hours', () => {
  assert.strictEqual(countdown(NOW + 47 * MIN, NOW), '47m');
  assert.strictEqual(countdown(NOW + 125 * MIN, NOW), '2h05');
  assert.strictEqual(countdown(NOW + (5 * 1440 + 18 * 60 + 30) * MIN, NOW), '5d18h');
  assert.strictEqual(countdown(NOW + 30_000, NOW), '1m');
  assert.strictEqual(countdown(NOW - MIN, NOW), 'now');
  assert.strictEqual(countdown(null, NOW), '');
});

test('reset time: a clock today, a weekday this week, a date later', () => {
  assert.strictEqual(resetTime(new Date(2026, 10, 18, 13, 30).getTime(), NOW), '13:30');
  assert.strictEqual(resetTime(new Date(2026, 10, 24, 6, 0).getTime(), NOW), 'Tue 06:00');
  assert.strictEqual(resetTime(new Date(2026, 11, 2, 9, 5).getTime(), NOW), 'Dec 2 09:05');
});

test('bars turn amber at 75% used (25% left) and red at 90% used (10% left)', () => {
  assert.deepStrictEqual([0, 74, 75, 89, 90, 100].map(level), ['ok', 'ok', 'warn', 'warn', 'high', 'high']);
});

const win = (id, used, mins, extra = {}) => ({ id, label: id, short: id === 'session' ? '5h' : 'wk', usedPercent: used, resetsAt: NOW + mins * MIN, ...extra });
const view = (providers, extra = {}) => ({ enabled: true, interval: 10, providers, ...extra });
const claude = { id: 'claude', name: 'Claude', status: 'ok', at: NOW, windows: [win('session', 42, 125), win('week', 18, 3000), win('week:opus', 7, 3000)] };

test('status bar: the two main windows per provider, with countdowns', () => {
  const html = statusHtml(view([claude, { id: 'codex', name: 'Codex', status: 'missing' }]), NOW, 'used');
  assert.match(html, /<b>Claude<\/b>/);
  assert.match(html, /5h <span class="ubar ok"><i style="width:42%"><\/i><\/span> 42%<span class="usage-unit"> used<\/span> <span class="usage-reset">↺2h05<\/span>/);
  assert.doesNotMatch(html, /week:opus|7%/, 'per-model weeks only in the popover');
  assert.doesNotMatch(html, /Codex/, 'a CLI that is not installed gets no place');
});

test('status bar, remaining (the default): a draining bar and "% left"', () => {
  const html = statusHtml(view([claude]), NOW);
  assert.match(html, /5h <span class="ubar ok"><i style="width:58%"><\/i><\/span> 58%<span class="usage-unit"> left<\/span> <span class="usage-reset">↺2h05<\/span>/);
  assert.match(html, /title="Claude session: 58% left, resets 13:28"/);
  assert.doesNotMatch(html, /used/);
});

test('colours follow how close the limit is, in both modes', () => {
  const at = (used) => ({ ...claude, windows: [win('session', used, 60)] });
  for (const [used, cls, left] of [[74, 'ok', 26], [75, 'warn', 25], [89, 'warn', 11], [90, 'high', 10]]) {
    assert.match(statusHtml(view([at(used)]), NOW), new RegExp(`ubar ${cls}"><i style="width:${left}%"></i></span> ${left}%<span class="usage-unit"> left`));
    assert.match(statusHtml(view([at(used)]), NOW, 'used'), new RegExp(`ubar ${cls}"><i style="width:${used}%"></i></span> ${used}%<span class="usage-unit"> used`));
  }
});

test('left and used add up to 100 after rounding', () => {
  const html = statusHtml(view([{ ...claude, windows: [win('session', 40.5, 60)] }]), NOW);
  assert.match(html, /> 59%<span class="usage-unit"> left/);
  assert.match(statusHtml(view([{ ...claude, windows: [win('session', 40.5, 60)] }]), NOW, 'used'), /> 41%<span class="usage-unit"> used/);
});

test('status bar: nothing while off, loading, or with no CLI at all', () => {
  assert.strictEqual(statusHtml(view([claude], { enabled: false }), NOW), '');
  assert.strictEqual(statusHtml(view([{ id: 'claude', name: 'Claude', status: 'loading' }]), NOW), '');
  assert.strictEqual(statusHtml(view([{ id: 'claude', name: 'Claude', status: 'missing' }]), NOW), '');
  assert.strictEqual(statusHtml(null, NOW), '');
});

test('status bar: stale numbers are dimmed, a provider without numbers shows a dash', () => {
  const html = statusHtml(view([{ ...claude, status: 'error', stale: true, error: 'offline' }, { id: 'codex', name: 'Codex', status: 'signed-out', error: 'Run codex login <now>' }]), NOW);
  assert.match(html, /usage-prov stale/);
  assert.match(html, /<span class="usage-off" title="Run codex login &lt;now&gt;">–<\/span>/);
});

test('popover: every window, errors escaped, sign-in hint, and the CLIs not found', () => {
  const html = popoverHtml(view([
    { ...claude, status: 'error', stale: true, error: 'API <b>500</b>', signInEndsAt: NOW + 3 * 1440 * MIN },
    { id: 'codex', name: 'Codex', status: 'missing' },
  ]), NOW);
  assert.match(html, /Week Opus|week:opus/);
  assert.match(html, /<span class="usage-pct">58% left<\/span>/);
  assert.match(html, /resets 13:28 · 2h05/);
  assert.match(html, /as of 11:23/);
  assert.match(html, /⚠ API &lt;b&gt;500&lt;\/b&gt;/);
  assert.match(html, /Sign-in ends Sat 11:23 \(in 3d0h\)\. Run claude auth login before then\./);
  assert.match(html, /Codex: CLI not found/);
  assert.match(html, /Every 10 min/);
});

test('popover in used mode says "used"', () => {
  const html = popoverHtml(view([claude]), NOW, 'used');
  assert.match(html, /<i style="width:42%"><\/i><\/span><span class="usage-pct">42% used<\/span>/);
  assert.doesNotMatch(html, /left/);
});

test('popover: fresh numbers say when they were checked; the ↻ is off while a check runs', () => {
  const html = popoverHtml(view([claude], { refreshing: true }), NOW);
  assert.match(html, /checked 11:23/);
  assert.match(html, /class="usage-refresh icon-btn" type="button" title="Refresh now" disabled/);
  assert.match(popoverHtml(view([]), NOW), /Neither the claude nor the codex CLI was found/);
});
