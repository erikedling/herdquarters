// Copied into Herdquarters.app by scripts/make-app.js; see "The Dock app" in docs/GUIDE.md.
const fs = require('node:fs');
const path = require('node:path');
const { app, dialog } = require('electron');
const { importLoginPath } = require('./login-path');
const launch = require('./launch');
const rebuild = require('./rebuild');

const BOOT_TIMEOUT_MS = 30_000;
const { root, checkout, branch = 'main' } = JSON.parse(fs.readFileSync(path.join(__dirname, 'shell.json'), 'utf8'));
const bundle = path.resolve(process.execPath, '..', '..', '..');
const opts = { root, checkout, branch };

const relaunch = () => { app.relaunch(); app.exit(0); };
const fail = (title, err) => { dialog.showErrorBox(title, launch.shortError(err)); app.exit(1); };

// Taken here as well as in main.js so a second launch quits before it touches the checkout.
const devUserData = process.env.OFFICE_USER_DATA ? path.resolve(process.env.OFFICE_USER_DATA) : null;
app.setPath('userData', devUserData || path.join(app.getPath('appData'), 'agent-office'));
const primary = devUserData || process.env.OFFICE_SCREENSHOT || app.requestSingleInstanceLock();

if (!primary) {
  app.quit();
} else {
  start();
}

function start() {
  importLoginPath();
  let current;
  try {
    current = launch.prepareLaunch(opts);
  } catch (err) {
    return fail(`Herdquarters could not read its checkout at ${checkout}`, err);
  }
  if (rebuild.needsRebuild(checkout, process.versions.electron)) {
    try {
      rebuild.rebuild({ checkout, root, bundle });
      return relaunch();
    } catch (err) {
      const back = launch.rollBack({ ...opts, error: `could not build the app for a new Electron: ${launch.shortError(err)}` });
      return back !== current ? relaunch() : fail('Herdquarters could not build itself for a new Electron', err);
    }
  }

  global.herdquartersShell = { root, checkout, branch, bundle };
  let loaded = false;
  const watchdog = setTimeout(() => {
    if (loaded) return;
    const back = launch.rollBack({ ...opts, error: `the window did not load within ${BOOT_TIMEOUT_MS / 1000} s` });
    if (back !== current) relaunch();
  }, BOOT_TIMEOUT_MS);
  app.on('web-contents-created', (_e, wc) => wc.once('did-finish-load', () => {
    if (loaded) return;
    loaded = true;
    clearTimeout(watchdog);
    launch.markGood(root, current);
  }));

  try {
    require(path.join(checkout, 'main.js'));
  } catch (err) {
    clearTimeout(watchdog);
    const back = launch.rollBack({ ...opts, error: launch.shortError(err) });
    if (back !== current) relaunch();
    else fail('Herdquarters could not start', err);
  }
}
