// PiPi's sprite: every frame of every animation draws a whole bird inside
// its 40 × 40 box, outlined, standing on the ground unless it is in the air.
const test = require('node:test');
const assert = require('node:assert');
const { pipiFrame, ANIM, SIZE, GROUND } = require('../renderer/pipi-sprite');

const keys = (g) => new Set(g.flat().filter(Boolean));

test('every frame of every animation is a full, outlined bird in the box', () => {
  for (const [name, a] of Object.entries(ANIM)) {
    a.frames.forEach((pose, i) => {
      const g = pipiFrame(pose);
      const where = `${name}[${i}]`;
      assert.strictEqual(g.length, SIZE, where);
      assert.ok(g.every((row) => row.length === SIZE), where);
      for (const k of ['O', 'B', 'C', 'Y', 'W']) assert.ok(keys(g).has(k), `${where} has ${k}`);
      // Nothing touches the box's edges, so no part is cut off.
      assert.ok(g[0].every((k) => !k) && g.every((row) => !row[0] && !row[SIZE - 1]), `${where} inside the box`);
    });
  }
});

test('standing, the toes are on the ground; flying, the legs are tucked away', () => {
  const lastRow = (g) => Math.max(...g.map((row, y) => (row.some((k) => k === 'L') ? y : -1)));
  assert.strictEqual(lastRow(pipiFrame({})), GROUND - 1);
  assert.strictEqual(lastRow(pipiFrame(ANIM.fly.frames[0])), -1);
});

test('the eyes: open has a glint, asleep has none, startled is wide', () => {
  assert.ok(keys(pipiFrame({})).has('G'));
  assert.ok(!keys(pipiFrame(ANIM.sleep.frames[0])).has('G'));
  const wide = pipiFrame({ eye: 'wide' }).flat().filter((k) => k === 'G').length;
  assert.ok(wide > 4);
});
