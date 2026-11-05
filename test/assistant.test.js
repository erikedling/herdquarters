// The assistant's clock: when the office starts it, says hello, gives the
// morning brief, lets it dream and clears it after; and which reminders fire.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AssistantStore, assistantSettings, runAssistant, assistantDue, knowsUser, reminderList, dueReminders, day, assistantName, assistantDays, MEMORY_FILES } = require('../assistant');
const { AssistantSession, parseLine, userLine } = require('../assistant-session');

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

test('the days setting: no brief on a day off, a brief on a day on, never with none', () => {
  const weekend = { ...config, days: [0, 6] };
  assert.strictEqual(assistantDue({ state: quiet(TUE_9), session: idle, met: true, config: weekend, now: TUE_9 }), 'none');
  assert.strictEqual(assistantDue({ state: quiet(SAT_9), session: idle, met: true, config: weekend, now: SAT_9 }), 'morning');
  assert.strictEqual(assistantDue({ state: quiet(TUE_9), session: idle, met: true, config: { ...config, days: [] }, now: TUE_9 }), 'none');
  // no hello on a day off either; it waits for a day on
  assert.strictEqual(assistantDue({ session: idle, met: false, config: weekend, now: TUE_9 }), 'none');
  assert.strictEqual(assistantDue({ session: idle, met: false, config: weekend, now: SAT_9 }), 'hello');
});

test('a day off still dreams: tidying the memory is silent', () => {
  const after = { last_busy: SAT_9 - 31 * 60_000, last_dream: SAT_9 - 21 * 3600_000 };
  assert.strictEqual(assistantDue({ state: after, session: idle, met: true, config, now: SAT_9 }), 'dream');
});

