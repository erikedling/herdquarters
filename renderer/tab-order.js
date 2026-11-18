// The order of the orchestrator tabs, and the pure parts of dragging one.
// The saved order is a list of slugs (settings.tabOrder); null keeps the
// default created_at order. Office and + are not part of it.
(function (root) {
  const THRESHOLD = 5;

  // Saved slugs first, in the saved order; any others (new orchestrators)
  // after them in the order given. Saved slugs that are gone are skipped.
  function applyOrder(slugs, saved) {
    if (!Array.isArray(saved) || !saved.length) return [...slugs];
    const present = new Set(slugs);
    const head = [...new Set(saved)].filter((s) => present.has(s));
    const placed = new Set(head);
    return [...head, ...slugs.filter((s) => !placed.has(s))];
  }

  function move(list, from, to) {
    const out = [...list];
    const [item] = out.splice(from, 1);
    out.splice(Math.max(0, Math.min(to, out.length)), 0, item);
    return out;
  }

  const inside = (r, x, y, margin = 0) => !!r && x >= r.left - margin && x <= r.right + margin && y >= r.top - margin && y <= r.bottom + margin;

  // Where a dragged card lands: on Office it goes first, on + last (the
  // nearest card there could be one in the other row), else at the nearest card.
  function target(rects, x, y, office, add) {
    if (!rects.length) return -1;
    if (inside(office, x, y)) return 0;
    if (inside(add, x, y)) return rects.length - 1;
    return nearest(rects, x, y);
  }

  function nearest(rects, x, y) {
    let best = -1, bestD = Infinity;
    rects.forEach((r, i) => {
      const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom);
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  // A press turns into a drag once the pointer has moved past the threshold,
  // so a click (or the small wobble in one) still just switches tabs.
  function press(x, y, threshold = THRESHOLD) {
    let dragging = false;
    return { moved(mx, my) { if (!dragging && Math.hypot(mx - x, my - y) >= threshold) dragging = true; return dragging; } };
  }

  const api = { applyOrder, move, target, nearest, inside, press, THRESHOLD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.tabOrder = api;
})(typeof window !== 'undefined' ? window : globalThis);
