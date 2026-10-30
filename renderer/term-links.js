// Clickable links in the streamed terminal. xterm's own link addon reads one
// buffer line at a time and relies on wrap flags herdr's frames never set (see
// term-copy.js), so a URL that wraps would be two broken links. This provider
// joins the rows of a logical line first, finds URLs in it and maps them back
// to buffer positions.
(function (root) {
  const continues = (root.termCopy || (typeof require !== 'undefined' && require('./term-copy'))).continues;
  const URL_RE = /https?:\/\/[^\s<>"'`{}|\\^\[\]]+/g;

  // Trailing punctuation belongs to the sentence, not the link; a closing
  // paren does too unless the URL opened it (Wikipedia-style links).
  function trimUrl(url) {
    let u = url;
    for (;;) {
      const m = u.match(/[.,;:!?'"]+$/);
      if (m) { u = u.slice(0, -m[0].length); continue; }
      if (u.endsWith(')') && (u.split('(').length - 1) < (u.split(')').length - 1)) { u = u.slice(0, -1); continue; }
      return u;
    }
  }

  // URLs in a logical line: [{ url, start, end }] with end exclusive.
  function findUrls(text) {
    const out = [];
    for (const m of text.matchAll(URL_RE)) {
      const url = trimUrl(m[0]);
      if (url.length > 'https://'.length) out.push({ url, start: m.index, end: m.index + url.length });
    }
    return out;
  }

  // Links of a logical line that starts at buffer row startRow (0-based) and
  // is stored as full-width rows of `cols` cells, as xterm ILink ranges
  // (1-based, end inclusive).
  function linksFor(text, startRow, cols) {
    return findUrls(text).map(({ url, start, end }) => ({
      url,
      range: {
        start: { x: (start % cols) + 1, y: startRow + Math.floor(start / cols) + 1 },
        end: { x: ((end - 1) % cols) + 1, y: startRow + Math.floor((end - 1) / cols) + 1 },
      },
    }));
  }

  function rowContinues(term, y) {
    const line = term.buffer.active.getLine(y);
    return !!line && continues(line.getCell(term.cols - 1)?.getChars());
  }

  // The logical line holding buffer row y0: its first row and its rows' text
  // joined (rows stay padded to term.cols so offsets map back to cells).
  function logicalLine(term, y0) {
    let start = y0;
    while (start > 0 && rowContinues(term, start - 1)) start--;
    let end = y0;
    const last = term.buffer.active.length - 1;
    while (end < last && rowContinues(term, end)) end++;
    let text = '';
    for (let y = start; y <= end; y++) {
      const row = term.buffer.active.getLine(y)?.translateToString(false) || '';
      text += row.padEnd(term.cols);
    }
    return { start, end, text };
  }

  // xterm ILinkProvider; open(url) is called on click.
  function linkProvider(term, open) {
    return {
      provideLinks(bufferLineNumber, callback) {
        const { start, text } = logicalLine(term, bufferLineNumber - 1);
        const links = linksFor(text, start, term.cols).map(({ url, range }) => ({
          range, text: url,
          decorations: { underline: true, pointerCursor: true },
          activate: () => open(url),
        }));
        callback(links.length ? links : undefined);
      },
    };
  }

  const api = { trimUrl, findUrls, linksFor, logicalLine, linkProvider };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.termLinks = api;
})(typeof window !== 'undefined' ? window : globalThis);
