// Turns a herdr session snapshot into an office building.
//
//   floor  = one git repo          (workspace.worktree.repo_key, else the label)
//   room   = one workspace         (main checkout or a linked worktree)
//   desk   = one pane              (agent panes get a person, plain shells an empty desk)
//
// Layout memory keeps floors, rooms and desks where they first appeared so
// the picture does not shuffle every time an agent comes or goes.

const $building = document.getElementById('building');
const $reception = document.getElementById('reception-list');
const $conn = document.getElementById('conn');
// The app's name lives in package.json (productName); scripts/brand.js puts it on the bundle.
if (window.office?.appName) { document.title = window.office.appName; const $b = document.getElementById('brand-name'); if ($b) $b.textContent = window.office.appName; }
const $tooltip = document.getElementById('tooltip');

const memory = {
  floorOrder: new Map(),        // floorKey -> index
  roomOrder: new Map(),         // workspaceId -> index
  deskSlots: new Map(),         // workspaceId -> [paneId|null]
  seenSeq: new Map(),           // paneId -> state_change_seq when last focused
  lastStatus: new Map(),        // paneId -> previous agent_status
  finishedSince: new Map(),     // paneId -> seq at which working -> idle/done happened
};

function orderIndex(map, key) {
  if (!map.has(key)) map.set(key, map.size);
  return map.get(key);
}

function assignSlot(wsId, paneId) {
  let slots = memory.deskSlots.get(wsId);
  if (!slots) { slots = []; memory.deskSlots.set(wsId, slots); }
  let i = slots.indexOf(paneId);
  if (i !== -1) return i;
  i = slots.indexOf(null);
  if (i === -1) { slots.push(paneId); return slots.length - 1; }
  slots[i] = paneId;
  return i;
}

function releaseMissingSlots(wsId, livePaneIds) {
  const slots = memory.deskSlots.get(wsId);
  if (!slots) return;
  for (let i = 0; i < slots.length; i++) if (slots[i] && !livePaneIds.has(slots[i])) slots[i] = null;
  while (slots.length && slots[slots.length - 1] === null) slots.pop();
}

// The character (and name) at each agent's desk, kept per pane across
// snapshots and restarts so a boss's PEOPLE.md does not change under it
// (see characters.js). Saved per machine.
const CHARACTERS_KEY = 'agent-office.characters';
const characterBook = (() => {
  let entries = {};
  try { entries = JSON.parse(localStorage.getItem(CHARACTERS_KEY) || '{}') || {}; } catch { /* start empty */ }
  return window.officeCharacters.createBook({ count: window.CHARACTER_COUNT || 1, entries });
})();
let charactersSavedAt = 0;
function saveCharacters(force) {
  if (!force && Date.now() - charactersSavedAt < 60_000) return;
  charactersSavedAt = Date.now();
  try { localStorage.setItem(CHARACTERS_KEY, JSON.stringify(characterBook.toJSON())); } catch { /* ignore */ }
}
function assignCharacter(paneId) {
  const { c, added } = characterBook.assign(paneId);
  if (added) saveCharacters(true);
  return c;
}

function basename(p) { return (p || '').split('/').filter(Boolean).pop() || p || ''; }

// Decide the visual pose for a pane given herdr's status and what we
// remember about it. "done" means: finished since you last looked.
function poseFor(pane, agent, focusedPaneId) {
  if (!agent) return 'empty';
  const id = pane.pane_id;
  const status = agent.agent_status;
  const seq = agent.state_change_seq ?? 0;
  const prev = memory.lastStatus.get(id);
  memory.lastStatus.set(id, status);

  if (focusedPaneId === id) memory.seenSeq.set(id, seq);
  if (prev === 'working' && (status === 'idle' || status === 'done')) memory.finishedSince.set(id, seq);
  if (status === 'working') memory.finishedSince.delete(id);

  if (status === 'blocked') return 'blocked';
  if (status === 'working') return 'working';
  if (status === 'unknown') return 'unknown';
  // idle or done
  const finished = memory.finishedSince.get(id);
  const seen = memory.seenSeq.get(id) ?? -1;
  if (status === 'done' && seen < seq) return 'done';
  if (finished !== undefined && seen < finished) return 'done';
  return 'idle';
}

let lastWorktrees = {};
let lastOrchestrators = [];   // from main: orchestrator.json + parsed board each
let lastModelFloors = null;   // unfiltered model; lastFloors holds the current tab's view

function branchFor(repoKey, checkoutPath) {
  const wt = (lastWorktrees[repoKey]?.worktrees || []).find((w) => w.path === checkoutPath);
  if (!wt) return null;
  if (wt.branch) return wt.branch;
  return wt.is_detached ? 'detached HEAD' : null;
}

function buildModel(snapshot) {
  const agentsByPane = new Map((snapshot.agents || []).map((a) => [a.pane_id, a]));
  saveCharacters(characterBook.touch((snapshot.panes || []).map((p) => p.pane_id)));
  const floors = new Map();

  for (const ws of snapshot.workspaces || []) {
    const wt = ws.worktree;
    const floorKey = wt?.repo_key || `label:${ws.label}`;
    const floorName = wt?.repo_name || ws.label;
    if (!floors.has(floorKey)) {
      floors.set(floorKey, {
        key: floorKey, name: floorName, order: orderIndex(memory.floorOrder, floorKey), rooms: [],
        repoKey: wt?.repo_key || null,
        sourceWorkspaceId: wt ? ws.workspace_id : null,
        canManage: !!wt,
      });
    }
    const isLinked = !!wt?.is_linked_worktree;
    const branch = wt ? branchFor(wt.repo_key, wt.checkout_path) : null;
    const room = {
      id: ws.workspace_id,
      branch: branch || null,
      label: branch || (wt ? (isLinked ? basename(wt.checkout_path) : 'main checkout') : ws.label),
      sub: wt ? (isLinked ? basename(wt.checkout_path) : 'main checkout') : '',
      path: wt?.checkout_path || '',
      isLinked,
      closed: false,
      focused: ws.focused,
      order: orderIndex(memory.roomOrder, ws.workspace_id),
      desks: [],
    };
    const panes = (snapshot.panes || []).filter((p) => p.workspace_id === ws.workspace_id);
    releaseMissingSlots(ws.workspace_id, new Set(panes.map((p) => p.pane_id)));
    for (const pane of panes) {
      const agent = agentsByPane.get(pane.pane_id);
      const pose = poseFor(pane, agent, snapshot.focused_pane_id);
      room.desks.push({
        id: pane.pane_id,
        slot: assignSlot(ws.workspace_id, pane.pane_id),
        pose,
        character: agent ? assignCharacter(pane.pane_id) : null,
        status: agent?.agent_status || 'none',
        // a herdr pane label (Rename… in the sidebar) wins over the terminal title
        label: pane.label || null,
        autoTitle: agent?.terminal_title_stripped || agent?.name || (agent ? agent.agent : 'shell'),
        title: pane.label || agent?.terminal_title_stripped || agent?.name || (agent ? agent.agent : 'shell'),
        agentKind: agent?.agent || null,
        agentName: agent?.name || null,
        kind: agent ? 'agent' : 'shell',
        cwd: pane.foreground_cwd || pane.cwd || '',
        focused: pane.pane_id === snapshot.focused_pane_id,
        seq: agent?.state_change_seq ?? 0,
        room: room.label,
        floor: floorName,
      });
    }
    room.desks.sort((a, b) => a.slot - b.slot);
    floors.get(floorKey).rooms.push(room);
  }

  // Worktrees that exist on disk but have no open workspace. They are not
  // drawn as rooms; the floor label offers them in a list instead.
  for (const f of floors.values()) {
    f.closed = [];
    if (!f.repoKey) continue;
    const openPaths = new Set(f.rooms.map((r) => r.path));
    for (const w of lastWorktrees[f.repoKey]?.worktrees || []) {
      if (openPaths.has(w.path) || w.open_workspace_id || w.is_bare || !w.is_linked_worktree) continue;
      f.closed.push({
        id: `closed:${w.path}`,
        label: w.branch || (w.is_detached ? 'detached HEAD' : basename(w.path)),
        sub: basename(w.path),
        path: w.path,
        isLinked: true,
        closed: true,
        prunable: w.is_prunable,
        desks: [],
      });
    }
    f.closed.sort((a, b) => a.label.localeCompare(b.label));
  }

  const floorList = [...floors.values()].sort((a, b) => a.order - b.order);
  for (const f of floorList) {
    // main checkout first, then worktrees in the order they appeared
    f.rooms.sort((a, b) => (a.isLinked - b.isLinked) || (a.order - b.order));
  }
  return floorList;
}

