// The bundle's entry point. syncShell never replaces it, so it can undo a sync whose files do not start.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const LOADER = 'loader.js';
// Installs and syncs relaunch on purpose, so a few launches before the first ready window are normal.
const MAX_TRIES = 6;

const shellFiles = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== LOADER).sort();

// Same as rebuild.shellHash; kept here so this file needs nothing that a sync can break.
function shellHash(dir) {
  const h = crypto.createHash('sha256');
  try { for (const f of shellFiles(dir)) h.update(f).update('\0').update(fs.readFileSync(path.join(dir, f))).update('\0'); } catch { return ''; }
  return h.digest('hex');
}

const signBundle = (bundle) => execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'ignore' });

function giveBack({ here, prev, app, sign, reason }) {
  const { root, checkout, branch = 'main' } = JSON.parse(fs.readFileSync(path.join(here, 'shell.json'), 'utf8'));
  const failed = shellHash(path.join(checkout, 'shell'));
  for (const f of shellFiles(here)) fs.rmSync(path.join(here, f));
  for (const f of shellFiles(prev)) fs.copyFileSync(path.join(prev, f), path.join(here, f));
  fs.rmSync(prev, { recursive: true, force: true });
  try { sign(path.resolve(here, '..', '..', '..')); } catch { /* an unsigned-again bundle still starts when built on this Mac */ }
  const launch = require(path.join(here, 'launch.js'));
  launch.updateState(root, { shellFailed: failed });
  launch.rollBack({ root, checkout, branch, error: `the app's own files failed: ${reason}` });
  app.relaunch();
  app.exit(0);
}

function load({ here = __dirname, app = require('electron').app, sign = signBundle } = {}) {
  const { root } = JSON.parse(fs.readFileSync(path.join(here, 'shell.json'), 'utf8'));
  const prev = path.join(root, 'shell.prev');
  if (fs.existsSync(prev)) {
    const triesFile = path.join(prev, '.tries');
    let tries = 0;
    try { tries = Number(fs.readFileSync(triesFile, 'utf8')) || 0; } catch { /* first launch since the sync */ }
    if (tries + 1 > MAX_TRIES) return giveBack({ here, prev, app, sign, reason: `no window after ${MAX_TRIES} launches` });
    fs.writeFileSync(triesFile, String(tries + 1));
  }
  try {
    require(path.join(here, 'bootstrap.js'));
  } catch (err) {
    if (!fs.existsSync(prev)) throw err;
    giveBack({ here, prev, app, sign, reason: String(err?.message || err).split('\n')[0] });
  }
}

if (require.main === module) load();

module.exports = { load, shellHash, MAX_TRIES };
