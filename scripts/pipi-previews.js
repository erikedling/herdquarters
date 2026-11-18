// Previews of PiPi's species (renderer/pipi-species.js): one looping APNG per
// species of a little scene (idle, blink, look, walk, talk, happy with hearts,
// startle with feathers, flight, backflip, peck, celebrate, flight to the
// nest, sleep, yawn), a contact sheet, every pose side by side, and every
// species on every theme's background, light and dark.
// `npx electron scripts/pipi-previews.js <out folder>`.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { encodeAPNG } = require('./apng');

const out = path.resolve(process.argv[2] || 'pipi-previews');
const FPS = 25;
const code = ['pipi-sprite.js', 'pipi-species.js', 'backflip.js', 'themes.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'renderer', f), 'utf8')).join('\n;\n');

function page() {
  const { pipiFrame, ANIM, SIZE, GROUND } = window.pipiSprite;
  const { SPECIES, themePalette, rgb } = window.pipiSpecies;
  const { backflip, DURATION: FLIP } = window.pipiBackflip;
  const SCALE = 2;
  const paletteOf = (sp, accent = '#4f7cff') => sp.palette || themePalette(rgb(accent));

  function sprite(sp, pose, accent) {
    const pal = paletteOf(sp, accent);
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d');
    pipiFrame(pose, sp.look).forEach((row, y) => row.forEach((k, x) => {
      if (!k) return;
      if (!pal[k]) throw new Error(`${sp.id}: no color for ${k}`);
      g.fillStyle = pal[k]; g.fillRect(x, y, 1, 1);
    }));
    return c;
  }
  function pixels(ctx, rows, x, y, colors, s = SCALE) {
    rows.forEach((row, j) => [...row].forEach((c, i) => {
      if (c === '.') return;
      ctx.fillStyle = colors[c] || c;
      ctx.fillRect(Math.round(x + i * s), Math.round(y + j * s), s, s);
    }));
  }
  // Draws the bird with its feet at (x, y) in CSS px, the way bird.js does.
  function drawBird(ctx, sp, pose, x, y, { facing = 1, angle = 0, accent } = {}) {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.scale(facing * SCALE, SCALE);
    if (angle) { ctx.translate(0, -12); ctx.rotate(-angle); ctx.translate(0, 12); }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite(sp, pose, accent), -SIZE / 2 + 1, -GROUND);
    ctx.restore();
  }

  const HEART = ['.PP.PP.', 'PPPPPPP', 'PPPPPPP', '.PPPPP.', '..PPP..', '...P...'];
  const Z = ['KKKK', '..K.', '.K..', 'KKKK'];
  const NEST = ['..XXXXXXXXXXXXXXXXXX..', '.XWwXwWXwWwXwXWwXwWXX.', 'XWwWwXwWwWXwWwXwWwXwWX', 'XXwXWwXwXWwXWwXwXWXwXX', '.XXXXXXXXXXXXXXXXXXXX.', '..XXXXXXXXXXXXXXXXXX..'];
  const NEST_COLORS = { X: '#5a3a22', W: '#a8743e', w: '#c99a5b' };

  // ---- the scene ----
  const W = 200, H = 140, LINE = 120, START = 60, NESTX = 158;
  const frameOf = (name, t) => { const a = ANIM[name]; return a.frames[Math.floor(t / a.ms) % a.frames.length]; };
  const onceOf = (name, t) => { const a = ANIM[name]; return a.frames[Math.min(a.frames.length - 1, Math.floor(t / a.ms))]; };
  const ease = (u) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, u)))) / 2;
  const SEG = [
    ['idle', 1500], ['look', 780], ['walkOut', 1100], ['turn', 120], ['walkBack', 1100], ['talk', 1040],
    ['happy', 1400], ['startle', 160], ['takeoff', 120], ['flyLoop', 1300], ['land', 280], ['flip', FLIP + 120],
    ['peck', 400], ['celebrate', 1100], ['takeoff2', 120], ['flyNest', 1000], ['land2', 280], ['sleep', 2600], ['yawn', 1100],
  ];
  const LOOP = SEG.reduce((s, [, ms]) => s + ms, 0);
  function at(t) {
    let s = 0;
    for (const [name, ms] of SEG) { if (t < s + ms) return { name, u: t - s, ms }; s += ms; }
    return { name: 'yawn', u: 0, ms: 1 };
  }
  // Where it is and how it looks at time t, plus what to spawn.
  function state(t) {
    const { name, u, ms } = at(t);
    const Y = LINE, NY = LINE - 7;
    switch (name) {
      case 'idle': return { x: START, y: Y, pose: u > 700 && u < 970 ? onceOf('blink', u - 700) : frameOf('idle', u) };
      case 'look': return { x: START, y: Y, pose: onceOf('look', u) };
      case 'walkOut': return { x: START + 40 * (u / ms), y: Y, pose: frameOf('walk', u) };
      case 'turn': return { x: START + 40, y: Y, pose: {}, facing: -1 };
      case 'walkBack': return { x: START + 40 - 40 * (u / ms), y: Y, pose: frameOf('walk', u), facing: -1 };
      case 'talk': return { x: START, y: Y, pose: frameOf('talk', u) };
      case 'happy': return { x: START, y: Y, pose: frameOf('happy', u), hearts: true };
      case 'startle': return { x: START, y: Y, pose: onceOf('startle', u) };
      case 'takeoff': return { x: START, y: Y, pose: onceOf('takeoff', u) };
      case 'flyLoop': {
        const k = u / ms;
        return { x: START + 45 * Math.sin(Math.PI * k), y: Y - 55 * Math.sin(Math.PI * k), pose: frameOf('fly', u), facing: k < 0.5 ? 1 : -1, ground: Y };
      }
      case 'land': return { x: START, y: Y, pose: onceOf('land', u), facing: -1 };
      case 'flip': {
        const f = backflip(u);
        if (!f) return { x: START, y: Y, pose: {} };
        const sy = Math.round(f.squash * 50) / 50;
        let pose = { sy, sx: 1 + (1 - sy) * 0.7 };
        if (f.phase === 'air') pose = { ...pose, legs: 'tuck', wing: 'up' };
        return { x: START, y: Y, lift: f.lift, angle: f.angle, pose, landing: f.phase === 'land' };
      }
      case 'peck': return { x: START, y: Y, pose: onceOf('peck', u) };
      case 'celebrate': return { x: START, y: Y, pose: frameOf('celebrate', u) };
      case 'takeoff2': return { x: START, y: Y, pose: onceOf('takeoff', u) };
      case 'flyNest': {
        const k = ease(u / ms);
        return { x: START + (NESTX - START) * k, y: Y + (NY - Y) * k - 40 * Math.sin(Math.PI * k), pose: frameOf('fly', u), ground: Y + (NY - Y) * k };
      }
      case 'land2': return { x: NESTX, y: NY, pose: onceOf('land', u) };
      case 'sleep': return { x: NESTX, y: NY, pose: frameOf('sleep', u), zzz: true };
      case 'yawn': return { x: NESTX, y: NY, pose: onceOf('yawn', u) };
    }
  }

  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  function scene(sp, colors, S) {
    const c = document.createElement('canvas');
    c.width = W * S; c.height = H * S;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const parts = [];
    let prev = null, lastHeart = -1e9, lastZ = -1e9, landed = false;
    seed = 7;
    function draw(t, dt) {
      const s = state(t);
      const facing = s.facing || 1;
      const add = (p) => parts.push({ born: t, ...p });
      if (prev?.name !== at(t).name) {
        const n = at(t).name;
        if (n === 'startle') for (let i = 0; i < 3; i++) add({ kind: 'feather', x: s.x + (rnd() - 0.5) * 24, y: s.y - 30, vx: (rnd() - 0.5) * 0.12, vy: -0.05 - rnd() * 0.05, g: 0.00012, life: 1800, sway: rnd() * 6 });
        if (n === 'celebrate') {
          const cs = ['#ff5d8f', '#ffd23f', '#3ec1ff', '#7dff7a', '#b48cff'];
          for (let i = 0; i < 26; i++) add({ kind: 'confetti', x: s.x + (rnd() - 0.5) * 30, y: s.y - 50, vx: (rnd() - 0.5) * 0.25, vy: -0.15 - rnd() * 0.15, g: 0.0006, life: 1600, color: cs[i % 5] });
        }
        if (n === 'flip') landed = false;
      }
      if (s.landing && !landed) { landed = true; for (let i = 0; i < 6; i++) add({ kind: 'dust', x: s.x + (i - 2.5) * 5, y: s.y - 2, vx: (i - 2.5) * 0.03, vy: -0.01, life: 450 }); }
      if (s.hearts && t - lastHeart > 260) { lastHeart = t; add({ kind: 'heart', x: s.x + (rnd() - 0.5) * 20, y: s.y - 56, vx: (rnd() - 0.5) * 0.02, vy: -0.035, life: 1300 }); }
      if (s.zzz && t - lastZ > 800) { lastZ = t; add({ kind: 'z', x: s.x + 14, y: s.y - 44, vx: 0.012, vy: -0.018, life: 2400 }); }
      prev = { name: at(t).name };

      ctx.setTransform(S, 0, 0, S, 0, 0);
      ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, W, H);
      // A ticket card on the left, the menu bar under the nest.
      ctx.fillStyle = colors.panel; ctx.fillRect(8, LINE, 120, H - LINE);
      ctx.fillStyle = colors.line; ctx.fillRect(8, LINE, 120, 1); ctx.fillRect(8, LINE, 1, H - LINE); ctx.fillRect(127, LINE, 1, H - LINE);
      ctx.fillStyle = colors['bg-2']; ctx.fillRect(132, LINE, W - 132, H - LINE);
      ctx.fillStyle = colors.line; ctx.fillRect(132, LINE, W - 132, 1);
      pixels(ctx, NEST, NESTX - 22, LINE - 12, NEST_COLORS);
      const lift = s.lift || 0;
      const ground = s.ground ?? s.y;
      const height = Math.max(0, ground - s.y + lift);
      ctx.fillStyle = `rgba(0,0,0,${0.28 * Math.max(0.25, 1 - height / 200)})`;
      ctx.beginPath(); ctx.ellipse(s.x, ground, 14 * Math.max(0.5, 1 - height / 250), 3.5, 0, 0, Math.PI * 2); ctx.fill();
      drawBird(ctx, sp, s.pose, s.x, s.y - lift, { facing, angle: s.angle, accent: colors.accent });

      const pal = paletteOf(sp, colors.accent);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        const age = t - p.born;
        if (age > p.life) { parts.splice(i, 1); continue; }
        p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        ctx.globalAlpha = Math.min(1, (1 - age / p.life) * 1.6);
        if (p.kind === 'dust') { ctx.fillStyle = 'rgba(220,220,230,.8)'; const z = 2 + age / 120; ctx.fillRect(p.x - z / 2, p.y - z / 2, z, z); }
        else if (p.kind === 'heart') pixels(ctx, HEART, p.x - 7, p.y, { P: '#ff6f91' });
        else if (p.kind === 'z') pixels(ctx, Z, p.x, p.y, { K: colors.accentText }, 1 + age / 900);
        else if (p.kind === 'feather') { ctx.fillStyle = pal.H; const sx = p.x + Math.sin(age / 200 + p.sway) * 5; ctx.fillRect(sx, p.y, 2, 6); ctx.fillStyle = pal.B; ctx.fillRect(sx + 2, p.y + 1, 2, 4); }
        else if (p.kind === 'confetti') { ctx.fillStyle = p.color; const w = Math.abs(Math.sin(age / 90)) * 4 + 1; ctx.fillRect(p.x, p.y, w, 4); }
      }
      ctx.globalAlpha = 1;
      return c;
    }
    return draw;
  }

  const b64 = (c) => {
    const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let s = '';
    for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const MIDNIGHT = { ...window.officeThemes.THEMES[0].dark };

  // ---- sheets ----
  const LABEL = '600 13px -apple-system, Helvetica, sans-serif';
  function contactSheet() {
    const S = 6, cell = SIZE * S, cols = 6, rows = Math.ceil(SPECIES.length / cols), pad = 30;
    const c = document.createElement('canvas');
    c.width = cols * cell; c.height = rows * (cell + pad);
    const g = c.getContext('2d');
    g.fillStyle = '#2a2f42'; g.fillRect(0, 0, c.width, c.height);
    SPECIES.forEach((sp, i) => {
      const x = (i % cols) * cell, y = Math.floor(i / cols) * (cell + pad);
      g.fillStyle = (i + Math.floor(i / cols)) % 2 ? '#e3e7f1' : '#eef1f8'; g.fillRect(x, y, cell, cell + pad);
      g.imageSmoothingEnabled = false;
      g.drawImage(sprite(sp, {}), x, y, cell, cell);
      g.fillStyle = '#1f2433'; g.font = LABEL; g.textAlign = 'center';
      g.fillText(sp.name, x + cell / 2, y + cell + 19);
    });
    return c;
  }
  const POSES = [
    ['idle', {}], ['blink', ANIM.blink.frames[1]], ['look', ANIM.look.frames[1]], ['step', ANIM.walk.frames[0]], ['step', ANIM.walk.frames[2]],
    ['talk', ANIM.talk.frames[0]], ['happy', ANIM.happy.frames[0]], ['startle', ANIM.startle.frames[1]], ['peck', ANIM.peck.frames[2]],
    ['fly up', ANIM.fly.frames[0]], ['fly mid', ANIM.fly.frames[1]], ['fly down', ANIM.fly.frames[2]], ['land', ANIM.land.frames[0]],
    ['yawn', ANIM.yawn.frames[2]], ['sleep', ANIM.sleep.frames[0]], ['dart', { wing: 'up', legs: 'tuck', eye: 'wide', beak: 'open' }],
  ];
  function poseSheet() {
    const S = 4, cell = SIZE * S, left = 190, top = 26;
    const c = document.createElement('canvas');
    c.width = left + POSES.length * cell; c.height = top + SPECIES.length * cell;
    const g = c.getContext('2d');
    g.fillStyle = '#eef1f8'; g.fillRect(0, 0, c.width, c.height);
    g.font = LABEL; g.fillStyle = '#1f2433';
    g.textAlign = 'center';
    POSES.forEach(([n], j) => g.fillText(n, left + j * cell + cell / 2, 18));
    SPECIES.forEach((sp, i) => {
      g.textAlign = 'left'; g.fillStyle = '#1f2433';
      g.fillText(sp.name, 10, top + i * cell + cell / 2 + 4);
      POSES.forEach(([, pose], j) => {
        g.fillStyle = (i + j) % 2 ? '#e3e7f1' : '#f6f8fc'; g.fillRect(left + j * cell, top + i * cell, cell, cell);
        g.imageSmoothingEnabled = false;
        g.drawImage(sprite(sp, pose), left + j * cell, top + i * cell, cell, cell);
      });
    });
    return c;
  }
  // Every species at its real size (2 CSS px per sprite pixel, on a 2x
  // screen) on a ticket card in every theme, dark and light, and the styles.
  function backgroundSheet() {
    const { THEMES, STYLES } = window.officeThemes;
    const looks = [];
    for (const th of THEMES) for (const m of ['dark', 'light']) looks.push({ label: `${th.name} ${m === 'dark' ? '◐' : '○'}`, colors: th[m] });
    for (const st of STYLES) if (st.colors) looks.push({ label: st.name, colors: st.colors });
    const S = 2, cw = 92, ch = 84, left = 170, top = 40;
    const c = document.createElement('canvas');
    c.width = (left + looks.length * cw) * S; c.height = (top + SPECIES.length * ch) * S;
    const g = c.getContext('2d');
    g.scale(S, S);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    g.font = '600 10px -apple-system, Helvetica, sans-serif'; g.fillStyle = '#1f2433';
    looks.forEach((l, j) => { g.save(); g.translate(left + j * cw + cw / 2, top - 6); g.textAlign = 'center'; g.fillText(l.label, 0, 0); g.restore(); });
    SPECIES.forEach((sp, i) => {
      g.fillStyle = '#1f2433'; g.textAlign = 'left'; g.font = '600 12px -apple-system, Helvetica, sans-serif';
      g.fillText(sp.name, 8, top + i * ch + ch / 2 + 4);
      looks.forEach((l, j) => {
        const x = left + j * cw, y = top + i * ch, line = y + ch - 12;
        g.fillStyle = l.colors.bg; g.fillRect(x, y, cw, ch);
        g.fillStyle = l.colors.panel; g.fillRect(x + 8, line, cw - 16, ch - (line - y));
        g.fillStyle = l.colors.line; g.fillRect(x + 8, line, cw - 16, 1);
        g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.ellipse(x + cw / 2, line, 14, 3.5, 0, 0, Math.PI * 2); g.fill();
        drawBird(g, sp, {}, x + cw / 2, line, { accent: l.colors.accent });
      });
    });
    return c;
  }

  window.preview = {
    species: SPECIES.map((s) => s.id),
    W, H, LOOP,
    scene(id, S, fps) {
      const sp = SPECIES.find((x) => x.id === id);
      const colors = { ...MIDNIGHT, accentText: '#c9d2ff' };
      const draw = scene(sp, colors, S);
      const n = Math.round(LOOP / 1000 * fps), dt = 1000 / fps, frames = [];
      for (let i = 0; i < n; i++) frames.push(b64(draw(i * dt, dt)));
      return frames;
    },
    contactSheet: () => contactSheet().toDataURL('image/png'),
    poseSheet: () => poseSheet().toDataURL('image/png'),
    backgroundSheet: () => backgroundSheet().toDataURL('image/png'),
  };
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><body></body>'));
  await win.webContents.executeJavaScript(code + '\n;\n(' + page.toString() + ')(); true');
  fs.mkdirSync(out, { recursive: true });
  const png = (name, url) => {
    const file = path.join(out, name);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`wrote ${file}`);
  };
  png('contact-sheet.png', await win.webContents.executeJavaScript('preview.contactSheet()'));
  png('poses.png', await win.webContents.executeJavaScript('preview.poseSheet()'));
  png('backgrounds.png', await win.webContents.executeJavaScript('preview.backgroundSheet()'));
  if (process.env.SHEETS_ONLY) return app.quit();
  const { species, W, H } = await win.webContents.executeJavaScript('({ species: preview.species, W: preview.W, H: preview.H })');
  const S = 3;
  for (const id of species) {
    const frames = await win.webContents.executeJavaScript(`preview.scene(${JSON.stringify(id)}, ${S}, ${FPS})`);
    const file = path.join(out, `${id}.png`);
    const data = encodeAPNG(W * S, H * S, frames.map((f) => ({ rgba: Buffer.from(f, 'base64'), ms: 1000 / FPS })));
    fs.writeFileSync(file, data);
    console.log(`wrote ${file} (${frames.length} frames, ${Math.round(data.length / 1024)} KB)`);
  }
  app.quit();
}).catch((err) => { console.error(err); app.exit(1); });
