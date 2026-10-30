// Copying from the streamed terminal. herdr redraws every row with an explicit
// cursor move (see stream-protocol.js), so xterm never learns that two rows are
// one wrapped line and puts a newline at every row boundary when copying — a
// long URL comes out broken. Rebuild the text from the buffer instead: a row
// whose last cell holds a character continues on the next row.
(function (root) {
  // Does a row whose last cell shows `lastChar` continue on the next row?
  function continues(lastChar) { return !!lastChar && !/\s/.test(lastChar); }

  // segments: [{ text, continues }] in selection order → the copied text.
  function joinSegments(segments) {
    return segments.map((s, i) => {
      const last = i === segments.length - 1;
      if (s.continues && !last) return s.text;
      const text = s.text.replace(/\s+$/, '');
      return last ? text : text + '\n';
    }).join('');
  }

  // rows: full-width row strings (padded, as xterm stores them). The selection
  // runs from startCol on the first row to endCol (exclusive) on the last.
  function joinRows(rows, { cols, startCol = 0, endCol = cols }) {
    return joinSegments(rows.map((row, i) => {
      const first = i === 0, last = i === rows.length - 1;
      return { text: row.slice(first ? startCol : 0, last ? endCol : cols), continues: !last && continues(row[cols - 1]) };
    }));
  }

  // The current selection of an xterm Terminal as text, wrapped rows joined.
  function selectionText(term) {
    const pos = term.getSelectionPosition();
    if (!pos) return '';
    const buf = term.buffer.active;
    const cols = term.cols;
    const segments = [];
    for (let y = pos.start.y; y <= pos.end.y; y++) {
      const line = buf.getLine(y);
      const first = y === pos.start.y, last = y === pos.end.y;
      const from = first ? pos.start.x : 0, to = last ? pos.end.x : cols;
      const lastChar = line ? line.getCell(cols - 1)?.getChars() : '';
      segments.push({ text: line ? line.translateToString(false, from, to) : '', continues: !last && continues(lastChar) });
    }
    return joinSegments(segments);
  }

  const api = { continues, joinSegments, joinRows, selectionText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.termCopy = api;
})(typeof window !== 'undefined' ? window : globalThis);
