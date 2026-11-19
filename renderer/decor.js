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
  // Rugs that suit a Move HQ location (locations.js): [rug, edge, accent].
  // The Office, and any place not listed, keeps RUGS and PATTERNS.
  const LOCATION_RUGS = {
    garden: { patterns: ['gingham', 'gingham-big'], rugs: [
      ['#fff4f2', '#e8606b'], ['#f2f7ff', '#5b8ee6'], ['#f3fbef', '#5fb35a'], ['#fffbea', '#e0b02f'],
      ['#fbf2ff', '#a77bd6'], ['#fff3ea', '#f08a4b'], ['#eefaf8', '#3fae9e'], ['#fff2f7', '#e0709c']] },
    space: { patterns: ['pad', 'pad-grid'], rugs: [
      ['#34405e', '#5ff2ff'], ['#3d3658', '#ff5da2'], ['#2f4a46', '#3fdc7a'], ['#4a4236', '#ffd23f'],
      ['#3a3a5e', '#b38cff'], ['#2e4256', '#7fb8ff'], ['#4a3640', '#ff8c5a'], ['#34464a', '#9ff0e0']] },
    beach: { patterns: ['towel', 'towel-wide'], rugs: [
      ['#c9eef5', '#3fb6d0', '#ffd23f'], ['#ffe0d6', '#f07a68', '#4fb3c9'], ['#fff1b8', '#f2b53a', '#e8606b'], ['#d6f5e3', '#4fbf8a', '#ff9eb5'],
      ['#ffe3f0', '#e86ea6', '#ffd23f'], ['#e6ecff', '#6a85e8', '#ff9e6b'], ['#fff0dc', '#f0954a', '#3fb6d0'], ['#e3f7f0', '#2fae8e', '#f07a68']] },
    north: { patterns: ['plaid', 'knit'], rugs: [
      ['#fbf1e1', '#d24b45', '#3f8f5f'], ['#f8dcd8', '#c9423c', '#ffffff'], ['#dcefdf', '#3f8f5f', '#d24b45'], ['#fff6e0', '#c9a227', '#d24b45'],
      ['#e8eef8', '#4a6fa8', '#ffffff'], ['#f5e6e0', '#8a5232', '#3f8f5f'], ['#fbeef0', '#b8384a', '#2e8b57'], ['#eef5ea', '#2e6b4a', '#c9a227']] },
    water: { patterns: ['wave', 'ripple'], rugs: [
      ['#d3f1e6', '#86cdb5'], ['#ffe0d6', '#f2a08a'], ['#f7ead0', '#d9bd86'], ['#fde4ea', '#e9a3b5'],
      ['#dff3ff', '#6cb8e0'], ['#efe8ff', '#a98be0'], ['#fff6d8', '#e6c25a'], ['#e0f5f2', '#4fbfb0']] },
    midsommar: { patterns: ['rag', 'rag-wide'], rugs: [
      ['#e8f1ff', '#a9c4ea', '#f2d98a'], ['#fdeaee', '#efb3c2', '#a9c4ea'], ['#faf4e6', '#e2cfa6', '#efb3c2'], ['#edf5e8', '#b5d6a6', '#a9c4ea'],
      ['#fff7dc', '#e9d28a', '#a9c4ea'], ['#f1ecfb', '#c6b6e6', '#f2d98a'], ['#fdefe6', '#efc0a5', '#b5d6a6'], ['#eef4fb', '#b9c9dd', '#efb3c2']] },
    haunted: { patterns: ['velvet', 'velvet-plain'], rugs: [
      ['#7a5a96', '#3e2754', '#d9b45a'], ['#9a4a5e', '#4e1a2c', '#d9b45a'], ['#6e5a8c', '#2e2142', '#b9a0e6'], ['#8a4a6e', '#3e1a34', '#e8c070'],
      ['#5a6e8c', '#2a3550', '#c9c9d9'], ['#4f6e5e', '#22382c', '#d9b45a'], ['#8c5a3c', '#4a2a18', '#e8c070'], ['#6e6e7e', '#34343e', '#b9a0e6']] },
    coffeehouse: { patterns: ['jute', 'checker-big'], rugs: [
      ['#efdcb8', '#b99062'], ['#f8efe0', '#a8825c'], ['#e2ead6', '#8aa37a'], ['#f8e1da', '#c98b7c'],
      ['#f3e6d0', '#8a5a3c'], ['#e6eef2', '#7a98a8'], ['#f6ecc8', '#c9a24a'], ['#efe2ee', '#a87ca0']] },
  };

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

  // A room's rug: { rug, edge, accent, pattern }, from the location's own
  // rugs when it has some.
  function roomDecor(key, location) {
    const { rugs, patterns } = LOCATION_RUGS[location] || { rugs: RUGS, patterns: PATTERNS };
    const h = hash(`room:${key}`);
    const [rug, edge, accent = edge] = pick(rugs, h);
    return { rug, edge, accent, pattern: pick(patterns, Math.floor(h / rugs.length)) };
  }

  const api = { hash, floorDecor, roomDecor, WALLS, WOODS, RUGS, PATTERNS, LOCATION_RUGS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.officeDecor = api;
})(typeof window !== 'undefined' ? window : globalThis);
