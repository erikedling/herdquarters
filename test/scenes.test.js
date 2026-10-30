// The welcome tour and the README art paint the same scenes. Paint each one
// over its animation on a recording context: nothing throws, nothing lands
// outside the 160x90 frame (clouds drift across the sky), and every scene
// has text in it.
const test = require('node:test');
const assert = require('node:assert');
const { W, H, NAMES, draw } = require('../renderer/scenes');

function recorder(S) {
  const rects = [], texts = [];
  const ctx = {
    fillStyle: '', font: '', textAlign: '', textBaseline: '', strokeStyle: '', lineWidth: 1, lineDashOffset: 0,
    fillRect: (x, y, w, h) => rects.push({ x: x / S, y: y / S, w: w / S, h: h / S }),
    clearRect() {}, fillText: (s) => texts.push(s), measureText: (s) => ({ width: s.length * 3 * S }),
    createLinearGradient: () => ({ addColorStop() {} }),
    save() {}, restore() {}, rect() {}, clip() {}, setLineDash() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  };
  return { ctx, rects, texts };
}

test('the tour has its seven scenes, welcome first', () => {
  assert.deepStrictEqual(NAMES, ['welcome', 'delegate', 'team', 'status', 'helpers', 'assistant', 'go']);
});

test('the assistant scene says the name it is given', () => {
  const { ctx, texts } = recorder(4);
  draw(ctx, 'assistant', 5, 4, { assistantName: 'Kaka' });
  assert.ok(texts.includes('Kaka'));
  assert.ok(texts.includes('Kaka, your assistant'));
});

test('every scene paints inside its frame at any time', () => {
  for (const name of NAMES) {
    for (const t of [0, 0.4, 1.3, 2.9, 7.7, 61]) {
      const { ctx, rects, texts } = recorder(4);
      draw(ctx, name, t, 4);
      assert.ok(rects.length > 50, `${name} paints`);
      assert.ok(texts.length > 0, `${name} has text`);
      for (const r of rects) {
        if (r.w === W && r.h === H) continue;
        assert.ok(r.x + r.w > -30 && r.x < W + 30 && r.y + r.h > -8 && r.y < H + 3, `${name} t=${t}: rect ${JSON.stringify(r)} off the frame`);
      }
    }
  }
});

test('an unknown scene is an error', () => {
  assert.throws(() => draw(recorder(1).ctx, 'nope'), /no scene "nope"/);
});
