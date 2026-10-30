// You must be able to drag-select and copy from an attached agent terminal.
// `herdr agent attach` switches mouse reporting on, and xterm then routes
// every drag to the application instead of selecting text. This drives real
// xterm in a hidden Electron window; skipped where Electron cannot start.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const electron = path.join(__dirname, '..', 'node_modules', '.bin', 'electron');

function run() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [path.join(__dirname, 'fixtures', 'term-select', 'main.js')], { encoding: 'utf8', env, timeout: 30000 });
  if (r.status !== 0) throw new Error(`electron exited ${r.status}: ${r.stderr}`);
  const line = r.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  return JSON.parse(line);
}

test('drag-select works in an attached terminal even with mouse reporting on', { skip: !fs.existsSync(electron) && 'electron not installed' }, () => {
  const { without, withFix, plain, copyRole } = run();
  // control: with no mouse reporting at all the same drag selects, so the harness is sound
  assert.ok(plain.selection.startsWith('hello'), `control selected ${JSON.stringify(plain.selection)}`);
  // the bug: xterm is in mouse mode, the drag went to the app, nothing was selected
  assert.strictEqual(without.mode, 'any');
  assert.strictEqual(without.selection, '');
  assert.ok(without.sentMouse, 'without the fix the drag is reported to the application');
  // the fix: xterm no longer tracks the mouse locally, so the drag selects
  assert.strictEqual(withFix.mode, 'none');
  assert.ok(withFix.selection.startsWith('hello'), `selected ${JSON.stringify(withFix.selection)}`);
  assert.ok(!withFix.sentMouse, 'with the fix the drag is not reported to the application');
  // Cmd+C reaches the page through Electron's default Edit menu
  assert.ok(copyRole, 'application menu has an Edit > Copy role');
});
