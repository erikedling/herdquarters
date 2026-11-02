// Throwing PiPi: the release velocity from the last pointer samples, one
// physics step of the flight with bounces off the window's walls and
// ceiling, and where a falling PiPi lands. Positions are its feet in
// viewport px, velocities px/ms. bird.js flies it; test/bird-throw.test.js
// runs it in node.
(function (root) {
  const WINDOW_MS = 100;  // pointer samples that count for the release
  const MIN_SPAN_MS = 8;  // fewer ms of samples than this is noise, not a throw
  const THROW_MIN = 0.5;  // px/ms (500 px/s): slower than this is a drop
  const MAX_SPEED = 2.4;  // px/ms (2400 px/s)
  const BOUNCE = 0.6;     // share of the speed into a wall it keeps
  const SCRAPE = 0.85;    // share of the speed along a wall it keeps
  const SLACK = 16;       // as in bird-drop.js

  // samples: [{ x, y, t }] oldest first, the last one at release.
  function releaseVelocity(samples, now = samples.at(-1)?.t) {
    const recent = samples.filter((s) => s.t >= now - WINDOW_MS);
    if (recent.length < 2) return { vx: 0, vy: 0 };
    const a = recent[0], b = recent.at(-1);
    const span = b.t - a.t;
    if (span < MIN_SPAN_MS) return { vx: 0, vy: 0 };
    return { vx: (b.x - a.x) / span, vy: (b.y - a.y) / span };
  }

  const isThrow = (v) => Math.hypot(v.vx, v.vy) >= THROW_MIN;

  function capped(v) {
    const s = Math.hypot(v.vx, v.vy);
    if (s <= MAX_SPEED) return { vx: v.vx, vy: v.vy };
    return { vx: (v.vx / s) * MAX_SPEED, vy: (v.vy / s) * MAX_SPEED };
  }

  // body: { x, y, vx, vy }; walls: { left, right, top }. Returns the body
  // after dt ms and which walls it bounced off.
  function advance(body, dt, gravity, walls) {
    let { x, y, vx, vy } = body;
    vy += gravity * dt;
    x += vx * dt; y += vy * dt;
    const hit = [];
    if (x < walls.left && vx < 0) { x = walls.left + (walls.left - x) * BOUNCE; vx = -vx * BOUNCE; vy *= SCRAPE; hit.push('left'); }
    if (x > walls.right && vx > 0) { x = walls.right - (x - walls.right) * BOUNCE; vx = -vx * BOUNCE; vy *= SCRAPE; hit.push('right'); }
    if (y < walls.top && vy < 0) { y = walls.top + (walls.top - y) * BOUNCE; vy = -vy * BOUNCE; vx *= SCRAPE; hit.push('top'); }
    return { body: { x, y, vx, vy }, hit };
  }

  // Moving from a to b: the first edge it crosses going down, within SLACK
  // of its ends, else the floor line once it gets there. null: still flying.
  function landing(a, b, perches, floor) {
    if (b.y <= a.y) return null;
    let best = null;
    for (const e of [...perches, floor]) {
      if (a.y > e.y || b.y < e.y) continue;
      const k = (e.y - a.y) / (b.y - a.y);
      const x = a.x + (b.x - a.x) * k;
      if (e !== floor && (x < e.left - SLACK || x > e.right + SLACK)) continue;
      if (!best || k < best.k) best = { k, edge: e, x };
    }
    if (!best && b.y > floor.y) best = { edge: floor, x: b.x };
    if (!best) return null;
    const { edge, x } = best;
    return { edge, point: { x: Math.max(edge.left, Math.min(edge.right, x)), y: edge.y } };
  }

  const api = { releaseVelocity, isThrow, capped, advance, landing, WINDOW_MS, THROW_MIN, MAX_SPEED, BOUNCE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.birdThrow = api;
})(typeof window !== 'undefined' ? window : globalThis);
