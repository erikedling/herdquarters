// The assistant (PiPi unless the user renamed it): one headless Claude session (assistant-session.js) that
// lives as long as the office does. It keeps its memory in plain markdown
// under <userData>/assistant/memory, so a fresh session loses nothing. The
// office runs its clock: runAssistant() decides whether to start the session,
// say hello, give the morning brief, dream (tidy the memory) or start a fresh
// session after a dream. Reminders are files it writes to reminders/; the
// office fires them on time. The chat is kept in chat.jsonl for the window.

const fs = require('node:fs');
const path = require('node:path');
const { readInbox, setFrontmatter, trustFolder } = require('./orchestrators');

const BOOT_MS = 60_000;           // a session that just started (or crashed) gets this long before another start
const QUIET_MS = 30 * 60_000;     // dream only after this long without work
const DREAM_EVERY_MS = 20 * 3600_000;
const CHAT_KEEP = 400;            // lines of chat.jsonl kept when it is trimmed
const DEFAULTS = { enabled: true, morning: '08:30', name: 'PiPi' };

// What the user calls the assistant: one line, at most 24 characters, PiPi
// when left empty.
function assistantName(raw) {
  const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24).trim();
  return name || DEFAULTS.name;
}

const MEMORY_FILES = {
  'ME.md': '# Me\n\nWho the user is: name, role, team, how they like to work and be talked to.\n',
  'NOW.md': '# Now\n\nWhat the user is focused on these days, and open loops worth bringing up.\n',
  'INDEX.md': '# Index\n\nOne line per project card in projects/: `- [name](projects/<file>.md) — one line`.\n',
};

