// The assistant (PiPi unless the user renamed it): one headless Claude session (assistant-session.js) that
// lives as long as the office does. It keeps its memory in plain markdown
// under <userData>/assistant/memory, so a fresh session loses nothing. The
// office runs its clock: runAssistant() decides whether to start the session,
// say hello, give the morning brief, dream (tidy the memory) or start a fresh
// session after a dream. Reminders are notes (notes.js) with a time, which
// the user pins on the corkboard or the assistant writes to notes/; the
// office fires them on time. The chat is kept in chat.jsonl for the window.

const fs = require('node:fs');
const path = require('node:path');
const { trustFolder } = require('./orchestrators');
const { NotesStore } = require('./notes');

const BOOT_MS = 60_000;           // a session that just started (or crashed) gets this long before another start
const QUIET_MS = 30 * 60_000;     // dream only after this long without work
const DREAM_EVERY_MS = 20 * 3600_000;
const CHAT_KEEP = 400;            // lines of chat.jsonl kept when it is trimmed
// Images the user sends in the chat: what Claude reads, at most this many per
// message and this big each (the API's limit is 5 MB), and how many are kept.
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGES_KEEP = 40;
const DEFAULTS = { enabled: true, morning: '08:30', name: 'PiPi', days: [1, 2, 3, 4, 5] };

// What the user calls the assistant: one line, at most 24 characters, PiPi
// when left empty.
function assistantName(raw) {
  const name = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24).trim();
  return name || DEFAULTS.name;
}

