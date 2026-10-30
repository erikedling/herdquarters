const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { parseEditor, openInEditor, envWithPath, raiseEditor, macAppFor } = require('../editor');

test('parseEditor() splits the command from its flags and refuses shell syntax', () => {
  assert.deepStrictEqual(parseEditor(' code '), { cmd: 'code', args: [] });
  assert.deepStrictEqual(parseEditor('cursor -n --wait'), { cmd: 'cursor', args: ['-n', '--wait'] });
  assert.deepStrictEqual(parseEditor('/usr/local/bin/zed'), { cmd: '/usr/local/bin/zed', args: [] });
  assert.throws(() => parseEditor(''), /No editor set/);
  assert.throws(() => parseEditor('code; rm -rf /'), /will not run/);
  assert.throws(() => parseEditor('code $(x)'), /will not run/);
});

test('envWithPath() adds the usual CLI folders once', () => {
  const env = envWithPath({ PATH: '/usr/bin:/opt/homebrew/bin' });
  assert.ok(env.PATH.startsWith('/usr/bin:/opt/homebrew/bin:/usr/local/bin'));
  assert.strictEqual(env.PATH.split(':').filter((p) => p === '/opt/homebrew/bin').length, 1);
});

function fakeSpawn(outcome) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    calls.push({ cmd, args, opts, child });
    child.unref = () => { child.unrefed = true; };
    setImmediate(() => outcome === 'ok' ? child.emit('spawn') : child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })));
    return child;
  };
  return { spawn, calls };
}
const dirFs = { statSync: () => ({ isDirectory: () => true }) };

test('openInEditor() runs the editor with the folder as its last argument, detached, no shell', async () => {
  const { spawn, calls } = fakeSpawn('ok');
  await openInEditor({ editor: 'code -n', folder: '/tmp/wt' }, { spawn, fs: dirFs, env: { PATH: '/usr/bin' } });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].cmd, 'code');
  assert.deepStrictEqual(calls[0].args, ['-n', '/tmp/wt']);
  assert.strictEqual(calls[0].opts.detached, true);
  assert.strictEqual(calls[0].opts.shell, undefined);
  assert.match(calls[0].opts.env.PATH, /\/opt\/homebrew\/bin/);
});

test('openInEditor() explains a missing command or folder', async () => {
  const { spawn } = fakeSpawn('enoent');
  await assert.rejects(openInEditor({ editor: 'nope', folder: '/tmp/wt' }, { spawn, fs: dirFs }), /Editor command not found: nope/);
  await assert.rejects(openInEditor({ editor: 'code', folder: 'relative' }, { spawn, fs: dirFs }), /No folder/);
  const goneFs = { statSync: () => { throw new Error('ENOENT'); } };
  await assert.rejects(openInEditor({ editor: 'code', folder: '/tmp/gone' }, { spawn, fs: goneFs }), /Folder is gone/);
});

test('openInEditor() raises the editor window once the CLI has handed over the folder', async () => {
  const { spawn, calls } = fakeSpawn('ok');
  const raised = [];
  await openInEditor({ editor: 'code', folder: '/tmp/wt' }, { spawn, fs: dirFs, raise: async (x) => { raised.push(x); } });
  assert.strictEqual(raised.length, 0);
  calls[0].child.emit('exit', 0);
  assert.deepStrictEqual(raised, [{ cmd: 'code', folder: '/tmp/wt' }]);
});

test('raiseEditor() unminimizes and activates known editors on macOS only', async () => {
  const runs = [];
  const execFile = (cmd, args, opts, cb) => { runs.push({ cmd, args }); cb(null); };
  assert.strictEqual(await raiseEditor({ cmd: '/usr/local/bin/code', folder: '/tmp/pixel-sprites' }, { execFile, platform: 'darwin' }), true);
  assert.strictEqual(runs[0].cmd, 'osascript');
  assert.deepStrictEqual(runs[0].args.slice(2), ['com.microsoft.VSCode', 'pixel-sprites']);
  assert.strictEqual(await raiseEditor({ cmd: 'code', folder: '/tmp/x' }, { execFile, platform: 'linux' }), false);
  assert.strictEqual(await raiseEditor({ cmd: 'myeditor', folder: '/tmp/x' }, { execFile, platform: 'darwin' }), false);
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(macAppFor('cursor'), 'com.todesktop.230313mzl4w4u92');
});
