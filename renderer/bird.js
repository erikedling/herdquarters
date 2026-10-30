// PiPi, the assistant, as a pixel bird that lives in the office. Drawn on a
// canvas over the whole window (sprite frames from pipi-sprite.js, plus its
// nest, shadow and particles); #bird is an invisible box over it for the
// mouse. It walks along the edges it perches on, flies between ticket cards,
// room signs, desks and reception, pecks at a ticket that needs the user,
// watches the cursor, startles at a fast one, loves being petted, celebrates
// a finished ticket and sleeps in its nest at night.
// assistant.js says what is going on (setMood, pin, celebrate); the rest it
// decides itself. Its feathers are the theme's accent color.
(function () {
  const $hit = document.getElementById('bird');
  const $cv = document.getElementById('bird-canvas');
  if (!$hit || !$cv || !window.pipiSprite) return;
  const { pipiFrame, ANIM, SIZE, GROUND } = window.pipiSprite;
  const ctx = $cv.getContext('2d');
  const SCALE = 2;                  // CSS px per sprite pixel
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dpr = 1;

  // ---- colors: from the theme's accent ----

  const hex = (c) => {
    const m = String(c).trim().match(/^#([0-9a-f]{6})$/i);
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    const r = String(c).match(/\d+(\.\d+)?/g);
    return r ? r.slice(0, 3).map(Number) : [79, 124, 255];
  };
  const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
  let palette = null, accentSeen = '';
  function updatePalette() {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent');
    if (accent === accentSeen && palette) return;
    accentSeen = accent; sprites.clear();
    const a = hex(accent), k = [0, 0, 0], w = [255, 255, 255];
    palette = {
      O: mix(a, [20, 16, 34], 0.78), B: mix(a, k, 0), S: mix(a, k, 0.28), H: mix(a, w, 0.35),
      C: '#fff3dc', D: '#ecd0a2', W: mix(a, k, 0.18), X: mix(a, k, 0.45),
      Y: '#ffb02e', Z: '#d9730f', L: '#e8902a', K: '#1a1420', G: '#ffffff', P: '#ff8fa3',
    };
  }

  // One small canvas per pose, painted once.
  const sprites = new Map();
  function sprite(pose) {
    const key = JSON.stringify(pose);
    let c = sprites.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d');
    pipiFrame(pose).forEach((row, y) => row.forEach((k, x) => { if (k) { g.fillStyle = palette[k]; g.fillRect(x, y, 1, 1); } }));
    if (sprites.size > 300) sprites.clear();
    sprites.set(key, c);
    return c;
  }

  // ---- where it is and what it does ----

  let pos = home();                 // where its feet are, in the viewport
  let facing = 1;                   // 1 right, -1 left
  let surface = null;               // the edge it stands on: { left, right, y }
  let motion = null;                // { kind: 'fly' | 'walk', from, to, start, ms, peak }
  let once = null;                  // a one-off animation: { name, start, then }
  let mood = 'idle';                // from assistant.js: idle | talk | dream | call
  let pinned = null;                // { point: () => {x,y}, peck: () => element | null }
  let party = null;                 // celebrating: { point, until }
  let nextIdle = 0, nextBlink = 0, nextHeart = 0, lastPeck = 0;
  let spin = null;                  // a flip: { start }
  let hover = false, petting = false;
  let alert = false;                // something unread: a "!" above its head
  const mouse = { x: -999, y: -999, t: 0, speed: 0 };
  const parts = [];                 // particles

  // Its nest: on the status bar's top border, just left of the PiPi tab. y is
  // where its feet are, sitting in the nest.
  function home() {
    const line = document.getElementById('statusbar')?.getBoundingClientRect().top ?? window.innerHeight - 24;
    const tab = document.getElementById('chat-tab');
    const left = tab && !tab.hidden ? tab.getBoundingClientRect().left : window.innerWidth - 110;
    return { x: Math.round(left - 40), y: line - 7 };
  }
  const hour = () => new Date().getHours();
  const night = () => hour() >= 22 || hour() < 7;
  const sleepy = () => hour() >= 15 && hour() < 18;
  let yawnedOn = '';

  function play(name, then) { once = { name, start: performance.now(), then }; }
  const playing = (name) => once?.name === name;

  // Places to perch: the top border of things with a visible edge, where
  // that edge is really on screen (not scrolled away or under the chat, the
  // terminal or a dialog), plus the long lines above reception and the
  // status bar. It never stands in the air.
  const PERCH = '.tab, .floor-name, .whiteboard, .ticket, .slack-sign, .next-chip';
  const LINES = ['#reception', '#statusbar'];
  function visible(el, x, y) {
    const at = document.elementFromPoint(x, y);
    return !!at && (at === el || el.contains(at));
  }
  function perches() {
    const out = [];
    const edge = (el, r, inset) => {
      if (r.width < 50 || r.top < 70 || r.left < 0 || r.right > window.innerWidth || r.top > window.innerHeight - 10) return;
      if (!visible(el, r.left + r.width / 2, r.top + 2)) return;
      out.push({ left: r.left + inset, right: r.right - inset, y: r.top });
    };
    for (const el of document.querySelectorAll(PERCH)) if (!el.closest('[hidden]')) edge(el, el.getBoundingClientRect(), 14);
    for (const id of LINES) { const el = document.querySelector(id); if (el && !el.hidden) edge(el, el.getBoundingClientRect(), 40); }
    return out;
  }
  // Is there still an edge under its feet (the office may have scrolled)?
  function grounded() {
    const h = home();
    if (Math.hypot(h.x - pos.x, h.y - pos.y) < 4) return true;
    return perches().some((p) => Math.abs(p.y - pos.y) < 3 && pos.x >= p.left - 16 && pos.x <= p.right + 16);
  }
  let nextGround = 0;
  const covered = () => document.body.classList.contains('panel-open') || !document.getElementById('modal')?.hidden || !document.getElementById('settings')?.hidden;

  // Go to a point: walk when it is along the same edge, else fly.
  function goTo(to, edge = null) {
    const dx = to.x - pos.x, dy = to.y - pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 3) { pos = { ...to }; surface = edge || surface; return; }
    if (Math.abs(dx) > 1) facing = dx > 0 ? 1 : -1;
    if (Math.abs(dy) < 3 && Math.abs(dx) < 220 && !reduced) {
      motion = { kind: 'walk', from: { ...pos }, to, start: performance.now(), ms: Math.abs(dx) * 22, edge: edge || surface };
    } else {
      play('takeoff');
      motion = { kind: 'fly', from: { ...pos }, to, start: performance.now() + 120, ms: Math.max(550, Math.min(2200, dist * 1.5)), peak: Math.min(130, 30 + dist * 0.25), edge };
    }
  }

  function step(t) {
    if (!motion) return;
    const k = Math.max(0, Math.min(1, (t - motion.start) / motion.ms));
    if (motion.kind === 'walk') {
      pos = { x: motion.from.x + (motion.to.x - motion.from.x) * k, y: motion.from.y + (motion.to.y - motion.from.y) * k };
    } else {
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      pos = { x: motion.from.x + (motion.to.x - motion.from.x) * e, y: motion.from.y + (motion.to.y - motion.from.y) * e - Math.sin(Math.PI * k) * motion.peak };
    }
    if (k >= 1) {
      const m = motion;
      motion = null;
      pos = { ...m.to };
      surface = m.edge || null;
      if (m.kind === 'fly') { play('land'); dust(); }
      nextIdle = t + 1200 + Math.random() * 2000;
    }
  }

  // ---- what to do next, while standing ----

  function think(t) {
    if (motion || (once && !['blink', 'look'].includes(once.name))) return;
    if (party) {
      const p = party.point();
      if (p && Math.hypot(p.x - pos.x, p.y - pos.y) > 6) return goTo(p);
      if (!playing('celebrate')) { play('celebrate'); spin = { start: t }; }
      if (Math.random() < 0.25) confetti(6);
      if (Date.now() > party.until) party = null;
      return;
    }
    // Not on anything any more: hop down to the nearest edge.
    if (!pinned && !party && t > nextGround) {
      nextGround = t + 1000;
      if (!grounded()) {
        const near = perches().map((e) => ({ e, x: Math.max(e.left, Math.min(e.right, pos.x)) })).sort((a, b) => Math.hypot(a.x - pos.x, a.e.y - pos.y) - Math.hypot(b.x - pos.x, b.e.y - pos.y))[0];
        return near ? goTo({ x: near.x, y: near.e.y }, near.e) : goTo(home());
      }
    }
    if (pinned) {
      const p = pinned.point();
      if (p && Math.hypot(p.x - pos.x, p.y - pos.y) > 6) return goTo(p);
      // Pecking at a ticket: a peck, the card shakes, a pause.
      if (pinned.peck && t - lastPeck > 1400 + Math.random() * 900) {
        lastPeck = t;
        facing = 1;
        play('peck', () => { const el = pinned?.peck?.(); if (el) { el.classList.remove('pecked'); void el.offsetWidth; el.classList.add('pecked'); } });
      }
      return;
    }
    if (mood === 'dream' || (night() && mood !== 'call' && mood !== 'talk')) {
      const h = home();
      if (Math.hypot(h.x - pos.x, h.y - pos.y) > 6) return goTo(h);
      return;
    }
    // Up and about for the first time today: a big yawn and a stretch.
    const today = new Date().toDateString();
    if (yawnedOn !== today) { yawnedOn = today; return play('yawn'); }
    if (reduced || t < nextIdle || hover || petting) return;
    nextIdle = t + (sleepy() ? 4000 : 2000) + Math.random() * (sleepy() ? 9000 : 6000);
    const r = Math.random();
    if (r < 0.3 && !covered()) {
      const list = perches();
      if (list.length) { const e = list[Math.floor(Math.random() * list.length)]; return goTo({ x: e.left + Math.random() * (e.right - e.left), y: e.y }, e); }
    }
    if (r < 0.55 && surface && surface.right - surface.left > 40) {
      return goTo({ x: surface.left + Math.random() * (surface.right - surface.left), y: surface.y }, surface);
    }
    if (r < 0.65) return play('hop');
    if (r < 0.75) return play('peck');
    if (r < 0.82 && sleepy()) return play('yawn');
    if (r < 0.92) facing = -facing;
    play('look');
  }

  // The animation and its frame for right now.
  function currentPose(t) {
    if (once) {
      const a = ANIM[once.name];
      const i = Math.floor((t - once.start) / a.ms);
      if (i < a.frames.length) return a.frames[i];
      const then = once.then; once = null; then?.();
    }
    let name = 'idle';
    if (motion?.kind === 'fly') name = 'fly';
    else if (motion?.kind === 'walk') name = 'walk';
    else if (party) name = 'celebrate';
    else if (mood === 'dream' || (night() && !pinned && mood === 'idle')) name = 'sleep';
    else if (mood === 'call' && !pinned) name = 'hover';
    else if (mood === 'talk') name = 'talk';
    else if (hover || petting) name = 'happy';
    const a = ANIM[name];
    let pose = a.frames[Math.floor(t / a.ms) % a.frames.length];
    // Blink now and then; look toward the cursor when it is near.
    if (name === 'idle' || name === 'talk') {
      if (t > nextBlink) { nextBlink = t + 2500 + Math.random() * 3500; play('blink'); }
      const near = Math.hypot(mouse.x - pos.x, mouse.y - pos.y) < 180;
      if (near) pose = { ...pose, headDx: (mouse.x - pos.x) * facing > 0 ? 1 : -1, headDy: mouse.y < pos.y - 60 ? -1 : 0 };
    }
    return pose;
  }

  // ---- particles ----

  const add = (p) => { if (!reduced && parts.length < 160) parts.push({ born: performance.now(), ...p }); };
  function dust() { for (let i = 0; i < 6; i++) add({ kind: 'dust', x: pos.x + (i - 2.5) * 5, y: pos.y - 2, vx: (i - 2.5) * 0.03, vy: -0.01, life: 450 }); }
  function heart() { add({ kind: 'heart', x: pos.x + (Math.random() - 0.5) * 20, y: pos.y - 56, vx: (Math.random() - 0.5) * 0.02, vy: -0.035, life: 1300 }); }
  function feathers(n) { for (let i = 0; i < n; i++) add({ kind: 'feather', x: pos.x + (Math.random() - 0.5) * 24, y: pos.y - 30, vx: (Math.random() - 0.5) * 0.12, vy: -0.05 - Math.random() * 0.05, g: 0.00012, life: 1800, sway: Math.random() * 6 }); }
  function confetti(n) {
    const colors = ['#ff5d8f', '#ffd23f', '#3ec1ff', '#7dff7a', '#b48cff'];
    for (let i = 0; i < n; i++) add({ kind: 'confetti', x: pos.x + (Math.random() - 0.5) * 30, y: pos.y - 50, vx: (Math.random() - 0.5) * 0.25, vy: -0.15 - Math.random() * 0.15, g: 0.0006, life: 1600, color: colors[i % colors.length] });
  }
  function zzz() { add({ kind: 'z', x: pos.x + 14 * facing, y: pos.y - 44, vx: 0.012 * facing, vy: -0.018, life: 2400 }); }

  // The "!" above its head: yellow with an outline, in a little bubble.
  const BANG = ['.OOOOO.', 'OWWWWWO', 'OWWYWWO', 'OWWYWWO', 'OWWYWWO', 'OWWWWWO', 'OWWYWWO', 'OWWWWWO', '.OOOOO.', '..OO...', '..O....'];
  const BANG_COLORS = { O: '#1a1420', W: '#fff7e0', Y: '#e8a10e' };
  const HEART = ['.PP.PP.', 'PPPPPPP', 'PPPPPPP', '.PPPPP.', '..PPP..', '...P...'];
  const Z = ['KKKK', '..K.', '.K..', 'KKKK'];
  const NEST = ['..XXXXXXXXXXXXXXXXXX..', '.XWwXwWXwWwXwXWwXwWXX.', 'XWwWwXwWwWXwWwXwWwXwWX', 'XXwXWwXwXWwXWwXwXWXwXX', '.XXXXXXXXXXXXXXXXXXXX.', '..XXXXXXXXXXXXXXXXXX..'];
  const NEST_COLORS = { X: '#5a3a22', W: '#a8743e', w: '#c99a5b' };
  function pixels(rows, x, y, colors, s = SCALE) {
    rows.forEach((row, j) => [...row].forEach((c, i) => {
      if (c === '.') return;
      ctx.fillStyle = colors[c] || c;
      ctx.fillRect(Math.round(x + i * s), Math.round(y + j * s), s, s);
    }));
  }

  function drawParts(t, dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      const age = t - p.born;
      if (age > p.life) { parts.splice(i, 1); continue; }
      p.vy += (p.g || 0) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const fade = 1 - age / p.life;
      ctx.globalAlpha = Math.min(1, fade * 1.6);
      if (p.kind === 'dust') { ctx.fillStyle = 'rgba(220,220,230,.8)'; const s = 2 + age / 120; ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s); }
      else if (p.kind === 'heart') pixels(HEART, p.x - 7, p.y, { P: '#ff6f91' });
      else if (p.kind === 'z') pixels(Z, p.x, p.y, { K: getComputedStyle(document.documentElement).getPropertyValue('--accent-text') || '#c9d2ff' }, 1 + age / 900);
      else if (p.kind === 'feather') { ctx.fillStyle = palette.H; const sx = p.x + Math.sin(age / 200 + p.sway) * 5; ctx.fillRect(sx, p.y, 2, 6); ctx.fillStyle = palette.B; ctx.fillRect(sx + 2, p.y + 1, 2, 4); }
      else if (p.kind === 'confetti') { ctx.fillStyle = p.color; const w = Math.abs(Math.sin(age / 90)) * 4 + 1; ctx.fillRect(p.x, p.y, w, 4); }
    }
    ctx.globalAlpha = 1;
  }

  // ---- the frame loop ----

  let last = performance.now(), hidden = false;
  function frame(t) {
    const dt = Math.min(50, t - last); last = t;
    updatePalette();
    step(t);
    think(t);
    if (hover && t > nextHeart) { nextHeart = t + (petting ? 260 : 900); heart(); }
    if ((mood === 'dream' || (night() && mood === 'idle' && !motion && !pinned)) && Math.random() < dt / 900) zzz();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, $cv.width, $cv.height);
    if (!hidden) {
      const h = home();
      pixels(NEST, h.x - 22, h.y - 5, NEST_COLORS); // its bottom on the status bar's line
      // A shadow on the ground: under its feet, or where it will land while flying.
      const ground = motion?.kind === 'fly' ? motion.from.y + (motion.to.y - motion.from.y) * Math.min(1, (t - motion.start) / motion.ms) : pos.y;
      const height = Math.max(0, ground - pos.y);
      ctx.fillStyle = `rgba(0,0,0,${0.28 * Math.max(0.25, 1 - height / 200)})`;
      ctx.beginPath(); ctx.ellipse(pos.x, ground, 14 * Math.max(0.5, 1 - height / 250), 3.5, 0, 0, Math.PI * 2); ctx.fill();

      const pose = currentPose(t);
      ctx.save();
      ctx.translate(Math.round(pos.x), Math.round(pos.y));
      ctx.scale(facing * SCALE, SCALE);
      if (spin) {
        const k = (t - spin.start) / 600;
        if (k >= 1) spin = null; else { ctx.translate(0, -12); ctx.rotate(k * Math.PI * 2 * facing); ctx.translate(0, 12); }
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite(pose), -SIZE / 2 + 1, -GROUND);
      ctx.restore();
      drawParts(t, dt);
      if (alert && !motion) pixels(BANG, pos.x + 6 * facing - 7, pos.y - 84 + Math.round(Math.sin(t / 180) * 2), BANG_COLORS);
    }
    // The box for the mouse follows the body.
    $hit.style.transform = `translate(${Math.round(pos.x - 26)}px, ${Math.round(pos.y - 52)}px)`;
    window.officeAssistant?.birdMoved(pos);
    requestAnimationFrame(frame);
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    $cv.width = Math.round(window.innerWidth * dpr);
    $cv.height = Math.round(window.innerHeight * dpr);
    pos = { x: Math.min(pos.x, window.innerWidth - 30), y: Math.min(pos.y, window.innerHeight - 30) };
  }
  window.addEventListener('resize', resize);

  // ---- the mouse: watching, startling, petting ----

  window.addEventListener('mousemove', (e) => {
    const t = performance.now();
    const dt = Math.max(1, t - mouse.t);
    mouse.speed = Math.hypot(e.clientX - mouse.x, e.clientY - mouse.y) / dt;
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.t = t;
    // Swept at fast: it startles, drops a feather or two and flies off.
    if (!hidden && !motion && !hover && !pinned && !party && mood !== 'dream' && mouse.speed > 2.2 && Math.hypot(mouse.x - pos.x, mouse.y - (pos.y - 24)) < 70) {
      feathers(3);
      play('startle', () => {
        const list = perches().filter((p) => Math.abs(p.y - pos.y) > 60 || Math.abs((p.left + p.right) / 2 - pos.x) > 200);
        const e2 = list[Math.floor(Math.random() * list.length)];
        if (e2) goTo({ x: e2.left + Math.random() * (e2.right - e2.left), y: e2.y }, e2);
      });
    }
  });
  let holdTimer = null, held = false, clickTimer = null;
  $hit.addEventListener('mouseenter', () => { hover = true; });
  $hit.addEventListener('mouseleave', () => { hover = false; petting = false; clearTimeout(holdTimer); });
  $hit.addEventListener('mousedown', () => { held = false; holdTimer = setTimeout(() => { held = true; petting = true; }, 350); });
  window.addEventListener('mouseup', () => { clearTimeout(holdTimer); petting = false; });
  // A click opens the chat; a double click is a flip, not two clicks.
  $hit.addEventListener('click', () => {
    if (held) { held = false; return; }
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => window.officeAssistant?.toggleChat(), 230);
  });
  $hit.addEventListener('dblclick', () => {
    clearTimeout(clickTimer);
    spin = { start: performance.now() };
    play('hop');
    confetti(8);
  });

  window.officeBird = {
    // idle | talk | dream | call (something for the user: it hovers, flapping)
    setMood(m) { mood = m; },
    // Something unread: a bobbing "!" above its head.
    setAlert(a) { alert = a; },
    // Stay at point() (re-read every frame, so it follows a moving target);
    // peck(): the element to peck at once there. null lets it roam.
    pin(point, { peck = null } = {}) { pinned = point ? { point, peck } : null; if (!point) nextIdle = performance.now() + 800; },
    // A happy spin with confetti at point() for a few seconds.
    celebrate(point) { party = { point, until: Date.now() + 3500 }; },
    // The office is behind something (the terminal): stop drawing.
    setHidden(h) { hidden = h; $hit.hidden = h; },
    position: () => ({ ...pos }),
  };
  resize();
  requestAnimationFrame(frame);
})();
