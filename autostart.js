// Starting herdr when nothing listens on its socket. The server is detached
// so it outlives Herdquarters, like a herdr started from a terminal.
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const { execFile } = require('node:child_process');

const COOLDOWN_MS = 60_000;
const READY_TIMEOUT_MS = 10_000;

// enabled is null until the renderer has sent the setting; that counts as off.
// Only until herdr first answers: a later outage is usually a deliberate stop
// or an update handoff. A cool-down between tries so a herdr that dies soon
// after starting is not respawned in a loop. A timeout or an error answer
// means a server is there. ECONNREFUSED can also come from a live server with
// a full listen backlog, so it only counts when nobody holds the socket file.
async function shouldAutostart({ enabled, code, starting, everAnswered, lastAttemptAt, now, socketPath }, { socketHeld = socketInUse } = {}) {
  if (enabled !== true || starting || everAnswered) return false;
  if (lastAttemptAt != null && now - lastAttemptAt < COOLDOWN_MS) return false;
  if (code === 'ENOENT') return true;
  return code === 'ECONNREFUSED' && !(await socketHeld(socketPath));
}

// lsof exits 1 with no output when nobody has the file open. Any other
// failure (no lsof, a timeout) counts as held, so we do not start a second server.
function socketInUse(socketPath, { run = execFile } = {}) {
  return new Promise((resolve) => {
    run('lsof', ['-t', '--', socketPath], { timeout: 5000 }, (err, stdout) => {
      if (String(stdout || '').trim()) return resolve(true);
      resolve(!(err && err.code === 1));
    });
  });
}

// What a herdr started from a terminal would get: npm's and Electron's own
// variables would otherwise reach every shell herdr starts.
function serverEnv(env, socketPath) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (/^(npm_|ELECTRON_|OFFICE_)/.test(k) || k === 'INIT_CWD') continue;
    out[k] = v;
  }
  if (out.PATH) out.PATH = out.PATH.split(':').filter((p) => !/\/(node_modules\/\.bin|node-gyp-bin)$/.test(p)).join(':');
  out.HERDR_SOCKET_PATH = socketPath;
  return out;
}

function lastLine(file) {
  try { return fs.readFileSync(file, 'utf8').trim().split('\n').pop().trim(); } catch { return ''; }
}

function socketAnswers(socketPath) {
  return new Promise((resolve) => {
    const sock = net.createConnection(socketPath);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
  });
}

// Runs `<bin> server` listening on socketPath and resolves once the socket
// accepts connections. Rejects with a short reason when it cannot start.
function startHerdrServer({ bin, socketPath, logFile }, { spawn = require('node:child_process').spawn, kill = process.kill, env = process.env, timeoutMs = READY_TIMEOUT_MS, pollMs = 200 } = {}) {
  return new Promise((resolve, reject) => {
    const out = fs.openSync(logFile, 'w');
    let child;
    try {
      child = spawn(bin, ['server'], { cwd: os.homedir(), env: serverEnv(env, socketPath), detached: true, stdio: ['ignore', out, out] });
    } finally {
      fs.closeSync(out);
    }
    let done = false;
    let poll = null;
    let timer = null;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      child.unref();
      err ? reject(err) : resolve();
    };
    child.on('error', (err) => finish(new Error(err.code === 'ENOENT' ? `herdr not found at ${bin}` : err.message)));
    // A server that forks into the background exits too, with its socket up.
    child.on('exit', (code, signal) => socketAnswers(socketPath).then((ok) =>
      finish(ok ? null : new Error(lastLine(logFile) || `herdr server exited (${signal || `code ${code}`})`))));
    poll = setInterval(() => socketAnswers(socketPath).then((ok) => ok && finish()), pollMs);
    // Kill a hung server so tries do not pile up; detached made it a group leader.
    timer = setTimeout(() => {
      try { kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
      finish(new Error(`herdr server did not open its socket within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
  });
}

module.exports = { shouldAutostart, socketInUse, serverEnv, startHerdrServer, COOLDOWN_MS };
