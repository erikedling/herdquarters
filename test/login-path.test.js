// shell/login-path.js: a Dock app gets launchd's short PATH, so it asks the
// user's shell once. Fake shells stand in for zsh.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loginShellPath, mergePath, importLoginPath } = require('../shell/login-path');

function fakeShell(body) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hq-shell-')), 'sh');
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

test('reads PATH from an interactive login shell, past whatever it prints first', () => {
  const shell = fakeShell([
    'echo "Welcome back"',
    '[ "$1" = "-ilc" ] || exit 3',
    'PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/bin"',
    'eval "$2"',
  ].join('\n'));
  assert.strictEqual(loginShellPath({ shell, env: { HOME: '/Users/me', PATH: '/usr/bin:/bin' } }), '/opt/homebrew/bin:/Users/me/.local/bin:/usr/bin');
});

test('a shell that fails, hangs or prints nothing gives null', () => {
  assert.strictEqual(loginShellPath({ shell: fakeShell('exit 1') }), null);
  assert.strictEqual(loginShellPath({ shell: fakeShell('sleep 5'), timeoutMs: 200 }), null);
  assert.strictEqual(loginShellPath({ shell: fakeShell('echo hello') }), null);
  assert.strictEqual(loginShellPath({ shell: '/no/such/shell' }), null);
});

test('the shell PATH comes first, then the app’s own, then the usual install folders, without repeats', () => {
  assert.strictEqual(
    mergePath('/usr/bin:/bin:/usr/sbin:/sbin', '/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin:/bin', ['/opt/homebrew/bin', '/usr/local/bin']),
    '/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin',
  );
  assert.strictEqual(mergePath('/usr/bin:/bin', null, ['/opt/homebrew/bin']), '/usr/bin:/bin:/opt/homebrew/bin');
  assert.strictEqual(mergePath('', '', []), '');
});

test('importLoginPath() sets PATH on the env it is given and keeps the fallbacks when the shell fails', () => {
  const env = { PATH: '/usr/bin:/bin' };
  const r = importLoginPath(env, { shell: fakeShell('exit 1'), extra: ['/opt/homebrew/bin'] });
  assert.deepStrictEqual(r, { path: '/usr/bin:/bin:/opt/homebrew/bin', fromShell: false });
  assert.strictEqual(env.PATH, '/usr/bin:/bin:/opt/homebrew/bin');
  const ok = importLoginPath(env, { shell: fakeShell('PATH=/x/bin; eval "$2"'), extra: [] });
  assert.strictEqual(ok.fromShell, true);
  assert.strictEqual(env.PATH.split(':')[0], '/x/bin');
});
