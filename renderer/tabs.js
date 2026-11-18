// Office tabs: "Office" (agents no orchestrator owns) plus one tab per orchestrator, and the
// task bar, wizard and close dialog that go with them. Which tab is active
// lives in settings (activeTab); app.js filters the scene by it.
(function () {
  const $tabs = document.getElementById('tabs');
  const $taskbar = document.getElementById('taskbar');
  let orchestrators = [];
  let floors = [];       // unfiltered model, for the wizard and the boss state
  let progressOff = null;
  let openBossPane = null; // pane id of a boss just created: open its terminal when it shows up
  let restoreTerminal = true; // on launch the saved tab is already active, so setActive never opens its terminal
  let drag = null;       // a press on an orchestrator's card, a drag once it moves
  let lastRender = null; // render's arguments, to draw what came in during a drag

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const active = () => window.officeSettings?.get().activeTab || 'office';
  // The agent an orchestrator's boss, QA and ops run (orchestrator.json `agent`).
  const AGENT_LABELS = { claude: 'Claude', pi: 'Pi', codex: 'Codex' };
  const agentLabel = (o) => AGENT_LABELS[o?.agent] || AGENT_LABELS.claude;

  // The terminal last opened on each tab, so switching back lands where the
  // user left off. Remembered per machine; a pane that no longer exists is skipped.
  const PANES_KEY = 'agent-office.tabPanes';
  let tabPanes = {};
  try { tabPanes = JSON.parse(localStorage.getItem(PANES_KEY) || '{}') || {}; } catch { /* keep empty */ }
  function rememberDesk(paneId) {
    tabPanes[active()] = paneId;
    try { localStorage.setItem(PANES_KEY, JSON.stringify(tabPanes)); } catch { /* ignore */ }
  }
  // The terminal to show on a tab: the one last opened there, else (on an
  // orchestrator's tab) its boss.
  function paneFor(slug) {
    const remembered = tabPanes[slug];
    if (remembered && window.officeActions?.find(remembered)) return remembered;
    return orchestrators.find((o) => o.slug === slug)?.boss?.pane_id || null;
  }
  // pane: a terminal to open instead of the one last opened on the tab.
  function openTerminalFor(slug, pane = null) {
    const paneId = pane || paneFor(slug);
    if (!paneId || !window.officeActions?.find(paneId)) return false;
    if (!window.officeTerminal?.isOpenFor(paneId)) window.officeOpenDesk?.(paneId);
    return true;
  }
  function setActive(slug, pane = null) {
    if (slug === active() && !pane) return;
    restoreTerminal = false;
    if (slug !== active()) window.officeSettings?.set({ activeTab: slug });
    openTerminalFor(slug, pane);
  }

  // ---- tab strip ----

  function render(list, allFloors) {
    lastRender = [list, allFloors];
    const bySlug = new Map((list || []).map((o) => [o.slug, o]));
    orchestrators = window.tabOrder.applyOrder([...bySlug.keys()], window.officeSettings?.get().tabOrder).map((s) => bySlug.get(s));
    floors = allFloors || [];
    if (!$tabs) return;
    let cur = active();
    if (cur !== 'office' && !orchestrators.some((o) => o.slug === cur)) { cur = 'office'; setActive('office'); return; }
    const desks = floors.flatMap((f) => f.rooms.flatMap((r) => r.desks));
    if (restoreTerminal && cur !== 'office' && openTerminalFor(cur)) restoreTerminal = false;
    if (openBossPane) {
      // A new boss waits for its task at its desk: put the user there.
      const desk = desks.find((d) => d.id === openBossPane);
      if (desk) { openBossPane = null; window.officeOpenDesk?.(desk.id); }
    }
    // One card per orchestrator: name, what the team is doing, board progress,
    // and a flag on the top border when something waits on the user.
    const html = [
      `<button class="tab office ${cur === 'office' ? 'active' : ''}" data-tab="office" title="Agents no orchestrator owns"><span class="tab-office-icon">🏢</span>Office</button>`,
      ...orchestrators.map((o) => {
        const c = window.officeView.ticketCard(o, desks.filter((d) => d.orch?.slug === o.slug));
        const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
        return `<button class="tab orch ${cur === o.slug ? 'active' : ''}" data-tab="${esc(o.slug)}" style="--orch:${esc(o.color)}" title="${esc(o.name)} · runs ${agentLabel(o)}${c.total ? ` · ${c.done}/${c.total} tasks` : ''} · drag to reorder">
          ${c.flag ? `<span class="tab-flag ${c.flag.kind}">${esc(c.flag.text)}</span>` : ''}
          <span class="tab-name">${esc(o.name)}</span>
          <span class="tab-status"><span class="tab-pill ${c.state}">${c.state}</span><span class="tab-bar"><i style="width:${pct}%"></i></span>${c.total ? `<span class="tab-count">${c.done}/${c.total}</span>` : ''}</span>
          <span class="tab-rename" title="Rename">✎</span><span class="tab-close" title="Close orchestrator">✕</span>
        </button>`;
      }),
      `<button class="tab add" data-tab="+" title="New orchestrator (right-click for archived ones)">+</button>`,
    ].join('');
    // Redraw only on change, so a hovered card keeps its ✕. A drag owns the
    // cards until it ends, then draws the latest data.
    if (!drag?.started && $tabs._html !== html) { $tabs._html = html; $tabs.innerHTML = html; }
    renderTaskbar(cur);
  }

  // ---- reordering ----
  // Drag an orchestrator's card among the others; Office and + stay put. The
  // card follows the pointer and a dashed slot shows where it will land.
  // Option+←/→ moves the focused card. The order is saved in settings.tabOrder.

  const { move, target, inside, press } = window.tabOrder;
  const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const domOrder = () => [...$tabs.querySelectorAll('.tab.orch')].map(($t) => $t.dataset.tab);
  const slots = () => [...$tabs.querySelectorAll('.tab.orch:not(.dragging), .tab-slot')];

  function saveOrder(order) {
    if (order.join('\n') === orchestrators.map((o) => o.slug).join('\n')) return;
    window.officeSettings?.set({ tabOrder: order });
  }

  // Offsets are relative to the strip, since .tabs is positioned. Unlike
  // getBoundingClientRect they skip the slide animations, so the target doesn't flicker.
  function layoutRect($el) { return { left: $el.offsetLeft, top: $el.offsetTop, right: $el.offsetLeft + $el.offsetWidth, bottom: $el.offsetTop + $el.offsetHeight }; }
  function stripPoint(x, y) {
    const r = $tabs.getBoundingClientRect();
    return { x: x - r.left - $tabs.clientLeft + $tabs.scrollLeft, y: y - r.top - $tabs.clientTop + $tabs.scrollTop };
  }

  // A refresh during the press may have redrawn the strip, so find the card again.
  function beginDrag() {
    const $t = $tabs.querySelector(`.tab.orch[data-tab="${CSS.escape(drag.slug)}"]`);
    if (!$t) { release(); return false; }
    drag.$t = $t;
    const r = $t.getBoundingClientRect();
    drag.started = true;
    drag.$slot = document.createElement('div');
    drag.$slot.className = 'tab-slot';
    drag.$slot.style.setProperty('--orch', $t.style.getPropertyValue('--orch'));
    $t.before(drag.$slot);
    drag.home = slots().indexOf(drag.$slot);
    Object.assign($t.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0' });
    $t.classList.add('dragging');
    document.body.classList.add('tab-dragging');
    // Keeps hover effects elsewhere (the whiteboard card) quiet during the drag.
    try { $tabs.setPointerCapture(drag.id); } catch { /* the window listeners still see the pointer */ }
    return true;
  }

  function placeSlot(to) {
    const list = slots(), from = list.indexOf(drag.$slot);
    if (to === from) return;
    const others = list.filter(($el) => $el !== drag.$slot);
    const before = reducedMotion() ? null : new Map(others.map(($el) => [$el, $el.getBoundingClientRect()]));
    const next = move(list, from, to);
    const after = next[next.indexOf(drag.$slot) + 1];
    if (after) after.before(drag.$slot); else next[next.length - 2].after(drag.$slot);
    if (!before) return;
    for (const $el of others) {
      const a = before.get($el), b = $el.getBoundingClientRect();
      const dx = a.left - b.left, dy = a.top - b.top;
      if (dx || dy) $el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: 140, easing: 'ease-out', composite: 'add' });
    }
  }

  function onDragMove(e) {
    if (e.pointerId !== drag.id || drag.ended) return;
    if (!drag.started && (!drag.press.moved(e.clientX, e.clientY) || !beginDrag())) return;
    drag.$t.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px)`;
    const over = inside($tabs.getBoundingClientRect(), e.clientX, e.clientY, 8);
    drag.$t.classList.toggle('off-strip', !over);
    if (!over) return placeSlot(drag.home);
    const p = stripPoint(e.clientX, e.clientY);
    const $office = $tabs.querySelector('.tab.office'), $add = $tabs.querySelector('.tab.add');
    placeSlot(target(slots().map(layoutRect), p.x, p.y, $office && layoutRect($office), $add && layoutRect($add)));
  }

  // keep: the card lands where its slot is; otherwise it goes back home.
  function endDrag(keep) {
    const d = drag;
    if (!d?.started || d.ended) return;
    d.ended = true;
    if (!keep) placeSlot(d.home);
    d.$slot.replaceWith(d.$t);
    d.$t.classList.remove('dragging', 'off-strip');
    for (const k of ['position', 'left', 'top', 'width', 'height', 'margin', 'transform']) d.$t.style.removeProperty(k);
    document.body.classList.remove('tab-dragging');
    if (keep) saveOrder(domOrder());
  }

  // The press is over: stop listening, and swallow the click a drag ends with.
  function release() {
    const d = drag; drag = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
    window.removeEventListener('pointercancel', onDragCancel);
    window.removeEventListener('keydown', onDragKey, true);
    window.removeEventListener('blur', onDragCancel);
    if (d?.started) {
      const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
      $tabs.addEventListener('click', swallow, true);
      setTimeout(() => $tabs.removeEventListener('click', swallow, true), 0);
      if (lastRender) render(...lastRender);
    }
  }
  function onDragUp(e) {
    if (e.pointerId !== drag.id) return;
    endDrag(inside($tabs.getBoundingClientRect(), e.clientX, e.clientY, 8));
    release();
  }
  function onDragCancel() { endDrag(false); release(); }
  // Escape puts the card back; the pointer is still down, so the press ends on release.
  function onDragKey(e) {
    if (e.key !== 'Escape' || !drag?.started || drag.ended) return;
    e.preventDefault(); e.stopPropagation();
    endDrag(false);
  }

  $tabs?.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag) return;
    const $t = e.target.closest('.tab.orch');
    if (!$t || e.target.closest('.tab-close, .tab-rename')) return;
    drag = { slug: $t.dataset.tab, id: e.pointerId, x: e.clientX, y: e.clientY, press: press(e.clientX, e.clientY), started: false };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
    window.addEventListener('pointercancel', onDragCancel);
    window.addEventListener('keydown', onDragKey, true);
    window.addEventListener('blur', onDragCancel);
  });

  $tabs?.addEventListener('keydown', (e) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    const $t = e.target.closest('.tab.orch'); if (!$t || drag) return;
    e.preventDefault();
    const order = orchestrators.map((o) => o.slug), from = order.indexOf($t.dataset.tab);
    const to = from + (e.key === 'ArrowLeft' ? -1 : 1);
    if (from < 0 || to < 0 || to >= order.length) return;
    saveOrder(move(order, from, to));
    $tabs.querySelector(`.tab.orch[data-tab="${CSS.escape($t.dataset.tab)}"]`)?.focus();
  });

  $tabs?.addEventListener('click', (e) => {
    const $t = e.target.closest('.tab'); if (!$t) return;
    if (e.target.closest('.tab-close')) return closeDialog($t.dataset.tab);
    if (e.target.closest('.tab-rename')) return renameDialog($t.dataset.tab);
    if ($t.dataset.tab === '+') return wizard();
    setActive($t.dataset.tab);
  });
  $tabs?.addEventListener('dblclick', (e) => {
    const $t = e.target.closest('.tab.orch'); if (!$t || e.target.closest('.tab-close, .tab-rename')) return;
    renameDialog($t.dataset.tab);
  });
  $tabs?.addEventListener('contextmenu', (e) => {
    const $t = e.target.closest('.tab.orch, .tab.add'); if (!$t) return;
    e.preventDefault();
    if ($t.dataset.tab === '+') return archivedDialog();
    closeDialog($t.dataset.tab);
  });

  // ---- task bar ----

  function bossDesk(o) {
    return floors.flatMap((f) => f.rooms.flatMap((r) => r.desks)).find((d) => d.id === o.boss?.pane_id);
  }

  // Under the tabs, only when the boss has suggestions (## Next on the board):
  // click sends one, ✕ declines it. Tasks and answers go in the boss's terminal.
  function renderTaskbar(cur) {
    if (!$taskbar) return;
    const o = orchestrators.find((x) => x.slug === cur);
    const next = o && bossDesk(o) ? o.board?.next || [] : [];
    if (!next.length) { $taskbar.hidden = true; return; }
    $taskbar.hidden = false;
    $taskbar.dataset.slug = o.slug;
    $taskbar.style.setProperty('--orch', o.color);
    const html = `<span class="next-label">Suggested</span>${next.map((t) => `<span class="next-chip"><button class="next-send" data-text="${esc(t)}" title="Send this to the boss">${esc(t)}</button><button class="next-decline" data-text="${esc(t)}" title="Not now (the boss stops suggesting it)">✕</button></span>`).join('')}`;
    if ($taskbar._html !== html) { $taskbar._html = html; $taskbar.innerHTML = html; }
  }

  $taskbar?.addEventListener('click', async (e) => {
    const $chip = e.target.closest('.next-send, .next-decline'); if (!$chip) return;
    const slug = $taskbar.dataset.slug, text = $chip.dataset.text;
    $chip.closest('.next-chip').remove();
    const r = $chip.classList.contains('next-send')
      ? await window.office.orchestrator.prompt({ slug, text, next: text })
      : await window.office.orchestrator.declineNext({ slug, text });
    if (!r.ok) $taskbar._html = ''; // draw the chip again on the next render
    if (!r.ok) window.officeActions.showModal({ title: 'Could not send the suggestion', body: `<p>${esc(r.error)}</p>`, okLabel: 'Close', cancel: false });
  });

  // ---- wizard ----
  // Name, root folder, branch and optional base. The task is given to the boss
  // at its desk afterwards (the terminal takes images; a text box cannot). The
  // boss decides which repos it needs and opens worktrees on the branch itself.

  let scanTimer = null;
  async function scanInto($list, root) {
    if (!root.trim()) { $list.textContent = 'Pick the folder that holds your repos.'; return; }
    const r = await window.office.orchestrator.scanRepos(root.trim());
    if (!r.ok) { $list.innerHTML = `<span class="warn">${esc(r.error)}</span>`; return; }
    $list.textContent = r.repos.length
      ? `${r.repos.length} repos the boss may open: ${r.repos.map((x) => x.name).join(', ')}`
      : 'No git repos directly under that folder.';
  }

  function wizard() {
    const savedRoot = window.officeSettings?.get().orchRoot || '';
    const savedAgent = AGENT_LABELS[window.officeSettings?.get().orchAgent] ? window.officeSettings.get().orchAgent : 'claude';
    window.officeActions.showModal({
      title: 'New orchestrator',
      body: `
        <label>Name<input id="wz-name" type="text" placeholder="Dark mode" autofocus></label>
        <label>Root folder with your repos
          <span class="wz-inline"><input id="wz-root" type="text" placeholder="~/code" value="${esc(savedRoot)}"><button id="wz-browse" class="btn small" type="button">Browse…</button></span>
        </label>
        <div id="wz-list" class="hint wz-repos"></div>
        <label>Worktree branch <span class="hint">(the boss creates it in each repo it needs)</span><input id="wz-branch" type="text" placeholder="mia/dark-mode"></label>
        <p id="wz-branch-warn" class="warn wz-warn" hidden></p>
        <label>Base <span class="hint">(optional, defaults to each repo's current HEAD)</span><input id="wz-base" type="text" placeholder="main"></label>
        <div class="wz-agent"><span class="hint">Agent for the boss, its workers, QA and ops</span>
          ${Object.entries(AGENT_LABELS).map(([k, label]) => `<label class="check"><input type="radio" name="wz-agent" value="${k}" ${k === savedAgent ? 'checked' : ''}> ${label} <code>${k}</code></label>`).join('')}
        </div>
        <p class="hint">The boss starts and waits at its desk. Its terminal opens when it is ready: give it the task there (images paste with Cmd+V).</p>
        <p><button id="wz-archived" class="btn small" type="button">Restore an archived orchestrator…</button></p>
        <div id="wz-progress" class="wz-progress" hidden></div>`,
      okLabel: 'Create',
      onBodyClick: async (e) => {
        if (e.target.id === 'wz-archived') return archivedDialog();
        if (e.target.id !== 'wz-browse') return;
        const $root = document.getElementById('wz-root');
        const picked = await window.office.workspace.pickFolder({ defaultPath: expand($root.value.trim()) || null });
        if (picked) { $root.value = picked; scanInto(document.getElementById('wz-list'), picked); }
      },
      onOk: async () => {
        const name = document.getElementById('wz-name').value.trim();
        if (!name) throw new Error('Give it a name.');
        const root = document.getElementById('wz-root').value.trim();
        if (!root) throw new Error('Pick the root folder that holds your repos.');
        const branch = document.getElementById('wz-branch').value.trim();
        if (!branch) throw new Error('Give the worktree branch a name.');
        const base = document.getElementById('wz-base').value.trim();
        const agent = document.querySelector('input[name=wz-agent]:checked')?.value || 'claude';
        window.officeSettings?.set({ orchRoot: root, orchAgent: agent });
        const $p = document.getElementById('wz-progress'); $p.hidden = false; $p.textContent = 'Starting…';
        progressOff?.(); progressOff = window.office.orchestrator.onProgress(({ line }) => { $p.textContent = line; });
        const prefs = window.officeSettings?.get() || {};
        const r = await window.office.orchestrator.create({ name, root, branch, base, agent, qa: !!prefs.qa, instructions: prefs.instructions || '' });
        progressOff?.(); progressOff = null;
        if (!r.ok) throw new Error(r.error);
        const o = r.orchestrator;
        setActive(o.slug);
        if (o.boss.status === 'started' && o.boss.pane_id) openBossPane = o.boss.pane_id;
        if (o.boss.status !== 'started') {
          setTimeout(() => window.officeActions.showModal({
            title: `${esc(o.name)} created, but the boss did not start`,
            body: `<p>${esc(o.boss.error || 'unknown error')}</p><p class="hint">Use “Start ${agentLabel(o)} here” on the boss's empty desk to start it by hand.</p>`,
            okLabel: 'Close', cancel: false,
          }), 50);
        }
      },
    });
    const $root = document.getElementById('wz-root'), $list = document.getElementById('wz-list');
    scanInto($list, $root.value);
    $root.addEventListener('input', () => { clearTimeout(scanTimer); scanTimer = setTimeout(() => scanInto($list, $root.value), 350); });
    // A branch that already has worktrees would make the boss reopen them, leftovers included.
    const $branch = document.getElementById('wz-branch'), $warn = document.getElementById('wz-branch-warn');
    let branchTimer = null;
    const checkBranch = async () => {
      const b = $branch.value.trim(); $warn.hidden = true;
      if (!b) return;
      const r = await window.office.orchestrator.worktreeBranches($root.value.trim());
      if (!r.ok || $branch.value.trim() !== b) return;
      const hits = Object.entries(r.branches).filter(([, bs]) => bs.includes(b)).map(([repo]) => repo);
      if (hits.length) { $warn.textContent = `${b} already has a worktree in ${hits.join(', ')}. The boss would reopen it, with whatever an earlier run left there. Pick a fresh name or remove those first.`; $warn.hidden = false; }
    };
    $branch.addEventListener('input', () => { clearTimeout(branchTimer); branchTimer = setTimeout(checkBranch, 400); });
  }
  function expand(p) { return p && p.startsWith('~') ? p.replace(/^~/, window.office.homeDir || '') : p; }

  // ---- close ----
  // Closing removes the orchestrator's worktrees. First choice: commit and push
  // what is in them; second: discard. The dialog shows what each one holds.

  function orchestratorRooms(slug) {
    const out = [];
    for (const f of floors) for (const r of f.rooms) if (r.orch?.slug === slug) out.push({ workspace_id: r.id, path: r.path, repo: f.name, room: r });
    return out;
  }

  // A new name for an orchestrator's card (and its boss's brief).
  function renameDialog(slug) {
    const o = orchestrators.find((x) => x.slug === slug); if (!o) return;
    window.officeActions.showModal({
      title: 'Rename',
      body: `<label>Name<input id="rn-name" type="text" maxlength="60" value="${esc(o.name)}" autofocus></label>`,
      okLabel: 'Rename',
      onOk: async () => {
        const r = await window.office.orchestrator.rename({ slug, name: document.getElementById('rn-name').value });
        if (!r.ok) throw new Error(r.error);
      },
    });
    setTimeout(() => document.getElementById('rn-name')?.select(), 0);
  }

  function closeDialog(slug) {
    const o = orchestrators.find((x) => x.slug === slug); if (!o) return;
    const rooms = orchestratorRooms(slug);
    const workers = rooms.flatMap((x) => x.room.desks).filter((d) => d.kind === 'agent');
    const list = rooms.length
      ? `<ul class="plain cl-list">${rooms.map((x) => `<li data-ws="${esc(x.workspace_id)}"><b>${esc(x.repo)}</b> <span class="hint cl-state">checking…</span></li>`).join('')}</ul>`
      : '<p class="hint">No worktrees on this branch are open.</p>';
    window.officeActions.showModal({
      title: `Close ${esc(o.name)}`,
      body: `
        <p>Stops the boss${workers.length ? ` and ${workers.length} worker${workers.length === 1 ? '' : 's'}` : ''}, removes its worktrees (on <code>${esc(o.branch || '')}</code>${o.branches?.length ? ` and ${o.branches.length} sub-ticket ${o.branches.length === 1 ? 'branch' : 'branches'}` : ''}) from disk and archives the orchestrator. The branches themselves are kept.</p>
        ${list}
        <label class="check"><input type="radio" name="cl-mode" value="push" checked> Commit and push everything first, then remove</label>
        <label class="cl-msg">Commit message<input id="cl-message" type="text" value="${esc(o.board?.title || o.name)}"></label>
        <label class="check"><input type="radio" name="cl-mode" value="discard"> Discard uncommitted changes and unpushed commits, then remove</label>
        <div id="cl-progress" class="wz-progress" hidden></div>`,
      okLabel: 'Close orchestrator', danger: true,
      onOk: async () => {
        const mode = document.querySelector('input[name=cl-mode]:checked')?.value || 'discard';
        const message = document.getElementById('cl-message')?.value || '';
        const $p = document.getElementById('cl-progress'); $p.hidden = false; $p.textContent = 'Closing…';
        progressOff?.(); progressOff = window.office.orchestrator.onProgress(({ line }) => { $p.textContent = line; });
        const r = await window.office.orchestrator.close({
          slug, mode, message,
          worktrees: rooms.map((x) => ({ workspace_id: x.workspace_id, path: x.path, repo: x.repo })),
          workerPanes: workers.map((d) => d.id),
        });
        progressOff?.(); progressOff = null;
        if (!r.ok) throw new Error(`${r.error}\nNothing was removed.`);
        if (active() === slug) setActive('office');
      },
    });
    document.getElementById('modal-body')?.addEventListener('change', (e) => {
      if (e.target.name === 'cl-mode') document.querySelector('.cl-msg')?.classList.toggle('disabled', e.target.value !== 'push');
    });
    if (rooms.length) {
      window.office.orchestrator.worktreeStatus(rooms.map((x) => ({ workspace_id: x.workspace_id, path: x.path, repo: x.repo }))).then((r) => {
        if (!r.ok) return;
        for (const st of r.status) {
          const $li = document.querySelector(`.cl-list li[data-ws="${CSS.escape(st.workspace_id)}"] .cl-state`); if (!$li) continue;
          $li.textContent = st.error ? `git: ${st.error}`
            : [st.dirty ? `${st.dirty} uncommitted file${st.dirty === 1 ? '' : 's'}` : '', st.unpushed ? `${st.unpushed} unpushed commit${st.unpushed === 1 ? '' : 's'}` : '', !st.upstream ? 'branch never pushed' : '']
              .filter(Boolean).join(', ') || 'clean and pushed';
          $li.classList.toggle('warn', !!(st.dirty || st.unpushed || st.error));
        }
      });
    }
  }

  // ---- archived ----
  // Closed orchestrators, and ones archived because their boss workspace went
  // away (a herdr restart does that). Restore brings one back with its board.

  const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

  async function archivedDialog() {
    const list = await window.office.orchestrator.listArchived();
    const rows = list.map((a, i) => {
      const ended = a.ended_reason === 'closed' ? 'closed' : a.ended_reason ? `archived, ${a.ended_reason}` : 'archived';
      const sub = [a.branch, `${ended} ${when(a.ended_at)}`.trim(), a.total ? `${a.done}/${a.total} tasks done` : 'no tasks yet'].filter(Boolean).join(' · ');
      return `
      <li class="wt-row" data-i="${i}" style="--orch:${esc(a.color)}">
        <i class="tab-dot"></i>
        <div class="wt-text">
          <div class="wt-branch">${esc(a.name)}</div>
          <div class="hint">${esc(sub)}</div>
        </div>
        <button class="btn small" data-action="restore" ${a.open ? 'disabled title="An orchestrator with this name is open"' : ''}>Restore</button>
      </li>`;
    }).join('');
    window.officeActions.showModal({
      title: 'Archived orchestrators',
      body: `
        ${rows ? `<ul class="wt-list">${rows}</ul>` : '<p class="hint">Nothing archived.</p>'}
        <p class="hint">Restore gives the boss a new workspace and reopens its last conversation, with its board and inbox. Workers are not restarted: the boss reopens the worktrees it needs.</p>
        <div id="ar-progress" class="wz-progress" hidden></div>`,
      okLabel: 'Done', cancel: false,
      onBodyClick: (e) => {
        const $b = e.target.closest('button[data-action=restore]');
        if ($b && !$b.disabled) restore(list[Number($b.closest('.wt-row').dataset.i)]);
      },
    });
  }

  async function restore(a) {
    const $buttons = [...document.querySelectorAll('#modal-body button, #modal-ok')];
    $buttons.forEach(($b) => { $b.disabled = true; });
    const $p = document.getElementById('ar-progress'); $p.hidden = false; $p.classList.remove('warn'); $p.textContent = `Restoring ${a.name}…`;
    progressOff?.(); progressOff = window.office.orchestrator.onProgress(({ line }) => { $p.textContent = line; });
    const prefs = window.officeSettings?.get() || {};
    const r = await window.office.orchestrator.restore({ id: a.id, qa: !!prefs.qa, instructions: prefs.instructions || '' });
    progressOff?.(); progressOff = null;
    if (!r.ok) {
      $p.textContent = r.error; $p.classList.add('warn');
      $buttons.forEach(($b) => { $b.disabled = $b.dataset.action === 'restore' && $b.hasAttribute('title'); });
      return;
    }
    window.officeActions.hideModal();
    const o = r.orchestrator;
    setActive(o.slug);
    if (o.boss.status === 'started' && o.boss.pane_id) openBossPane = o.boss.pane_id;
    const note = o.boss.status !== 'started'
      ? { title: `${esc(o.name)} is back, but the boss did not start`, body: `<p>${esc(o.boss.error || 'unknown error')}</p><p class="hint">Use “Start ${agentLabel(o)} here” on the boss's empty desk to start it by hand.</p>` }
      : o.boss.resumed === false
        ? { title: `${esc(o.name)} is back with a fresh boss`, body: '<p>No saved conversation was found for this boss, so it started a new one. Its board and inbox are as they were: ask it to pick up from the board.</p>' }
        : null;
    if (note) setTimeout(() => window.officeActions.showModal({ ...note, okLabel: 'Close', cancel: false }), 50);
  }

  window.officeTabs = { render, active, setActive, rememberDesk, wizard, closeDialog, archivedDialog };
})();
