// PiPi's backflip, as a function of the time since it started: a crouch, a
// jump on a ballistic arc with one full backward turn in the air, and a
// squash on landing. bird.js draws it; test/backflip.test.js runs it in node.
//
// backflip(ms) → { phase: crouch|air|land, lift (CSS px up), angle (radians
// of backward turn, 0 → 2π), squash (body height, 1 = none) }, or null once
// it is over.
(function (root) {
  const CROUCH = 110;  // ms sinking down before the jump
  const AIR = 560;     // ms from takeoff to touchdown
  const LAND = 160;    // ms of squash after touchdown
  const HEIGHT = 36;   // CSS px from its spot to the apex
  const DURATION = CROUCH + AIR + LAND;
  const TURN = Math.PI * 2;

  function backflip(ms) {
    if (ms < 0 || ms >= DURATION) return null;
    if (ms < CROUCH) {
      const u = ms / CROUCH;
      return { phase: 'crouch', lift: 0, angle: 0, squash: 1 - 0.22 * Math.sin(u * Math.PI / 2) };
    }
    if (ms < CROUCH + AIR) {
      const u = (ms - CROUCH) / AIR;
      // Constant gravity: a parabola, fast off the ground, slow at the apex.
      const lift = HEIGHT * 4 * u * (1 - u);
      // The turn eases in and out, so it spins fastest at the apex.
      const angle = TURN * (1 - Math.cos(Math.PI * u)) / 2;
      const squash = 1 + 0.14 * Math.max(0, 1 - u / 0.3);
      return { phase: 'air', lift, angle, squash };
    }
    const u = (ms - CROUCH - AIR) / LAND;
    return { phase: 'land', lift: 0, angle: TURN, squash: 1 - 0.2 * Math.sin(Math.PI * Math.min(1, u * 1.4)) };
  }

  const api = { backflip, CROUCH, AIR, LAND, HEIGHT, DURATION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.pipiBackflip = api;
})(typeof window !== 'undefined' ? window : globalThis);
