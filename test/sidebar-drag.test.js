// Dragging the sidebar edge saves the width the pointer dragged to, not the
// width the sidebar happens to render at in a narrow window.
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('../renderer/sidebar-drag');

test('a press without a move saves nothing', () => {
  const drag = start(244, 300);
  assert.strictEqual(drag.move(300), null);
  assert.strictEqual(drag.end(), null);
});

test('a drag saves the width it was dragged to, starting from the rendered width', () => {
  const drag = start(244.4, 300);
  assert.strictEqual(drag.move(330), 274);
  assert.strictEqual(drag.move(320), 264);
  assert.strictEqual(drag.end(), 264);
});

test('dragging back to the start still saves, since the user chose that width', () => {
  const drag = start(244, 300);
  drag.move(310);
  assert.strictEqual(drag.move(300), 244);
  assert.strictEqual(drag.end(), 244);
});

test('the width is clamped to 170..560', () => {
  const drag = start(244, 300);
  assert.strictEqual(drag.move(0), 170);
  assert.strictEqual(drag.move(2000), 560);
  assert.strictEqual(drag.end(), 560);
});
