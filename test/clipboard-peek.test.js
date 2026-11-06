// The type lists are what Electron 45's clipboard.read() reported on macOS
// for each kind of copy.
const test = require('node:test');
const assert = require('node:assert');
const { peekClipboard, isImageType, fileUrisToPaths } = require('../clipboard-peek');

const raw = (name) => `electron application/osclipboard;format="${name}"`;
const FINDTEXT = 'electron application/findtext';

// uriList is what getType('text/uri-list') holds, for an item that lists that type.
function fakeClipboard(types, text = '', uriList = '') {
  return {
    read: async () => types.map((t) => ({ types: t, getType: async (type) => new Blob([type === 'text/uri-list' ? uriList : '']) })),
    readText: async () => text,
  };
}

const failing = (message) => async () => { throw new Error(message); };

test('plain text from a terminal or editor is text, not an image', async () => {
  const clip = fakeClipboard([['text/plain', FINDTEXT, raw('NSStringPboardType')]], 'git status');
  assert.deepStrictEqual(await peekClipboard(clip), { hasText: true, hasImage: false, text: 'git status', paths: [] });
});

test('a bare PNG is an image', async () => {
  const clip = fakeClipboard([['image/png', FINDTEXT, raw('Apple PNG pasteboard type'), raw('NeXT TIFF v4.0 pasteboard type')]]);
  assert.deepStrictEqual(await peekClipboard(clip), { hasText: false, hasImage: true, text: '', paths: [] });
});

test('an image copied from a browser or Slack is an image even with HTML and a URL alongside', async () => {
  const clip = fakeClipboard([['text/plain', 'text/html', 'image/png', FINDTEXT, raw('Apple HTML pasteboard type'), raw('Apple PNG pasteboard type'), raw('NSStringPboardType')]], 'https://example.com/cat.png');
  const peek = await peekClipboard(clip);
  assert.strictEqual(peek.hasImage, true);
  assert.strictEqual(peek.text, 'https://example.com/cat.png');
});

test('a file copied in Finder gives its path, next to the icon Finder adds as a TIFF', async () => {
  const file = ['text/plain', 'text/uri-list', FINDTEXT, raw('NSFilenamesPboardType'), raw('NSStringPboardType'), raw('NeXT TIFF v4.0 pasteboard type')];
  const uri = 'file:///Users/me/Desktop/Screenshot%202026-11-05%20at%2013.19.24.png';
  assert.deepStrictEqual(await peekClipboard(fakeClipboard([file], 'Screenshot 2026-11-05 at 13.19.24.png', uri)), {
    hasText: true, hasImage: true, text: 'Screenshot 2026-11-05 at 13.19.24.png', paths: ['/Users/me/Desktop/Screenshot 2026-11-05 at 13.19.24.png'],
  });
});

test('several files copied in Finder give every path, in order', async () => {
  const types = ['text/uri-list', FINDTEXT, raw('NSFilenamesPboardType')];
  const peek = await peekClipboard(fakeClipboard([types], '', 'file:///tmp/a.png\r\nfile:///tmp/notes.txt'));
  assert.deepStrictEqual(peek.paths, ['/tmp/a.png', '/tmp/notes.txt']);
});

test('what osascript puts there for "set the clipboard to POSIX file" (no text, no icon) is a path', async () => {
  const types = ['text/uri-list', FINDTEXT, raw('Apple URL pasteboard type'), raw('CorePasteboardFlavorType 0x6675726C'), raw('NSFilenamesPboardType')];
  assert.deepStrictEqual(await peekClipboard(fakeClipboard([types], '', 'file:///tmp/shot.png')), { hasText: false, hasImage: false, text: '', paths: ['/tmp/shot.png'] });
});

test('a JPEG file copied in Finder counts through its TIFF translation', async () => {
  const types = ['text/plain', 'text/uri-list', FINDTEXT, raw('Apple URL pasteboard type'), raw('CorePasteboardFlavorType 0x4A504547'), raw('NSFilenamesPboardType'), raw('NSStringPboardType'), raw('NeXT TIFF v4.0 pasteboard type'), raw('public.jpeg')];
  assert.deepStrictEqual(await peekClipboard(fakeClipboard([types], 'icon.jpg', 'file:///tmp/icon.jpg')), { hasText: true, hasImage: true, text: 'icon.jpg', paths: ['/tmp/icon.jpg'] });
});

test('when the file list cannot be read, the text and image still are', async () => {
  const clip = {
    read: async () => [{ types: ['text/plain', 'text/uri-list', 'image/png'], getType: failing('getType failed') }],
    readText: async () => 'name.png',
  };
  assert.deepStrictEqual(await peekClipboard(clip), { hasText: true, hasImage: true, text: 'name.png', paths: [] });
});

test('when read() fails, the text is still pasted', async () => {
  const clip = { read: failing('read failed'), readText: async () => 'still here' };
  assert.deepStrictEqual(await peekClipboard(clip), { hasText: true, hasImage: false, text: 'still here', paths: [] });
});

test('when readText() fails as well, the peek fails so the panel can say so', async () => {
  const clip = { read: failing('read failed'), readText: failing('readText failed') };
  await assert.rejects(peekClipboard(clip), /readText failed/);
});

test('an empty clipboard still lists the find pasteboard, which is neither text nor image', async () => {
  assert.deepStrictEqual(await peekClipboard(fakeClipboard([[FINDTEXT]])), { hasText: false, hasImage: false, text: '', paths: [] });
});

test('an image in any item of a multi-item clipboard counts', async () => {
  const clip = fakeClipboard([['text/plain'], ['image/jpeg']], 'caption');
  assert.strictEqual((await peekClipboard(clip)).hasImage, true);
});

test('isImageType: MIME images and raw macOS image formats only', () => {
  for (const t of ['image/png', 'image/jpeg', 'image/svg+xml', raw('Apple PNG pasteboard type'), raw('NeXT TIFF v4.0 pasteboard type')]) assert.ok(isImageType(t), t);
  for (const t of ['text/plain', 'text/html', 'text/uri-list', FINDTEXT, raw('NSStringPboardType'), raw('public.utf8-plain-text'), 'web image/png']) assert.ok(!isImageType(t), t);
});

test('fileUrisToPaths: decodes file URIs, skips comments, blank lines and other schemes', () => {
  const list = '# copied\r\nfile:///Users/me/Sk%C3%A4rmavbild%202026-11-05%20kl.%2013.19.24.png\r\n\r\nhttps://example.com/x.png\r\nfile:///tmp/a%20%26%20b%20(1).png\n';
  assert.deepStrictEqual(fileUrisToPaths(list), ['/Users/me/Skärmavbild 2026-11-05 kl. 13.19.24.png', '/tmp/a & b (1).png']);
  assert.deepStrictEqual(fileUrisToPaths(''), []);
  assert.deepStrictEqual(fileUrisToPaths('file://otherhost/x.png'), []);
});
