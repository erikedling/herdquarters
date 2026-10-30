// The assistant's clock: when the office starts it, says hello, gives the
// morning brief, lets it dream and clears it after; and which reminders fire.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AssistantStore, runAssistant, assistantDue, knowsUser, reminderList, dueReminders, day, assistantName, MEMORY_FILES } = require('../assistant');
const { parseLine, userLine } = require('../assistant-session');

// Local times, so the weekday and morning checks follow this machine's clock.
const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const TUE_7 = at(2026, 10, 27, 7), TUE_9 = at(2026, 10, 27, 9), SAT_9 = at(2026, 10, 31, 9);
const idle = { running: true, busy: false };
const off = { running: false, busy: false };
const config = { enabled: true, morning: '08:30' };
const quiet = (now) => ({ last_busy: now - 3600_000, last_dream: now - 3600_000 }); // nothing due but the brief

test('no session: start one, but not again right after a crash', () => {
  assert.strictEqual(assistantDue({ session: off, config, now: TUE_9 }), 'start');
  assert.strictEqual(assistantDue({ state: { started_at: TUE_9 - 30_000 }, session: off, config, now: TUE_9 }), 'none');
  assert.strictEqual(assistantDue({ session: off, config: { enabled: false }, now: TUE_9 }), 'none');
});

test('a busy assistant is never interrupted', () => {
  assert.strictEqual(assistantDue({ session: { running: true, busy: true }, met: false, config, now: TUE_9 }), 'none');
});

test('until it knows the user it says hello, at most twice a day', () => {
  assert.strictEqual(assistantDue({ session: idle, met: false, config, now: TUE_9 }), 'hello');
  assert.strictEqual(assistantDue({ state: { hello_at: TUE_9 - 3600_000 }, session: idle, met: false, config, now: TUE_9 }), 'none');
});

test('the morning brief: weekdays, after the morning time, once a day', () => {
  assert.strictEqual(assistantDue({ state: quiet(TUE_9), session: idle, met: true, config, now: TUE_9 }), 'morning');
  assert.strictEqual(assistantDue({ state: quiet(TUE_7), session: idle, met: true, config, now: TUE_7 }), 'none');
  assert.strictEqual(assistantDue({ state: quiet(SAT_9), session: idle, met: true, config, now: SAT_9 }), 'none');
  assert.strictEqual(assistantDue({ state: { ...quiet(TUE_9), last_morning: day(TUE_9) }, session: idle, met: true, config, now: TUE_9 }), 'none');
});

test('it dreams after a quiet half hour, once a day, and is cleared after', () => {
  const after = { last_morning: day(TUE_9), last_busy: TUE_9 - 31 * 60_000, last_dream: TUE_9 - 21 * 3600_000 };
  assert.strictEqual(assistantDue({ state: after, session: idle, met: true, config, now: TUE_9 }), 'dream');
  assert.strictEqual(assistantDue({ state: { ...after, last_busy: TUE_9 - 60_000 }, session: idle, met: true, config, now: TUE_9 }), 'none');
  assert.strictEqual(assistantDue({ state: { ...after, last_dream: TUE_9 - 3600_000 }, session: idle, met: true, config, now: TUE_9 }), 'none');
  // the dream ended: clear before anything else
  assert.strictEqual(assistantDue({ state: { phase: 'dreaming' }, session: idle, met: false, config, now: TUE_9 }), 'clear');
});

test('ME.md with only its heading means the user has not been met', () => {
  assert.strictEqual(knowsUser(MEMORY_FILES['ME.md']), false);
  assert.strictEqual(knowsUser(`${MEMORY_FILES['ME.md']}\nMia, developer at Example Co.\n`), true);
  assert.strictEqual(knowsUser(''), false);
});

test('reminders: open ones with a date, due ones past it', () => {
  const list = reminderList([
    { file: 'a.md', due: '2026-10-28T09:00:00+01:00', text: 'Talk to Noor' },
    { file: 'b.md', due: '2026-10-27T09:00:00+01:00', text: 'Review the PR' },
    { file: 'c.md', due: '2026-10-27T08:00:00+01:00', text: 'done', status: 'done' },
    { file: 'd.md', due: 'tomorrow', text: 'no date' },
  ]);
  assert.deepStrictEqual(list.map((r) => r.file), ['b.md', 'a.md']);
  assert.deepStrictEqual(dueReminders(list, Date.parse('2026-10-27T10:00:00+01:00')).map((r) => r.file), ['b.md']);
});

