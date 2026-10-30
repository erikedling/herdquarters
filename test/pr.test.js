const test = require('node:test');
const assert = require('node:assert');
const { findPullRequest } = require('../pr');

const dirFs = { existsSync: () => true };
function fakeExecFile(err, stdout = '', stderr = '') {
  const calls = [];
  const execFile = (cmd, args, opts, cb) => { calls.push({ cmd, args, opts }); setImmediate(() => cb(err, stdout, stderr)); };
  return { execFile, calls };
}

test('findPullRequest() asks gh for the PR of the folder\'s branch, without a shell', async () => {
  const { execFile, calls } = fakeExecFile(null, '{"url":"https://github.com/o/r/pull/12","number":12,"state":"OPEN"}');
  const pr = await findPullRequest('/tmp/wt', { execFile, fs: dirFs, env: { PATH: '/usr/bin' } });
  assert.deepStrictEqual(pr, { url: 'https://github.com/o/r/pull/12', number: 12, state: 'OPEN' });
  assert.strictEqual(calls[0].cmd, 'gh');
  assert.deepStrictEqual(calls[0].args, ['pr', 'view', '--json', 'url,number,state']);
  assert.strictEqual(calls[0].opts.cwd, '/tmp/wt');
  assert.strictEqual(calls[0].opts.shell, undefined);
  assert.match(calls[0].opts.env.PATH, /\/opt\/homebrew\/bin/);
});

test('findPullRequest() gives null when the branch has no PR', async () => {
  const { execFile } = fakeExecFile(new Error('exit 1'), '', 'no pull requests found for branch "main"\n');
  assert.strictEqual(await findPullRequest('/tmp/wt', { execFile, fs: dirFs }), null);
});

test('findPullRequest() explains a missing or logged-out gh', async () => {
  const enoent = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
  await assert.rejects(findPullRequest('/tmp/wt', { ...fakeExecFile(enoent), fs: dirFs }), /not installed/);
  await assert.rejects(findPullRequest('/tmp/wt', { ...fakeExecFile(new Error('exit 4'), '', 'To get started with GitHub CLI, please run:  gh auth login'), fs: dirFs }), /not logged in/);
  await assert.rejects(findPullRequest('/tmp/gone', { ...fakeExecFile(enoent), fs: { existsSync: () => false } }), /Folder is gone/);
  await assert.rejects(findPullRequest('relative', fakeExecFile(null)), /No folder/);
});
