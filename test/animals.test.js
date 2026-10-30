// Office animals go where they are useful. The cat goes to a desk that needs
// the user, else onto a working desk. The dog celebrates a finished desk,
// else sits by one that needs the user, else lies by someone working. While
// a worker is away at the boss both wait by the door, and greet them when
// they are back. With nothing to do both stroll. Each floor on a tab gets its
// own animals, and a floor with nobody at a desk gets none.
const test = require('node:test');
const assert = require('node:assert');
const { SPECIES, GREET_MS, speciesFor, hasPeople, namesFor, target, animalSVG } = require('../renderer/animals.js');

const floor = (...poses) => ({ rooms: [{ desks: poses.map((pose, i) => ({ id: `p${i}`, pose })) }] });

test('cats and dogs are switched on separately; the paw hides both', () => {
  assert.deepStrictEqual(speciesFor({ cats: true, dogs: false }), ['cat']);
  assert.deepStrictEqual(speciesFor({ cats: false, dogs: true }), ['dog']);
  assert.deepStrictEqual(speciesFor({ cats: true, dogs: true }), ['cat', 'dog']);
  assert.deepStrictEqual(speciesFor({ cats: true, dogs: true, petsHidden: true }), []);
  assert.deepStrictEqual(speciesFor(undefined), []);
});

test('the cat goes to a blocked or alert desk first', () => {
  assert.deepStrictEqual(target('cat', floor('working', 'idle', 'blocked')), { mode: 'sit', deskId: 'p2' });
  assert.deepStrictEqual(target('cat', floor('alert', 'working')), { mode: 'sit', deskId: 'p0' });
});

test('with nobody waiting the cat naps on a working desk', () => {
  assert.deepStrictEqual(target('cat', floor('idle', 'working', 'done')), { mode: 'nap', deskId: 'p1' });
});

test('the dog celebrates a finished desk before anything else', () => {
  assert.deepStrictEqual(target('dog', floor('blocked', 'working', 'done')), { mode: 'wag', deskId: 'p2' });
  assert.deepStrictEqual(target('dog', floor('working', 'blocked')), { mode: 'sit', deskId: 'p1' });
  assert.deepStrictEqual(target('dog', floor('idle', 'working')), { mode: 'lie', deskId: 'p1' });
});

test('while a worker is away both animals wait for them', () => {
  for (const sp of ['cat', 'dog']) {
    assert.deepStrictEqual(target(sp, floor('idle', 'away')), { mode: 'wait', deskId: 'p1', awayIds: ['p1'] });
    assert.deepStrictEqual(target(sp, floor('working', 'away')), { mode: 'wait', deskId: 'p1', awayIds: ['p1'] });
    const prev = { mode: 'wait', deskId: 'p1', awayIds: ['p1'] };
    assert.deepStrictEqual(target(sp, floor('away', 'away'), prev), { mode: 'wait', deskId: 'p1', awayIds: ['p0', 'p1'] });
  }
});

test('a desk that needs the user still comes before waiting', () => {
  assert.deepStrictEqual(target('cat', floor('away', 'blocked')), { mode: 'sit', deskId: 'p1' });
  assert.deepStrictEqual(target('cat', floor('away', 'done')), { mode: 'wait', deskId: 'p0', awayIds: ['p0'] });
  assert.deepStrictEqual(target('dog', floor('away', 'done')), { mode: 'wag', deskId: 'p1' });
  assert.deepStrictEqual(target('dog', floor('away', 'alert')), { mode: 'sit', deskId: 'p1' });
});

test('the animals greet a worker who comes back, then carry on', () => {
  const waiting = { mode: 'wait', deskId: 'p0', awayIds: ['p0'] };
  for (const sp of ['cat', 'dog']) {
    for (const pose of ['working', 'idle']) {
      const greet = target(sp, floor(pose, 'idle'), waiting, 1000);
      assert.deepStrictEqual(greet, { mode: 'greet', deskId: 'p0', until: 1000 + GREET_MS });
      assert.deepStrictEqual(target(sp, floor(pose, 'blocked'), greet, 1000 + GREET_MS - 1), greet);
      assert.notStrictEqual(target(sp, floor(pose, 'idle'), greet, 1000 + GREET_MS).mode, 'greet');
    }
  }
  assert.deepStrictEqual(target('cat', floor('working', 'idle'), { mode: 'greet', deskId: 'p0', until: 2000 }, 2000), { mode: 'nap', deskId: 'p0' });
});

