// The assistant in the office: the bird (bird.js), its speech bubble and the
// chat window. State comes from main (assistant.js) on 'assistant'; the
// headless session's words stream in on 'assistant-chat'. This file decides
// the bird's mood and where it should be; the bird does the flying.
(function () {
  const $bubble = document.getElementById('bird-bubble');
  const $chat = document.getElementById('assistant-chat');
  if (!$bubble || !$chat || !window.office.assistant) return;
  const { md, linkTarget, officeMarkdown, esc } = window.officeChat;
  const $log = $chat.querySelector('.chat-log');
  const $status = $chat.querySelector('.chat-status');
  const $input = $chat.querySelector('textarea');
  const $tab = document.getElementById('chat-tab');

  let state = null;          // from main: { enabled, running, busy, dreaming, morning, due, upcoming }
  let desks = [], orchestrators = [];
  let live = null;           // the answer being streamed: { el, text }
  let $typing = null;        // the dots while it thinks or uses a tool
  // Answers that came while the chat was closed: { text: the start of the
  // newest, count }. Kept per machine, so a restart does not lose them.
  const UNREAD_KEY = 'pipi.unread';
  let unread = null;
  try { unread = JSON.parse(localStorage.getItem(UNREAD_KEY) || 'null'); } catch { /* none */ }
  function setUnread(u) { unread = u; try { localStorage.setItem(UNREAD_KEY, JSON.stringify(u)); } catch { /* ignore */ } }
  let visit = null;          // a ticket card the bird went to: { slug, until, text }
  const visited = new Map(); // slug -> when the bird last went to tell about it
  let history = false;       // the chat log has been loaded
  let hovering = false;      // the mouse is on the bird or its bubble

  // ---- the bird: mood and where to be ----

  function update() {
    const $bird = document.getElementById('bird');
    const on = !!state?.enabled;
    $bird.hidden = !on;
    window.officeBird.setHidden(!on);
    // The tab bottom right is always there while the chat is closed; a dot when PiPi has something.
    $tab.hidden = !on || !$chat.hidden;
    renderTab();
    window.officeBird.setAlert(!!unread && $chat.hidden);
    if (!on) { $bubble.hidden = true; return; }
    const bird = window.officeBird;
    const calling = state.due.length || state.morning;
    bird.setMood(state.dreaming ? 'dream' : state.busy ? 'talk' : calling ? 'call' : 'idle');

    // Being read: the bird does not fly off with its bubble.
    if (visit && hovering) visit.until = Math.max(visit.until, Date.now() + 5000);
    if (!$chat.hidden) { visit = null; bird.pin(chatPerch); }
    else if (calling) { visit = null; bird.pin(callSpot); }
    else if (unread) { visit = null; bird.pin(tabPerch); }
    else if (!state.dreaming && (visit = visit && visit.until > Date.now() ? visit : nextVisit())) { const slug = visit.slug; bird.pin(() => cardPerch(slug), { peck: () => cardEl(slug) }); }
    else bird.pin(null);
    renderBubble();
  }

  // Something unread: it stands on the PiPi tab, with a "!" over its head.
  const tabPerch = () => { const r = $tab.getBoundingClientRect(); return r.width ? { x: r.left + 34, y: r.top } : null; };
  // The chat is open: it sits on the window's top edge, near the title.
  const chatPerch = () => { const r = $chat.getBoundingClientRect(); return { x: r.left + 40, y: r.top }; };
  // A reminder or the brief: it stands on the top bar's bottom line, in plain sight, flapping.
  const callSpot = () => { const top = document.getElementById('topbar').getBoundingClientRect().bottom; return { x: window.innerWidth * 0.62, y: top }; };
  // Under the ticket's card, on the top bar's bottom edge: the window's top
  // leaves no room to stand on the card itself.
  const cardEl = (slug) => document.querySelector(`.tab.orch[data-tab="${CSS.escape(slug)}"]`);
  function cardPerch(slug) {
    const $card = cardEl(slug);
    if (!$card) return null;
    const r = $card.getBoundingClientRect();
    const bar = document.getElementById('topbar').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: bar.bottom };
  }

  // A ticket with something waiting on the user that the bird has not told
  // about for a while: it flies there and says so for 45 s, longer while the
  // mouse is on it.
  function nextVisit() {
    const now = Date.now();
    for (const o of orchestrators) {
      const n = window.officeView.waitingCount(o, desks.filter((d) => d.orch?.slug === o.slug));
      if (!n || now - (visited.get(o.slug) || 0) < 20 * 60_000) continue;
      visited.set(o.slug, now);
      return { slug: o.slug, until: now + 45_000, text: `${n} ${n === 1 ? 'thing' : 'things'} waiting on you in <b>${esc(o.name)}</b>` };
    }
    return null;
  }

  // ---- the PiPi tab, bottom right ----

  // Unread answers: how many and the start of the newest; else a dot for a
  // due reminder or the morning brief.
  const name = () => esc(window.officeSettings?.assistantName?.() || 'PiPi');
  function renderTab() {
    const html = unread
      ? `<span class="chat-tab-head">🐦 ${name()}<b class="chat-tab-count">${unread.count}</b></span><span class="chat-tab-preview">${esc(unread.text)}</span>`
      : `<span class="chat-tab-head">🐦 ${name()}${state?.due.length || state?.morning ? '<i class="chat-tab-dot"></i>' : ''}</span>`;
    if ($tab._html !== html) { $tab._html = html; $tab.innerHTML = html; }
    $tab.classList.toggle('unread', !!unread);
  }

  // ---- the speech bubble ----

  function renderBubble() {
    const lines = [];
    if (state.morning) lines.push('<div class="bb-line"><b>Good morning!</b> Your brief is ready.</div>');
    for (const r of state.due) lines.push(`<div class="bb-line bb-reminder">⏰ <span>${esc(r.text)}</span><button class="bb-done" data-file="${esc(r.file)}" title="Done">✓</button></div>`);
    if (!lines.length && visit) lines.push(`<div class="bb-line">${visit.text}</div>`);
    const html = $chat.hidden ? lines.join('') : '';
    if ($bubble._html !== html) { $bubble._html = html; $bubble.innerHTML = html; }
    $bubble.hidden = !html;
    birdMoved(window.officeBird.position());
  }
  const chimed = new Set();
  function chimeNew() {
    for (const r of state.due) if (!chimed.has(r.file)) { chimed.add(r.file); window.officeAlerts?.chime(); }
  }

  // Keep the bubble above the bird, inside the window. Near the top bar it
  // goes below instead, so it never covers the cards.
  function birdMoved(p) {
    if ($bubble.hidden) return;
    const w = $bubble.offsetWidth, h = $bubble.offsetHeight;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, p.x - w + 40));
    const bar = document.getElementById('topbar').getBoundingClientRect().bottom;
    const above = p.y - 64 - h > bar;
    $bubble.style.transform = `translate(${Math.round(x)}px, ${Math.round(above ? p.y - 64 - h : p.y + 8)}px)`;
    $bubble.classList.toggle('below', !above);
    $bubble.style.setProperty('--tail', `${Math.round(Math.max(12, Math.min(w - 20, p.x - x)))}px`);
  }

  for (const $el of [$bubble, document.getElementById('bird')]) {
    $el.addEventListener('mouseenter', () => { hovering = true; if (state) update(); });
    $el.addEventListener('mouseleave', () => { hovering = false; if (state) update(); });
  }
  $bubble.addEventListener('click', async (e) => {
    const $done = e.target.closest('.bb-done');
    if ($done) { $done.closest('.bb-reminder').remove(); await window.office.assistant.dismiss({ file: $done.dataset.file }); return; }
    if (visit && !state.due.length && !state.morning) { window.officeTabs?.setActive(visit.slug); visit = null; update(); return; }
    openChat();
  });

  // ---- the chat window ----

  function entryHTML(e) {
    if (e.role === 'user') return `<div class="msg user">${esc(e.text).replace(/\n/g, '<br>')}</div>`;
    if (e.role === 'note') return `<div class="msg note">${esc(e.text)}</div>`;
    return `<div class="msg bot">${md(e.text)}</div>`;
  }
  const atBottom = () => $log.scrollHeight - $log.scrollTop - $log.clientHeight < 40;
  const toBottom = () => { $log.scrollTop = $log.scrollHeight; };
  function append(e) {
    const stick = atBottom();
    $log.insertAdjacentHTML('beforeend', entryHTML(e));
    if ($typing) $log.append($typing); // the dots stay last
    if (stick) toBottom();
  }
  // Three bouncing dots and what it is doing, at the end of the chat; null removes them.
  function setTyping(label) {
    if (!label) { $typing?.remove(); $typing = null; return; }
    const stick = atBottom();
    if (!$typing) {
      $typing = document.createElement('div');
      $typing.className = 'msg bot typing';
      $typing.innerHTML = '<span class="dots"><i></i><i></i><i></i></span><span class="typing-label"></span>';
    }
    $typing.querySelector('.typing-label').textContent = label;
    $log.append($typing);
    if (stick) toBottom();
  }
  async function loadHistory(list) {
    const chat = list || await window.office.assistant.history();
    $log.innerHTML = chat.length ? chat.map(entryHTML).join('') : `<div class="msg note">Say hi to ${name()}! I keep track of what your agents and Slack need from you, set reminders and remember the work.</div>`;
    live = null;
    if ($typing) $log.append($typing);
    history = true;
    toBottom();
  }

  function openChat() {
    $chat.hidden = false;
    document.body.classList.add('chat-open');
    setUnread(null);
    if (!history) loadHistory(); else toBottom();
    if (state?.morning) window.office.assistant.seen();
    setTimeout(() => $input.focus(), 50);
    update();
  }
  function closeChat() {
    $chat.hidden = true;
    document.body.classList.remove('chat-open');
    update();
  }

  const TOOL = (name) => (/slack/i.test(name) ? 'Checking Slack…' : /Microsoft_365|outlook|calendar/i.test(name) ? 'Looking at your calendar…'
    : /^(Write|Edit)$/.test(name) ? 'Writing it down…' : /^(Read|Grep|Glob)$/.test(name) ? 'Reading…' : 'Working on it…');
  function setStatus(text) { $status.textContent = text || (state?.dreaming ? 'Dreaming…' : state && !state.running ? 'Asleep' : ''); }

  window.office.assistant.onChat((ev) => {
    if (ev.type === 'history') { if (!$chat.hidden || history) loadHistory(ev.chat); return; }
    if (ev.type === 'delta') {
      setStatus('Typing…');
      setTyping(null);
      const stick = atBottom();
      if (!live) { $log.insertAdjacentHTML('beforeend', '<div class="msg bot live"></div>'); live = { el: $log.lastElementChild, text: '' }; }
      live.text += ev.text;
      live.el.innerHTML = md(live.text);
      if (stick) toBottom();
    } else if (ev.type === 'message') {
      if (live) { live.el.innerHTML = md(ev.text); live.el.classList.remove('live'); live = null; } else if (history) append({ role: 'assistant', text: ev.text });
      if ($chat.hidden) {
        const text = ev.text.replace(/[*_`#[\]]|\(hq:\/\/[^)]*\)|\(https?:[^)]*\)/g, '').split('\n').find((l) => l.trim())?.trim().slice(0, 90);
        if (text) setUnread({ text, count: (unread?.count || 0) + 1 });
        if (state) update();
      }
    } else if (ev.type === 'tool') {
      setStatus(TOOL(ev.name));
      if (live) { live.el.classList.remove('live'); live = null; }
      setTyping(TOOL(ev.name));
    } else if (ev.type === 'idle') {
      if (live) { live.el.classList.remove('live'); live = null; }
      setTyping(null);
      setStatus(ev.error ? `⚠️ ${ev.error}` : '');
    }
  });

  window.office.assistant.onState((s) => {
    state = s;
    if (s.fixtureUnread && !unread) setUnread(s.fixtureUnread);
    chimeNew();
    if (!$chat.hidden && !live) setStatus(s.busy ? 'Thinking…' : '');
    // A turn the office started (the brief, a dream) shows the dots too.
    if (s.busy && !live && !$typing) setTyping(s.dreaming ? 'Dreaming…' : 'Thinking…');
    if (!s.busy && $typing) setTyping(null);
    update();
  });

  async function send() {
    const text = $input.value.trim();
    if (!text) return;
    $input.value = '';
    if (!history) await loadHistory();
    append({ role: 'user', text });
    toBottom();
    setStatus('Thinking…');
    setTyping('Thinking…');
    const r = await window.office.assistant.send(text);
    if (!r.ok) { setTyping(null); append({ role: 'note', text: `⚠️ ${r.error}` }); }
  }
  $chat.querySelector('.chat-form').addEventListener('submit', (e) => { e.preventDefault(); send(); });
  $input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  $chat.querySelector('.chat-close').addEventListener('click', closeChat);
  $tab.addEventListener('click', openChat);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$chat.hidden && document.getElementById('modal').hidden) closeChat(); });

  // Links in answers open things in the office.
  $log.addEventListener('click', (e) => {
    const $a = e.target.closest('a'); if (!$a) return;
    e.preventDefault();
    const t = linkTarget($a.getAttribute('href'));
    if (!t) return;
    if (t.kind === 'web') return window.office.openExternal(t.url);
    if (t.kind === 'tab') { window.officeTabs?.setActive(t.slug); return; }
    if (t.kind === 'slack') { closeChat(); window.officeSlack?.open(t.slug); return; }
    const desk = desks.find((d) => d.id === t.id);
    if (!desk) { append({ role: 'note', text: 'That desk is gone now.' }); return; }
    closeChat();
    // Its ticket's tab first (or Office), so the terminal opens where the desk is.
    window.officeTabs?.setActive(desk.orch?.slug || 'office', desk.id);
  });

  // ---- what the office looks like, for OFFICE.md ----

  let officeTimer = null, lastOffice = '';
  let finished = new Map(); // slug -> whether its tasks were all done (for the celebration)
  function officeChanged(d, o) {
    desks = d || []; orchestrators = o || [];
    const r = window.officeView.justFinished(finished, orchestrators);
    finished = r.seen;
    for (const slug of r.slugs) window.officeBird?.celebrate(() => cardPerch(slug));
    clearTimeout(officeTimer);
    officeTimer = setTimeout(() => {
      const text = officeMarkdown({ orchestrators, desks, names: window.CHARACTER_NAMES || [] });
      if (text !== lastOffice) { lastOffice = text; window.office.assistant.office(text); }
    }, 1500);
    if (state) update();
  }

  window.officeAssistant = { officeChanged, birdMoved, renamed: () => { renderTab(); if (!$log.querySelector('.msg:not(.note)')) loadHistory(); }, toggleChat: () => ($chat.hidden ? openChat() : closeChat()), openChat };
})();
