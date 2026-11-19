// The update bar and the Updates row in settings; a restart is always asked, also in Automatic.
(function () {
  const api = window.office.updates;
  if (!api) return;
  const $bar = document.getElementById('updatebar');
  const $row = document.getElementById('set-updates-row');
  const $info = document.getElementById('set-updates-info');
  const $check = document.getElementById('set-update-check');
  const REOPEN = 'herdquarters.update.reopen';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (sha) => String(sha || '').slice(0, 7);
  let state = null;
  let laterFor = null; // the target "Later" was clicked for; a newer one shows again
  let expanded = false;
  let lastHTML = '';
  let checking = false;
  let goneSeen = false;

  const QUIET_MS = 60_000;
  let lastKey = 0;
  document.addEventListener('keydown', () => { lastKey = Date.now(); }, true);

  const auto = () => window.officeSettings?.get().updateMode === 'auto';

  function idle(now = Date.now()) {
    if (now - lastKey < QUIET_MS) return false;
    if (document.activeElement?.closest?.('.xterm')) return false;
    if (document.getElementById('settings')?.hidden === false) return false;
    if (document.getElementById('modal')?.hidden === false) return false;
    if (document.querySelector('.bigboard:not([hidden])')) return false;
    const a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /^(text|search|)$/.test(a.type))) && a.value) return false;
    if (String(window.getSelection?.() || '')) return false;
    return true;
  }

  async function apply() {
    if (!state || state.status !== 'available') return;
    if (state.kind === 'live') {
      try { const pane = window.officeTerminal?.openPane?.(); if (pane) sessionStorage.setItem(REOPEN, pane); } catch { /* no storage */ }
    }
    const r = await api.apply(state.target);
    if (!r?.ok) try { sessionStorage.removeItem(REOPEN); } catch { /* no storage */ }
  }

  function autoApply() {
    if (auto() && state?.newer && (state.status === 'restart' || state.status === 'pending')) { api.apply(state.newer.target); return; }
    if (!auto() || state?.status !== 'available') return;
    if (state.kind !== 'live' || idle()) apply();
  }

  const changes = (n) => `${n} change${n === 1 ? '' : 's'}`;
  function barHTML(s) {
    const n = s.notice;
    if (n) {
      const text = n.kind === 'rolledBack'
        ? `The update to <code>${esc(short(n.from))}</code> did not start (${esc(n.error)}), so Herdquarters went back to <code>${esc(short(n.to))}</code>. It will offer the next update when there is one.`
        : n.kind === 'rollbackFailed'
          ? `The update to <code>${esc(short(n.from))}</code> did not start, and going back to <code>${esc(short(n.to))}</code> failed too: ${esc(n.error)}.`
          : `The update to <code>${esc(short(n.to))}</code> could not be applied: ${esc(n.error)}. Herdquarters is still on the version it had.`;
      return { warn: true, html: `<div class="update-line"><span class="update-icon">⚠</span><span class="update-text">${text}</span><button class="btn small" data-act="dismiss">OK</button></div>` };
    }
    if (s.status === 'gone') {
      if (goneSeen) return null;
      return { warn: true, html: `<div class="update-line"><span class="update-icon">⚠</span><span class="update-text"><b>No more updates from ${esc(s.branch)}</b><small>The branch is gone, probably merged. Run <code>npm run install-app -- --reset</code> to go back to main.</small></span><button class="btn small" data-act="gone-ok">OK</button></div>` };
    }
    if (s.status === 'restart') {
      const slow = { shell: ' It downloads a new Electron first, which can take a few minutes.', deps: ' It installs new packages first.', bootstrap: ' It updates the app itself first.' }[s.kind] || '';
      const more = s.newer ? `<button class="btn small ghost" data-act="apply-newer">Include ${changes(s.newer.commits.length)} more</button>` : '';
      return { html: `<div class="update-line"><span class="update-icon">↻</span><span class="update-text"><b>Restart Herdquarters to finish updating</b><small>Takes a few seconds; your agents keep running.${slow}</small></span>
        ${more}<button class="btn small primary" data-act="restart">Restart now</button>
        <button class="btn small ghost" data-act="next-launch">On next launch</button></div>` };
    }
    if (s.status === 'pending' && s.newer && s.newer.target !== laterFor) {
      const first = s.newer.commits[0]?.subject || '';
      return { html: `<div class="update-line"><span class="update-icon">⬆</span>
        <span class="update-text"><b>Update available</b><small>${changes(s.newer.commits.length)}${first ? `: ${esc(first)}${s.newer.commits.length > 1 ? ' and more' : ''}` : ''}. An earlier update already applies at the next launch.</small></span>
        <button class="btn small primary" data-act="apply-newer">Update now</button>
        <button class="btn small ghost" data-act="later-newer">Later</button></div>` };
    }
    if (s.status === 'applying') return { html: '<div class="update-line"><span class="update-icon">⬆</span><span class="update-text">Updating…</span></div>' };
    if (s.status !== 'available' || s.target === laterFor || (auto() && s.kind === 'live')) return null;
    const first = s.commits[0]?.subject || '';
    const list = expanded ? `<ul class="update-list">${s.commits.map((c) => `<li><code>${esc(c.sha)}</code>${esc(c.subject)}</li>`).join('')}</ul>` : '';
    const error = s.applyError ? `<small class="update-error">Could not update: ${esc(s.applyError)}</small>` : '';
    return { html: `<div class="update-line"><span class="update-icon">⬆</span>
        <span class="update-text"><b>Update available</b><small>${changes(s.commits.length)}${first ? `: ${esc(first)}${s.commits.length > 1 ? ' and more' : ''}` : ''}</small>${error}</span>
        <button class="btn small ghost" data-act="details">${expanded ? 'Hide changes' : 'What’s new'}</button>
        <button class="btn small primary" data-act="apply">Update now</button>
        <button class="btn small ghost" data-act="later">Later</button></div>${list}` };
  }

  function renderBar() {
    const out = state && barHTML(state);
    if (!out) { $bar.hidden = true; $bar.innerHTML = ''; lastHTML = ''; return; }
    $bar.hidden = false;
    $bar.classList.toggle('warn', !!out.warn);
    if (out.html !== lastHTML) { lastHTML = out.html; $bar.innerHTML = out.html; }
  }

  const time = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = (iso) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
  function renderRow() {
    if (!$row) return;
    const on = !!state?.enabled;
    for (const $r of $row.querySelectorAll('input[name=updateMode]')) $r.disabled = !on;
    $check.disabled = !on || checking || state?.checking;
    $check.textContent = checking || state?.checking ? 'Checking…' : 'Check now';
    if (!on) { $info.textContent = 'Running from source: update it with git pull.'; $info.classList.remove('error'); return; }
    const parts = [];
    const onBranch = state.branch && state.branch !== 'main' ? ` on ${state.branch}` : '';
    if (state.current) parts.push(`Running ${state.current.sha}${onBranch} from ${day(state.current.date)}.`);
    if (state.status === 'gone') parts.push(state.error);
    else if (state.status === 'pending' || state.status === 'restart') {
      parts.push('An update is ready and applies at the next launch.');
      if (state.newer) parts.push(`${changes(state.newer.commits.length)} newer available.`);
    }
    else if (state.status === 'available') parts.push(`${changes(state.commits.length)} available.`);
    else if (state.status === 'current' && state.checkedAt && !state.error) parts.push('Up to date.');
    if (state.skipped) parts.push(`Skipping ${short(state.skipped)}, which did not start.`);
    if (state.checkedAt) parts.push(`Last checked ${time(state.checkedAt)}${state.error && state.status !== 'gone' ? ` (failed: ${state.error})` : ''}.`);
    $info.textContent = parts.join(' ');
    $info.classList.toggle('error', !!state.error);
  }

  function update(s) {
    state = s;
    renderBar();
    renderRow();
    autoApply();
  }

  $bar?.addEventListener('click', (e) => {
    const act = e.target.closest('button')?.dataset.act;
    if (act === 'details') { expanded = !expanded; renderBar(); }
    if (act === 'apply') apply();
    if (act === 'later') { laterFor = state?.target; expanded = false; renderBar(); }
    if (act === 'restart') api.restart();
    if (act === 'next-launch') api.later();
    if (act === 'dismiss') api.dismiss();
    if (act === 'gone-ok') { goneSeen = true; renderBar(); }
    if (act === 'apply-newer' && state?.newer) api.apply(state.newer.target);
    if (act === 'later-newer') { laterFor = state?.newer?.target; renderBar(); }
  });
  $check?.addEventListener('click', async () => {
    checking = true; laterFor = null; renderRow();
    try { update(await api.check()); } finally { checking = false; renderRow(); }
  });

  // The desk whose terminal was open before a live update's reload.
  function reopen() {
    let pane = null;
    try { pane = sessionStorage.getItem(REOPEN); sessionStorage.removeItem(REOPEN); } catch { /* no storage */ }
    if (!pane) return;
    const off = window.office.onSnapshot((p) => {
      if (!p.ok) return;
      off();
      setTimeout(() => window.openDesk?.(pane), 300);
    });
  }

  api.onState(update);
  api.get().then(update);
  reopen();
  setInterval(autoApply, 30_000);
  window.officeUpdates = { modeChanged: () => { renderBar(); autoApply(); }, idle };
})();
