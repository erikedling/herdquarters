const test = require('node:test');
const assert = require('node:assert');
const { createFolderPicker } = require('../folder-picker');

function fakeDialog(answers) {
  const calls = [];
  const showOpenDialog = async (win, opts) => { calls.push(opts.defaultPath); return answers.shift(); };
  return { calls, pick: createFolderPicker(showOpenDialog) };
}

test('the first pick with no path leaves the folder to Electron', async () => {
  const { calls, pick } = fakeDialog([{ canceled: false, filePaths: ['/code/repo-a'] }]);
  assert.strictEqual(await pick(null, null), '/code/repo-a');
  assert.deepStrictEqual(calls, [undefined]);
});

test('a pick with no path opens where the last pick was', async () => {
  const { calls, pick } = fakeDialog([{ canceled: false, filePaths: ['/code/repo-a'] }, { canceled: false, filePaths: ['/code/repo-b'] }]);
  await pick(null, null);
  assert.strictEqual(await pick(null, ''), '/code/repo-b');
  assert.deepStrictEqual(calls, [undefined, '/code']);
});

test('a path from the caller wins over the last pick', async () => {
  const { calls, pick } = fakeDialog([{ canceled: false, filePaths: ['/code/repo-a'] }, { canceled: false, filePaths: ['/work/x'] }]);
  await pick(null, null);
  await pick(null, '/work');
  assert.deepStrictEqual(calls, [undefined, '/work']);
});

test('a cancelled dialog returns null and keeps the last folder', async () => {
  const { calls, pick } = fakeDialog([{ canceled: false, filePaths: ['/code/repo-a'] }, { canceled: true, filePaths: [] }, { canceled: false, filePaths: ['/code/repo-c'] }]);
  await pick(null, null);
  assert.strictEqual(await pick(null, null), null);
  await pick(null, null);
  assert.deepStrictEqual(calls, [undefined, '/code', '/code']);
});
