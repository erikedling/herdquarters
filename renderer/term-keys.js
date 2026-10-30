// Editing shortcuts the panel handles itself. Warp gives the native herdr
// client these for full-screen apps; xterm drops every Cmd+arrow combination
// (its key handler bails on metaKey), so map them to the readline keys that
// Claude Code and shells both understand.
(function (root) {
  const CMD = {
    ArrowLeft: '\x01',   // Ctrl+A: line start
    ArrowRight: '\x05',  // Ctrl+E: line end
    Backspace: '\x15',   // Ctrl+U: delete to line start
    Delete: '\x0b',      // Ctrl+K: delete to line end
  };
  // Returns the bytes to send for a keydown the panel owns, or null to let xterm decide.
  function keyToBytes(ev) {
    if (ev.type !== 'keydown') return null;
    if (ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey && CMD[ev.key]) return CMD[ev.key];
    // CSI-u shifted Return, which Claude Code takes as "newline" instead of "send".
    if (ev.key === 'Enter' && ev.shiftKey && !ev.metaKey && !ev.ctrlKey && !ev.altKey) return '\x1b[13;2u';
    return null;
  }
  const api = { keyToBytes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.termKeys = api;
})(typeof window !== 'undefined' ? window : globalThis);
