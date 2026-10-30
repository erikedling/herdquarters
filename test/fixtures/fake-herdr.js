#!/usr/bin/env node
// Stand-in for `herdr terminal session control <pane> --cols N --rows N`:
// speaks the same newline-delimited JSON. Prints a full frame on start,
// echoes every input as a frame, answers resize with a full frame of the new
// size, and exits after release. Pane "gone" closes on its own; pane "busy"
// is refused like herdr does for a pane another client holds, unless --takeover.
const args = process.argv.slice(2);
if (args.slice(0, 3).join(' ') !== 'terminal session control') { process.stderr.write(`fake herdr: unexpected args ${args.join(' ')}\n`); process.exit(2); }
const pane = args[3];
if (pane === 'busy' && !args.includes('--takeover')) { // as herdr does: a closed message on stdout, exit 0
  process.stdout.write(JSON.stringify({ type: 'terminal.closed', reason: 'terminal attach failed: terminal term_busy already has an attached client; retry with --takeover' }) + '\n');
  process.exit(0);
}
let cols = Number(args[args.indexOf('--cols') + 1]), rows = Number(args[args.indexOf('--rows') + 1]);
let seq = 0;
const frame = (text, full) => process.stdout.write(JSON.stringify({ type: 'terminal.frame', seq: ++seq, full, width: cols, height: rows, encoding: 'ansi', bytes: Buffer.from(text).toString('base64') }) + '\n');
frame(`\x1b[2J\x1b[Hwelcome ${pane} ${cols}x${rows}`, true);
if (pane === 'gone') { process.stdout.write(JSON.stringify({ type: 'terminal.closed', reason: 'pane closed' }) + '\n'); process.exit(0); }
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) !== -1) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
    let msg; try { msg = JSON.parse(line); } catch { process.stderr.write('fake herdr: invalid json command\n'); continue; }
    if (msg.type === 'terminal.input') frame(Buffer.from(msg.bytes, 'base64').toString(), false);
    else if (msg.type === 'terminal.resize') { cols = msg.cols; rows = msg.rows; frame(`\x1b[2J\x1b[Hresized ${cols}x${rows}`, true); }
    else if (msg.type === 'terminal.scroll') frame(`scrolled ${msg.direction} ${msg.lines}`, false);
    else if (msg.type === 'terminal.release') { process.stdout.write(JSON.stringify({ type: 'terminal.closed', reason: 'detached' }) + '\n'); process.exit(0); }
  }
});
