// The board card keeps upcoming work detailed and folds finished work: a unit
// (### group or ticket key) with open steps shows them, a finished unit is one
// line, and short boards render line by line as the boss wrote them.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { parseBoard } = require('../orchestrators');
const { boardRows, boardRowsHTML, foldShown, pinAnchor } = require('../renderer/board');

const tasksOf = (lines) => parseBoard(['## Tasks', ...lines].join('\n')).tasks;
const filler = (n, prefix = 'step') => Array.from({ length: n }, (_, i) => `- [x] ${prefix} ${i + 1}`);

test('a short board renders every task as written, in board order', () => {
  const tasks = tasksOf([
    '- [x] Bump handlebars, PR #12 merged (@w-sm)',
    '- [x] 1. ABC-201 lockfile only (@w-nw)',
    '- [ ] Close workers (@w-nw)',
  ]);
  assert.deepStrictEqual(boardRows(tasks), tasks.map((task) => ({ kind: 'task', task, text: task.text })));
});

test('a short board keeps its ### headings in place', () => {
  const rows = boardRows(tasksOf(['### ABC-1 Settings', '- [x] fix', '- [ ] deploy', '- [ ] after']));
  assert.deepStrictEqual(rows.map((r) => r.kind), ['heading', 'task', 'task', 'task']);
  assert.strictEqual(rows[0].label, 'ABC-1 Settings');
});

test('ticket keys group a long board and drop the "n. KEY" prefix from each step', () => {
  const rows = boardRows(tasksOf([...filler(12).map((l, i) => l.replace('step', `1. ABC-1 step`)), '- [ ] 2. ABC-2 Investigate: start (@w)']));
  assert.deepStrictEqual(rows.map((r) => [r.kind, r.label]), [['block', 'ABC-2'], ['finished', 'ABC-1']]);
  assert.deepStrictEqual(rows[0].open.map((l) => l.text), ['Investigate: start']);
  assert.strictEqual(rows[0].open[0].task.owner, 'w');
  assert.strictEqual(rows[1].steps, 12);
  assert.strictEqual(rows[1].last, 'step 12');
});

test('### groups win over ticket keys and do not repeat the key in the step text', () => {
  const rows = boardRows(tasksOf([...filler(12), '### ABC-9 Dark mode', '- [x] ABC-9 PR 1 merged', '- [ ] PR 2 (@w)']));
  const block = rows.find((r) => r.kind === 'block');
  assert.strictEqual(block.label, 'ABC-9 Dark mode');
  assert.deepStrictEqual(block.done.map((l) => l.text), ['PR 1 merged']);
  assert.deepStrictEqual(block.open.map((l) => l.text), ['PR 2']);
});

test('flat ticket lines and a later ### heading with the same key are one block, labelled by the heading', () => {
  const rows = boardRows(tasksOf([...filler(12), '- [x] ABC-9 PR 1 merged', '### ABC-9 Dark mode', '- [x] ABC-9 PR 2 merged', '- [ ] PR 3 (@w)']));
  const blocks = rows.filter((r) => r.kind === 'block' || r.kind === 'finished');
  assert.deepStrictEqual(blocks.map((r) => [r.kind, r.label]), [['block', 'ABC-9 Dark mode']]);
  assert.deepStrictEqual(blocks[0].done.map((l) => l.text), ['PR 1 merged', 'PR 2 merged']);
  assert.deepStrictEqual(blocks[0].open.map((l) => l.text), ['PR 3']);
});

test('open blocks come first in board order, finished ones newest first, then loose done, then the rest folded', () => {
  const lines = [
    '- [x] early loose',
    '- [x] AA-1 done', '- [x] BB-1 done', '- [ ] CC-1 open', '- [x] DD-1 done',
    '- [x] EE-1 done', '- [x] FF-1 done', '- [ ] GG-1 open', '- [x] CC-1 halfway', '- [x] HH-1 done',
    '- [ ] lone open', ...filler(3, 'loose'),
  ];
  const rows = boardRows(tasksOf(lines), { recent: 4 });
  assert.deepStrictEqual(rows.map((r) => [r.kind, r.label || r.task?.text || '']), [
    ['block', 'CC-1'], ['block', 'GG-1'], ['task', 'lone open'],
    ['finished', 'HH-1'], ['finished', 'FF-1'], ['finished', 'EE-1'], ['finished', 'DD-1'],
    ['loose', ''], ['earlier', ''],
  ]);
  assert.strictEqual(rows.find((r) => r.kind === 'loose').done.length, 4);
  assert.deepStrictEqual(rows.at(-1).blocks.map((b) => b.label), ['BB-1', 'AA-1']);
});

