// Width of the sidebar while its edge is dragged. The drag starts from the
// rendered width so the edge follows the pointer. In a narrow window the
// sidebar can render narrower than its setting, so only a width the pointer
// actually dragged to is saved; a press without a move saves nothing.
(function (root) {
  const MIN_W = 170, MAX_W = 560;
  function start(renderedWidth, startX) {
    let width = null;
    return {
      // The width to show for this pointer position, or null before the pointer has moved.
      move(x) {
        if (width === null && x === startX) return null;
        width = Math.round(Math.min(MAX_W, Math.max(MIN_W, renderedWidth + x - startX)));
        return width;
      },
      // The width to save, or null to leave the setting alone.
      end: () => width,
    };
  }
  const api = { start, MIN_W, MAX_W };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.sidebarDrag = api;
})(typeof window !== 'undefined' ? window : globalThis);
