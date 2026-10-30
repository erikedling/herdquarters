// Alerts from the ops agents: a red banner under the top bar on every tab, a
// chime the first time an alert shows up, and a short "recovered" notice when
// the ops agent resolves one. The alert files live in each orchestrator's
// alerts/ folder (see ops-brief.md); which ones are active is
// officeView.activeAlerts. Dismiss writes `dismissed: true` into the file.
(function () {
  const $bar = document.getElementById('alertbar');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const played = new Set();   // alert keys the chime has played for, this run
  let previous = new Map();   // key -> alert, as last rendered
  let expanded = false;
  let lastHTML = '';

  // Two falling tones, about 0.6 s, made on the spot so no audio file ships.
  let ctx = null;
  function chime() {
    if (window.officeSettings?.get().alertSound === false) return;
    try {
      ctx = ctx || new AudioContext();
      const t0 = ctx.currentTime;
      for (const [freq, at] of [[988, 0], [740, 0.22]]) {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = 'triangle'; osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(0.35, t0 + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.36);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0 + at); osc.stop(t0 + at + 0.4);
      }
    } catch { /* no audio device */ }
  }

  function line(a) {
    const where = [a.env, a.repo].filter(Boolean).join(' ');
    return `<div class="alert-line" data-key="${esc(a.key)}" style="--orch:${esc(a.color)}">
        <span class="alert-icon">⚠</span>
        <span class="alert-text"><i class="alert-orch"></i>${esc(a.orchName)}${where ? ` · <b>${esc(where)}</b>` : ''} — ${esc(a.title)}</span>
        ${/^https?:\/\//i.test(a.link || '') ? `<button class="btn small alert-link" data-act="link">Open dashboard ↗</button>` : ''}
        <button class="btn small ghost" data-act="tab">Go to tab</button>
        <button class="btn small ghost" data-act="dismiss" title="Hide this alert in the office. The ops agent keeps watching.">Dismiss</button>
      </div>`;
  }

  function render(orchestrators) {
    if (!$bar) return;
    const view = window.officeView;
    const active = view.activeAlerts(orchestrators);
    for (const a of view.recoveredAlerts(previous, orchestrators)) window.officeNotice?.(`Recovered: ${a.orchName}${a.repo ? ` · ${a.repo}` : ''} — ${a.title}`);
    previous = new Map(active.map((a) => [a.key, a]));
    const fresh = view.newAlertKeys(played, active);
    if (fresh.length) { for (const k of fresh) played.add(k); chime(); }

    if (!active.length) { $bar.hidden = true; $bar.innerHTML = ''; lastHTML = ''; expanded = false; return; }
    const html = active.length === 1 || expanded
      ? `${active.length > 1 ? `<div class="alert-head"><b>⚠ ${active.length} alerts</b><button class="btn small ghost" data-act="collapse">Collapse</button></div>` : ''}${active.map(line).join('')}`
      : `<div class="alert-head"><span class="alert-icon">⚠</span><b>${active.length} alerts</b><span class="alert-text">${esc(active[0].orchName)} — ${esc(active[0].title)}${active.length > 1 ? ' and more' : ''}</span><button class="btn small" data-act="expand">Show all</button></div>`;
    $bar.hidden = false;
    // Pulse for the first seconds of a new alert, then stay solid.
    if (fresh.length) { $bar.classList.remove('pulse'); void $bar.offsetWidth; $bar.classList.add('pulse'); }
    if (html !== lastHTML) { lastHTML = html; $bar.innerHTML = html; }
  }

  $bar?.addEventListener('click', async (e) => {
    const $b = e.target.closest('button[data-act]'); if (!$b) return;
    const act = $b.dataset.act;
    if (act === 'expand' || act === 'collapse') { expanded = act === 'expand'; lastHTML = ''; return render(window.officeLastOrchestrators?.() || []); }
    const a = previous.get($b.closest('.alert-line')?.dataset.key); if (!a) return;
    if (act === 'link') window.office.openExternal(a.link);
    if (act === 'tab') window.officeTabs?.setActive(a.slug);
    if (act === 'dismiss') {
      $b.disabled = true;
      const r = await window.office.orchestrator.dismissAlert({ slug: a.slug, file: a.file });
      if (!r.ok) { $b.disabled = false; window.officeActions?.showModal({ title: 'Could not dismiss the alert', body: `<p>${esc(r.error)}</p>`, okLabel: 'Close', cancel: false }); }
    }
  });

  window.officeAlerts = { render, chime };
})();
