// The assistant's Claude session, headless: one `claude -p` process that
// reads user messages as stream-json on stdin and streams its answers as
// stream-json on stdout. It stays up between messages; a restart of the app
// resumes the same session, and clear() starts a fresh one (after a dream).
// Events: 'session' (id), 'delta' (text), 'tool' (name), 'message' (full
// text of one answer), 'idle', 'exit'.

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// An app started from Finder has a short PATH: look where Claude installs too.
function findClaude(env = process.env) {
  const dirs = [...String(env.PATH || '').split(':'), path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin'];
  for (const dir of dirs) {
    const p = path.join(dir, 'claude');
    try { fs.accessSync(p, fs.constants.X_OK); return p; } catch { /* next */ }
  }
  return 'claude';
}

// One stream-json line → the events the office cares about.
function parseLine(line) {
  let o;
  try { o = JSON.parse(line); } catch { return []; }
  if (o.type === 'system' && o.subtype === 'init') return [{ type: 'session', id: o.session_id }];
  if (o.type === 'stream_event') {
    const e = o.event || {};
    if (o.parent_tool_use_id) return []; // a subagent's stream is not the answer
    if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') return [{ type: 'delta', text: e.delta.text }];
    if (e.type === 'content_block_start' && e.content_block?.type === 'tool_use') return [{ type: 'tool', name: e.content_block.name }];
    return [];
  }
  if (o.type === 'assistant' && !o.parent_tool_use_id) {
    const text = (o.message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return text ? [{ type: 'message', text }] : [];
  }
  if (o.type === 'result') return [{ type: 'idle', error: o.is_error ? String(o.result || o.subtype || 'error') : null }];
  return [];
}

const userLine = (text) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n';

class AssistantSession extends EventEmitter {
  constructor({ dir, claude = findClaude() }) {
    super();
    this.dir = dir;
    this.claude = claude;
    this.proc = null;
    this.busy = false;
  }

  get running() { return !!this.proc; }

  // resume: a session id to continue, or null for a fresh one.
  start(resume = null) {
    if (this.proc) return;
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompts', 'none'];
    if (resume) args.push('--resume', resume);
    const proc = spawn(this.claude, args, { cwd: this.dir, env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'herdquarters-assistant' }, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    this.busy = false;
    let buf = '';
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        for (const ev of parseLine(line)) {
          if (ev.type === 'idle') this.busy = false;
          this.emit(ev.type, ev);
        }
      }
    });
    let err = '';
    proc.stderr.on('data', (chunk) => { err = (err + chunk).slice(-2000); });
    proc.on('error', (e) => { err = String(e.message || e); });
    proc.on('exit', (code) => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.busy = false;
      this.emit('exit', { code, error: code ? err.trim() : null });
    });
  }

  send(text) {
    if (!this.proc) throw new Error('The assistant is not running');
    this.busy = true;
    this.proc.stdin.write(userLine(text));
  }

  stop() {
    const proc = this.proc;
    this.proc = null;
    this.busy = false;
    if (proc) { proc.stdin.end(); proc.kill(); }
  }
}

module.exports = { AssistantSession, parseLine, userLine, findClaude };
