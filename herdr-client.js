// Thin client for the herdr Unix socket API.
//
// Wire format: newline-delimited JSON. A plain request gets one response
// and the server closes the connection. An `events.subscribe` request
// keeps the connection open and streams `{event, data}` envelopes.
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_SOCKET = path.join(os.homedir(), '.config', 'herdr', 'herdr.sock');

class HerdrClient {
  constructor(socketPath = process.env.HERDR_SOCKET || DEFAULT_SOCKET) {
    this.socketPath = socketPath;
    this.seq = 0;
  }

  request(method, params = {}, timeoutMs = 4000) {
    const id = `office:${++this.seq}`;
    return new Promise((resolve, reject) => {
      const sock = net.createConnection(this.socketPath);
      let buf = '';
      let settled = false;
      const finish = (fn, v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.destroy();
        fn(v);
      };
      const timer = setTimeout(() => finish(reject, new Error(`${method}: timeout`)), timeoutMs);
      sock.on('connect', () => sock.write(JSON.stringify({ id, method, params }) + '\n'));
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        const nl = buf.indexOf('\n');
        if (nl === -1) return;
        let msg;
        try { msg = JSON.parse(buf.slice(0, nl)); } catch (e) { return finish(reject, e); }
        // herdr answered with an error, so the request did not take effect; a timeout or a closed connection says nothing either way.
        if (msg.error) return finish(reject, Object.assign(new Error(`${method}: ${msg.error.code} ${msg.error.message}`), { answered: true, code: msg.error.code }));
        finish(resolve, msg.result);
      });
      sock.on('error', (e) => finish(reject, e));
      sock.on('close', () => finish(reject, new Error(`${method}: connection closed`)));
    });
  }

  // Opens a long-lived subscription. Calls onEvent(envelope) for every event,
  // onClose(err) when the connection drops. Returns a handle with close().
  subscribe(subscriptions, { onEvent, onClose }) {
    const id = `office:sub:${++this.seq}`;
    const sock = net.createConnection(this.socketPath);
    let buf = '';
    let closed = false;
    sock.on('connect', () => {
      sock.write(JSON.stringify({ id, method: 'events.subscribe', params: { subscriptions } }) + '\n');
    });
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === id) {
          if (msg.error) { closed = true; sock.destroy(); onClose?.(new Error(msg.error.message)); }
          continue; // subscription_started ack
        }
        if (msg.event) onEvent?.(msg);
      }
    });
    const done = (err) => { if (closed) return; closed = true; onClose?.(err); };
    sock.on('error', done);
    sock.on('close', () => done());
    return { close: () => { closed = true; sock.destroy(); } };
  }
}

module.exports = { HerdrClient, DEFAULT_SOCKET };