test('prepare() writes the brief and an empty memory, and keeps what the assistant wrote', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-'));
  const store = new AssistantStore({ dir, orchestratorsDir: '/o', template: 'Folder {{folder}}, bosses in {{orchestrators}}.', claudeConfig: path.join(dir, 'claude.json') });
  store.prepare();
  assert.strictEqual(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), `Folder ${dir}, bosses in /o.`);
  assert.strictEqual(store.met(), false);
  fs.writeFileSync(path.join(dir, 'memory', 'ME.md'), '# Me\n\nMia.\n');
  store.prepare();
  assert.strictEqual(store.met(), true);
  for (const sub of ['memory/projects', 'memory/journal', 'reminders']) assert.ok(fs.existsSync(path.join(dir, sub)), sub);
});

test('the assistant can be renamed; its brief says the new name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-'));
  const store = new AssistantStore({ dir, orchestratorsDir: '/o', template: 'You are {{name}}. Your name is {{name}}.', claudeConfig: path.join(dir, 'claude.json') });
  store.prepare();
  assert.strictEqual(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'You are PiPi. Your name is PiPi.');
  assert.strictEqual(store.configure({ name: '  Kaka\n the  owl ' }).name, 'Kaka the owl');
  store.prepare();
  assert.strictEqual(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'You are Kaka the owl. Your name is Kaka the owl.');
  // $& and friends are plain text, not replacement patterns
  store.configure({ name: 'Bo $& $1' }); store.prepare();
  assert.strictEqual(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), 'You are Bo $& $1. Your name is Bo $& $1.');
});

test('assistantName(): one line, at most 24 characters, PiPi when empty', () => {
  assert.strictEqual(assistantName(''), 'PiPi');
  assert.strictEqual(assistantName('   '), 'PiPi');
  assert.strictEqual(assistantName(undefined), 'PiPi');
  assert.strictEqual(assistantName('Sir Chirps-a-Lot the Third of Herd'), 'Sir Chirps-a-Lot the Thi');
});

test('a dismissed reminder never fires again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-'));
  const store = new AssistantStore({ dir, orchestratorsDir: '/o', template: '', claudeConfig: path.join(dir, 'claude.json') });
  store.prepare();
  fs.writeFileSync(path.join(dir, 'reminders', 'noor.md'), '---\ndue: 2026-10-27T09:00:00+01:00\n---\nTalk to Noor\n');
  assert.deepStrictEqual(store.reminders().map((r) => r.text), ['Talk to Noor']);
  store.dismissReminder('noor.md');
  assert.deepStrictEqual(store.reminders(), []);
  assert.throws(() => store.dismissReminder('../assistant.json'));
});

test('the session stream: the id, the words as they come, tools, the answer and the end of a turn', () => {
  assert.deepStrictEqual(parseLine('{"type":"system","subtype":"init","session_id":"s1"}'), [{ type: 'session', id: 's1' }]);
  assert.deepStrictEqual(parseLine('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}}'), [{ type: 'delta', text: 'hi' }]);
  assert.deepStrictEqual(parseLine('{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"tool_use","name":"Read"}}}'), [{ type: 'tool', name: 'Read' }]);
  assert.deepStrictEqual(parseLine('{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"},{"type":"tool_use"}]}}'), [{ type: 'message', text: 'Hello' }]);
  assert.deepStrictEqual(parseLine('{"type":"result","subtype":"success","is_error":false,"result":"Hello"}'), [{ type: 'idle', error: null }]);
  // a subagent's words are not the answer
  assert.deepStrictEqual(parseLine('{"type":"stream_event","parent_tool_use_id":"t1","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"x"}}}'), []);
  assert.deepStrictEqual(parseLine('not json'), []);
  assert.deepStrictEqual(JSON.parse(userLine('hej')), { type: 'user', message: { role: 'user', content: 'hej' } });
});

test('runAssistant(): asks, notes it in the chat, and starts fresh after a dream', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-'));
  const store = new AssistantStore({ dir, orchestratorsDir: '/o', template: '', claudeConfig: path.join(dir, 'claude.json') });
  const sent = [];
  const session = { running: false, busy: false, start(id) { this.running = true; this.resumed = id; }, send(t) { sent.push(t); }, stop() { this.running = false; } };
  store.tick({ session_id: 's1' });
  assert.strictEqual(runAssistant({ store, session, now: TUE_9 }), 'start');
  assert.strictEqual(session.resumed, 's1');
  assert.strictEqual(runAssistant({ store, session, now: TUE_9 }), 'hello');
  assert.match(sent[0], /First meeting/);
  fs.writeFileSync(path.join(dir, 'memory', 'ME.md'), '# Me\n\nMia.\n');
  store.tick({ last_morning: day(TUE_9), last_busy: 0, last_dream: 0 });
  assert.strictEqual(runAssistant({ store, session, now: TUE_9 }), 'dream');
  assert.strictEqual(runAssistant({ store, session, now: TUE_9 }), 'clear');
  assert.strictEqual(session.running, false);
  assert.strictEqual(store.readState().session_id, null);
  assert.deepStrictEqual(store.chat().map((c) => c.text), ['👋 First meeting', '💤 Dreaming', '🌅 Woke up with a tidy memory']);
});
