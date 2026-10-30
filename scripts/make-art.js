// Paints the README illustrations from renderer/scenes.js (the same scenes
// the welcome tour shows) into docs/images/<scene>.png, as looping animated
// PNGs (scripts/apng.js): each scene the README shows, for its LOOP seconds
// at 12 frames a second. `npm run art`; optional: an output folder
// (`npm run art -- /tmp/art`).
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { encodeAPNG } = require('./apng');

const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'docs', 'images'));
const S = 5, FPS = 12;
// The scenes paint the assistant with its own sprite, so that loads first.
const code = ['pipi-sprite.js', 'scenes.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'renderer', f), 'utf8')).join('\n;\n');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><body></body>'));
  await win.webContents.executeJavaScript(code);
  const { names, loop, W, H } = await win.webContents.executeJavaScript('({ names: herdScenes.NAMES, loop: herdScenes.LOOP, W: herdScenes.W, H: herdScenes.H })');
  // One frame's pixels, base64 so they cross over as a plain string.
  await win.webContents.executeJavaScript(`window.frameAt = (name, t) => {
    const c = window.frameCanvas ||= Object.assign(document.createElement('canvas'), { width: ${W * S}, height: ${H * S} });
    const g = c.getContext('2d', { willReadFrequently: true });
    herdScenes.draw(g, name, t, ${S});
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let s = '';
    for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
    return btoa(s);
  }; true`);
  fs.mkdirSync(out, { recursive: true });
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  for (const name of names.filter((s) => readme.includes(`docs/images/${s}.png`))) {
    const n = Math.round((loop[name] || 3) * FPS);
    const frames = [];
    for (let i = 0; i < n; i++) {
      const b64 = await win.webContents.executeJavaScript(`frameAt(${JSON.stringify(name)}, ${i / FPS})`);
      frames.push({ rgba: Buffer.from(b64, 'base64'), ms: 1000 / FPS });
    }
    const file = path.join(out, `${name}.png`);
    const png = encodeAPNG(W * S, H * S, frames);
    fs.writeFileSync(file, png);
    console.log(`wrote ${file} (${n} frames, ${Math.round(png.length / 1024)} KB)`);
  }
  app.quit();
}).catch((err) => { console.error(err); app.exit(1); });
