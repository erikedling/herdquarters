const fs = require('node:fs');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const launch = require('./launch');

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
async function rebuild({ root, checkout, bundle, current, execPath = process.execPath, run = runAsync, npm }) {
  launch.updateState(root, { rebuildTried: rebuildKey(current, wantedMajor(checkout)) });
  await launch.installModules(root, checkout, { npm: npm || ((dir) => launch.npmCi(dir, { args: [] })) });
  const asNode = { cwd: checkout, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } };
  await run(execPath, [path.join(checkout, 'node_modules', 'electron', 'install.js')], asNode);
  await run(execPath, [path.join(checkout, 'scripts', 'make-app.js'), '--out', bundle, '--root', root, '--checkout', checkout,
    '--electron', path.join(checkout, 'node_modules', 'electron', 'dist', 'Electron.app')], asNode);
}

const shellFiles = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith('.js'));

function shellDiffers(checkout, appDir) {
  const src = path.join(checkout, 'shell');
  if (!fs.existsSync(src)) return false;
  const want = shellFiles(src);
  const have = shellFiles(appDir);
  if (want.length !== have.length || want.some((f) => !have.includes(f))) return true;
  return want.some((f) => !fs.readFileSync(path.join(src, f)).equals(fs.readFileSync(path.join(appDir, f))));
}

// The bundle runs its own copy of shell/; bring it in line with the checkout and sign the bundle again.
function syncShell({ checkout, appDir, bundle, run = execFileSync }) {
  if (!shellDiffers(checkout, appDir)) return false;
  const src = path.join(checkout, 'shell');
  for (const f of shellFiles(appDir)) fs.rmSync(path.join(appDir, f));
  for (const f of shellFiles(src)) fs.copyFileSync(path.join(src, f), path.join(appDir, f));
  run('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'ignore' });
  return true;
}

module.exports = { electronMajor, wantedMajor, rebuildPlan, rebuild, shellDiffers, syncShell };