test('whichever away worker comes back first is greeted', () => {
  for (const sp of ['cat', 'dog']) {
    assert.deepStrictEqual(target(sp, floor('away', 'working'), { mode: 'wait', deskId: 'p0', awayIds: ['p0', 'p1'] }, 1000),
      { mode: 'greet', deskId: 'p1', until: 1000 + GREET_MS });
  }
});

test('no greeting when the worker does not come back', () => {
  const waiting = { mode: 'wait', deskId: 'p0', awayIds: ['p0'] };
  for (const sp of ['cat', 'dog']) {
    assert.deepStrictEqual(target(sp, floor('empty', 'idle'), waiting, 1000), { mode: 'stroll', deskId: null });
    assert.deepStrictEqual(target(sp, { rooms: [{ desks: [{ id: 'p1', pose: 'idle' }] }] }, waiting, 1000), { mode: 'stroll', deskId: null });
  }
  // gone away again in the middle of a greeting: back to waiting
  assert.deepStrictEqual(target('dog', floor('away'), { mode: 'greet', deskId: 'p0', until: 9000 }, 1000), { mode: 'wait', deskId: 'p0', awayIds: ['p0'] });
});

test('a quiet floor with someone at a desk gets strolling animals', () => {
  assert.ok(hasPeople(floor('idle', 'empty')));
  for (const sp of ['cat', 'dog']) {
    assert.deepStrictEqual(target(sp, floor('idle', 'empty')), { mode: 'stroll', deskId: null });
  }
});

test('a floor with nobody at a desk gets no animals', () => {
  assert.ok(!hasPeople({ rooms: [] }));
  assert.ok(!hasPeople({ rooms: [{ desks: [] }] }));
  assert.ok(!hasPeople(floor('empty', 'empty')));
  assert.ok(!hasPeople({ rooms: [{ desks: [{ id: 'seat:x:qa', seat: true, pose: 'empty' }, { id: 'p1', pose: 'empty' }] }] }));
});

test('anyone at a desk counts, even one away at the boss', () => {
  for (const pose of ['idle', 'unknown', 'working', 'blocked', 'done', 'alert', 'away']) {
    assert.ok(hasPeople(floor('empty', pose)), pose);
  }
});

test('free seats in a boss room do not count', () => {
  const f = { rooms: [{ desks: [{ id: 'seat:x:qa', seat: true, pose: 'blocked' }, { id: 'p1', pose: 'idle' }] }] };
  assert.strictEqual(target('cat', f).mode, 'stroll');
});

test('an animal stays at a desk that still qualifies instead of hopping', () => {
  assert.deepStrictEqual(target('cat', floor('working', 'working'), { mode: 'nap', deskId: 'p1' }), { mode: 'nap', deskId: 'p1' });
  // but leaves a nap for a desk that needs the user
  assert.deepStrictEqual(target('cat', floor('working', 'blocked'), { mode: 'nap', deskId: 'p0' }), { mode: 'sit', deskId: 'p1' });
});

test('floors on a tab get different animals, the same ones every time', () => {
  const keys = ['/a/.git', '/b/.git', '/c/.git'];
  for (const sp of ['cat', 'dog']) {
    const names = namesFor(sp, keys);
    assert.strictEqual(new Set(names.values()).size, keys.length);
    assert.deepStrictEqual(namesFor(sp, keys), names);
    for (const c of names.values()) assert.ok(c >= 0 && c < SPECIES[sp].length);
  }
});

test('each sprite has the poses its modes need', () => {
  const has = (svg, cls) => assert.match(svg, new RegExp(`class="[^"]*${cls}`));
  for (const cls of ['pet-sit', 'pet-nap', 'pet-walk', 'pet-heart']) has(animalSVG('cat', 0), cls);
  for (const cls of ['pet-sit', 'pet-lie', 'pet-walk', 'pet-tail', 'pet-heart']) has(animalSVG('dog', 0), cls);
});
