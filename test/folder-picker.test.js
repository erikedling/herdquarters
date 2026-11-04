const test = require('node:test');
const assert = require('node:assert');
const { createFolderPicker } = require('../folder-picker');

function fakeDialog(answers, home = '/Users/me') {
  const calls = [];
  const showOpenDialog = async (win, opts) => { calls.push(opts.defaultPath); return answers.shift(); };
  return { calls, pick: createFolderPicker(showOpenDialog, home) };
}

test('the first pick with no path opens in the home folder, not Downloads', async () => {
  const { calls, pick } = fakeDialog([{ canceled: false, filePaths: ['/code/repo-a'] }]);
  assert.strictEqual(await pick(null, null), '/code/repo-a');
  assert.deepStrictEqual(calls, ['/Users/me']);
});

test('a pick with no path opens where the last pick was', async () => {
  const { calls, pick } = fakeDialog([{ canceled: false, filePaths: ['/code/repo-a'] }, { canceled: false, filePaths: ['/code/repo-b'] }]);
  await pick(null, null);
  assert.strictEqual(await pick(null, ''), '/code/repo-b');
  assert.deepStrictEqual(calls, ['/Users/me', '/code']);
});

test('a path from the caller wins over the last pick', async () => {
  const { calls, pick } = fakeDialog([{ canceled: false, filePaths: ['/code/repo-a'] }, { canceled: false, filePaths: ['/work/x'] }]);
  await pick(null, null);
  await pick(null, '/work');
  assert.deepStrictEqual(calls, ['/Users/me', '/work']);
});

test('a cancelled dialog returns null and keeps the last folder', async () => {
  const { calls, pick } = fakeDialog([{ canceled: false, filePaths: ['/code/repo-a'] }, { canceled: true, filePaths: [] }, { canceled: false, filePaths: ['/code/repo-c'] }]);
  await pick(null, null);
  assert.strictEqual(await pick(null, null), null);
  await pick(null, null);
  assert.deepStrictEqual(calls, ['/Users/me', '/code', '/code']);
});
