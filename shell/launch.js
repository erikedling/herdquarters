// state.json: lastGood (window came up), booting (main.js loading), pending (for the next launch), bad, notice,
// modulesFor (hash of the lockfile node_modules was installed from), rebuildTried.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, execFile } = require('node:child_process');

const NPM_TIMEOUT_MS = 5 * 60_000;
const gitEnv = () => ({ ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' });

function git(cwd, args, { run = execFileSync } = {}) {
  return String(run('git', ['-C', cwd, ...args], {
    encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv(),
  })).trim();
}

const stateFile = (root) => path.join(root, 'state.json');

function readState(root) {
  try { return JSON.parse(fs.readFileSync(stateFile(root), 'utf8')) || {}; } catch { return {}; }
}

function updateState(root, patch) {
  const next = { ...readState(root), ...patch };
  fs.mkdirSync(root, { recursive: true });
  const tmp = `${stateFile(root)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  fs.renameSync(tmp, stateFile(root));
  return next;
}

const head = (checkout) => git(checkout, ['rev-parse', 'HEAD']);

function lockHash(checkout) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(path.join(checkout, 'package-lock.json'))).digest('hex'); } catch { return ''; }
}

const modulesDir = (checkout) => path.join(checkout, 'node_modules');
const stagedDir = (checkout) => path.join(checkout, 'node_modules.prev');

function modulesReady(root, checkout) {
  if (fs.existsSync(stagedDir(checkout)) || !fs.existsSync(modulesDir(checkout))) return false;
  return readState(root).modulesFor === lockHash(checkout);
}

// Only the xterm packages are needed at run time; Electron comes from the .app.
function npmCi(checkout, { args = ['--omit=dev'], run = execFile } = {}) {
  return new Promise((resolve, reject) => {
    run('npm', ['ci', ...args, '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: checkout, encoding: 'utf8', timeout: NPM_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; reject(err); } else resolve();
    });
  });
}

// npm ci deletes node_modules before it installs, so the old one is moved aside
// and put back if the install fails or is cut short.
async function installModules(root, checkout, { npm = npmCi } = {}) {
  const live = modulesDir(checkout);
  const staged = stagedDir(checkout);
  if (fs.existsSync(staged)) {
    fs.rmSync(live, { recursive: true, force: true });
    fs.renameSync(staged, live);
  }
  if (modulesReady(root, checkout)) return false;
  if (fs.existsSync(live)) fs.renameSync(live, staged);
  try {
    await npm(checkout);
  } catch (err) {
    fs.rmSync(live, { recursive: true, force: true });
    if (fs.existsSync(staged)) fs.renameSync(staged, live);
    throw err;
  }
  updateState(root, { modulesFor: lockHash(checkout) });
  fs.rmSync(staged, { recursive: true, force: true });
  return true;
}

function assertClean(checkout) {
  if (git(checkout, ['status', '--porcelain', '--untracked-files=no'])) {
    throw new Error(`the app's checkout at ${checkout} has local changes; npm run install-app -- --reset starts it over`);
  }
}

function isAncestor(checkout, a, b) {
  try { git(checkout, ['merge-base', '--is-ancestor', a, b]); return true; } catch { return false; }
}

// forward: an update, which must not drop commits that only the checkout has.
function checkoutTo(checkout, sha, { branch = 'main', forward = false } = {}) {
  if (head(checkout) === sha) return;
  assertClean(checkout);
  if (forward && !isAncestor(checkout, 'HEAD', sha)) {
    throw new Error(`the app's checkout has commits that ${sha.slice(0, 7)} does not; npm run install-app -- --reset starts it over`);
  }
  git(checkout, ['checkout', '-q', '-B', branch, sha]);
}

// npm ends with the path of its log, so its first real message is the useful one; git's is its last line.
function shortError(err) {
  const lines = String(err?.stderr || err?.message || err).split('\n').map((l) => l.trim()).filter(Boolean);
  const npm = lines.filter((l) => /^npm (error|ERR!)/.test(l))
    .map((l) => l.replace(/^npm (error|ERR!)\s*/, ''))
    .filter((l) => l && !/^code\b|complete log of this run/.test(l))
    .map((l) => l.replace(/^[a-z]+\s+(?=[A-Z])/, ''));
  return npm[0] || lines.pop() || 'unknown error';
}

// Git only, so it is quick; installing packages is left to the caller, which can show progress.
function prepareLaunch({ root, checkout, branch = 'main', now = Date.now() }) {
  const state = readState(root);
  let current = head(checkout);
  if (state.booting && state.booting === current && state.lastGood && state.lastGood !== current) {
    current = rollBack({ root, checkout, branch, now, error: 'the window never came up' });
  } else if (state.pending && state.pending !== current) {
    try {
      checkoutTo(checkout, state.pending, { branch, forward: true });
      current = head(checkout);
    } catch (err) {
      updateState(root, { notice: { kind: 'applyFailed', to: state.pending, error: shortError(err), at: now } });
    }
  }
  updateState(root, { pending: null });
  return { current, needsModules: !modulesReady(root, checkout) };
}

function rollBack({ root, checkout, branch = 'main', now = Date.now(), error }) {
  const state = readState(root);
  const from = head(checkout);
  if (!state.lastGood || state.lastGood === from) return from;
  try {
    checkoutTo(checkout, state.lastGood, { branch });
  } catch (err) {
    updateState(root, { booting: null, notice: { kind: 'rollbackFailed', from, to: state.lastGood, error: shortError(err), at: now } });
    return head(checkout);
  }
  updateState(root, { bad: from, booting: null, pending: null, notice: { kind: 'rolledBack', from, to: state.lastGood, error, at: now } });
  return state.lastGood;
}

const markBooting = (root, sha) => updateState(root, { booting: sha });
const markGood = (root, sha) => updateState(root, { lastGood: sha, booting: null });

module.exports = {
  git, gitEnv, readState, updateState, head, lockHash, modulesReady, npmCi, installModules,
  assertClean, isAncestor, checkoutTo, prepareLaunch, rollBack, markBooting, markGood, shortError,
};
