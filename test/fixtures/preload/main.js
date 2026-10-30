// Loads the real preload.js in a sandboxed window (as main.js does) and
// reports what it exposed. Prints one JSON line, exits.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
app.whenReady().then(async () => {
  const errors = [];
  const win = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '..', '..', '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, additionalArguments: ['--office-app-name=Testname'] } });
  win.webContents.on('console-message', (event, legacyLevel, legacyMessage) => { const msg = event.message ?? legacyMessage; if (/preload|Error/.test(String(msg))) errors.push(String(msg)); });
  await win.loadURL('about:blank');
  const out = await win.webContents.executeJavaScript(`JSON.stringify({ office: typeof window.office, appName: window.office && window.office.appName, keys: window.office ? Object.keys(window.office).sort() : [] })`);
  fs.writeSync(1, JSON.stringify({ ...JSON.parse(out), errors }) + '\n');
  app.exit(0);
}).catch((err) => { fs.writeSync(2, String(err && err.stack || err) + '\n'); app.exit(1); });
