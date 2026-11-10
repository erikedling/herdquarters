// The welcome tour and the README art paint the same scenes. Paint each one
// over its animation on a recording context: nothing throws, nothing lands
// outside the 160x90 frame (clouds drift across the sky), and every scene
// has text in it.
const test = require('node:test');
const assert = require('node:assert');
const { W, H, NAMES, LOOP, draw, CAST, CODE, typing, workstation } = require('../renderer/scenes');

function recorder(S) {
  const rects = [], texts = [];
  const ctx = {
    fillStyle: '', font: '', textAlign: '', textBaseline: '', strokeStyle: '', lineWidth: 1, lineDashOffset: 0, globalAlpha: 1,
    fillRect(x, y, w, h) { rects.push({ x: x / S, y: y / S, w: w / S, h: h / S, c: this.fillStyle }); },
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

const CODE_COLOURS = new Set(CODE.flat().map(([, , c]) => c));
const isCode = (r) => CODE_COLOURS.has(r.c) && r.h === 1;
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const frames = (seconds) => Array.from({ length: Math.round(seconds * 12) }, (_, i) => i / 12);

test('only someone typing streams code: one stream per desk worker', () => {
  const typists = { delegate: 1, team: 4, status: 1 };
  const perStream = CODE.flat().length;
  for (const name of NAMES) {
    for (const t of frames(1)) {
      const { ctx, rects } = recorder(4);
      draw(ctx, name, t, 4);
      assert.strictEqual(rects.filter(isCode).length, (typists[name] || 0) * perStream, `${name} t=${t}`);
    }
  }
});

test('the code stays on the canvas and nothing in the scene paints over it', () => {
  for (const name of ['delegate', 'team', 'status']) {
    for (const t of frames(LOOP[name])) {
      const { ctx, rects } = recorder(4);
      draw(ctx, name, t, 4);
      rects.forEach((r, i) => {
        if (!isCode(r)) return;
        assert.ok(r.x >= 0 && r.x + r.w <= W && r.y >= 0 && r.y + r.h <= H, `${name} t=${t}: code off the canvas`);
        const over = rects.slice(i + 1).find((o) => !isCode(o) && overlaps(o, r));
        assert.ok(!over, `${name} t=${t}: ${JSON.stringify(over)} covers code at ${r.x},${r.y}`);
      });
    }
  }
});

test('for everyone in the cast, the code keeps a pixel clear of hair and hats as the head leans and dips', () => {
  for (const who of CAST) {
    const runs = frames(1).map((t) => { const { ctx, rects } = recorder(4); workstation(ctx, who, t, 4); return rects; });
    const code = runs.flat().filter(isCode);
    const left = Math.min(...code.map((r) => r.x));
    const top = Math.min(...code.map((r) => r.y)), bottom = Math.max(...code.map((r) => r.y + r.h));
    for (const rects of runs) {
      const reach = Math.max(...rects.filter((r) => !isCode(r) && r.y < bottom && r.y + r.h > top).map((r) => r.x + r.w));
      assert.ok(reach < left, `${who} reaches x ${reach}, code starts at ${left}`);
    }
  }
});

test('typing comes round exactly at the end of each README loop, desk offsets and all', () => {
  for (const name of ['delegate', 'team', 'status']) {
    assert.strictEqual(LOOP[name] * 12 % 1, 0, `${name} loops on a whole frame`);
    for (const t of frames(LOOP[name])) {
      for (const offset of [0, 0.37, 0.74]) {
        assert.deepStrictEqual(typing(t + offset + LOOP[name]), typing(t + offset), `${name} t=${t}+${offset}`);
      }
    }
  }
});

test('typing hits a key every beat with the hands taking turns, and the code climbs a row per hit', () => {
  const seen = frames(1).map(typing);
  assert.ok(seen.some((k) => k.left === 2) && seen.some((k) => k.right === 2), 'each hand lifts two pixels');
  assert.ok(seen.every((k) => Math.min(k.left, k.right) <= 1), 'never both hands up high');
  assert.deepStrictEqual([...new Set(seen.map((k) => k.lean))].sort(), [-1, 0]);
  for (let i = 0; i < 4; i++) assert.deepStrictEqual(typing(i / 4).rise, [i, (i + 2) % 4]);
});

test('the tour\'s reduced-motion still (t = 0.4, welcome.js) shows a raised hand and two code lines', () => {
  const k = typing(0.4);
  assert.strictEqual(Math.max(k.left, k.right), 2);
  const { ctx, rects } = recorder(4);
  draw(ctx, 'status', 0.4, 4);
  assert.strictEqual(new Set(rects.filter(isCode).map((r) => r.y)).size, 2);
});

test('an unknown scene is an error', () => {
  assert.throws(() => draw(recorder(1).ctx, 'nope'), /no scene "nope"/);
});
