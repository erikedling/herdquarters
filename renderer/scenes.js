// Pixel-art scenes painted on a 2D canvas: the welcome tour (welcome.js) and
// the README illustrations (scripts/make-art.js, `npm run art`) both draw
// these, so the docs always look like the app.
// Every scene is 160x90 logical pixels; draw(ctx, name, t, S) paints it at S
// screen pixels per logical pixel, t seconds into its animation. Labels use a
// real font at full resolution so they stay readable.
(function () {
  const W = 160, H = 90;
  const FONT = '"SF Pro Rounded", ui-rounded, "Nunito", system-ui, -apple-system, "Segoe UI", sans-serif';
  const INK = '#2b2d42', WHITE = '#ffffff', BLUSH = '#ff9eb5', MOUTH = '#c0566b';
  const WORKING = '#4f7cff', BLOCKED = '#ff5d5d', DONE = '#38c172';
  const WOOD = '#d39b63', WOOD_DARK = '#a8743f';
  // The assistant's sprite (pipi-sprite.js), loaded before this file in the app.
  const PIPI = typeof module !== 'undefined' && module.exports ? require('./pipi-sprite') : window.pipiSprite;

  const SKIN = { fair: '#f6d3b3', peach: '#f1c19a', tan: '#d29a68', brown: '#a86b3c', deep: '#74492a' };
  // The cast. Same kinds of looks as the office characters, drawn chibi-size.
  const CAST = {
    you:   { skin: SKIN.fair,  hair: '#4a3426', style: 'short',    shirt: '#ff8fa3', pants: '#3d5a99', seed: 1 },
    boss:  { skin: SKIN.tan,   hair: '#2b211c', style: 'bun',      shirt: '#6c63ff', pants: '#2b2f3f', tie: '#ffd166', seed: 2 },
    ana:   { skin: SKIN.brown, hair: '#1c1512', style: 'curly',    shirt: '#2bb3a3', pants: '#2b2f3f', seed: 3 },
    leo:   { skin: SKIN.peach, hair: '#d9642a', style: 'spiky',    shirt: '#f0862e', pants: '#3d5a99', seed: 4 },
    kim:   { skin: SKIN.fair,  hair: '#e8c56a', style: 'long',     shirt: '#b39ddb', pants: '#2b2f3f', seed: 5 },
    sam:   { skin: SKIN.deep,  hair: '#171210', style: 'cap',      shirt: '#f4f4f8', pants: '#1f2330', hat: '#2d9c6a', seed: 6 },
    noor:  { skin: SKIN.tan,   hair: '#6b3f21', style: 'ponytail', shirt: '#ff7ab6', pants: '#3d5a99', seed: 7 },
    olle:  { skin: SKIN.peach, hair: '#b9bcc6', style: 'bald',     shirt: '#3a9e6a', pants: '#2b2f3f', seed: 8 },
    mo:    { skin: SKIN.brown, hair: '#1c1512', style: 'short',    shirt: '#4f7cff', pants: '#1f2330', phones: true, seed: 9 },
  };

  function shade(hex, f = 0.8) {
    const n = parseInt(hex.slice(1, 7), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
    return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
  }

  // ---- drawing primitives, all in logical pixels ----

  function painter(ctx, S) {
    const r = Math.round;
    const p = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(r(x) * S, r(y) * S, r(w) * S, r(h) * S); };
    // Rectangle with its four corner pixels cut off.
    const rr = (x, y, w, h, c) => { p(x + 1, y, w - 2, h, c); p(x, y + 1, w, h - 2, c); };
    // The same, with a one-pixel outline.
    const box = (x, y, w, h, fill, line = INK) => { rr(x - 1, y - 1, w + 2, h + 2, line); rr(x, y, w, h, fill); };
    // '#' cells of a little bitmap.
    const pat = (rows, x, y, c) => rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') p(x + i, y + j, 1, 1, c); });
    const font = (size, weight) => { ctx.font = `${weight} ${size * S}px ${FONT}`; };
    const measure = (s, size = 5, weight = 700) => { font(size, weight); return ctx.measureText(s).width / S; };
    const text = (s, x, y, o = {}) => {
      font(o.size || 5, o.weight || 700);
      ctx.fillStyle = o.color || INK; ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(s, x * S, y * S);
    };
    return { ctx, S, p, rr, box, pat, text, measure };
  }

  const blinks = (ch, t) => (Math.floor(t * 8) + ch.seed * 11) % 29 === 0;
  const tick = (t, fps = 4) => Math.floor(t * fps) % 2;

  // ---- people and pets ----

  // A chibi person seen from the front, 12 wide and 20 tall from (x, y).
  // pose: 'stand' | 'wave' | 'hand' (raised, waiting on you) | 'typing'
  // (sitting behind a desk; workstation() draws the hands).
  function person(d, x, y, ch, pose, t) {
    const { p, rr } = d;
    const step = tick(t, 3);
    const h = ch.hair, arm = shade(ch.shirt, 0.86);
    if (ch.style === 'long') p(x, y + 2, 12, 11, h);
    if (ch.style === 'ponytail') p(x + 10, y + 2, 3, 8, h);
    // legs, then the body over them
    p(x + 3, y + 15, 2, 4, ch.pants); p(x + 7, y + 15, 2, 4, ch.pants);
    p(x + 2, y + 19, 3, 1, INK); p(x + 7, y + 19, 3, 1, INK);
    rr(x + 2, y + 9, 8, 7, ch.shirt);
    if (ch.tie) { p(x + 5, y + 10, 2, 4, ch.tie); p(x + 4, y + 9, 4, 1, WHITE); }
    // arms
    p(x + 1, y + 10, 1, pose === 'typing' ? 3 : 5, arm);
    if (pose !== 'typing') p(x + 1, y + 15, 1, 1, ch.skin);
    if (pose === 'wave') {
      p(x + 10, y + 9, 1, 2, arm); p(x + 11 + step, y + 4, 1, 6, arm); p(x + 11 + step, y + 2, 2, 2, ch.skin);
    } else if (pose === 'hand') {
      p(x + 10, y + 9, 1, 1, arm); p(x + 11, y + 1, 1, 9, arm); p(x + 11, y - 1, 2, 2, ch.skin);
    } else {
      p(x + 10, y + 10, 1, pose === 'typing' ? 3 : 5, arm);
      if (pose !== 'typing') p(x + 10, y + 15, 1, 1, ch.skin);
    }
    // head and face
    rr(x + 1, y, 10, 9, ch.skin);
    hair(d, x, y, ch);
    if (blinks(ch, t)) { p(x + 3, y + 6, 1, 1, INK); p(x + 8, y + 6, 1, 1, INK); } else { p(x + 3, y + 5, 1, 2, INK); p(x + 8, y + 5, 1, 2, INK); }
    p(x + 2, y + 7, 1, 1, BLUSH); p(x + 9, y + 7, 1, 1, BLUSH);
    p(x + 5, y + 7, 2, 1, MOUTH);
    if (ch.phones) { p(x + 2, y - 2, 8, 1, INK); p(x, y + 3, 2, 4, INK); p(x + 10, y + 3, 2, 4, INK); }
  }

  function hair(d, x, y, ch) {
    const { p, rr } = d, h = ch.hair;
    const top = () => { p(x + 1, y - 1, 10, 3, h); p(x + 2, y - 2, 8, 1, h); p(x + 1, y + 2, 1, 2, h); p(x + 10, y + 2, 1, 2, h); };
    switch (ch.style) {
      case 'short': case 'long': case 'ponytail': top(); p(x + 2, y + 2, 3, 1, h); break;
      case 'bun': top(); rr(x + 4, y - 5, 4, 4, h); break;
      case 'curly': rr(x, y - 3, 12, 6, h); for (const i of [1, 5, 9]) p(x + i, y - 4, 2, 1, h); p(x, y + 2, 1, 4, h); p(x + 11, y + 2, 1, 4, h); break;
      case 'spiky': p(x + 1, y - 1, 10, 3, h); p(x + 2, y - 3, 1, 2, h); p(x + 5, y - 4, 2, 3, h); p(x + 9, y - 3, 1, 2, h); break;
      case 'cap': p(x + 1, y + 2, 1, 2, h); p(x + 10, y + 2, 1, 2, h); p(x + 1, y - 2, 10, 4, ch.hat); p(x + 2, y - 3, 8, 1, ch.hat); p(x + 6, y + 1, 7, 1, shade(ch.hat)); break;
      case 'bald': p(x + 3, y + 1, 2, 1, '#ffffff'); break;
    }
  }

  // A desk w wide with its top at y: a plank, a front panel and two legs.
  function desk(d, x, y, w) {
    const { p } = d;
    p(x, y, w, 2, WOOD); p(x + 1, y + 2, w - 2, 6, WOOD_DARK); p(x + 3, y + 4, w - 6, 1, shade(WOOD_DARK, 0.9));
    p(x + 1, y + 8, 2, 3, WOOD_DARK); p(x + w - 3, y + 8, 2, 3, WOOD_DARK);
  }

  // Someone at a desk with a laptop. x is the person's left edge, top the
  // desk's top; the floor is at top + 11.
  function workstation(d, x, top, ch, t) {
    const { p, rr } = d;
    rr(x, top - 10, 12, 11, '#6b7290');
    person(d, x, top - 14, ch, 'typing', t);
    rr(x + 2, top - 5, 8, 5, '#d5dbe8'); p(x + 5, top - 3, 2, 2, WHITE);
    p(x + 3, top - 5, 6, 1, '#9fd3ff');
    const s = tick(t, 6);
    p(x + 1, top - 2 - s, 2, 2, ch.skin); p(x + 9, top - 3 + s, 2, 2, ch.skin);
    desk(d, x - 5, top, 22);
  }

  function cat(d, x, y, c, t) {
    const { p, rr } = d, w = tick(t, 2);
    p(x + 8, y + 4 - w, 1, 5, c); p(x + 9, y + 3 - w, 1, 2, c);
    rr(x + 1, y + 5, 7, 5, c);
    rr(x, y + 1, 8, 6, c); p(x, y, 2, 2, c); p(x + 6, y, 2, 2, c); p(x + 1, y + 1, 1, 1, BLUSH); p(x + 6, y + 1, 1, 1, BLUSH);
    p(x + 2, y + 3, 1, 2, INK); p(x + 5, y + 3, 1, 2, INK); p(x + 3, y + 5, 2, 1, '#ff8fa3');
    p(x + 2, y + 9, 1, 1, shade(c, 1.15)); p(x + 5, y + 9, 1, 1, shade(c, 1.15));
  }

  function dog(d, x, y, c, t) {
    const { p, rr } = d, w = tick(t, 6), ear = shade(c, 0.7);
    p(x + 10, y + 5 - w * 2, 2, 2, c); p(x + 9, y + 6, 2, 2, c);
    rr(x + 2, y + 6, 8, 5, c);
    rr(x, y, 9, 7, c); p(x - 1, y + 1, 2, 5, ear); p(x + 8, y + 1, 2, 5, ear);
    p(x + 2, y + 2, 1, 2, INK); p(x + 6, y + 2, 1, 2, INK); p(x + 3, y + 4, 3, 1, INK);
    p(x + 4, y + 5, 1, 2, '#ff7a9c');
    p(x + 3, y + 10, 1, 1, shade(c, 0.85)); p(x + 7, y + 10, 1, 1, shade(c, 0.85));
  }

  // The assistant as the app draws it: PiPi's 40x40 sprite at 3/4 of a scene
  // pixel per sprite pixel, in the default theme's blue (bird.js's palette).
  // (x, y): the sprite's top-left; its feet are at y + 28.
  const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
  const BIRD = (() => {
    const a = [79, 124, 255], k = [0, 0, 0], w = [255, 255, 255];
    return { O: mix(a, [20, 16, 34], 0.78), B: mix(a, k, 0), S: mix(a, k, 0.28), H: mix(a, w, 0.35), C: '#fff3dc', D: '#ecd0a2',
      W: mix(a, k, 0.18), X: mix(a, k, 0.45), Y: '#ffb02e', Z: '#d9730f', L: '#e8902a', K: '#1a1420', G: '#ffffff', P: '#ff8fa3' };
  })();
  function bird(d, x, y, pose) {
    const { ctx, S } = d, s = S * 0.75;
    PIPI.pipiFrame(pose).forEach((row, j) => row.forEach((k, i) => {
      if (k) { ctx.fillStyle = BIRD[k]; ctx.fillRect(Math.round(x * S + i * s), Math.round(y * S + j * s), Math.ceil(s), Math.ceil(s)); }
    }));
  }

  // ---- little things ----

  const QUESTION = ['.###.', '#...#', '....#', '..##.', '..#..', '.....', '..#..'];
  const CHECK = ['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'];
  const HEART = ['##.##', '#####', '.###.', '..#..'];
  const PLUS = ['..#..', '..#..', '#####', '..#..', '..#..'];

  // A speech bubble whose tail points down at (cx, by).
  function bubble(d, cx, by, w, h, fill, line = INK) {
    const { p, box } = d, x = Math.round(cx - w / 2), y = by - h - 2;
    box(x, y, w, h, fill, line);
    p(cx - 2, by - 2, 4, 2, line); p(cx - 1, by - 2, 2, 1, fill); p(cx - 1, by, 2, 1, line);
  }

  // A rounded label with text in it.
  function pill(d, cx, cy, s, bg, fg, size = 4.4) {
    const w = Math.ceil(d.measure(s, size)) + 6;
    d.rr(Math.round(cx - w / 2), cy - 4, w, 8, bg);
    d.text(s, cx, cy + 0.3, { size, color: fg });
  }

  function sparkle(d, x, y, c, t, phase = 0) {
    const { p } = d, big = (Math.floor(t * 3 + phase) % 3) === 0;
    p(x, y - 1, 1, 3, c); p(x - 1, y, 3, 1, c);
    if (big) { p(x, y - 2, 1, 5, c); p(x - 2, y, 5, 1, c); }
  }

  function cloud(d, x, y) { d.rr(x, y + 3, 20, 5, WHITE); d.rr(x + 4, y, 9, 6, WHITE); d.rr(x + 11, y + 1, 6, 4, WHITE); }

  function plant(d, x, y) {
    const { p, rr } = d;
    rr(x + 1, y + 7, 7, 5, '#e07a5f'); p(x + 1, y + 7, 7, 1, '#c8644a');
    p(x + 4, y + 1, 1, 6, '#3a9e6a'); rr(x, y + 2, 4, 3, '#4fbf72'); rr(x + 5, y, 4, 3, '#4fbf72'); rr(x + 5, y + 4, 4, 3, '#3a9e6a');
  }

  // Wall, skirting and plank floor; the floor starts at y = floor.
  function room(d, floor = 60, wall = '#fbe9dc') {
    const { p } = d;
    p(0, 0, W, floor, wall);
    for (let x = 6; x < W; x += 14) p(x, 0, 1, floor - 2, shade(wall, 0.97));
    p(0, floor - 2, W, 2, shade(wall, 0.86));
    p(0, floor, W, H - floor, '#efcfa6');
    for (let y = floor + 5; y < H; y += 6) p(0, y, W, 1, '#e3bd8f');
  }

  function wallWindow(d, x, y, w, h, t) {
    const { p, box, ctx, S } = d;
    box(x, y, w, h, '#bfe3ff', '#8a6a4f');
    p(x, y + h - 5, w, 5, '#d8efff');
    ctx.save(); ctx.beginPath(); ctx.rect(x * S, y * S, w * S, h * S); ctx.clip();
    cloud(d, x + ((t * 2) % (w + 20)) - 20, y + 3);
    ctx.restore();
    p(x + w / 2, y, 1, h, '#8a6a4f'); p(x, y + h / 2, w, 1, '#8a6a4f');
  }

  // ---- scenes ----

  const SCENES = {};

  // The building: a floor per repo, a person in every window.
  SCENES.welcome = (d, t) => {
    const { p, rr, box, ctx, S } = d;
    const g = ctx.createLinearGradient(0, 0, 0, H * S);
    g.addColorStop(0, '#bfe3ff'); g.addColorStop(1, '#fff1e0');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W * S, H * S);
    rr(14, 8, 13, 13, '#ffd66b'); rr(16, 10, 9, 9, '#ffe49a');
    sparkle(d, 30, 8, '#ffd66b', t); sparkle(d, 10, 22, '#ffd66b', t, 1);
    cloud(d, ((t * 3) % 200) - 25, 12); cloud(d, ((t * 2 + 110) % 200) - 25, 28);
    // ground and trees
    p(0, 74, W, 16, '#9be08f'); p(0, 74, W, 1, '#7cc96f'); p(70, 74, 20, 16, '#f2dcb3');
    for (const x of [8, 22, 132, 146]) { p(x + 3, 64, 2, 10, WOOD_DARK); rr(x, 54, 8, 12, '#4fbf72'); p(x + 2, 56, 2, 3, '#7ad68f'); }
    // building
    box(44, 24, 72, 50, '#ffd9c2', '#c98b6b');
    p(42, 21, 76, 3, '#e66f6f'); p(44, 24, 72, 1, '#c95a5a');
    const sw = Math.ceil(d.measure('HERDQUARTERS', 5.2, 800)) + 8;
    box(80 - sw / 2, 8, sw, 10, '#fff6e8');
    d.text('HERDQUARTERS', 80, 13.4, { size: 5.2, weight: 800, color: '#e65f6f' });
    p(60, 18, 1, 3, '#c98b6b'); p(99, 18, 1, 3, '#c98b6b');
    // windows: who is in, and how they are doing
    const folks = [CAST.ana, CAST.leo, CAST.kim, CAST.sam, CAST.noor, CAST.olle, CAST.mo, CAST.boss];
    const flags = { 1: 'ask', 3: 'done' };
    let k = 0;
    for (const wy of [29, 43]) {
      for (const wx of [50, 66, 84, 100]) {
        box(wx, wy, 11, 9, '#9fd3ff', '#8a6a4f');
        const ch = folks[k];
        rr(wx + 3, wy + 3, 5, 5, ch.skin); p(wx + 3, wy + 2, 5, 2, ch.style === 'cap' ? ch.hat : ch.hair);
        if (!blinks(ch, t)) { p(wx + 4, wy + 5, 1, 1, INK); p(wx + 6, wy + 5, 1, 1, INK); }
        p(wx + 2, wy + 8, 7, 1, ch.shirt);
        const bob = tick(t, 2);
        if (flags[k] === 'ask') { box(wx + 8, wy - 6 - bob, 7, 9, BLOCKED, WHITE); d.pat(QUESTION, wx + 9, wy - 5 - bob, WHITE); }
        if (flags[k] === 'done') { box(wx + 7, wy - 6 - bob, 9, 8, DONE, WHITE); d.pat(CHECK, wx + 8, wy - 5 - bob, WHITE); }
        k++;
      }
    }
    // ground floor: door with an awning, a window either side
    for (let i = 0; i < 9; i++) p(70 + i * 2, 58, 2, 3, i % 2 ? WHITE : '#e66f6f');
    box(73, 61, 14, 13, '#8a5a3c', '#5e3d27'); p(84, 67, 1, 1, '#ffd66b');
    box(52, 60, 12, 9, '#9fd3ff', '#8a6a4f'); box(96, 60, 12, 9, '#9fd3ff', '#8a6a4f');
    plant(d, 62, 63); plant(d, 89, 63);
    cat(d, 92, 70, '#f0a35e', t);
    dog(d, 52, 75, '#e0b25e', t);
  };

  // You hand the boss a task.
  SCENES.delegate = (d, t) => {
    room(d, 62);
    wallWindow(d, 64, 8, 32, 22, t);
    const ph = (t % 3.2) / 3.2;
    // you, with the task in a bubble
    person(d, 20, 54, CAST.you, ph < 0.15 ? 'wave' : 'stand', t);
    bubble(d, 28, 48, 44, 17, WHITE);
    d.text('Add dark mode', 28, 35, { size: 4.6 });
    d.text('to web and api', 28, 41, { size: 4.6, color: '#6c63ff' });
    // the task flies over as a paper plane
    if (ph > 0.12 && ph < 0.78) {
      const q = (ph - 0.12) / 0.66, x = 50 + q * 52, y = 44 - Math.sin(q * Math.PI) * 16;
      d.pat(['#.....', '###...', '#####.', '######', '.###..'], x, y, WHITE);
      d.pat(['......', '...#..', '....#.', '......', '.#....'], x, y, '#c9cfdc');
    }
    // the boss at their desk
    workstation(d, 112, 64, CAST.boss, t);
    d.rr(124, 57, 6, 7, WOOD_DARK); d.p(125, 58, 4, 5, WHITE); d.p(126, 59, 2, 1, '#9aa3bd'); d.p(126, 61, 2, 1, '#9aa3bd');
    d.box(113, 68, 10, 4, '#ffe08a', WOOD_DARK); d.text('BOSS', 118, 70.3, { size: 2.6, weight: 800, color: '#8a5a3c' });
    if (ph >= 0.78 || ph < 0.05) {
      bubble(d, 124, 42, 26, 10, '#efeaff', '#6c63ff');
      d.text('On it!', 124, 35.4, { size: 4.6, color: '#4b44c9' });
      sparkle(d, 140, 30, '#ffd166', t); sparkle(d, 106, 32, '#ffd166', t, 1);
    }
    pill(d, 26, 84, 'you', '#ffe1e8', '#c23d5c');
    pill(d, 118, 84, 'your assistant, the boss', '#e9e6ff', '#4b44c9');
  };

  // The boss opens a worker per repo, all on one branch.
  SCENES.team = (d, t) => {
    const { p, rr, box, ctx, S } = d;
    p(0, 0, W, H, '#f6efe7');
    p(0, 40, W, 50, '#efe4d6');
    workstation(d, 74, 28, CAST.boss, t);
    // the board on the wall
    box(116, 6, 32, 26, WHITE, '#9aa3bd');
    d.text('BOARD', 132, 10.5, { size: 3.4, weight: 800, color: '#6b7290' });
    [[DONE, true], [DONE, true], ['#c9cfdc', false]].forEach(([c, done], i) => {
      const y = 15 + i * 5;
      p(119, y, 3, 3, c); if (done) p(120, y + 1, 1, 1, WHITE);
      p(124, y + 1, 20 - i * 3, 1, '#c9cfdc');
    });
    pill(d, 34, 18, 'branch: dark-mode', '#d8f5e1', '#2f7d4f');
    pill(d, 34, 28, 'a worktree per repo', '#fff1c9', '#8a6a1f');
    // the rooms
    const rooms = [['api', 4, '#dce8ff', CAST.ana], ['web', 57, '#ffe1e8', CAST.leo], ['infra', 110, '#dff5e6', CAST.sam]];
    ctx.save();
    ctx.strokeStyle = '#9aa3bd'; ctx.lineWidth = S * 0.8; ctx.setLineDash([S * 2, S * 2]); ctx.lineDashOffset = -t * S * 8;
    for (const [, x] of rooms) { ctx.beginPath(); ctx.moveTo(80 * S, 40 * S); ctx.lineTo((x + 23) * S, 50 * S); ctx.stroke(); }
    ctx.restore();
    rooms.forEach(([name, x, wall, ch], i) => {
      box(x, 52, 46, 36, wall, shade(wall, 0.75));
      p(x, 79, 46, 9, '#efcfa6');
      workstation(d, x + 17, 77, ch, t + i * 0.37);
      plant(d, x + 36, 68);
      const sw = Math.ceil(d.measure(name, 4.4, 800)) + 6;
      box(x + 23 - sw / 2, 46, sw, 7, WHITE, '#6b7290');
      d.text(name, x + 23, 49.8, { size: 4.4, weight: 800 });
      // a task note travelling down the line
      const q = ((t * 0.5 + i / 3) % 1);
      const nx = 80 + (x + 23 - 80) * q, ny = 40 + 10 * q;
      rr(nx - 2, ny - 2, 5, 4, '#ffd166'); p(nx - 1, ny - 1, 3, 1, '#c9932f');
    });
  };

  // Working, waiting on you, done.
  SCENES.status = (d, t) => {
    const { p, box } = d;
    room(d, 58, '#eef3ff');
    wallWindow(d, 10, 8, 26, 18, t);
    wallWindow(d, 124, 8, 26, 18, t + 3);
    const bob = tick(t, 2);
    // working
    workstation(d, 22, 64, CAST.kim, t);
    // needs you: up from the desk, hand raised; the cat comes to sit by them
    desk(d, 69, 64, 22); d.rr(75, 58, 8, 6, '#c9cfdc');
    person(d, 74, 55, CAST.mo, 'hand', t);
    box(85, 38 - bob, 9, 11, BLOCKED, WHITE); d.pat(QUESTION, 87, 40 - bob, WHITE);
    cat(d, 89, 65, '#8e96a8', t);
    d.pat(HEART, 93, 58 - ((t * 6) % 6), '#ff7a9c');
    // done: up on the desk, waving
    desk(d, 121, 64, 22);
    person(d, 126, 44, CAST.noor, 'wave', t);
    box(140, 31 - bob, 11, 10, DONE, WHITE); d.pat(CHECK, 142, 33 - bob, WHITE);
    dog(d, 140, 68, '#e0b25e', t);
    sparkle(d, 120, 38, '#ffd166', t); sparkle(d, 152, 50, '#ff8fa3', t, 1); sparkle(d, 118, 54, '#6c63ff', t, 2);
    pill(d, 28, 84, 'working', '#dce8ff', '#2f55c9');
    pill(d, 80, 84, 'needs you', '#ffe1e1', '#c23333');
    pill(d, 132, 84, 'done', '#d8f5e1', '#2f7d4f');
  };

  // QA, ops and the Slack watcher.
  SCENES.helpers = (d, t) => {
    const { p, rr, box } = d;
    p(0, 0, W, H, '#f6efe7');
    const cards = [[4, '#dce8ff', 'QA review', 'reads every diff'], [56, '#ffe1e8', 'Deploy watch', 'alarms on errors'], [108, '#dff5e6', 'Slack watch', 'spots who waits on you']];
    for (const [x, c, title, sub] of cards) {
      box(x + 1, 5, 46, 80, c, shade(c, 0.78));
      d.text(title, x + 24, 70, { size: 5.2, weight: 800 });
      d.text(sub, x + 24, 77.5, { size: 3.8, weight: 600, color: '#5f6880' });
      p(x + 2, 58, 44, 1, shade(c, 0.9));
    }
    // QA: a magnifying glass sweeping over a diff
    person(d, 8, 38, CAST.olle, 'stand', t);
    box(25, 18, 18, 30, WHITE, '#9aa3bd');
    for (let i = 0; i < 7; i++) p(28, 22 + i * 3.6, 6 + ((i * 5) % 7), 1.4, i % 3 === 1 ? DONE : i === 4 ? BLOCKED : '#c9cfdc');
    const my = 22 + ((Math.sin(t * 1.6) + 1) / 2) * 16;
    d.pat(['.###.', '#...#', '#...#', '#...#', '.###.'], 31, my, INK);
    p(35, my + 4, 1, 1, INK); p(36, my + 5, 2, 2, '#8a5a3c');
    if (tick(t, 1)) d.pat(CHECK, 40, 12, DONE);
    // Ops: a heartbeat on a monitor
    person(d, 60, 38, CAST.sam, 'stand', t);
    box(75, 20, 26, 20, '#2b3150', '#1a1d29');
    p(86, 41, 4, 4, '#6b7290'); p(83, 45, 10, 2, '#6b7290');
    const shift = Math.floor(t * 10);
    let prev = 31;
    for (let i = 0; i < 24; i++) {
      const k = (i + shift) % 12, y = k === 5 ? 24 : k === 6 ? 35 : 31;
      p(76 + i, Math.min(prev, y), 1, Math.abs(prev - y) + 1, '#7cff6b');
      prev = y;
    }
    sparkle(d, 99, 16, '#ffd166', t);
    // Slack: an envelope bobbing up with a !
    person(d, 114, 38, CAST.mo, 'stand', t);
    const ey = 22 - tick(t, 2) * 2;
    box(130, ey, 14, 10, WHITE, INK);
    d.pat(['#..........#', '.##......##.', '...##..##...', '.....##.....'], 131, ey, '#9aa3bd');
    rr(140, ey - 6, 7, 7, BLOCKED); p(143, ey - 5, 1, 3, WHITE); p(143, ey - 1, 1, 1, WHITE);
    bubble(d, 128, 18, 14, 7, WHITE);
    for (let i = 0; i < 3; i++) if (Math.floor(t * 3) % 4 > i) p(124 + i * 3, 13, 2, 2, '#9aa3bd');
  };

  // The assistant: a bird that keeps track of everything for you.
  SCENES.assistant = (d, t, o) => {
    const { p, rr, box } = d;
    const name = o.assistantName || 'PiPi';
    room(d, 62, '#eef3ff');
    wallWindow(d, 8, 8, 24, 18, t);
    const ph = t % 7;
    person(d, 16, 52, CAST.you, ph < 0.8 ? 'wave' : 'stand', t);
    // the chat window
    box(42, 6, 76, 62, WHITE, '#9aa3bd');
    p(42, 6, 76, 9, '#eef1fb'); p(42, 15, 76, 1, '#dfe4f2');
    d.text(name, 47, 10.8, { size: 4.4, weight: 800, align: 'left' });
    p(110, 10, 3, 3, '#38c172');
    const msg = (x, y, w, s, bg, fg) => { rr(x, y, w, 9, bg); d.text(s, x + w / 2, y + 4.8, { size: 3.6, weight: 700, color: fg }); };
    msg(48, 19, 50, 'Good morning, Mia!', '#eef1fb', INK);
    msg(48, 30, 62, '2 bosses wait on you', '#eef1fb', INK);
    if (ph > 1) msg(72, 42, 42, 'Remind me at 3', '#dce8ff', '#2f55c9');
    if (ph > 1.6 && ph < 2.8) for (let i = 0; i < 3; i++) if (Math.floor(t * 4) % 3 >= i) p(50 + i * 4, 56, 2, 2, '#9aa3bd');
    if (ph >= 2.8) msg(48, 53, 52, 'Done! I will ping you', '#eef1fb', INK);
    // the bird on its perch, talking while it answers
    rr(124, 62, 28, 3, WOOD_DARK); p(128, 65, 2, 6, WOOD_DARK); p(146, 65, 2, 6, WOOD_DARK);
    const talking = ph > 1.6 && ph < 3.4;
    const frame = Math.floor(t * 7) % 4;
    bird(d, 121, 34, talking ? PIPI.ANIM.talk.frames[frame] : ph > 4.4 ? PIPI.ANIM.happy.frames[Math.floor(t * 6) % 2] : {});
    // later: the reminder goes off
    if (ph > 4.4) {
      bubble(d, 138, 37, 34, 10, '#fff6d6', '#e0b25e');
      d.text('3:00 Call Noor', 138, 30.6, { size: 3.6, weight: 800, color: '#8a6a1f' });
      sparkle(d, 156, 24, '#ffd166', t);
    }
    pill(d, 26, 84, 'you', '#ffe1e8', '#c23d5c');
    pill(d, 104, 84, `${name}, your assistant`, '#dce8ff', '#2f55c9');
  };

  // The front door of your first orchestrator.
  SCENES.go = (d, t) => {
    const { p, box, ctx, S } = d;
    const g = ctx.createLinearGradient(0, 0, 0, H * S);
    g.addColorStop(0, '#ffe8d6'); g.addColorStop(1, '#ffd6e0');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W * S, H * S);
    p(0, 74, W, 16, '#efcfa6'); for (let y = 79; y < H; y += 6) p(0, y, W, 1, '#e3bd8f');
    // an open door with light spilling out
    box(62, 24, 36, 50, '#fff2b3', '#8a5a3c');
    p(63, 25, 34, 49, '#fff7cf');
    p(56, 24, 6, 50, '#a8743f'); p(57, 26, 4, 46, '#8a5a3c'); p(60, 48, 1, 2, '#ffd66b');
    p(64, 74, 32, 3, '#fff2b3'); p(60, 77, 40, 3, '#ffe9a8');
    const sw = Math.ceil(d.measure('+  New orchestrator', 5, 800)) + 10;
    box(80 - sw / 2, 9, sw, 10, '#6c63ff', '#4b44c9');
    d.text('+  New orchestrator', 80, 14.4, { size: 5, weight: 800, color: WHITE });
    person(d, 74, 54, CAST.boss, 'wave', t);
    person(d, 36, 54, CAST.you, 'stand', t);
    cat(d, 104, 65, '#f0a35e', t);
    dog(d, 18, 64, '#e0b25e', t);
    plant(d, 116, 62); plant(d, 135, 62);
    // confetti
    const colors = ['#ff8fa3', '#6c63ff', '#38c172', '#ffd166', '#4fb8e8'];
    for (let k = 0; k < 28; k++) {
      const x = (k * 37 + Math.sin(t * 2 + k) * 3) % W, y = ((t * 14 + k * 17) % 84) - 6;
      p(x, y, 1 + (k % 2), 1 + ((k + 1) % 2), colors[k % colors.length]);
    }
  };

  // opts: { assistantName } (PiPi unless renamed).
  function draw(ctx, name, t = 0, S = 4, opts = {}) {
    const scene = SCENES[name];
    if (!scene) throw new Error(`no scene "${name}"`);
    if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W * S, H * S);
    scene(painter(ctx, S), t, opts);
  }

  // How many seconds each scene takes to come round again, for the README's
  // looping animations (make-art.js). The clouds drift on their own time.
  const LOOP = { welcome: 4, delegate: 3.2, team: 2, status: 3, helpers: 3.6, assistant: 7, go: 6 };
  const api = { W, H, NAMES: Object.keys(SCENES), LOOP, draw };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  window.herdScenes = api;
})();
