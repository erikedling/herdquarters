// Electron main for the selection test: load the page, run both scenarios,
// print one JSON line, exit. The window is never shown.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const log = (s) => { if (process.env.TERM_SELECT_DEBUG) fs.writeSync(2, `[fixture] ${s}\n`); };
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 900, height: 500, webPreferences: { backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, level, msg, line, src) => log(`console(${level}) ${src}:${line} ${msg}`));
  win.webContents.on('did-fail-load', (_e, code, desc) => log(`did-fail-load ${code} ${desc}`));
  log('loading');
  await win.loadFile(path.join(__dirname, 'index.html'));
  log('loaded');
  const without = await win.webContents.executeJavaScript('window.scenario(false)');
  log('scenario(false) done');
  const withFix = await win.webContents.executeJavaScript('window.scenario(true)');
  const plain = await win.webContents.executeJavaScript('window.scenario(false, true)');
  log('scenario(true) done');
  const edit = (Menu.getApplicationMenu()?.items || []).find((i) => i.role === 'editmenu' || i.label === 'Edit');
  const copyRole = !!edit?.submenu?.items.some((i) => i.role === 'copy');
  fs.writeSync(1, JSON.stringify({ without, withFix, plain, copyRole }) + '\n'); // sync: app.exit would drop a buffered write
  app.exit(0);
}).catch((err) => { fs.writeSync(2, String(err && err.stack || err) + '\n'); app.exit(1); });
