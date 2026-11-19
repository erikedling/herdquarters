const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');
const launch = require('./launch');

const LOADER = 'loader.js';

function electronMajor(lockText) {
  try {
    const v = JSON.parse(lockText).packages?.['node_modules/electron']?.version;
    return v ? Number(String(v).split('.')[0]) : null;
  } catch {
    return null;
  }
}

function wantedMajor(checkout) {
  try { return electronMajor(fs.readFileSync(path.join(checkout, 'package-lock.json'), 'utf8')); } catch { return null; }
}

const major = (version) => Number(String(version).split('.')[0]);
const rebuildKey = (current, wanted) => `${current}:${wanted}`;

// 'none', 'rebuild', or 'gaveUp' when this commit was already rebuilt for and still does not match.
function rebuildPlan({ root, checkout, current, running }) {
  const wanted = wantedMajor(checkout);
  if (wanted === null || wanted === major(running)) return 'none';
  return launch.readState(root).rebuildTried === rebuildKey(current, wanted) ? 'gaveUp' : 'rebuild';
}

const runAsync = (cmd, args, opts) => new Promise((resolve, reject) => {
  execFile(cmd, args, { encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
    if (err) { err.stderr = stderr; reject(err); } else resolve(stdout);
  });
});

// Electron is a dev dependency, and its binary is downloaded by install.js, which needs a Node: the app's own.
async function rebuild({ root, checkout, branch = 'main', bundle, current, execPath = process.execPath, run = runAsync, npm, signal }) {
  launch.updateState(root, { rebuildTried: rebuildKey(current, wantedMajor(checkout)) });
  await launch.installModules(root, checkout, { npm: npm || ((dir, opts) => launch.npmCi(dir, { ...opts, args: [] })), signal });
  const asNode = { cwd: checkout, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } };
  await run(execPath, [path.join(checkout, 'node_modules', 'electron', 'install.js')], { ...asNode, signal });
  signal?.throwIfAborted();
  // No signal: stopped between its two renames, make-app would leave no app at all.
  await run(execPath, [path.join(checkout, 'scripts', 'make-app.js'), '--out', bundle, '--root', root, '--checkout', checkout, '--branch', branch,
    '--electron', path.join(checkout, 'node_modules', 'electron', 'dist', 'Electron.app')], asNode);
}

const shellFiles = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== LOADER).sort();
// Outside the bundle, so keeping and dropping it never breaks the bundle's signature.
const prevDir = (root) => path.join(root, 'shell.prev');

function shellHash(dir) {
  const h = crypto.createHash('sha256');
  try { for (const f of shellFiles(dir)) h.update(f).update('\0').update(fs.readFileSync(path.join(dir, f))).update('\0'); } catch { return ''; }
  return h.digest('hex');
}

function shellDiffers(checkout, appDir) {
  const src = path.join(checkout, 'shell');
  if (!fs.existsSync(src)) return false;
  const want = shellFiles(src);
  const have = shellFiles(appDir);
  if (want.length !== have.length || want.some((f) => !have.includes(f))) return true;
  return want.some((f) => !fs.readFileSync(path.join(src, f)).equals(fs.readFileSync(path.join(appDir, f))));
}

// The bundle runs its own copy of shell/ (all but loader.js); bring it in line with the checkout and sign again.
// The set that last reached a ready window stays in shell.prev, for loader.js to put back, until a new one does.
function syncShell({ root, checkout, appDir, bundle, run = execFileSync, execPath = process.execPath }) {
  if (!shellDiffers(checkout, appDir)) return false;
  const src = path.join(checkout, 'shell');
  const want = shellFiles(src);
  for (const f of want) run(execPath, ['--check', path.join(src, f)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'ignore' });
  for (const f of want) fs.copyFileSync(path.join(src, f), path.join(appDir, `.${f}.new`));
  const prev = prevDir(root);
  if (!fs.existsSync(prev)) {
    fs.mkdirSync(`${prev}.tmp`, { recursive: true });
    for (const f of shellFiles(appDir)) fs.copyFileSync(path.join(appDir, f), path.join(`${prev}.tmp`, f));
    fs.renameSync(`${prev}.tmp`, prev);
  }
  for (const f of want) fs.renameSync(path.join(appDir, `.${f}.new`), path.join(appDir, f));
  for (const f of shellFiles(appDir)) if (!want.includes(f)) fs.rmSync(path.join(appDir, f));
  run('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'ignore' });
  return true;
}

const confirmShell = (root) => fs.rmSync(prevDir(root), { recursive: true, force: true });

module.exports = { electronMajor, wantedMajor, rebuildPlan, rebuild, shellDiffers, shellHash, syncShell, confirmShell, prevDir };
