const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { shouldAutostart, socketInUse, serverEnv, startHerdrServer, COOLDOWN_MS } = require('../autostart');

const base = { enabled: true, code: 'ENOENT', starting: false, everAnswered: false, lastAttemptAt: null, now: 1_000_000, socketPath: '/s.sock' };
const free = { socketHeld: async () => false };
const held = { socketHeld: async () => true };

test('shouldAutostart() starts herdr when there is no socket file', async () => {
  const unused = { socketHeld: async () => assert.fail('no need to look for a holder') };
  assert.strictEqual(await shouldAutostart(base, unused), true);
});

test('shouldAutostart() treats a refused connection as no server only when nobody holds the socket', async () => {
  const asked = [];
  assert.strictEqual(await shouldAutostart({ ...base, code: 'ECONNREFUSED' }, { socketHeld: async (p) => { asked.push(p); return false; } }), true);
  assert.deepStrictEqual(asked, ['/s.sock']);
  assert.strictEqual(await shouldAutostart({ ...base, code: 'ECONNREFUSED' }, held), false); // full listen backlog
});

test('shouldAutostart() leaves a slow or answering herdr alone', async () => {
  assert.strictEqual(await shouldAutostart({ ...base, code: undefined }, free), false); // timeout, connection closed
  assert.strictEqual(await shouldAutostart({ ...base, code: 'not_found' }, free), false); // herdr answered with an error
  assert.strictEqual(await shouldAutostart({ ...base, code: 'EACCES' }, free), false);
});

test('shouldAutostart() needs the setting on, and unknown counts as off', async () => {
  assert.strictEqual(await shouldAutostart({ ...base, enabled: false }, free), false);
  assert.strictEqual(await shouldAutostart({ ...base, enabled: null }, free), false);
});

test('shouldAutostart() only starts herdr before it has ever answered', async () => {
  assert.strictEqual(await shouldAutostart({ ...base, everAnswered: true }, free), false);
  assert.strictEqual(await shouldAutostart({ ...base, everAnswered: true, code: 'ECONNREFUSED' }, free), false);
});

test('shouldAutostart() waits for a start in progress and out the cool-down', async () => {
  assert.strictEqual(await shouldAutostart({ ...base, starting: true }, free), false);
  assert.strictEqual(await shouldAutostart({ ...base, lastAttemptAt: base.now - COOLDOWN_MS + 1 }, free), false);
  assert.strictEqual(await shouldAutostart({ ...base, lastAttemptAt: base.now - COOLDOWN_MS }, free), true);
});

test('socketInUse() asks lsof, and counts anything but "nobody has it open" as held', async () => {
  const lsof = (err, stdout) => (cmd, args, opts, cb) => { assert.deepStrictEqual([cmd, args, opts], ['lsof', ['-t', '--', '/s.sock'], { timeout: 5000 }]); cb(err, stdout); };
  assert.strictEqual(await socketInUse('/s.sock', { run: lsof(null, '14849\n') }), true);
  assert.strictEqual(await socketInUse('/s.sock', { run: lsof(Object.assign(new Error('exit 1'), { code: 1 }), '') }), false);
  assert.strictEqual(await socketInUse('/s.sock', { run: lsof(Object.assign(new Error('spawn lsof ENOENT'), { code: 'ENOENT' }), '') }), true);
  assert.strictEqual(await socketInUse('/s.sock', { run: lsof(Object.assign(new Error('timed out'), { code: null, killed: true, signal: 'SIGTERM' }), '') }), true);
});

test('serverEnv() drops what npm and Electron added, keeps what the user exported, and points herdr at our socket', () => {
  const env = serverEnv({
    HOME: '/u', SHELL: '/bin/zsh', LANG: 'sv_SE.UTF-8', NPM_TOKEN: 't', NPM_CONFIG_REGISTRY: 'https://r',
    PATH: '/w/proto/node_modules/.bin:/w/node_modules/.bin:/node_modules/.bin:/n/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin:/opt/homebrew/bin:/usr/bin',
    npm_config_cache: '/c', npm_lifecycle_event: 'start', npm_node_execpath: '/n/node', INIT_CWD: '/w',
    ELECTRON_RUN_AS_NODE: '1', OFFICE_DEBUG: '1', HERDR_SOCKET_PATH: '/other.sock',
  }, '/s.sock');
  assert.deepStrictEqual(env, { HOME: '/u', SHELL: '/bin/zsh', LANG: 'sv_SE.UTF-8', NPM_TOKEN: 't', NPM_CONFIG_REGISTRY: 'https://r', PATH: '/opt/homebrew/bin:/usr/bin', HERDR_SOCKET_PATH: '/s.sock' });
});

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-autostart-'));
  return { socketPath: path.join(dir, 'herdr.sock'), logFile: path.join(dir, 'autostart.log') };
}

function fakeSpawn(behave) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.unref = () => { child.unrefed = true; };
    calls.push({ cmd, args, opts, child });
    setImmediate(() => behave(child, opts));
    return child;
  };
  return { spawn, calls };
}

test('startHerdrServer() runs `herdr server` detached on our socket and resolves once it listens', async (t) => {
  const paths = tmp();
  let server;
  t.after(() => server?.close());
  const { spawn, calls } = fakeSpawn((child, opts) => { server = net.createServer().listen(opts.env.HERDR_SOCKET_PATH); });
  await startHerdrServer({ bin: '/x/herdr', ...paths }, { spawn, pollMs: 10, env: { PATH: '/p/node_modules/.bin:/usr/bin', npm_config_cache: '/c' } });
  assert.strictEqual(calls[0].cmd, '/x/herdr');
  assert.deepStrictEqual(calls[0].args, ['server']);
  assert.strictEqual(calls[0].opts.detached, true);
  assert.deepStrictEqual(calls[0].opts.env, { PATH: '/usr/bin', HERDR_SOCKET_PATH: paths.socketPath });
  assert.strictEqual(calls[0].opts.stdio[0], 'ignore');
  assert.ok(calls[0].child.unrefed);
});

test('startHerdrServer() says why it could not start', async () => {
  const missing = fakeSpawn((child) => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })));
  await assert.rejects(startHerdrServer({ bin: '/x/herdr', ...tmp() }, { spawn: missing.spawn }), /herdr not found at \/x\/herdr/);

  const paths = tmp();
  const dies = fakeSpawn((child) => { fs.writeFileSync(paths.logFile, 'starting\nerror: config.toml is invalid\n'); child.emit('exit', 1, null); });
  await assert.rejects(startHerdrServer({ bin: 'herdr', ...paths }, { spawn: dies.spawn }), /config.toml is invalid/);
});

test('startHerdrServer() kills a server that never opens its socket, with its process group', async () => {
  const killed = [];
  const silent = fakeSpawn((child) => { child.pid = 4242; });
  await assert.rejects(startHerdrServer({ bin: 'herdr', ...tmp() }, { spawn: silent.spawn, kill: (pid, sig) => killed.push([pid, sig]), timeoutMs: 50, pollMs: 10 }), /did not open its socket/);
  assert.deepStrictEqual(killed, [[-4242, 'SIGTERM']]);
});
