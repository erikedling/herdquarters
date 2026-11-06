// What the terminal panel types for a paste or a drop. The escaped paths were
// checked against Claude Code, which attached each one as an image.
const test = require('node:test');
const assert = require('node:assert');
const { escapePath, pathsToText, bracketed, pasteAction, dropAction } = require('../renderer/paste-paths');

test('escapePath: spaces and shell specials get a backslash, like macOS Terminal', () => {
  assert.strictEqual(escapePath('/Users/me/Desktop/Screenshot 2026-11-05 at 13.19.24.png'), '/Users/me/Desktop/Screenshot\\ 2026-11-05\\ at\\ 13.19.24.png');
  assert.strictEqual(escapePath("/tmp/weird (copy) & it's.png"), "/tmp/weird\\ \\(copy\\)\\ \\&\\ it\\'s.png");
  assert.strictEqual(escapePath('/tmp/a"b`c$d|e;f<g>h{i}j[k]l*m?n!o#p~q^r\\s'), '/tmp/a\\"b\\`c\\$d\\|e\\;f\\<g\\>h\\{i\\}j\\[k\\]l\\*m\\?n\\!o\\#p\\~q\\^r\\\\s');
});

test('escapePath: the narrow no-break space macOS puts before AM/PM in English screenshot names is escaped too', () => {
  // Claude Code attached the file with this escaping.
  assert.strictEqual(escapePath('/Users/me/Desktop/Screenshot 2026-11-06 at 10.14.03\u202fAM.png'), '/Users/me/Desktop/Screenshot\\ 2026-11-06\\ at\\ 10.14.03\\\u202fAM.png');
});

test('escapePath: control characters are dropped, so a name cannot end the bracketed paste', () => {
  assert.strictEqual(escapePath('/tmp/evil\x1b[201~rm -rf\r.png'), '/tmp/evil\\[201\\~rm\\ -rf.png');
  assert.strictEqual(escapePath('/tmp/tab\there.png'), '/tmp/tabhere.png');
});

test('escapePath: letters outside ASCII and ordinary punctuation stay as they are', () => {
  assert.strictEqual(escapePath('/Users/me/Skärmavbild_2026-11-05_kl.13.19.24.png'), '/Users/me/Skärmavbild_2026-11-05_kl.13.19.24.png');
  assert.strictEqual(escapePath('/tmp/a,b=c@d%e+f:g.png'), '/tmp/a,b=c@d%e+f:g.png');
});

test('pathsToText: several paths are separated by one space', () => {
  assert.strictEqual(pathsToText(['/tmp/a b.png', '/tmp/c.txt']), '/tmp/a\\ b.png /tmp/c.txt');
  assert.strictEqual(pathsToText([]), '');
});

test('bracketed: wraps text in the bracketed-paste markers', () => {
  assert.strictEqual(bracketed('/tmp/a\\ b.png'), '\x1b[200~/tmp/a\\ b.png\x1b[201~');
});

test('pasteAction: copied files paste as paths, even with Finder\'s icon as an image beside them', () => {
  const clip = { hasText: true, hasImage: true, text: 'Screenshot 2026-11-05 at 13.19.24.png', paths: ['/Users/me/Desktop/Screenshot 2026-11-05 at 13.19.24.png'] };
  assert.deepStrictEqual(pasteAction(clip), { kind: 'paths', text: '/Users/me/Desktop/Screenshot\\ 2026-11-05\\ at\\ 13.19.24.png' });
});

test('pasteAction: copied pixels with no file are an image, even with text beside them', () => {
  assert.deepStrictEqual(pasteAction({ hasText: false, hasImage: true, text: '', paths: [] }), { kind: 'image' });
  assert.deepStrictEqual(pasteAction({ hasText: true, hasImage: true, text: 'https://example.com/cat.png', paths: [] }), { kind: 'image' });
});

test('pasteAction: text pastes as it is, an empty clipboard pastes nothing', () => {
  assert.deepStrictEqual(pasteAction({ hasText: true, hasImage: false, text: 'git status', paths: [] }), { kind: 'text', text: 'git status' });
  assert.strictEqual(pasteAction({ hasText: false, hasImage: false, text: '', paths: [] }), null);
});

test('pasteAction: a peek with no paths field is read as no files', () => {
  assert.deepStrictEqual(pasteAction({ hasText: false, hasImage: true, text: '' }), { kind: 'image' });
});

test('dropAction: dropped files type their paths, a drop with no paths types nothing', () => {
  assert.deepStrictEqual(dropAction(['/tmp/a b.png', '/tmp/c.png']), { kind: 'paths', text: '/tmp/a\\ b.png /tmp/c.png' });
  assert.strictEqual(dropAction([]), null);
});