test('a long board: open tickets expanded, finished tickets one line each', () => {
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'long-board.md'), 'utf8');
  const rows = boardRows(parseBoard(raw).tasks);
  assert.deepStrictEqual(rows.map((r) => [r.kind, r.label]), [
    ['block', 'ABC-104'], ['block', 'ABC-105'],
    ['finished', 'ABC-103'], ['finished', 'ABC-102'], ['finished', 'ABC-101'],
  ]);
  const [dark, del] = rows;
  assert.deepStrictEqual(dark.open.map((l) => l.text), [
    'PR 1: human review, then the user merges',
    'PR 2: implement core views, light pixel-identical, dark review locally, uncommitted',
  ]);
  assert.strictEqual(dark.done.length, 12);
  assert.deepStrictEqual([del.open.length, del.done.length], [1, 0]);
  assert.deepStrictEqual(rows.slice(2).map((r) => [r.steps, r.last]), [
    [29, 'Ticket: Done'],
    [18, 'Ticket: Done'],
    [7, 'Cleanup: dev env stopped, branch reset to main'],
  ]);
});

test('a folded line shows only while every fold around it is open', () => {
  assert.strictEqual(foldShown('a', new Set(['a'])), true);
  assert.strictEqual(foldShown('earlier f', new Set(['f'])), false);
  assert.strictEqual(foldShown('earlier f', new Set(['earlier', 'f'])), true);
  assert.strictEqual(foldShown('', new Set()), true);
});

test('a keyboard pin opens the card below the whiteboard, a mouse pin at the pointer', () => {
  const rect = { left: 100, top: 40, bottom: 90 };
  assert.deepStrictEqual(pinAnchor({ detail: 0, clientX: 0, clientY: 0 }, rect), { clientX: 100, clientY: 90 });
  assert.deepStrictEqual(pinAnchor({ detail: 1, clientX: 300, clientY: 60 }, rect), { clientX: 300, clientY: 60 });
});

const liOf = (html, text) => html.split('</li>').find((li) => li.includes(text));

test('a step inside an earlier finished unit sits under both the earlier fold and its own', () => {
  const lines = ['- [x] AA-1 oldest step', '- [x] AA-1 last', ...['BB', 'CC', 'DD', 'EE'].map((k) => `- [x] ${k}-1 done`), ...filler(8, 'loose'), '- [ ] ZZ-1 open'];
  const html = boardRowsHTML(boardRows(tasksOf(lines), { recent: 4 }), 'boss');
  assert.match(liOf(html, 'oldest step'), /data-in="earlier finished%3AAA-1"/);
  assert.match(html, /data-fold="earlier"/);
  assert.match(html, /data-fold="finished%3AAA-1"/);
});

test("a block's done steps sit under the block's fold, its open steps always show", () => {
  const html = boardRowsHTML(boardRows(tasksOf([...filler(12), '- [x] ABC-9 PR 1 merged', '- [ ] ABC-9 PR 2'])), 'boss');
  assert.match(html, /data-fold="block%3AABC-9"/);
  assert.match(liOf(html, 'PR 1 merged'), /data-in="block%3AABC-9"/);
  assert.doesNotMatch(liOf(html, 'PR 2'), /data-in/);
});

test('board HTML escapes task text, labels and owners, and drops the slug from owners', () => {
  const html = boardRowsHTML(boardRows(tasksOf(['### <G> & "H"', '- [ ] a <b>x</b> & \'y\' (@boss-w1)'])), 'boss');
  assert.match(html, /<b>&lt;G&gt; &amp; &quot;H&quot;<\/b>/);
  assert.match(html, /a &lt;b&gt;x&lt;\/b&gt; &amp; &#39;y&#39; <span class="wb-owner">@w1<\/span>/);
  assert.doesNotMatch(html, /<b>x<\/b>/);
  const odd = boardRowsHTML([{ kind: 'task', task: { done: false, owner: 'boss-<w>' }, text: 't' }], 'boss');
  assert.match(odd, /@&lt;w&gt;<\/span>/);
});
