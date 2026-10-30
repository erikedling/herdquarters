// OFFICE_USER_DATA must not reach the real data folder by any spelling: the
// same path, another case, a symlink or a subfolder are all refused.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isRealDataFolder } = require('../data-folder');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'data-folder-'));
const real = path.join(root, 'agent-office');
fs.mkdirSync(real);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('the same path is refused', () => {
  assert.strictEqual(isRealDataFolder(real, real), true);
  assert.strictEqual(isRealDataFolder(`${real}/`, real), true);
});

test('a different case is refused where the disk ignores case', { skip: !fs.existsSync(path.join(root, 'AGENT-OFFICE')) && 'case-sensitive file system' }, () => {
  assert.strictEqual(isRealDataFolder(path.join(root, 'Agent-Office'), real), true);
});

test('a symlink to the real folder is refused', () => {
  const link = path.join(root, 'link');
  fs.symlinkSync(real, link);
  assert.strictEqual(isRealDataFolder(link, real), true);
});

test('a folder inside the real one is refused', () => {
  const sub = path.join(real, 'dev');
  fs.mkdirSync(sub);
  assert.strictEqual(isRealDataFolder(sub, real), true);
});

test('a not-yet-created folder inside the real one is refused, and not created', () => {
  const later = path.join(real, 'orchestrators', 'x');
  assert.strictEqual(isRealDataFolder(later, real), true);
  assert.strictEqual(fs.existsSync(path.join(real, 'orchestrators')), false);
});

test('a missing folder under a symlink or another case still resolves to the real one', () => {
  const link = path.join(root, 'link2');
  fs.symlinkSync(real, link);
  assert.strictEqual(isRealDataFolder(path.join(link, 'not-yet'), real), true);
  if (fs.existsSync(path.join(root, 'AGENT-OFFICE'))) assert.strictEqual(isRealDataFolder(path.join(root, 'Agent-Office', 'not-yet'), real), true);
});

test('a child whose name starts with two dots is inside', () => {
  assert.strictEqual(isRealDataFolder(path.join(real, '..dev'), real), true);
  assert.strictEqual(isRealDataFolder(path.join(root, '..dev'), real), false);
});

test('before the real folder exists, another case is refused on macOS and Windows', () => {
  const missing = path.join(root, 'fresh2', 'agent-office');
  const shouted = path.join(root, 'fresh2', 'Agent-Office');
  assert.strictEqual(isRealDataFolder(shouted, missing, 'darwin'), true);
  assert.strictEqual(isRealDataFolder(shouted, missing, 'win32'), true);
  assert.strictEqual(isRealDataFolder(shouted, missing, 'linux'), false);
  assert.strictEqual(fs.existsSync(path.join(root, 'fresh2')), false);
});

test('an unrelated folder, or a sibling sharing the prefix, is allowed', () => {
  const other = path.join(root, 'agent-office-dev');
  fs.mkdirSync(other);
  assert.strictEqual(isRealDataFolder(other, real), false);
  assert.strictEqual(isRealDataFolder(root, real), false);
});

test('a real folder that does not exist yet still compares by path', () => {
  const missing = path.join(root, 'fresh', 'agent-office');
  assert.strictEqual(isRealDataFolder(missing, missing), true);
  assert.strictEqual(isRealDataFolder(path.join(root, 'elsewhere'), missing), false);
});
