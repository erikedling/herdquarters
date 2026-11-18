// PiPi's kinds of bird: the classic theme bird draws exactly what it always
// did, and every species is a whole bird in every pose, with a color for
// every pixel and a beak tip to throw it by.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { pipiFrame, ANIM, SIZE, GROUND } = require('../renderer/pipi-sprite');
const { SPECIES, byId, themePalette, rgb } = require('../renderer/pipi-species');
const { beakTip } = require('../renderer/bird-throw');
const classic = require('./fixtures/pipi-classic-frames.json');

const STUCK = { wing: 'up', legs: 'tuck', eye: 'wide', beak: 'open' };
const POSES = [STUCK];
for (const a of Object.values(ANIM)) POSES.push(...a.frames);
for (const eye of ['open', 'blink', 'closed', 'happy', 'wide']) for (const beak of ['closed', 'open', 'wide']) for (const wing of ['fold', 'up', 'mid', 'down', 'stretch']) for (const legs of ['stand', 'stepA', 'stepB', 'tuck']) POSES.push({ eye, beak, wing, legs, crest: 2, blush: true });
const hash = (g) => crypto.createHash('sha256').update(g.map((r) => r.map((k) => k || '.').join('')).join('\n')).digest('hex').slice(0, 16);

test('the theme bird is the default and draws every frame exactly as before species', () => {
  assert.strictEqual(SPECIES[0].id, 'theme');
  assert.strictEqual(SPECIES[0].palette, null);
  assert.strictEqual(Object.keys(classic).length, 348);
  for (const [pose, h] of Object.entries(classic)) {
    assert.strictEqual(hash(pipiFrame(JSON.parse(pose))), h, pose);
    assert.strictEqual(hash(pipiFrame(JSON.parse(pose), SPECIES[0].look)), h, pose);
  }
});

test('seventeen species plus the theme bird, each named after a real bird', () => {
  assert.strictEqual(SPECIES.length, 18);
  assert.strictEqual(new Set(SPECIES.map((s) => s.id)).size, 18);
  for (const sp of SPECIES.slice(1)) {
    assert.ok(sp.name && sp.latin && sp.note, sp.id);
    assert.ok(sp.palette, sp.id);
  }
});

test('an unknown species is the theme bird', () => {
  assert.strictEqual(byId('dodo').id, 'theme');
  assert.strictEqual(byId(undefined).id, 'theme');
  assert.strictEqual(byId('puffin').id, 'puffin');
});

test('every species is a whole, outlined bird inside the box in every pose, with a color for each pixel', () => {
  for (const sp of SPECIES) {
    const pal = sp.palette || themePalette([79, 124, 255]);
    // bird.js drops feathers in H and B.
    for (const k of ['H', 'B']) assert.match(pal[k], /^#|^rgb/, `${sp.id} ${k}`);
    for (const pose of POSES) {
      const g = pipiFrame(pose, sp.look);
      const where = `${sp.id} ${JSON.stringify(pose)}`;
      assert.strictEqual(g.length, SIZE, where);
      assert.ok(g[0].every((k) => !k) && g.every((row) => row.length === SIZE && !row[0] && !row[SIZE - 1]), `${where} inside the box`);
      const keys = new Set(g.flat().filter(Boolean));
      for (const k of keys) assert.ok(pal[k], `${where} has no color for ${k}`);
      assert.ok(keys.has('O') && keys.has('Y'), `${where} outlined, with a beak`);
    }
  }
});

test('standing, every species has its toes on the ground', () => {
  for (const sp of SPECIES) {
    const g = pipiFrame({}, sp.look);
    const last = Math.max(...g.map((row, y) => (row.includes('L') ? y : -1)));
    assert.strictEqual(last, GROUND - 1, sp.id);
  }
});

test('the dart tip is at the front of every beak, further out on a long one', () => {
  const tip = (id) => beakTip(pipiFrame(STUCK, byId(id).look), SIZE, GROUND);
  for (const sp of SPECIES) assert.ok(tip(sp.id).x > 10, sp.id);
  assert.ok(tip('keel-billed-toucan').x > tip('theme').x);
  assert.ok(tip('kingfisher').x > tip('theme').x);
  assert.ok(tip('star-sage').x > tip('theme').x);
});

test('the accent comes as hex or rgb()', () => {
  assert.deepStrictEqual(rgb('#4f7cff'), [79, 124, 255]);
  assert.deepStrictEqual(rgb(' rgb(79, 124, 255)'), [79, 124, 255]);
  assert.deepStrictEqual(themePalette(rgb('#4f7cff')).B, 'rgb(79,124,255)');
});
