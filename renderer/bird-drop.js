// Where PiPi lands when the user lets go of it: the nearest edge below the
// drop point (within 16 px of its ends, the slack grounded() in bird.js
// allows), else the status bar's line. Edges are { left, right, y } in
// viewport px; the point is where its feet are.
(function (root) {
  const SLACK = 16;

  function landing(perches, at, line) {
    const below = perches
      .filter((e) => e.y >= at.y - 2 && at.x >= e.left - SLACK && at.x <= e.right + SLACK)
      .sort((a, b) => a.y - b.y)[0];
    const edge = below || line;
    return { edge, point: { x: Math.max(edge.left, Math.min(edge.right, at.x)), y: edge.y } };
  }

  const api = { landing, SLACK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.birdDrop = api;
})(typeof window !== 'undefined' ? window : globalThis);
