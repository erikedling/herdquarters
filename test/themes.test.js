// Every theme has a dark and a light version with every base color, so a
// theme can never leave a color from the previous one behind.
const test = require('node:test');
const assert = require('node:assert');
const { THEMES, STYLES, KEYS, byId, styleById, resolveMode, resolve } = require('../renderer/themes');

test('ten themes, each with every base color in both modes', () => {
  assert.strictEqual(THEMES.length, 10);
  assert.strictEqual(new Set(THEMES.map((x) => x.id)).size, 10);
  for (const theme of THEMES) for (const mode of ['dark', 'light']) {
    assert.deepStrictEqual(Object.keys(theme[mode]).sort(), [...KEYS].sort(), `${theme.id} ${mode}`);
    for (const k of KEYS) assert.match(theme[mode][k], /^#[0-9a-f]{6}$/, `${theme.id} ${mode} ${k}`);
  }
});

test('Midnight is the default, also for an unknown theme', () => {
  assert.strictEqual(THEMES[0].id, 'midnight');
  assert.strictEqual(byId('gone').id, 'midnight');
  assert.strictEqual(byId('ocean').id, 'ocean');
});

test('System follows the OS; anything else falls back to dark', () => {
  assert.strictEqual(resolveMode('system', true), 'dark');
  assert.strictEqual(resolveMode('system', false), 'light');
  assert.strictEqual(resolveMode('light', true), 'light');
  assert.strictEqual(resolveMode(undefined, false), 'dark');
});

test('Modern and five retro styles; each retro style brings every base color and its own mode', () => {
  assert.deepStrictEqual(STYLES.map((s) => s.id), ['modern', 'workshop', 'quest', 'handheld', 'toybox', 'workstation']);
  for (const s of STYLES.slice(1)) {
    assert.deepStrictEqual(Object.keys(s.colors).sort(), [...KEYS].sort(), s.id);
    for (const k of KEYS) assert.match(s.colors[k], /^#[0-9a-f]{6}$/, `${s.id} ${k}`);
    assert.ok(['dark', 'light'].includes(s.mode), s.id);
  }
  assert.strictEqual(styleById('gone').id, 'modern');
});

test('a retro style wins over the theme and dark/light; Modern uses them', () => {
  assert.deepStrictEqual(resolve('ocean', 'dark', 'modern', false), { style: 'modern', theme: 'ocean', mode: 'dark', colors: byId('ocean').dark });
  assert.deepStrictEqual(resolve('ocean', 'system', undefined, false).mode, 'light');
  const quest = resolve('ocean', 'light', 'quest', false);
  assert.strictEqual(quest.style, 'quest');
  assert.strictEqual(quest.mode, 'dark');
  assert.strictEqual(quest.colors, styleById('quest').colors);
});
