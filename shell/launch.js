// Which commit of the managed checkout the Dock app runs. An update that
// needs a restart is only recorded while the app runs (state.pending) and is
// checked out here, before main.js loads, so a running app never mixes old and
// new files. A commit that never gets a window up is rolled back to the last
// one that did (state.lastGood) and remembered as bad, so it is not offered again.
//
// state.json in the root folder:
//   lastGood  commit whose window last finished loading
//   booting   commit being started; cleared once its window has loaded
//   pending   commit to check out at the next launch
//   bad       commit that failed to start and was rolled back
//   notice    what the office should tell the user: { kind: 'rolledBack' | 'applyFailed', from, to, error, at }
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const NPM_TIMEOUT_MS = 5 * 60_000;

function git(cwd, args, { run = execFileSync } = {}) {
  return String(run('git', ['-C', cwd, ...args], {
    encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
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

function lockfileDiffers(checkout, from, to) {
  return git(checkout, ['diff', '--name-only', from, to, '--', 'package-lock.json']) !== '';
}

// Only the xterm packages are needed at run time; Electron comes from the .app.
function npmCi(checkout, { run = execFileSync } = {}) {
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: checkout, encoding: 'utf8', timeout: NPM_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function assertClean(checkout) {
  const dirty = git(checkout, ['status', '--porcelain', '--untracked-files=no']);
  if (dirty) throw new Error(`the app's checkout at ${checkout} has local changes`);
}

// Checks out sha on the tracked branch, installing again when the lockfile
// differs. On a failed install it goes back to where it was.
function moveTo(checkout, sha, { branch = 'main', npm = npmCi } = {}) {
  const from = head(checkout);
  if (from === sha) return;
  assertClean(checkout);
  git(checkout, ['checkout', '-q', '-B', branch, sha]);
  if (!lockfileDiffers(checkout, from, sha)) return;
  try {
    npm(checkout);
  } catch (err) {
    git(checkout, ['checkout', '-q', '-B', branch, from]);
    try { npm(checkout); } catch { /* the old modules may still be there */ }
    throw err;
  }
}

const shortError = (err) => String(err?.stderr || err?.message || err).trim().split('\n').filter(Boolean).pop() || 'unknown error';

// Runs before main.js loads. Returns the commit that will run.
function prepareLaunch({ root, checkout, branch = 'main', npm = npmCi, now = Date.now() }) {
  let state = readState(root);
  let current = head(checkout);
  if (state.booting && state.booting === current && state.lastGood && state.lastGood !== current) {
    current = rollBack({ root, checkout, branch, npm, now, error: 'the window never finished loading' });
  } else if (state.pending && state.pending !== current) {
    try {
      moveTo(checkout, state.pending, { branch, npm });
      current = head(checkout);
    } catch (err) {
      state = updateState(root, { notice: { kind: 'applyFailed', to: state.pending, error: shortError(err), at: now } });
    }
  }
  updateState(root, { pending: null, booting: current });
  return current;
}

// Back to the last commit that started. Returns the commit now checked out.
function rollBack({ root, checkout, branch = 'main', npm = npmCi, now = Date.now(), error }) {
  const state = readState(root);
  const from = head(checkout);
  if (!state.lastGood || state.lastGood === from) return from;
  try {
    moveTo(checkout, state.lastGood, { branch, npm });
  } catch (err) {
    updateState(root, { booting: null, notice: { kind: 'rollbackFailed', from, to: state.lastGood, error: shortError(err), at: now } });
    return head(checkout);
  }
  updateState(root, { bad: from, booting: null, pending: null, notice: { kind: 'rolledBack', from, to: state.lastGood, error, at: now } });
  return state.lastGood;
}

function markGood(root, sha) {
  return updateState(root, { lastGood: sha, booting: null });
}

module.exports = { git, readState, updateState, head, lockfileDiffers, npmCi, moveTo, prepareLaunch, rollBack, markGood, shortError };
