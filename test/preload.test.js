// preload.js runs sandboxed: a require() of anything but Electron's built-ins
// fails silently at startup and leaves the renderer without window.office
// (the app then sits at "connecting…" forever). Load the real file and check.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const electron = path.join(__dirname, '..', 'node_modules', '.bin', 'electron');

test('preload.js loads in a sandboxed window and exposes window.office', { skip: !fs.existsSync(electron) && 'electron not installed' }, () => {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [path.join(__dirname, 'fixtures', 'preload', 'main.js')], { encoding: 'utf8', env, timeout: 30000 });
  if (r.status !== 0) throw new Error(`electron exited ${r.status}: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop());
  assert.deepStrictEqual(out.errors, []);
  assert.strictEqual(out.office, 'object');
  assert.strictEqual(out.appName, 'Testname');
  for (const key of ['onSnapshot', 'term', 'orchestrator', 'slack', 'assistant', 'clipboardPeek', 'openExternal', 'openInEditor', 'findPullRequest', 'devSettings']) assert.ok(out.keys.includes(key), key);
});
