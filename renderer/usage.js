// Plan limits in the status bar: a small bar per window (5 hours, a week)
// for Claude and Codex, counting down to each reset, and a popover with every
// window when clicked. main.js polls the CLIs (usage.js) and sends the view.
// `show` is the setting: 'remaining' (a bar that drains, "84% left") or 'used'.
(function (root) {
  const MIN = 60_000;
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');

  // Time left until `at`: "45m", "2h05", "5d18h".
  function countdown(at, now = Date.now()) {
    if (!at) return '';
    const mins = Math.ceil((at - now) / MIN);
    if (mins <= 0) return 'now';
    if (mins < 60) return `${mins}m`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h${pad(mins % 60)}`;
    return `${Math.floor(mins / 1440)}d${Math.floor((mins % 1440) / 60)}h`;
  }

  // The reset as a clock time: "13:30" today, "Mon 06:00" this week, "Nov 30 06:00" later.
  function resetTime(at, now = Date.now()) {
    if (!at) return '';
    const d = new Date(at), n = new Date(now);
    const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (d.toDateString() === n.toDateString()) return clock;
    if (at - now < 6 * 1440 * MIN) return `${DAYS[d.getDay()]} ${clock}`;
    return `${MONTHS[d.getMonth()]} ${d.getDate()} ${clock}`;
  }

  // How close to the limit, whichever number is shown: amber at 25% left, red at 10% left.
  const level = (used) => (used >= 90 ? 'high' : used >= 75 ? 'warn' : 'ok');
  const usedPct = (w) => Math.max(0, Math.min(100, Math.round(w.usedPercent)));
  const pct = (w, show) => (show === 'used' ? `${usedPct(w)}% used` : `${100 - usedPct(w)}% left`);
  const fill = (w, show) => { const used = Math.max(0, Math.min(100, w.usedPercent)); return show === 'used' ? used : 100 - used; };
  const bar = (w, show) => `<span class="ubar ${level(w.usedPercent)}"><i style="width:${fill(w, show)}%"></i></span>`;

  // The windows the status bar has room for: the provider's own two, not the per-model ones.
  const mainWindows = (p) => (p.windows || []).filter((w) => !w.id.includes(':')).slice(0, 2);
  // Providers worth a place: installed ones, once they have answered.
  const shown = (view) => (view?.enabled ? (view.providers || []).filter((p) => p.status !== 'missing' && p.status !== 'loading') : []);

  function statusHtml(view, now = Date.now(), show = 'remaining') {
    return shown(view).map((p) => {
      const wins = mainWindows(p);
      const dim = p.stale ? ' stale' : '';
      if (!wins.length) return `<span class="usage-prov"><b>${esc(p.name)}</b> <span class="usage-off" title="${esc(p.error || '')}">–</span></span>`;
      return `<span class="usage-prov${dim}"><b>${esc(p.name)}</b>${wins.map((w) => `<span class="usage-win" title="${esc(`${p.name} ${w.label}: ${pct(w, show)}${w.resetsAt ? `, resets ${resetTime(w.resetsAt, now)}` : ''}`)}">${esc(w.short)} ${bar(w, show)} ${pct(w, show)}${w.resetsAt ? ` <span class="usage-reset">↺${countdown(w.resetsAt, now)}</span>` : ''}</span>`).join('')}</span>`;
    }).join('');
  }

  function popoverHtml(view, now = Date.now(), show = 'remaining') {
    const provs = view?.providers || [];
    const rows = provs.filter((p) => p.status !== 'missing').map((p) => {
      const asOf = p.at ? `<small class="usage-asof${p.stale ? ' stale' : ''}">${p.stale ? 'as of' : 'checked'} ${resetTime(p.at, now)}</small>` : '';
      const head = `<div class="usage-prov-head"><b>${esc(p.name)}</b>${p.plan ? ` <small>${esc(p.plan)}</small>` : ''}${asOf}</div>`;
      if (p.status === 'loading') return `${head}<div class="usage-msg">Checking…</div>`;
      const wins = (p.windows || []).map((w) => `<div class="usage-row"><span class="usage-label">${esc(w.label)}</span>${bar(w, show)}<span class="usage-pct">${pct(w, show)}</span><span class="usage-when">${w.resetsAt ? `resets ${resetTime(w.resetsAt, now)} · ${countdown(w.resetsAt, now)}` : ''}</span></div>`).join('');
      const err = p.error ? `<div class="usage-msg err">⚠ ${esc(p.error)}</div>` : '';
      const signIn = p.signInEndsAt && !p.note ? `<div class="usage-msg warn">Sign-in ends ${resetTime(p.signInEndsAt, now)} (in ${countdown(p.signInEndsAt, now)}). Run ${p.id === 'codex' ? 'codex login' : 'claude auth login'} before then.</div>` : '';
      const note = p.note ? `<div class="usage-msg warn">${esc(p.note)}</div>` : signIn;
      return head + wins + err + note;
    });
    const missing = provs.filter((p) => p.status === 'missing').map((p) => p.name);
    const foot = missing.length ? `<div class="usage-msg">${esc(missing.join(' and '))}: CLI not found, so not shown.</div>` : '';
    return `<div class="usage-head"><span>Plan usage</span><button class="usage-refresh icon-btn" type="button" title="Refresh now"${view?.refreshing ? ' disabled' : ''}>↻</button></div>`
      + (rows.join('') || '<div class="usage-msg">Neither the claude nor the codex CLI was found.</div>') + foot
      + `<div class="usage-foot">Every ${esc(view?.interval || 10)} min · Settings → General</div>`;
  }

  let show = 'remaining';
  let rerender = () => {};
  const setShow = (s) => { const next = s === 'used' ? 'used' : 'remaining'; if (next !== show) { show = next; rerender(); } };
  const api = { countdown, resetTime, level, statusHtml, popoverHtml, mainWindows, shown, setShow };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.officeUsageView = api;

  if (typeof document === 'undefined' || !root.office?.usage) return;
  const $meter = document.getElementById('usage');
  const $pop = document.getElementById('usage-pop');
  if (!$meter || !$pop) return;
  let view = null;

  function render() {
    const now = Date.now();
    const html = statusHtml(view, now, show);
    $meter.hidden = !html;
    if ($meter._html !== html) { $meter._html = html; $meter.innerHTML = html; }
    if (!html) $pop.hidden = true;
    // Unchanged HTML is left alone so keyboard focus stays on the ↻.
    if (!$pop.hidden) { const pop = popoverHtml(view, now, show); if ($pop._html !== pop) { $pop._html = pop; $pop.innerHTML = pop; } }
  }

  $meter.addEventListener('click', () => { $pop.hidden = !$pop.hidden; render(); });
  $pop.addEventListener('click', (e) => { if (e.target.closest('.usage-refresh')) root.office.usage.refresh(); });
  document.addEventListener('mousedown', (e) => { if (!$pop.hidden && !$pop.contains(e.target) && !$meter.contains(e.target)) $pop.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$pop.hidden) $pop.hidden = true; });
  let openOnFirst = false;
  root.office.devTriggers?.().then((t) => { openOnFirst = !!t?.usageOpen; });
  root.office.usage.onChange((v) => {
    view = v;
    if (openOnFirst && shown(v).length) { openOnFirst = false; $pop.hidden = false; }
    render();
  });
  rerender = render;
  setInterval(render, 30_000);
})(typeof window !== 'undefined' ? window : globalThis);