// ---- rendering (keyed, so CSS animations keep running between updates) ----

function upsert(parent, id, tag, className) {
  let el = parent.querySelector(`:scope > [data-id="${CSS.escape(id)}"]`);
  if (!el) {
    el = document.createElement(tag);
    el.dataset.id = id;
    parent.appendChild(el);
  }
  el.className = className;
  return el;
}

function pruneChildren(parent, keepIds) {
  for (const child of [...parent.children]) {
    if (child.dataset.id && !keepIds.has(child.dataset.id)) child.remove();
  }
}

function orderChildren(parent, ids) {
  ids.forEach((id, i) => {
    const el = parent.querySelector(`:scope > [data-id="${CSS.escape(id)}"]`);
    if (el && parent.children[i] !== el) parent.insertBefore(el, parent.children[i] || null);
  });
}

// ---- orchestrators: mark the boss room and the workers, filter by tab ----

// A sub-ticket's worktree the boss's worker sits in: save its branch on the
// orchestrator, so the room stays in its tab when nobody is there.
const claimed = new Set();
function claimBranch(slug, branch) {
  const key = `${slug}\n${branch}`;
  if (claimed.has(key)) return;
  claimed.add(key);
  window.office.orchestrator?.claimBranch?.({ slug, branch }).then((r) => { if (!r?.ok) claimed.delete(key); });
}

// The boss room is known by workspace id. Worker rooms are any checkout on the
// orchestrator's branch (the boss creates those worktrees itself); the agents
// in them are its workers, so nothing has to be registered when the boss
// opens a new repo.
function annotateOrchestrators(floors) {
  const byBossWs = new Map();
  for (const o of lastOrchestrators) {
    if (o.boss?.workspace_id) byBossWs.set(o.boss.workspace_id, o);
  }
  const bossRooms = new Map(); // slug -> room
  const visitors = new Map();  // slug -> [{...}]
  for (const f of floors) {
    for (const r of f.rooms) {
      const boss = byBossWs.get(r.id);
      const found = !boss ? window.officeView.orchestratorForRoom(r, lastOrchestrators) : { o: null };
      const own = found.o;
      if (found.claim) claimBranch(own.slug, r.branch);
      if (boss) { f.isBoss = true; f.orchestrator = boss; f.name = boss.name; r.isBoss = true; r.label = 'boss'; r.sub = ''; bossRooms.set(boss.slug, r); }
      if (own) r.orch = { slug: own.slug, color: own.color, name: own.name };
      if (boss) r.desks = r.desks.filter((d) => !d.seat); // seats are added again below, after the roles
      for (const d of r.desks) {
        if (boss && d.kind === 'agent') {
          // The boss's own pane is the boss; any other agent in its room is the QA reviewer or the ops agent it opened.
          d.role = d.id === boss.boss?.pane_id ? 'boss' : window.officeView.helperRole(d, boss);
          d.orch = { slug: boss.slug, color: boss.color, name: boss.name };
          // Questions on the board are waiting on the user: the boss puts a hand up.
          if (d.role === 'boss' && boss.board?.questions?.length && d.pose !== 'blocked') { d.pose = 'blocked'; d.escalated = true; }
          // An open alert: the ops agent stands at its desk with a red !, whatever it is doing.
          // herdrPose: the pose from the snapshot, since a board change re-annotates the same desks.
          if (d.role === 'ops') { d.herdrPose ??= d.pose; d.pose = d.herdrPose !== 'blocked' && window.officeView.activeAlerts([boss]).length ? 'alert' : d.herdrPose; }
        } else if (own && d.kind === 'agent') {
          d.role = 'worker'; d.orch = r.orch;
          d.pose = window.officeView.workerPose(d.pose);
          // An open question in the inbox from this repo's worker: the worker has
          // walked over to the boss. Their chair is empty until it is answered.
          const expected = own.workerNames?.[f.name];
          const q = (own.inbox || []).find((m) => m.kind === 'question' && window.officeView.fromWorker(m.from, d, expected));
          if (q) {
            d.asking = { text: q.text, at: q.at, from: q.from };
            d.pose = 'away';
            if (!visitors.has(own.slug)) visitors.set(own.slug, []);
            visitors.get(own.slug).push({ paneId: d.id, character: d.character, color: own.color, name: d.title, repo: f.name, text: q.text, at: q.at });
          }
        }
      }
      if (boss) r.desks.push(...window.officeView.seatsFor(r.desks, boss));
    }
  }
  for (const [slug, list] of visitors) { const r = bossRooms.get(slug); if (r) r.visitors = list.sort((a, b) => a.at - b.at); }
  return floors;
}

// The current tab's view: on Office only what no orchestrator owns, else the
// orchestrator's checkouts plus its boss room.
function viewFloors(floors) {
  const tab = window.officeTabs?.active() || 'office';
  if (tab === 'office') return window.officeView.officeFloors(floors);
  if (!lastOrchestrators.some((x) => x.slug === tab)) return window.officeView.officeFloors(floors);
  return window.officeView.orchestratorFloors(floors, tab);
}

// Re-render everything for the current tab from the last model.
function applyView() {
  if (!lastModelFloors) return;
  const view = viewFloors(lastModelFloors);
  renderBuilding(view);
  renderReception(lastModelFloors);
  window.officeSidebar?.render(view);
  window.officeTabs?.render(lastOrchestrators, lastModelFloors);
}

// Which scene to draw: always 'office' (top-down pixel open-plan) now that the
// building (side view) is gone from settings. Its artwork is still here.
function currentLayout() { return 'office'; }
function deskSVG(desk) {
  const opts = { boss: desk.role === 'boss', tag: desk.role === 'worker' || desk.role === 'qa' || desk.role === 'ops' || desk.role === 'slack' ? desk.orch?.color : null };
  return currentLayout() === 'office' ? figureOfficeSVG(desk.pose, desk.character ?? 0, opts) : figureSVG(desk.pose, desk.character ?? 0, opts);
}
let lastFloors = null;
window.officeRerender = () => applyView();
window.officeOpenDesk = (paneId) => openDesk(paneId);
window.officeAddTerminal = (room) => addTerminal(room);
window.officeShowClosed = (floor) => showClosedList(floor);
window.officeOpenRepo = () => openRepo();
// Actions the sidebar's context menu calls into, looked up by id.
window.officeActions = {
  find: (paneId) => lastDesks.find((d) => d.id === paneId),
  room: (roomId) => (lastFloors || []).flatMap((f) => f.rooms.map((r) => ({ room: r, floor: f }))).find((x) => x.room.id === roomId),
  floor: (key) => (lastFloors || []).find((f) => f.key === key),
  closeDesk, hireAgent, renameDesk, addTerminal, closeRoom, confirmRemove, createWorktree, showClosedList, openRepo, openInEditor, openPullRequest,
  showModal: (opts) => showModal(opts), hideModal: () => hideModal(),
};

