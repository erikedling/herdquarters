// Notes on the corkboard: files the board and the assistant both edit. A note
// with a time is a reminder; old reminders/ files move in as notes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NotesStore, parseNote, noteRows, dueNotes, fileName } = require('../notes');
const { wallNotes, timeLabel } = require('../renderer/note-rows');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
const NOON = new Date(2026, 10, 3, 12, 0).getTime(); // Tue 3 Nov 2026, local
const at = (days, h, m = 0) => new Date(2026, 10, 3 + days, h, m).getTime();
const note = (file, due, created = 0, status = 'open') => ({ file, title: file, details: '', due, color: 'yellow', status, created });

test('a note file: title, details, time, color and status', () => {
  const n = parseNote({ file: 'a.md', title: 'Call Noor', due: '2026-11-03T15:00:00+01:00', color: 'Pink', status: 'open', created: '2026-11-03T08:00:00+01:00', text: 'About the palette' });
  assert.strictEqual(n.title, 'Call Noor');
  assert.strictEqual(n.details, 'About the palette');
  assert.strictEqual(n.due, Date.parse('2026-11-03T15:00:00+01:00'));
  assert.strictEqual(n.color, 'pink');
  assert.strictEqual(n.status, 'open');
});

test('an unknown color is yellow, a bad time is no time, and no title takes the first line', () => {
  const n = parseNote({ file: 'a.md', color: 'chartreuse', due: 'tomorrow', text: 'Talk to Noor\nabout the palette' });
  assert.strictEqual(n.color, 'yellow');
  assert.strictEqual(n.due, null);
  assert.strictEqual(n.title, 'Talk to Noor');
  assert.strictEqual(n.details, 'about the palette');
});

test('create, update, done and remove round-trip through the files', () => {
  const store = new NotesStore({ dir: tmp() });
  const n = store.create({ title: 'Call Noor', details: 'line 1\nline 2', due: at(0, 15), color: 'mint' }, NOON);
  assert.match(n.file, /^20261103-120000-call-noor\.md$/);
  assert.deepStrictEqual(store.list().map((x) => [x.title, x.details, x.due, x.color]), [['Call Noor', 'line 1\nline 2', at(0, 15), 'mint']]);
  store.update(n.file, { title: 'Call Noor at 3', due: null, color: 'sky' });
  assert.deepStrictEqual(store.read(n.file).due, null);
  assert.strictEqual(store.read(n.file).title, 'Call Noor at 3');
  // an empty title keeps the old one
  store.update(n.file, { title: '  ' });
  assert.strictEqual(store.read(n.file).title, 'Call Noor at 3');
  store.done(n.file);
  assert.deepStrictEqual(store.list(), []);
  assert.strictEqual(store.all()[0].status, 'done');
  store.remove(n.file);
  assert.deepStrictEqual(store.all(), []);
});

test('a title is one line and is needed', () => {
  const store = new NotesStore({ dir: tmp() });
  assert.throws(() => store.create({ title: ' \n ' }));
  assert.strictEqual(store.create({ title: 'two\nlines' }, NOON).title, 'two lines');
});

test('two notes with the same name and second get their own files', () => {
  const store = new NotesStore({ dir: tmp() });
  const a = store.create({ title: 'Same' }, NOON);
  const b = store.create({ title: 'Same' }, NOON);
  assert.notStrictEqual(a.file, b.file);
  assert.strictEqual(store.list().length, 2);
});

test('file names from the renderer are names, never paths', () => {
  const store = new NotesStore({ dir: tmp() });
  for (const bad of ['../assistant.json', '../x.md', 'a/b.md', '.hidden.md', 'note.txt', '']) {
    assert.throws(() => store.update(bad, { title: 'x' }), bad);
    assert.throws(() => store.remove(bad), bad);
  }
});

test('reminders written before notes existed move in and keep firing', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'reminders'));
  fs.writeFileSync(path.join(dir, 'reminders', '20261103-1500-noor.md'), '---\ndue: 2026-11-03T15:00:00+01:00\nstatus: open\n---\nTalk to Noor\nAbout the dark palette.\n');
  const store = new NotesStore({ dir: path.join(dir, 'notes'), legacy: path.join(dir, 'reminders') });
  const [n] = store.list();
  assert.strictEqual(n.file, '20261103-1500-noor.md');
  assert.strictEqual(n.title, 'Talk to Noor');
  assert.strictEqual(n.details, 'About the dark palette.');
  assert.strictEqual(n.due, Date.parse('2026-11-03T15:00:00+01:00'));
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'reminders')), []);
  assert.deepStrictEqual(dueNotes(store.list(), Date.parse('2026-11-03T16:00:00+01:00')).map((x) => x.file), [n.file]);
});

test('board rows: overdue and today by time, then undated newest first; later days after', () => {
  const notes = [
    note('later-far', at(3, 9)),
    note('tomorrow', at(1, 8)),
    note('today-3pm', at(0, 15)),
    note('overdue', at(-1, 9)),
    note('undated-old', null, 1),
    note('undated-new', null, 2),
    note('just-before-midnight', at(0, 23, 59)),
    note('done', at(0, 10), 0, 'done'),
  ];
  const rows = noteRows(notes, NOON);
  assert.deepStrictEqual(rows.now.map((n) => n.file), ['overdue', 'today-3pm', 'just-before-midnight', 'undated-new', 'undated-old']);
  assert.deepStrictEqual(rows.later.map((n) => n.file), ['tomorrow', 'later-far']);
});

test('the wall board: everything when it fits, a "+N" stack when it does not', () => {
  const few = [note('a', null, 1), note('b', null, 2)];
  assert.deepStrictEqual(wallNotes(few, NOON, 8), { notes: [few[1], few[0]], more: 0 });
  const many = Array.from({ length: 10 }, (_, i) => note(`n${i}`, null, i));
  const wall = wallNotes(many, NOON, 8);
  // 8 places: 6 notes, the stack, the ＋
  assert.strictEqual(wall.notes.length, 6);
  assert.strictEqual(wall.more, 4);
  // exactly 7 notes fill the 7 places beside the ＋
  assert.deepStrictEqual(wallNotes(many.slice(0, 7), NOON, 8).more, 0);
});

test('time labels: today, tomorrow, this week, later, and late', () => {
  assert.deepStrictEqual(timeLabel(at(0, 15), NOON), { text: '15:00', late: false });
  assert.deepStrictEqual(timeLabel(at(0, 9), NOON), { text: '09:00', late: true });
  assert.deepStrictEqual(timeLabel(at(1, 16), NOON), { text: 'Tomorrow 16:00', late: false });
  assert.deepStrictEqual(timeLabel(at(-1, 16), NOON), { text: 'Yesterday 16:00', late: true });
  assert.strictEqual(timeLabel(at(3, 9), NOON).text, 'Fri 09:00');
  assert.strictEqual(timeLabel(at(20, 9), NOON).text, '23 Nov 09:00');
  assert.strictEqual(timeLabel(null, NOON), null);
});

test('file names: date, time and a short slug', () => {
  assert.strictEqual(fileName('Ring Noor — om paletten!', NOON), '20261103-120000-ring-noor-om-paletten.md');
  assert.strictEqual(fileName('???', NOON), '20261103-120000-note.md');
});
