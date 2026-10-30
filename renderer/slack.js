// The Slack dialog: what an orchestrator's Slack watcher watches, the
// messages it found waiting on the user, and how often it checks. Opened from
// the Slack sign on the boss floor, the free Slack desk and the reception
// ticket. The lists redraw while it is open; the input keeps what is typed.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const INTERVALS = [2, 5, 10, 15, 30, 60, 120, 240];
  let orchestrators = [];
  let openSlug = null;

  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    const d = Math.round(s / 86400); return `${d} ${d === 1 ? 'day' : 'days'} ago`;
  }
  const clock = (iso) => { const t = Date.parse(iso || ''); return t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''; };

  // A watch as the user reads it: #channel and @name as typed, links by kind
  // until the watcher has written what they are about.
  function watchLabel(w) {
    if (!w.target.startsWith('http')) return w.target;
    return w.kind === 'thread' ? 'Thread' : w.kind === 'dm' ? 'DM' : 'Channel';
  }

  // Short text for the sign on the boss floor.
  function signText(o) {
    const n = window.officeView.slackWaiting(o).length;
    if (n) return `${n} waiting`;
    const w = o.slack?.watches?.length || 0;
    return w ? `watching ${w}` : 'not watching';
  }

  function listsHTML(o) {
    const s = o.slack || {};
    const state = s.state || {};
    const waiting = window.officeView.slackWaiting(o);
    const watches = s.watches || [];
    const countFor = (target) => waiting.filter((m) => m.watch === target).length;
    const waitingHTML = waiting.length
      ? `<ul class="slack-list">${waiting.map((m) => `
          <li class="slack-msg">
            <div class="slack-msg-head"><b>${esc(m.author || 'Someone')}</b>${m.asked ? ` · ${esc(ago(Date.parse(m.asked)))}` : ''}${m.watch ? ` · <span class="hint">${esc(m.watch.startsWith('http') ? (state.watches?.[m.watch]?.summary || 'thread') : m.watch)}</span>` : ''}</div>
            <div class="slack-msg-title">${esc(m.title || m.text?.split('\n')[0] || '')}</div>
            ${m.why ? `<div class="hint">${esc(m.why)}</div>` : ''}
            <div class="slack-msg-actions">
              ${/^https:\/\//.test(m.link || '') ? `<button type="button" class="btn small" data-open="${esc(m.link)}">Open in Slack</button>` : ''}
              <button type="button" class="btn small ghost" data-dismiss="${esc(m.file)}" title="Not for me, or I'll get to it: stop reminding me">Dismiss</button>
            </div>
          </li>`).join('')}</ul>`
      : '<p class="hint">Nobody is waiting on you.</p>';
    const watchesHTML = watches.length
      ? `<ul class="slack-list">${watches.map((w) => {
        const summary = state.watches?.[w.target]?.summary || w.note;
        const n = countFor(w.target);
        return `<li class="slack-watch">
            <span class="slack-watch-text">${w.target.startsWith('http') ? `<a href="#" data-open="${esc(w.target)}">${esc(watchLabel(w))}</a>` : esc(watchLabel(w))}${summary ? ` <span class="hint">${esc(summary)}</span>` : ''}</span>
            ${n ? `<b class="slack-count">${n} waiting</b>` : ''}
            <button type="button" class="icon-btn danger" data-remove="${esc(w.target)}" title="Stop watching">✕</button>
          </li>`;
      }).join('')}</ul>`
      : '<p class="hint">Nothing yet. Paste a Slack link (Copy link on a message, thread or channel), or type #channel or @name.</p>';
    const interval = Number(s.interval) || 10;
    const options = [...new Set([...INTERVALS, interval])].sort((a, b) => a - b)
      .map((m) => `<option value="${m}" ${m === interval ? 'selected' : ''}>${m} min</option>`).join('');
    const last = state.last_check ? `last check ${esc(clock(state.last_check))}` : watches.length ? 'first check soon' : '';
    return `
      <div class="wb-section">Waiting on you</div>${waitingHTML}
      <div class="wb-section">Watching</div>${watchesHTML}
      <div class="slack-foot">Checks every <select id="slack-interval">${options}</select>${last ? ` · ${last}` : ''}</div>
      ${state.error ? `<p class="warn">Last check failed: ${esc(state.error)}</p>` : ''}`;
  }

  async function call(fn, args) {
    const r = await fn(args);
    if (!r.ok) {
      const $err = document.getElementById('modal-error');
      if ($err) { $err.textContent = r.error; $err.hidden = false; }
    }
    return r;
  }

  async function add() {
    const $in = document.getElementById('slack-add');
    const text = $in?.value.trim(); if (!text) return;
    const r = await call(window.office.slack.addWatch, { slug: openSlug, text });
    if (r.ok) { $in.value = ''; document.getElementById('modal-error').hidden = true; }
  }

  function open(slug) {
    const o = orchestrators.find((x) => x.slug === slug); if (!o) return;
    openSlug = slug;
    window.officeActions.showModal({
      title: `Slack · ${esc(o.name)}`,
      body: `<div id="slack-lists">${listsHTML(o)}</div>
        <div class="slack-add-row"><input id="slack-add" type="text" placeholder="Paste a Slack link, #channel or @name" spellcheck="false"><button type="button" class="btn small" id="slack-add-btn">Watch</button></div>`,
      okLabel: 'Done',
      cancel: false,
      onOk: async () => { openSlug = null; window.office.slack.seen({ slug }); },
      onBodyClick: async (e) => {
        const $t = e.target.closest('[data-open], [data-dismiss], [data-remove], #slack-add-btn'); if (!$t) return;
        e.preventDefault();
        if ($t.id === 'slack-add-btn') return add();
        if ($t.dataset.open) return window.office.openExternal($t.dataset.open);
        if ($t.dataset.dismiss) return call(window.office.slack.dismiss, { slug, file: $t.dataset.dismiss });
        if ($t.dataset.remove) return call(window.office.slack.removeWatch, { slug, target: $t.dataset.remove });
      },
    });
    const $in = document.getElementById('slack-add');
    // Enter adds the watch; the modal would otherwise take it as Done.
    $in.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(); } });
    document.getElementById('slack-lists').addEventListener('change', (e) => {
      if (e.target.id === 'slack-interval') call(window.office.slack.setInterval, { slug, minutes: Number(e.target.value) });
    });
    $in.focus();
    window.office.slack.seen({ slug });
  }

  // New orchestrator data: keep it, and redraw the open dialog's lists.
  function update(list) {
    orchestrators = list || [];
    if (!openSlug) return;
    const $lists = document.getElementById('slack-lists');
    const o = orchestrators.find((x) => x.slug === openSlug);
    if (!$lists || !o || document.getElementById('modal')?.hidden) { openSlug = null; return; }
    // Leave the interval menu alone while it is open.
    if (document.activeElement?.id === 'slack-interval') return;
    const html = listsHTML(o);
    if ($lists._html !== html) { $lists._html = html; $lists.innerHTML = html; }
  }

  window.officeSlack = { open, update, signText };
})();
