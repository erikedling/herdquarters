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

test('moving arms swap whole frames around a still shoulder; only the first shows without animation', () => {
  const w = load();
  const armGroup = (svg, cls) => {
    const start = svg.indexOf(`class="${cls}"`);
    const end = svg.slice(start + 1).search(/class="(arm |head)/);
    return svg.slice(start, end < 0 ? svg.length : start + 1 + end);
  };
  const frames = (group) => [...group.matchAll(/<g class="frame f\d"( visibility="hidden")?>/g)].map((m) => (m[1] ? 'hidden' : 'shown'));
  const cases = [['done', 'arm arm-r wave', 3], ['alert', 'arm arm-r raise', 2], ['blocked', 'arm arm-r raise', 2], ['working', 'arm arm-l', 2], ['working', 'arm arm-r', 2]];
  for (const [pose, cls, n] of cases) {
    const group = armGroup(w.figureOfficeSVG(pose, 0), cls);
    assert.deepStrictEqual(frames(group), ['shown', ...Array(n - 1).fill('hidden')], `${pose} ${cls}`);
    assert.ok(group.indexOf('<rect') < group.indexOf('class="frame'), `${pose} ${cls} keeps its shoulder outside the frames`);
  }
});

test('every arm frame hangs off the still arm, and hands keep a gap from the head and stay off the bubble', () => {
  const w = load();
  const group = (svg, open) => {
    const start = svg.indexOf(open);
    if (start < 0) return null;
    const re = /<g\b|<\/g>/g;
    re.lastIndex = start;
    for (let depth = 0, m; (m = re.exec(svg));) if (!(depth += m[0] === '</g>' ? -1 : 1)) return svg.slice(start, m.index);
  };
  const pixels = (svg) => [...svg.matchAll(/<rect x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)" fill="([^"]+)"/g)]
    .flatMap((r) => Array.from({ length: +r[3] * +r[4] }, (_, i) => ({ x: +r[1] + (i % +r[3]), y: +r[2] + Math.floor(i / +r[3]), fill: r[5] })));
  const near = (a, b) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
  const stillPart = (arm) => pixels(arm.slice(0, arm.indexOf('<g class="frame')));
  for (let c = 0; c < w.CHARACTERS.length; c++) {
    const skin = w.CHARACTERS[c].skin;
    const figures = [['working', 'arm arm-l'], ['working', 'arm arm-r'], ['done', 'arm arm-r wave'], ['alert', 'arm arm-r raise'], ['blocked', 'arm arm-r raise']]
      .map(([pose, cls]) => [`${pose} ${cls}`, w.figureOfficeSVG(pose, c), cls, 3]);
    // Nothing animates the visitor, so only its first frame ever shows.
    figures.push(['visitor', w.figureOfficeVisitorSVG(c), 'arm arm-r raise', 1]);
    for (const [label, svg, cls, shown] of figures) {
      const arm = group(svg, `<g class="${cls}`);
      const head = pixels(group(svg, '<g class="head">'));
      const headRight = Math.max(...head.filter((p) => p.fill === skin).map((p) => p.x));
      const headOnly = head.filter((p) => p.x <= headRight);
      const bubble = pixels(group(svg, '<g class="bubble">') || '');
      for (let f = 1; f <= shown && group(arm, `<g class="frame f${f}"`); f++) {
        const frame = pixels(group(arm, `<g class="frame f${f}"`));
        const reached = stillPart(arm);
        for (let grew = true; grew;) {
          grew = false;
          for (const p of frame) if (!reached.includes(p) && reached.some((q) => near(p, q))) { reached.push(p); grew = true; }
        }
        assert.ok(frame.every((p) => reached.includes(p)), `${label} f${f} of character ${c} has pixels off the arm`);
        if (!label.startsWith('working')) {
          const hand = frame.filter((p) => p.fill === skin);
          assert.ok(!hand.some((h) => headOnly.some((p) => near(h, p))), `${label} f${f} of character ${c} has its hand on the head`);
          assert.ok(!frame.some((h) => bubble.some((p) => p.x === h.x && p.y === h.y)), `${label} f${f} of character ${c} overlaps its bubble`);
        }
      }
    }
  }
});
