// Dragging the divider between the office and the split terminal saves a %
// of the workspace (what the slider shows), kept inside the slider's range
// and wide enough for both the panel and the office.
const test = require('node:test');
const assert = require('node:assert');
const { start, range } = require('../renderer/panel-drag');

test('a press without a move saves nothing', () => {
  const drag = start({ total: 1280, reserved: 250, panelWidth: 589, startX: 691 });
  assert.strictEqual(drag.move(691), null);
  assert.strictEqual(drag.end(), null);
});

test('dragging left widens the panel, right narrows it, as a % of the workspace', () => {
  const drag = start({ total: 1500, reserved: 0, panelWidth: 690, startX: 810 });
  assert.strictEqual(drag.move(660), 56);
  assert.strictEqual(drag.move(900), 40);
  assert.strictEqual(drag.end(), 40);
});

test('the slider range bounds a wide window', () => {
  assert.deepStrictEqual(range(2000, 0), { lo: 30, hi: 75 });
  const drag = start({ total: 2000, reserved: 0, panelWidth: 920, startX: 1080 });
  assert.strictEqual(drag.move(0), 75);
  assert.strictEqual(drag.move(2000), 30);
});

test('the panel keeps 420px and the office 240px beside the sidebar', () => {
  // 1280 wide with a 250px sidebar: the panel needs 33%, the office leaves at most 61%.
  assert.deepStrictEqual(range(1280, 250), { lo: 33, hi: 61 });
  const drag = start({ total: 1280, reserved: 250, panelWidth: 589, startX: 691 });
  assert.strictEqual(drag.move(0), 61);
  assert.strictEqual(drag.move(1280), 33);
});

test('a window too narrow for both keeps the panel minimum', () => {
  assert.deepStrictEqual(range(800, 250), { lo: 53, hi: 53 });
});
