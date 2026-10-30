// Make the dev Electron bundle carry the app's name and icon. `electron .`
// runs node_modules/electron/dist/Electron.app, whose Info.plist says
// "Electron": that is what the Dock tooltip, the menu bar and Cmd+Tab show,
// and app.setName() cannot change it. Patch the bundle (name, icon) and
// re-sign it ad hoc, the way packagers do. Idempotent; runs on install and
// before start. The name comes from package.json "productName".
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const { productName } = require(path.join(root, 'package.json'));
if (process.platform !== 'darwin' || !productName) process.exit(0);

const app = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
const plist = path.join(app, 'Contents', 'Info.plist');
if (!fs.existsSync(plist)) process.exit(0);

const buddy = (cmd) => execFileSync('/usr/libexec/PlistBuddy', ['-c', cmd, plist], { encoding: 'utf8' }).trim();
const get = (key) => { try { return buddy(`Print :${key}`); } catch { return null; } };
const set = (key, value) => buddy(get(key) === null ? `Add :${key} string ${value}` : `Set :${key} ${value}`);

let changed = false;
for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
  if (get(key) !== productName) { set(key, productName); changed = true; }
}
const icns = path.join(root, 'assets', 'icon.icns');
const target = path.join(app, 'Contents', 'Resources', get('CFBundleIconFile') || 'electron.icns');
if (fs.existsSync(icns) && (!fs.existsSync(target) || !fs.readFileSync(icns).equals(fs.readFileSync(target)))) {
  fs.copyFileSync(icns, target); changed = true;
}
if (changed) {
  // The bundle's ad-hoc signature covers Info.plist and resources; renew it.
  try { execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'ignore' }); }
  catch (err) { console.warn(`brand: codesign failed (${err.message}); the app should still run`); }
  console.log(`brand: dev bundle is now "${productName}" with assets/icon.icns`);
}
