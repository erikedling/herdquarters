// Throwing PiPi: the release velocity from the last pointer samples, one
// physics step of the flight with bounces off the window's walls and
// ceiling, where a falling PiPi lands, and hitting the dart board. Positions
// are its feet in viewport px (its body for the board), velocities px/ms.
// bird.js flies it; test/bird-throw.test.js runs it in node.
(function (root) {
  const { SLACK } = typeof module !== 'undefined' && module.exports ? require('./bird-drop') : root.birdDrop;
  const WINDOW_MS = 100;  // pointer samples that count for the release
  const MIN_SPAN_MS = 8;  // fewer ms of samples than this is noise, not a throw
  const THROW_MIN = 0.5;  // px/ms (500 px/s): slower than this is a drop
  const MAX_SPEED = 2.4;  // px/ms (2400 px/s)
  const BOUNCE = 0.6;     // share of the speed into a wall it keeps
  const SCRAPE = 0.85;    // share of the speed along a wall it keeps

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
    // Exact under constant gravity, so the path is the same at any frame rate.
    x += vx * dt;
    y += vy * dt + 0.5 * gravity * dt * dt;
    vy += gravity * dt;
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

  // The dart board's rings, inside out, as a share of its radius.
  const RINGS = [
    { r: 0.12, score: 50 }, // bullseye
    { r: 0.25, score: 25 }, // outer bull
    { r: 0.5, score: 15 },
    { r: 0.75, score: 10 },
    { r: 1, score: 5 },
  ];
  function score(point, board) {
    const d = Math.hypot(point.x - board.x, point.y - board.y) / board.r;
    return RINGS.find((ring) => d <= ring.r)?.score ?? 0;
  }

  // Moving from a to b, does it fly into the board { x, y, r }? Tested on the
  // whole segment, so a fast throw cannot skip past it between two frames.
  // It sticks where its line runs closest to the bull, the way a dart's tip
  // goes in where it is aimed rather than where the rim is. Starting on the
  // board does not count: it has to fly in.
  function hitBoard(a, b, board) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const fx = a.x - board.x, fy = a.y - board.y;
    const A = dx * dx + dy * dy;
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - board.r * board.r;
    if (C <= 0 || A === 0) return null;
    const disc = B * B - 4 * A * C;
    if (disc < 0) return null;
    const t = (-B - Math.sqrt(disc)) / (2 * A);
    if (t < 0 || t > 1) return null;
    const s = -B / (2 * A);
    return { t, point: { x: a.x + dx * s, y: a.y + dy * s } };
  }

  const api = { releaseVelocity, isThrow, capped, advance, landing, score, hitBoard, RINGS, WINDOW_MS, THROW_MIN, MAX_SPEED, BOUNCE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.birdThrow = api;
})(typeof window !== 'undefined' ? window : globalThis);
