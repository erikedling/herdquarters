// The README animations (scripts/apng.js): a valid animated PNG with every
// chunk's checksum right, only the changed rectangle stored per frame, and a
// repeated frame folded into the one before.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { encodeAPNG, crc32 } = require('../scripts/apng');

function chunks(png) {
  assert.deepStrictEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const list = [];
  for (let i = 8; i < png.length;) {
    const len = png.readUInt32BE(i), type = png.toString('ascii', i + 4, i + 8), data = png.subarray(i + 8, i + 8 + len);
    assert.strictEqual(png.readUInt32BE(i + 8 + len), crc32(png.subarray(i + 4, i + 8 + len)), `${type} crc`);
    list.push({ type, data });
    i += 12 + len;
  }
  return list;
}

const frame = (w, h, paint) => { const b = Buffer.alloc(w * h * 4, 255); paint?.(b); return { rgba: b, ms: 100 }; };

test('crc32 matches the PNG reference value', () => {
  assert.strictEqual(crc32(Buffer.from('IEND')), 0xae426082);
});

test('three frames, one a repeat: two frames, the second only where it changed', () => {
  const w = 4, h = 3;
  const dot = (b) => { const i = (1 * w + 2) * 4; b[i] = 0; b[i + 1] = 0; };
  const png = encodeAPNG(w, h, [frame(w, h), frame(w, h), frame(w, h, dot)]);
  const list = chunks(png);
  assert.deepStrictEqual(list.map((c) => c.type), ['IHDR', 'acTL', 'fcTL', 'IDAT', 'fcTL', 'fdAT', 'IEND']);
  assert.strictEqual(list[1].data.readUInt32BE(0), 2);                       // frames
  const [first, second] = [list[2].data, list[4].data];
  assert.strictEqual(first.readUInt16BE(20), 200);                           // the repeat stretched it
  assert.deepStrictEqual([4, 8, 12, 16].map((o) => second.readUInt32BE(o)), [1, 1, 2, 1]); // a 1x1 box at (2, 1)
  // the first frame is the whole picture: 3 rows of a filter byte and 4 pixels
  assert.strictEqual(zlib.inflateSync(list[3].data).length, h * (1 + w * 4));
  // sequence numbers run 0, 1, 2 over fcTL, fcTL and fdAT
  assert.deepStrictEqual([first.readUInt32BE(0), second.readUInt32BE(0), list[5].data.readUInt32BE(0)], [0, 1, 2]);
});
