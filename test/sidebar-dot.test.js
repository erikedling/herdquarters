// A working desk's sidebar dot fades slowly; blocked and alert keep their hard blink.
// On a focused row the dot gets a solid ring in the row's ink, so it shows even when
// its colour matches the highlight.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'renderer', f), 'utf8');
const css = read('style.css');
const retro = read('retro.css');
const WORKING = '.sb-pane.pose-working .sb-dot';

function blocks(src) {
  const out = [];
  let depth = 0, start = 0, open = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '{' && depth++ === 0) open = i;
    else if (src[i] === '}' && --depth === 0) {
      out.push({ prelude: src.slice(start, open).replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: src.slice(open + 1, i) });
      start = i + 1;
    }
  }
  return out;
}

const top = blocks(css);
const rule = (sel) => top.filter((b) => b.prelude === sel).map((b) => b.body).join(';');

test('the working dot pulses smoothly, not in steps', () => {
  const r = rule(WORKING);
  assert.match(r, /animation:[^;]*\bsb-dot-pulse\b/);
  assert.doesNotMatch(r, /steps\(/);
  assert.ok(top.some((b) => b.prelude === '@keyframes sb-dot-pulse'));
});

test('blocked and alert dots still blink in steps, idle and done stay still', () => {
  for (const pose of ['blocked', 'alert']) assert.match(rule(`.sb-pane.pose-${pose} .sb-dot`), /animation:[^;]*\bsb-dot-blink\b[^;]*steps\(/);
  for (const pose of ['idle', 'done']) assert.doesNotMatch(rule(`.sb-pane.pose-${pose} .sb-dot`), /animation/);
});

test('reduced motion turns the pulse off', () => {
  const reduced = top.filter((b) => /^@media\b.*prefers-reduced-motion:\s*reduce/.test(b.prelude));
  assert.ok(reduced.some((m) => blocks(m.body).some((b) => b.prelude.split(',').map((s) => s.trim()).includes(WORKING) && /animation:\s*none/.test(b.body))));
});

test('dot animations fade the fill, not opacity, so the focus ring never fades', () => {
  for (const name of ['sb-dot-pulse', 'sb-dot-blink']) {
    const body = top.find((b) => b.prelude === `@keyframes ${name}`)?.body || '';
    assert.match(body, /background-color/, name);
    assert.doesNotMatch(body, /opacity/, name);
  }
});

test('a focused row rings its dot with a hard 1px edge in the row ink', () => {
  assert.match(rule('.sb-row.focused .sb-dot'), /box-shadow:\s*0 0 0 1px currentColor/);
  assert.match(rule('.sb-row.focused'), /(^|;|\s)color:/);
});

test('every style that repaints the focused row also sets its ink, which the ring follows', () => {
  const repainted = blocks(retro).filter((x) => /\.sb-row\.focused$/.test(x.prelude) && /background/.test(x.body));
  assert.ok(repainted.length);
  for (const b of repainted) assert.match(b.body, /(^|;|\s)color:/, b.prelude);
});
