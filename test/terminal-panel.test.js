// The terminal panel with real xterm in a hidden Electron window: pasting an
// image sends Ctrl+V to the agent (it reads the clipboard itself), pasting text
// sends the text, copying a line herdr wrapped over rows gives one line, and
// the columns fit inside the host's padding.
// Skipped where Electron cannot start.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const electron = path.join(__dirname, '..', 'node_modules', '.bin', 'electron');

function run() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [path.join(__dirname, 'fixtures', 'term-panel', 'main.js')], { encoding: 'utf8', env, timeout: 30000 });
  if (r.status !== 0) throw new Error(`electron exited ${r.status}: ${r.stderr}`);
  const line = r.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  return JSON.parse(line);
}

test('terminal panel paste and copy', { skip: !fs.existsSync(electron) && 'electron not installed' }, () => {
  const { fit, image, text, copyWrapped, copyPlain, link, hold, doubleOpen, statusAfterExit, reopen, errors } = run();
  assert.deepStrictEqual(errors, [], 'renderer errors');
  // the last column is fully visible with a gutter on the right, and the pane was resized to match
  assert.ok(fit.textWidth <= fit.contentWidth, `text ${fit.textWidth}px is wider than the host's ${fit.contentWidth}px`);
  assert.ok(fit.paddingRight >= 8);
  assert.deepStrictEqual(fit.resized, fit.size);
  // an image on the clipboard (even with text beside it) becomes Ctrl+V for the agent
  assert.deepStrictEqual(image, ['\x16']);
  // text only is pasted as text
  assert.deepStrictEqual(text, ['hello']);
  // one logical line that herdr drew over two rows copies without a line break
  assert.strictEqual(copyWrapped.text, copyWrapped.expected);
  // two separate lines keep their line break
  assert.strictEqual(copyPlain.text, 'first\nsecond');
  // the wrapped URL is one clickable link spanning rows 1-2, and clicking opens it
  assert.strictEqual(link.count, 1);
  assert.strictEqual(link.text, copyWrapped.expected);
  assert.strictEqual(link.range.start.y, 1);
  assert.strictEqual(link.range.end.y, 2);
  assert.deepStrictEqual(link.opened, [copyWrapped.expected]);
  // a frame arriving during a selection is held, then applied when the selection clears
  assert.strictEqual(hold.during, 'second');
  assert.strictEqual(hold.selection, 'first');
  assert.match(hold.status, /paused/);
  assert.strictEqual(hold.after, 'REPLACED');
  assert.strictEqual(hold.statusAfter, true);
  // two clicks in flight at once attach once; a dead stream can be reopened by clicking the desk
  assert.strictEqual(doubleOpen, 1);
  assert.match(statusAfterExit, /Terminal gone \(attach failed\)/);
  assert.strictEqual(reopen, 2);
});
