// A small animated-PNG encoder for the README pictures (make-art.js). An
// APNG animates like a GIF on GitHub and in browsers, but keeps full colour,
// so the scenes' text stays crisp. Each frame after the first stores only the
// rectangle that changed; a frame identical to the one before just stretches
// that one's time.
// frames: [{ rgba: Buffer (width * height * 4), ms }], plays forever.
const zlib = require('node:zlib');

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

// The rectangle (x, y, w, h) of rgba as compressed scanlines, each row with
// the Sub filter (a pixel minus the one to its left), which suits flat art.
function pixels(rgba, width, x, y, w, h) {
  const out = Buffer.alloc(h * (1 + w * 4));
  for (let j = 0; j < h; j++) {
    const row = j * (1 + w * 4), src = ((y + j) * width + x) * 4;
    out[row] = 1;
    for (let i = 0; i < w * 4; i++) out[row + 1 + i] = (rgba[src + i] - (i >= 4 ? rgba[src + i - 4] : 0)) & 255;
  }
  return zlib.deflateSync(out, { level: 9 });
}

// Where two frames differ, or null when they are the same.
function changed(a, b, width, height) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3]) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function encodeAPNG(width, height, frames) {
  // Merge repeats into the frame before, then cut each frame to what changed.
  const list = [];
  for (const f of frames) {
    const prev = list[list.length - 1];
    const box = prev ? changed(prev.rgba, f.rgba, width, height) : { x: 0, y: 0, w: width, h: height };
    if (!box) { prev.ms += f.ms; continue; }
    list.push({ rgba: f.rgba, ms: f.ms, box });
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(list.length, 0); actl.writeUInt32BE(0, 4); // loop forever
  const out = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('acTL', actl)];
  let seq = 0;
  list.forEach((f, i) => {
    const { x, y, w, h } = f.box;
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(w, 4); fctl.writeUInt32BE(h, 8);
    fctl.writeUInt32BE(x, 12); fctl.writeUInt32BE(y, 16);
    fctl.writeUInt16BE(Math.round(f.ms), 20); fctl.writeUInt16BE(1000, 22);
    fctl[24] = 0; fctl[25] = 0; // keep what is there; replace the rectangle
    out.push(chunk('fcTL', fctl));
    const data = pixels(f.rgba, width, x, y, w, h);
    if (i === 0) out.push(chunk('IDAT', data));
    else { const n = Buffer.alloc(4); n.writeUInt32BE(seq++, 0); out.push(chunk('fdAT', Buffer.concat([n, data]))); }
  });
  out.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(out);
}

module.exports = { encodeAPNG, crc32 };
