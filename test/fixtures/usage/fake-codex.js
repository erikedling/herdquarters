#!/usr/bin/env node
// A stand-in for `codex app-server`: answers initialize and account/rateLimits/read
// the way Codex does, with a notification in between. FAKE_CODEX=exit dies at once,
// FAKE_CODEX=uninit refuses requests before `initialized`, FAKE_CODEX=stuck
// prints its pid, never answers and ignores SIGTERM. Any args but `app-server` fail.
const mode = process.env.FAKE_CODEX || '';
if (process.argv.slice(2).join(' ') !== 'app-server') { process.stderr.write(`unexpected args: ${process.argv.slice(2).join(' ')}\n`); process.exit(2); }
if (mode === 'exit') { process.stderr.write('codex: not logged in\n'); process.exit(1); }
if (mode === 'stuck') { process.on('SIGTERM', () => {}); process.stderr.write(`pid ${process.pid}\n`); setInterval(() => {}, 1000); return; }
let initialized = false;
let buf = '';
const send = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (msg.method === 'initialize') send({ id: msg.id, result: { userAgent: 'fake', args: process.argv.slice(2) } });
    else if (msg.method === 'initialized') { initialized = true; send({ method: 'account/updated', params: {} }); }
    else if (msg.method === 'account/rateLimits/read') {
      if (!initialized || mode === 'uninit') send({ id: msg.id, error: { code: -32600, message: 'Not initialized' } });
      else send({ id: msg.id, result: { rateLimits: { limitId: 'codex', planType: 'plus', primary: { usedPercent: 6, windowDurationMins: 300, resetsAt: 1795010410 }, secondary: { usedPercent: 2, windowDurationMins: 10080, resetsAt: 1795186710 } } } });
    }
  }
});
