// Throwing PiPi: a fast release flies, a slow one is a plain drop; it
// bounces off the walls, losing speed, and lands on the first edge it
// falls through.
const test = require('node:test');
const assert = require('node:assert');
const { releaseVelocity, isThrow, capped, advance, landing, score, hitBoard, MAX_SPEED } = require('../renderer/bird-throw');

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

test('the path does not depend on the frame rate', () => {
  const open = { left: -1e9, right: 1e9, top: -1e9 };
  const fly = (dt) => {
    let b = { x: 100, y: 500, vx: 1.2, vy: -1.5 };
    for (let n = 0; n < Math.round(1000 / dt); n++) b = advance(b, dt, 0.0025, open).body;
    return b;
  };
  const ref = fly(50);
  for (const dt of [1000 / 120, 1000 / 60]) {
    const b = fly(dt);
    for (const k of ['x', 'y', 'vx', 'vy']) assert.ok(Math.abs(b[k] - ref[k]) < 1e-6, `${k} at ${dt} ms: ${b[k]} vs ${ref[k]}`);
  }
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

const board = { x: 1200, y: 400, r: 44 };

test('the board scores by ring: 50 bullseye, 25 outer bull, then 15, 10 and 5', () => {
  const at = (d) => score({ x: board.x + d, y: board.y }, board);
  assert.strictEqual(at(0), 50);
  assert.strictEqual(at(5), 50);
  assert.strictEqual(at(-8), 25);
  assert.strictEqual(at(20), 15);
  assert.strictEqual(at(30), 10);
  assert.strictEqual(score({ x: board.x, y: board.y - 40 }, board), 5);
  assert.strictEqual(at(45), 0);
});

test('a path through the board hits it where it runs closest to the bull', () => {
  const r = hitBoard({ x: 1100, y: 410 }, { x: 1180, y: 410 }, board);
  assert.ok(r);
  close(r.point.x, 1200);
  close(r.point.y, 410);
  assert.strictEqual(score(r.point, board), 25);
});

test('a fast throw cannot tunnel through the board between two frames', () => {
  const r = hitBoard({ x: 1100, y: 385 }, { x: 1300, y: 385 }, board);
  assert.ok(r);
  assert.ok(r.t > 0 && r.t < 1);
  assert.strictEqual(score(r.point, board), 15);
});

test('a miss, a segment short of the board, or one starting on it does not hit', () => {
  assert.strictEqual(hitBoard({ x: 1100, y: 300 }, { x: 1300, y: 300 }, board), null);
  assert.strictEqual(hitBoard({ x: 1000, y: 400 }, { x: 1100, y: 400 }, board), null);
  assert.strictEqual(hitBoard({ x: 1200, y: 400 }, { x: 1300, y: 400 }, board), null);
});
