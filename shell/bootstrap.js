// Copied into Herdquarters.app by scripts/make-app.js; see "The Dock app" in docs/GUIDE.md.
const fs = require('node:fs');
const path = require('node:path');
const { app, dialog, ipcMain, BrowserWindow } = require('electron');
const { importLoginPath } = require('./login-path');
const launch = require('./launch');
const rebuild = require('./rebuild');
const { guardQuit } = require('./quit-guard');

const READY_TIMEOUT_MS = 30_000;
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
  let current, needsModules;
  try {
    ({ current, needsModules } = launch.prepareLaunch(opts));
  } catch (err) {
    return fail(`Herdquarters could not read its checkout at ${checkout}`, err);
  }
  try {
    // Not a set that loader.js already had to give back.
    if (launch.readState(root).shellFailed !== rebuild.shellHash(path.join(checkout, 'shell'))
      && rebuild.syncShell({ checkout, appDir: __dirname, bundle })) return relaunch();
  } catch (err) {
    console.error(`could not update the app's own files: ${launch.shortError(err)}`);
  }
  const plan = rebuild.rebuildPlan({ root, checkout, current, running: process.versions.electron });
  if (plan === 'gaveUp') {
    const back = launch.rollBack({ ...opts, error: `still not on Electron ${rebuild.wantedMajor(checkout)} after building for it` });
    return back !== current ? relaunch() : fail('Herdquarters could not build itself for a new Electron', `wanted Electron ${rebuild.wantedMajor(checkout)}`);
  }
  if (plan === 'rebuild' || needsModules) return installFirst(current, plan === 'rebuild');
  run(current);
}

// Slow work runs after ready behind a small window, so the app is not just a bouncing icon; then it starts again.
function installFirst(current, newElectron) {
  app.whenReady().then(async () => {
    const text = newElectron
      ? 'Downloading a new Electron and building the app again. This can take a few minutes.'
      : 'Installing packages for the new version.';
    const win = new BrowserWindow({ width: 440, height: 130, resizable: false, minimizable: false, maximizable: false, closable: false, title: 'Herdquarters', backgroundColor: '#1b1e2b' });
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<body style="margin:0;padding:22px 26px;font:14px -apple-system,sans-serif;color:#e6e9f5;background:#1b1e2b"><b>Updating Herdquarters…</b><p style="color:#9aa3c0;margin:8px 0 0">${text}</p></body>`)}`);
    const controller = new AbortController();
    const release = guardQuit({ app, dialog, win, controller });
    try {
      if (newElectron) await rebuild.rebuild({ root, checkout, bundle, current, signal: controller.signal });
      else await launch.installModules(root, checkout, { signal: controller.signal });
      release();
      relaunch();
    } catch (err) {
      release();
      if (controller.signal.aborted) {
        // A stopped rebuild was not a real try; the next launch may try it again.
        if (newElectron) launch.updateState(root, { rebuildTried: null });
        return app.exit(0);
      }
      const back = launch.rollBack({ ...opts, error: launch.shortError(err) });
      if (back !== current) relaunch();
      else fail('Herdquarters could not install its packages. Check the network and open it again.', err);
    }
  });
}

function run(current) {
  global.herdquartersShell = { root, checkout, branch, bundle, launch };
  launch.markBooting(root, current);
  const watchdog = setTimeout(() => {
    const back = launch.rollBack({ ...opts, error: `the window did not come up within ${READY_TIMEOUT_MS / 1000} s` });
    if (back !== current) relaunch();
  }, READY_TIMEOUT_MS);
  ipcMain.once('renderer-ready', () => {
    clearTimeout(watchdog);
    launch.markGood(root, current);
    rebuild.confirmShell(__dirname);
  });
  try {
    require(path.join(checkout, 'main.js'));
  } catch (err) {
    clearTimeout(watchdog);
    const back = launch.rollBack({ ...opts, error: launch.shortError(err) });
    if (back !== current) relaunch();
    else fail('Herdquarters could not start', err);
  }
}
