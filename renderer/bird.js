// PiPi, the assistant, as a pixel bird that lives in the office. Drawn on a
// canvas over the whole window (sprite frames from pipi-sprite.js, plus its
// nest, shadow and particles); #bird is an invisible box over it for the
// mouse. It walks along the edges it perches on, flies between ticket cards,
// room signs, desks and reception, pecks at a ticket that needs the user,
// watches the cursor, startles at a fast one, loves being petted, celebrates
// a finished ticket and sleeps in its nest at night. The user can pick it up
// and drop it, or fling it across the office, at a dart board if it is on.
// assistant.js says what is going on (setMood, pin, celebrate); the rest it
// decides itself. Its feathers are the theme's accent color.
(function () {
  const $hit = document.getElementById('bird');
  const $cv = document.getElementById('bird-canvas');
  if (!$hit || !$cv || !window.pipiSprite || !window.pipiBackflip || !window.birdDrop || !window.birdThrow) return;
  const { pipiFrame, ANIM, SIZE, GROUND } = window.pipiSprite;
  const { backflip } = window.pipiBackflip;
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
  let motion = null;                // { kind: 'fly' | 'walk' | 'fall', from, to, start, ms, peak } or a throw: { kind: 'throw', body, start, last, spin, perches }, or stuck in the dart board: { kind: 'stuck', start, until, hit, angle, ring }
  let once = null;                  // a one-off animation: { name, start, then }
  let mood = 'idle';                // from assistant.js: idle | talk | dream | call
  let pinned = null;                // { point: () => {x,y}, peck: () => element | null }
  let party = null;                 // celebrating: { point, until }
  let nextIdle = 0, nextBlink = 0, nextHeart = 0, lastPeck = 0;
  let flip = null;                  // a backflip: { start, landed }
  let hover = false, petting = false;
  let alert = false;                // something unread: a "!" above its head
  let drag = null;                  // the user is holding it: { pointerId, x, y, on, samples }
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

  // Dropped by the user: it stays on that edge for STAY_MS, and goTo() only
  // lets it walk along it. A new pin (a call, an unread message, the chat; not
  // a ticket visit), a celebration or the edge scrolling away ends the stay.
  const STAY_MS = 5 * 60_000;
  const GRAVITY = 0.0025; // px/ms², for the fall after a drop and a throw
  let stayUntil = 0;
  const staying = () => performance.now() < stayUntil;

  function play(name, then) { once = { name, start: performance.now(), then }; }
  const playing = (name) => once?.name === name;

  // Places to perch: the top border of things with a visible edge, where
  // that edge is really on screen (not scrolled away or under the chat, the
  // terminal or a dialog), plus the long lines above reception and the
  // status bar. It never stands in the air.
  const PERCH = '.tab, .floor-name, .whiteboard, .ticket, .slack-sign, .next-chip';
  const LINES = ['#reception', '#statusbar'];
  function visible(el, x, y) {
    const at = document.elementsFromPoint(x, y).find((e) => e !== $hit);
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

  // Go to a point: walk when it is along the same edge, else fly. force: fly
  // even while it stays where the user dropped it.
  function goTo(to, edge = null, { force = false } = {}) {
    const dx = to.x - pos.x, dy = to.y - pos.y;
    const dist = Math.hypot(dx, dy);
    const walk = Math.abs(dy) < 3 && Math.abs(dx) < 220 && !reduced;
    if (!walk && staying()) { if (!force) return; stayUntil = 0; }
    if (dist < 3) { pos = { ...to }; surface = edge || surface; return; }
    if (Math.abs(dx) > 1) facing = dx > 0 ? 1 : -1;
    if (walk) {
      motion = { kind: 'walk', from: { ...pos }, to, start: performance.now(), ms: Math.abs(dx) * 22, edge: edge || surface };
    } else {
      play('takeoff');
      motion = { kind: 'fly', from: { ...pos }, to, start: performance.now() + 120, ms: Math.max(550, Math.min(2200, dist * 1.5)), peak: Math.min(130, 30 + dist * 0.25), edge };
    }
  }

  function step(t) {
    if (!motion) return;
    if (motion.kind === 'throw') return flight(t);
    if (motion.kind === 'stuck') { if (t > motion.until) { motion = null; fall(); } return; }
    const k = Math.max(0, Math.min(1, (t - motion.start) / motion.ms));
    if (motion.kind === 'walk') {
      pos = { x: motion.from.x + (motion.to.x - motion.from.x) * k, y: motion.from.y + (motion.to.y - motion.from.y) * k };
    } else if (motion.kind === 'fall') {
      pos = { x: motion.from.x, y: motion.from.y + (motion.to.y - motion.from.y) * k * k };
    } else {
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      pos = { x: motion.from.x + (motion.to.x - motion.from.x) * e, y: motion.from.y + (motion.to.y - motion.from.y) * e - Math.sin(Math.PI * k) * motion.peak };
    }
    if (k >= 1) {
      const m = motion;
      motion = null;
      pos = { ...m.to };
      surface = m.edge || null;
      if (m.kind !== 'walk') { play('land'); dust(); }
      nextIdle = t + 1200 + Math.random() * 2000;
    }
  }

  // ---- what to do next, while standing ----

  function think(t) {
    if (drag?.on || motion || (once && !['blink', 'look'].includes(once.name))) return;
    if (party) {
      const p = party.point();
      if (p && Math.hypot(p.x - pos.x, p.y - pos.y) > 6) return goTo(p);
      if (!flip && !reduced) flip = { start: t, landed: false };
      if (!playing('celebrate')) play('celebrate');
      if (Math.random() < 0.25) confetti(6);
      if (Date.now() > party.until) party = null;
      return;
    }
    if (flip) return;
    // Not on anything any more: hop down to the nearest edge.
    if (!pinned && !party && t > nextGround) {
      nextGround = t + 1000;
      if (!grounded()) {
        const near = perches().map((e) => ({ e, x: Math.max(e.left, Math.min(e.right, pos.x)) })).sort((a, b) => Math.hypot(a.x - pos.x, a.e.y - pos.y) - Math.hypot(b.x - pos.x, b.e.y - pos.y))[0];
        return near ? goTo({ x: near.x, y: near.e.y }, near.e, { force: true }) : goTo(home(), null, { force: true });
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
      const i = Math.max(0, Math.floor((t - once.start) / a.ms));
      if (i < a.frames.length) return a.frames[i];
      const then = once.then; once = null; then?.();
    }
    if (motion?.kind === 'stuck') return STUCK_POSE;
    let name = 'idle';
    if (drag?.on) name = 'hover';
    else if (motion && motion.kind !== 'walk') name = 'fly';
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
  // Seeing stars after a hard landing: they circle its head, wherever it is.
  function dizzy() { for (let i = 0; i < 3; i++) add({ kind: 'star', x: 0, y: 0, vx: 0, vy: 0, life: 1800, phase: (i * Math.PI * 2) / 3 }); }
  function zzz() { add({ kind: 'z', x: pos.x + 14 * facing, y: pos.y - 44, vx: 0.012 * facing, vy: -0.018, life: 2400 }); }

  // The "!" above its head: yellow with an outline, in a little bubble.
  const BANG = ['.OOOOO.', 'OWWWWWO', 'OWWYWWO', 'OWWYWWO', 'OWWYWWO', 'OWWWWWO', 'OWWYWWO', 'OWWWWWO', '.OOOOO.', '..OO...', '..O....'];
  const BANG_COLORS = { O: '#1a1420', W: '#fff7e0', Y: '#e8a10e' };
  const HEART = ['.PP.PP.', 'PPPPPPP', 'PPPPPPP', '.PPPPP.', '..PPP..', '...P...'];
  const Z = ['KKKK', '..K.', '.K..', 'KKKK'];
  const STAR = ['..Y..', '.YYY.', 'YYYYY', '.YYY.', '..Y..'];
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
      else if (p.kind === 'star') { const a = age / 160 + p.phase; pixels(STAR, pos.x + Math.cos(a) * 14 - 5, pos.y - 56 + Math.sin(a) * 4, { Y: '#ffd23f' }, 2); }
      else if (p.kind === 'score') { ctx.font = '700 16px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#1a1420'; ctx.strokeText(p.text, p.x, p.y); ctx.fillStyle = '#ffd23f'; ctx.fillText(p.text, p.x, p.y); }
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
    const f = flip && backflip(t - flip.start);
    if (flip && !f) flip = null;
    if (f?.phase === 'land' && !flip.landed) { flip.landed = true; dust(); }
    const lift = f ? f.lift : 0;
    think(t);
    if (hover && t > nextHeart) { nextHeart = t + (petting ? 260 : 900); heart(); }
    if ((mood === 'dream' || (night() && mood === 'idle' && !motion && !pinned)) && Math.random() < dt / 900) zzz();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, $cv.width, $cv.height);
    if (!hidden) {
      const b = board();
      if (b) drawBoard(b);
      const h = home();
      pixels(NEST, h.x - 22, h.y - 5, NEST_COLORS); // its bottom on the status bar's line
      // A shadow on the ground: under its feet, or where it will land while flying.
      const ground = motion?.kind === 'fall' ? motion.to.y : motion?.kind === 'fly' ? motion.from.y + (motion.to.y - motion.from.y) * Math.min(1, (t - motion.start) / motion.ms) : pos.y;
      const height = Math.max(0, ground - pos.y + lift);
      if (!drag?.on && motion?.kind !== 'throw' && motion?.kind !== 'stuck') {
        ctx.fillStyle = `rgba(0,0,0,${0.28 * Math.max(0.25, 1 - height / 200)})`;
        ctx.beginPath(); ctx.ellipse(pos.x, ground, 14 * Math.max(0.5, 1 - height / 250), 3.5, 0, 0, Math.PI * 2); ctx.fill();
      }

      let pose = currentPose(t);
      if (f) {
        // Rounded so the sprite cache sees a few poses, not one per frame.
        const sy = Math.round(f.squash * 50) / 50;
        pose = { ...pose, sy: (pose.sy || 1) * sy, sx: (pose.sx || 1) * (1 + (1 - sy) * 0.7) };
        if (f.phase === 'air') pose = { ...pose, legs: 'tuck', wing: 'up' };
      }
      ctx.save();
      if (motion?.kind === 'stuck') {
        // Beak tip on the hit point, quivering on it like a dart that just went in.
        const a = t - motion.start;
        ctx.translate(Math.round(motion.hit.x), Math.round(motion.hit.y));
        ctx.scale(facing * SCALE, SCALE);
        ctx.rotate(motion.angle + Math.sin(a / 25) * 0.2 * Math.max(0, 1 - a / 400));
        ctx.translate(-STUCK_TIP.x, -STUCK_TIP.y);
      } else {
        ctx.translate(Math.round(pos.x), Math.round(pos.y - lift));
        ctx.scale(facing * SCALE, SCALE);
        // Head back over its tail; the facing scale mirrors it, so a backflip both ways.
        if (f?.angle) { ctx.translate(0, -12); ctx.rotate(-f.angle); ctx.translate(0, 12); }
        else if (motion?.kind === 'throw') { ctx.translate(0, -12); ctx.rotate(motion.spin); ctx.translate(0, 12); }
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sprite(pose), -SIZE / 2 + 1, -GROUND);
      ctx.restore();
      // The ring it hit, outlined over it, so its body does not hide what scored.
      if (motion?.kind === 'stuck' && b) {
        ctx.globalAlpha = Math.min(1, (motion.until - t) / 300);
        drawRingOutline(b, motion.ring);
        ctx.globalAlpha = 1;
      }
      drawParts(t, dt);
      if (alert && !motion) pixels(BANG, pos.x + 6 * facing - 7, pos.y - lift - 84 + Math.round(Math.sin(t / 180) * 2), BANG_COLORS);
    }
    // The box for the mouse follows the body.
    $hit.style.transform = `translate(${Math.round(pos.x - 26)}px, ${Math.round(pos.y - lift - 52)}px)`;
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
    if (!hidden && !motion && !flip && !hover && !pinned && !party && mood !== 'dream' && mouse.speed > 2.2 && Math.hypot(mouse.x - pos.x, mouse.y - (pos.y - 24)) < 70) {
      feathers(3);
      play('startle', () => {
        const list = perches().filter((p) => Math.abs(p.y - pos.y) > 60 || Math.abs((p.left + p.right) / 2 - pos.x) > 200);
        const e2 = list[Math.floor(Math.random() * list.length)];
        if (e2) goTo({ x: e2.left + Math.random() * (e2.right - e2.left), y: e2.y }, e2);
      });
    }
  });
  let holdTimer = null, held = false, clickTimer = null, dragged = false;
  $hit.addEventListener('mouseenter', () => { hover = true; });
  $hit.addEventListener('mouseleave', () => { hover = false; petting = false; clearTimeout(holdTimer); });
  window.addEventListener('mouseup', () => { clearTimeout(holdTimer); petting = false; });

  // ---- picked up and dropped ----

  // Where its feet go while held: the body under the pointer, inside the
  // window and above the status bar.
  function heldAt(x, y) {
    const floor = document.getElementById('statusbar')?.getBoundingClientRect().top ?? window.innerHeight;
    return { x: Math.max(26, Math.min(window.innerWidth - 26, x)), y: Math.max(60, Math.min(floor, y + 26)) };
  }
  $hit.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    held = false; dragged = false;
    holdTimer = setTimeout(() => { held = true; petting = true; }, 350);
    drag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, on: false, samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }] };
    $hit.setPointerCapture(e.pointerId);
  });
  $hit.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const t = performance.now();
    drag.samples.push({ x: e.clientX, y: e.clientY, t });
    while (drag.samples[0].t < t - 2 * window.birdThrow.WINDOW_MS) drag.samples.shift();
    if (!drag.on) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      drag.on = true;
      clearTimeout(holdTimer); clearTimeout(clickTimer);
      petting = false; motion = null; once = null; flip = null; surface = null; stayUntil = 0;
      $hit.classList.add('held');
    }
    const p = heldAt(e.clientX, e.clientY);
    if (Math.abs(p.x - pos.x) > 1) facing = p.x > pos.x ? 1 : -1;
    pos = p;
  });
  function release(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { on, samples } = drag;
    drag = null;
    $hit.classList.remove('held');
    if (!on) return;
    dragged = true;
    // Only a real let-go throws: a cancel or a lost capture just drops it.
    const t = performance.now();
    const v = e.type === 'pointerup' ? window.birdThrow.releaseVelocity([...samples, { x: e.clientX, y: e.clientY, t }], t) : { vx: 0, vy: 0 };
    if (reduced || !window.birdThrow.isThrow(v)) drop();
    else fling(v);
  }
  $hit.addEventListener('pointerup', release);
  $hit.addEventListener('pointercancel', release);
  $hit.addEventListener('lostpointercapture', release);

  // The status bar's line: where it lands when there is nothing else below.
  function floorLine() {
    const bar = document.getElementById('statusbar')?.getBoundingClientRect();
    return { left: 40, right: window.innerWidth - 40, y: bar ? bar.top : window.innerHeight };
  }

  // Let go: it falls to the nearest edge below, or the status bar's line,
  // and stays there.
  function drop() {
    stayUntil = performance.now() + STAY_MS;
    nextIdle = performance.now() + 1500;
    fall();
  }
  // Only the fall, so a stay that a call or a celebration ended while it was
  // in the air or on the dart board does not start again.
  function fall() {
    const { edge, point: to } = window.birdDrop.landing(perches(), pos, floorLine());
    const h = Math.max(0, to.y - pos.y);
    if (reduced || h < 3) {
      pos = to; surface = edge;
      if (!reduced) { play('land'); dust(); }
      return;
    }
    motion = { kind: 'fall', from: { ...pos }, to, start: performance.now(), ms: Math.sqrt((2 * h) / GRAVITY), edge };
  }

  // Let go while moving: it flies off with the pointer's speed, tumbling,
  // bounces off the window's sides and top and lands on the first edge it
  // falls onto. Then it stays there, like after a drop.
  const MAX_FLIGHT_MS = 12_000;
  const WALL = 20;           // px from the window's sides to its feet at a bounce
  const CEILING = 56;        // its feet at a bounce off the top, with its head at the window's edge
  const HARD_LANDING = 1.1;  // px/ms down at touchdown that leaves it seeing stars
  const SPIN = 0.012;        // radians of tumble per px flown
  const faceAlong = (vx) => { if (Math.abs(vx) > 0.05) facing = vx > 0 ? 1 : -1; };
  function fling(v) {
    const { vx, vy } = window.birdThrow.capped(v);
    faceAlong(vx);
    const t = performance.now();
    stayUntil = t + STAY_MS;
    nextIdle = t + 1500;
    motion = { kind: 'throw', body: { x: pos.x, y: pos.y, vx, vy }, start: t, last: t, spin: 0, perches: perches(), nextPerches: t + 250 };
  }
  function flight(t) {
    const m = motion;
    const dt = Math.min(50, t - m.last);
    if (dt <= 0) return;
    m.last = t;
    const walls = { left: WALL, right: window.innerWidth - WALL, top: CEILING };
    const { body, hit } = window.birdThrow.advance(m.body, dt, GRAVITY, walls);
    if (hit.length) feathers(1);
    if (hit.includes('left') || hit.includes('right')) faceAlong(body.vx);
    if (t > m.nextPerches) { m.perches = perches(); m.nextPerches = t + 250; }
    const b = board();
    const hitAt = b && window.birdThrow.hitBoard({ x: m.body.x, y: m.body.y - BODY }, { x: body.x, y: body.y - BODY }, b);
    if (hitAt) return stick(t, hitAt.point, b, body);
    const land = window.birdThrow.landing(m.body, body, m.perches, floorLine());
    m.spin += dt * Math.hypot(body.vx, body.vy) * SPIN * (Math.sign(body.vx * facing) || 1);
    m.body = body;
    pos = { x: body.x, y: body.y };
    if (land) return touchDown(t, land, body.vy);
    if (t - m.start > MAX_FLIGHT_MS) { motion = null; fall(); }
  }
  function touchDown(t, { edge, point }, impact) {
    motion = null;
    pos = point; surface = edge;
    play('land'); dust();
    const hard = impact > HARD_LANDING;
    if (hard) dizzy();
    nextIdle = t + (hard ? 2500 : 1500);
  }

  // ---- the dart board ----

  // Target practice, from settings: a board on the office's right wall, about
  // halfway up. A thrown PiPi that flies into it sticks there for a moment,
  // scores by ring and drops to the edge below.
  const BODY = 24;          // CSS px from its feet up to the middle of its body
  const BOARD_R = 22;       // sprite px of the scoring face; a wooden rim goes around it
  const STICK_MS = 1300;
  const STUCK_POSE = { wing: 'up', legs: 'tuck', eye: 'wide', beak: 'open' };
  const STUCK_TIP = window.birdThrow.beakTip(pipiFrame(STUCK_POSE), SIZE, GROUND);
  // Where the last hit went in, from the board's middle; stays after PiPi drops off.
  let hitMark = null;
  const MARK = ['OO.OO', 'OWOWO', '.OWO.', 'OWOWO', 'OO.OO'];
  const MARK_COLORS = { O: '#1a1420', W: '#fff7e0' };
  const BEST_KEY = 'agent-office.dartboard-best';
  let dartBoard = false, lastScore = null, bestScore = 0;
  try { bestScore = Number(localStorage.getItem(BEST_KEY)) || 0; } catch { /* none yet */ }
  // Hidden behind the full-window terminal, a dialog, settings, or the open
  // chat, which sits over the office's right side. A split terminal leaves it up.
  const boardCovered = () => document.body.classList.contains('term-full') && document.body.classList.contains('panel-open')
    || !document.getElementById('modal')?.hidden || !document.getElementById('settings')?.hidden || !document.getElementById('assistant-chat')?.hidden;
  function board() {
    if (!dartBoard || hidden || boardCovered()) return null;
    const r = document.getElementById('building')?.getBoundingClientRect();
    if (!r || r.width < 200 || r.height < 160) return null;
    return { x: Math.round(r.right - 70), y: Math.round(r.top + r.height / 2), r: BOARD_R * SCALE };
  }
  // Painted once: rings from RINGS, wedges like a real board, a wooden rim.
  let boardSprite = null;
  function boardCanvas() {
    if (boardSprite) return boardSprite;
    const R = BOARD_R, RIM = 3, n = (R + RIM) * 2;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    const rings = window.birdThrow.RINGS;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - n / 2, dy = y + 0.5 - n / 2;
      const d = Math.hypot(dx, dy) / R;
      const wedge = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * 20 + 0.5) % 2;
      let color = null;
      if (d <= rings[0].r) color = '#e23b3b';
      else if (d <= rings[1].r) color = '#2f9e4f';
      else if (d <= rings[2].r) color = wedge ? '#f3e2c0' : '#1f1a24';
      else if (d <= rings[3].r) color = wedge ? '#e23b3b' : '#2f9e4f';
      else if (d <= rings[4].r) color = wedge ? '#1f1a24' : '#f3e2c0';
      else if (d <= 1 + (RIM - 1) / R) color = (x + y) % 3 ? '#8a5a32' : '#5a3a22';
      else if (d <= 1 + RIM / R) color = '#1a1420';
      if (color) { g.fillStyle = color; g.fillRect(x, y, 1, 1); }
    }
    return (boardSprite = c);
  }
  const outlines = new Map();
  function drawRingOutline(b, i) {
    let c = outlines.get(i);
    if (!c) {
      const R = BOARD_R, n = (R + 3) * 2, rings = window.birdThrow.RINGS;
      const edges = [rings[i].r * R, ...(i ? [rings[i - 1].r * R] : [])];
      c = document.createElement('canvas');
      c.width = c.height = n;
      const g = c.getContext('2d');
      g.fillStyle = '#ffd23f';
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2);
        if (edges.some((e) => Math.abs(d - e) < 0.5)) g.fillRect(x, y, 1, 1);
      }
      outlines.set(i, c);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, b.x - (c.width * SCALE) / 2, b.y - (c.height * SCALE) / 2, c.width * SCALE, c.height * SCALE);
  }
  function drawBoard(b) {
    const c = boardCanvas();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(c, b.x - (c.width * SCALE) / 2, b.y - (c.height * SCALE) / 2, c.width * SCALE, c.height * SCALE);
    if (hitMark) pixels(MARK, Math.round(b.x + hitMark.dx) - 5, Math.round(b.y + hitMark.dy) - 5, MARK_COLORS);
    const text = `last ${lastScore ?? '–'} · best ${bestScore}`;
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const w = ctx.measureText(text).width + 12, ty = b.y + b.r + 22;
    ctx.fillStyle = 'rgba(20,16,34,.78)';
    ctx.fillRect(Math.round(b.x - w / 2), ty - 12, Math.round(w), 17);
    ctx.fillStyle = '#fff3dc';
    ctx.fillText(text, b.x, ty);
  }
  function stick(t, point, b, v) {
    const s = window.birdThrow.score(point, b);
    lastScore = s;
    if (s > bestScore) { bestScore = s; try { localStorage.setItem(BEST_KEY, String(s)); } catch { /* ignore */ } }
    hitMark = { dx: point.x - b.x, dy: point.y - b.y };
    const dart = window.birdThrow.dartPose(point, v, STUCK_TIP, SCALE, facing);
    facing = dart.facing;
    // Its feet, so the box for the mouse follows it and the drop starts from there.
    pos = dart.feet;
    const ring = window.birdThrow.RINGS.findIndex((r) => r.score === s);
    motion = { kind: 'stuck', start: t, until: t + STICK_MS, hit: point, angle: dart.angle, ring };
    // Beside the board, not above PiPi, where its speech bubble would hide it.
    add({ kind: 'score', text: `+${s}`, x: b.x - b.r - 26, y: b.y, vx: 0, vy: -0.03, life: 1100 });
    if (s === window.birdThrow.RINGS[0].score) confetti(12);
  }

  // A click opens the chat; a double click is a flip, not two clicks. A
  // drag is neither.
  $hit.addEventListener('click', () => {
    if (dragged) { dragged = false; held = false; return; }
    if (held) { held = false; return; }
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => window.officeAssistant?.toggleChat(), 230);
  });
  $hit.addEventListener('dblclick', () => {
    clearTimeout(clickTimer);
    if (reduced) play('hop');
    else if (!flip) flip = { start: performance.now(), landed: false };
    confetti(8);
  });

  window.officeBird = {
    // idle | talk | dream | call (something for the user: it hovers, flapping)
    setMood(m) { mood = m; },
    // Something unread: a bobbing "!" above its head.
    setAlert(a) { alert = a; },
    // Stay at point() (re-read every frame, so it follows a moving target);
    // peck(): the element to peck at once there. null lets it roam.
    pin(point, { peck = null } = {}) {
      if (point && !peck && point !== pinned?.point) stayUntil = 0;
      pinned = point ? { point, peck } : null;
      if (!point) nextIdle = performance.now() + 800;
    },
    // Happy backflips with confetti at point() for a few seconds.
    celebrate(point) { stayUntil = 0; party = { point, until: Date.now() + 3500 }; },
    // The office is behind something (the terminal): stop drawing.
    setHidden(h) { hidden = h; $hit.hidden = h; },
    // Settings > PiPi > Dart board.
    setDartBoard(on) { dartBoard = !!on; if (!dartBoard) hitMark = null; },
    position: () => ({ ...pos }),
  };
  resize();
  requestAnimationFrame(frame);
})();
