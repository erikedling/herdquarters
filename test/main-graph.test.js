// A live update reloads only the window: any file the main process loads must
// not count as live, or main would keep the old copy while the window gets the new.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { isLive, MAIN_LOADS } = require('../updater');

const root = path.join(__dirname, '..');

function graph(entries) {
  const seen = new Set();
  const walk = (file) => {
    const rel = path.relative(root, file);
    if (seen.has(rel)) return;
    seen.add(rel);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      const target = path.resolve(path.dirname(file), m[1]);
      const found = [target, `${target}.js`, `${target}.json`, path.join(target, 'index.js')].find((f) => fs.existsSync(f) && fs.statSync(f).isFile());
      if (found && found.endsWith('.js')) walk(found);
      else if (found) seen.add(path.relative(root, found));
    }
    // Text files main reads at startup, like the briefs.
    for (const m of src.matchAll(/path\.join\(__dirname,\s*'([^']+\.(?:md|json))'\)/g)) seen.add(path.relative(root, path.join(path.dirname(file), m[1])));
  };
  for (const e of entries) walk(path.join(root, e));
  return seen;
}

test('nothing the main process or preload loads counts as a live update', () => {
  const files = graph(['main.js', 'preload.js']);
  assert.ok(files.has('notes.js') && files.has('renderer/note-rows.js'), 'the walk reaches shared renderer modules');
  const live = [...files].filter(isLive);
  assert.deepStrictEqual(live, [], `add these to MAIN_LOADS in updater.js: ${live.join(', ')}`);
});

test('MAIN_LOADS has no stale entries', () => {
  const files = graph(['main.js', 'preload.js']);
  for (const f of MAIN_LOADS) assert.ok(files.has(f), `${f} is no longer loaded by main`);
});
