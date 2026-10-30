// A desk keeps its person (and so its name in PEOPLE.md) while its pane
// exists. Before, one snapshot without the agent dropped the character and
// the next pick could land on someone else: the boss called Klara "Frida".
const test = require('node:test');
const assert = require('node:assert');
const { createBook } = require('../renderer/characters');

function clock(start = 1_000_000) { let t = start; const now = () => t; now.add = (ms) => { t += ms; }; return now; }

test('a pane keeps its character when a snapshot misses its agent', () => {
  const now = clock();
  const book = createBook({ count: 20, now });
  const a = book.assign('w1:p1').c, b = book.assign('w2:p1').c;
  book.touch([]); // a snapshot with no agents
  now.add(3000);
  book.touch(['w1:p1', 'w2:p1']);
  assert.strictEqual(book.assign('w1:p1').c, a);
  assert.strictEqual(book.assign('w2:p1').c, b);
});

test('characters do not reshuffle when someone else leaves', () => {
  const now = clock();
  const book = createBook({ count: 20, now });
  // Ten agents, then the first one's pane closes for good: the others keep theirs.
  const ids = ['w1:p1', 'w2:p1', 'w3:p1', 'w4:p1', 'w5:p1', 'w6:p1', 'w7:p1', 'w8:p1', 'w9:p1', 'wA:p1'];
  const first = Object.fromEntries(ids.slice(0, 10).map((id) => [id, book.assign(id).c]));
  now.add(31 * 60 * 1000);
  book.touch(ids.slice(1, 10)); // w1:p1 gone for good
  for (const id of ids.slice(1, 10)) assert.strictEqual(book.assign(id).c, first[id], id);
});

test('no two live panes share a character while there are enough', () => {
  const book = createBook({ count: 20, now: clock() });
  const cs = Array.from({ length: 20 }, (_, i) => book.assign(`w${i}:p1`).c);
  assert.strictEqual(new Set(cs).size, 20);
});

test('the book survives a restart, and open panes keep their names after a long gap', () => {
  const now = clock();
  const before = createBook({ count: 20, now });
  const c = before.assign('w4W:p1').c;
  const saved = JSON.parse(JSON.stringify(before.toJSON()));
  now.add(24 * 60 * 60 * 1000); // the app was closed for a day
  const after = createBook({ count: 20, entries: saved, now });
  after.touch(['w4W:p1']);
  assert.strictEqual(after.assign('w4W:p1').c, c);
});

test('a pane gone longer than keepMs is forgotten, and bad entries are ignored', () => {
  const now = clock();
  const book = createBook({ count: 20, now, entries: { 'x:p1': { c: 99, seen: 0 }, 'y:p1': { c: 'a', seen: 0 }, 'z:p1': null } });
  assert.deepStrictEqual(book.toJSON(), {});
  book.assign('w1:p1');
  now.add(31 * 60 * 1000);
  assert.strictEqual(book.touch([]), true);
  assert.deepStrictEqual(book.toJSON(), {});
});
