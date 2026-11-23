// Pixel-art desk + person for the "office" layout, in the same chibi style as
// the welcome tour (scenes.js): round heads, blush, a little smile, sitting
// behind a wooden desk with a laptop. Same characters as figure.js
// (window.CHARACTERS), drawn on a 44x54 unit grid at 3 screen px per unit.
// Working, idle and unknown sit behind the desk; blocked and alert stand up
// with a hand raised; done climbs onto the desk to wave.
// Groups carry class names (.person, .head, .arm-l, .arm-r, .frame, .bubble,
// .glow, .steam, .code-line) so office.css can animate them.
(function () {
  const U = 3, W = 44, H = 54;
  const FONT = "'SF Pro Rounded', ui-rounded, Nunito, system-ui, -apple-system, 'Segoe UI', sans-serif";

  // One fixed name per character; shown on the desk nameplate.
  const NAMES = ['PATRIK', 'ANNA', 'ERIK', 'NILS', 'MAJA', 'OSKAR', 'GUSTAV', 'VIKTOR', 'SARA', 'JONAS',
    'KLARA', 'LINNEA', 'MIKAEL', 'HUGO', 'TOVE', 'ELIN', 'JOHAN', 'FRIDA', 'ASTRID', 'EMMA', 'AIDA'];

  // Pixel buffer: set(x, y, colour), then svg() merges horizontal runs into rects.
  class Grid {
    constructor() { this.rows = new Map(); }
    set(x, y, c) {
      let r = this.rows.get(y);
      if (!r) { r = new Map(); this.rows.set(y, r); }
      r.set(x, c);
    }
    rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
    clear(x, y) { this.rows.get(y)?.delete(x); }
    p(x, y, w, h, c) { this.rect(x, y, w, h, c); }
    // Rectangle with its four corner pixels cut off.
    rr(x, y, w, h, c) { this.rect(x + 1, y, w - 2, h, c); this.rect(x, y + 1, 1, h - 2, c); this.rect(x + w - 1, y + 1, 1, h - 2, c); }
    // The same with a one-pixel outline.
    box(x, y, w, h, fill, line) { this.rr(x - 1, y - 1, w + 2, h + 2, line); this.rr(x, y, w, h, fill); }
    pat(rows, x, y, c) { rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') this.set(x + i, y + j, c); }); }
    // Rectangle with the four corner pixels left out.
    rounded(x, y, w, h, c) { this.rect(x, y, w, h, c); for (const [i, j] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]]) this.clear(i, j); }
    svg() {
      const out = [];
      for (const [y, row] of [...this.rows].sort((a, b) => a[0] - b[0])) {
        const xs = [...row.keys()].sort((a, b) => a - b);
        for (let i = 0; i < xs.length;) {
          const x0 = xs[i], c = row.get(x0);
          let x1 = x0;
          while (i + 1 < xs.length && xs[i + 1] === x1 + 1 && row.get(xs[i + 1]) === c) { i++; x1 = xs[i]; }
          out.push(`<rect x="${x0}" y="${y}" width="${x1 - x0 + 1}" height="1" fill="${c}"/>`);
          i++;
        }
      }
      return out.join('');
    }
  }

  const INK = '#2b2d42', WHITE = '#ffffff', GOLD = '#ffd166', BLUSH = '#ff9eb5', MOUTH = '#c0566b';
  const WOOD = '#d39b63', WOOD_DARK = '#a8743f', BOSS_WOOD = '#9a6440', BOSS_DARK = '#6e4430';
  const BLOCKED = '#ff5d5d', DONE = '#38c172';

  function shade(hex, f = 0.8) {
    const n = parseInt(hex.slice(1, 7), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
    return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
  }

  const QUESTION = ['.###.', '#...#', '....#', '..##.', '..#..', '.....', '..#..'];
  const BANG = ['##', '##', '##', '##', '##', '..', '##'];
  const CHECK = ['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'];

  // ---- a chibi person, 12 wide and 20 tall from (x, y), facing us ----
  // Head x+1..x+10 by y..y+8, body x+2..x+9 by y+9..y+15, legs below.

  // Hair that sits behind the head and body.
  function hairBack(g, ch, x, y) {
    const { style, color } = ch.hair;
    if (style === 'long') g.p(x, y + 2, 12, 11, color);
    if (style === 'bob') g.p(x, y + 1, 12, 8, color);
    if (style === 'ponytail') g.p(x + 10, y + 2, 3, 8, color);
    if (style === 'afro') { g.rr(x - 1, y - 4, 14, 11, color); }
  }

  function hairFront(g, ch, x, y) {
    const { style, color, hat, band } = ch.hair;
    const top = () => { g.p(x + 1, y - 1, 10, 3, color); g.p(x + 2, y - 2, 8, 1, color); g.p(x + 1, y + 2, 1, 2, color); g.p(x + 10, y + 2, 1, 2, color); };
    switch (style) {
      case 'short': top(); g.p(x + 2, y + 2, 3, 1, color); break;
      case 'buzz': g.p(x + 2, y - 1, 8, 1, color); g.p(x + 1, y, 10, 2, color); break;
      case 'long': case 'bob': case 'ponytail': top(); g.p(x + 2, y + 2, 3, 1, color); if (band) g.p(x + 1, y, 10, 1, band); break;
      case 'bun': top(); g.rr(x + 4, y - 5, 4, 4, color); break;
      case 'spiky': g.p(x + 1, y - 1, 10, 3, color); g.p(x + 2, y - 3, 1, 2, color); g.p(x + 5, y - 4, 2, 3, color); g.p(x + 9, y - 3, 1, 2, color); break;
      case 'mohawk': g.p(x + 5, y - 4, 2, 6, color); break;
      case 'afro': g.rr(x, y - 3, 12, 5, color); break;
      case 'curly': g.rr(x, y - 3, 12, 6, color); for (const i of [1, 5, 9]) g.p(x + i, y - 4, 2, 1, color); g.p(x, y + 2, 1, 4, color); g.p(x + 11, y + 2, 1, 4, color); break;
      case 'sides': g.p(x, y + 2, 2, 4, color); g.p(x + 10, y + 2, 2, 4, color); g.p(x + 3, y + 1, 2, 1, shade(ch.skin, 1.12)); break;
      case 'bald': g.p(x + 3, y + 1, 2, 1, shade(ch.skin, 1.12)); break;
      case 'beanie': g.p(x + 1, y + 2, 1, 2, color); g.p(x + 10, y + 2, 1, 2, color); g.p(x + 1, y - 2, 10, 4, hat); g.p(x + 2, y - 3, 8, 1, hat); g.p(x + 1, y + 1, 10, 1, shade(hat)); g.p(x + 5, y - 5, 2, 2, WHITE); break;
      case 'cap': g.p(x + 1, y + 2, 1, 2, color); g.p(x + 10, y + 2, 1, 2, color); g.p(x + 1, y - 2, 10, 4, hat); g.p(x + 2, y - 3, 8, 1, hat); g.p(x + 6, y + 1, 7, 1, shade(hat)); break;
      default: top();
    }
  }

  // Eyes, blush, mouth and accessories. closed: content, eyes shut (idle).
  function face(g, ch, x, y, closed) {
    const ex = ch.extras || [];
    if (closed) { g.p(x + 2, y + 6, 2, 1, INK); g.p(x + 8, y + 6, 2, 1, INK); }
    else { g.p(x + 3, y + 5, 1, 2, INK); g.p(x + 8, y + 5, 1, 2, INK); }
    const glasses = ex.includes('glasses');
    g.set(x + (glasses ? 1 : 2), y + 7, BLUSH); g.set(x + (glasses ? 10 : 9), y + 7, BLUSH);
    g.p(x + 5, y + 7, 2, 1, MOUTH);
    const hc = ch.hair.color;
    for (const e of ex) {
      switch (e) {
        case 'glasses': {
          const f = '#5b4636';
          for (const gx of [x + 2, x + 7]) { g.p(gx, y + 4, 3, 1, f); g.p(gx, y + 7, 3, 1, f); g.p(gx, y + 5, 1, 2, f); g.p(gx + 2, y + 5, 1, 2, f); }
          g.p(x + 5, y + 5, 2, 1, f);
          break;
        }
        case 'sunglasses': g.p(x + 2, y + 5, 3, 2, '#22232b'); g.p(x + 7, y + 5, 3, 2, '#22232b'); g.p(x + 5, y + 5, 2, 1, '#22232b'); g.set(x + 3, y + 5, '#5a5d6e'); g.set(x + 8, y + 5, '#5a5d6e'); break;
        case 'beard': g.p(x + 2, y + 7, 8, 2, hc); g.p(x + 3, y + 9, 6, 1, hc); g.p(x + 5, y + 7, 2, 1, MOUTH); break;
        case 'moustache': g.p(x + 4, y + 7, 4, 1, hc); g.p(x + 5, y + 8, 2, 1, MOUTH); break;
        case 'earrings': g.set(x, y + 6, GOLD); g.set(x + 11, y + 6, GOLD); break;
        case 'headphones': g.p(x + 2, y - 3, 8, 1, '#3a4052'); g.p(x + 1, y - 2, 1, 2, '#3a4052'); g.p(x + 10, y - 2, 1, 2, '#3a4052'); g.p(x, y + 2, 2, 4, '#3a4052'); g.p(x + 10, y + 2, 2, 4, '#3a4052'); break;
        case 'freckles': g.set(x + 3, y + 8, '#c47a4a'); g.set(x + 8, y + 8, '#c47a4a'); break;
      }
    }
  }

  function torso(g, ch, x, y) {
    const { style, color, accent, tie } = ch.top;
    g.rr(x + 2, y + 9, 8, 7, color);
    switch (style) {
      case 'hoodie': g.p(x + 3, y + 9, 6, 1, accent); g.p(x + 4, y + 10, 1, 2, WHITE); g.p(x + 7, y + 10, 1, 2, WHITE); break;
      case 'blazer': g.p(x + 4, y + 9, 4, 7, accent); g.p(x + 5, y + 10, 2, 4, tie); break;
      case 'cardigan': g.p(x + 5, y + 9, 2, 7, accent); break;
      case 'vest': g.p(x + 2, y + 9, 2, 7, accent); g.p(x + 8, y + 9, 2, 7, accent); break;
      case 'striped': for (const r of [10, 12, 14]) g.p(x + 2, y + r, 8, 1, accent); break;
      case 'turtleneck': g.p(x + 4, y + 8, 4, 1, color); break;
    }
  }

  function legs(g, ch, x, y) {
    g.p(x + 3, y + 15, 2, 4, ch.pants); g.p(x + 7, y + 15, 2, 4, ch.pants);
    g.p(x + 2, y + 19, 3, 1, INK); g.p(x + 7, y + 19, 3, 1, INK);
  }

  function head(ch, x, y, closed) {
    const g = new Grid();
    g.rr(x + 1, y, 10, 9, ch.skin);
    hairFront(g, ch, x, y);
    face(g, ch, x, y, closed);
    return `<g class="head">${g.svg()}</g>`;
  }

  const armColor = (ch) => shade(ch.top.color, 0.86);

  // The waving arm, one sprite per frame, drawn from just right of the shoulder
  // (x + 11, y + 1): a = sleeve, h = hand. Only the shoulder itself stays still.
  const WAVE = [
    ['.......', '.hh....', '.hh....', '.a.....', '.a.....', '.a.....', '.a.....', '.a.....', 'a......'],
    ['.......', '.......', '..hh...', '..hh...', '..a....', '..a....', '..a....', '.a.....', 'a......'],
    ['.......', '.......', '.......', '....hh.', '....hh.', '....a..', '....a..', '..aa...', 'aa.....'],
  ];
  const sprite = (rows, x, y, colors) => {
    const g = new Grid();
    rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (colors[row[i]]) g.set(x + i, y + j, colors[row[i]]); });
    return g;
  };

  // Later frames start hidden so a figure office.css doesn't animate shows one still pose.
  const frames = (grids) => grids.map((g, i) => `<g class="frame f${i + 1}"${i ? ' visibility="hidden"' : ''}>${g.svg()}</g>`).join('');

  // A standing person. hand: 'down' | 'raise' | 'wave'.
  function standing(ch, x, y, hand, bubbleSVG = '') {
    const b = new Grid(); hairBack(b, ch, x, y); legs(b, ch, x, y); torso(b, ch, x, y);
    const arm = armColor(ch), skin = ch.skin;
    const l = new Grid(); l.p(x + 1, y + 10, 1, 5, arm); l.set(x + 1, y + 15, skin);
    const r = new Grid();
    let moves = '';
    if (hand === 'wave') {
      r.p(x + 10, y + 9, 1, 2, arm);
      moves = frames(WAVE.map((rows) => sprite(rows, x + 11, y + 1, { a: arm, h: skin })));
    } else if (hand === 'raise') {
      r.set(x + 10, y + 9, arm); r.p(x + 11, y + 5, 1, 5, arm);
      const straight = new Grid(); straight.p(x + 12, y + 1, 1, 4, arm); straight.p(x + 12, y - 1, 2, 2, skin);
      const tilted = new Grid(); tilted.p(x + 12, y + 3, 1, 2, arm); tilted.p(x + 13, y + 1, 1, 2, arm); tilted.p(x + 13, y - 1, 2, 2, skin);
      moves = frames([straight, tilted]);
    } else { r.p(x + 10, y + 10, 1, 5, arm); r.set(x + 10, y + 15, skin); }
    const armR = `<g class="arm arm-r ${hand === 'wave' ? 'wave' : hand === 'raise' ? 'raise' : ''}">${r.svg()}${moves}</g>`;
    // A raised arm passes in front of hair, hats and earrings; a lowered one tucks behind them.
    return `${bubbleSVG}${b.svg()}<g class="arm arm-l">${l.svg()}</g>`
      + (hand === 'raise' || hand === 'wave' ? head(ch, x, y, false) + armR : armR + head(ch, x, y, false));
  }

  // A little sign over someone's head: ? (needs you), ! (alert), ✓ (done),
  // or a ? in the orchestrator's colour for a worker asking the boss.
  function bubble(kind, x, y, color = null) {
    const g = new Grid();
    if (kind === 'done') { g.box(x, y, 11, 9, DONE, WHITE); g.pat(CHECK, x + 2, y + 2, WHITE); }
    else { g.box(x, y, 9, 11, color || BLOCKED, WHITE); g.pat(kind === 'alert' ? BANG : QUESTION, kind === 'alert' ? x + 4 : x + 2, y + 2, color ? INK : WHITE); }
    return `<g class="bubble">${g.svg()}</g>`;
  }

  // ---- the desk ----

  const LED = { working: '#4f7cff', blocked: BLOCKED, alert: BLOCKED, done: DONE, idle: '#9aa3bd', unknown: '#6b7290' };

  function chair(boss, x = 15) {
    const g = new Grid();
    if (boss) { g.rr(x, 14, 14, 19, '#5b4f8f'); g.rr(x + 1, 15, 12, 17, '#6c63ff'); }
    else { g.rr(x + 1, 21, 12, 12, '#7d84a3'); g.rr(x + 2, 22, 10, 10, '#8f97b8'); }
    return g.svg();
  }

  // Desktop at y = 33 from x = 6 to 37, front panel with the nameplate, legs to y = 49.
  function deskFront(pose, name, opts) {
    const g = new Grid();
    const boss = !!opts.boss, top = boss ? BOSS_WOOD : WOOD, front = boss ? BOSS_DARK : WOOD_DARK;
    g.p(6, 33, 32, 2, top); g.p(6, 33, 32, 1, shade(top, 1.1));
    g.p(7, 35, 30, 11, front); g.p(7, 45, 30, 1, shade(front, 0.85));
    g.p(8, 46, 2, 4, front); g.p(34, 46, 2, 4, front);
    g.rr(9, 37, 26, 7, boss ? '#ffe08a' : '#fff6e8');
    const label = name ? `<text x="22" y="42.6" text-anchor="middle" font-family="${FONT}" font-size="5.8" font-weight="800" fill="${boss ? '#8a5a3c' : INK}">${name[0] + name.slice(1).toLowerCase()}</text>` : '';
    return g.svg() + label;
  }

  // Each character's own things: a mug in their color and one personal item
  // between the mug and the laptop (4×5 pixels at x 13, sitting on the desk).
  const MUGS = ['#ffffff', '#ff9eb5', '#9fd3ff', '#ffd166', '#a7e3b5', '#c9b3ff', '#ffb07a'];
  const ITEMS = [
    { name: 'plant', pal: { g: '#4fbf72', d: '#3a9e6a', p: '#e07a5f' }, rows: ['.gg.', 'gdgg', '.d..', 'pppp', '.pp.'] },
    { name: 'cactus', pal: { g: '#5cb85c', f: '#ff7aa8', p: '#c8644a' }, rows: ['.f..', '.gg.', 'ggg.', '.g..', 'ppp.'] },
    { name: 'duck', pal: { y: '#ffd23f', o: '#ff8c2e', k: '#2b2d42' }, rows: ['....', '.yk.', '.yyo', 'yyy.', 'yyy.'] },
    { name: 'books', pal: { r: '#e8606b', b: '#4f7cff', g: '#5cc46a', w: '#fff6e8' }, rows: ['....', 'rrr.', 'bbbb', 'wwww', 'gggg'] },
    { name: 'photo', pal: { k: '#8a5a3c', s: '#9fd3ff', h: '#5cc46a', u: '#ffd166' }, rows: ['kkkk', 'ksuk', 'khhk', 'kkkk', '.k..'] },
    { name: 'trophy', pal: { y: '#ffd166', d: '#d9a62e', b: '#8a5a3c' }, rows: ['y..y', 'yyyy', '.yd.', '.y..', 'bbb.'] },
    { name: 'cube', pal: { r: '#e8606b', g: '#5cc46a', b: '#4f7cff', y: '#ffd23f' }, rows: ['....', 'rgb.', 'ybr.', 'gry.', '....'] },
    { name: 'lamp', pal: { y: '#ffe08a', k: '#5a5d6e' }, rows: ['yyy.', 'yyy.', '.k..', '.k..', 'kkk.'] },
    { name: 'snowglobe', pal: { s: '#cdeeff', w: '#ffffff', t: '#3a9e6a', b: '#8a5a3c' }, rows: ['.ss.', 'swts', 'sttw', '.ss.', 'bbbb'] },
    { name: 'headphones', pal: { k: '#2b2d42', r: '#e8606b' }, rows: ['.kk.', 'k..k', 'k..k', 'r..r', 'r..r'] },
  ];
  const own = (list, character) => list[((character % list.length) + list.length) % list.length];

  // What sits on the desktop: mug, the person's own item, laptop, status
  // light, the orchestrator's flag, the boss's lamp. lid: 'open' (facing us)
  // | 'none'. opts.character: whose desk, for the mug and the item (none on
  // an empty desk).
  function deskTop(pose, opts, lid) {
    const g = new Grid();
    const mine = Number.isInteger(opts.character);
    const mug = mine ? own(MUGS, opts.character) : WHITE;
    if (!opts.phone) { g.p(9, 30, 3, 3, mug); g.set(12, 31, mug); g.p(9, 30, 3, 1, '#c08a5a'); }
    if (mine && !opts.boss && !opts.phone) {
      const item = own(ITEMS, opts.character);
      item.rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (item.pal[row[i]]) g.set(13 + i, 28 + j, item.pal[row[i]]); });
    }
    if (opts.boss) { g.p(29, 24, 6, 2, GOLD); g.p(30, 23, 4, 1, GOLD); g.p(31, 26, 1, 6, '#5a5d6e'); g.p(30, 32, 4, 1, '#5a5d6e'); }
    else if (opts.tag) { g.p(29, 26, 1, 7, '#5a5d6e'); g.p(30, 26, 3, 2, opts.tag); }
    if (LED[pose]) g.p(34, 31, 2, 2, LED[pose]);
    let glow = '';
    if (lid === 'open') {
      g.rr(18, 27, 8, 6, pose === 'empty' ? '#c9cfdc' : '#d5dbe8'); g.p(21, 29, 2, 2, WHITE);
      if (pose === 'working' && !opts.phone) glow = '<rect class="glow" x="19" y="27" width="6" height="1" fill="#9fd3ff"/>';
    }
    return g.svg() + glow + (pose === 'idle' && !opts.phone ? steam() : '') + (opts.phone ? phone(opts) : '');
  }

  // ---- the Slack watcher's red rotary phone, where the mug and item would be ----
  // Picks up when a check starts, talks with a "…" bubble, hangs up when it
  // ends; rings while a Slack message waits on the user. office.css plays the
  // pick-up and hang-up once and the ring in bursts.
  const ROTARY = { H: '#a8323f', h: '#c94a55', R: '#e8606b', r: '#c94a55', W: '#fff6e8', K: INK };
  const HANDSET = ['.HHHHHHH.', 'HHh...hHH'];
  const CRADLE = ['.........', '.R.....R.'];
  const BASE = ['.RRRRRRR.', 'RRRWWWRRR', 'RRWWKWWRR', 'rrrWWWrrr'];
  const HELD = ['.HH', 'HHH', '.HH', '.H.', '.H.', '.HH', 'HHH', '.HH'];
  const PHONE_X = 7, PHONE_Y = 27;
  const rotary = (rows, x, y) => sprite(rows, x, y, ROTARY).svg();

  // opts.offHook: the handset is in someone's hand. opts.ring: it rings.
  function phone(opts) {
    const base = rotary(BASE, PHONE_X, PHONE_Y + 2);
    if (opts.offHook) return base + rotary(CRADLE, PHONE_X, PHONE_Y);
    const handset = rotary(HANDSET, PHONE_X, PHONE_Y);
    if (!opts.ring) return base + `<g class="after-call">${handset}</g>`;
    const marks = new Grid();
    for (const x of [PHONE_X - 2, PHONE_X + 10]) { marks.set(x, PHONE_Y - 1, ROTARY.r); marks.set(x + (x < PHONE_X ? -1 : 1), PHONE_Y, ROTARY.r); marks.set(x, PHONE_Y + 1, ROTARY.r); }
    return `<g class="phone ring"><g class="ring-body">${base}<g class="ring-handset"><g class="after-call">${handset}</g></g></g><g class="ring-marks">${marks.svg()}</g></g>`;
  }

  // The near (left) arm: reaching for the handset on the cradle, lifting it,
  // or holding it to the ear. Sleeve pixels, then the hand's top-left corner.
  const PHONE_ARM = {
    reach: [[[17, 27], [16, 27], [15, 28], [14, 28]], [12, 27]],
    lift: [[[17, 27], [16, 27], [15, 26], [15, 25]], [14, 23]],
    ear: [[[17, 27], [16, 27], [15, 27], [14, 26], [13, 25], [13, 24]], [13, 22]],
  };
  function phoneArm(ch, pose) {
    const [sleeve, [hx, hy]] = PHONE_ARM[pose], g = new Grid();
    for (const [x, y] of sleeve) g.set(x, y, armColor(ch));
    g.p(hx, hy, 2, 2, ch.skin);
    const handset = pose === 'reach' ? rotary(HANDSET, PHONE_X, PHONE_Y) : pose === 'lift' ? rotary(HANDSET, PHONE_X + 3, PHONE_Y - 4) : rotary(HELD, 14, 19);
    return handset + g.svg();
  }
  // The far hand rests on the desk beside the laptop.
  function restingHand(ch, x, y) {
    const g = new Grid(); g.p(x + 10, y + 10, 1, 3, armColor(ch)); g.p(x + 9, y + 13, 2, 2, ch.skin);
    return g.svg();
  }
  function uprightBody(ch, x, y) {
    const b = new Grid(); hairBack(b, ch, x, y); torso(b, ch, x, y);
    return b.svg() + head(ch, x, y, false);
  }

  // On a call: the pick-up plays once (f1 reach, f2 lift), then the handset
  // stays at the ear, the mouth moves and the bubble's dots fill in.
  function onCall(ch, name, opts) {
    const x = 16, y = 17;
    const mouth = new Grid(); mouth.p(x + 5, y + 7, 2, 2, '#7a2f3f');
    const bubble = new Grid(); bubble.box(29, 11, 9, 5, WHITE, '#9aa3bd'); bubble.set(31, 13, '#5a5d6e');
    const dot = (i) => `<g class="dot d${i}"><rect x="${29 + i * 2}" y="13" width="1" height="1" fill="#5a5d6e"/></g>`;
    return chair(false)
      + `<g class="person pose-working on-call">${uprightBody(ch, x, y)}<g class="talk" visibility="hidden">${mouth.svg()}</g></g>`
      + deskFront('working', name, opts) + deskTop('working', { ...opts, offHook: true }, 'open') + restingHand(ch, x, y)
      + `<g class="pick-up"><g class="frame f1" visibility="hidden">${phoneArm(ch, 'reach')}</g><g class="frame f2" visibility="hidden">${phoneArm(ch, 'lift')}</g>`
      + `<g class="frame at-ear">${phoneArm(ch, 'ear')}<g class="call-bubble">${bubble.svg()}${dot(2)}${dot(3)}</g></g></g>`;
  }

  // After a call the idle scene opens with the hang-up, played once: upright,
  // the handset coming down (f1) and set on the cradle (f2).
  function hangUp(ch, pose, name, opts) {
    const x = 16, y = 17, s = seated(pose, ch);
    return `<g class="hung-up">${chair(false)}<g class="after-call">${s.person}</g><g class="hang-up" visibility="hidden">${uprightBody(ch, x, y)}</g>`
      + deskFront(pose, name, opts) + deskTop(pose, opts, 'open') + s.hands
      + `<g class="hang-up" visibility="hidden">${restingHand(ch, x, y)}<g class="frame f1" visibility="hidden">${phoneArm(ch, 'lift')}</g><g class="frame f2" visibility="hidden">${phoneArm(ch, 'reach')}</g></g></g>`;
  }

  // Steam over the mug: two pixels office.css lets drift upward.
  function steam() {
    return `<g class="steam"><rect x="10" y="28" width="1" height="1" fill="#ffffff" opacity=".85"/><rect x="9" y="27" width="1" height="1" fill="#ffffff" opacity=".5"/></g>`;
  }

  // Someone sitting behind the desk, x = 16. Working types (the hands go up
  // and down), unknown rests its hands, idle leans back with its hands behind
  // its head and its eyes shut.
  function seated(pose, ch) {
    const x = 16, idle = pose === 'idle', y = idle ? 18 : 17;
    const b = new Grid(); hairBack(b, ch, x, y); torso(b, ch, x, y);
    const arm = armColor(ch);
    const person = `<g class="person pose-${pose}">${b.svg()}${head(ch, x, y, idle)}`;
    if (idle) {
      const l = new Grid(); l.p(x, y + 3, 1, 8, arm); l.p(x - 1, y + 2, 2, 2, arm);
      const r = new Grid(); r.p(x + 11, y + 3, 1, 8, arm); r.p(x + 11, y + 2, 2, 2, arm);
      return { person: `${person}<g class="arm arm-l">${l.svg()}</g><g class="arm arm-r">${r.svg()}</g></g>`, hands: '' };
    }
    const hand = (ax, hx) => {
      const still = new Grid(); still.p(ax, y + 10, 1, 2, arm);
      const down = new Grid(); down.set(ax, y + 12, arm); down.p(hx, y + 13, 2, 2, ch.skin);
      const up = new Grid(); up.p(hx, y + 12, 2, 2, ch.skin);
      return still.svg() + frames([down, up]);
    };
    return { person: `${person}</g>`, hands: `<g class="hands"><g class="arm arm-l">${hand(x + 1, x + 1)}</g><g class="arm arm-r">${hand(x + 10, x + 9)}</g></g>` };
  }

  // Code a working agent streams up beside its head (office.css moves it).
  // CODE_X keeps it one pixel clear of the widest hair or hat while the head sways.
  const CODE_X = 31;
  const CODE_LINES = [
    [[0, 2, '#3f6ae0'], [3, 4, '#e8606b']],
    [[1, 5, '#f29a2e']],
    [[0, 3, '#3fae4f'], [4, 3, '#3f6ae0']],
    [[1, 2, '#e8606b'], [4, 3, '#8a5cf0']],
  ];
  function code() {
    return CODE_LINES.map((runs, i) => `<g class="code-line l${i + 1}">${runs.map(([dx, w, c]) => `<rect x="${CODE_X + dx}" y="21" width="${w}" height="1" fill="${c}"/>`).join('')}</g>`).join('');
  }

  function scene(pose, ch, name, opts) {
    const boss = !!opts.boss;
    if (!ch || pose === 'empty' || pose === 'away') {
      return chair(boss) + deskFront(pose, name, opts) + deskTop(pose, opts, 'open');
    }
    if (pose === 'done') {
      // up on the desk, waving
      return deskFront(pose, name, opts) + deskTop(pose, opts, 'none')
        + `<g class="person pose-done">${standing(ch, 16, 13, 'wave', bubble('done', 31, 3))}</g>`;
    }
    if (pose === 'blocked' || pose === 'alert') {
      // on their feet behind the desk, hand up; the chair pushed back
      return chair(boss, 3)
        + `<g class="person pose-${pose}">${standing(ch, 16, 15, 'raise', bubble(pose, 32, 2))}</g>`
        + deskFront(pose, name, opts) + deskTop(pose, opts, 'none');
    }
    if (opts.phone && pose === 'working') return onCall(ch, name, opts);
    if (opts.phone && opts.hangUp && (pose === 'idle' || pose === 'unknown')) return hangUp(ch, pose, name, opts);
    const s = seated(pose, ch);
    return chair(boss) + s.person + deskFront(pose, name, opts) + deskTop(pose, opts, 'open') + s.hands + (pose === 'working' ? code() : '');
  }

  // A worker standing in the boss's room with a question bubble in the
  // orchestrator's colour.
  window.figureOfficeVisitorSVG = function figureOfficeVisitorSVG(character = 0, color = '#f2c531') {
    const chars = window.CHARACTERS || [];
    const n = chars.length || 1;
    const ch = chars[((character % n) + n) % n];
    if (!ch) return '';
    return `<svg class="figure figure-office visitor" viewBox="0 0 27 33" width="${27 * U}" height="${33 * U}" shape-rendering="crispEdges" aria-hidden="true"><g class="person pose-asking">${standing(ch, 2, 12, 'raise', bubble('question', 17, 2, color))}</g></svg>`;
  };

  window.CHARACTER_NAMES = NAMES;
  window.DESK_ITEMS = ITEMS.map((x) => x.name);
  window.figureOfficeSVG = function figureOfficeSVG(pose, character = 0, opts = {}) {
    const chars = window.CHARACTERS || [];
    const n = chars.length || 1;
    const ch = chars[((character % n) + n) % n];
    const name = pose === 'empty' || !ch ? '' : NAMES[((character % NAMES.length) + NAMES.length) % NAMES.length];
    // A desk with someone at it (or out at the boss) has their own mug and item.
    const deskOpts = ch && pose !== 'empty' ? { ...opts, character } : opts;
    return `<svg class="figure figure-office" viewBox="0 0 ${W} ${H}" width="${W * U}" height="${H * U}" shape-rendering="crispEdges" aria-hidden="true">
      ${scene(pose, ch, name, deskOpts)}
    </svg>`;
  };
})();
