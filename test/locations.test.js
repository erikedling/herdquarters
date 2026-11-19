// Move HQ: which location the office is in on a given day. Seasonal visits
// win, then Surprise me's place of the day, else the user's pick.
const test = require('node:test');
const assert = require('node:assert');
const { LOCATIONS, SURPRISE, inEffect, status, applies, surpriseFor } = require('../renderer/locations');

// Local dates, as the app sees them.
const day = (m, d, y = 2026) => new Date(y, m - 1, d, 12);

test('the locations come in the settings order, Office first', () => {
  assert.deepStrictEqual(LOCATIONS.map((l) => l.id), ['office', 'garden', 'space', 'beach', 'north', 'water', 'midsommar', 'haunted', 'coffeehouse']);
  assert.strictEqual(LOCATIONS.find((l) => l.id === 'coffeehouse').name, 'Coffeehouse');
});

test('without a season the office is at the pick', () => {
  assert.deepStrictEqual(inEffect({ location: 'beach', seasonal: true }, day(3, 14)), { id: 'beach', why: 'pick' });
  assert.strictEqual(inEffect({}, day(3, 14)).id, 'office');
  assert.strictEqual(inEffect({ location: 'nowhere' }, day(3, 14)).id, 'office');
});

test('Halloween visit: Oct 24 to 31', () => {
  const s = { location: 'office', seasonal: true };
  assert.strictEqual(inEffect(s, day(10, 23)).id, 'office');
  assert.strictEqual(inEffect(s, day(10, 24)).id, 'haunted');
  assert.strictEqual(inEffect(s, day(10, 31)).id, 'haunted');
  assert.strictEqual(inEffect(s, day(11, 1)).id, 'office');
});

test('Christmas visit: Dec 1 to 26', () => {
  const s = { location: 'garden', seasonal: true };
  assert.strictEqual(inEffect(s, day(11, 30)).id, 'garden');
  assert.strictEqual(inEffect(s, day(12, 1)).id, 'north');
  assert.strictEqual(inEffect(s, day(12, 26)).id, 'north');
  assert.strictEqual(inEffect(s, day(12, 27)).id, 'garden');
});

test('midsummer visit: Jun 19 to 25', () => {
  const s = { location: 'space', seasonal: true };
  assert.strictEqual(inEffect(s, day(6, 18)).id, 'space');
  assert.strictEqual(inEffect(s, day(6, 19)).id, 'midsommar');
  assert.strictEqual(inEffect(s, day(6, 25)).id, 'midsommar');
  assert.strictEqual(inEffect(s, day(6, 26)).id, 'space');
});

test('the day turns at local midnight', () => {
  const s = { location: 'office', seasonal: true };
  assert.strictEqual(inEffect(s, new Date(2026, 9, 23, 23, 59)).id, 'office');
  assert.strictEqual(inEffect(s, new Date(2026, 9, 24, 0, 0)).id, 'haunted');
  assert.strictEqual(inEffect(s, new Date(2026, 11, 26, 23, 59)).id, 'north');
  assert.strictEqual(inEffect(s, new Date(2026, 11, 27, 0, 0)).id, 'office');
});

test('seasonal visits off: always the pick', () => {
  for (const d of [day(10, 28), day(12, 24), day(6, 21)]) assert.strictEqual(inEffect({ location: 'coffeehouse', seasonal: false }, d).id, 'coffeehouse');
});

test('seasonal visits are on unless turned off', () => {
  assert.strictEqual(inEffect({ location: 'office' }, day(12, 24)).id, 'north');
});

test('a season wins over Surprise me', () => {
  assert.deepStrictEqual(inEffect({ location: 'surprise', seasonal: true }, day(12, 24)).id, 'north');
  assert.strictEqual(inEffect({ location: 'surprise', seasonal: true }, day(12, 24)).why, 'season');
});

test('Surprise me: one place all day, never the Office, never yesterday\'s', () => {
  const s = { location: SURPRISE.id, seasonal: false };
  const morning = inEffect(s, new Date(2026, 2, 14, 0, 1)), night = inEffect(s, new Date(2026, 2, 14, 23, 59));
  assert.strictEqual(morning.why, 'surprise');
  assert.strictEqual(morning.id, night.id);
  let prev = null;
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const id = surpriseFor(new Date(2026, 0, 1 + i, 12), false);
    assert.notStrictEqual(id, 'office');
    assert.notStrictEqual(id, prev, `day ${i} repeats day ${i - 1}`);
    seen.add(id); prev = id;
  }
  assert.strictEqual(seen.size, LOCATIONS.length - 1);
});

test('the status line shows only when the office is not at the pick', () => {
  assert.strictEqual(status({ location: 'office', seasonal: true }, day(3, 14)), null);
  assert.strictEqual(status({ location: 'office', seasonal: true }, day(12, 24)), 'Today: North Pole (Christmas visit) · back to Office on Dec 27');
  assert.strictEqual(status({ location: 'garden', seasonal: true }, day(10, 30)), 'Today: Haunted mansion (Halloween visit) · back to Garden on Nov 1');
  assert.strictEqual(status({ location: 'north', seasonal: true }, day(12, 24)), null);
  assert.match(status({ location: 'surprise', seasonal: false }, day(3, 14)), /^Today: .+ \(Surprise me\) · somewhere new tomorrow$/);
});

