// Pixel-art desk + person for the "office" layout, in the same chibi style as
// the welcome tour (scenes.js): round heads, blush, a little smile, sitting
// behind a wooden desk with a laptop. Same characters as figure.js
// (window.CHARACTERS), drawn on a 44x54 unit grid at 3 screen px per unit.
// Working, idle and unknown sit behind the desk; blocked and alert stand up
// with a hand raised; done climbs onto the desk to wave.
// Groups carry class names (.person, .head, .arm-l, .arm-r, .bubble, .glow,
// .steam) so office.css can animate them.
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

  // A standing person. hand: 'down' | 'raise' | 'wave'.
  function standing(ch, x, y, hand, bubbleSVG = '') {
    const b = new Grid(); hairBack(b, ch, x, y); legs(b, ch, x, y); torso(b, ch, x, y);
    const arm = armColor(ch);
    const l = new Grid(); l.p(x + 1, y + 10, 1, 5, arm); l.set(x + 1, y + 15, ch.skin);
    const r = new Grid();
    if (hand === 'wave') { r.p(x + 10, y + 9, 1, 2, arm); r.p(x + 11, y + 4, 1, 6, arm); r.p(x + 11, y + 2, 2, 2, ch.skin); }
    else if (hand === 'raise') { r.set(x + 10, y + 9, arm); r.p(x + 11, y + 1, 1, 9, arm); r.p(x + 11, y - 1, 2, 2, ch.skin); }
    else { r.p(x + 10, y + 10, 1, 5, arm); r.set(x + 10, y + 15, ch.skin); }
    return `${bubbleSVG}${b.svg()}<g class="arm arm-l">${l.svg()}</g>`
      + `<g class="arm arm-r ${hand === 'wave' ? 'wave' : hand === 'raise' ? 'raise' : ''}">${r.svg()}</g>${head(ch, x, y, false)}`;
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

  // What sits on the desktop: mug, laptop, status light, the orchestrator's
  // flag, the boss's lamp. lid: 'open' (facing us) | 'none'.
  function deskTop(pose, opts, lid) {
    const g = new Grid();
    g.p(9, 30, 3, 3, WHITE); g.set(12, 31, WHITE); g.p(9, 30, 3, 1, '#c08a5a');
    if (opts.boss) { g.p(29, 24, 6, 2, GOLD); g.p(30, 23, 4, 1, GOLD); g.p(31, 26, 1, 6, '#5a5d6e'); g.p(30, 32, 4, 1, '#5a5d6e'); }
    else if (opts.tag) { g.p(29, 26, 1, 7, '#5a5d6e'); g.p(30, 26, 3, 2, opts.tag); }
    if (LED[pose]) g.p(34, 31, 2, 2, LED[pose]);
    let glow = '';
    if (lid === 'open') {
      g.rr(18, 27, 8, 6, pose === 'empty' ? '#c9cfdc' : '#d5dbe8'); g.p(21, 29, 2, 2, WHITE);
      if (pose === 'working') glow = '<rect class="glow" x="19" y="27" width="6" height="1" fill="#9fd3ff"/>';
    }
    return g.svg() + glow + (pose === 'idle' ? steam() : '');
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
    const l = new Grid(); l.p(x + 1, y + 10, 1, 3, arm); l.p(x + 1, y + 13, 2, 2, ch.skin);
    const r = new Grid(); r.p(x + 10, y + 10, 1, 3, arm); r.p(x + 9, y + 13, 2, 2, ch.skin);
    return { person: `${person}</g>`, hands: `<g class="hands"><g class="arm arm-l">${l.svg()}</g><g class="arm arm-r">${r.svg()}</g></g>` };
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
    const s = seated(pose, ch);
    return chair(boss) + s.person + deskFront(pose, name, opts) + deskTop(pose, opts, 'open') + s.hands;
  }

  // A worker standing in the boss's room with a question bubble in the
  // orchestrator's colour.
  window.figureOfficeVisitorSVG = function figureOfficeVisitorSVG(character = 0, color = '#f2c531') {
    const chars = window.CHARACTERS || [];
    const n = chars.length || 1;
    const ch = chars[((character % n) + n) % n];
    if (!ch) return '';
    return `<svg class="figure figure-office visitor" viewBox="0 0 27 33" width="${27 * U}" height="${33 * U}" shape-rendering="crispEdges" aria-hidden="true"><g class="person pose-asking">${standing(ch, 2, 12, 'raise', bubble('question', 16, 2, color))}</g></svg>`;
  };

  window.CHARACTER_NAMES = NAMES;
  window.figureOfficeSVG = function figureOfficeSVG(pose, character = 0, opts = {}) {
    const chars = window.CHARACTERS || [];
    const n = chars.length || 1;
    const ch = chars[((character % n) + n) % n];
    const name = pose === 'empty' || !ch ? '' : NAMES[((character % NAMES.length) + NAMES.length) % NAMES.length];
    return `<svg class="figure figure-office" viewBox="0 0 ${W} ${H}" width="${W * U}" height="${H * U}" shape-rendering="crispEdges" aria-hidden="true">
      ${scene(pose, ch, name, opts)}
    </svg>`;
  };
})();
