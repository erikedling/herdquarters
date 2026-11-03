// Notes: the user's todos on the office corkboard. A note with a time is a
// reminder; the office chimes when it is due. One markdown file per note in
// <userData>/assistant/notes, so the assistant reads and writes the same notes
// with its file tools:
//
//   ---
//   title: Call Noor
//   due: 2026-11-03T15:00:00+01:00     (optional: no time means a plain todo)
//   color: pink                        (one of COLORS; anything else is yellow)
//   status: open                       (open | done)
//   created: 2026-11-03T08:12:00+01:00
//   ---
//   The details: longer text, only shown when the note is opened.
//
// Reminders the assistant wrote before notes existed (reminders/*.md, the text
// in the body) move here the next time the notes are read.

const fs = require('node:fs');
const path = require('node:path');
const { readInbox } = require('./orchestrators');
const { noteRows, dueNotes } = require('./renderer/note-rows');

const COLORS = ['yellow', 'orange', 'pink', 'red', 'lilac', 'sky', 'teal', 'mint', 'lime', 'paper'];
const TITLE_MAX = 200;

const oneLine = (s) => String(s ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
const colorOf = (c) => (COLORS.includes(String(c || '').toLowerCase()) ? String(c).toLowerCase() : 'yellow');

// A note from readInbox(): { file, title, details, due (ms or null), color, status, created (ms) }.
// A note without a title (an old reminder) takes the first line of its body.
function parseNote(msg) {
  let title = oneLine(msg.title);
  let details = String(msg.text || '');
  if (!title) {
    const [first, ...rest] = details.split('\n');
    title = oneLine(first);
    details = rest.join('\n');
  }
  const due = Date.parse(msg.due || '');
  const created = Date.parse(msg.created || '');
  return {
    file: msg.file,
    title,
    details: details.trim(),
    due: Number.isFinite(due) ? due : null,
    color: colorOf(msg.color),
    status: String(msg.status || 'open').toLowerCase() === 'done' ? 'done' : 'open',
    created: Number.isFinite(created) ? created : msg.at || 0,
  };
}

// Local time with its offset, the way the assistant writes it: 2026-11-03T15:00:00+01:00.
function isoLocal(ms) {
  const d = new Date(ms);
  const p = (n) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off >= 0 ? '+' : '-'}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
}

// The file's text for a note.
function noteFile({ title, details, due, color, status, created }) {
  const lines = [`title: ${oneLine(title)}`];
  if (due !== null && due !== undefined && Number.isFinite(due)) lines.push(`due: ${isoLocal(due)}`);
  lines.push(`color: ${colorOf(color)}`, `status: ${status === 'done' ? 'done' : 'open'}`, `created: ${isoLocal(created)}`);
  const body = String(details || '').replace(/\r\n/g, '\n').trim();
  return `---\n${lines.join('\n')}\n---\n${body ? `${body}\n` : ''}`;
}

// 20261103-081200-call-noor.md
function fileName(title, created) {
  const d = new Date(created);
  const p = (n) => String(n).padStart(2, '0');
  const slug = oneLine(title).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'note';
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${slug}.md`;
}

class NotesStore {
  // dir: the notes folder; legacy: the old reminders folder, emptied into dir.
  constructor({ dir, legacy = null }) {
    this.dir = dir;
    this.legacy = legacy;
  }

  // A file name from the renderer, never a path.
  path(file) {
    const name = String(file || '');
    if (!name.endsWith('.md') || path.basename(name) !== name || name.startsWith('.')) throw new Error('Not a note');
    return path.join(this.dir, name);
  }

  // A free name in dir: name.md, name-2.md, ...
  free(name) {
    let candidate = name, i = 2;
    while (fs.existsSync(path.join(this.dir, candidate))) candidate = name.replace(/\.md$/, `-${i++}.md`);
    return candidate;
  }

  migrate() {
    if (!this.legacy) return;
    let names = [];
    try { names = fs.readdirSync(this.legacy).filter((n) => n.endsWith('.md')); } catch { return; }
    if (!names.length) return;
    fs.mkdirSync(this.dir, { recursive: true });
    for (const msg of readInbox(this.legacy)) {
      if (!names.includes(msg.file)) continue;
      const note = parseNote(msg);
      const to = this.free(msg.file);
      fs.writeFileSync(path.join(this.dir, to), noteFile({ ...note, created: note.created || Date.now() }));
      fs.rmSync(path.join(this.legacy, msg.file), { force: true });
    }
  }

  prepare() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.migrate();
  }

  // Every note, open and done.
  all() {
    this.migrate();
    return readInbox(this.dir).map(parseNote);
  }
  list() { return this.all().filter((n) => n.status === 'open'); }

  read(file) {
    const p = this.path(file);
    const [msg] = readInbox(this.dir).filter((m) => m.file === path.basename(p));
    if (!msg) throw new Error('No such note');
    return parseNote(msg);
  }

  create({ title, details = '', due = null, color = 'yellow' } = {}, now = Date.now()) {
    if (!oneLine(title)) throw new Error('A note needs a title');
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.free(fileName(title, now));
    const note = { file, title: oneLine(title), details: String(details || '').trim(), due: Number.isFinite(due) ? due : null, color: colorOf(color), status: 'open', created: now };
    fs.writeFileSync(path.join(this.dir, file), noteFile(note));
    return note;
  }

  // patch: any of title, details, due (ms or null), color, status.
  update(file, patch = {}) {
    const note = { ...this.read(file) };
    if ('title' in patch) { const t = oneLine(patch.title); if (t) note.title = t; }
    if ('details' in patch) note.details = String(patch.details ?? '').trim();
    if ('due' in patch) note.due = Number.isFinite(patch.due) ? patch.due : null;
    if ('color' in patch) note.color = colorOf(patch.color);
    if ('status' in patch) note.status = patch.status === 'done' ? 'done' : 'open';
    fs.writeFileSync(this.path(file), noteFile(note));
    return note;
  }

  done(file) { return this.update(file, { status: 'done' }); }

  remove(file) { fs.rmSync(this.path(file), { force: true }); }
}

module.exports = { NotesStore, parseNote, noteRows, dueNotes, noteFile, fileName, isoLocal, COLORS };