// The days it works on, as getDay() numbers (0 is Sunday), sorted. Empty
// means never; anything that is not a list gets the default Mon–Fri.
function assistantDays(raw) {
  if (!Array.isArray(raw)) return [...DEFAULTS.days];
  return [...new Set(raw.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
}
const workday = (config, now) => assistantDays(config.days ?? DEFAULTS.days).includes(new Date(now).getDay());

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

// Whether today's morning brief is due: a work day, past the morning time,
// and not given today. morning: 'HH:MM'.
function morningDue(state, config, now) {
  const d = new Date(now);
  if (!workday(config, now)) return false;
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
  // On a day off it only does its silent upkeep: no hello, no brief.
  if (!met) return !workday(config, now) || (state.hello_at && now - state.hello_at < 12 * 3600_000) ? 'none' : 'hello';
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

// Reminders: open notes with a time, as { file, due (ms), text, color },
// oldest first; a note without a valid time never fires.
function reminderList(notes) {
  return notes.filter((n) => n.status === 'open' && Number.isFinite(n.due))
    .map((n) => ({ file: n.file, due: n.due, text: n.title, color: n.color }))
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
// orchestratorsDir is a working directory too (--add-dir, see
// AssistantSession), so the deny keeps it read only.
const SLACK_TOOL = (t) => `mcp__claude_ai_Slack__slack_${t}`;
function assistantSettings(orchestratorsDir) {
  return {
    permissions: {
      allow: [
        ...['read_thread', 'read_channel', 'read_user_profile', 'search_channels', 'search_users', 'search_public', 'search_public_and_private'].map(SLACK_TOOL),
        'Read', 'Glob', 'Grep', 'Edit(./**)', 'Bash(date:*)', 'Bash(ls:*)', 'Bash(gh pr view:*)', 'Bash(gh pr list:*)',
      ],
      deny: [
        ...['send_message', 'send_message_draft', 'schedule_message', 'add_reaction', 'create_canvas', 'update_canvas'].map(SLACK_TOOL),
        ...(orchestratorsDir ? [`Edit(/${path.resolve(orchestratorsDir)}/**)`] : []),
      ],
    },
  };
}

class AssistantStore {
  // dir: <userData>/assistant; orchestratorsDir: where the bosses live (the
  // assistant reads their boards and Slack findings); template: assistant-brief.md.
  constructor({ dir, orchestratorsDir, template, claudeConfig }) {
    this.dir = dir;
    this.orchestratorsDir = orchestratorsDir;
    this.template = template || '';
    this.claudeConfig = claudeConfig;
    this.notes = new NotesStore({ dir: this.file('notes'), legacy: this.file('reminders') });
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
    next.days = assistantDays(next.days);
    return this.tick({ config: next }).config;
  }

  // Brief, permissions and an empty memory. Memory files are the assistant's:
  // only missing ones are written.
  prepare() {
    for (const sub of ['memory/projects', 'memory/journal', 'notes', '.claude']) fs.mkdirSync(this.file(sub), { recursive: true });
    for (const [name, text] of Object.entries(MEMORY_FILES)) {
      if (!fs.existsSync(this.file('memory', name))) fs.writeFileSync(this.file('memory', name), text);
    }
    const name = assistantName(this.config().name);
    this.notes.prepare();
    fs.writeFileSync(this.file('CLAUDE.md'), this.template
      .replace(/\{\{name\}\}/g, () => name)
      .replace(/\{\{folder\}\}/g, this.dir)
      .replace(/\{\{orchestrators\}\}/g, this.orchestratorsDir));
    fs.writeFileSync(this.file('.claude', 'settings.json'), JSON.stringify(assistantSettings(this.orchestratorsDir), null, 2) + '\n');
    try { trustFolder(this.dir, this.claudeConfig); } catch (err) { console.warn(`assistant: ${err.message}`); }
  }

  met() {
    try { return knowsUser(fs.readFileSync(this.file('memory', 'ME.md'), 'utf8')); } catch { return false; }
  }

  reminders() { return reminderList(this.notes.all()); }

  // The user saw a reminder: its note is done and never fires again.
  dismissReminder(file) { this.notes.done(file); }

  // ---- the chat window ----

  // entry: { role: 'user' | 'assistant' | 'note', text, images? (file names
  // from saveImages) }. Trimmed to the last CHAT_KEEP lines now and then, so
  // the file never grows without end.
  appendChat(entry, now = Date.now()) {
    fs.mkdirSync(this.dir, { recursive: true });
    const p = this.file('chat.jsonl');
    fs.appendFileSync(p, JSON.stringify({ ...entry, at: now }) + '\n');
    if (fs.statSync(p).size > 512 * 1024) fs.writeFileSync(p, fs.readFileSync(p, 'utf8').trim().split('\n').slice(-CHAT_KEEP).join('\n') + '\n');
  }
  // The chat for the window, images as data URLs (a pruned one is left out).
  chat(limit = 200) {
    let raw = '';
    try { raw = fs.readFileSync(this.file('chat.jsonl'), 'utf8'); } catch { return []; }
    return raw.trim().split('\n').slice(-limit).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } })
      .map((e) => (e.images ? { ...e, images: e.images.map((n) => this.imageURL(n)).filter(Boolean) } : e));
  }

  // images: [{ mediaType, data (base64) }] from the chat window. Checks them,
  // saves them under chat-images/ and returns their file names; the oldest
  // beyond IMAGES_KEEP are deleted.
  saveImages(images, now = Date.now()) {
    const list = Array.isArray(images) ? images : [];
    if (list.length > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} images per message`);
    const files = list.map((img, i) => {
      const ext = IMAGE_TYPES[img?.mediaType];
      if (!ext || typeof img.data !== 'string') throw new Error('Only PNG, JPEG, GIF and WebP images can be sent');
      const bytes = Buffer.from(img.data, 'base64');
      if (!bytes.length) throw new Error('The image is empty');
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error('The image is too big (5 MB at most)');
      return { name: `${now}-${i}.${ext}`, bytes };
    });
    if (!files.length) return [];
    const dir = this.file('chat-images');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(dir, f.name), f.bytes);
    const all = fs.readdirSync(dir).sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || a.localeCompare(b));
    for (const old of all.slice(0, Math.max(0, all.length - IMAGES_KEEP))) fs.rmSync(path.join(dir, old), { force: true });
    return files.map((f) => f.name);
  }
  imageURL(name) {
    const ext = path.extname(String(name)).slice(1);
    const type = Object.keys(IMAGE_TYPES).find((t) => IMAGE_TYPES[t] === ext);
    if (!type || path.basename(String(name)) !== name) return null;
    try { return `data:${type};base64,${fs.readFileSync(this.file('chat-images', name)).toString('base64')}`; } catch { return null; }
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
    const config = this.config();
    const reminders = this.reminders();
    const work = workday(config, now);
    return {
      enabled: config.enabled !== false,
      // A day off: it does not call or visit cards; reminders still fire.
      workday: work,
      running: session.running,
      busy: session.busy,
      dreaming: state.phase === 'dreaming',
      // The brief was given today and the user has not opened the chat since.
      morning: work && state.last_morning === day(now) && state.morning_seen !== day(now),
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

module.exports = { AssistantStore, assistantSettings, runAssistant, assistantDue, morningDue, workday, assistantDays, knowsUser, reminderList, dueReminders, day, assistantName, MEMORY_FILES, DEFAULTS, PROMPTS, MAX_IMAGES };
