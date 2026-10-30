// Renders assets/icon.svg to assets/icon.png (1024²) with Electron, then on
// macOS builds assets/icon.icns from it with sips + iconutil. `npm run icon`.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const assets = path.join(__dirname, '..', 'assets');
const svg = fs.readFileSync(path.join(assets, 'icon.svg'), 'utf8');
const png = path.join(assets, 'icon.png');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style>${svg}`));
  await new Promise((r) => setTimeout(r, 300));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(png, img.toPNG());
  console.log(`wrote ${png} (${img.getSize().width}x${img.getSize().height})`);
  if (process.platform === 'darwin') {
    // capturePage renders at the display's scale factor; the dock wants 1024².
    execFileSync('sips', ['-z', '1024', '1024', png], { stdio: 'ignore' });
    const set = path.join(os.tmpdir(), 'agent-office.iconset');
    fs.rmSync(set, { recursive: true, force: true }); fs.mkdirSync(set);
    for (const size of [16, 32, 128, 256, 512]) {
      execFileSync('sips', ['-z', String(size), String(size), png, '--out', path.join(set, `icon_${size}x${size}.png`)], { stdio: 'ignore' });
      execFileSync('sips', ['-z', String(size * 2), String(size * 2), png, '--out', path.join(set, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' });
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(assets, 'icon.icns')]);
    console.log(`wrote ${path.join(assets, 'icon.icns')}`);
  }
  app.exit(0);
}).catch((err) => { console.error(err); app.exit(1); });
