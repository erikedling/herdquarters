// Wire format of `herdr terminal session control <pane>`: newline-delimited
// JSON both ways. Frames arrive as { type: 'terminal.frame', bytes } with the
// rendered ANSI base64-encoded; commands go out as { type: 'terminal.*' }.

// Splits `rest + chunk` into parsed messages and the trailing partial line.
function splitLines(rest, chunk) {
  let buf = rest + chunk;
  const messages = [];
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try { messages.push(JSON.parse(line)); } catch { /* not a protocol line; herdr prints notices on stderr, but be safe */ }
  }
  return { messages, rest: buf };
}

function frameText(msg) {
  return Buffer.from(msg.bytes || '', 'base64').toString('utf8');
}

const line = (obj) => JSON.stringify(obj) + '\n';
const encode = {
  input: (data) => line({ type: 'terminal.input', bytes: Buffer.from(data, 'utf8').toString('base64') }),
  resize: (cols, rows) => line({ type: 'terminal.resize', cols, rows }),
  scroll: (direction, lines) => line({ type: 'terminal.scroll', direction, lines }),
  release: () => line({ type: 'terminal.release' }),
};

module.exports = { splitLines, frameText, encode };
