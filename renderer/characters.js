// Which character (and so which name) sits at each agent's desk. The boss
// knows its people by these names (PEOPLE.md), so a desk keeps its person for
// as long as its pane exists: a snapshot that misses the agent for a moment,
// Claude restarting in the pane, or an app restart must not hand the desk to
// someone else. herdr never reuses pane ids, so the book is keyed by pane id
// and saved; a pane absent for keepMs is forgotten.
// No DOM, so test/characters.test.js runs it in node; the browser gets
// window.officeCharacters.
(function () {
  const KEEP_MS = 30 * 60 * 1000;

  // entries: { [paneId]: { c: character index, seen: ms } }, as saved by toJSON().
  function createBook({ count, entries = {}, keepMs = KEEP_MS, now = () => Date.now() }) {
    const book = new Map();
    for (const [id, e] of Object.entries(entries || {})) {
      if (e && Number.isInteger(e.c) && e.c >= 0 && e.c < count && Number.isFinite(e.seen)) book.set(id, { c: e.c, seen: e.seen });
    }

    // The panes in this snapshot (agent or not) are still there; panes gone for
    // longer than keepMs are forgotten. Live ones are marked first, so an app
    // that was closed for hours keeps the names of panes that are still open.
    // Returns true when an entry was dropped.
    function touch(paneIds) {
      const t = now();
      for (const id of paneIds) { const e = book.get(id); if (e) e.seen = t; }
      let dropped = false;
      for (const [id, e] of book) if (t - e.seen > keepMs) { book.delete(id); dropped = true; }
      return dropped;
    }

    // The pane's character: the one it has, else the first one nobody in the
    // book holds, starting from a hash of the pane id.
    function assign(paneId) {
      const had = book.get(paneId);
      if (had) return { c: had.c, added: false };
      let h = 0;
      for (let i = 0; i < paneId.length; i++) h = (h * 31 + paneId.charCodeAt(i)) >>> 0;
      const taken = new Set([...book.values()].map((e) => e.c));
      let c = h % count;
      for (let step = 0; step < count && taken.has(c); step++) c = (c + 1) % count;
      book.set(paneId, { c, seen: now() });
      return { c, added: true };
    }

    const toJSON = () => Object.fromEntries(book);
    return { touch, assign, toJSON };
  }

  const api = { createBook, KEEP_MS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.officeCharacters = api;
})();
