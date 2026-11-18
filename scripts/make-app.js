// Builds Herdquarters.app: node scripts/make-app.js --out <Herdquarters.app> --root <dir> --checkout <dir> [--electron <Electron.app>]
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repo = path.join(__dirname, '..');
const BUNDLE_ID = 'com.github.erikedling.herdquarters';

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument ${argv[i]}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) out[argv[i].slice(2)] = true;
    else { out[argv[i].slice(2)] = value; i += 1; }
  }
  return out;
}

// The old bundle is renamed away and deleted, so only ever a .app this script made.
function checkTarget(out) {
  if (path.extname(path.resolve(out)) !== '.app') throw new Error(`--out must name a .app bundle, not ${out}`);
  if (fs.existsSync(out) && !fs.existsSync(path.join(out, 'Contents', 'Resources', 'app', 'shell.json'))) {
    throw new Error(`${out} exists and was not built by make-app.js; move it away first`);
  }
}

function makeApp({ out, root, checkout, electron = path.join(repo, 'node_modules', 'electron', 'dist', 'Electron.app'), shellSrc = path.join(repo, 'shell'), icon = path.join(repo, 'assets', 'icon.icns') }) {
  if (!out || !root || !checkout) throw new Error('--out, --root and --checkout are required');
  out = path.resolve(out);
  checkTarget(out);
  if (!fs.existsSync(electron)) throw new Error(`no Electron at ${electron}: run npm install first`);
  const { productName, version } = require(path.join(repo, 'package.json'));
  const building = `${out}.building`;
  const old = `${out}.old`;
  fs.rmSync(building, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('ditto', [electron, building]);

  const plist = path.join(building, 'Contents', 'Info.plist');
  const buddy = (cmd) => execFileSync('/usr/libexec/PlistBuddy', ['-c', cmd, plist], { encoding: 'utf8' }).trim();
  const set = (key, value) => { try { buddy(`Set :${key} ${value}`); } catch { buddy(`Add :${key} string ${value}`); } };
  set('CFBundleName', productName);
  set('CFBundleDisplayName', productName);
  set('CFBundleIdentifier', BUNDLE_ID);
  set('CFBundleShortVersionString', version);
  const resources = path.join(building, 'Contents', 'Resources');
  fs.copyFileSync(icon, path.join(resources, buddy('Print :CFBundleIconFile')));
  fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });

  const app = path.join(resources, 'app');
  fs.mkdirSync(app);
  for (const f of fs.readdirSync(shellSrc)) if (f.endsWith('.js')) fs.copyFileSync(path.join(shellSrc, f), path.join(app, f));
  fs.writeFileSync(path.join(app, 'package.json'), `${JSON.stringify({ name: 'herdquarters-shell', productName, version, private: true, main: 'loader.js' }, null, 2)}\n`);
  fs.writeFileSync(path.join(app, 'shell.json'), `${JSON.stringify({ root: path.resolve(root), checkout: path.resolve(checkout), branch: 'main' }, null, 2)}\n`);

  // Ad hoc is enough: an app built on this Mac is not quarantined, so Gatekeeper opens it.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', building], { stdio: 'ignore' });
  fs.rmSync(old, { recursive: true, force: true });
  // Swapped in by rename so a running copy can rebuild itself.
  if (fs.existsSync(out)) fs.renameSync(out, old);
  fs.renameSync(building, out);
  fs.rmSync(old, { recursive: true, force: true });
  return out;
}

if (require.main === module) {
  try {
    console.log(`built ${makeApp(args(process.argv.slice(2)))}`);
  } catch (err) {
    console.error(`make-app: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { makeApp, checkTarget, args, BUNDLE_ID };
