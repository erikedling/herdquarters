// Office sprites: an idle agent must look different from a working one at a
// glance, not just by the laptop. Idle leans back with hands behind the head
// and eyes shut; working types at a glowing laptop.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load() {
  const window = {};
  const ctx = vm.createContext({ window });
  for (const f of ['figure.js', 'figure-office.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../renderer', f), 'utf8'), ctx, { filename: f });
  }
  return window;
}

test('idle and working seated poses differ in posture, not just screen colour', () => {
  const w = load();
  const working = w.figureOfficeSVG('working', 0);
  const idle = w.figureOfficeSVG('idle', 0);
  const personOf = (svg) => svg.slice(svg.indexOf('<g class="person')).replace(/pose-\w+/, '');
  assert.notStrictEqual(personOf(working), personOf(idle));
  assert.match(idle, /class="person pose-idle"/);
});

test('a working laptop glows; an idle one does not', () => {
  const w = load();
  assert.match(w.figureOfficeSVG('working', 0), /class="glow"/);
  assert.doesNotMatch(w.figureOfficeSVG('idle', 0), /class="glow"/);
});

test('every pose of every character draws, with the name on the desk', () => {
  const w = load();
  for (let c = 0; c < w.CHARACTERS.length; c++) {
    for (const pose of ['working', 'idle', 'unknown', 'blocked', 'alert', 'done', 'away']) {
      const svg = w.figureOfficeSVG(pose, c);
      const name = w.CHARACTER_NAMES[c];
      assert.ok(svg.includes(`>${name[0]}${name.slice(1).toLowerCase()}</text>`), `${name} ${pose}`);
      assert.doesNotMatch(svg, /undefined|NaN/, `${name} ${pose}`);
    }
    assert.doesNotMatch(w.figureOfficeVisitorSVG(c, '#f2c531'), /undefined|NaN/);
  }
  assert.doesNotMatch(w.figureOfficeSVG('empty', 0), /<text/);
});

test('idle desk has steam rising from the mug', () => {
  const w = load();
  assert.match(w.figureOfficeSVG('idle', 3), /class="steam"/);
  assert.doesNotMatch(w.figureOfficeSVG('working', 3), /class="steam"/);
});

test('Aida is the 21st character and wears the same shirt as Emma', () => {
  const w = load();
  const aida = w.CHARACTER_NAMES.indexOf('AIDA');
  assert.ok(aida >= 0);
  assert.strictEqual(w.CHARACTER_NAMES.length, w.CHARACTERS.length);
  assert.deepStrictEqual(w.CHARACTERS[aida].top, w.CHARACTERS[w.CHARACTER_NAMES.indexOf('EMMA')].top);
});
