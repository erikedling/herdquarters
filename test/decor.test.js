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
