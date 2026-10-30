// The panel talks to `herdr terminal session control` over newline-delimited
// JSON: frames come in as base64 ANSI, commands go out the same way.
const test = require('node:test');
const assert = require('node:assert');
const { splitLines, frameText, encode } = require('../stream-protocol');

test('splitLines yields whole messages and keeps a partial line for later', () => {
  const a = JSON.stringify({ type: 'terminal.frame', seq: 1 });
  const b = JSON.stringify({ type: 'terminal.closed', reason: 'detached' });
  const first = splitLines('', `${a}\n${b.slice(0, 5)}`);
  assert.deepStrictEqual(first.messages, [{ type: 'terminal.frame', seq: 1 }]);
  const second = splitLines(first.rest, `${b.slice(5)}\n`);
  assert.deepStrictEqual(second.messages, [{ type: 'terminal.closed', reason: 'detached' }]);
  assert.strictEqual(second.rest, '');
});

test('splitLines skips blank and non-JSON lines instead of throwing', () => {
  const { messages, rest } = splitLines('', '\nnot json\n{"type":"terminal.frame"}\n');
  assert.deepStrictEqual(messages, [{ type: 'terminal.frame' }]);
  assert.strictEqual(rest, '');
});

test('frameText decodes the base64 ANSI bytes of a frame as UTF-8', () => {
  const bytes = Buffer.from('\x1b[2Jhej då', 'utf8').toString('base64');
  assert.strictEqual(frameText({ type: 'terminal.frame', bytes, encoding: 'ansi' }), '\x1b[2Jhej då');
});

test('encode.input carries the keystroke bytes base64-encoded, one JSON line', () => {
  const line = encode.input('a\r');
  assert.ok(line.endsWith('\n'));
  assert.deepStrictEqual(JSON.parse(line), { type: 'terminal.input', bytes: Buffer.from('a\r').toString('base64') });
});

test('encode.resize, encode.scroll and encode.release match the herdr command names', () => {
  assert.deepStrictEqual(JSON.parse(encode.resize(90, 25)), { type: 'terminal.resize', cols: 90, rows: 25 });
  assert.deepStrictEqual(JSON.parse(encode.scroll('up', 3)), { type: 'terminal.scroll', direction: 'up', lines: 3 });
  assert.deepStrictEqual(JSON.parse(encode.release()), { type: 'terminal.release' });
});
