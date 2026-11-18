const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function electronMajor(lockText) {
  try {
    const v = JSON.parse(lockText).packages?.['node_modules/electron']?.version;
    return v ? Number(String(v).split('.')[0]) : null;
  } catch {
    return null;
  }
}

function needsRebuild(checkout, runningVersion) {
  let lock;
  try { lock = fs.readFileSync(path.join(checkout, 'package-lock.json'), 'utf8'); } catch { return false; }
  const wanted = electronMajor(lock);
  return wanted !== null && wanted !== Number(String(runningVersion).split('.')[0]);
}

// Electron is a dev dependency, and its binary is downloaded by install.js, which needs a Node: the app's own.
function rebuild({ checkout, root, bundle, execPath = process.execPath, run = execFileSync }) {
  const opts = { cwd: checkout, encoding: 'utf8', timeout: 10 * 60_000, stdio: ['ignore', 'pipe', 'pipe'] };
  const asNode = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], opts);
  run(execPath, [path.join(checkout, 'node_modules', 'electron', 'install.js')], { ...opts, env: asNode });
  run(execPath, [path.join(checkout, 'scripts', 'make-app.js'), '--out', bundle, '--root', root, '--checkout', checkout,
    '--electron', path.join(checkout, 'node_modules', 'electron', 'dist', 'Electron.app')], { ...opts, env: asNode });
}

module.exports = { electronMajor, needsRebuild, rebuild };
