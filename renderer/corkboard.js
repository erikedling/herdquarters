// The corkboard: the user's todos and reminders as sticky notes. A small board
// hangs on the office wall beside the building; the corkboard button on the
// menu bar in reception opens a big board over the office with every note.
// Click a note to open it: title, details, time, color, Done and Remove. The
// notes are files in main (notes.js) that the assistant edits too; main sends
// the list whenever one changes.
(function () {
  const api = window.office.notes;
  if (!api) return;
  const { wallNotes, noteRows, dueNotes, timeLabel } = window.officeNoteRows;
  const COLORS = ['yellow', 'orange', 'pink', 'red', 'lilac', 'sky', 'teal', 'mint', 'lime', 'paper'];
  const WALL_SLOTS = 8;            // two columns of four, the last one the ＋
  const SAVE_MS = 400;             // typing in an open note saves after this pause
  const FLY_MS = 4000;             // how long the bird stays at the board after it pinned a note

  const $wall = document.getElementById('cork-wall');
  const $big = document.getElementById('bigboard');
  const $bigNow = document.getElementById('big-now');
  const $bigLater = document.getElementById('big-later');
  const $btn = document.getElementById('corkboard-btn');
  const $badge = document.getElementById('corkboard-count');
  const $pop = document.getElementById('note-pop');
  const $title = document.getElementById('note-title');
  const $details = document.getElementById('note-details');
  const $due = document.getElementById('note-due');
  const $swatches = document.getElementById('note-colors');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  let notes = [];
  let known = null;                 // files seen so far; null until the first list
  const mine = new Set();           // files this window created, so the bird does not fly for them
  // The open note: { file (null while a new one has no title yet), anchor, defaults }.
  let open = null;
  let saveTimer = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- drawing ----

  function noteHTML(n, now) {
    const t = timeLabel(n.due, now);
    const due = n.due !== null && n.due <= now;
    const cls = ['cork-note', `c-${COLORS.includes(n.color) ? n.color : 'yellow'}`, n.details ? 'has-details' : '', due ? 'due' : '', open?.file === n.file ? 'open' : ''].filter(Boolean).join(' ');
    const time = t ? `<span class="cn-time${t.late ? ' late' : ''}">⏰ ${esc(t.text)}${t.late ? ' late' : ''}</span>` : '';
    return `<button class="${cls}" data-file="${esc(n.file)}" title="${esc(n.title)}"><span class="cn-title">${esc(n.title)}</span>${time}</button>`;
  }
  const addHTML = (row) => `<button class="cork-add" data-row="${row}" title="Add a note">＋</button>`;

  function render() {
    const now = Date.now();
    const wall = wallNotes(notes, now, WALL_SLOTS);
    $wall.innerHTML = wall.notes.map((n) => noteHTML(n, now)).join('')
      + (wall.more ? `<button class="cork-more" title="Show every note">+${wall.more}<small>more</small></button>` : '')
      + addHTML('now');
    if (!$big.hidden) renderBig(now);
    const count = notes.length;
    $badge.textContent = count > 99 ? '99+' : String(count);
    $badge.hidden = !count;
    $btn.classList.toggle('ringing', dueNotes(notes, now).length > 0 && !reduced);
    $btn.title = count ? `Corkboard: ${count} open note${count === 1 ? '' : 's'}` : 'Corkboard';
  }

  function renderBig(now = Date.now()) {
    const rows = noteRows(notes, now);
    $bigNow.innerHTML = rows.now.map((n) => noteHTML(n, now)).join('') + addHTML('now');
    $bigLater.innerHTML = rows.later.map((n) => noteHTML(n, now)).join('') + addHTML('later');
  }

  // ---- the big board ----

  function openBig() {
    $big.hidden = false;
    document.body.classList.add('bigboard-open');
    $btn.classList.add('on');
    $btn.setAttribute('aria-pressed', 'true');
    renderBig();
  }
  function closeBig() {
    closeNote();
    $big.hidden = true;
    document.body.classList.remove('bigboard-open');
    $btn.classList.remove('on');
    $btn.setAttribute('aria-pressed', 'false');
  }
  $btn.addEventListener('click', () => ($big.hidden ? openBig() : closeBig()));
  // A click on the dimmed edge, outside the board, closes it.
  $big.addEventListener('mousedown', (e) => { if (e.target === $big) closeBig(); });
  document.getElementById('bigboard-close').addEventListener('click', closeBig);

  // ---- an open note ----

  // A day and time for <input type="datetime-local">, in local time.
  function localInput(ms) {
    if (ms === null || ms === undefined) return '';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function tomorrowNine() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.getTime();
  }

  function fill(n) {
    if (document.activeElement !== $title) $title.value = n.title || '';
    if (document.activeElement !== $details) $details.value = n.details || '';
    if (document.activeElement !== $due) $due.value = localInput(n.due);
    const color = COLORS.includes(n.color) ? n.color : 'yellow';
    $pop.dataset.color = color;
    for (const $s of $swatches.children) $s.setAttribute('aria-checked', String($s.dataset.color === color));
    $pop.querySelector('.np-done').disabled = !n.file;
    $pop.querySelector('.np-remove').disabled = !n.file;
  }

  function place(anchor) {
    $pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = $pop.offsetWidth, h = $pop.offsetHeight;
    // Beside the note, on whichever side has room; inside the window.
    let x = r.left - w - 12 >= 8 ? r.left - w - 12 : r.right + 12;
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    const y = Math.max(8, Math.min(window.innerHeight - h - 8, r.top - 8));
    $pop.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  function openNote(file, anchor) {
    flush();
    const n = notes.find((x) => x.file === file);
    if (!n) return;
    open = { file, anchor };
    fill(n);
    place(anchor);
    render();
    $title.focus();
  }

  // A new note: nothing is written until it has a title.
  function newNote(row, anchor) {
    flush();
    const draft = { file: null, title: '', details: '', due: row === 'later' ? tomorrowNine() : null, color: 'yellow' };
    open = { file: null, anchor, draft };
    fill(draft);
    place(anchor);
    $title.focus();
  }

  function closeNote() {
    if (!open) return;
    flush();
    open = null;
    $pop.hidden = true;
    render();
  }

  // What the open note's fields say.
  function fields() {
    const due = $due.value ? new Date($due.value).getTime() : null;
    return { title: $title.value.trim(), details: $details.value, due: Number.isFinite(due) ? due : null, color: $pop.dataset.color || 'yellow' };
  }

  // A new note is written once it has a title; whatever is typed while that
  // write is on its way follows as an update.
  let creating = false;
  async function save(patch) {
    if (!open) return;
    const target = open;
    if (target.file) { await api.update(target.file, patch); return; }
    target.draft = { ...target.draft, ...fields(), ...patch };
    if (!target.draft.title || creating) return;
    creating = true;
    const sent = { ...target.draft };
    const r = await api.create(sent);
    creating = false;
    if (!r?.ok) return;
    mine.add(r.note.file);
    target.file = r.note.file;
    if (open === target) {
      $pop.querySelector('.np-done').disabled = false;
      $pop.querySelector('.np-remove').disabled = false;
    }
    const now = open === target ? fields() : target.draft;
    const changed = {};
    if (now.title && now.title !== r.note.title) changed.title = now.title;
    if (now.details.trim() !== r.note.details) changed.details = now.details;
    if (now.color !== r.note.color) changed.color = now.color;
    if (now.due !== r.note.due) changed.due = now.due;
    if (Object.keys(changed).length) await api.update(r.note.file, changed);
  }

  function flush() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    const { title, details } = fields();
    save(title ? { title, details } : { details });
  }
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_MS);
  }
  // One line of text: a newline or a pasted one is a space.
  $title.addEventListener('input', () => { if (/\n/.test($title.value)) $title.value = $title.value.replace(/\s*\n+\s*/g, ' '); saveSoon(); });
  $details.addEventListener('input', saveSoon);
  $title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $details.focus(); } });
  $due.addEventListener('change', () => save({ due: fields().due }));
  document.getElementById('note-due-clear').addEventListener('click', () => { $due.value = ''; save({ due: null }); });

  $swatches.innerHTML = COLORS.map((c) => `<button type="button" role="radio" class="np-swatch c-${c}" data-color="${c}" title="${c[0].toUpperCase()}${c.slice(1)}" aria-label="${c}"></button>`).join('');
  $swatches.addEventListener('click', (e) => {
    const $s = e.target.closest('.np-swatch');
    if (!$s || !open) return;
    $pop.dataset.color = $s.dataset.color;
    for (const $x of $swatches.children) $x.setAttribute('aria-checked', String($x === $s));
    save({ color: $s.dataset.color });
  });

  $pop.querySelector('.np-done').addEventListener('click', async () => {
    const file = open?.file;
    if (!file) return;
    flush();
    open = null; $pop.hidden = true;
    await api.done(file);
  });
  $pop.querySelector('.np-remove').addEventListener('click', async () => {
    const file = open?.file;
    if (!file) return;
    clearTimeout(saveTimer); saveTimer = null;
    open = null; $pop.hidden = true;
    await api.remove(file);
  });
  $pop.querySelector('.np-close').addEventListener('click', closeNote);

  // Notes and ＋ on either board.
  for (const $grid of [$wall, $bigNow, $bigLater]) {
    $grid.addEventListener('click', (e) => {
      const $n = e.target.closest('.cork-note');
      if ($n) { e.stopPropagation(); openNote($n.dataset.file, $n); return; }
      const $add = e.target.closest('.cork-add');
      if ($add) { e.stopPropagation(); newNote($add.dataset.row, $add); return; }
      if (e.target.closest('.cork-more')) { e.stopPropagation(); openBig(); }
    });
  }

  // Esc closes the note, then the big board. A click elsewhere closes the note.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (open) { e.stopPropagation(); closeNote(); } else if (!$big.hidden) { e.stopPropagation(); closeBig(); }
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (!open || $pop.contains(e.target) || e.target.closest('.cork-note, .cork-add')) return;
    closeNote();
  });

  // ---- the bird ----

  // The assistant pinned a note: the bird flies to the board for a moment.
  function flyToBoard() {
    const $frame = document.querySelector('.corkboard-frame');
    const bird = window.officeBird;
    if (!bird || !$frame || !$frame.offsetParent) return;
    bird.pin(() => { const r = $frame.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top }; });
    setTimeout(() => bird.pin(null), FLY_MS);
  }

  // ---- the list from main ----

  function update(list) {
    notes = Array.isArray(list) ? list : [];
    const files = new Set(notes.map((n) => n.file));
    if (known && [...files].some((f) => !known.has(f) && !mine.has(f))) flyToBoard();
    known = files;
    // The open note went away (done or removed elsewhere): close it.
    if (open?.file && !files.has(open.file)) { open = null; $pop.hidden = true; }
    else if (open?.file) fill(notes.find((n) => n.file === open.file));
    render();
  }
  api.onChange(update);
  api.list().then(update);
  // Times turn late and reminders come due without a change to the files.
  setInterval(render, 30_000);

  window.officePixels?.draw(document);
  // OFFICE_CORKBOARD=big|note|both (docs/GUIDE.md, dev flags).
  function dev(what) {
    if (what === 'big' || what === 'both') openBig();
    const $n = (what === 'both' ? $bigNow : $wall).querySelector('.cork-note.has-details') || (what === 'both' ? $bigNow : $wall).querySelector('.cork-note');
    if ((what === 'note' || what === 'both') && $n) openNote($n.dataset.file, $n);
  }
  window.officeCorkboard = { open: openBig, close: closeBig, dev };
})();
