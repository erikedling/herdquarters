// Throwing PiPi: a fast release flies, a slow one is a plain drop; it
// bounces off the walls, losing speed, and lands on the first edge it
// falls through.
const test = require('node:test');
const assert = require('node:assert');
const { releaseVelocity, isThrow, capped, advance, landing, MAX_SPEED } = require('../renderer/bird-throw');

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const walls = { left: 20, right: 1260, top: 56 };
const floor = { left: 40, right: 1240, y: 812 };

test('the release velocity is over the last 100 ms of samples', () => {
  const samples = [
    { x: 0, y: 0, t: 0 },        // too old, left out
    { x: 100, y: 500, t: 900 },
    { x: 150, y: 480, t: 950 },
    { x: 200, y: 460, t: 1000 },
  ];
  const v = releaseVelocity(samples, 1000);
  close(v.vx, 1);
  close(v.vy, -0.4);
  assert.ok(isThrow(v));
});

test('a slow release counts as a drop', () => {
  const v = releaseVelocity([{ x: 100, y: 300, t: 920 }, { x: 110, y: 302, t: 1000 }], 1000);
  assert.ok(!isThrow(v));
});

test('holding still before letting go is a drop, however fast the drag was', () => {
  const v = releaseVelocity([{ x: 0, y: 0, t: 700 }, { x: 600, y: 0, t: 800 }, { x: 600, y: 0, t: 1000 }], 1000);
  assert.ok(!isThrow(v));
  assert.deepStrictEqual(releaseVelocity([{ x: 0, y: 0, t: 999 }, { x: 50, y: 0, t: 1000 }], 1000), { vx: 0, vy: 0 });
});

test('the launch speed is capped, keeping its direction', () => {
  const v = capped({ vx: 6, vy: -8 });
  close(Math.hypot(v.vx, v.vy), MAX_SPEED);
  close(v.vx / v.vy, 6 / -8);
  assert.deepStrictEqual(capped({ vx: 1, vy: 0 }), { vx: 1, vy: 0 });
});

test('it falls under gravity', () => {
  const { body, hit } = advance({ x: 500, y: 300, vx: 1, vy: 0 }, 10, 0.0025, walls);
  close(body.vy, 0.025);
  close(body.x, 510);
  assert.deepStrictEqual(hit, []);
});

test('a bounce off a wall reverses and damps the speed into it', () => {
  const { body, hit } = advance({ x: 1250, y: 300, vx: 2, vy: -1 }, 10, 0, walls);
  assert.deepStrictEqual(hit, ['right']);
  assert.ok(body.vx < 0 && Math.abs(body.vx) < 2);
  assert.ok(Math.abs(body.vy) < 1);
  assert.ok(body.x <= walls.right);
});

test('a bounce off the ceiling sends it back down, slower', () => {
  const { body, hit } = advance({ x: 500, y: 60, vx: 0.5, vy: -2 }, 10, 0, walls);
  assert.deepStrictEqual(hit, ['top']);
  assert.ok(body.vy > 0 && body.vy < 2);
  assert.ok(body.y >= walls.top);
});

test('falling, it lands on the first edge it crosses', () => {
  const upper = { left: 200, right: 500, y: 400 };
  const lower = { left: 200, right: 500, y: 450 };
  const r = landing({ x: 300, y: 380 }, { x: 320, y: 480 }, [lower, upper], floor);
  assert.strictEqual(r.edge, upper);
  close(r.point.x, 304);
  assert.strictEqual(r.point.y, 400);
});

test('edges off to the side, or crossed going up, do not catch it', () => {
  const aside = { left: 400, right: 600, y: 400 };
  assert.strictEqual(landing({ x: 300, y: 380 }, { x: 300, y: 420 }, [aside], floor), null);
  assert.strictEqual(landing({ x: 450, y: 420 }, { x: 450, y: 380 }, [aside], floor), null);
});

test('the floor catches it, inside its ends', () => {
  const r = landing({ x: 10, y: 790 }, { x: 5, y: 830 }, [], floor);
  assert.strictEqual(r.edge, floor);
  assert.deepStrictEqual(r.point, { x: 40, y: 812 });
});
