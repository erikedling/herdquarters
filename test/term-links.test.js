// URLs in the terminal are links, including ones herdr wrapped over rows.
const test = require('node:test');
const assert = require('node:assert');
const { trimUrl, findUrls, linksFor } = require('../renderer/term-links');

test('findUrls() finds http and https links and leaves sentence punctuation out', () => {
  const text = 'see https://example.com/a?b=1&c=2. Or http://x.y/z, then (https://w.org/p) done';
  assert.deepStrictEqual(findUrls(text).map((l) => l.url), ['https://example.com/a?b=1&c=2', 'http://x.y/z', 'https://w.org/p']);
});

test('trimUrl() keeps a paren the URL opened', () => {
  assert.strictEqual(trimUrl('https://en.wikipedia.org/wiki/Foo_(bar)'), 'https://en.wikipedia.org/wiki/Foo_(bar)');
  assert.strictEqual(trimUrl('https://en.wikipedia.org/wiki/Foo_(bar))'), 'https://en.wikipedia.org/wiki/Foo_(bar)');
  assert.strictEqual(trimUrl('https://x.y/z).'), 'https://x.y/z');
});

test('findUrls() reports offsets', () => {
  const [l] = findUrls('go to https://x.y/z now');
  assert.deepStrictEqual(l, { url: 'https://x.y/z', start: 6, end: 19 });
});

test('linksFor() maps a wrapped URL to a range across rows, 1-based and inclusive', () => {
  const cols = 10;
  const text = 'x https://a.b/cdefghijklmnop rest'.padEnd(40); // starts col 2 row 0, ends col 7 row 2
  const [l] = linksFor(text, 5, cols);
  assert.strictEqual(l.url, 'https://a.b/cdefghijklmnop');
  assert.deepStrictEqual(l.range, { start: { x: 3, y: 6 }, end: { x: 8, y: 8 } });
});

test('linksFor() ignores a bare scheme', () => {
  assert.deepStrictEqual(linksFor('https:// nothing', 0, 80), []);
});