test('assistantDays(): getDay numbers 0-6, sorted, once each; Mon-Fri when not a list', () => {
  assert.deepStrictEqual(assistantDays(undefined), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(assistantDays('weekdays'), [1, 2, 3, 4, 5]);
  assert.deepStrictEqual(assistantDays([]), []);
  assert.deepStrictEqual(assistantDays([6, 0, 6, '3', 7, -1, 2.5, null, 'x']), [0, 3, 6]);
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

test('reminders: open notes with a time, due ones past it', () => {
  const list = reminderList([
    { file: 'a.md', due: Date.parse('2026-10-28T09:00:00+01:00'), title: 'Talk to Noor', status: 'open' },
    { file: 'b.md', due: Date.parse('2026-10-27T09:00:00+01:00'), title: 'Review the PR', status: 'open' },
    { file: 'c.md', due: Date.parse('2026-10-27T08:00:00+01:00'), title: 'done', status: 'done' },
    { file: 'd.md', due: null, title: 'a plain todo', status: 'open' },
  ]);
  assert.deepStrictEqual(list.map((r) => r.file), ['b.md', 'a.md']);
  assert.deepStrictEqual(list.map((r) => r.text), ['Review the PR', 'Talk to Noor']);
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
  for (const sub of ['memory/projects', 'memory/journal', 'notes']) assert.ok(fs.existsSync(path.join(dir, sub)), sub);
});

test('prepare() rewrites the permissions: orchestrators are read only, even in an old install', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-'));
  const orchestratorsDir = '/Users/u/Library/Application Support/agent-office/orchestrators';
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.claude', 'settings.json'), '{"permissions":{"allow":["Read"]}}');
  new AssistantStore({ dir, orchestratorsDir, template: '', claudeConfig: path.join(dir, 'claude.json') }).prepare();
  const { permissions } = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
  assert.deepStrictEqual(permissions, assistantSettings(orchestratorsDir).permissions);
  assert.ok(permissions.deny.includes(`Edit(/${orchestratorsDir}/**)`));
  assert.ok(permissions.allow.includes('Edit(./**)'));
});

test('start() passes --add-dir for each addDirs entry', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-'));
  const fake = path.join(dir, 'claude');
  fs.writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$@" > "${path.join(dir, 'args')}"\n`, { mode: 0o755 });
  const session = new AssistantSession({ dir, addDirs: ['/a b/orchestrators'], claude: fake });
  const exited = new Promise((resolve) => session.on('exit', resolve));
  session.start('s1');
  await exited;
  const args = fs.readFileSync(path.join(dir, 'args'), 'utf8').trim().split('\n');
  assert.strictEqual(args[args.indexOf('--add-dir') + 1], '/a b/orchestrators');
  assert.strictEqual(args[args.indexOf('--resume') + 1], 's1');
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

test('a dismissed reminder never fires again, also one written before notes existed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-'));
  const store = new AssistantStore({ dir, orchestratorsDir: '/o', template: '', claudeConfig: path.join(dir, 'claude.json') });
  store.prepare();
  // An assistant still on the old brief writes to reminders/.
  fs.mkdirSync(path.join(dir, 'reminders'), { recursive: true });
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

test('view(): a day off has no brief to show, but due reminders still fire', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-'));
  const store = new AssistantStore({ dir, orchestratorsDir: '/o', template: '', claudeConfig: path.join(dir, 'claude.json') });
  store.prepare();
  fs.writeFileSync(path.join(dir, 'notes', 'noor.md'), `---\ntitle: Talk to Noor\ndue: ${new Date(SAT_9 - 3600_000).toISOString()}\nstatus: open\n---\n`);
  assert.deepStrictEqual(store.configure({ days: [1, 2, 3, 4, 5] }).days, [1, 2, 3, 4, 5]);
  store.tick({ last_morning: day(SAT_9) });
  const sat = store.view(idle, SAT_9);
  assert.strictEqual(sat.workday, false);
  assert.strictEqual(sat.morning, false);
  assert.deepStrictEqual(sat.due.map((r) => r.text), ['Talk to Noor']);
  store.configure({ days: [6] });
  assert.strictEqual(store.view(idle, SAT_9).workday, true);
  assert.strictEqual(store.view(idle, SAT_9).morning, true);
  assert.deepStrictEqual(store.configure({ days: 'junk' }).days, [1, 2, 3, 4, 5]);
});

test('a message with images: image blocks first, then the text', () => {
  const png = { mediaType: 'image/png', data: 'aGk=' };
  assert.deepStrictEqual(JSON.parse(userLine('what is this?', [png])).message.content, [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGk=' } },
    { type: 'text', text: 'what is this?' },
  ]);
  // an image alone has no empty text block
  assert.deepStrictEqual(JSON.parse(userLine('', [png])).message.content.map((b) => b.type), ['image']);
});

test('chat images: saved next to the chat, shown as data URLs, checked and pruned', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-'));
  const store = new AssistantStore({ dir, orchestratorsDir: '/o', template: '', claudeConfig: path.join(dir, 'claude.json') });
  const data = Buffer.from('png bytes').toString('base64');
  const files = store.saveImages([{ mediaType: 'image/png', data }, { mediaType: 'image/jpeg', data }], 1000);
  assert.deepStrictEqual(files, ['1000-0.png', '1000-1.jpg']);
  store.appendChat({ role: 'user', text: 'look', images: [...files, 'gone.png'] });
  assert.deepStrictEqual(store.chat()[0].images, [`data:image/png;base64,${data}`, `data:image/jpeg;base64,${data}`]);
  assert.throws(() => store.saveImages([{ mediaType: 'image/svg+xml', data }]), /PNG, JPEG/);
  assert.throws(() => store.saveImages(Array(5).fill({ mediaType: 'image/png', data })), /At most 4/);
  assert.throws(() => store.saveImages([{ mediaType: 'image/png', data: '' }]), /empty/);
  assert.strictEqual(store.imageURL('../assistant.json'), null);
  for (let t = 2000; t < 2045; t++) store.saveImages([{ mediaType: 'image/png', data }], t);
  const kept = fs.readdirSync(path.join(dir, 'chat-images'));
  assert.strictEqual(kept.length, 40);
  assert.ok(!kept.includes('1000-0.png') && kept.includes('2044-0.png'));
});
