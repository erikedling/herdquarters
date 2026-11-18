// The orchestrator tabs keep the order the user dragged them into; new ones go
// at the end and closed ones drop out.
const test = require('node:test');
const assert = require('node:assert');
const { applyOrder, move, target, nearest, inside, press, THRESHOLD } = require('../renderer/tab-order');

test('with no saved order the tabs keep the order they came in (created_at)', () => {
  assert.deepStrictEqual(applyOrder(['a', 'b', 'c'], null), ['a', 'b', 'c']);
  assert.deepStrictEqual(applyOrder(['a', 'b', 'c'], undefined), ['a', 'b', 'c']);
  assert.deepStrictEqual(applyOrder(['a', 'b', 'c'], []), ['a', 'b', 'c']);
  assert.deepStrictEqual(applyOrder(['a', 'b', 'c'], 'c,b,a'), ['a', 'b', 'c']);
});

test('a saved order is applied', () => {
  assert.deepStrictEqual(applyOrder(['a', 'b', 'c'], ['c', 'a', 'b']), ['c', 'a', 'b']);
});

test('new orchestrators go after the saved ones, in the order they came in', () => {
  assert.deepStrictEqual(applyOrder(['a', 'b', 'c', 'd', 'e'], ['c', 'a', 'b']), ['c', 'a', 'b', 'd', 'e']);
});

test('saved slugs that no longer exist are skipped', () => {
  assert.deepStrictEqual(applyOrder(['a', 'c'], ['c', 'gone', 'a', 'b']), ['c', 'a']);
  assert.deepStrictEqual(applyOrder([], ['c', 'a']), []);
});

test('a duplicated slug in the saved order shows once', () => {
  assert.deepStrictEqual(applyOrder(['a', 'b'], ['b', 'a', 'b']), ['b', 'a']);
});

test('move takes an item out and puts it at the index', () => {
  assert.deepStrictEqual(move(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepStrictEqual(move(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepStrictEqual(move(['a', 'b', 'c', 'd'], 1, 1), ['a', 'b', 'c', 'd']);
  assert.deepStrictEqual(move(['a', 'b', 'c'], 0, 99), ['b', 'c', 'a']);
});

test('move leaves the list it was given alone', () => {
  const list = ['a', 'b', 'c'];
  move(list, 0, 2);
  assert.deepStrictEqual(list, ['a', 'b', 'c']);
});

// Two rows of cards, as the strip wraps them: 100 wide, 50 tall, 10 apart.
const card = (col, row) => ({ left: col * 110, right: col * 110 + 100, top: row * 60, bottom: row * 60 + 50 });
const grid = [card(1, 0), card(2, 0), card(0, 1), card(1, 1)];

test('the card under the pointer is the target', () => {
  assert.strictEqual(nearest(grid, 150, 20), 0);
  assert.strictEqual(nearest(grid, 250, 49), 1);
  assert.strictEqual(nearest(grid, 10, 80), 2);
});

test('between cards the nearest card is the target', () => {
  assert.strictEqual(nearest(grid, 104, 20), 0);   // gap between Office and the first card
  assert.strictEqual(nearest(grid, 400, 20), 1);   // past the end of the first row
  assert.strictEqual(nearest(grid, 50, 55), 2);    // between the rows
  assert.strictEqual(nearest([], 0, 0), -1);
});

// Office at (0, 0) and + at (2, 1), around the grid above.
const office = card(0, 0), add = card(2, 1);

test('dropped on Office a card goes first, on + last, never before or after them', () => {
  assert.strictEqual(nearest(grid, 20, 40), 2);    // the card under Office is nearer...
  assert.strictEqual(target(grid, 20, 40, office, add), 0); // ...but Office means first
  assert.strictEqual(nearest(grid, 230, 65), 1);   // the card above + is nearer...
  assert.strictEqual(target(grid, 230, 65, office, add), 3); // ...but + means last
  assert.strictEqual(target(grid, 150, 20, office, add), 0);
  assert.strictEqual(target(grid, 10, 80, office, add), 2);
  assert.strictEqual(target(grid, 10, 80, null, null), 2);
  assert.strictEqual(target([], 20, 40, office, add), -1);
});

test('inside counts the edge and the margin', () => {
  const r = { left: 0, right: 100, top: 0, bottom: 50 };
  assert.ok(inside(r, 100, 50));
  assert.ok(!inside(r, 105, 20));
  assert.ok(inside(r, 105, 20, 8));
  assert.ok(!inside(r, 50, -9, 8));
});

test('a press only becomes a drag past the threshold', () => {
  const p = press(100, 100);
  assert.strictEqual(p.moved(100, 100), false);
  assert.strictEqual(p.moved(103, 103), false); // a wobbly click is still a click
  assert.strictEqual(p.moved(100 + THRESHOLD, 100), true);
});

test('once a drag, moving back near the start keeps it a drag', () => {
  const p = press(100, 100);
  p.moved(120, 100);
  assert.strictEqual(p.moved(100, 100), true);
});
