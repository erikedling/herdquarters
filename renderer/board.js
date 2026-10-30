// Pure helpers for the board card: turn the boss's flat task list into rows
// where upcoming work stays detailed and finished work folds to one line, and
// those rows into the card's HTML.
// No DOM, so test/board.test.js can run them in node; the browser gets them
// as window.officeBoard.
(function () {
  // "3. ABC-2763 Pushed 245a062b" → key ABC-2763, text "Pushed 245a062b".
  const TICKET = /^(?:\d+\.\s+)?([A-Z][A-Z0-9]+-\d+)\b[\s:–-]*/;
  const SHORT = 12; // boards this long or shorter render line by line, as written
  const RECENT = 4; // finished blocks shown before "+ N earlier done"

  function ticketOf(text) {
    const m = String(text || '').match(TICKET);
    return m ? { key: m[1], rest: text.slice(m[0].length) || text } : null;
  }

  // Each task's block key and display text. Under a ### group the heading is
  // the label and its ticket key (or else the whole heading) the key, so flat
  // "ABC-9 …" lines later moved under "### ABC-9 Dark mode" stay one block.
  // A ticket key the heading already names is not repeated.
  function keyed(t) {
    const tk = ticketOf(t.text);
    if (t.group) {
      const gk = ticketOf(t.group);
      return { key: gk ? gk.key : t.group, label: t.group, heading: true, text: tk && gk && tk.key === gk.key ? tk.rest : t.text };
    }
    if (tk) return { key: tk.key, label: tk.key, text: tk.rest };
    return { key: null, label: null, text: t.text };
  }

  // tasks (from parseBoard) → rows, in display order:
  //   { kind: 'heading', label }                         short boards only
  //   { kind: 'task', task, text }                       a line as written
  //   { kind: 'block', label, open: [line], done: [line] } a unit with work ahead
  //   { kind: 'finished', label, steps, last, done: [line] }
  //   { kind: 'loose', done: [line] }                    finished tasks with no unit
  //   { kind: 'earlier', blocks: [finished row] }        older finished units
  // where line = { task, text }.
  function boardRows(tasks, { short = SHORT, recent = RECENT } = {}) {
    tasks = tasks || [];
    if (tasks.length <= short) {
      const rows = [];
      let group = null;
      for (const task of tasks) {
        if (task.group && task.group !== group) rows.push({ kind: 'heading', label: task.group });
        group = task.group || null;
        rows.push({ kind: 'task', task, text: task.text });
      }
      return rows;
    }
    const blocks = new Map();
    const order = []; // blocks and lone tasks, by first appearance
    tasks.forEach((task, i) => {
      const k = keyed(task);
      if (k.key === null) { order.push({ lone: true, task, text: k.text }); return; }
      let b = blocks.get(k.key);
      if (!b) { b = { label: k.label, lines: [], last: i }; blocks.set(k.key, b); order.push(b); }
      if (k.heading) b.label = k.label;
      b.lines.push({ task, text: k.text });
      b.last = i;
    });
    const rows = [], ended = [], loose = [];
    for (const b of order) {
      if (b.lone) {
        if (b.task.done) loose.push({ task: b.task, text: b.text }); else rows.push({ kind: 'task', task: b.task, text: b.text });
        continue;
      }
      const open = b.lines.filter((l) => !l.task.done), done = b.lines.filter((l) => l.task.done);
      if (open.length) rows.push({ kind: 'block', label: b.label, open, done });
      else ended.push({ label: b.label, done, last: b.last });
    }
    const finished = ended.sort((a, b) => b.last - a.last)
      .map(({ label, done }) => ({ kind: 'finished', label, steps: done.length, last: done[done.length - 1].text, done }));
    rows.push(...finished.slice(0, recent));
    if (loose.length) rows.push({ kind: 'loose', done: loose });
    if (finished.length > recent) rows.push({ kind: 'earlier', blocks: finished.slice(recent) });
    return rows;
  }

  // A folded line shows only while every fold around it is open.
  // inside: the fold ids it sits in, space-separated (its data-in).
  function foldShown(inside, open) {
    return String(inside || '').split(' ').filter(Boolean).every((id) => open.has(id));
  }

  // Where a pinned card opens. A keyboard click (detail 0) has no pointer
  // position, so the card goes below the whiteboard instead.
  function pinAnchor(ev, rect) {
    if (ev.detail === 0 && rect) return { clientX: rect.left, clientY: rect.bottom };
    return { clientX: ev.clientX, clientY: ev.clientY };
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // rows (from boardRows) → the card's <li>s. A fold's lines carry data-in with
  // every fold id around them, so a pinned card can open them (see foldShown).
  // slug: the orchestrator's, dropped from the front of owner names.
  function boardRowsHTML(rows, slug) {
    const owner = (t) => (t.owner ? ` <span class="wb-owner">@${esc(t.owner.replace(`${slug}-`, ''))}</span>` : '');
    const fid = (kind, label) => encodeURIComponent(`${kind}:${label || ''}`);
    const dataIn = (inside) => (inside.length ? ` data-in="${inside.join(' ')}"` : '');
    const line = (l, inside = [], cls = '') => `<li class="${[l.task.done ? 'done' : '', cls].join(' ').trim()}"${dataIn(inside)}><i>${l.task.done ? '✓' : '○'}</i>${esc(l.text)}${owner(l.task)}</li>`;
    const fold = (id, icon, html, inside = [], cls = '') => `<li class="done wb-fold${cls ? ` ${cls}` : ''}"${dataIn(inside)}><i>${icon}</i><button type="button" data-fold="${id}" aria-expanded="false">${html}</button></li>`;
    const finished = (f, inside = []) => {
      const id = fid('finished', f.label);
      const steps = f.steps > 1 ? ` · ${f.steps} steps` : '';
      return fold(id, '✓', `<b>${esc(f.label)}</b>${steps} · ${esc(f.last)}`, inside)
        + f.done.map((l) => line(l, [...inside, id], 'wb-in')).join('');
    };
    const block = (r) => {
      const id = fid('block', r.label);
      const n = r.done.length;
      const head = `<li class="wb-group"><b>${esc(r.label)}</b><span class="wb-state">${r.open.length} open${n ? ` · ${n} done` : ''}</span></li>`;
      const done = n ? fold(id, '✓', `${n} ${n === 1 ? 'step' : 'steps'} done`, [], 'wb-in') + r.done.map((l) => line(l, [id], 'wb-in wb-in2')).join('') : '';
      return head + done + r.open.map((l) => line(l, [], 'wb-in')).join('');
    };
    return rows.map((r) => {
      if (r.kind === 'heading') return `<li class="wb-group"><b>${esc(r.label)}</b></li>`;
      if (r.kind === 'task') return line(r);
      if (r.kind === 'block') return block(r);
      if (r.kind === 'finished') return finished(r);
      if (r.kind === 'loose') return fold('loose', '✓', `${r.done.length} done`) + r.done.map((l) => line(l, ['loose'], 'wb-in')).join('');
      if (r.kind === 'earlier') return fold('earlier', '+', `${r.blocks.length} earlier done`) + r.blocks.map((f) => finished(f, ['earlier'])).join('');
      return '';
    }).join('');
  }

  const api = { boardRows, boardRowsHTML, foldShown, pinAnchor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.officeBoard = api;
})();
