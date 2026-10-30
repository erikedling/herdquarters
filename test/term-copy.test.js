// Copying a long line that herdr wrapped over several rows must give one line.
const test = require('node:test');
const assert = require('node:assert');
const { joinRows, continues } = require('../renderer/term-copy');

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));

test('a row that fills every cell continues on the next row', () => {
  const cols = 20;
  const url = 'https://example.com/a/very/long/path/that/wraps';
  const rows = [url.slice(0, 20), url.slice(20, 40), pad(url.slice(40), cols)];
  assert.strictEqual(joinRows(rows, { cols }), url);
});

test('a row with room left ends the line', () => {
  const cols = 20;
  const rows = [pad('short line', cols), pad('next line', cols)];
  assert.strictEqual(joinRows(rows, { cols }), 'short line\nnext line');
});

test('a row whose last cell is a space ends the line', () => {
  const cols = 10;
  const rows = ['ends here ', pad('more', cols)];
  assert.strictEqual(joinRows(rows, { cols }), 'ends here\nmore');
});

test('start and end columns clip the first and last rows', () => {
  const cols = 10;
  const rows = ['0123456789', 'abcdefghij', pad('klm', cols)];
  assert.strictEqual(joinRows(rows, { cols, startCol: 3, endCol: 2 }), '3456789abcdefghijkl');
});

test('a single row is clipped and trimmed', () => {
  assert.strictEqual(joinRows([pad('hello world', 20)], { cols: 20, startCol: 6, endCol: 20 }), 'world');
});

test('continues() needs a real character in the last cell', () => {
  assert.strictEqual(continues('x'), true);
  assert.strictEqual(continues(' '), false);
  assert.strictEqual(continues(''), false);
  assert.strictEqual(continues(undefined), false);
});
