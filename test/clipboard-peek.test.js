// The type lists are what Electron 45's clipboard.read() reported on macOS
// for each kind of copy.
const test = require('node:test');
const assert = require('node:assert');
const { peekClipboard, isImageType } = require('../clipboard-peek');

const raw = (name) => `electron application/osclipboard;format="${name}"`;
const FINDTEXT = 'electron application/findtext';

function fakeClipboard(types, text = '') {
  return {
    read: async () => types.map((t) => ({ types: t })),
    readText: async () => text,
  };
}

const failing = (message) => async () => { throw new Error(message); };

test('plain text from a terminal or editor is text, not an image', async () => {
  const clip = fakeClipboard([['text/plain', FINDTEXT, raw('NSStringPboardType')]], 'git status');
  assert.deepStrictEqual(await peekClipboard(clip), { hasText: true, hasImage: false, text: 'git status' });
});

test('a bare PNG is an image', async () => {
  const clip = fakeClipboard([['image/png', FINDTEXT, raw('Apple PNG pasteboard type'), raw('NeXT TIFF v4.0 pasteboard type')]]);
  assert.deepStrictEqual(await peekClipboard(clip), { hasText: false, hasImage: true, text: '' });
});

test('an image copied from a browser or Slack is an image even with HTML and a URL alongside', async () => {
  const clip = fakeClipboard([['text/plain', 'text/html', 'image/png', FINDTEXT, raw('Apple HTML pasteboard type'), raw('Apple PNG pasteboard type'), raw('NSStringPboardType')]], 'https://example.com/cat.png');
  const peek = await peekClipboard(clip);
  assert.strictEqual(peek.hasImage, true);
  assert.strictEqual(peek.text, 'https://example.com/cat.png');
});

test('a file copied in Finder is an image only when its icon rides along, as in Electron 33', async () => {
  const file = ['text/plain', 'text/uri-list', FINDTEXT, raw('NSFilenamesPboardType'), raw('NSStringPboardType')];
  assert.deepStrictEqual(await peekClipboard(fakeClipboard([file], 'notes.txt')), { hasText: true, hasImage: false, text: 'notes.txt' });
  const withIcon = [...file, raw('NeXT TIFF v4.0 pasteboard type')];
  assert.deepStrictEqual(await peekClipboard(fakeClipboard([withIcon], 'notes.txt')), { hasText: true, hasImage: true, text: 'notes.txt' });
});

test('a JPEG file copied in Finder counts through its TIFF translation', async () => {
  const types = ['text/plain', 'text/uri-list', FINDTEXT, raw('Apple URL pasteboard type'), raw('CorePasteboardFlavorType 0x4A504547'), raw('NSFilenamesPboardType'), raw('NSStringPboardType'), raw('NeXT TIFF v4.0 pasteboard type'), raw('public.jpeg')];
  assert.deepStrictEqual(await peekClipboard(fakeClipboard([types], 'icon.jpg')), { hasText: true, hasImage: true, text: 'icon.jpg' });
});

test('when read() fails, the text is still pasted', async () => {
  const clip = { read: failing('read failed'), readText: async () => 'still here' };
  assert.deepStrictEqual(await peekClipboard(clip), { hasText: true, hasImage: false, text: 'still here' });
});

test('when readText() fails as well, the peek fails so the panel can say so', async () => {
  const clip = { read: failing('read failed'), readText: failing('readText failed') };
  await assert.rejects(peekClipboard(clip), /readText failed/);
});

test('an empty clipboard still lists the find pasteboard, which is neither text nor image', async () => {
  assert.deepStrictEqual(await peekClipboard(fakeClipboard([[FINDTEXT]])), { hasText: false, hasImage: false, text: '' });
});

test('an image in any item of a multi-item clipboard counts', async () => {
  const clip = fakeClipboard([['text/plain'], ['image/jpeg']], 'caption');
  assert.strictEqual((await peekClipboard(clip)).hasImage, true);
});

test('isImageType: MIME images and raw macOS image formats only', () => {
  for (const t of ['image/png', 'image/jpeg', 'image/svg+xml', raw('Apple PNG pasteboard type'), raw('NeXT TIFF v4.0 pasteboard type')]) assert.ok(isImageType(t), t);
  for (const t of ['text/plain', 'text/html', 'text/uri-list', FINDTEXT, raw('NSStringPboardType'), raw('public.utf8-plain-text'), 'web image/png']) assert.ok(!isImageType(t), t);
});
