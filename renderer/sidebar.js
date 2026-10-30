// Workspace tree on the left: repo > checkout > panes, like herdr's own
// sidebar. Built from the same floor model as the scene, so it stays in step
// with it, and it lives outside the building so it is still there when the
// terminal panel takes the whole window.
(function () {
  const $side = document.getElementById('sidebar');
  const $tree = document.getElementById('sidebar-tree');
  let lastFloors = [];

  // Collapsed repos, remembered per machine.
  const COLLAPSE_KEY = 'agent-office.sidebar.collapsed';
  let collapsed = new Set();
  try { collapsed = new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); } catch { /* keep empty */ }
  function toggleCollapsed(key) {
    if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed])); } catch { /* ignore */ }
    render(lastFloors);
  }

  const STATE = { working: 'working', blocked: 'needs you', done: 'done', idle: 'idle', unknown: 'unknown', away: 'asking' };

  // PR per checked-out branch, looked up with gh in the background so a room
  // row can show its PR button only when there is one. Kept for a few minutes;
  // a lookup that fails counts as no PR.
  const PR_TTL = 3 * 60 * 1000;
  const prs = new Map(); // `${path}\n${branch}` -> { pr, at, loading }
  function prFor(room) {
    if (!room.path || !room.branch || !window.office?.findPullRequest) return null;
    const key = `${room.path}\n${room.branch}`;
    const hit = prs.get(key);
    if (hit && (hit.loading || Date.now() - hit.at < PR_TTL)) return hit.pr;
    prs.set(key, { pr: hit?.pr || null, at: Date.now(), loading: true });
    window.office.findPullRequest({ folder: room.path }).then((r) => {
      const pr = r.ok ? r.pr : null;
      prs.set(key, { pr, at: Date.now(), loading: false });
      if ((pr?.url || null) !== (hit?.pr?.url || null) || pr?.state !== hit?.pr?.state) render(lastFloors);
    });
    return hit?.pr || null;
  }
  // GitHub's pull-request mark (Octicons, MIT).
  const PR_ICON = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>';

  function roomActions(r) {
    if (!r.path) return '';
    const pr = prFor(r);
    const state = pr ? String(pr.state || '').toLowerCase() : '';
    return `<span class="sb-acts">`
      + (pr ? `<button class="sb-act sb-pr ${esc(state)}" data-act="pr" title="Open PR #${esc(pr.number)} (${esc(state)}) in the browser">${PR_ICON}</button>` : '')
      + `<button class="sb-act" data-act="edit" title="Open in editor">‹›</button></span>`;
  }

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function paneRow(d) {
    const names = window.CHARACTER_NAMES || [];
    const open = window.officeTerminal?.isOpenFor(d.id);
    const cls = `sb-row sb-pane pose-${d.pose} ${d.focused ? 'focused' : ''} ${open ? 'open' : ''}`;
    if (d.pose === 'empty') {
      return `<div class="${cls}" data-pane="${esc(d.id)}" title="${esc(d.cwd)}"><i class="sb-dot"></i><span class="sb-name ${d.label ? 'named' : 'muted'}">${esc(d.label || 'shell')}</span><span class="sb-right">sh</span></div>`;
    }
    const character = d.character != null && names.length ? names[d.character % names.length] : (d.agentKind || 'agent').toUpperCase();
    const mark = d.pose === 'blocked' ? '<span class="sb-mark blocked">✱</span>' : d.pose === 'alert' ? '<span class="sb-mark blocked">⚠</span>' : d.pose === 'done' ? '<span class="sb-mark done">✓</span>' : '';
    // With a custom name the name is the whole label; otherwise character + terminal title.
    const name = d.label || character;
    const sub = d.label ? '' : d.autoTitle;
    // Orchestrator members: coloured square before the name, role in the right column.
    const orch = d.orch ? `<i class="sb-orch" style="background:${esc(d.orch.color)}" title="${esc(d.orch.name)}"></i>` : '';
    const right = d.pose === 'away' ? 'asking' : d.role === 'boss' ? (d.escalated ? 'asks you' : 'orch') : d.role === 'worker' ? 'sub' : d.role === 'qa' ? 'QA' : d.role === 'ops' ? (d.pose === 'alert' ? 'alert' : 'ops') : (STATE[d.pose] || d.pose);
    return `<div class="${cls} ${d.role ? `role-${d.role}` : ''}" data-pane="${esc(d.id)}" title="${esc(character)} · ${esc(d.autoTitle)}${d.orch ? ` · ${esc(d.orch.name)}` : ''}">
      <i class="sb-dot"></i>${orch}<span class="sb-name ${d.label ? 'named' : ''}">${esc(name)}${mark}</span><span class="sb-title">${esc(sub)}</span><span class="sb-right">${right}</span>
    </div>`;
  }

  function render(floors) {
    lastFloors = floors;
    if (!$tree) return;
    // newest repo on top, same as the scene
    $tree.innerHTML = [...floors].reverse().map((f) => {
      const wtCount = f.rooms.filter((r) => r.isLinked).length;
      const rooms = f.rooms.map((r) => {
        const agents = r.desks.filter((d) => d.pose !== 'empty').length;
        return `<div class="sb-row sb-room ${r.isLinked ? 'linked' : 'main'} ${r.focused ? 'focused' : ''} ${r.isBoss ? 'boss' : ''}" data-room="${esc(r.id)}" title="${esc(r.path || r.label)}">
            <i class="sb-sq" ${r.isBoss && f.orchestrator ? `style="background:${esc(f.orchestrator.color)}"` : ''}></i><span class="sb-name">${esc(r.isBoss ? 'boss room' : r.label)}</span>${roomActions(r)}<span class="sb-right">${agents || '–'}</span>
          </div>
          ${r.desks.filter((d) => !d.seat).map(paneRow).join('')}
          <div class="sb-row sb-add" data-add="${esc(r.id)}"><i class="sb-sq faint"></i><span class="sb-name muted">+ shell</span></div>`;
      }).join('');
      const closed = f.closed?.length
        ? `<div class="sb-row sb-closed" data-closed="${esc(f.key)}"><i class="sb-sq faint"></i><span class="sb-name muted">${f.closed.length} closed</span></div>` : '';
      const isCollapsed = collapsed.has(f.key);
      const agents = f.rooms.reduce((n, r) => n + r.desks.filter((d) => d.pose !== 'empty').length, 0);
      const attention = f.rooms.some((r) => r.desks.some((d) => d.pose === 'blocked' || d.pose === 'alert')) ? ' attention' : '';
      const right = isCollapsed ? `${agents} ${agents === 1 ? 'agent' : 'agents'}` : (wtCount ? `${wtCount} wt` : '');
      return `<div class="sb-repo ${isCollapsed ? 'collapsed' : ''}" data-floor="${esc(f.key)}">
          <div class="sb-row sb-repo-head${attention}" data-floor-head="${esc(f.key)}" title="${isCollapsed ? 'Expand' : 'Collapse'}">
            <i class="sb-chevron"></i><span class="sb-name">${esc(f.name)}</span><span class="sb-right">${right}</span>
          </div>
          ${isCollapsed ? '' : rooms + closed}
        </div>`;
    }).join('') + '<div class="sb-row sb-add-repo" data-add-repo="1"><i class="sb-sq faint"></i><span class="sb-name muted">+ repo</span></div>';
  }

  $tree?.addEventListener('click', (e) => {
    const $row = e.target.closest('.sb-row');
    if (!$row) return;
    const $act = e.target.closest('.sb-act');
    if ($act && $row.dataset.room) {
      const x = window.officeActions?.room($row.dataset.room); if (!x) return;
      if ($act.dataset.act === 'edit') return window.officeActions.openInEditor(x.room.path);
      const pr = prFor(x.room);
      return pr ? window.office.openExternal(pr.url) : window.officeActions.openPullRequest(x.room.path);
    }
    if ($row.dataset.pane) return window.officeOpenDesk?.($row.dataset.pane);
    if ($row.dataset.addRepo) return window.officeOpenRepo?.();
    if ($row.dataset.add) {
      const room = lastFloors.flatMap((f) => f.rooms).find((r) => r.id === $row.dataset.add);
      return room && window.officeAddTerminal?.(room);
    }
    if ($row.dataset.closed) {
      const floor = lastFloors.find((f) => f.key === $row.dataset.closed);
      return floor && window.officeShowClosed?.(floor);
    }
    if ($row.dataset.room) {
      const el = document.querySelector(`.room[data-id="${CSS.escape($row.dataset.room)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
    if ($row.dataset.floorHead) {
      const el = document.querySelector(`.floor[data-id="${CSS.escape($row.dataset.floorHead)}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      toggleCollapsed($row.dataset.floorHead);
    }
  });

  // ---- context menu ----
  // Right-click a row (or a desk, pod sign or wall in the scene) for actions.
  const $menu = document.getElementById('ctxmenu');
  function showMenu(items, x, y) {
    if (!$menu || !items.length) return;
    $menu.innerHTML = items.map((it, i) => it === '-' ? '<div class="ctx-sep"></div>'
      : `<button class="ctx-item ${it.danger ? 'danger' : ''}" data-i="${i}" ${it.disabled ? 'disabled' : ''}>${esc(it.label)}</button>`).join('');
    $menu._items = items;
    $menu.hidden = false;
    const r = $menu.getBoundingClientRect();
    $menu.style.left = `${Math.min(x, window.innerWidth - r.width - 6)}px`;
    $menu.style.top = `${Math.min(y, window.innerHeight - r.height - 6)}px`;
  }
  function hideMenu() { if ($menu) { $menu.hidden = true; $menu._items = null; } }
  $menu?.addEventListener('click', (e) => {
    const $b = e.target.closest('.ctx-item'); if (!$b || $b.disabled) return;
    const it = $menu._items?.[Number($b.dataset.i)];
    hideMenu();
    it?.run?.();
  });
  document.addEventListener('mousedown', (e) => { if (!$menu?.hidden && !$menu.contains(e.target)) hideMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });
  window.addEventListener('blur', hideMenu);

  function menuForPane(d) {
    const A = window.officeActions;
    const isShell = d.kind === 'shell';
    return [
      { label: 'Open', run: () => window.officeOpenDesk?.(d.id) },
      ...(d.cwd ? [{ label: 'Open folder in editor', run: () => A.openInEditor(d.cwd) }] : []),
      ...(d.cwd ? [{ label: 'Open pull request', run: () => A.openPullRequest(d.cwd) }] : []),
      { label: 'Rename…', run: () => A.renameDesk(d) },
      ...(isShell ? [{ label: 'Start Claude here', run: () => A.hireAgent(d, 'claude') }, { label: 'Start Pi here', run: () => A.hireAgent(d, 'pi') }] : []),
      '-',
      { label: isShell ? 'Close terminal' : 'Close agent', danger: true, run: () => A.closeDesk(d) },
    ];
  }
  function menuForRoom(room, floor) {
    const A = window.officeActions;
    return [
      ...(room.path ? [{ label: 'Open in editor', run: () => A.openInEditor(room.path) }] : []),
      ...(room.path ? [{ label: 'Open pull request', run: () => A.openPullRequest(room.path) }] : []),
      { label: 'New terminal', run: () => A.addTerminal(room) },
      ...(floor.canManage ? [{ label: 'New worktree…', run: () => A.createWorktree(floor) }] : []),
      // A boss room closes with its tab. A main checkout can leave the office
      // too; only a linked worktree can also be removed from disk.
      ...(room.isBoss ? [] : ['-',
        { label: room.isLinked ? 'Close room (keep worktree on disk)' : 'Close repo (keep checkout on disk)', run: () => A.closeRoom(room) },
        ...(room.isLinked ? [{ label: 'Remove worktree from disk…', danger: true, run: () => A.confirmRemove(room, floor) }] : [])]),
    ];
  }
  function menuForFloor(f) {
    const A = window.officeActions;
    return [
      ...(f.canManage ? [{ label: 'New worktree…', run: () => A.createWorktree(f) }] : []),
      ...(f.closed?.length ? [{ label: `Closed worktrees (${f.closed.length})…`, run: () => A.showClosedList(f) }] : []),
      { label: collapsed.has(f.key) ? 'Expand' : 'Collapse', run: () => toggleCollapsed(f.key) },
      '-',
      { label: 'Open another repo…', run: () => A.openRepo() },
    ];
  }

  $tree?.addEventListener('contextmenu', (e) => {
    const $row = e.target.closest('.sb-row'); if (!$row) return;
    e.preventDefault();
    const A = window.officeActions; if (!A) return;
    let items = [];
    if ($row.dataset.pane) { const d = A.find($row.dataset.pane); if (d) items = menuForPane(d); }
    else if ($row.dataset.room || $row.dataset.add) { const x = A.room($row.dataset.room || $row.dataset.add); if (x) items = menuForRoom(x.room, x.floor); }
    else if ($row.dataset.floorHead || $row.dataset.closed) { const f = A.floor($row.dataset.floorHead || $row.dataset.closed); if (f) items = menuForFloor(f); }
    showMenu(items, e.clientX, e.clientY);
  });
  // Same menus in the scene.
  document.getElementById('building')?.addEventListener('contextmenu', (e) => {
    const A = window.officeActions; if (!A) return;
    const $desk = e.target.closest('.desk');
    const $room = e.target.closest('.room');
    const $label = e.target.closest('.floor-label');
    let items = [];
    if ($desk?._desk) items = menuForPane($desk._desk);
    else if ($room?._room) items = menuForRoom($room._room, $room._floor);
    else if ($label?._floor) items = menuForFloor($label._floor);
    else return;
    e.preventDefault();
    showMenu(items, e.clientX, e.clientY);
  });

  // Drag the right edge to resize; double-click resets. Width lives in settings.
  const $grip = document.getElementById('sidebar-resizer');
  let drag = null;
  $grip?.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = window.sidebarDrag.start($side.getBoundingClientRect().width, e.clientX);
    $grip.setPointerCapture(e.pointerId);
    document.body.classList.add('sidebar-resizing');
    e.preventDefault();
  });
  $grip?.addEventListener('pointermove', (e) => {
    const w = drag?.move(e.clientX);
    if (w == null) return;
    document.documentElement.style.setProperty('--sidebar-width', `${w}px`);
    window.officeTerminal?.layoutChanged?.();
  });
  const endDrag = () => {
    if (!drag) return;
    const w = drag.end();
    drag = null;
    document.body.classList.remove('sidebar-resizing');
    if (w !== null) window.officeSettings?.set({ sidebarWidth: w });
  };
  $grip?.addEventListener('pointerup', endDrag);
  $grip?.addEventListener('pointercancel', endDrag);
  $grip?.addEventListener('dblclick', () => window.officeSettings?.set({ sidebarWidth: 250 }));

  window.officeSidebar = {
    render,
    refresh: () => render(lastFloors),
    setVisible: (on) => { if ($side) $side.hidden = !on; },
  };
})();
