// One `herdr terminal session control` process per open desk, driven over
// pipes. Frames reach the renderer as text, keystrokes go back in order, and
// closing releases the stream instead of killing it. Runs against a fake
// herdr that speaks the same protocol.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { StreamManager } = require('../streams');

const FAKE = path.join(__dirname, 'fixtures', 'fake-herdr.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function manager() {
  const sent = [];
  const m = new StreamManager((channel, payload) => sent.push({ channel, payload }), { bin: FAKE });
  const dataFor = (id) => sent.filter((s) => s.channel === 'term-data' && s.payload.id === id).map((s) => s.payload.data).join('');
  return { m, sent, dataFor };
}

async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await sleep(10); }
  throw new Error('timed out waiting');
}

test('opening a desk streams its first frame with the requested size', async () => {
  const { m, dataFor } = manager();
  const id = await m.open({ paneId: 'w1:p4', cols: 100, rows: 30 });
  await until(() => dataFor(id).includes('welcome'));
  assert.ok(dataFor(id).includes('welcome w1:p4 100x30'), dataFor(id));
  await m.close(id);
});

test('typed bytes come back as frames in order', async () => {
  const { m, dataFor } = manager();
  const id = await m.open({ paneId: 'w1:p4', cols: 80, rows: 24 });
  await until(() => dataFor(id).includes('welcome'));
  for (const ch of 'abcdefghij') m.input(id, ch);
  await until(() => dataFor(id).includes('abcdefghij'));
  await m.close(id);
});

test('resize and scroll are forwarded as herdr commands', async () => {
  const { m, dataFor } = manager();
  const id = await m.open({ paneId: 'w1:p4', cols: 80, rows: 24 });
  await until(() => dataFor(id).includes('welcome'));
  m.resize(id, 90, 25);
  m.scroll(id, 'up', 3);
  await until(() => dataFor(id).includes('scrolled up 3'));
  assert.ok(dataFor(id).includes('resized 90x25'), dataFor(id));
  await m.close(id);
});

test('close releases the stream and the process exits on its own', async () => {
  const { m, sent, dataFor } = manager();
  const id = await m.open({ paneId: 'w1:p4', cols: 80, rows: 24 });
  await until(() => dataFor(id).includes('welcome'));
  const proc = m.streams.get(id).proc;
  await m.close(id);
  await until(() => proc.exitCode !== null);
  assert.strictEqual(proc.exitCode, 0, 'released, not killed');
  assert.ok(!sent.some((s) => s.channel === 'term-exit'), 'a close the user asked for is not reported as an exit');
  m.input(id, 'x'); // dropped quietly
});

test('a pane that goes away is reported as an exit with herdr\'s reason', async () => {
  const { m, sent } = manager();
  const id = await m.open({ paneId: 'gone', cols: 80, rows: 24 });
  await until(() => sent.some((s) => s.channel === 'term-exit'));
  const exit = sent.find((s) => s.channel === 'term-exit').payload;
  assert.strictEqual(exit.id, id);
  assert.strictEqual(exit.reason, 'pane closed');
});

test('a second open for the same pane releases the first stream instead of fighting it', async () => {
  const { m, sent, dataFor } = manager();
  const a = await m.open({ paneId: 'w1:p4', cols: 80, rows: 24 });
  await until(() => dataFor(a).includes('welcome'));
  const first = m.streams.get(a).proc;
  const b = await m.open({ paneId: 'w1:p4', cols: 80, rows: 24 });
  await until(() => dataFor(b).includes('welcome'));
  assert.notStrictEqual(a, b);
  assert.deepStrictEqual([...m.streams.keys()], [b], 'only the new stream is open');
  assert.strictEqual(first.exitCode, 0, 'the first was released');
  assert.ok(!sent.some((s) => s.channel === 'term-exit'), 'replacing is not reported as an exit');
  await m.close(b);
});

test('a pane another client holds is taken over, once, without the renderer noticing', async () => {
  const { m, sent, dataFor } = manager();
  const id = await m.open({ paneId: 'busy', cols: 80, rows: 24 });
  await until(() => dataFor(id).includes('welcome busy'));
  assert.ok(m.streams.get(id).takeover, 'retried with --takeover');
  assert.ok(!sent.some((s) => s.channel === 'term-exit'), 'the refused first try is not reported');
  await m.close(id);
});
