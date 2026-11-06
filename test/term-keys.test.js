// macOS editing shortcuts that Warp turns into terminal sequences for the
// native herdr client. xterm drops every Cmd+arrow combination, so the panel
// maps them itself to the readline keys Claude Code and shells understand.
const test = require('node:test');
const assert = require('node:assert');
const { keyToBytes } = require('../renderer/term-keys');

const ev = (key, mods = {}) => ({ type: 'keydown', key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

test('Cmd+Left and Cmd+Right jump to line start and end', () => {
  assert.strictEqual(keyToBytes(ev('ArrowLeft', { metaKey: true })), '\x01');
  assert.strictEqual(keyToBytes(ev('ArrowRight', { metaKey: true })), '\x05');
});

test('Cmd+Backspace and Cmd+Delete delete to line start and end', () => {
  assert.strictEqual(keyToBytes(ev('Backspace', { metaKey: true })), '\x15');
  assert.strictEqual(keyToBytes(ev('Delete', { metaKey: true })), '\x0b');
});

test('Shift+Enter is the CSI-u shifted Return that Claude Code takes as newline', () => {
  assert.strictEqual(keyToBytes(ev('Enter', { shiftKey: true })), '\x1b[13;2u');
});

// xterm sends Ctrl+Enter as a bare \r, the same as Enter, so "send now" on a
// queued message never reached the agent (issue #6).
test('Ctrl+Enter is the CSI-u control Return, distinct from plain Enter', () => {
  assert.strictEqual(keyToBytes(ev('Enter', { ctrlKey: true })), '\x1b[13;5u');
});

test('Option+Left and Option+Right jump a word back and forward', () => {
  assert.strictEqual(keyToBytes(ev('ArrowLeft', { altKey: true })), '\x1bb');
  assert.strictEqual(keyToBytes(ev('ArrowRight', { altKey: true })), '\x1bf');
});

// xterm leaves these to the layout or sends them itself with macOptionIsMeta off.
test('Option with characters, Enter and Backspace is left to xterm', () => {
  assert.strictEqual(keyToBytes(ev('@', { altKey: true, code: 'Digit2' })), null);
  assert.strictEqual(keyToBytes(ev('£', { altKey: true, code: 'Digit3' })), null);
  assert.strictEqual(keyToBytes(ev('[', { altKey: true, code: 'Digit8' })), null);
  assert.strictEqual(keyToBytes(ev('Dead', { altKey: true, code: 'BracketRight' })), null);
  assert.strictEqual(keyToBytes(ev('Enter', { altKey: true })), null);
  assert.strictEqual(keyToBytes(ev('Backspace', { altKey: true })), null);
});

test('everything else is left to xterm', () => {
  assert.strictEqual(keyToBytes(ev('Enter')), null);
  assert.strictEqual(keyToBytes(ev('Enter', { ctrlKey: true, shiftKey: true })), null);
  assert.strictEqual(keyToBytes(ev('a')), null);
  assert.strictEqual(keyToBytes(ev('ArrowLeft')), null);
  assert.strictEqual(keyToBytes(ev('ArrowLeft', { altKey: true, shiftKey: true })), null);
  assert.strictEqual(keyToBytes(ev('ArrowUp', { altKey: true })), null);
  assert.strictEqual(keyToBytes(ev('ArrowLeft', { metaKey: true, shiftKey: true })), null);
  assert.strictEqual(keyToBytes(ev('w', { metaKey: true })), null);
  assert.strictEqual(keyToBytes({ ...ev('ArrowLeft', { metaKey: true }), type: 'keyup' }), null);
});
