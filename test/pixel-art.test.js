// The pixel pictures on the logo and menu bar: 12×12, every letter in the palette.
const test = require('node:test');
const assert = require('node:assert');
const { ART, svg } = require('../renderer/pixel-art');

test('every picture is 12×12 and uses only its own colors', () => {
  for (const [name, { pal, rows }] of Object.entries(ART)) {
    assert.strictEqual(rows.length, 12, name);
    for (const row of rows) {
      assert.strictEqual(row.length, 12, `${name}: ${row}`);
      for (const c of row) assert.ok(c === '.' || pal[c], `${name}: ${c}`);
    }
  }
});

test('svg() draws a crisp picture at the asked scale, and nothing for an unknown name', () => {
  assert.match(svg('logo', 2), /^<svg viewBox="0 0 12 12" width="24" height="24" shape-rendering="crispEdges"/);
  assert.strictEqual(svg('nope'), '');
});