// Local day as YYYY-MM-DD, so "once a day" follows the user's clock.
function day(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Whether today's morning brief is due: a weekday, past the morning time,
// and not given today. morning: 'HH:MM'.
function morningDue(state, config, now) {
  const d = new Date(now);
  if (d.getDay() === 0 || d.getDay() === 6) return false;
  const [h, m] = String(config.morning || DEFAULTS.morning).split(':').map(Number);
  if (d.getHours() * 60 + d.getMinutes() < h * 60 + (m || 0)) return false;
  return state.last_morning !== day(now);
}

// What to do now: 'none', 'start', 'hello', 'morning', 'dream' or 'clear'.
// state: assistant.json; session: { running, busy }; met: whether ME.md says
// who the user is.
function assistantDue({ state = {}, config = DEFAULTS, session, met, now }) {
  if (config.enabled === false) return 'none';
  if (!session.running) return state.started_at && now - state.started_at < BOOT_MS ? 'none' : 'start';
  if (session.busy) return 'none';
  if (state.phase === 'dreaming') return 'clear';
  if (!met) return state.hello_at && now - state.hello_at < 12 * 3600_000 ? 'none' : 'hello';
  if (morningDue(state, config, now)) return 'morning';
  const quiet = now - (state.last_busy || 0) >= QUIET_MS;
  if (quiet && now - (state.last_dream || 0) >= DREAM_EVERY_MS) return 'dream';
  return 'none';
}

// ME.md still has only its heading and hint: the user has not been met.
function knowsUser(raw) {
  const body = String(raw || '').replace(MEMORY_FILES['ME.md'], '').trim();
  return body.length > 0;
}

// Reminders from reminders/*.md: { file, due (ms), text, status }. Due ones
// are open and past their time, oldest first; a bad date never fires.
function reminderList(messages) {
  return messages.map((m) => ({ file: m.file, due: Date.parse(m.due || ''), text: m.text, status: String(m.status || 'open').toLowerCase() }))
    .filter((r) => r.status === 'open' && Number.isFinite(r.due))
    .sort((a, b) => a.due - b.due);
}
const dueReminders = (list, now) => list.filter((r) => r.due <= now);

// What the office asks, and how the chat shows that it asked.
const PROMPTS = {
  hello: { text: 'Say hello: follow "First meeting" in your CLAUDE.md.', note: '👋 First meeting' },
  morning: { text: 'Good morning: follow "Morning brief" in your CLAUDE.md.', note: '☀️ Morning brief' },
  dream: { text: 'Time to dream: follow "Dreaming" in your CLAUDE.md, then stop.', note: '💤 Dreaming' },
};

// Read Slack, never write it. Read anything on disk, write only in its folder.
// Headless, so anything not allowed here is refused without a prompt.
const SLACK_TOOL = (t) => `mcp__claude_ai_Slack__slack_${t}`;
const SETTINGS = {
  permissions: {
    allow: [
      ...['read_thread', 'read_channel', 'read_user_profile', 'search_channels', 'search_users', 'search_public', 'search_public_and_private'].map(SLACK_TOOL),
      'Read', 'Glob', 'Grep', 'Edit(./**)', 'Write(./**)', 'Bash(date:*)', 'Bash(ls:*)', 'Bash(gh pr view:*)', 'Bash(gh pr list:*)',
    ],
    deny: ['send_message', 'send_message_draft', 'schedule_message', 'add_reaction', 'create_canvas', 'update_canvas'].map(SLACK_TOOL),
  },
};

class AssistantStore {
  // dir: <userData>/assistant; orchestratorsDir: where the bosses live (the
  // assistant reads their boards and Slack findings); template: assistant-brief.md.
  constructor({ dir, orchestratorsDir, template, claudeConfig }) {
    this.dir = dir;
    this.orchestratorsDir = orchestratorsDir;
    this.template = template || '';
    this.claudeConfig = claudeConfig;
  }

  file(...p) { return path.join(this.dir, ...p); }

  readState() {
    try { return JSON.parse(fs.readFileSync(this.file('assistant.json'), 'utf8')) || {}; } catch { return {}; }
  }
  tick(patch) {
    const state = { ...this.readState(), ...patch };
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file('assistant.json'), JSON.stringify(state, null, 2) + '\n');
    return state;
  }
  config() { return { ...DEFAULTS, ...(this.readState().config || {}) }; }
  configure(patch) {
    const next = { ...this.config(), ...patch };
    next.name = assistantName(next.name);
    return this.tick({ config: next }).config;
  }

  // Brief, permissions and an empty memory. Memory files are the assistant's:
  // only missing ones are written.
  prepare() {
    for (const sub of ['memory/projects', 'memory/journal', 'reminders', '.claude']) fs.mkdirSync(this.file(sub), { recursive: true });
    for (const [name, text] of Object.entries(MEMORY_FILES)) {
      if (!fs.existsSync(this.file('memory', name))) fs.writeFileSync(this.file('memory', name), text);
    }
    const name = assistantName(this.config().name);
    fs.writeFileSync(this.file('CLAUDE.md'), this.template
      .replace(/\{\{name\}\}/g, () => name)
      .replace(/\{\{folder\}\}/g, this.dir)
      .replace(/\{\{orchestrators\}\}/g, this.orchestratorsDir));
    fs.writeFileSync(this.file('.claude', 'settings.json'), JSON.stringify(SETTINGS, null, 2) + '\n');
    try { trustFolder(this.dir, this.claudeConfig); } catch (err) { console.warn(`assistant: ${err.message}`); }
  }

  met() {
    try { return knowsUser(fs.readFileSync(this.file('memory', 'ME.md'), 'utf8')); } catch { return false; }
  }

  reminders() { return reminderList(readInbox(this.file('reminders'))); }

  // The user saw a reminder: it is done and never fires again.
  dismissReminder(file) {
    if (path.basename(file) !== file) throw new Error('Not a reminder');
    const p = this.file('reminders', file);
    fs.writeFileSync(p, setFrontmatter(fs.readFileSync(p, 'utf8'), 'status', 'done'));
  }

  // ---- the chat window ----

  // entry: { role: 'user' | 'assistant' | 'note', text }. Trimmed to the last
  // CHAT_KEEP lines now and then, so the file never grows without end.
  appendChat(entry, now = Date.now()) {
    fs.mkdirSync(this.dir, { recursive: true });
    const p = this.file('chat.jsonl');
    fs.appendFileSync(p, JSON.stringify({ ...entry, at: now }) + '\n');
    if (fs.statSync(p).size > 512 * 1024) fs.writeFileSync(p, fs.readFileSync(p, 'utf8').trim().split('\n').slice(-CHAT_KEEP).join('\n') + '\n');
  }
  chat(limit = 200) {
    let raw = '';
    try { raw = fs.readFileSync(this.file('chat.jsonl'), 'utf8'); } catch { return []; }
    return raw.trim().split('\n').slice(-limit).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  }

  // OFFICE.md: what is in the office right now, with the links the assistant
  // may put in its answers. Written by the renderer, which knows the names.
  writeOffice(markdown) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file('OFFICE.md'), String(markdown));
  }

  // What the office shows: what the assistant is doing and the reminders.
  view(session, now = Date.now()) {
    const state = this.readState();
    const reminders = this.reminders();
    return {
      enabled: this.config().enabled !== false,
      running: session.running,
      busy: session.busy,
      dreaming: state.phase === 'dreaming',
      // The brief was given today and the user has not opened the chat since.
      morning: state.last_morning === day(now) && state.morning_seen !== day(now),
      due: dueReminders(reminders, now),
      upcoming: reminders.filter((r) => r.due > now).slice(0, 5),
    };
  }

  markMorningSeen(now = Date.now()) { this.tick({ morning_seen: day(now) }); }
}

// Called on the assistant's clock. store: AssistantStore; session: AssistantSession.
function runAssistant({ store, session, now = Date.now() }) {
  const state = store.readState();
  if (session.busy) { store.tick({ last_busy: now }); return 'none'; }
  const action = assistantDue({ state, config: store.config(), session, met: store.met(), now });
  try {
    if (action === 'start') {
      store.tick({ started_at: now, phase: state.phase === 'dreaming' ? null : state.phase });
      store.prepare();
      // A dream that was cut short still ends in a fresh session.
      session.start(state.phase === 'dreaming' ? null : state.session_id || null);
    } else if (action === 'clear') {
      session.stop();
      store.tick({ phase: null, session_id: null, started_at: 0 });
      store.appendChat({ role: 'note', text: '🌅 Woke up with a tidy memory' }, now);
    } else if (action !== 'none') {
      store.prepare(); // a newer brief reaches the session at its next message
      if (action === 'hello') store.tick({ hello_at: now });
      if (action === 'morning') store.tick({ last_morning: day(now), last_busy: now });
      if (action === 'dream') store.tick({ phase: 'dreaming', last_dream: now });
      store.appendChat({ role: 'note', text: PROMPTS[action].note }, now);
      session.send(PROMPTS[action].text);
    }
  } catch (err) {
    console.warn(`assistant (${action}): ${err.message || err}`);
  }
  return action;
}

module.exports = { AssistantStore, runAssistant, assistantDue, morningDue, knowsUser, reminderList, dueReminders, day, assistantName, MEMORY_FILES, DEFAULTS, PROMPTS };
