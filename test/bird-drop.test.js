// Letting go of PiPi: it lands on the nearest edge below where it was
// dropped, or on the status bar's line when there is none.
const test = require('node:test');
const assert = require('node:assert');
const { landing } = require('../renderer/bird-drop');

const line = { left: 40, right: 1240, y: 812 };

test('lands on the nearest edge below the drop point', () => {
  const near = { left: 200, right: 500, y: 400 };
  const far = { left: 100, right: 900, y: 736 };
  const r = landing([far, near], { x: 300, y: 250 }, line);
  assert.strictEqual(r.edge, near);
  assert.deepStrictEqual(r.point, { x: 300, y: 400 });
});

test('ignores edges above it or more than 16 px off to the side', () => {
  const above = { left: 200, right: 500, y: 100 };
  const aside = { left: 320, right: 600, y: 400 };
  const justIn = { left: 315, right: 600, y: 600 };
  const r = landing([above, aside, justIn], { x: 299, y: 250 }, line);
  assert.strictEqual(r.edge, justIn);
  assert.deepStrictEqual(r.point, { x: 315, y: 600 });
});

test('falls back to the status bar line, kept inside its ends', () => {
  const r = landing([{ left: 600, right: 900, y: 400 }], { x: 20, y: 300 }, line);
  assert.strictEqual(r.edge, line);
  assert.deepStrictEqual(r.point, { x: 40, y: 812 });
});