function renderBuilding(floors) {
  lastFloors = floors;
  const layout = currentLayout();
  // Newest floor on top, like a building being built upwards.
  const ordered = [...floors].reverse();
  const floorIds = ordered.map((f) => f.key);
  pruneChildren($building, new Set(floorIds));

  for (const floor of ordered) {
    const $floor = upsert($building, floor.key, 'section', `floor ${floor.isBoss ? 'boss' : ''}`);
    if (floor.isBoss) $floor.style.setProperty('--orch', floor.orchestrator.color); else $floor.style.removeProperty('--orch');
    let $label = $floor.querySelector('.floor-label');
    if (!$label) {
      $label = document.createElement('div');
      $label.className = 'floor-label';
      $floor.appendChild($label);
      const $rooms = document.createElement('div');
      $rooms.className = 'rooms';
      $floor.appendChild($rooms);
    }
    const n = floor.rooms.reduce((acc, r) => acc + r.desks.filter((d) => d.pose !== 'empty').length, 0);
    const c = floor.closed?.length || 0;
    const labelHTML = floor.isBoss
      ? `<span class="floor-name">${escapeHtml(floor.name)}</span>${whiteboardHTML(floor.orchestrator)}${slackSignHTML(floor.orchestrator)}`
      : `<span class="floor-name">${escapeHtml(floor.name)}</span><span class="floor-count">${n} ${n === 1 ? 'agent' : 'agents'}</span>`
      + (floor.canManage ? `<div class="floor-actions">
          <button class="btn small floor-add" title="Create a new worktree on ${escapeHtml(floor.name)}">+ worktree</button>
          ${c ? `<button class="btn small ghost floor-closed" title="Worktrees on disk that are not open">${c} closed</button>` : ''}
        </div>` : '');
    // Every snapshot comes through here; rewriting unchanged HTML would drop keyboard focus.
    if ($label._html !== labelHTML) {
      const wbFocused = $label.contains(document.activeElement) && document.activeElement.classList.contains('whiteboard');
      $label._html = labelHTML; $label.innerHTML = labelHTML;
      syncWhiteboards();
      if (wbFocused) $label.querySelector('.whiteboard')?.focus();
    }
    $label._floor = floor;

    const $rooms = $floor.querySelector('.rooms');
    const roomIds = floor.rooms.map((r) => r.id);
    pruneChildren($rooms, new Set(roomIds));
    for (const room of floor.rooms) {
      const $room = upsert($rooms, room.id, 'div', `room ${room.isLinked ? 'linked' : 'main'} ${room.focused ? 'focused' : ''} ${room.isBoss ? 'boss' : ''}`);
      $room._room = room; $room._floor = floor;
      // office layout sizes a pod by how many desk columns it needs (1..3)
      $room.dataset.cols = String(Math.min(3, Math.max(1, room.desks.length)));
      let $door = $room.querySelector('.door');
      if (!$door) {
        $door = document.createElement('div');
        $door.className = 'door';
        $door.innerHTML = '<span class="door-icon"></span><span class="door-text"><span class="door-branch"></span><span class="door-sub"></span></span><span class="door-actions"></span>';
        $room.appendChild($door);
        const $desks = document.createElement('div');
        $desks.className = 'desks';
        $room.appendChild($desks);
      }
      $door.querySelector('.door-icon').textContent = room.isBoss ? '★' : room.isLinked ? '⎇' : '⌂';
      $door.querySelector('.door-branch').textContent = room.label;
      $door.querySelector('.door-sub').textContent = room.sub && room.sub !== room.label ? room.sub : '';
      $door.title = room.path || room.label;
      // A boss room closes with its orchestrator tab. Any other room can be
      // closed; only a linked worktree can also be removed from disk.
      $door.querySelector('.door-actions').innerHTML = (room.path ? `<button class="icon-btn room-edit" title="Open in editor">‹›</button>` : '')
        + `<button class="icon-btn room-add" title="New terminal in this room">+</button>`
        + (room.isBoss ? '' : `<button class="icon-btn room-close" title="${room.isLinked ? 'Close this room (keeps the worktree on disk)' : 'Close this repo (keeps the checkout on disk)'}">–</button>`)
        + (room.isLinked ? `<button class="icon-btn danger room-remove" title="Remove this worktree from disk">✕</button>` : '');

      const $desks = $room.querySelector('.desks');
      const deskIds = room.desks.map((d) => d.id);
      pruneChildren($desks, new Set(deskIds));
      for (const desk of room.desks) {
        const $desk = upsert($desks, desk.id, 'div', `desk pose-${desk.pose} ${desk.seat ? `seat seat-${desk.role}` : ''} ${desk.focused ? 'focused' : ''} ${window.officeTerminal?.isOpenFor(desk.id) ? 'open' : ''}`);
        const roleKey = `${desk.role || ''}:${desk.orch?.color || ''}`;
        if ($desk.dataset.pose !== desk.pose || $desk.dataset.character !== String(desk.character) || $desk.dataset.layout !== layout || $desk.dataset.role !== roleKey) {
          $desk.dataset.pose = desk.pose;
          $desk.dataset.character = String(desk.character);
          $desk.dataset.layout = layout;
          $desk.dataset.role = roleKey;
          $desk.innerHTML = (desk.seat ? `<span class="seat-sign">${escapeHtml(desk.title)}</span>` : `<div class="desk-actions">${desk.kind === 'shell' ? '<button class="icon-btn desk-hire" title="Start an agent (Claude or Pi) at this desk">✦</button>' : ''}<button class="icon-btn danger desk-close" title="Close this terminal">✕</button></div>`)
            + `${deskSVG(desk)}<div class="nameplate"><i class="chip"></i><span class="nameplate-text"></span></div>`;
        }
        $desk.querySelector('.nameplate-text').textContent = desk.seat ? `${desk.title} · free desk` : desk.pose === 'empty' ? (desk.label || 'terminal') : desk.pose === 'away' ? `at the boss · ${desk.title}` : desk.title;
        if (desk.orch) $desk.style.setProperty('--orch', desk.orch.color); else $desk.style.removeProperty('--orch');
        $desk.querySelector('.chip').title = desk.pose;
        $desk._desk = desk;
      }
      orderChildren($desks, deskIds);
      // Workers with an open question stand in the boss room.
      let $vis = $room.querySelector(':scope > .visitors');
      if (room.visitors?.length) {
        if (!$vis) { $vis = document.createElement('div'); $vis.className = 'visitors'; $room.appendChild($vis); }
        const key = `${layout}|${room.visitors.map((v) => v.paneId).join(',')}`;
        if ($vis.dataset.key !== key) {
          $vis.dataset.key = key;
          const draw = layout === 'office' ? figureOfficeVisitorSVG : figureVisitorSVG;
          $vis.innerHTML = room.visitors.map((v) => `<div class="visitor" data-pane="${escapeHtml(v.paneId)}" title="${escapeHtml(v.repo)}: ${escapeHtml(v.text)}">${draw(v.character ?? 0, v.color)}<span class="visitor-name">${escapeHtml(v.name)}</span></div>`).join('');
        }
      } else if ($vis) {
        $vis.remove();
      }
    }
    orderChildren($rooms, roomIds);
  }
  orderChildren($building, floorIds);
  placeAnimals(ordered);
}

