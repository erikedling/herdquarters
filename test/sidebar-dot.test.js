// A working desk's sidebar dot fades slowly; blocked and alert keep their hard blink.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'style.css'), 'utf8');
const rule = (sel) => css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`))?.[1] || '';

test('the working dot pulses smoothly, not in steps', () => {
  const r = rule('.sb-pane.pose-working .sb-dot');
  assert.match(r, /animation: sb-dot-pulse 2s ease-in-out infinite/);
  assert.doesNotMatch(r, /steps\(/);
  assert.equal(css.match(/@keyframes sb-dot-pulse\b/g)?.length, 1);
});

test('blocked and alert dots still blink, idle and done stay still', () => {
  assert.match(rule('.sb-pane.pose-blocked .sb-dot'), /animation: blink 1s steps\(1\) infinite/);
  assert.match(rule('.sb-pane.pose-alert .sb-dot'), /animation: blink \.6s steps\(1\) infinite/);
  for (const pose of ['idle', 'done']) assert.doesNotMatch(rule(`.sb-pane.pose-${pose} .sb-dot`), /animation/);
});

test('reduced motion turns the pulse off', () => {
  const blocks = css.match(/@media \(prefers-reduced-motion: reduce\) \{[^\n]*\}/g) || [];
  assert.ok(blocks.some((b) => /\.sb-pane\.pose-working \.sb-dot \{ animation: none; \}/.test(b)));
});
