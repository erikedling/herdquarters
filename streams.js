// Embedded terminals: one `herdr terminal session control <pane_id>` per open
// desk, driven over pipes. herdr renders the pane at our size and streams
// frames as JSON; keystrokes, resizes and scrolls go back as JSON commands.
// Works for agent panes and plain shells alike, with a few ms of latency.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { splitLines, frameText, encode } = require('./stream-protocol');

function resolveHerdr() {
  if (process.env.HERDR_BIN) return process.env.HERDR_BIN;
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'herdr'),
    '/opt/homebrew/bin/herdr',
    '/usr/local/bin/herdr',
  ];
  return candidates.find((p) => fs.existsSync(p)) || 'herdr';
}

const RELEASE_GRACE_MS = 800;
const BUSY = /already has an attached client/;

class StreamManager {
  constructor(send, { bin } = {}) {
    this.send = send; // (channel, payload) => void
    this.streams = new Map(); // id -> { proc, paneId, rest, closing, cols, rows, takeover }
    this.seq = 0;
    this.herdr = bin || resolveHerdr();
  }

  // One stream per pane: a second open for a pane this app already shows
  // (a double-click, a tab switch racing a click) would be refused by herdr
  // and leave the first attachment orphaned, so the old one is released first.
  async open({ paneId, cols = 100, rows = 30 }) {
    for (const [oldId, s] of this.streams) if (s.paneId === paneId) await this.close(oldId);
    const id = `s${++this.seq}`;
    const entry = { paneId, rest: '', closing: false, cols: Math.max(20, cols | 0), rows: Math.max(5, rows | 0), takeover: false };
    this.streams.set(id, entry);
    this.attach(id, entry);
    return id;
  }

  attach(id, entry) {
    const args = ['terminal', 'session', 'control', entry.paneId, '--cols', String(entry.cols), '--rows', String(entry.rows)];
    if (entry.takeover) args.push('--takeover');
    const proc = spawn(this.herdr, args, { cwd: os.homedir(), env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    entry.proc = proc; entry.rest = ''; entry.stderr = '';
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => {
      const { messages, rest } = splitLines(entry.rest, chunk);
      entry.rest = rest;
      for (const msg of messages) {
        if (msg.type === 'terminal.frame') this.send('term-data', { id, data: frameText(msg) });
        else if (msg.type === 'terminal.closed') this.closed(id, entry, msg.reason || 'closed');
      }
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (text) => { entry.stderr = ((entry.stderr || '') + text).slice(-2000); });
    proc.on('error', (err) => this.exit(id, err.message));
    // 'close', not 'exit': stderr can still be in flight when the process exits.
    proc.on('close', (code, signal) => this.closed(id, entry, entry.stderr?.trim() || (signal ? `killed (${signal})` : `exited (code ${code})`)));
    proc.stdin.on('error', () => { /* process already gone; exit handler reports it */ });
  }

  // herdr ended the stream, with its reason (a `terminal.closed` message, or
  // the process going away). A refused attach means something else still
  // holds the pane: a client that died without herdr noticing, or an earlier
  // run of this app. Take it over, once, on the same stream id.
  closed(id, entry, reason) {
    if (this.streams.get(id) !== entry) return; // already replaced or reported
    if (!entry.closing && !entry.takeover && BUSY.test(reason)) {
      entry.takeover = true;
      entry.proc.removeAllListeners('close');
      this.attach(id, entry);
      return;
    }
    this.exit(id, reason);
  }

  // Reports a stream the user did not close themselves, once.
  exit(id, reason) {
    const s = this.streams.get(id);
    if (!s) return;
    this.streams.delete(id);
    clearTimeout(s.killTimer);
    if (!s.closing) this.send('term-exit', { id, reason });
  }

  write(id, line) {
    const s = this.streams.get(id);
    if (!s || s.closing || !s.proc.stdin.writable) return;
    s.proc.stdin.write(line);
  }

  input(id, data) { this.write(id, encode.input(data)); }
  resize(id, cols, rows) { if (cols > 0 && rows > 0) this.write(id, encode.resize(cols | 0, rows | 0)); }
  scroll(id, direction, lines) { if (lines > 0) this.write(id, encode.scroll(direction, lines | 0)); }

  // Release politely so herdr detaches cleanly; kill only if it lingers.
  close(id) {
    const s = this.streams.get(id);
    if (!s) return Promise.resolve();
    if (s.proc.exitCode !== null) { this.streams.delete(id); return Promise.resolve(); }
    s.closing = true;
    return new Promise((resolve) => {
      const done = () => { clearTimeout(s.killTimer); this.streams.delete(id); resolve(); };
      s.proc.once('exit', done);
      s.killTimer = setTimeout(() => { try { s.proc.kill(); } catch { /* gone */ } }, RELEASE_GRACE_MS);
      try { s.proc.stdin.write(encode.release()); s.proc.stdin.end(); } catch { done(); }
    });
  }

  closeAll() { for (const id of [...this.streams.keys()]) this.close(id); }
}

module.exports = { StreamManager, resolveHerdr };
