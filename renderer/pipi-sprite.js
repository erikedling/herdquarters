// PiPi's sprite, drawn pixel by pixel into a 40 × 40 grid of palette keys
// (null is see-through). The body and head are shaded ellipses with an
// outline; eyes, beak, wing, tail, crest and legs are small parts that
// change per frame. pipiFrame(pose, look) builds one frame; bird.js paints it.
// No DOM, so test/pipi-sprite.test.js runs it in node; the browser gets
// window.pipiSprite.
//
// Palette keys: O outline, B body, S body shadow, H highlight, C belly,
// D belly shadow, W wing, X wing dark, Y beak, Z beak dark, L legs,
// K eye, G eye glint, P cheek. A species look (pipi-species.js) can also
// use A cap, a cap shadow, E breast, e breast shadow, M mask, N collar,
// Q cheek patch, V wing mark, T tail, U tail dark, I and J
// beak marks, F eye star, R chest mark.
(function () {
  const N = 40;      // room around the bird for jumps, squash and stretch
  const GROUND = 37; // the row the feet stand on

  // pose: { sx, sy (squash, 1 = none), lift (whole bird up, px), headDx,
  // headDy, eye: open|blink|closed|happy|wide, beak: closed|open|wide,
  // wing: fold|up|mid|down|stretch, legs: stand|stepA|stepB|tuck,
  // tail (px up), blush, crest (px of bob) }
  // look: a species' shapes and markings (pipi-species.js); none is the
  // classic PiPi.
  function pipiFrame(pose = {}, look = {}) {
    const p = { sx: 1, sy: 1, lift: 0, headDx: 0, headDy: 0, eye: 'open', beak: 'closed', wing: 'fold', legs: 'stand', tail: 0, blush: false, crest: 0, ...pose };
    const g = Array.from({ length: N }, () => Array(N).fill(null));
    const set = (x, y, k) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < N && y < N) g[y][x] = k; };
    const map = (ox, oy, rows, keys = {}) => rows.forEach((row, y) => [...row].forEach((c, x) => { if (c !== '.') set(ox + x, oy + y, keys[c] || c); }));

    const feet = p.legs === 'tuck' ? GROUND - 2 : GROUND - 3;
    // Body: squash keeps the bottom where the legs are.
    const rx = 8.2 * p.sx, ry = 7.2 * p.sy;
    const cx = 19, cy = feet - p.lift - ry;
    // Head: on the front of the body, follows the squash a little.
    const hx = 24 + p.headDx, hy = cy - 7 * p.sy + p.headDy, hr = 6.8;

    // Tail first, so the body covers its root.
    const tx = Math.round(cx - 8.2 + 1), ty = Math.round(cy - 1 - p.tail); // not squashed: it stays in the box
    const [tdx, tdy, tail] = TAILS[look.tail] || TAILS.short;
    map(tx + tdx, ty + tdy, tail, look.tailKeys);

    // Shaded ellipse: light from the top left.
    function blob(ox, oy, ax, ay, fill) {
      for (let y = Math.floor(oy - ay - 1); y <= Math.ceil(oy + ay + 1); y++) {
        for (let x = Math.floor(ox - ax - 1); x <= Math.ceil(ox + ax + 1); x++) {
          const nx = (x + 0.5 - ox) / ax, ny = (y + 0.5 - oy) / ay;
          if (nx * nx + ny * ny > 1) continue;
          const shade = nx * 0.55 + ny * 0.8;
          set(x, y, fill(nx, ny, shade));
        }
      }
    }
    const fur = (nx, ny, shade) => (shade > 0.5 ? 'S' : shade < -0.62 ? 'H' : 'B');
    const shaded = (k, nx, ny, shade) => (k === 'A' && shade > 0.5 ? 'a' : k === 'E' && (ny > 0.6 || nx > 0.9) ? 'e' : k);
    blob(cx, cy, rx, ry, (nx, ny, shade) => {
      // The belly: the front lower part, cream.
      const bx = (nx - 0.5) / 0.62, by = (ny - 0.4) / 0.7;
      const belly = bx * bx + by * by < 1;
      const mark = look.body?.(nx, ny, belly);
      if (mark) return shaded(mark, nx, ny, shade);
      if (belly) return ny > 0.6 || nx > 0.9 ? 'D' : 'C';
      return fur(nx, ny, shade);
    });
    blob(hx, hy, hr, hr * 0.95, (nx, ny, shade) => {
      const mark = look.head?.(nx, ny);
      if (mark) return shaded(mark, nx, ny, shade);
      // The face below the eye is a little lighter, the chin cream.
      if (ny > 0.5 && nx > 0.15) return 'C';
      return fur(nx, ny, shade);
    });
    // A puffed cheek bulges past the head's outline.
    if (look.cheek) {
      const ch = look.cheek;
      blob(hx + ch.dx, hy + ch.dy, ch.rx, ch.ry, () => 'Q');
    }
    const chest = CHESTS[look.chest];
    if (chest) map(Math.round(cx + chest[0]), Math.round(cy + chest[1]), chest[2]);
    // Crest on top of the head. A bird without one ruffles its head
    // feathers when it bobs.
    const crx = Math.round(hx - 1), cry = Math.round(hy - hr + 1 - p.crest);
    const crest = look.crest === 'none' ? (p.crest > 0 ? CRESTS.ruffle : null) : CRESTS[look.crest] || CRESTS.tuft;
    if (crest) map(crx + crest[0], cry + crest[1], crest[2], { B: look.crestKey || 'B' });

    // Wing, from the shoulder.
    const sx0 = Math.round(cx - 1), sy0 = Math.round(cy - 2);
    const WINGS = {
      fold: [-6, 0, ['..WWWWW..', '.WWWWWWWW', 'WHWWWWWWX', '.WWWWWXX.', '..XXXX...']],
      up: [-5, -10, ['....WW', '...WWW', '..WWWX', '.WHWX.', 'WHWWX.', 'WWWX..', 'WWX...', '.WWW..', '..WWW.', '...WW.']],
      mid: [-9, -2, ['WWWWWWWW..', '.HWWWWWWWW', '..XXXWWWW.', '....XXXX..']],
      down: [-6, 1, ['..WWWWW.', '.WWWWWWW', 'WWWWWWX.', 'WWWXXX..', '.WXX....', '..X.....']],
      stretch: [-7, -12, ['WW......', 'WWW.....', '.WWW....', '.HWWW...', '..WWWW..', '...WWWX.', '....WWWX', '.....WWX']],
    };
    const [wx, wy, rows] = WINGS[p.wing] || WINGS.fold;
    map(sx0 + wx, sy0 + wy, wingMarks(rows, look.wing));

    // Eye and cheek.
    const ex = Math.round(hx + 1.5), ey = Math.round(hy - 2);
    const EYES = {
      open: ['KG', 'KK', 'KK'],
      blink: ['..', 'KK', '..'],
      closed: ['...', 'KKK'],
      happy: ['.K.', 'K.K', '...'],
      wide: ['GGG', 'GKG', 'GKG', 'GGG'],
    };
    const own = EYE_SETS[look.eyes]?.[p.eye];
    if (own) map(ex + own[0], ey + own[1], own[2]);
    else map(p.eye === 'wide' ? ex - 1 : ex, p.eye === 'wide' ? ey - 1 : ey, EYES[p.eye] || EYES.open);
    if (p.blush || p.eye === 'happy') map(ex - 1, ey + 4, ['PP']);

    // Beak on the front of the head.
    const bx = Math.round(hx + hr - 0.5), by = Math.round(hy);
    const beak = BEAKS[look.beak] || BEAKS.short;
    map(bx + beak.at[0], by + beak.at[1], beak[p.beak] || beak.closed);

    // Legs and toes.
    const lx = Math.round(cx), ly = feet;
    const LEGS = {
      stand: [[0, 0], [3, 0]],
      stepA: [[1, 0], [3, -1]],
      stepB: [[-1, -1], [2, 0]],
    };
    if (p.legs !== 'tuck') {
      for (const [dx, dy] of LEGS[p.legs] || LEGS.stand) {
        map(lx + dx, ly + dy, ['L', 'L', 'LLL']);
      }
    }

    // Outline: every empty pixel next to a filled one.
    const out = g.map((row) => row.slice());
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (g[y][x] || g[y][x] === undefined) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const k = g[y + dy]?.[x + dx];
        return k && k !== 'L' && k !== 'P' && k !== 'G';
      });
      if (near) out[y][x] = 'O';
    }
    return out;
  }

  // Shapes a species can pick: [dx, dy, rows] from the tail's root, the
  // crest's spot on the head; beaks from the front of the head.
  const TAILS = {
    short: [-6, -2, ['XXX....', '.XWWX..', '..XWWWX', '...XWWW', '....XWW']],
    stub: [-3, -1, ['XX...', '.XWWX', '..XWW']],
    long: [-9, -1, ['.......XWW', '.....XXWWW', '...XXWWWWX', '.XXWWWWXX.', 'XWWWWXX...', 'XWXX......']],
    streamers: [-10, -2, ['....XXX....', '......XWWX.', '.......XWWW', 'X.....XWWWW', '.XX.XX.XWWW', '...X.......']],
  };
  const CRESTS = {
    tuft: [0, -3, ['.B.', 'BB.', '.BB', '..B']],
    ruffle: [0, -1, ['B.B', '.B.']],
    peak: [-4, -4, ['B....', 'BB...', '.BBB.', '.BBBB', '..BBB']],
    jay: [-3, -3, ['BB...', '.BBB.', '..BBB', '...BB']],
    plume: [-1, -6, ['BB...', '..B..', '..BB.', '...B.', '...BB', '....B']],
  };
  const BEAKS = {
    short: { at: [-1, -1], closed: ['YYY.', 'ZZYY', 'ZZ..'], open: ['YYYY', 'K...', 'ZZZ.'], wide: ['YYYY', 'KK..', 'KK..', 'ZZZ.'] },
    thin: { at: [-1, 0], closed: ['YYYY', 'ZZZ.'], open: ['YYYY', 'K...', 'ZZZ.'], wide: ['YYYY', 'KK..', 'KK..', 'ZZZ.'] },
    finch: { at: [-1, -2], closed: ['YYY.', 'YYYY', 'ZZZ.', 'ZZ..'], open: ['YYY.', 'YYYY', 'KK..', 'ZZZ.'], wide: ['YYY.', 'YYYY', 'KK..', 'KK..', 'ZZZ.'] },
    hook: { at: [-1, -2], closed: ['YYY.', 'YYYY', 'ZZ.Y', 'ZZ..'], open: ['YYY.', 'YYYY', 'KK.Y', 'ZZZ.'], wide: ['YYY.', 'YYYY', 'KK.Y', 'KK..', 'ZZZ.'] },
    dagger: { at: [-1, -1], closed: ['YYYYYY.', 'ZZZZZZZ'], open: ['YYYYYYY', 'K......', 'ZZZZZZ.'], wide: ['YYYYYYY', 'KK.....', 'KK.....', 'ZZZZZZ.'] },
    toucan: { at: [-2, -3], closed: ['.YYYY...', 'YYYYYYY.', 'YZZZZYYY', 'JJJZZYYI', '.JJJJJI.'], open: ['.YYYY...', 'YYYYYYY.', 'YZZZZYYY', 'KKK....I', 'JJJJJI..'], wide: ['.YYYY...', 'YYYYYYY.', 'YZZZZYYY', 'KKK....I', 'KKK.....', 'JJJJJI..'] },
    chunky: { at: [-1, -3], closed: ['.IIY..', 'YYYYY.', 'YYYYYY', 'ZZZZZ.', '.ZZZ..'], open: ['.IIY..', 'YYYYY.', 'YYYYYY', 'KKK...', 'ZZZZ..', '.ZZ...'], wide: ['.IIY..', 'YYYYY.', 'YYYYYY', 'KKK...', 'KKK...', 'ZZZZ..', '.ZZ...'] },
    puffin: { at: [-1, -3], closed: ['JYZ..', 'JYZZ.', 'JYZZZ', 'JYZZ.', 'JYZ..'], open: ['JYZ..', 'JYZZ.', 'JYZZZ', 'KK...', 'JYZZ.', 'JYZ..'], wide: ['JYZ..', 'JYZZ.', 'JYZZZ', 'KK...', 'KK...', 'JYZZ.'] },
  };

  // Eyes a species can have instead of the usual ones, per eye pose: [dx, dy,
  // rows] from the eye's spot; poses not listed keep the usual eye.
  const EYE_SETS = {
    spark: {
      open: [-1, -1, ['KFK', 'FFF', 'KFK', 'KKK']],
      blink: [-1, 1, ['KKK']],
      closed: [-1, 1, ['KKK']],
    },
  };
  // A mark on the breast, [dx, dy, rows] from the body's centre.
  const CHESTS = {
    star: [2, -2, ['..R..', '.RRR.', 'RRRRR', '.RRR.', '.R.R.']],
  };

  // Marks on the wing's feathers, worked out from each wing pose's rows:
  // bar, a stripe where the coverts meet the flight feathers; scallop,
  // alternate rows; spots; patch, the coverts away from the flight feathers.
  function wingMarks(rows, kind) {
    if (!kind) return rows;
    const at = (x, y) => rows[y]?.[x];
    const nearX = (x, y, r) => {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (at(x + i, y + j) === 'X') return true;
      return false;
    };
    return rows.map((row, y) => [...row].map((c, x) => {
      if (c !== 'W') return c;
      if (kind === 'bar') return at(x, y + 1) === 'X' || at(x + 1, y) === 'X' ? 'V' : c;
      if (kind === 'scallop') return y % 2 ? 'V' : c;
      if (kind === 'spots') return (x * 3 + y * 2) % 5 === 0 ? 'V' : c;
      if (kind === 'patch') return nearX(x, y, 1) ? c : 'V';
      return c;
    }).join(''));
  }

  // The animations: a list of poses and how long each frame lasts (ms).
  const ANIM = {
    idle: { ms: 600, frames: [{}, { sy: 1.03, sx: 0.99 }] },
    blink: { ms: 90, frames: [{ eye: 'blink' }, { eye: 'closed' }, { eye: 'blink' }] },
    look: { ms: 260, frames: [{ headDx: 1 }, { headDx: 1, headDy: -1 }, { headDx: 0 }] },
    walk: { ms: 110, frames: [{ legs: 'stepA', lift: 1 }, { legs: 'stand' }, { legs: 'stepB', lift: 1 }, { legs: 'stand' }] },
    fly: { ms: 70, frames: [{ wing: 'up', legs: 'tuck', tail: 1 }, { wing: 'mid', legs: 'tuck', lift: 1 }, { wing: 'down', legs: 'tuck', lift: 2, tail: -1 }, { wing: 'mid', legs: 'tuck', lift: 1 }] },
    // Calling the user: on its line, flapping, with little hops.
    hover: { ms: 80, frames: [{ wing: 'up' }, { wing: 'mid', lift: 1 }, { wing: 'down', lift: 2, sy: 1.04 }, { wing: 'mid', lift: 1 }, { wing: 'up' }, { wing: 'mid', sx: 1.06, sy: 0.94 }] },
    land: { ms: 70, frames: [{ sx: 1.15, sy: 0.82, wing: 'mid' }, { sx: 1.08, sy: 0.9 }, { sx: 0.97, sy: 1.04 }, {}] },
    takeoff: { ms: 60, frames: [{ sx: 1.12, sy: 0.85 }, { sx: 0.9, sy: 1.12, wing: 'up' }] },
    hop: { ms: 70, frames: [{ sx: 1.1, sy: 0.88 }, { sy: 1.08, lift: 3, legs: 'tuck' }, { lift: 5, legs: 'tuck', wing: 'mid' }, { lift: 3 }, { sx: 1.1, sy: 0.88 }, {}] },
    peck: { ms: 90, frames: [{ headDx: 1 }, { headDx: 2, headDy: 3, sy: 0.96 }, { headDx: 2, headDy: 4, sy: 0.94, beak: 'open' }, { headDx: 1, headDy: 1 }] },
    talk: { ms: 130, frames: [{ beak: 'open', headDy: -1 }, { beak: 'closed' }, { beak: 'open' }, { beak: 'closed', headDy: 1 }] },
    happy: { ms: 160, frames: [{ eye: 'happy', blush: true, sy: 1.04 }, { eye: 'happy', blush: true, sy: 0.97, headDx: 1 }] },
    startle: { ms: 80, frames: [{ eye: 'wide', sx: 1.12, sy: 1.12, crest: 2, wing: 'mid', beak: 'open' }, { eye: 'wide', sx: 1.15, sy: 1.1, crest: 2, wing: 'up', beak: 'open' }] },
    yawn: { ms: 220, frames: [{ eye: 'closed', beak: 'open', sy: 1.04 }, { eye: 'closed', beak: 'wide', wing: 'stretch', sy: 1.08, headDy: -1 }, { eye: 'closed', beak: 'wide', wing: 'stretch', sy: 1.1, headDy: -1 }, { eye: 'closed', beak: 'open', sy: 1.03 }, { eye: 'blink' }] },
    sleep: { ms: 900, frames: [{ eye: 'closed', headDy: 2, headDx: -1, sx: 1.06, sy: 0.95 }, { eye: 'closed', headDy: 2, headDx: -1, sx: 1.08, sy: 0.97 }] },
    celebrate: { ms: 90, frames: [{ eye: 'happy', wing: 'up', lift: 3, blush: true }, { eye: 'happy', wing: 'mid', lift: 6, blush: true }, { eye: 'happy', wing: 'down', lift: 4, blush: true }, { eye: 'happy', wing: 'mid', lift: 1, blush: true }] },
  };

  const api = { pipiFrame, ANIM, SIZE: N, GROUND, TAILS, CRESTS, BEAKS, EYE_SETS, CHESTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.pipiSprite = api;
})();
