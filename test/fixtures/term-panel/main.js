// Electron main for the terminal panel test: load the page, run the scenario,
// print one JSON line, exit. The window is never shown.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 900, height: 500, webPreferences: { backgroundThrottling: false } });
  await win.loadFile(path.join(__dirname, 'index.html'));
  const out = await win.webContents.executeJavaScript('window.scenario()');
  fs.writeSync(1, JSON.stringify(out) + '\n');
  app.exit(0);
}).catch((err) => { fs.writeSync(2, String(err && err.stack || err) + '\n'); app.exit(1); });
