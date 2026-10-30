// Keep an xterm selectable while the application has mouse reporting on.
//
// `herdr agent attach` enables mouse tracking (DECSET 1000/1002/1003). xterm
// then hands every drag to the application and stops selecting text, and on
// macOS no modifier overrides that. The panel does not need xterm's mouse
// handling: wheel events are forwarded by hand (terminal.js) and the agents
// do not use clicks. So after each write, if the application turned tracking
// on, turn it off again in xterm only. The application still believes it is
// on and keeps accepting the SGR wheel events the panel sends.
(function (root) {
  const OFF = '\x1b[?1003l\x1b[?1002l\x1b[?1000l';
  // done(): called once xterm has processed the change (writes are queued).
  function keepSelectable(term, done) {
    if (term.modes.mouseTrackingMode !== 'none') term.write(OFF, done);
    else if (done) done();
  }
  const api = { keepSelectable, OFF };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.termSelect = api;
})(typeof window !== 'undefined' ? window : globalThis);
