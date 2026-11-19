// Move HQ art (location-art.js): every location has all its pieces, and the
// CSS, previews and dart board it makes are sound. A smoke test in node, with
// a stub document for set().
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { LOCATIONS, SURPRISE } = require('../renderer/locations');
const { RINGS } = require('../renderer/bird-throw');

function load() {
  const el = () => ({ id: '', textContent: '' });
  const head = { appendChild() {} };
  const body = { dataset: {} };
  const document = { getElementById: () => null, createElement: el, head, body };
  const window = {};
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer/location-art.js'), 'utf8'), vm.createContext({ window, document }), { filename: 'location-art.js' });
  return { art: window.officeLocationArt, body };
}

test('every location but the Office has all its pieces', () => {
  const { art } = load();
  for (const { id } of LOCATIONS.filter((l) => l.id !== 'office')) {
    const a = art.ART[id];
    assert.ok(a, id);
    for (const k of ['wall', 'window', 'door', 'plant', 'wear']) assert.strictEqual(typeof a[k], 'function', `${id}.${k}`);
    assert.ok(a.pets?.cat?.length && a.pets?.dog?.length, `${id}.pets`);
    assert.ok(a.board, `${id}.board`);
  }
});

test('the CSS a location makes is complete', () => {
  const { art } = load();
  for (const { id } of LOCATIONS.filter((l) => l.id !== 'office')) {
    const css = art.css(id);
    assert.ok(typeof css === 'string' && css.length > 1000, id);
    assert.ok(!/undefined|NaN/.test(css), `${id} has undefined or NaN`);
    assert.match(css, new RegExp(`data-location="${id}"`));
  }
  assert.strictEqual(art.css('office'), '');
});

test('every card has its own preview, so a new place cannot fall back to the Office', () => {
  const { art } = load();
  for (const { id } of [...LOCATIONS, SURPRISE]) {
    assert.ok(art.MINI[id], `${id} preview`);
    assert.match(art.preview(id), /^<svg/);
  }
});

test('each dart board paints a colour or nothing over the whole board', () => {
  const { art } = load();
  const R = 22, n = (R + 3) * 2;
  for (const { id } of LOCATIONS.filter((l) => l.id !== 'office')) {
    const paint = art.boardPaintFor(id);
    assert.strictEqual(typeof paint, 'function', id);
    let painted = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - n / 2, dy = y + 0.5 - n / 2;
      const a = Math.atan2(dy, dx) + Math.PI;
      const c = paint({ x, y, d: Math.hypot(dx, dy) / R, a, wedge: Math.floor((a / (Math.PI * 2)) * 20 + 0.5) % 2, rings: RINGS, R });
      assert.ok(c === null || c === undefined || /^#[0-9a-f]{6}$/i.test(c), `${id} at ${x},${y}: ${c}`);
      if (c) painted++;
    }
    assert.ok(painted > n * n * 0.6, `${id} paints the board`);
  }
  assert.strictEqual(art.boardPaintFor('office'), null);
});

test('set() puts the location on the body and back', () => {
  const { art, body } = load();
  assert.strictEqual(art.current(), 'office');
  assert.ok(art.set('beach'));
  assert.strictEqual(body.dataset.location, 'beach');
  assert.strictEqual(art.current(), 'beach');
  assert.strictEqual(typeof art.wear(), 'function');
  assert.match(art.dress('cat')('nap-under'), /<rect/);
  assert.strictEqual(art.dress('cat')('sit'), '');
  assert.ok(art.set('nowhere'));
  assert.strictEqual(art.current(), 'office');
  assert.strictEqual(body.dataset.location, undefined);
});
