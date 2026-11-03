// PiPi's backflip: a jump on a parabola from its spot back to its spot, with
// one full backward turn while it is in the air, fastest at the apex.
const test = require('node:test');
const assert = require('node:assert');
const { backflip, CROUCH, AIR, DURATION, HEIGHT } = require('../renderer/backflip');

const samples = (from, to, n = 200) => Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
const takeoff = CROUCH, touchdown = CROUCH + AIR;

test('it starts and ends on the ground, unturned, and is then over', () => {
  assert.deepStrictEqual({ lift: backflip(0).lift, angle: backflip(0).angle }, { lift: 0, angle: 0 });
  assert.strictEqual(backflip(takeoff).lift, 0);
  assert.strictEqual(backflip(touchdown).lift, 0);
  assert.strictEqual(backflip(DURATION - 1).lift, 0);
  assert.strictEqual(backflip(DURATION - 1).squash > 0.97, true);
  assert.strictEqual(backflip(DURATION), null);
  assert.strictEqual(backflip(-1), null);
});

test('it crouches before the jump and squashes on landing', () => {
  assert.ok(backflip(takeoff - 1).squash < 0.85);
  assert.ok(backflip(takeoff - 1).lift === 0);
  assert.ok(Math.min(...samples(touchdown, DURATION - 1).map((ms) => backflip(ms).squash)) < 0.85);
});

test('the apex is in the middle of the airtime, at HEIGHT', () => {
  const air = samples(takeoff, touchdown);
  const top = air.reduce((a, ms) => (backflip(ms).lift > backflip(a).lift ? ms : a));
  assert.strictEqual(top, (takeoff + touchdown) / 2);
  assert.ok(Math.abs(backflip(top).lift - HEIGHT) < 1e-9);
  assert.ok(HEIGHT >= 25 && HEIGHT <= 45);
});

test('it rises then falls, faster near the ground than at the apex (gravity)', () => {
  const lifts = samples(takeoff, touchdown).map((ms) => backflip(ms).lift);
  const mid = lifts.length >> 1;
  for (let i = 1; i <= mid; i++) assert.ok(lifts[i] > lifts[i - 1], `rising at ${i}`);
  for (let i = mid + 1; i < lifts.length; i++) assert.ok(lifts[i] < lifts[i - 1], `falling at ${i}`);
  const speed = (i) => Math.abs(lifts[i + 1] - lifts[i]);
  assert.ok(speed(0) > 5 * speed(mid - 1));
  assert.ok(speed(lifts.length - 2) > 5 * speed(mid));
});

test('the angle runs from 0 to one full turn in the air, never back, fastest at the apex', () => {
  const all = samples(0, DURATION - 1, 400).map((ms) => backflip(ms).angle);
  for (let i = 1; i < all.length; i++) assert.ok(all[i] >= all[i - 1], `turning back at ${i}`);
  assert.strictEqual(backflip(takeoff).angle, 0);
  assert.ok(Math.abs(backflip(touchdown - 1e-6).angle - 2 * Math.PI) < 1e-6);
  assert.strictEqual(backflip(touchdown).angle, 2 * Math.PI);
  const rate = (ms) => backflip(ms + 1).angle - backflip(ms).angle;
  const apex = (takeoff + touchdown) / 2;
  assert.ok(rate(apex) > 1.4 * (2 * Math.PI) / AIR);
  assert.ok(rate(apex) > 4 * rate(takeoff + 20));
  assert.ok(rate(apex) > 4 * rate(touchdown - 21));
});

test('only in the air does it leave the ground', () => {
  for (const ms of samples(0, DURATION - 1, 300)) {
    const f = backflip(ms);
    if (f.phase !== 'air') assert.strictEqual(f.lift, 0, `${f.phase} at ${ms}`);
    else assert.ok(f.lift >= 0);
  }
});
