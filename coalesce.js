// Runs fn one call at a time. Calls that arrive while it runs fold into one
// more run after it, so a slow run never lands after a newer one.
function coalesce(fn) {
  let running = null;
  let again = false;
  return function run() {
    if (running) { again = true; return running; }
    running = (async () => {
      do {
        again = false;
        try { await fn(); } catch (err) { if (!again) throw err; }
      } while (again);
    })().finally(() => { running = null; });
    return running;
  };
}

module.exports = { coalesce };
