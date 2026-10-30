// Width of the split terminal panel while the divider is dragged, as a % of
// the workspace: --panel-width is a flex-basis there, so this is the same
// number the settings slider shows. The drag starts from the rendered width
// so the divider follows the pointer. The panel keeps its 420px minimum, the
// office keeps OFFICE_MIN, and the % stays inside the slider's range.
(function (root) {
  // Same range as the #set-width slider in index.html; change both together.
  const MIN_PCT = 30, MAX_PCT = 75, PANEL_MIN = 420, OFFICE_MIN = 240;

  // total: workspace width; reserved: what else sits in it (the sidebar).
  function range(total, reserved = 0) {
    const lo = Math.max(MIN_PCT, Math.ceil((PANEL_MIN / total) * 100));
    const hi = Math.min(MAX_PCT, Math.floor(((total - reserved - OFFICE_MIN) / total) * 100));
    // Too narrow for both minimums: the panel's wins, as its CSS min-width would anyway.
    return { lo, hi: Math.max(lo, hi) };
  }

  function start({ total, reserved = 0, panelWidth, startX }) {
    const { lo, hi } = range(total, reserved);
    let pct = null;
    return {
      // The % to show for this pointer position, or null before the pointer has moved.
      move(x) {
        if (pct === null && x === startX) return null;
        const px = panelWidth + startX - x;
        pct = Math.round(Math.min(hi, Math.max(lo, (px / total) * 100)));
        return pct;
      },
      // The % to save, or null to leave the setting alone.
      end: () => pct,
    };
  }
  const api = { start, range, MIN_PCT, MAX_PCT, PANEL_MIN, OFFICE_MIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.panelDrag = api;
})(typeof window !== 'undefined' ? window : globalThis);