test('locations apply in Modern and Toybox only', () => {
  assert.ok(applies('modern'));
  assert.ok(applies('toybox'));
  for (const s of ['workshop', 'quest', 'handheld', 'workstation']) assert.ok(!applies(s));
});

test('what a location gives everyone to wear sits in the head, so it sways with it', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const window = {};
  const ctx = vm.createContext({ window });
  for (const f of ['characters.js', 'figure.js', 'figure-office.js', 'animals.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer', f), 'utf8'), ctx, { filename: f });
  const hat = '<rect class="hat"/>';
  for (const pose of ['working', 'idle', 'blocked', 'alert', 'done']) {
    const svg = window.figureOfficeSVG(pose, 3, { wear: () => hat });
    assert.match(svg, /<g class="head">(?:(?!<\/g>).)*<rect class="hat"\/><\/g>/s, pose);
    assert.strictEqual(window.figureOfficeSVG(pose, 3, { wear: null }), window.figureOfficeSVG(pose, 3), `${pose} without a location is unchanged`);
  }
  assert.ok(!window.figureOfficeSVG('working', 3).includes('hat'), 'the next figure does not keep the hat');
  assert.match(window.figureOfficeVisitorSVG(2, '#f2c531', { wear: () => hat }), /class="hat"/);
  const poses = [];
  window.officeAnimals.animalSVG('cat', 0, (pose) => { poses.push(pose); return ''; });
  window.officeAnimals.animalSVG('dog', 0, (pose) => { poses.push(pose); return ''; });
  assert.deepStrictEqual(poses.sort(), ['lie', 'nap', 'nap-under', 'sit', 'sit', 'walk', 'walk'].sort());
  assert.strictEqual(window.officeAnimals.animalSVG('dog', 1, null), window.officeAnimals.animalSVG('dog', 1));
});

test('Surprise me never shows yesterday\'s place, not even right after a seasonal visit', () => {
  const s = { location: SURPRISE.id, seasonal: true };
  for (let y = 2026; y < 2046; y++) {
    for (const [m, d] of [[11, 1], [12, 27], [6, 26]]) {
      assert.notStrictEqual(inEffect(s, day(m, d, y)).id, inEffect(s, day(m, d - 1, y)).id, `${y}-${m}-${d}`);
    }
  }
  // and day by day over three years, seasons included
  let prev = null;
  for (let i = 0; i < 3 * 366; i++) {
    const id = inEffect(s, new Date(2026, 0, 1 + i, 12)).id;
    const season = inEffect(s, new Date(2026, 0, 1 + i, 12)).why === 'season';
    if (!season) assert.notStrictEqual(id, prev, `day ${i}`);
    prev = id;
  }
});

test('pickOf: a location id or surprise, the Office for anything else', () => {
  const { pickOf } = require('../renderer/locations');
  assert.strictEqual(pickOf({ location: 'surprise' }), 'surprise');
  assert.strictEqual(pickOf({ location: 'beach' }), 'beach');
  assert.strictEqual(pickOf({ location: 'nowhere' }), 'office');
  assert.strictEqual(pickOf({}), 'office');
});

test('Surprise me stays right long after a visit, and steps aside from the next one', () => {
  const s = { location: SURPRISE.id, seasonal: true };
  // a long run of steps-aside after a visit
  assert.notStrictEqual(inEffect(s, day(1, 10, 2058)).id, inEffect(s, day(1, 9, 2058)).id);
  // the day before a visit is not the visit's place
  for (const [y, m, d] of [[2027, 12, 1], [2028, 6, 19], [2035, 10, 24]]) {
    assert.notStrictEqual(inEffect(s, day(m, d - 1, y)).id, inEffect(s, day(m, d, y)).id, `${y}-${m}-${d - 1}`);
  }
  // no place two days running, seasons excepted, around 2058 too
  for (const start of [new Date(2057, 6, 1, 12), new Date(2030, 0, 1, 12)]) {
    let prev = null, prevSeason = false;
    for (let i = 0; i < 400; i++) {
      const e = inEffect(s, new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12));
      if (!(e.why === 'season' && prevSeason)) assert.notStrictEqual(e.id, prev, `${start.getFullYear()} +${i}`);
      prev = e.id; prevSeason = e.why === 'season';
    }
  }
});

test('a character with their own headphones wears only the location\'s pair', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const window = {};
  const ctx = vm.createContext({ window });
  for (const f of ['characters.js', 'figure.js', 'figure-office.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer', f), 'utf8'), ctx, { filename: f });
  const c = window.CHARACTERS.findIndex((ch) => (ch.extras || []).includes('headphones'));
  assert.ok(c >= 0, 'a character has headphones');
  const own = /fill="#3a4052"/;
  for (const pose of ['working', 'idle', 'blocked', 'done']) {
    assert.match(window.figureOfficeSVG(pose, c), own, `${pose}: their own pair in the Office`);
    assert.doesNotMatch(window.figureOfficeSVG(pose, c, { wear: () => '' }), own, `${pose}: only the location's pair`);
  }
  assert.doesNotMatch(window.figureOfficeVisitorSVG(c, '#f2c531', { wear: () => '' }), own);
  // everyone else is drawn the same either way, bar what the location adds
  const other = window.CHARACTERS.findIndex((ch) => !(ch.extras || []).includes('headphones'));
  assert.strictEqual(window.figureOfficeSVG('working', other, { wear: () => '' }), window.figureOfficeSVG('working', other));
});