// Office animals (office layout only): a cat and/or a dog per floor with
// people on it, placed over the floor in desk-sprite coordinates (3 px per
// unit). An animal that changes target trots there with the walk sprite,
// facing the way it goes; a strolling one walks the bottom of the floor on a
// CSS animation. While a worker is away at the boss both wait under the
// floor's door, side by side.
// The desktop is at unit 33 (99 px) of the 54-unit desk sprite, its legs end at 150 px.
const PET_SPOT = {
  nap: (x, y) => ({ x: x + 75, y: y + 45 }),   // cat: on the desktop, right of the laptop
  sit: { cat: (x, y) => ({ x: x - 6, y: y + 118 }), dog: (x, y) => ({ x: x + 33, y: y + 118 }) },   // cat by the desk's corner, dog in front of it
  wag: (x, y) => ({ x: x + 33, y: y + 118 }),  // dog: in front of the desk, looking up at the waving agent
  lie: (x, y) => ({ x: x + 36, y: y + 112 }),  // dog: at the foot of the desk
};
PET_SPOT.greet = { cat: PET_SPOT.sit.cat, dog: PET_SPOT.wag };
function petSpot(species, mode, $desk, $floor) {
  const at = PET_SPOT[mode];
  return (typeof at === 'function' ? at : at[species])(...offsetWithin($desk, $floor));
}
// On the tiles under the door in the back wall (.floor-label::after), facing it.
function doorSpot(species, $floor) {
  const $wall = $floor.querySelector(':scope > .floor-label');
  const [x, y] = offsetWithin($wall, $floor);
  const mid = x + $wall.clientWidth - parseFloat(getComputedStyle($wall).paddingRight) - parseFloat(getComputedStyle($wall, '::after').width) / 2;
  // The sprites are narrower than their 54px boxes: 42px apart, centred on mid.
  return { x: species === 'dog' ? mid - 6 : mid - 48, y: y + $wall.offsetHeight - 4 };
}
function refreshAnimals() { if (lastFloors) placeAnimals([...lastFloors].reverse()); }
function placeAnimals(floors) {
  const A = window.officeAnimals;
  const species = currentLayout() === 'office' ? A.speciesFor(window.officeSettings?.get()) : [];
  const names = Object.fromEntries(species.map((s) => [s, A.namesFor(s, floors.map((f) => f.key))]));
  for (const floor of floors) {
    const $floor = $building.querySelector(`:scope > [data-id="${CSS.escape(floor.key)}"]`);
    if (!$floor) continue;
    const here = A.hasPeople(floor) ? species : [];
    for (const $p of $floor.querySelectorAll(':scope > .pet')) if (!here.includes($p._species)) $p.remove();
    for (const sp of here) placeAnimal(sp, names[sp].get(floor.key), floor, $floor);
  }
}
function placeAnimal(species, index, floor, $floor) {
  let $pet = $floor.querySelector(`:scope > .pet.${species}`);
  if (!$pet || $pet._index !== index) {
    $pet?.remove();
    $pet = document.createElement('div');
    $pet.className = `pet ${species} mode-stroll`;
    $pet._species = species; $pet._index = index;
    $pet.title = `${window.officeAnimals.SPECIES[species][index].name}, office ${species}`;
    $pet.innerHTML = window.officeAnimals.animalSVG(species, index);
    $pet.addEventListener('transitionend', (e) => { if (e.propertyName === 'left') arrivePet($pet); });
    $floor.appendChild($pet);
  }
  // A hidden office (a terminal fills the window) has no layout to measure.
  if (!$floor.offsetParent) return;
  const target = window.officeAnimals.target(species, floor, $pet._target);
  const $desk = target.deskId && $floor.querySelector(`.desk[data-id="${CSS.escape(target.deskId)}"]`);
  // The dog starts its stroll at the far end, half a lap behind the cat (office.css).
  const to = target.mode === 'wait' ? doorSpot(species, $floor)
    : $desk ? petSpot(species, target.mode, $desk, $floor) : { x: species === 'dog' ? $floor.clientWidth - 66 : 12, y: $floor.clientHeight - 56 };
  const same = $pet._target?.mode === target.mode && $pet._target?.deskId === target.deskId && $pet._to?.x === to.x && $pet._to?.y === to.y;
  // Kept even when the spot is the same: a wait's awayIds can change.
  $pet._target = target;
  if (same) return;
  $pet._to = to;
  clearTimeout($pet._greetTimer);
  if (target.until) $pet._greetTimer = setTimeout(refreshAnimals, target.until - Date.now() + 50);
  // A new animal (a floor just built, say when a tab opens) is already there:
  // it has no spot of its own yet to trot from.
  if (!$pet._placed) {
    $pet._placed = true;
    $pet.style.transition = 'none';
    $pet.style.left = `${to.x}px`; $pet.style.top = `${to.y}px`;
    arrivePet($pet);
    void $pet.offsetLeft;
    $pet.style.transition = '';
    return;
  }
  // Freeze a strolling animal where it is, then trot from there.
  const from = { x: $pet.offsetLeft, y: $pet.offsetTop };
  $pet.style.left = `${from.x}px`; $pet.style.top = `${from.y}px`;
  $pet.className = `pet ${species} mode-trot`;
  $pet.classList.toggle('left', to.x < from.x);
  void $pet.offsetLeft; // start the transition from the frozen spot
  $pet.style.left = `${to.x}px`; $pet.style.top = `${to.y}px`;
  if (Math.abs(to.x - from.x) < 1) arrivePet($pet); // no horizontal move, so no transitionend
}
function arrivePet($pet) {
  const mode = $pet._target?.mode || 'stroll';
  $pet.className = `pet ${$pet._species} mode-${mode}`;
  if (mode === 'wait' && $pet._species === 'dog') $pet.classList.add('left');
  // The stroll animation drives left/top itself.
  if (mode === 'stroll') { $pet.style.left = ''; $pet.style.top = ''; }
}
// Position of el's top-left inside ancestor, in its CSS pixels (unaffected by zoom).
function offsetWithin(el, ancestor) {
  let x = 0, y = 0;
  for (let n = el; n && n !== ancestor; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
  return [x, y];
}
function petAnimal($pet) {
  $pet.classList.remove('petted'); void $pet.offsetLeft; $pet.classList.add('petted');
}
window.addEventListener('resize', refreshAnimals);

// The boss's whiteboard: a one-line summary in the wall; hover for the board.
function whiteboardHTML(o) {
  const b = o.board || { tasks: [], blockers: [] };
  const done = b.tasks.filter((t) => t.done).length, total = b.tasks.length;
  const age = o.boardMtime ? timeAgo(o.boardMtime) : '';
  const summary = total ? `${done}/${total} tasks` : 'No board yet';
  return `<button type="button" class="whiteboard" data-orch="${escapeHtml(o.slug)}" aria-controls="tooltip" title="Hover for the board, click to pin it">
      <span class="wb-title">${escapeHtml(b.title || o.name)}</span>
      <span class="wb-meta">${summary}${(b.questions || []).length ? ` · <b class="wb-blocked">${b.questions.length} for you</b>` : ''}${b.answeredCount ? ` · ${b.answeredCount} answered` : ''}${b.blockers.length ? ` · <b class="wb-blocked">${b.blockers.length} blocked</b>` : ''}${age ? ` · ${age}` : ''}</span>
    </button>`;
}
// Under the whiteboard: the Slack watcher's sign. Click: the Slack dialog.
function slackSignHTML(o) {
  const t = window.officeView.slackTicket(o);
  return `<button type="button" class="slack-sign ${t && t.state !== 'quiet' ? 'hot' : ''}" data-slack="${escapeHtml(o.slug)}" title="Slack threads and channels this boss watches for you">
      <b>Slack</b> · ${escapeHtml(window.officeSlack.signText(o))}
    </button>`;
}
function timeAgo(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
function boardTooltipHTML(o) {
  const b = o.board || { tasks: [], blockers: [], raw: '' };
  const workers = lastDesks.filter((d) => d.orch?.slug === o.slug && d.role === 'worker');
  const tasks = b.tasks.length
    ? `<ul class="wb-tasks">${window.officeBoard.boardRowsHTML(window.officeBoard.boardRows(b.tasks), o.slug)}</ul>`
    : (b.raw?.trim() ? `<pre class="tt-screen">${escapeHtml(b.raw.trim())}</pre>` : '<p class="hint">The boss has not written the board yet.</p>');
  const blockers = b.blockers.length ? `<div class="wb-section">Blockers</div><ul class="wb-blockers">${b.blockers.map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : '';
  const asks = (b.questions || []).length ? `<div class="wb-section">Questions for you</div><ul class="wb-blockers">${b.questions.map((q) => `<li>${escapeHtml(q.text)}${q.owner ? ` <span class="wb-owner">@${escapeHtml(q.owner.replace(`${o.slug}-`, ''))}</span>` : ''}</li>`).join('')}</ul>` : '';
  const waiting = lastDesks.filter((d) => d.orch?.slug === o.slug && d.asking);
  const visitors = waiting.length ? `<div class="wb-section">Waiting on the boss</div><ul class="wb-workers">${waiting.map((d) => `<li><i class="chip" style="background:${escapeHtml(o.color)}"></i>${escapeHtml(d.floor)} · ${escapeHtml(d.title)}<span class="wb-state">${escapeHtml(timeAgo(d.asking.at))}</span></li><li class="wb-q">${escapeHtml(d.asking.text)}</li>`).join('')}</ul>` : '';
  const live = workers.length
    ? `<div class="wb-section">Workers</div><ul class="wb-workers">${workers.map((d) => `<li><i class="chip ${d.pose}"></i>${escapeHtml(d.floor)} · ${escapeHtml(d.room)} <span class="wb-state">${escapeHtml(d.pose === 'blocked' ? 'needs you' : d.pose)}</span></li>`).join('')}</ul>`
    : '<div class="wb-section">Workers</div><p class="hint">No workers running.</p>';
  return `<div class="tt-head"><i class="chip" style="background:${escapeHtml(o.color)}"></i><div class="tt-title">${escapeHtml(b.title || o.name)}</div></div>
    <div class="tt-meta">${escapeHtml(o.name)}${b.updated ? ` · updated ${escapeHtml(b.updated)}` : ''}</div>
    ${tasks}${asks}${visitors}${blockers}${live}`;
}

// Reception sees the whole office, whatever tab is open: a ticket for a desk
// on another tab switches there when clicked.
function renderReception(floors) {
  const needs = window.officeView.needsAttention(floors);
  // A boss with questions on its board: one ticket, however many there are.
  // Click: its tab and its terminal, where the user answers.
  const questions = lastOrchestrators.filter((o) => o.board?.questions?.length && o.boss?.pane_id).map((o) => {
    const qs = o.board.questions;
    return `
        <button class="ticket blocked" data-tab="${escapeHtml(o.slug)}" data-pane="${escapeHtml(o.boss.pane_id)}" style="--orch:${escapeHtml(o.color)}" title="${escapeHtml(qs.map((q) => `• ${q.text}`).join('\n'))}">
          <span class="ticket-state">needs you <i class="ticket-orch"></i>${escapeHtml(o.name)} · boss</span>
          <span class="ticket-title">${escapeHtml(qs[0].text)}</span>
          <span class="ticket-where">${qs.length === 1 ? '1 question' : `${qs.length} questions`} · open the conversation</span>
        </button>`;
  }).join('');
  // Open alerts from the ops agents come first. Click: that tab and the ops agent's terminal.
  const alerts = window.officeView.activeAlerts(lastOrchestrators).map((a) => {
    const ops = lastDesks.find((d) => d.orch?.slug === a.slug && d.role === 'ops' && !d.seat);
    return `
        <button class="ticket alert" data-tab="${escapeHtml(a.slug)}" ${ops ? `data-pane="${escapeHtml(ops.id)}"` : ''} style="--orch:${escapeHtml(a.color)}">
          <span class="ticket-state">⚠ alert <i class="ticket-orch"></i>${escapeHtml(a.orchName)}</span>
          <span class="ticket-title">${escapeHtml(a.title)}</span>
          <span class="ticket-where">${escapeHtml([a.env, a.repo].filter(Boolean).join(' · ') || 'ops')}</span>
        </button>`;
  }).join('');
  // Slack messages waiting on the user, one ticket per orchestrator. New ones and the
  // daily reminder go above the desks; the rest stay at the bottom, quiet.
  const slack = lastOrchestrators.map((o) => ({ o, t: window.officeView.slackTicket(o) })).filter((x) => x.t);
  const slackTicketHTML = ({ o, t }) => `
        <button class="ticket slack ${t.state}" data-tab="${escapeHtml(o.slug)}" data-slack="${escapeHtml(o.slug)}" style="--orch:${escapeHtml(o.color)}">
          <span class="ticket-state">${t.state === 'reminder' ? 'still waiting' : 'Slack'} <i class="ticket-orch"></i>${escapeHtml(o.name)}</span>
          <span class="ticket-title">${escapeHtml(t.newest.author ? `${t.newest.author}: ${t.newest.title || ''}` : t.newest.title || 'Someone is waiting on you')}</span>
          <span class="ticket-where">${t.count} waiting on you in Slack</span>
        </button>`;
  const slackHot = slack.filter((x) => x.t.state !== 'quiet').map(slackTicketHTML).join('');
  const slackQuiet = slack.filter((x) => x.t.state === 'quiet').map(slackTicketHTML).join('');
  $reception.innerHTML = alerts + questions + slackHot + (needs.length
    ? needs.map((d) => `
        <button class="ticket ${d.pose}" data-pane="${escapeHtml(d.id)}" data-tab="${escapeHtml(d.orch?.slug || 'office')}" ${d.orch ? `style="--orch:${escapeHtml(d.orch.color)}"` : ''}>
          <span class="ticket-state">${d.pose === 'blocked' ? 'needs you' : 'done'}${d.orch ? ` <i class="ticket-orch"></i>${escapeHtml(d.orch.name)}${d.role === 'boss' ? ' · boss' : d.role === 'qa' ? ' · QA' : d.role === 'ops' ? ' · ops' : d.role === 'slack' ? ' · Slack' : ''}` : ''}</span>
          <span class="ticket-title">${escapeHtml(d.title)}</span>
          <span class="ticket-where">${escapeHtml(d.floor)} · ${escapeHtml(d.room)}</span>
        </button>`).join('')
    : (questions || alerts || slack.length ? '' : '<div class="ticket-empty">Nobody is waiting for you.</div>')) + slackQuiet;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- interaction ----

let lastDesks = [];
function openDesk(paneId) {
  const d = lastDesks.find((x) => x.id === paneId);
  if (!d) return;
  window.office.focusPane(d.id);
  window.officeTabs?.rememberDesk(d.id);
  window.officeTerminal.open({ paneId: d.id, title: d.kind === 'shell' ? 'Terminal' : d.title, floor: d.floor, room: d.room, pose: d.pose, kind: d.kind })
    .then(() => window.officeSidebar?.refresh(), () => window.officeSidebar?.refresh());
}
$building.addEventListener('click', (e) => {
  const $btn = e.target.closest('button');
  if ($btn?.classList.contains('slack-sign')) return window.officeSlack.open($btn.dataset.slack);
  if ($btn) {
    const $room = $btn.closest('.room');
    if ($btn.classList.contains('room-remove')) return confirmRemove($room._room, $room._floor);
    if ($btn.classList.contains('room-close')) return closeRoom($room._room);
    if ($btn.classList.contains('room-add')) return addTerminal($room._room);
    if ($btn.classList.contains('room-edit')) return openInEditor($room._room.path);
    const $desk = $btn.closest('.desk');
    if ($btn.classList.contains('desk-close') && $desk?._desk) return closeDesk($desk._desk);
    if ($btn.classList.contains('desk-hire') && $desk?._desk) return hireAgent($desk._desk);
    if ($btn.classList.contains('floor-add')) return createWorktree($btn.closest('.floor-label')._floor);
    if ($btn.classList.contains('floor-closed')) return showClosedList($btn.closest('.floor-label')._floor);
    return;
  }
  const $pet = e.target.closest('.pet');
  if ($pet) return petAnimal($pet);
  const $v = e.target.closest('.visitor');
  if ($v?.dataset.pane) return openDesk($v.dataset.pane);
  const $desk = e.target.closest('.desk');
  if ($desk?._desk?.seat) return $desk._desk.role === 'slack' ? window.officeSlack.open($desk._desk.orch.slug) : seatDialog($desk._desk);
  if ($desk?._desk) openDesk($desk._desk.id);
});

// A free QA or Ops desk in a boss room: say what the role does and ask the
// boss to start it with a ready-made prompt the user can edit.
function seatDialog(seat) {
  const o = lastOrchestrators.find((x) => x.slug === seat.orch.slug); if (!o) return;
  const prompt = seat.role === 'ops'
    ? 'Watch the deploy of <PR or branch> to prod for 30 min.'
    : 'Run the QA review now, on every worktree.';
  showModal({
    title: `${escapeHtml(seat.title)} desk · ${escapeHtml(o.name)}`,
    body: `<p>${escapeHtml(seat.about)}</p><p class="hint">This goes to the boss, which gives the desk to its ${seat.role === 'ops' ? 'ops agent' : 'QA reviewer'}:</p><textarea id="seat-prompt" class="seat-prompt" rows="3" spellcheck="false">${escapeHtml(prompt)}</textarea>`,
    okLabel: seat.role === 'ops' ? 'Watch deploy' : 'Review now',
    onOk: async () => {
      const text = document.getElementById('seat-prompt').value.trim(); if (!text) throw new Error('Write what the boss should do.');
      const r = await window.office.orchestrator.prompt({ slug: o.slug, text });
      if (!r.ok) throw new Error(r.error);
    },
  });
  // Select the placeholder so typing the PR replaces it.
  setTimeout(() => { const $t = document.getElementById('seat-prompt'); if (!$t) return; $t.focus(); const at = prompt.indexOf('<'); if (at !== -1) $t.setSelectionRange(at, prompt.indexOf('>') + 1); }, 0);
}

// ---- desk actions ----

async function addTerminal(room) {
  const r = await window.office.pane.create({ workspace_id: room.id });
  if (!r.ok) showModal({ title: 'Could not open a terminal', body: `<p>${escapeHtml(r.error)}</p>`, okLabel: 'Close', cancel: false });
}

async function closeDesk(desk) {
  const doClose = async () => {
    if (window.officeTerminal.isOpenFor(desk.id)) await window.officeTerminal.close();
    const r = await window.office.pane.close({ pane_id: desk.id });
    if (!r.ok) throw new Error(r.error);
  };
  // A plain shell with nothing running closes straight away.
  if (desk.kind === 'shell') {
    const pi = await window.office.pane.processInfo({ pane_id: desk.id });
    const procs = (pi.ok && pi.info?.foreground_processes) || [];
    const busy = procs.filter((p) => !/^(-?)(zsh|bash|fish|sh)$/.test(p.name || ''));
    if (!busy.length) {
      try { await doClose(); } catch (err) { showModal({ title: 'Could not close terminal', body: `<p>${escapeHtml(err.message)}</p>`, okLabel: 'Close', cancel: false }); }
      return;
    }
    showModal({
      title: 'Close terminal?',
      body: `<p class="warn">Something is still running here:</p><ul class="plain">${busy.map((p) => `<li><code>${escapeHtml(p.cmdline || p.name)}</code></li>`).join('')}</ul><p>Closing the terminal ends it.</p>`,
      okLabel: 'Close terminal', danger: true, onOk: doClose,
    });
    return;
  }
  showModal({
    title: 'Close this agent?',
    body: `<p><b>${escapeHtml(desk.title)}</b><br><span class="hint">${escapeHtml(desk.floor)} · ${escapeHtml(desk.room)}</span></p><p class="warn">The agent session ends. Anything it has not written to disk is lost.</p>`,
    okLabel: 'Close agent', danger: true, onOk: doClose,
  });
}

// The agents a shell desk can start (herdr's --kind). kind: one of them, or
// null to let the user pick in the dialog.
const AGENT_KINDS = { claude: 'Claude', pi: 'Pi' };
async function hireAgent(desk, kind = null) {
  const choice = Object.entries(AGENT_KINDS)
    .map(([k, label], i) => `<label class="check"><input type="radio" name="hire-kind" value="${k}" ${i === 0 ? 'checked' : ''}> ${label} <code>${k}</code></label>`).join('');
  showModal({
    title: kind ? `Start ${AGENT_KINDS[kind]} here?` : 'Start an agent here?',
    body: `${kind ? `<p>Runs <code>${kind}</code> in this terminal and waits for it to come up.</p>` : `<p>Runs the agent in this terminal and waits for it to come up.</p>${choice}`}<p class="hint">${escapeHtml(desk.cwd)}</p>`,
    okLabel: 'Start',
    onOk: async () => {
      const k = kind || document.querySelector('input[name=hire-kind]:checked')?.value || 'claude';
      const r = await window.office.pane.startAgent({ pane_id: desk.id, name: `${k}-${desk.id.replace(':', '-')}`, kind: k });
      if (!r.ok) throw new Error(r.error);
    },
  });
}

// Open a folder in the editor from settings; a failure says what to fix.
async function openInEditor(folder) {
  const editor = window.officeSettings?.get().editor || '';
  const r = await window.office.openInEditor({ editor, folder });
  if (!r.ok) showModal({ title: 'Could not open editor', body: `<p>${escapeHtml(r.error)}</p><p class="hint">The editor command is in settings (⚙).</p>`, okLabel: 'Close', cancel: false });
}

// Open the PR of the branch checked out in a folder; says so when there is none.
async function openPullRequest(folder) {
  const r = await window.office.findPullRequest({ folder });
  if (r.ok && r.pr) return window.office.openExternal(r.pr.url);
  showModal({
    title: r.ok ? 'No pull request' : 'Could not look up the pull request',
    body: r.ok ? `<p>The branch checked out here has no pull request on GitHub.</p><p class="hint">${escapeHtml(folder)}</p>` : `<p>${escapeHtml(r.error)}</p>`,
    okLabel: 'Close', cancel: false,
  });
}

// ---- worktree actions ----

async function openWorktree(room, floor) {
  const r = await window.office.worktree.open({ workspace_id: floor.sourceWorkspaceId, path: room.path });
  if (!r.ok) showModal({ title: 'Could not open worktree', body: `<p>${escapeHtml(r.error)}</p>`, okLabel: 'Close', cancel: false });
}

// Closes the room's herdr workspace. Nothing is deleted: a linked worktree
// turns up in the floor's closed list, a main checkout comes back via "+ repo".
async function closeRoom(room) {
  const agents = room.desks.filter((d) => d.pose !== 'empty');
  const what = room.isLinked ? 'room' : 'repo';
  const doClose = async () => {
    const r = await window.office.worktree.close({ workspace_id: room.id });
    if (!r.ok) throw new Error(r.error);
  };
  if (!agents.length) {
    try { await doClose(); } catch (err) { showModal({ title: `Could not close ${what}`, body: `<p>${escapeHtml(err.message)}</p>`, okLabel: 'Close', cancel: false }); }
    return;
  }
  showModal({
    title: `Close ${what}?`,
    body: `
      <p><b>${escapeHtml(room.label)}</b><br><span class="hint">${escapeHtml(room.path)}</span></p>
      <p class="warn">${agents.length === 1 ? 'One agent is' : `${agents.length} agents are`} still working here and will be shut down:</p>
      <ul class="plain">${agents.map((a) => `<li>${escapeHtml(a.title)}</li>`).join('')}</ul>
      <p>${room.isLinked ? 'The worktree stays on disk. You can open the room again later.' : 'The checkout stays on disk. Open the repo again with “+ repo”.'}</p>`,
    okLabel: `Close ${what}`,
    danger: true,
    onOk: doClose,
  });
}

function showClosedList(floor) {
  const rows = floor.closed.map((w, i) => `
    <li class="wt-row" data-i="${i}">
      <div class="wt-text">
        <div class="wt-branch">${escapeHtml(w.label)}</div>
        <div class="hint">${escapeHtml(w.sub)}${w.prunable ? ' · missing on disk' : ''}</div>
      </div>
      <button class="btn small" data-action="open" ${w.prunable ? 'disabled' : ''}>Open</button>
      <button class="icon-btn danger" data-action="remove" title="Remove from disk">✕</button>
    </li>`).join('');
  showModal({
    title: `Closed worktrees on ${escapeHtml(floor.name)}`,
    body: rows ? `<ul class="wt-list">${rows}</ul>` : '<p class="hint">Nothing closed.</p>',
    okLabel: 'Done', cancel: false,
    onBodyClick: async (e) => {
      const $b = e.target.closest('button[data-action]'); if (!$b) return;
      const w = floor.closed[Number($b.closest('.wt-row').dataset.i)];
      if ($b.dataset.action === 'open') { hideModal(); await openWorktree(w, floor); }
      if ($b.dataset.action === 'remove') confirmRemove(w, floor);
    },
  });
}

function createWorktree(floor) {
  showModal({
    title: `New worktree on ${escapeHtml(floor.name)}`,
    body: `
      <label>Branch<input id="wt-branch" type="text" placeholder="mia/my-change" autofocus></label>
      <label>Base <span class="hint">(optional, defaults to the current HEAD)</span><input id="wt-base" type="text" placeholder="main"></label>
      <p class="hint">Herdr creates the checkout under ~/.herdr/worktrees and opens it as a new room.</p>`,
    okLabel: 'Create',
    onOk: async () => {
      const branch = document.getElementById('wt-branch').value.trim();
      const base = document.getElementById('wt-base').value.trim();
      if (!branch) throw new Error('Branch name is required.');
      const r = await window.office.worktree.create({ workspace_id: floor.sourceWorkspaceId, branch, base: base || null });
      if (!r.ok) throw new Error(r.error);
    },
  });
}

// Give a pane your own name. Stored by herdr as the pane label, so it shows
// in herdr too and survives this app restarting. Empty clears it.
function renameDesk(desk) {
  showModal({
    title: 'Rename',
    body: `
      <label>Name<input id="rn-label" type="text" value="${escapeHtml(desk.label || '')}" placeholder="${escapeHtml(desk.autoTitle)}" autofocus></label>
      <p class="hint">Leave empty to go back to the automatic name${desk.kind === 'agent' ? ' (the agent\'s terminal title)' : ''}.</p>`,
    okLabel: 'Rename',
    onOk: async () => {
      const label = document.getElementById('rn-label').value.trim();
      const r = await window.office.pane.rename({ pane_id: desk.id, label: label || null });
      if (!r.ok) throw new Error(r.error);
    },
  });
  setTimeout(() => document.getElementById('rn-label')?.select(), 0);
}

// Open a repo as a new workspace (a new floor). Type a path or browse for one.
function openRepo() {
  showModal({
    title: 'Open repo',
    body: `
      <label>Folder<input id="repo-path" type="text" placeholder="~/code/my-repo" autofocus></label>
      <p><button id="repo-browse" class="btn small" type="button">Browse…</button></p>
      <p class="hint">Opens the folder as a new herdr workspace. If it is a git checkout it becomes a new repo in the office.</p>`,
    okLabel: 'Open',
    onBodyClick: async (e) => {
      if (e.target.id !== 'repo-browse') return;
      const $in = document.getElementById('repo-path');
      const picked = await window.office.workspace.pickFolder({ defaultPath: expandHome($in.value.trim()) || null });
      if (picked) $in.value = picked;
    },
    onOk: async () => {
      const cwd = expandHome(document.getElementById('repo-path').value.trim());
      if (!cwd) throw new Error('Pick a folder.');
      const r = await window.office.workspace.create({ cwd, label: basename(cwd) });
      if (!r.ok) throw new Error(r.error);
    },
  });
}
function expandHome(p) { return p && p.startsWith('~') ? p.replace(/^~/, window.office.homeDir || '') : p; }

function confirmRemove(room, floor) {
  const agents = room.desks.filter((d) => d.pose !== 'empty').length;
  showModal({
    title: 'Remove worktree?',
    body: `
      <p><b>${escapeHtml(room.label)}</b><br><span class="hint">${escapeHtml(room.path)}</span></p>
      ${agents ? `<p class="warn">${agents} agent${agents === 1 ? ' is' : 's are'} still in this room and will be closed with it.</p>` : ''}
      <p>The checkout is deleted from disk. The branch itself is kept.</p>
      <label class="check"><input id="wt-force" type="checkbox"> Force, even if there are uncommitted changes</label>`,
    okLabel: 'Remove',
    danger: true,
    onOk: async () => {
      const force = document.getElementById('wt-force').checked;
      const r = room.closed
        ? await window.office.worktree.removePath({ source_workspace_id: floor.sourceWorkspaceId, path: room.path, force })
        : await window.office.worktree.remove({ workspace_id: room.id, force });
      if (!r.ok) throw new Error(r.error);
    },
  });
}

// ---- modal ----

const $modal = document.getElementById('modal');
let modalOk = null, modalBodyClick = null;
function showModal({ title, body, okLabel = 'OK', cancel = true, danger = false, onOk = null, onBodyClick = null }) {
  document.getElementById('modal-title').innerHTML = title;
  document.getElementById('modal-body').innerHTML = body;
  const $err = document.getElementById('modal-error'); $err.hidden = true;
  const $ok = document.getElementById('modal-ok');
  $ok.textContent = okLabel; $ok.className = `btn primary ${danger ? 'danger' : ''}`; $ok.disabled = false;
  document.getElementById('modal-cancel').hidden = !cancel;
  modalOk = onOk; modalBodyClick = onBodyClick;
  $modal.hidden = false;
  $modal.querySelector('input[autofocus]')?.focus();
}
function hideModal() { $modal.hidden = true; modalOk = null; modalBodyClick = null; }
document.getElementById('modal-body').addEventListener('click', (e) => { modalBodyClick?.(e); });
document.getElementById('modal-cancel').addEventListener('click', hideModal);
document.getElementById('modal-ok').addEventListener('click', async () => {
  if (!modalOk) return hideModal();
  const $ok = document.getElementById('modal-ok'); const $err = document.getElementById('modal-error');
  $ok.disabled = true;
  try { await modalOk(); hideModal(); }
  catch (err) { $err.textContent = String(err.message || err); $err.hidden = false; $ok.disabled = false; }
});
$modal.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideModal();
  if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type === 'text') document.getElementById('modal-ok').click();
});
$modal.addEventListener('click', (e) => { if (e.target === $modal) hideModal(); });
$reception.addEventListener('click', (e) => {
  const $t = e.target.closest('.ticket');
  if (!$t) return;
  if ($t.dataset.tab && $t.dataset.tab !== window.officeTabs?.active()) window.officeTabs?.setActive($t.dataset.tab);
  if ($t.dataset.slack) return window.officeSlack.open($t.dataset.slack);
  if ($t.dataset.pane) openDesk($t.dataset.pane);
});

let tooltipPane = null, tooltipEv = null;
// A clicked whiteboard pins its card: it stays put, scrolls and opens folded lines
// until Escape or a click elsewhere. Hover handlers leave a pinned card alone.
// pinnedHTML: the card as last drawn, so a refresh with nothing new is skipped.
let pinnedBoard = null, pinnedHTML = '';
$tooltip.inert = true;
new ResizeObserver(() => { if (!$tooltip.hidden && tooltipEv) positionTooltip(tooltipEv); }).observe($tooltip);
async function showTooltipFor($desk, ev) {
  if (pinnedBoard) return;
  tooltipEv = ev;
  const d = $desk._desk;
  if (tooltipPane === d.id) return;
  tooltipPane = d.id;
  const state = { working: 'working', blocked: 'needs you', done: 'done', idle: 'idle', unknown: 'unknown' }[d.pose] || d.pose;
  $tooltip.innerHTML = `<div class="tt-head"><i class="chip ${d.pose}"></i><div class="tt-title">${escapeHtml(d.title)}${d.label && d.autoTitle !== d.label ? ` <span class="tt-auto">· ${escapeHtml(d.autoTitle)}</span>` : ''}</div></div>
    <div class="tt-meta">${escapeHtml(state)} · ${escapeHtml(d.floor)} · ${escapeHtml(d.room)}</div>
    <div class="tt-activity" hidden></div>
    <div class="tt-screen">…</div>`;
  $tooltip.hidden = false;
  positionTooltip(ev);
  const r = await window.office.readPane(d.id, 60);
  if (tooltipPane !== d.id) return;
  const $act = $tooltip.querySelector('.tt-activity'), $scr = $tooltip.querySelector('.tt-screen');
  if (!r.ok) { $scr.textContent = `(${r.error})`; return; }
  const sum = summarizeScreen(r.text);
  if (sum.activity) { $act.textContent = `Now: ${sum.activity}…`; $act.hidden = false; }
  else if (sum.finished) { $act.textContent = `Finished ${sum.finished.at} · ${sum.finished.took}`; $act.hidden = false; $act.classList.add('muted'); }
  $scr.textContent = sum.message || 'Waiting for a prompt.';
  if (sum.truncated) $scr.classList.add('truncated');
  positionTooltip(ev);
}
$building.addEventListener('mouseover', (e) => {
  const $desk = e.target.closest('.desk');
  if ($desk?._desk?.seat) return showSeatTooltip($desk._desk, e);
  if (!$desk?._desk || $desk._desk.pose === 'empty') { hideTooltip(); return; }
  showTooltipFor($desk, e);
});
$building.addEventListener('mousemove', (e) => { if (pinnedBoard) return; tooltipEv = e; if (!$tooltip.hidden) positionTooltip(e); });
$building.addEventListener('mouseleave', () => hideTooltip());
function showSeatTooltip(seat, ev) {
  if (pinnedBoard) return;
  tooltipEv = ev;
  if (tooltipPane === seat.id) return;
  tooltipPane = seat.id;
  $tooltip.innerHTML = `<div class="tt-head"><i class="chip" style="background:${escapeHtml(seat.orch.color)}"></i><div class="tt-title">${escapeHtml(seat.title)} · free desk</div></div>
    <div class="tt-meta">${escapeHtml(seat.about)}</div><div class="tt-meta">${seat.role === 'slack' ? 'Click to choose what it watches.' : 'Click to ask the boss to start it.'}</div>`;
  $tooltip.hidden = false;
  positionTooltip(ev);
}
function hideTooltip({ unpin = false } = {}) {
  if (pinnedBoard && !unpin) return;
  const wasPinned = pinnedBoard;
  pinnedBoard = null; pinnedHTML = ''; $tooltip.classList.remove('pinned'); $tooltip.inert = true;
  tooltipPane = null; $tooltip.hidden = true;
  if (wasPinned) syncWhiteboards();
}
function syncWhiteboards() {
  for (const el of document.querySelectorAll('.whiteboard')) el.setAttribute('aria-expanded', String(el.dataset.orch === pinnedBoard));
}
function positionTooltip(e) {
  const pad = 14;
  let x = e.clientX + pad, y = e.clientY + pad;
  const r = $tooltip.getBoundingClientRect();
  if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = Math.max(8, e.clientY - r.height - pad);
  $tooltip.style.left = `${x}px`; $tooltip.style.top = `${y}px`;
}
// Dev triggers (OFFICE_MODAL, OFFICE_OPEN, OFFICE_TOOLTIP, OFFICE_SETTINGS_OPEN), run once
// after the first snapshot has rendered so desks and rooms exist.
let devTriggersDone = false;
function runDevTriggers() {
  if (devTriggersDone) return;
  devTriggersDone = true;
  window.office.devTriggers?.().then((t) => {
    if (!t) return;
    if (t.settingsOpen) setTimeout(() => window.officeSettings?.openPopover(), 300);
    if (t.chatOpen) setTimeout(() => window.officeAssistant?.openChat(), 300);
    if (t.tooltip) setTimeout(() => {
      const $desk = [...document.querySelectorAll('.desk')].find((el) => el._desk?.id === t.tooltip);
      if (!$desk) return;
      const r = $desk.getBoundingClientRect();
      showTooltipFor($desk, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    }, 800);
    if (t.open) setTimeout(() => openDesk(t.open), 300);
    if (t.modal) setTimeout(() => {
      const which = t.modal;
      if (which === 'orchestrator') return window.officeTabs?.wizard();
      if (which === 'archived') return window.officeTabs?.archivedDialog();
      if (which.startsWith('close:')) return window.officeTabs?.closeDialog(which.slice(6));
      if (which.startsWith('slack:')) return window.officeSlack.open(which.slice(6));
      const $room = document.querySelector(which === 'remove' ? '.room.linked' : '.room');
      if (!$room) return;
      if (which === 'create') createWorktree($room._floor);
      else if (which === 'closed') showClosedList(document.querySelector('.floor-closed')?.closest('.floor-label')?._floor || $room._floor);
      else confirmRemove($room._room, $room._floor);
    }, 300);
  });
}

// ---- data in ----

window.office.onSnapshot(({ ok, snapshot, worktrees, error, orchestrators, archived, herdr }) => {
  if (worktrees) lastWorktrees = worktrees;
  if (ok) {
    $conn.textContent = `herdr ${snapshot.version ?? ''} · live`;
    $conn.className = 'conn ok';
  } else {
    $conn.textContent = `herdr unreachable: ${error}`;
    $conn.className = 'conn bad';
  }
  if (!snapshot) {
    $building.innerHTML = herdr?.starting
      ? '<div class="empty-building">Starting herdr…</div>'
      : `<div class="empty-building">The office is dark. Start herdr and the lights come on.${herdr?.failed ? `<small>Could not start it: ${escapeHtml(herdr.failed)}</small>` : ''}</div>`;
    $reception.innerHTML = '';
    return;
  }
  // pruneChildren only removes keyed children, so the unkeyed dark message would stay under the floors.
  $building.querySelector(':scope > .empty-building')?.remove();
  if (orchestrators) { lastOrchestrators = orchestrators; window.officeAlerts?.render(lastOrchestrators); window.officeSlack?.update(lastOrchestrators); }
  if (archived?.length) showNotice(window.officeView.archivedNotice(archived), { label: 'Restore…', run: () => window.officeTabs?.archivedDialog() });
  const floors = annotateOrchestrators(buildModel(snapshot));
  lastModelFloors = floors;
  lastDesks = floors.flatMap((f) => f.rooms.flatMap((r) => r.desks.filter((d) => !d.seat)));
  applyView();
  refreshPinnedBoard(); // its Workers and Waiting sections come from lastDesks
  window.officeTerminal.update(lastDesks);
  window.officeAssistant?.officeChanged(lastDesks, lastOrchestrators);
  syncPeople();
  runDevTriggers();
});

// Tell each boss who sits at its desks (PEOPLE.md in its folder), so the user
// can say "ask Patrik" and the boss knows which agent that is.
let lastPeople = '';
function syncPeople() {
  const names = window.CHARACTER_NAMES || [];
  if (!names.length || !lastOrchestrators.length) return;
  const people = {};
  for (const o of lastOrchestrators) people[o.slug] = [];
  for (const d of lastDesks) {
    if (!d.orch || d.character == null || !people[d.orch.slug]) continue;
    people[d.orch.slug].push({ name: names[d.character % names.length], agent: d.agentName, role: d.role, repo: d.role === 'worker' ? d.floor : '' });
  }
  const key = JSON.stringify(people);
  if (key === lastPeople) return;
  lastPeople = key;
  window.office.orchestrator?.setPeople?.(people);
}
// Board or orchestrator.json changed on disk (the boss wrote the board).
window.office.orchestrator?.onChange?.((list) => {
  lastOrchestrators = list || [];
  window.officeAlerts?.render(lastOrchestrators);
  window.officeSlack?.update(lastOrchestrators);
  if (lastModelFloors) { annotateOrchestrators(lastModelFloors); applyView(); }
  refreshPinnedBoard();
});
// Short notice in the top bar (e.g. an orchestrator archived because its boss workspace is gone).
// action: { label, run } adds a button after the text.
let noticeTimer = null;
window.officeNotice = (text, action) => showNotice(text, action);
window.officeLastOrchestrators = () => lastOrchestrators;
function showNotice(text, action = null) {
  const $n = document.getElementById('notice'); if (!$n) return;
  $n.textContent = text; $n.hidden = false;
  if (action) {
    const $b = document.createElement('button');
    $b.className = 'notice-action'; $b.textContent = action.label;
    $b.addEventListener('click', () => { $n.hidden = true; action.run(); });
    $n.append(' ', $b);
  }
  clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $n.hidden = true; }, action ? 30000 : 12000);
}
// Whiteboard hover: the board and live worker states.
$building.addEventListener('mouseover', (e) => {
  if (pinnedBoard) return;
  const $wb = e.target.closest('.whiteboard'); if (!$wb) return;
  const o = lastOrchestrators.find((x) => x.slug === $wb.dataset.orch); if (!o) return;
  $tooltip.innerHTML = boardTooltipHTML(o);
  $tooltip.hidden = false;
  positionTooltip(e);
});
$building.addEventListener('mouseout', (e) => {
  if (e.target.closest('.whiteboard') && !e.relatedTarget?.closest?.('.whiteboard')) hideTooltip();
});
$building.addEventListener('click', (e) => {
  const $wb = e.target.closest('.whiteboard'); if (!$wb) return;
  if (pinnedBoard === $wb.dataset.orch) return hideTooltip({ unpin: true });
  const o = lastOrchestrators.find((x) => x.slug === $wb.dataset.orch); if (!o) return;
  hideTooltip({ unpin: true });
  pinnedBoard = o.slug; tooltipEv = window.officeBoard.pinAnchor(e, $wb.getBoundingClientRect());
  pinnedHTML = boardTooltipHTML(o);
  $tooltip.innerHTML = pinnedHTML;
  $tooltip.classList.add('pinned'); $tooltip.inert = false; $tooltip.hidden = false; $tooltip.scrollTop = 0;
  syncWhiteboards();
  positionTooltip(tooltipEv);
  if (e.detail === 0) $tooltip.focus();
});
document.addEventListener('click', (e) => {
  if (!pinnedBoard) return;
  if (e.target.closest('.whiteboard')) return;
  if (!$tooltip.contains(e.target)) return hideTooltip({ unpin: true });
  const $fold = e.target.closest('button[data-fold]');
  if ($fold) { $fold.setAttribute('aria-expanded', String($fold.getAttribute('aria-expanded') !== 'true')); showFolded(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !pinnedBoard) return;
  const slug = pinnedBoard, back = $tooltip.contains(document.activeElement);
  hideTooltip({ unpin: true });
  if (back) document.querySelector(`.whiteboard[data-orch="${CSS.escape(slug)}"]`)?.focus();
});
function showFolded() {
  const open = new Set([...$tooltip.querySelectorAll('button[data-fold][aria-expanded="true"]')].map((el) => el.dataset.fold));
  for (const el of $tooltip.querySelectorAll('[data-in]')) el.classList.toggle('shown', window.officeBoard.foldShown(el.dataset.in, open));
}
// The board or a worker changed while the card is pinned: redraw it, keeping
// what was open, the scroll position and the focused fold.
function refreshPinnedBoard() {
  if (!pinnedBoard) return;
  const o = lastOrchestrators.find((x) => x.slug === pinnedBoard);
  if (!o) return hideTooltip({ unpin: true });
  const html = boardTooltipHTML(o);
  if (html === pinnedHTML) return;
  pinnedHTML = html;
  const open = [...$tooltip.querySelectorAll('button[data-fold][aria-expanded="true"]')].map((el) => el.dataset.fold), top = $tooltip.scrollTop;
  const focused = $tooltip.contains(document.activeElement) ? document.activeElement.dataset?.fold : undefined;
  $tooltip.innerHTML = html;
  for (const el of $tooltip.querySelectorAll('button[data-fold]')) if (open.includes(el.dataset.fold)) el.setAttribute('aria-expanded', 'true');
  if (focused) ($tooltip.querySelector(`button[data-fold="${CSS.escape(focused)}"]`) || $tooltip).focus({ preventScroll: true });
  showFolded();
  $tooltip.scrollTop = top;
}
