// Personality for the office layout: each repo's floor gets its own wall and
// wood, each room (checkout) its own rug. Picked from the name, so a space
// always looks the same and two spaces rarely match. Pure, so
// test/decor.test.js can check it in node; app.js puts the result on the
// elements as CSS variables (office.css reads them).
(function (root) {
  // [wall, wall stripe]
  const WALLS = [
    ['#eef3ff', '#e3eaf8'], // sky
    ['#e9f7ec', '#dcefe0'], // mint
    ['#fff1e3', '#fbe3cc'], // peach
    ['#f3ecff', '#e7dcfb'], // lavender
    ['#fffbe0', '#f6efc2'], // butter
    ['#ffeef2', '#fbdde5'], // rose
    ['#e6f6f8', '#d5ecef'], // aqua
    ['#f1efe9', '#e5e1d7'], // linen
  ];
  // [plank, plank line]
  const WOODS = [
    ['#efcfa6', '#e3bd8f'], // oak
    ['#d9a77a', '#c98f60'], // cherry
    ['#f3e2c4', '#e6cfa8'], // birch
    ['#c79a6e', '#b5855a'], // walnut
    ['#e8d6b9', '#d8c19d'], // ash
  ];
  // [rug, rug edge]
  const RUGS = [
    ['#dce8ff', '#b9cbef'], // blue
    ['#d8f3df', '#a9dcb7'], // green
    ['#ffe3cc', '#f2bb92'], // apricot
    ['#efe0ff', '#cfb4f2'], // lilac
    ['#fff3b8', '#e6cf6a'], // yellow
    ['#ffdbe4', '#f0a9bd'], // pink
    ['#d4f1f4', '#9ad3da'], // teal
    ['#ece4d8', '#c9b79c'], // oatmeal
  ];
  const PATTERNS = ['plain', 'stripes', 'dots', 'border', 'checker'];

  // A small, stable hash of a string (FNV-1a).
  function hash(s) {
    let h = 0x811c9dc5;
    for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  const pick = (list, h) => list[h % list.length];

  // A repo's floor: { wall, stripe, plank, plankLine }.
  function floorDecor(key) {
    const h = hash(`floor:${key}`);
    const [wall, stripe] = pick(WALLS, h);
    const [plank, plankLine] = pick(WOODS, Math.floor(h / WALLS.length));
    return { wall, stripe, plank, plankLine };
  }

  // A room's rug: { rug, edge, pattern }.
  function roomDecor(key) {
    const h = hash(`room:${key}`);
    const [rug, edge] = pick(RUGS, h);
    return { rug, edge, pattern: pick(PATTERNS, Math.floor(h / RUGS.length)) };
  }

  const api = { hash, floorDecor, roomDecor, WALLS, WOODS, RUGS, PATTERNS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.officeDecor = api;
})(typeof window !== 'undefined' ? window : globalThis);
