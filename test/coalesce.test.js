// Refreshes run one at a time and calls made during one fold into a single
// run after it, so the snapshot sent last is always the newest. A run that
// throws still lets a call queued behind it run.
const test = require('node:test');
const assert = require('node:assert');
const { coalesce } = require('../coalesce');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A herdr whose session version goes up by one per change, and a refresh that
// reads it, then takes a while (the worktree lists) before sending.
function office() {
  let version = 1;
  const sent = [];
  const durations = [50, 5, 5, 5];
  let n = 0;
  async function refreshOnce() {
    const seen = version;
    await sleep(durations[n++] ?? 5);
    sent.push(seen);
  }
  return { refreshOnce, sent, change: () => { version++; } };
}

test('a slow refresh never sends after a newer one', async () => {
  const o = office();
  const refresh = coalesce(o.refreshOnce);
  const first = refresh();
  await sleep(10);
  o.change();
  const second = refresh();
  await Promise.all([first, second]);
  assert.deepStrictEqual(o.sent, [...o.sent].sort((a, b) => a - b), `sent out of order: ${o.sent}`);
  assert.strictEqual(o.sent.at(-1), 2, 'the last snapshot sent is the newest');
});

test('calls during a refresh fold into one more refresh', async () => {
  let runs = 0, inFlight = 0, most = 0;
  const refresh = coalesce(async () => { runs++; inFlight++; most = Math.max(most, inFlight); await sleep(10); inFlight--; });
  await Promise.all([refresh(), refresh(), refresh(), refresh()]);
  assert.strictEqual(runs, 2);
  assert.strictEqual(most, 1);
  await refresh();
  assert.strictEqual(runs, 3);
});

test('a refresh that throws does not stop the next one', async () => {
  let runs = 0;
  const refresh = coalesce(async () => { runs++; if (runs === 1) throw new Error('herdr gone'); });
  await assert.rejects(refresh());
  await refresh();
  assert.strictEqual(runs, 2);
});

test('a call made during a run that throws still runs', async () => {
  let runs = 0;
  const refresh = coalesce(async () => { runs++; await sleep(10); if (runs === 1) throw new Error('herdr gone'); });
  const first = refresh();
  const queued = refresh();
  await Promise.allSettled([first, queued]);
  assert.strictEqual(runs, 2);
});
