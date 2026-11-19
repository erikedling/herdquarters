// Move HQ art: each location's walls, floor, windows, door, plants, props,
// idle animation, the hat everyone wears, the pets' touches, the dart board
// and the settings card preview, all as pixel grids. set(id) puts the
// location's CSS in one <style> and data-location on <body>; office.css and
// the location's CSS do the rest, so nothing runs per frame.
(function () {
  const INK = '#2b2d42', WHITE = '#ffffff';
  const mod = (a, n) => ((a % n) + n) % n;

  // A pixel grid. A colour may carry an opacity: '#ffffff@0.5'.
  class P {
    constructor(w, h) { this.w = w; this.h = h; this.m = new Map(); }
    set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) { if (c) this.m.set(y * this.w + x, c); else this.m.delete(y * this.w + x); } return this; }
    get(x, y) { return this.m.get(y * this.w + x); }
    rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); return this; }
    disc(cx, cy, r, c) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if ((x + .5 - cx) ** 2 + (y + .5 - cy) ** 2 <= r * r) this.set(x, y, c); return this; }
    ring(cx, cy, r0, r1, c) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) { const d = Math.hypot(x + .5 - cx, y + .5 - cy); if (d >= r0 && d <= r1) this.set(x, y, c); } return this; }
    pat(rows, x, y, pal) { rows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (pal[row[i]] !== undefined) this.set(x + i, y + j, pal[row[i]]); }); return this; }
    rects(dx = 0, dy = 0) {
      const out = [];
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w;) {
        const c = this.get(x, y);
        if (!c) { x++; continue; }
        let n = 1;
        while (x + n < this.w && this.get(x + n, y) === c) n++;
        const [fill, op] = c.split('@');
        out.push(`<rect x="${x + dx}" y="${y + dy}" width="${n}" height="1" fill="${fill}"${op ? ` fill-opacity="${op}"` : ''}/>`);
        x += n;
      }
      return out.join('');
    }
    svg(scale = 3) { return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w * scale}" height="${this.h * scale}" viewBox="0 0 ${this.w} ${this.h}" shape-rendering="crispEdges">${this.rects()}</svg>`; }
    uri(scale = 3) { return `url("data:image/svg+xml,${encodeURIComponent(this.svg(scale))}")`; }
  }

  // ---- the pets' heads, per pose, in the 18×18 animal sprite (animals.js) ----
  // x, y: top-left of the head; w: its width; eyes: [x...] on row ey; side:
  // seen from the side, facing right; neck: [x, y, w, h].
  const HEADS = {
    cat: {
      sit: { x: 4, y: 8, w: 8, eyes: [6, 9], ey: 11, neck: [5, 14, 6, 1] },
      nap: { x: 10, y: 11, w: 5, eyes: [11, 13], ey: 14, side: true, neck: [10, 13, 1, 3] },
      walk: { x: 12, y: 9, w: 5, eyes: [14], ey: 11, side: true, neck: [12, 12, 1, 2] },
    },
    dog: {
      sit: { x: 5, y: 7, w: 7, eyes: [6, 10], ey: 9, neck: [6, 14, 5, 1] },
      lie: { x: 11, y: 12, w: 4, eyes: [13], ey: 13, side: true, neck: [11, 15, 2, 1] },
      walk: { x: 13, y: 9, w: 4, eyes: [15], ey: 10, side: true, neck: [13, 12, 2, 1] },
    },
  };
  // Kinds drawn beneath the pet rather than on it.
  const UNDER = new Set(['towel']);
  // Coffeehouse headphones: a mint band reads on every hair colour, dark cups
  // on every skin tone and against the cream walls.
  const PHONES = { band: '#8fd6b4', shine: '#c9f2de', cup: '#2f2a30', glint: '#5a5d6e', cushion: '#5aa888' };
  // What a pet can wear: (grid, head) => draws it.
  const PET = {
    sunhat(p, h) { p.rect(h.x, h.y - 2, h.w, 2, '#f3d68a').rect(h.x, h.y - 1, h.w, 1, '#e8606b').rect(h.x - 1, h.y, h.w + 2, 1, '#f3d68a'); },
    daisy(p, h) { const x = h.x + h.w - 1; p.set(x, h.y - 2, WHITE).set(x - 1, h.y - 1, WHITE).set(x + 1, h.y - 1, WHITE).set(x, h.y, WHITE).set(x, h.y - 1, '#ffd23f'); },
    helmet(p, h) {
      const cx = h.x + h.w / 2, cy = h.ey, r = Math.max(h.w / 2 + 1.5, 4);
      p.disc(cx, cy, r - 1, '#e6f7ff@0.22').ring(cx, cy, r - 1, r, '#bfe8ff@0.95');
      p.set(cx - r / 2, cy - r / 2 - 1, WHITE);
    },
    shades(p, h) {
      if (h.side) { p.rect(h.eyes[0] - 1, h.ey, 3, 1, '#22232b').rect(h.x - 1, h.ey, h.eyes[0] - h.x, 1, '#22232b'); return; }
      const [a, b] = h.eyes;
      p.rect(a - 2, h.ey, b - a + 5, 1, '#22232b').rect(a - 1, h.ey + 1, 3, 1, '#22232b').rect(b - 1, h.ey + 1, 3, 1, '#22232b');
      p.set(a - 1, h.ey, '#6c7290').set(b - 1, h.ey, '#6c7290');
    },
    towel(p) { for (let x = 1; x < 17; x++) p.rect(x, 16, 1, 3, ['#e8606b', WHITE, '#4fb3c9', WHITE][mod(Math.floor((x - 1) / 2), 4)]); },
    collar(p, h) { const [x, y, w, hh] = h.neck; p.rect(x, y, w, hh, '#e23b3b'); p.set(x + Math.floor(w / 2), y + hh, '#ffd23f'); },
    antlers(p, h) { const l = h.x, r = h.x + h.w - 1; for (const x of h.side ? [l + 1] : [l, r]) { p.rect(x, h.y - 3, 1, 3, '#a8693f'); p.set(x - 1, h.y - 3, '#a8693f').set(x + 1, h.y - 2, '#a8693f'); } },
    bubbles(p, h) { const x = h.side ? h.x + h.w + 1 : h.x - 2; p.ring(x + .5, h.ey - 1, .5, 1.4, '#e8fbff').set(x + 1, h.ey - 4, '#e8fbff').set(x - 1, h.ey - 6, '#e8fbff@0.7'); },
    crown(p, h) { ['#ff9eb5', '#ffd23f', WHITE, '#8a6ad6'].forEach((c, i) => { for (let x = h.x + i; x < h.x + h.w; x += 4) p.set(x, h.y - 1, c); }); },
    witch(p, h) { const k = '#2b2140', m = h.x + Math.floor(h.w / 2); p.rect(h.x - 1, h.y - 1, h.w + 2, 1, k).rect(m - 2, h.y - 2, 4, 1, '#8a5cf0').rect(m - 1, h.y - 3, 3, 1, k).rect(m - 1, h.y - 4, 2, 1, k).set(m + 1, h.y - 5, k); },
    pumpkin(p, h) { const [x, y] = h.neck; p.rect(x, y, 2, 2, '#ff8c2e').set(x + 1, y, INK); },
    headphones(p, h) {
      const { band, cup } = PHONES;
      if (h.side) { p.rect(h.x, h.y - 1, h.w, 1, band).rect(h.x - 1, h.ey - 1, 2, 2, cup); return; }
      p.rect(h.x + 1, h.y - 1, h.w - 2, 1, band).rect(h.x - 1, h.y, 1, h.ey - 1 - h.y, band).rect(h.x + h.w, h.y, 1, h.ey - 1 - h.y, band);
      p.rect(h.x - 1, h.ey - 1, 2, 3, cup).rect(h.x + h.w - 1, h.ey - 1, 2, 3, cup);
    },
    scarf(p, h) { const [x, y, w, hh] = h.neck; p.rect(x, y, w, hh, '#e8606b'); p.set(x, y + hh, '#e8606b').set(x + 1, y + hh + 1, '#e8606b'); },
  };

  // ---------------- the locations ----------------
  // frames: how many window (and door, prop) frames loop, every ms.
  const ART = {};

  ART.garden = {
    frame: '#8a6a4f', skirting: '#6fb35f', frames: 4, ms: 260,
    wall() {
      const p = new P(6, 30);
      p.rect(0, 0, 6, 12, '#bfe3ff').rect(0, 9, 6, 3, '#cfeaff');
      p.rect(0, 12, 6, 18, '#5fae5a').set(5, 13, '#4f9e4c').set(1, 16, '#4f9e4c');
      p.rect(1, 12, 4, 18, WHITE).rect(4, 12, 1, 18, '#e3e7ee').rect(2, 10, 2, 2, WHITE);
      p.rect(0, 16, 6, 1, '#f2f2ea').rect(0, 24, 6, 1, '#f2f2ea').rect(0, 28, 6, 2, '#7ccf6a');
      return p;
    },
    // A rose trellis on the fence; a butterfly flutters along it.
    window(f) {
      const p = new P(24, 17);
      for (let y = 0; y < 17; y++) for (let x = 0; x < 24; x++) if (mod(x + y, 6) === 0 || mod(x - y, 6) === 0) p.set(x, y, '#c49a6c');
      p.rect(0, 0, 24, 1, '#a8743f').rect(0, 16, 24, 1, '#a8743f').rect(0, 0, 1, 17, '#a8743f').rect(23, 0, 1, 17, '#a8743f');
      for (const [x, y] of [[2, 15], [3, 13], [4, 12], [5, 10], [7, 9], [8, 7], [10, 6], [12, 5], [14, 6], [16, 5], [18, 4], [19, 2], [21, 3]]) p.set(x, y, '#3a9e6a').set(x + 1, y, '#4fbf72');
      for (const [x, y] of [[3, 12], [9, 6], [15, 4], [20, 2], [6, 9]]) p.rect(x, y, 2, 2, '#ff7aa8').set(x, y, '#ffb3cc');
      const bx = [6, 9, 12, 9][f], by = [12, 10, 11, 9][f];
      p.rect(bx, by, 1, 3, INK);
      if (f % 2 === 0) p.rect(bx - 2, by - 1, 2, 2, '#ffb02e').rect(bx + 1, by - 1, 2, 2, '#ffb02e').set(bx - 2, by + 1, '#ff7a3d').set(bx + 2, by + 1, '#ff7a3d');
      else p.rect(bx - 1, by - 1, 1, 2, '#ffb02e').rect(bx + 1, by - 1, 1, 2, '#ffb02e');
      return p;
    },
    door() {
      const p = new P(18, 27);
      p.rect(0, 0, 18, 27, '#8a5a3c').rect(1, 1, 16, 26, '#6fa86a');
      for (const x of [5, 9, 13]) p.rect(x, 1, 1, 26, '#5a9256');
      p.rect(1, 6, 16, 2, '#5a9256').rect(1, 20, 16, 2, '#5a9256');
      for (let i = 0; i < 12; i++) p.set(3 + i, 19 - i, '#5a9256');
      p.pat(['.rr.rr.', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'], 6, 10, { r: '#ffb3cc' }).rect(14, 15, 2, 2, '#ffd23f');
      return p;
    },
    floor() {
      const p = new P(16, 16);
      p.rect(0, 0, 16, 16, '#8fd47a');
      for (const [x, y] of [[2, 3], [9, 1], [13, 8], [5, 11], [11, 14], [0, 8]]) p.set(x, y, '#7cc46a').set(x, y - 1, '#7cc46a');
      return p.set(7, 6, WHITE).set(14, 12, '#ffd23f').set(3, 14, '#ff9eb5');
    },
    plant() {
      const p = new P(9, 15);
      p.rect(2, 11, 5, 4, '#e07a5f').rect(1, 11, 7, 1, '#c8644a');
      p.rect(4, 5, 1, 6, '#3a9e6a').rect(2, 7, 2, 1, '#4fbf72').rect(5, 8, 2, 1, '#4fbf72');
      return p.disc(4.5, 3, 3, '#ffd23f').disc(4.5, 3, 1.5, '#8a5a32').set(4, 2, '#a8743f');
    },
    // Flowers in the floor's bottom corners and a butterfly over the rooms.
    fx() {
      const flower = (c) => new P(3, 5).set(1, 0, c).set(0, 1, c).set(2, 1, c).set(1, 1, '#ffd23f').rect(1, 2, 1, 3, '#3a9e6a');
      return {
        layers: [[flower('#ff7aa8'), 'left 4px bottom 16px'], [flower(WHITE), 'left 16px bottom 4px'], [flower('#ffd23f'), 'right 4px bottom 18px'], [flower('#ff7aa8'), 'right 18px bottom 4px']],
        after: { art: (f) => { const p = new P(5, 3).rect(2, 0, 1, 3, INK); return f ? p.rect(1, 0, 1, 2, '#ff9a4a').rect(3, 0, 1, 2, '#ff9a4a') : p.rect(0, 0, 2, 2, '#ff9a4a').rect(3, 0, 2, 2, '#ff9a4a'); }, frames: 2, ms: 160,
          at: 'top: 6px; left: 30%;', path: 'loc-flutter 14s steps(70) infinite' },
      };
    },
    wear(x, y) {
      const p = new P(44, 54);
      p.rect(x - 2, y + 1, 16, 1, '#f3d68a').rect(x - 1, y + 2, 14, 1, '#d9b86a');
      p.rect(x + 2, y - 2, 8, 3, '#f3d68a').rect(x + 3, y - 3, 6, 1, '#f3d68a').rect(x + 2, y, 8, 1, '#e8606b');
      return p.set(x + 9, y - 1, WHITE).set(x + 10, y - 1, '#ffd23f');
    },
    pets: { cat: ['daisy'], dog: ['sunhat'] },
    board: {
      rim: ({ a }) => (mod(a * 16 / (Math.PI * 2), 1) < .5 ? '#ffd23f' : '#f3b53a'), edge: '#3a9e6a',
      bull: '#5a3a22', outerBull: '#8a5a32', light: '#fff3b8', dark: '#7ccf6a', alt1: '#ff7aa8', alt2: '#ffd23f',
    },
  };

  ART.space = {
    frame: '#7d879d', skirting: '#5ff2ff', frames: 20, ms: 220,
    css: (sel) => `${sel} .floor-label { box-shadow: 0 4px 10px -2px #5ff2ff; }`,
    wall() {
      const p = new P(14, 10);
      p.rect(0, 0, 14, 10, '#4a5368').rect(0, 0, 14, 1, '#5d6882').rect(0, 0, 1, 10, '#5d6882').rect(0, 9, 14, 1, '#323849').rect(13, 0, 1, 10, '#323849');
      for (const [x, y] of [[2, 2], [11, 2], [2, 7], [11, 7]]) p.set(x, y, '#8d97ad');
      return p;
    },
    floor() { return new P(12, 12).rect(0, 0, 12, 12, '#262c3d').rect(0, 0, 12, 1, '#36425f').rect(0, 0, 1, 12, '#36425f').set(0, 0, '#5ff2ff').set(6, 6, '#3c4a6a'); },
    // Stars drift past a ringed planet.
    window(f) {
      const p = new P(24, 17);
      p.rect(1, 0, 22, 17, '#8d97ad').rect(0, 1, 24, 15, '#8d97ad');
      p.rect(2, 2, 20, 13, '#0b1030').rect(3, 1, 18, 15, '#0b1030').rect(1, 3, 22, 11, '#0b1030');
      p.rect(1, 1, 22, 1, '#8d97ad').set(2, 2, '#8d97ad').set(21, 2, '#8d97ad').set(2, 14, '#8d97ad').set(21, 14, '#8d97ad');
      const stars = [[3, 4], [7, 9], [10, 3], [13, 12], [5, 12], [18, 4], [20, 11], [9, 6], [15, 2]];
      for (const [i, [x, y]] of stars.entries()) p.set(2 + mod(x - 2 - f, 20), y, i % 3 ? WHITE : '#9fc4ff');
      const px = 15;
      p.disc(px, 9.5, 3.2, '#ff9e6b');
      for (let y = 7; y < 13; y++) for (let x = px - 4; x < px + 4; x++) if (p.get(x, y) === '#ff9e6b' && x + y > px + 10) p.set(x, y, '#e0703f');
      for (let x = px - 5; x <= px + 4; x++) if (p.get(x, 9) !== '#ff9e6b' || x < px - 2 || x > px + 1) p.set(x, x < px ? 10 : 9, '#ffd9a8');
      p.set(px - 1, 8, '#ffc9a0');
      for (const [x, y] of [[1, 2], [22, 2], [1, 14], [22, 14]]) p.set(x, y, '#c9d1e0');
      return p;
    },
    door() {
      const p = new P(18, 27);
      p.rect(0, 0, 18, 27, '#5d667c').rect(1, 1, 16, 26, '#a7b0c4').rect(1, 1, 16, 1, '#c3cad8').rect(8, 2, 2, 25, '#5d667c');
      for (let y = 21; y < 26; y++) for (let x = 1; x < 17; x++) if (x < 8 || x > 9) p.set(x, y, mod(x + y, 4) < 2 ? '#ffd23f' : INK);
      p.disc(9, 9, 3.6, '#5d667c').disc(9, 9, 2.6, '#0b1030').set(8, 8, WHITE).set(10, 10, '#9fc4ff');
      return p.rect(7, 0, 4, 1, '#5ff2ff').rect(14, 13, 2, 2, '#3fdc7a');
    },
    plant() {
      const p = new P(9, 12);
      p.rect(1, 9, 7, 3, '#8d97ad').rect(1, 10, 7, 1, '#5ff2ff').rect(0, 9, 9, 1, '#6c768c');
      p.rect(2, 2, 5, 7, '#dff4ff@0.55').rect(1, 4, 7, 5, '#dff4ff@0.55').rect(3, 1, 3, 1, '#bfe8ff');
      p.set(2, 1, '#bfe8ff').set(6, 1, '#bfe8ff').rect(1, 2, 1, 2, '#bfe8ff').rect(7, 2, 1, 2, '#bfe8ff').rect(0, 4, 1, 5, '#bfe8ff').rect(8, 4, 1, 5, '#bfe8ff');
      p.rect(4, 4, 1, 5, '#3a9e6a').rect(2, 5, 2, 1, '#4fbf72').rect(5, 4, 2, 1, '#4fbf72').rect(2, 7, 2, 1, '#4fbf72').rect(5, 6, 2, 1, '#4fbf72');
      return p.set(3, 2, WHITE).set(2, 3, WHITE);
    },
    wear(x, y) {
      const p = new P(44, 54);
      const cx = x + 6, cy = y + 3.5;
      for (let j = 0; j <= y + 8; j++) for (let i = 0; i < 44; i++) {
        const d = Math.hypot(i + .5 - cx, j + .5 - cy);
        if (d <= 8.2 && d > 7.2) p.set(i, j, '#bfe8ff@0.95'); else if (d <= 7.2) p.set(i, j, '#e6f7ff@0.22');
      }
      for (const [i, j] of [[-4, -4], [-5, -3], [-5, -2], [-3, -5]]) p.set(cx + i, cy + j, WHITE);
      return p.rect(x + 1, y + 9, 10, 1, '#c9d1e0').rect(x + 2, y + 10, 8, 1, '#8d97ad');
    },
    pets: { cat: ['helmet'], dog: ['helmet'] },
    board: {
      rim: ({ a }) => (Math.abs(mod(a * 8 / (Math.PI * 2), 1) - .5) < .09 ? INK : '#9aa3b8'), edge: '#5d667c',
      bull: '#ff5da2', outerBull: '#5ff2ff', light: '#dce6ff', dark: '#1b2340', alt1: '#ff5da2', alt2: '#5ff2ff',
    },
  };

  ART.beach = {
    frame: '#e9d3a3', skirting: '#f4b6c2', frames: 7, ms: 260,
    wall() { return new P(12, 10).rect(0, 0, 6, 10, '#bfe8f0').rect(6, 0, 6, 10, '#fffaf0').rect(5, 0, 1, 10, '#a6dbe6').rect(11, 0, 1, 10, '#efe6d4'); },
    // The open side of the hut: sea, sun and a palm. Waves roll in.
    window(f) {
      const p = new P(24, 17);
      p.rect(0, 0, 24, 17, WHITE).rect(0, 16, 24, 1, '#e6dcc6');
      p.rect(1, 1, 22, 7, '#9fdcff').rect(1, 1, 22, 2, '#bfe8ff').disc(18, 4.5, 2.4, '#ffe066').set(17, 3, '#fff6b8');
      p.rect(1, 8, 22, 5, '#3fb6d0').rect(1, 8, 22, 1, '#2f9ab8');
      for (const [row, dir, c] of [[9, 1, '#bff0f7'], [11, -1, '#e8fbff']]) for (let x = 1; x < 23; x++) if (mod(x + dir * f, 7) < 2) p.set(x, row, c);
      p.rect(1, 13, 22, 3, '#f6dea6');
      for (let y = 6; y < 15; y++) p.set(5 + (y < 10 ? 1 : 0), y, y % 2 ? '#a8743f' : '#8a5a32');
      p.pat(['..gg.gg...', '.g..gg..g.', 'g..gggg...', '..g.g.gg..', '.g..g...g.'], 1, 3, { g: '#3fae6a' });
      return p.set(6, 6, '#8a5a32').set(7, 7, '#c08a52').rect(0, 0, 24, 1, '#f4b6c2');
    },
    door() {
      const p = new P(18, 27);
      p.rect(0, 0, 18, 27, WHITE).rect(2, 2, 14, 25, '#f4a0a0').rect(3, 3, 12, 11, '#f4a0a0');
      for (let y = 4; y < 14; y += 2) p.rect(4, y, 10, 1, '#d97f86');
      p.rect(3, 15, 12, 10, '#f6b3b3').pat(['..o..', '.ooo.', 'ooooo', '.o.o.'], 6, 18, { o: '#ffb347' });
      return p.rect(13, 14, 2, 2, '#ffd23f');
    },
    floor() {
      const p = new P(28, 14);
      p.rect(0, 0, 28, 14, '#f2dfb8').rect(0, 0, 28, 6, '#efd9ae').rect(0, 6, 28, 1, '#dcc296').rect(0, 13, 28, 1, '#dcc296');
      p.rect(18, 0, 1, 6, '#e3cba0').rect(6, 7, 1, 6, '#e3cba0');
      return p.set(2, 3, '#d6bb8c').set(16, 3, '#d6bb8c').set(8, 10, '#d6bb8c').set(26, 10, '#d6bb8c');
    },
    plant() {
      const p = new P(11, 15);
      p.rect(3, 11, 5, 4, '#e9b07a').rect(2, 11, 7, 1, '#d6955c');
      for (let y = 5; y < 11; y++) p.set(5, y, y % 2 ? '#a8743f' : '#8a5a32');
      return p.pat(['...gg.gg...', '.gg..g..gg.', 'g...ggg...g', '...g.g.g...', '..g..g..g..'], 0, 1, { g: '#3fae6a' }).set(5, 3, '#57c27a').set(4, 2, '#57c27a');
    },
    // A surfboard leaning on the right-hand side of each room.
    plant2() {
      const p = new P(7, 17);
      p.rect(2, 0, 3, 1, '#ff9e6b').rect(1, 1, 5, 14, '#ff9e6b').rect(2, 15, 3, 1, '#ff9e6b');
      return p.rect(3, 1, 1, 14, WHITE).rect(1, 6, 5, 1, '#4fb3c9').rect(1, 7, 5, 1, WHITE).rect(6, 12, 1, 2, '#2f9ab8');
    },
    fx() {
      const cooler = new P(12, 9).rect(0, 1, 12, 8, '#4fb3c9').rect(0, 0, 12, 2, WHITE).rect(4, 0, 4, 1, '#c9d1e0').rect(0, 5, 12, 1, '#3a9ab8').rect(1, 7, 10, 1, '#3a9ab8');
      const ball = new P(7, 7).disc(3.5, 3.5, 3.5, WHITE);
      for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (ball.get(x, y)) { if (x < 3 && y < 4) ball.set(x, y, '#e8606b'); else if (x > 3 && y > 2) ball.set(x, y, '#4fb3c9'); }
      ball.set(3, 3, '#ffd23f');
      return { layers: [[cooler, 'left 2px top 40%', 2], [ball, 'right 6px top 30%', 2]] };
    },
    wear(x, y) {
      const p = new P(44, 54);
      p.rect(x + 1, y + 4, 10, 1, '#22232b').rect(x + 2, y + 5, 3, 2, '#22232b').rect(x + 7, y + 5, 3, 2, '#22232b');
      return p.set(x + 2, y + 5, '#6c7290').set(x + 7, y + 5, '#6c7290');
    },
    pets: { cat: ['towel'], dog: ['shades'] },
    // A parasol seen from above: panels from a wooden finial, seams at the
    // scoring rings, a scalloped edge.
    board: {
      paint({ d, a, rings, R }) {
        const panel = Math.floor(mod(a + Math.PI / 8, Math.PI * 2) * 8 / (Math.PI * 2)) % 2 ? '#e8606b' : WHITE;
        if (d <= rings[0].r) return '#8a5a32';
        if (d <= rings[1].r) return '#c08a52';
        if (d <= 1) return rings.some((r) => Math.abs(d * R - r.r * R) < .5) ? (panel === WHITE ? '#f0d8d8' : '#c94a55') : panel;
        const scallop = Math.abs(mod(a * 8 / (Math.PI * 2) + .5, 1) - .5) < .38 - (d - 1) * R * .12;
        return d <= 1 + 3 / R && scallop ? (panel === WHITE ? '#f3e4e4' : '#d94f5a') : null;
      },
    },
  };

  ART.north = {
    frame: '#8a5232', skirting: '#6b3d22', frames: 11, ms: 240,
    wall() {
      const p = new P(20, 7);
      p.rect(0, 0, 20, 7, '#a8693f').rect(0, 0, 20, 1, '#c4824f').rect(0, 5, 20, 1, '#8e5733').rect(0, 6, 20, 1, '#6b3d22');
      return p.rect(3, 2, 4, 1, '#96592f').rect(12, 3, 5, 1, '#96592f').set(9, 2, '#7e4a2a');
    },
    // Snow falls past a pine.
    window(f) {
      const p = new P(24, 17);
      p.rect(1, 0, 22, 17, '#7e4a2a').rect(0, 1, 24, 15, '#7e4a2a').rect(1, 1, 22, 15, '#a9d0f5').rect(1, 1, 22, 4, '#8fbde9');
      p.rect(1, 12, 22, 4, WHITE).rect(3, 11, 6, 1, WHITE).rect(14, 10, 7, 2, WHITE);
      p.pat(['..g..', '.ggg.', 'ggggg', '..b..'], 16, 6, { g: '#3a7d5a', b: '#7e4a2a' }).set(18, 6, WHITE);
      for (const [x, y] of [[3, 2], [8, 5], [6, 9], [14, 3], [20, 4], [11, 8], [19, 9], [4, 6]]) p.set(x, 1 + mod(y - 1 + f, 11), WHITE);
      p.rect(12, 0, 1, 17, '#7e4a2a').rect(0, 8, 24, 1, '#7e4a2a');
      return p.rect(1, 0, 22, 1, WHITE).rect(0, 16, 24, 1, WHITE).set(4, 1, WHITE).set(17, 1, WHITE);
    },
    door() {
      const p = new P(18, 27);
      p.rect(0, 0, 18, 27, '#8a5a3c').rect(1, 1, 16, 26, '#c08a52').rect(3, 15, 12, 9, '#d39b63').rect(13, 14, 2, 2, '#ffd66b');
      p.ring(9, 8, 2, 4.2, '#2e8b57');
      for (const [x, y] of [[6, 6], [11, 5], [12, 9], [6, 10], [9, 4]]) p.set(x, y, '#e23b3b');
      for (const [x, y] of [[7, 5], [5, 8], [12, 7], [10, 11]]) p.set(x, y, '#4fbf72');
      return p.pat(['rr.rr', '.rrr.', 'r.r.r'], 7, 11, { r: '#e23b3b' }).rect(0, 0, 18, 1, WHITE);
    },
    plant() {
      const p = new P(9, 12);
      p.rect(2, 10, 5, 2, '#c0392b').rect(1, 10, 7, 1, '#e23b3b').set(4, 9, '#7e4a2a');
      return p.pat(['....y....', '...ggg...', '..ggrgg..', '...ggg...', '..gggbg..', '.gyggggg.', '..ggggg..', '.gggggrg.', 'ggbggggyg'], 0, 0, { g: '#2e8b57', y: '#ffd23f', r: '#e23b3b', b: '#4f9cff' });
    },
    // A fireplace with two stockings beside the window; the fire flickers.
    prop: { frames: 3, ms: 180, art(f) {
      const p = new P(22, 22);
      p.rect(0, 0, 22, 3, '#7e4a2a').rect(0, 0, 22, 1, '#9a6440').rect(1, 3, 20, 19, '#9a8f8a');
      for (let y = 3; y < 22; y += 3) for (let x = (y / 3) % 2 ? 1 : 4; x < 21; x += 6) p.rect(x, y, 1, 3, '#7f7570');
      for (let y = 6; y < 22; y += 3) p.rect(1, y, 20, 1, '#7f7570');
      p.rect(5, 9, 12, 13, '#2b1a14').rect(6, 8, 10, 1, '#2b1a14').rect(6, 20, 10, 2, '#5a3a22');
      const fires = [
        ['..y...y...', '.yoy..yo..', '.yoryyoy..', 'yorrrooy..', 'yorrrrroy.'],
        ['....y.....', '...yoy.y..', '..yorrooy.', '.yorrrroy.', 'yorrrrrroy'],
        ['.y....y...', 'yoy..yoy..', 'yory.yoy..', 'yorryoroy.', 'yorrrrrroy'],
      ];
      p.pat(fires[f], 6, 15, { y: '#ffd166', o: '#ff8c2e', r: '#e8463b' });
      p.rect(3, 3, 3, 4, '#e23b3b').rect(3, 3, 3, 1, WHITE).rect(4, 7, 2, 1, '#e23b3b');
      return p.rect(16, 3, 3, 4, '#2e8b57').rect(16, 3, 3, 1, WHITE).rect(17, 7, 2, 1, '#2e8b57');
    } },
    wear(x, y) {
      const p = new P(44, 54);
      p.rect(x + 1, y - 1, 10, 2, '#e23b3b').rect(x + 2, y - 2, 8, 1, '#e23b3b').rect(x + 4, y - 3, 7, 1, '#e23b3b').rect(x + 8, y - 4, 4, 1, '#e23b3b').rect(x + 11, y - 3, 2, 3, '#e23b3b');
      p.rect(x + 2, y - 2, 2, 1, '#c22a2a').rect(x + 1, y - 1, 1, 2, '#c22a2a');
      return p.rect(x, y + 1, 12, 2, WHITE).rect(x, y + 2, 12, 1, '#e3e7f1').rect(x + 12, y, 2, 2, WHITE);
    },
    pets: { cat: ['collar'], dog: ['antlers'] },
    board: {
      rim: ({ x, y }) => (mod(x * 7 + y * 13, 9) === 0 ? '#e23b3b' : mod(x + y, 3) ? '#2e8b57' : '#3fae6a'), edge: '#1f5a3a',
      bull: '#e23b3b', outerBull: '#ffd23f', light: WHITE, dark: '#2e8b57', alt1: '#e23b3b', alt2: '#ffd23f',
    },
  };

  ART.water = {
    frame: '#3f8ea3', skirting: '#5aa9b8', frames: 12, ms: 300,
    wall() {
      const p = new P(16, 10).rect(0, 0, 16, 10, '#7fd0dc');
      for (const [x, y, w] of [[1, 2, 4], [5, 1, 3], [9, 6, 4], [13, 5, 3], [3, 8, 3]]) p.rect(x, y, w, 1, '#a6e3ea');
      return p.set(8, 3, '#6cc0cf').set(0, 6, '#6cc0cf');
    },
    floor() {
      const p = new P(10, 10).rect(0, 0, 10, 10, '#f1dcaa');
      for (const [x, y] of [[1, 1], [6, 3], [3, 6], [8, 8]]) p.set(x, y, '#e0c58a');
      for (const [x, y] of [[4, 2], [9, 5], [1, 8]]) p.set(x, y, '#fff0c8');
      return p;
    },
    // Fish swim past the porthole, a bubble rises.
    window(f) {
      const p = new P(24, 17);
      p.rect(1, 0, 22, 17, '#c99a4a').rect(0, 1, 24, 15, '#c99a4a');
      for (let y = 1; y < 16; y++) p.rect(1, y, 22, 1, y < 5 ? '#5cc0e8' : y < 10 ? '#3ea6d6' : '#2f8fc4');
      for (const [x, y] of [[1, 1], [22, 1], [1, 15], [22, 15]]) p.set(x, y, '#c99a4a');
      p.rect(1, 14, 22, 2, '#e8cf98');
      for (const x of [3, 4, 19]) p.rect(x, 10 + (x % 2), 1, 4 - (x % 2), '#3fae6a');
      p.pat(['.oo.o', 'oko.o', '.oooo'], mod(f * 2, 24) - 3, 6, { o: '#ff8c2e', k: INK });
      p.pat(['y.yy.', 'yyyky', 'y.yy.'], 23 - mod(f * 2 + 8, 24), 10, { y: '#ffd23f', k: INK });
      p.set(14, 13 - mod(f, 12), '#e8fbff');
      for (let y = 0; y < 17; y++) for (const x of [0, 23]) if (p.get(x, y) !== '#c99a4a') p.set(x, y, '#c99a4a');
      return p.rect(12, 1, 1, 13, '#c99a4a').rect(1, 1, 3, 1, '#ffd98a').set(1, 2, '#ffd98a');
    },
    door() {
      const p = new P(18, 27);
      p.rect(1, 0, 16, 27, '#5f7189').rect(0, 1, 18, 26, '#5f7189').rect(2, 2, 14, 25, '#7c8da3').rect(2, 2, 14, 1, '#97a6ba');
      p.disc(9, 9, 4.6, '#c99a4a').disc(9, 9, 3.6, '#3ea6d6').set(7, 7, WHITE).set(8, 6, '#e8fbff');
      for (const [x, y] of [[3, 3], [14, 3], [3, 25], [14, 25], [3, 14], [14, 14]]) p.set(x, y, '#c9d1e0');
      return p.ring(9, 19, 2, 3, '#c0392b').rect(6, 19, 7, 1, '#c0392b').rect(9, 16, 1, 7, '#c0392b').set(9, 19, '#ffd23f');
    },
    plant() {
      const p = new P(9, 12).rect(0, 10, 9, 2, '#e8cf98').rect(1, 9, 7, 1, '#e8cf98');
      const frond = (x, h, c) => { for (let j = 0; j < h; j++) p.set(x + (mod(j, 4) < 2 ? 0 : 1), 9 - j, c); };
      frond(1, 7, '#3fae6a'); frond(4, 9, '#2e9a5a'); frond(6, 6, '#6fd08f');
      return p;
    },
    // Coral and a starfish in the corners, bubbles rising up both sides.
    fx() {
      const pink = new P(9, 9).pat(['.p...p...', '.p.p.p.p.', '.ppp.pp..', '..p..p...', '..ppppp..', '....p....', '....p....', '...sss...', '..sssss..'], 0, 0, { p: '#ff7aa8', s: '#e8cf98' });
      const orange = new P(7, 8).pat(['o.o.o..', 'o.o.o.o', 'o.o.o.o', 'ooo.o.o', '.o.oooo', '.ooo.o.', '..ooo..', 'sssssss'], 0, 0, { o: '#ff9a4a', s: '#e8cf98' });
      const star = new P(7, 7).pat(['...s...', '...s...', 'sssssss', '.sssss.', '..sss..', '.ss.ss.', 's.....s'], 0, 0, { s: '#ff8c5a' });
      const bubbles = () => { const p = new P(8, 30); for (const [x, y, r] of [[2, 3, 1.6], [5, 13, 1.2], [2, 22, 1.6], [6, 27, 1]]) p.ring(x, y, r - .8, r, '#e8fbff@0.9').set(x - 1, y - 1, WHITE); return p; };
      return {
        layers: [[pink, 'left 2px bottom 12px'], [orange, 'right 2px bottom 14px'], [star, 'left 46% bottom 2px'], [orange, 'left 4px top 20px']],
        before: { art: bubbles, at: 'left: 4px; bottom: 30px;', path: 'loc-rise 5s steps(25) infinite' },
        after: { art: bubbles, at: 'right: 2px; bottom: 50px;', path: 'loc-rise 6s steps(30) infinite -2s' },
      };
    },
    wear(x, y) {
      const p = new P(44, 54);
      p.rect(x, y + 5, 12, 1, INK).rect(x + 2, y + 3, 8, 1, INK).rect(x + 2, y + 8, 8, 1, INK).rect(x + 2, y + 4, 1, 4, INK).rect(x + 9, y + 4, 1, 4, INK);
      p.rect(x + 3, y + 4, 6, 4, '#9fe3ff@0.3').set(x + 3, y + 4, '#ffffff@0.9');
      return p.rect(x + 11, y - 3, 1, 9, '#ffb02e').rect(x + 11, y - 4, 1, 1, '#e8606b').rect(x + 10, y + 6, 1, 2, '#ffb02e');
    },
    pets: { cat: ['bubbles'], dog: ['bubbles'] },
    board: {
      rim: () => '#e9d3a3', edge: '#8a6a3c',
      bull: '#fff7f0', outerBull: '#ff9eb5', light: '#f1dcaa', dark: '#2f8fc4', alt1: '#e8606b', alt2: WHITE,
      outer: ({ a }) => (Math.floor(a / (Math.PI / 2) + .5) % 2 ? '#e8606b' : WHITE),
    },
  };

  ART.midsommar = {
    frame: '#a8322d', skirting: '#7cc46a', frames: 4, ms: 320, doorFrames: true,
    wall() {
      const p = new P(22, 30).rect(0, 0, 22, 30, '#d6eeff').rect(0, 12, 22, 4, '#e4f3ff');
      for (let x = 0; x < 22; x++) p.rect(x, 18 - (mod(x * 5, 7) < 3 ? 1 : 0), 1, 13, '#a6d68f');
      p.rect(0, 22, 22, 8, '#b5e39e').rect(6, 3, 2, 27, '#f4f4ee').set(7, 7, '#3a3a3a').set(6, 11, '#3a3a3a').set(7, 16, '#3a3a3a').rect(6, 21, 2, 1, '#3a3a3a');
      p.pat(['..gg.g..', '.gggggg.', 'gggggggg', '.gg.ggg.', '..g..g..'], 3, 0, { g: '#7cc46a' });
      for (const [x, y, c] of [[2, 25, WHITE], [13, 24, '#ffd23f'], [18, 27, '#8a6ad6'], [10, 28, '#ff9eb5']]) p.set(x, y, c);
      return p;
    },
    // A falu-red stuga with a flag that waves.
    window(f) {
      const p = new P(24, 17);
      for (let y = 0; y < 5; y++) p.rect(7 - y * 2, y + 1, 4 + y * 4, 1, '#5a3a32');
      p.rect(1, 6, 14, 11, '#a8322d').rect(1, 6, 1, 11, WHITE).rect(14, 6, 1, 11, WHITE);
      p.rect(4, 8, 6, 5, WHITE).rect(5, 9, 4, 3, '#bfe3ff').rect(7, 9, 1, 3, WHITE).rect(5, 10, 4, 1, WHITE).rect(11, 11, 2, 6, '#7e2a26');
      p.rect(19, 1, 1, 16, WHITE);
      const flag = [['bbybbb', 'yyyyyy', 'bbybbb'], ['bbybb.', 'yyyyyy', 'bbybbb'], ['bbybbb', 'yyyyy.', 'bbybb.'], ['bbybb.', 'yyyyyy', 'bbybbb']][f];
      return p.pat(flag, 20, 1 + (f % 2), { b: '#2f6fc0', y: '#ffd23f' });
    },
    // The maypole stands where the door would be; its wreaths sway.
    door(f) {
      const p = new P(18, 27);
      p.rect(8, 0, 2, 27, '#4f9e4c');
      for (let y = 1; y < 27; y += 3) p.set(8 + (y % 2), y, '#7cc46a');
      p.rect(1, 6, 16, 2, '#4f9e4c').set(3, 6, '#7cc46a').set(13, 7, '#7cc46a').rect(7, 0, 4, 1, '#ffd23f');
      const dx = [0, 1, 0, -1][f];
      for (const cx of [2.5 + dx, 15.5 + dx]) p.ring(cx, 13, 1.6, 2.6, '#4f9e4c').set(cx - 2, 12, '#ff9eb5').set(cx + 1, 11, '#ffd23f').set(cx, 15, WHITE);
      return p.rect(2 + dx, 8, 1, 3, '#ffd23f').rect(15 + dx, 8, 1, 3, '#2f6fc0');
    },
    floor() {
      const p = new P(16, 16).rect(0, 0, 16, 16, '#b5e39e');
      for (const [x, y] of [[2, 3], [9, 1], [13, 9], [5, 12], [11, 15]]) p.set(x, y, '#9fd486').set(x + 1, y - 1, '#9fd486');
      for (const [x, y, c] of [[6, 5, WHITE], [14, 3, '#ffd23f'], [3, 9, '#8a6ad6'], [10, 12, '#ff9eb5'], [0, 14, WHITE]]) p.set(x, y, c);
      return p;
    },
    plant() {
      const p = new P(9, 15).rect(2, 9, 5, 6, '#f4f4ee').rect(1, 9, 7, 1, '#dfe3ea').rect(6, 10, 1, 5, '#dfe3ea').rect(7, 11, 1, 2, '#f4f4ee');
      p.rect(2, 2, 1, 7, '#3a9e6a').rect(4, 4, 1, 5, '#3a9e6a').rect(6, 3, 1, 6, '#3a9e6a').rect(2, 0, 1, 4, '#8a6ad6').set(1, 1, '#8a6ad6').set(3, 2, '#8a6ad6');
      return p.pat(['.w.', 'wyw', '.w.'], 3, 2, { w: WHITE, y: '#ffd23f' }).pat(['y.y', '.y.'], 5, 1, { y: '#ffd23f' });
    },
    wear(x, y) {
      const p = new P(44, 54);
      p.rect(x, y, 12, 1, '#4f9e4c').set(x - 1, y + 1, '#4f9e4c').set(x + 12, y + 1, '#4f9e4c');
      ['#ff9eb5', '#ffd23f', WHITE, '#8a6ad6', '#ff9eb5', '#ffd23f'].forEach((c, i) => p.set(x + i * 2, y - 1, c).set(x + i * 2 + 1, y, c));
      return p.set(x + 1, y - 1, '#4f9e4c').set(x + 7, y - 1, '#4f9e4c');
    },
    pets: { cat: ['crown'], dog: ['crown'] },
    board: {
      rim: ({ x, y }) => (mod(x * 7 + y * 5, 11) === 0 ? '#ff9eb5' : mod(x * 3 + y * 11, 13) === 0 ? '#ffd23f' : mod(x + y, 4) ? '#4f9e4c' : '#7cc46a'), edge: '#2f6e3a',
      bull: '#ffd23f', outerBull: '#2f6fc0', light: '#fffbe8', dark: '#2f6fc0', alt1: '#ffd23f', alt2: '#2f6fc0',
    },
  };

  ART.haunted = {
    frame: '#2a2033', skirting: '#1f1830', frames: 4, ms: 260,
    wall() {
      const p = new P(12, 12).rect(0, 0, 12, 12, '#3d2f55').rect(0, 0, 1, 12, '#35284a');
      return p.pat(['..m..', '.m.m.', 'm.m.m', '.m.m.', '..m..'], 4, 1, { m: '#4c3b6a' }).set(6, 8, '#4c3b6a').rect(5, 9, 3, 1, '#4c3b6a');
    },
    // A cobweb in the wall's corner.
    wallExtra() {
      const p = new P(9, 9);
      for (let i = 0; i < 9; i++) p.set(i, 0, '#c9c9d9@0.7').set(0, i, '#c9c9d9@0.7').set(i, i, '#c9c9d9@0.7');
      for (const r of [3, 6]) for (let i = 0; i <= r; i++) p.set(i, r - i, '#c9c9d9@0.7');
      return [[p, 'left top']];
    },
    // Bats flap across the moon.
    window(f) {
      const p = new P(24, 17);
      p.rect(1, 0, 22, 17, '#2a2033').rect(0, 1, 24, 15, '#2a2033').rect(1, 1, 22, 15, '#1a1d3a').rect(1, 11, 22, 5, '#22264a');
      p.disc(16, 6, 3.6, '#fff3c4').set(15, 5, '#e6d9a8').set(17, 7, '#e6d9a8');
      p.pat(['k.......', '.kk..k..', '...kk...', '...k.kk.', '..k.....'], 1, 2, { k: '#0e0e1c' });
      const bats = [[[4, 9], [13, 12]], [[8, 8], [11, 10]], [[12, 7], [8, 11]], [[16, 8], [5, 10]]][f];
      bats.forEach(([x, y], i) => { const up = (f + i) % 2; p.set(x, y, '#0e0e1c').set(x - 1, y - up, '#0e0e1c').set(x + 1, y - up, '#0e0e1c').set(x - 2, y - 1 + up, '#0e0e1c').set(x + 2, y - 1 + up, '#0e0e1c'); });
      return p.rect(12, 1, 1, 15, '#2a2033');
    },
    door() {
      const p = new P(18, 27);
      p.rect(0, 2, 18, 25, '#2a2033').rect(2, 0, 14, 3, '#2a2033').rect(2, 3, 14, 24, '#4a3628').rect(3, 2, 12, 1, '#4a3628');
      for (const x of [5, 9, 12]) p.rect(x, 3, 1, 24, '#3a2a1f');
      return p.rect(6, 6, 3, 1, '#5a4232').rect(13, 18, 2, 1, '#5a4232').ring(9, 13, 1.2, 2.1, '#9a9aa8').set(9, 10, '#9a9aa8').set(13, 16, '#ffd166');
    },
    floor() {
      const p = new P(28, 12).rect(0, 0, 28, 12, '#5a4232').rect(0, 5, 28, 1, '#46342a').rect(0, 11, 28, 1, '#46342a');
      return p.rect(19, 0, 1, 5, '#4e3a2c').rect(6, 6, 1, 5, '#4e3a2c').rect(4, 2, 5, 1, '#634a38').rect(14, 8, 4, 1, '#634a38');
    },
    // A jack-o'-lantern on the left of each room, a candelabra on the right.
    plant() {
      const p = new P(10, 10).rect(4, 0, 2, 2, '#3a7d3a').rect(1, 2, 8, 8, '#ff8c2e').rect(0, 3, 10, 6, '#ff8c2e').rect(3, 2, 1, 8, '#e06a1a').rect(6, 2, 1, 8, '#e06a1a');
      return p.rect(2, 4, 2, 1, '#ffd166').rect(6, 4, 2, 1, '#ffd166').pat(['y.yy.y', '.y..y.'], 2, 6, { y: '#ffd166' });
    },
    plant2() {
      const p = new P(9, 15).rect(4, 6, 1, 8, '#9a9aa8').rect(2, 14, 5, 1, '#9a9aa8').rect(1, 6, 7, 1, '#9a9aa8').set(1, 5, '#9a9aa8').set(7, 5, '#9a9aa8');
      for (const x of [1, 4, 7]) p.rect(x, 2, 1, 3, '#eef1f7').set(x, 1, '#ffd166').set(x, 0, '#ff8c2e');
      return p.rect(4, 2, 1, 4, '#eef1f7');
    },
    // A ghost bobs at the floor's right edge, a spider climbs its thread on the left.
    fx() {
      const ghost = () => {
        const p = new P(9, 11).rect(2, 0, 5, 1, '#eef1f7').rect(1, 1, 7, 8, '#eef1f7').rect(0, 3, 9, 5, '#eef1f7');
        for (const x of [1, 3, 5, 7]) p.set(x, 9, '#eef1f7');
        return p.set(2, 10, '#eef1f7').set(6, 10, '#eef1f7').rect(2, 3, 2, 2, INK).rect(5, 3, 2, 2, INK).set(4, 6, INK).set(8, 4, '#d0d4e0').set(8, 5, '#d0d4e0');
      };
      const spider = () => new P(5, 14).rect(2, 0, 1, 9, '#c9c9d9@0.7').rect(1, 9, 3, 3, INK).set(0, 10, INK).set(4, 10, INK).set(0, 12, INK).set(4, 12, INK).set(1, 10, '#ff3b3b');
      return {
        before: { art: spider, at: 'left: 6px; top: -6px;', path: 'loc-dangle 5s steps(10) infinite' },
        after: { art: ghost, at: 'right: 2px; top: 30%; opacity: .9;', path: 'loc-bob 3s steps(6) infinite' },
      };
    },
    wear(x, y) {
      const p = new P(44, 54), h = '#2b2140';
      p.rect(x - 2, y + 1, 16, 1, h).rect(x, y, 12, 1, h).rect(x + 2, y - 1, 8, 1, '#8a5cf0').rect(x + 5, y - 1, 2, 1, '#ffd166');
      p.rect(x + 3, y - 2, 6, 1, h).rect(x + 3, y - 3, 5, 1, h).rect(x + 4, y - 4, 4, 1, h).rect(x + 5, y - 5, 3, 1, h).rect(x + 6, y - 6, 3, 1, h).rect(x + 8, y - 7, 2, 1, h);
      return p.set(x + 4, y - 3, '#4a3a6a');
    },
    pets: { cat: ['witch'], dog: ['pumpkin'] },
    board: {
      rim: ({ a }) => (mod(a * 10 / (Math.PI * 2), 1) < .2 ? '#c9661a' : '#ff8c2e'), edge: '#1a1420',
      bull: '#ffd166', outerBull: '#8a5cf0', light: '#d8cfe8', dark: '#2a2033', alt1: '#ff8c2e', alt2: '#8a5cf0',
      web: true,
    },
  };

  ART.coffeehouse = {
    frame: '#6e4430', skirting: '#8a5a3c', frames: 3, ms: 300,
    wall() {
      const p = new P(12, 30).rect(0, 0, 12, 18, '#f6e7d0').rect(0, 0, 1, 18, '#efdcc0').rect(0, 18, 12, 1, '#8a5a3c');
      return p.rect(0, 19, 12, 11, '#6f9f7a').rect(0, 19, 12, 1, '#86b391').rect(0, 19, 1, 11, '#5a8a66').rect(2, 21, 8, 1, '#5a8a66').rect(2, 27, 8, 1, '#86b391');
    },
    // Under a striped awning; steam curls from a cup on the sill.
    window(f) {
      const p = new P(24, 17);
      p.rect(0, 3, 24, 14, '#6e4430').rect(1, 4, 22, 11, '#cfe8f5').rect(12, 4, 1, 11, '#6e4430');
      for (let i = 0; i < 6; i++) p.set(3 + i, 12 - i, '#e8f5fc').set(14 + i, 12 - i, '#e8f5fc');
      for (let x = 0; x < 24; x++) { const c = Math.floor(x / 3) % 2 ? WHITE : '#e8606b'; p.rect(x, 0, 1, 3, c); if (mod(x, 3) !== 2) p.set(x, 3, c); }
      p.rect(0, 15, 24, 2, '#8a5a3c').rect(3, 12, 4, 3, WHITE).set(7, 13, WHITE).rect(3, 12, 4, 1, '#8a5a3c');
      for (const [x, y] of [[[4, 10], [5, 9], [4, 8], [5, 7]], [[5, 10], [4, 9], [5, 8], [4, 6]], [[4, 11], [4, 9], [5, 8], [5, 6]]][f]) p.set(x, y, WHITE);
      return p.pat(['.ooo.', 'ooooo'], 16, 13, { o: '#e0a050' }).set(17, 13, '#c9853a').set(19, 14, '#c9853a');
    },
    door() {
      const p = new P(18, 27).rect(0, 0, 18, 27, '#2a4a34').rect(1, 1, 16, 26, '#3d6b4c');
      p.rect(3, 3, 12, 11, '#cfe8f5').rect(3, 3, 12, 1, '#2a4a34').set(5, 6, '#e8f5fc').set(6, 5, '#e8f5fc');
      p.rect(5, 8, 8, 4, WHITE).rect(6, 9, 1, 2, '#e8606b').rect(8, 9, 1, 2, '#e8606b').rect(10, 9, 2, 2, '#e8606b');
      return p.rect(3, 16, 12, 9, '#356040').rect(14, 15, 2, 2, '#ffd23f');
    },
    floor() {
      const p = new P(28, 12).rect(0, 0, 28, 12, '#c99a6a').rect(0, 0, 28, 5, '#c4935f').rect(0, 5, 28, 1, '#a8784a').rect(0, 11, 28, 1, '#a8784a');
      return p.rect(17, 0, 1, 5, '#b5855a').rect(5, 6, 1, 5, '#b5855a');
    },
    // A chalkboard menu on the left of each room, a little potted tree on the right.
    plant() {
      const p = new P(9, 15).rect(0, 0, 9, 11, '#a8743f').rect(1, 1, 7, 9, '#2f3a34');
      p.rect(2, 2, 5, 1, '#eef1f7').rect(2, 4, 3, 1, '#d8dce6').rect(2, 6, 4, 1, '#d8dce6').set(6, 6, '#ffd23f').rect(2, 8, 3, 1, '#d8dce6');
      return p.rect(1, 11, 1, 4, '#a8743f').rect(7, 11, 1, 4, '#a8743f');
    },
    plant2() {
      const p = new P(9, 15).rect(2, 11, 5, 4, WHITE).rect(1, 11, 7, 1, '#e3e7f1').rect(4, 6, 1, 5, '#8a5a3c');
      return p.disc(4.5, 3.5, 3.5, '#5fae5a').set(3, 2, '#7cc46a').set(5, 1, '#7cc46a').set(6, 4, '#4f9e4c');
    },
    // An espresso counter beside the window; the machine steams.
    prop: { frames: 3, ms: 300, art(f) {
      const p = new P(24, 22);
      p.rect(0, 12, 24, 10, '#8a5a3c').rect(0, 12, 24, 2, '#a8743f').rect(2, 15, 20, 1, '#6e4430');
      p.rect(3, 3, 10, 9, '#c9d1e0').rect(3, 3, 10, 1, '#e3e7f1').rect(4, 5, 8, 2, INK).set(5, 5, '#5ff27a').rect(6, 7, 4, 2, '#9aa3b8').rect(7, 9, 2, 1, '#3a3440').rect(6, 10, 4, 2, WHITE);
      for (const [x, y] of [[[7, 2], [8, 1], [7, 0]], [[8, 2], [7, 1], [8, 0]], [[7, 2], [7, 1], [8, 0]]][f]) p.set(x, y, WHITE);
      for (const x of [15, 19]) p.rect(x, 9, 3, 3, WHITE).set(x + 3, 10, WHITE).rect(x, 9, 3, 1, '#8a5a3c');
      return p;
    } },
    wear(x, y) {
      const p = new P(44, 54), { band, shine, cup, glint, cushion } = PHONES;
      p.rect(x + 2, y - 2, 8, 1, band).rect(x + 3, y - 2, 3, 1, shine).rect(x + 1, y - 1, 1, 1, band).rect(x + 10, y - 1, 1, 1, band);
      p.rect(x, y, 1, 2, band).rect(x + 11, y, 1, 2, band);
      for (const cx of [x - 1, x + 10]) p.rect(cx, y + 2, 3, 5, cup).set(cx, y + 3, glint);
      return p.rect(x + 1, y + 3, 1, 3, cushion).rect(x + 10, y + 3, 1, 3, cushion);
    },
    pets: { cat: ['headphones'], dog: ['scarf'] },
    board: {
      rim: ({ x, y }) => ((x + y) % 5 ? WHITE : '#eef1f7'), edge: '#a8743f',
      bull: '#f3e2c8', outerBull: '#c08a52', light: '#f3e2c8', dark: '#6e4430', alt1: '#c08a52', alt2: '#8a5a3c',
    },
  };

  // ---------------- the location's CSS ----------------
  const pxBox = (p, s = 3) => `width: ${p.w * s}px; height: ${p.h * s}px;`;
  const animate = (...list) => (list.some(Boolean) ? ` animation: ${list.filter(Boolean).join(', ')};` : '');
  // A looping sprite: frame images swapped by a stepped animation.
  function frames(name, art, n, ms) {
    if (n < 2) return { image: art(0).uri(), keyframes: '', animation: null };
    const steps = Array.from({ length: n }, (_, i) => `${((i * 100) / n).toFixed(2)}% { background-image: ${art(i).uri()}; }`).join(' ');
    return { image: art(0).uri(), keyframes: `@keyframes ${name} { ${steps} }`, animation: `${name} ${n * ms}ms step-end infinite` };
  }
  function css(id) {
    const a = ART[id];
    if (!a) return '';
    // Every floor moves, the boss's too; a boss floor keeps its orchestrator's
    // colour on the frame, the skirting and the room's edge.
    const loc = `body.layout-office[data-location="${id}"]`, sel = `${loc} .floor`;
    const out = [];
    out.push(`${sel}:not(.boss) { border-color: ${a.frame}; }`, `${sel}:not(.boss) .floor-label { border-bottom-color: ${a.skirting}; }`);
    if (a.floor) out.push(`${sel} { background-color: transparent; background-image: ${a.floor().uri()}; }`);
    const wallExtra = (a.wallExtra?.() || []).map(([p, at]) => `${p.uri()} ${at} no-repeat, `).join('');
    out.push(`${sel} .floor-label { background: ${wallExtra}${a.wall().uri()} 0 0 repeat; }`);
    out.push(`${loc} .room.boss { background-color: var(--rug); }`);
    const win = frames(`loc-${id}-window`, (f) => a.window(f), a.frames, a.ms);
    out.push(win.keyframes, `${sel} .floor-label::before { background-image: ${win.image};${animate(win.animation)} }`);
    const door = frames(`loc-${id}-door`, (f) => a.door(f), a.doorFrames ? a.frames : 1, a.ms);
    out.push(door.keyframes, `${sel} .floor-label::after { background-image: ${door.image};${animate(door.animation)} }`);
    const plant = a.plant(), plant2 = a.plant2 ? a.plant2() : plant;
    out.push(`${loc} .room::before { background-image: ${plant.uri()}; ${pxBox(plant)} left: -${plant.w * 3 - 9}px; }`);
    out.push(`${loc} .room::after { background-image: ${plant2.uri()}; ${pxBox(plant2)} right: -${plant2.w * 3 - 9}px; }`);
    if (a.prop) {
      const pr = frames(`loc-${id}-prop`, (f) => a.prop.art(f), a.prop.frames, a.prop.ms);
      out.push(pr.keyframes, `${sel} .loc-prop { display: block; ${pxBox(a.prop.art(0))} background-image: ${pr.image};${animate(pr.animation)} }`);
    }
    const fx = a.fx?.();
    if (fx) {
      const layers = (fx.layers || []).map(([p, at, s = 3]) => `${p.uri(s)} ${at} / ${p.w * s}px ${p.h * s}px no-repeat`);
      out.push(`${sel} .loc-fx { display: block;${layers.length ? ` background: ${layers.join(', ')};` : ''} }`);
      for (const side of ['before', 'after']) {
        const s = fx[side];
        if (!s) continue;
        const sp = frames(`loc-${id}-${side}`, (f) => s.art(f), s.frames || 1, s.ms || 0);
        out.push(sp.keyframes, `${sel} .loc-fx::${side} { content: ""; ${pxBox(s.art(0))} ${s.at} background-image: ${sp.image};${animate(s.path, sp.animation)} }`);
      }
    }
    if (a.css) out.push(a.css(sel));
    return out.filter(Boolean).join('\n');
  }

  // ---------------- what the figures, pets and dart board get ----------------
  function wear(id) {
    const a = ART[id];
    return a ? (x, y) => a.wear(x, y).rects() : null;
  }
  function dress(id, species) {
    const kinds = ART[id]?.pets?.[species];
    if (!kinds) return null;
    return (pose) => {
      const under = pose.endsWith('-under'), h = HEADS[species][under ? pose.slice(0, -6) : pose];
      const p = new P(18, 20);
      for (const k of kinds) if (UNDER.has(k) ? pose === 'nap-under' : !under && h) PET[k](p, h);
      return p.rects();
    };
  }
  // ({ x, y, d, a, wedge, rings, R }) => colour or null, for bird.js's board:
  // d is the distance from the middle in board radii, a the angle, R the
  // radius in pixels.
  function boardPaint(id) {
    const b = ART[id]?.board;
    if (!b) return null;
    if (b.paint) return b.paint;
    return (px) => {
      const { d, a, wedge, rings, R } = px;
      let c = null;
      if (d <= rings[0].r) c = b.bull;
      else if (d <= rings[1].r) c = b.outerBull;
      else if (d <= rings[2].r) c = wedge ? b.light : b.dark;
      else if (d <= rings[3].r) c = wedge ? b.alt1 : b.alt2;
      else if (d <= rings[4].r) c = b.outer ? b.outer(px) : wedge ? b.dark : b.light;
      else if (d <= 1 + 2 / R) c = b.rim(px);
      else if (d <= 1 + 3 / R) c = b.edge;
      if (b.web && d > .2 && d < 1 && Math.abs(mod(a * 8 / (Math.PI * 2), 1) - .5) > .47) c = '#eef1f7';
      return c;
    };
  }

  // ---------------- the settings card previews: a 40×22 corner of each place ----------------
  function base(p, { wall, wall2, skirt, floor, floor2, sky, frame, door, door2 }) {
    p.rect(0, 0, 40, 10, wall);
    if (wall2) for (let x = 3; x < 40; x += 6) p.rect(x, 0, 1, 10, wall2);
    p.rect(0, 10, 40, 1, skirt).rect(0, 11, 40, 11, floor);
    if (floor2) for (let y = 13; y < 22; y += 3) p.rect(0, y, 40, 1, floor2);
    if (sky) p.rect(3, 2, 10, 6, frame).rect(4, 3, 8, 4, sky);
    if (door) p.rect(31, 1, 6, 10, door2 || door).rect(32, 2, 4, 9, door).set(35, 6, '#ffd66b');
  }
  const desk = (p, x, hat) => {
    p.rect(x + 1, 12, 4, 3, '#ffd9c2').set(x + 2, 13, INK).set(x + 4, 13, INK);
    hat?.(p, x);
    p.rect(x, 15, 7, 1, '#d39b63').rect(x, 16, 7, 2, '#a8743f').rect(x + 1, 16, 5, 1, '#fff6e8');
  };
  const MINI = {
    office(p) {
      base(p, { wall: '#eef3ff', wall2: '#e3eaf8', skirt: '#cfd6e6', floor: '#efcfa6', floor2: '#e3bd8f', sky: '#bfe3ff', frame: '#8a6a4f', door: '#c08a52', door2: '#8a5a3c' });
      p.rect(5, 4, 3, 1, WHITE).rect(7, 5, 1, 2, '#8a6a4f').rect(4, 5, 8, 1, '#8a6a4f');
      p.rect(9, 16, 22, 6, '#dce8ff'); desk(p, 12); desk(p, 21);
      p.rect(2, 18, 3, 3, '#e07a5f').rect(2, 16, 1, 2, '#4fbf72').rect(4, 15, 1, 3, '#4fbf72');
    },
    garden(p) {
      base(p, { wall: '#bfe3ff', skirt: WHITE, floor: '#7ccf6a' });
      for (let x = 1; x < 40; x += 3) p.rect(x, 4, 2, 7, WHITE).set(x, 3, WHITE);
      p.rect(0, 6, 40, 1, WHITE).rect(0, 9, 40, 1, WHITE).disc(6, 3, 2.2, '#ffd23f');
      for (const [x, y] of [[3, 14], [8, 19], [26, 20], [35, 15], [17, 21]]) p.set(x, y, '#ff7aa8').set(x, y + 1, '#3a9e6a');
      p.rect(9, 16, 22, 6, '#fff4f2');
      for (let x = 9; x < 31; x += 4) p.rect(x, 16, 2, 6, '#f6c9cc');
      const sunhat = (q, x) => q.rect(x, 11, 7, 1, '#f3d68a').rect(x + 1, 10, 5, 1, '#f3d68a').rect(x + 1, 11, 5, 1, '#e8606b');
      desk(p, 12, sunhat); desk(p, 21, sunhat);
      p.rect(34, 11, 2, 6, '#ffd23f').disc(35, 10, 2, '#ffd23f').set(35, 10, '#8a5a3c').rect(35, 13, 1, 7, '#3a9e6a');
    },
    space(p) {
      base(p, { wall: '#4a5368', wall2: '#323849', skirt: '#5ff2ff', floor: '#262c3d', floor2: '#36425f', sky: '#0b1030', frame: '#8d97ad', door: '#a7b0c4', door2: '#5d667c' });
      p.set(5, 4, WHITE).set(10, 3, WHITE).set(7, 6, WHITE).disc(10.5, 5.5, 1.5, '#ff9e6b');
      p.rect(34, 2, 1, 9, '#5d667c'); for (let x = 32; x < 36; x++) p.set(x, 10 - (x % 2), '#ffd23f');
      p.rect(9, 16, 22, 6, '#36405a');
      const helmet = (q, x) => q.ring(x + 3, 13, 2.6, 3.4, '#bfe8ff');
      desk(p, 12, helmet); desk(p, 21, helmet);
      p.rect(2, 18, 4, 3, '#8d97ad').rect(2, 15, 4, 3, '#dff4ff').set(3, 16, '#4fbf72').set(4, 15, '#4fbf72');
    },
    beach(p) {
      base(p, { wall: '#bfe8f0', skirt: '#f4b6c2', floor: '#f0dab0', floor2: '#dcc296', sky: '#9fdcff', frame: WHITE, door: '#f4a0a0', door2: WHITE });
      for (let x = 6; x < 40; x += 12) p.rect(x, 0, 6, 10, '#fffaf0');
      p.rect(3, 2, 10, 6, WHITE).rect(4, 3, 8, 2, '#9fdcff').rect(4, 5, 8, 2, '#3fb6d0').set(6, 5, '#e8fbff').set(10, 6, '#e8fbff').set(10, 3, '#ffe066');
      p.rect(5, 3, 1, 4, '#a8743f').rect(4, 3, 3, 1, '#3fae6a');
      for (let y = 3; y < 10; y += 2) p.rect(32, y, 4, 1, '#d97f86');
      p.rect(9, 16, 22, 6, '#c9eef5'); for (let x = 12; x < 31; x += 5) p.rect(x, 16, 2, 6, '#8fd6e4');
      const shades = (q, x) => q.rect(x + 1, 13, 5, 1, '#22232b');
      desk(p, 12, shades); desk(p, 21, shades);
      p.rect(2, 18, 3, 3, '#e9b07a').rect(3, 14, 1, 4, '#a8743f').rect(1, 13, 5, 1, '#3fae6a').set(1, 14, '#3fae6a').set(5, 14, '#3fae6a');
      p.rect(36, 12, 3, 9, '#ff9e6b').rect(37, 12, 1, 9, WHITE);
    },
    north(p) {
      base(p, { wall: '#a8693f', skirt: '#6b3d22', floor: '#c98f5e', floor2: '#b07a4c', sky: '#a9d0f5', frame: '#7e4a2a', door: '#c08a52', door2: '#8a5a3c' });
      for (let y = 2; y < 10; y += 3) p.rect(0, y, 40, 1, '#8e5733');
      p.rect(3, 2, 10, 1, WHITE).rect(4, 6, 8, 1, WHITE).set(6, 4, WHITE).set(9, 3, WHITE).set(11, 5, WHITE);
      p.ring(34, 5, 1, 2, '#2e8b57').set(34, 7, '#e23b3b');
      p.rect(9, 16, 22, 6, '#fbf1e1'); for (let x = 11; x < 31; x += 6) p.rect(x, 16, 2, 6, '#efb8b3'); p.rect(9, 18, 22, 1, '#efb8b3');
      const santa = (q, x) => q.rect(x + 1, 11, 4, 1, '#e23b3b').rect(x + 2, 10, 3, 1, '#e23b3b').set(x + 5, 10, WHITE).rect(x + 1, 12, 4, 1, WHITE);
      desk(p, 12, santa); desk(p, 21, santa);
      p.rect(2, 19, 3, 2, '#c0392b').rect(3, 13, 1, 1, '#ffd23f').rect(2, 14, 3, 2, '#2e8b57').rect(1, 16, 5, 3, '#2e8b57').set(2, 17, '#e23b3b').set(4, 15, '#4f9cff');
    },
    water(p) {
      base(p, { wall: '#7fd0dc', skirt: '#5aa9b8', floor: '#f1dcaa', sky: '#3ea6d6', frame: '#c99a4a', door: '#7c8da3', door2: '#5f7189' });
      p.rect(5, 4, 3, 2, '#ff8c2e').set(8, 5, '#ff8c2e').set(10, 6, '#e8fbff').disc(34, 4, 1.5, '#3ea6d6');
      p.rect(9, 16, 22, 6, '#d3f1e6');
      const mask = (q, x) => q.rect(x + 1, 12, 4, 2, '#9fe3ff').rect(x + 5, 10, 1, 4, '#ffb02e');
      desk(p, 12, mask); desk(p, 21, mask);
      for (const x of [2, 4]) for (let y = 13; y < 21; y++) p.set(x + (y % 3 ? 0 : 1), y, '#3fae6a');
      p.rect(34, 17, 1, 4, '#ff7aa8').rect(33, 18, 3, 1, '#ff7aa8').set(36, 16, '#ff7aa8').set(27, 12, '#e8fbff').set(28, 10, '#e8fbff');
    },
    midsommar(p) {
      base(p, { wall: '#cdeaff', skirt: '#7ccf6a', floor: '#8fd47a' });
      p.rect(0, 7, 40, 3, '#a6dd8f');
      for (const x of [3, 8, 37]) p.rect(x, 1, 1, 9, WHITE).set(x, 3, INK).set(x, 6, INK).rect(x - 1, 0, 3, 2, '#7ccf6a');
      p.rect(9, 16, 22, 6, '#e8f1ff'); for (let x = 12; x < 31; x += 6) p.rect(x, 16, 2, 6, '#c3d6f0');
      const crown = (q, x) => { for (let i = 0; i < 5; i++) q.set(x + 1 + i, 11, ['#ff7aa8', '#ffd23f', WHITE, '#4f9cff', '#ff7aa8'][i]); };
      desk(p, 12, crown); desk(p, 21, crown);
      p.rect(33, 4, 1, 16, '#3a9e6a').rect(31, 6, 5, 1, '#3a9e6a').ring(31, 9, .5, 1.5, '#3a9e6a').ring(36, 9, .5, 1.5, '#3a9e6a').set(33, 3, '#ffd23f');
      for (const [x, y] of [[3, 14], [6, 19], [25, 21], [37, 18]]) p.set(x, y, ['#ff7aa8', '#ffd23f', WHITE, '#4f9cff'][x % 4]);
    },
    haunted(p) {
      base(p, { wall: '#3d2f55', wall2: '#2e2342', skirt: '#1f1830', floor: '#5a4232', floor2: '#4a3628', sky: '#1a1d3a', frame: '#2a2033', door: '#4a3628', door2: '#2a2033' });
      p.disc(10, 4, 1.5, '#fff3c4').pat(['k.k', '.k.'], 5, 3, { k: INK });
      p.rect(9, 16, 22, 6, '#7a5a96').rect(9, 16, 1, 6, '#d9b45a').rect(30, 16, 1, 6, '#d9b45a');
      const witch = (q, x) => q.rect(x, 11, 7, 1, INK).rect(x + 2, 10, 3, 1, INK).rect(x + 3, 9, 1, 1, INK).rect(x + 2, 11, 3, 1, '#8a5cf0');
      desk(p, 12, witch); desk(p, 21, witch);
      p.rect(2, 17, 4, 3, '#ff8c2e').set(3, 18, INK).set(4, 18, INK).set(3, 16, '#3a9e6a');
      p.pat(['.www.', 'wkwkw', 'wwwww', 'w.w.w'], 33, 13, { w: '#eef1f7', k: INK });
    },
    coffeehouse(p) {
      base(p, { wall: '#f6e7d0', skirt: '#8a5a3c', floor: '#c99a6a', floor2: '#a8784a', sky: '#bfe3ff', frame: '#6e4430', door: '#3d6b4c', door2: '#2a4a34' });
      p.rect(0, 7, 40, 3, '#6f9f7a');
      for (let x = 3; x < 13; x++) p.set(x, 1, x % 2 ? '#e8606b' : WHITE);
      p.rect(16, 3, 10, 1, '#8a5a3c').rect(17, 1, 2, 2, WHITE).rect(21, 1, 2, 2, '#e8606b').rect(24, 2, 1, 1, '#ffd23f');
      p.rect(9, 16, 22, 6, '#f8efe0');
      for (let x = 9; x < 31; x += 2) for (let y = 16; y < 22; y += 2) if ((x - 9 + y - 16) % 4 === 0) p.rect(x, y, 2, 2, '#d9c2a2');
      const phones = (q, x) => q.rect(x + 1, 11, 4, 1, PHONES.band).rect(x, 12, 1, 2, PHONES.cup).rect(x + 5, 12, 1, 2, PHONES.cup);
      desk(p, 12, phones); desk(p, 21, phones);
      p.rect(2, 16, 4, 4, WHITE).rect(6, 17, 1, 2, WHITE).rect(3, 16, 2, 1, '#8a5a3c').set(3, 14, '#e3e7f1').set(4, 13, '#e3e7f1');
    },
    surprise(p) {
      for (let y = 0; y < 22; y++) p.rect(0, y, 40, 1, ['#ffd9c2', '#fff3a8', '#d8f3df', '#dce8ff', '#efe0ff'][Math.floor(y / 4.5)]);
      p.rect(13, 3, 14, 14, INK).rect(14, 4, 12, 12, WHITE).rect(14, 15, 12, 1, '#e3e7f1');
      for (const [x, y] of [[16, 6], [23, 6], [19, 9], [16, 12], [23, 12]]) p.rect(x, y, 2, 2, x === 19 ? '#e8606b' : INK);
      for (const [x, y, c] of [[5, 4, '#ffd23f'], [33, 6, '#e8606b'], [7, 16, '#4f7cff'], [32, 17, '#3fae4f']]) p.set(x, y, c).set(x - 1, y + 1, c).set(x + 1, y + 1, c).set(x, y + 2, c);
    },
  };
  function preview(id) {
    const p = new P(40, 22);
    (MINI[id] || MINI.office)(p);
    return `<svg viewBox="0 0 40 22" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" aria-hidden="true">${p.rects()}</svg>`;
  }

  // ---------------- putting a location on ----------------
  let current = 'office';
  function set(id) {
    const next = ART[id] ? id : 'office';
    if (next === current) return false;
    current = next;
    let $style = document.getElementById('location-style');
    if (!$style) { $style = document.createElement('style'); $style.id = 'location-style'; document.head.appendChild($style); }
    $style.textContent = css(current);
    if (current === 'office') delete document.body.dataset.location; else document.body.dataset.location = current;
    return true;
  }

  window.officeLocationArt = {
    set, current: () => current, preview,
    // for test/location-art.test.js
    ART, MINI, css, boardPaintFor: boardPaint,
    wear: () => wear(current), dress: (species) => dress(current, species), boardPaint: () => boardPaint(current),
  };
})();
