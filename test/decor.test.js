// Office personality: each floor its own walls and wood, each room its own
// rug, each agent their own mug and desk item; stable from the name.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { floorDecor, roomDecor, WALLS, RUGS, PATTERNS } = require('../renderer/decor');

test('a floor and a room always get the same decor', () => {
  assert.deepStrictEqual(floorDecor('web'), floorDecor('web'));
  assert.deepStrictEqual(roomDecor('/repos/web'), roomDecor('/repos/web'));
});

test('decor comes from the palettes', () => {
  const f = floorDecor('api');
  assert.ok(WALLS.some(([w, s]) => w === f.wall && s === f.stripe));
  const r = roomDecor('/repos/api');
  assert.ok(RUGS.some(([c, e]) => c === r.rug && e === r.edge));
  assert.ok(PATTERNS.includes(r.pattern));
});

test('spaces differ: a handful of repos use several walls and rugs', () => {
  const names = ['web', 'api', 'infra', 'herdquarters', 'mobile', 'docs', 'billing', 'auth'];
  assert.ok(new Set(names.map((n) => floorDecor(n).wall)).size >= 4);
  assert.ok(new Set(names.map((n) => roomDecor(n).rug)).size >= 4);
  assert.ok(new Set(names.map((n) => roomDecor(n).pattern)).size >= 3);
});

function figures() {
  const window = {};
  const ctx = vm.createContext({ window });
  for (const f of ['characters.js', 'figure.js', 'figure-office.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer', f), 'utf8'), ctx, { filename: f });
  return window;
}

test('each agent has their own desk: different people, different desktops', () => {
  const w = figures();
  assert.ok(w.DESK_ITEMS.length >= 8);
  const desks = [0, 1, 2, 3].map((c) => w.figureOfficeSVG('working', c));
  // the desk drawn without the person: everything outside the person group differs
  assert.strictEqual(new Set(desks).size, 4);
  // the same person always gets the same desk
  assert.strictEqual(w.figureOfficeSVG('idle', 2), w.figureOfficeSVG('idle', 2));
});

test('an empty desk has no personal item', () => {
  const w = figures();
  assert.strictEqual(w.figureOfficeSVG('empty', 0), w.figureOfficeSVG('empty', 5));
});

test('Move HQ: the Office keeps today\'s rugs exactly', () => {
  for (const key of ['/repos/web', '/repos/api', '/repos/web-search', 'infra']) {
    assert.deepStrictEqual(roomDecor(key, 'office'), roomDecor(key));
    const r = roomDecor(key);
    assert.ok(RUGS.some(([c, e]) => c === r.rug && e === r.edge));
    assert.ok(PATTERNS.includes(r.pattern));
  }
});

test('Move HQ: a location picks from its own rugs and patterns, by the same hash', () => {
  const { LOCATION_RUGS } = require('../renderer/decor');
  const { LOCATIONS } = require('../renderer/locations');
  for (const { id } of LOCATIONS.filter((l) => l.id !== 'office')) {
    const own = LOCATION_RUGS[id];
    assert.ok(own, `${id} has rugs`);
    const names = ['/repos/web', '/repos/api', '/repos/web-search', '/repos/web-onboarding', '/repos/docs', '/repos/billing'];
    const rooms = names.map((n) => roomDecor(n, id));
    for (const r of rooms) {
      assert.ok(own.rugs.some(([c, e]) => c === r.rug && e === r.edge), `${id}: ${r.rug}`);
      assert.ok(own.patterns.includes(r.pattern));
      assert.ok(r.accent);
    }
    assert.deepStrictEqual(roomDecor('/repos/web', id), roomDecor('/repos/web', id));
    assert.ok(new Set(rooms.map((r) => r.rug)).size >= 4, `${id}: rooms differ`);
  }
});

test('Move HQ: every location has 8 rugs of its own', () => {
  const { LOCATION_RUGS } = require('../renderer/decor');
  for (const [id, { rugs, patterns }] of Object.entries(LOCATION_RUGS)) {
    assert.strictEqual(rugs.length, 8, `${id}: ${rugs.length} rugs`);
    assert.strictEqual(new Set(rugs.map(([c]) => c)).size, rugs.length, `${id}: no two rugs alike`);
    assert.ok(patterns.length >= 2);
  }
});

// WCAG relative luminance and contrast ratio.
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test('Move HQ: rugs keep desks, figures and signs readable', () => {
  const { LOCATION_RUGS } = require('../renderer/decor');
  for (const [id, { rugs }] of Object.entries(LOCATION_RUGS)) {
    for (const [rug] of rugs) {
      // Light rugs under the ink outlines; the two dark places sit well under the white signs and nameplates.
      if (id === 'space' || id === 'haunted') assert.ok(contrast(rug, '#ffffff') >= 4.5, `${id} ${rug} vs the white sign`);
      else assert.ok(contrast(rug, '#2b2d42') >= 10, `${id} ${rug} vs ink`);
    }
  }
});
