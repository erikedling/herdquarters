// Orchestrators: a boss agent in its own herdr workspace. The boss opens
// worktrees on the orchestrator's branch in the repos a task needs and starts
// its own workers there; the office recognises those rooms by the branch. Each one is a folder under
// <userData>/orchestrators/<slug>/ holding orchestrator.json (written by the
// app), the boss brief (CLAUDE.md or AGENTS.md, see contextFile) and BOARD.md
// (written by the boss).
// See ../designs/orchestrator-tabs.md.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { parseWatches, watchFromInput, addWatchLine, removeWatchLine, DEFAULT_INTERVAL } = require('./slack');

// git in a checkout; resolves stdout, rejects with stderr in the message.
function git(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || '').trim().split('\n').slice(-3).join(' ')));
      else resolve(stdout);
    });
  });
}

// Claude Code's config file, where trusted folders are recorded.
function claudeConfigPath() {
  const dir = process.env.CLAUDE_CONFIG_DIR || process.env.HOME || '';
  return path.join(dir, '.claude.json');
}

// Where Claude Code keeps conversation transcripts, one folder per working directory.
function claudeProjectsDir() {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '', '.claude'), 'projects');
}

// Whether Claude Code has a saved conversation for this folder (that session,
// or any), so `claude --resume`/`--continue` has something to open. herdr's
// agent.start does not notice Claude exiting with "No conversation found" and
// waits out its whole timeout, hence the check. The folder name scheme is
// Claude's, not documented.
function hasConversation(folder, projectsDir = claudeProjectsDir(), sessionId = null) {
  const dir = path.join(projectsDir, folder.replace(/[^a-zA-Z0-9]/g, '-'));
  try {
    if (sessionId) return /^[A-Za-z0-9-]+$/.test(sessionId) && fs.existsSync(path.join(dir, `${sessionId}.jsonl`));
    return fs.readdirSync(dir).some((n) => n.endsWith('.jsonl'));
  } catch { return false; }
}

// Every orchestrator folder is new to Claude Code, which then asks "do you
// trust the files in this folder?" before it takes any prompt; herdr reports
// the boss as blocked and refuses the first task. Claude's own error text
// documents the fix: projects[<folder>].hasTrustDialogAccepted = true in
// ~/.claude.json. Throws rather than clobber a config it cannot parse.
function trustFolder(folder, configPath = claudeConfigPath()) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch (err) { if (err.code !== 'ENOENT') throw new Error(`${configPath}: ${err.message}`); }
  if (!cfg || typeof cfg !== 'object') throw new Error(`${configPath}: not a JSON object`);
  cfg.projects = cfg.projects && typeof cfg.projects === 'object' ? cfg.projects : {};
  cfg.projects[folder] = { ...(cfg.projects[folder] || {}), hasTrustDialogAccepted: true };
  fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
}

// Pi's config folder; trust decisions and sessions live under it.
function piAgentDir() {
  return process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME || '', '.pi', 'agent');
}

// Pi's folder of saved sessions for a working directory, named as pi's
// session manager names it (getDefaultSessionDirPath in pi-coding-agent).
function piSessionDir(folder, sessionsDir = path.join(piAgentDir(), 'sessions')) {
  return path.join(sessionsDir, `--${folder.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`);
}

// Whether pi has a saved session for this folder. herdr reports a pi session
// as the path of its .jsonl file; `pi --session <path>` opens it, and exits
// with "No session found" when it is gone. `pi --continue` never fails, it
// starts a new session when there is none.
function hasPiConversation(folder, sessionsDir = path.join(piAgentDir(), 'sessions'), sessionPath = null) {
  const dir = piSessionDir(folder, sessionsDir);
  try {
    if (sessionPath) return path.dirname(sessionPath) === dir && sessionPath.endsWith('.jsonl') && fs.existsSync(sessionPath);
    return fs.readdirSync(dir).some((n) => n.endsWith('.jsonl'));
  } catch { return false; }
}

// Pi asks whether to trust a folder that has a .pi/skills folder (the boss's
// does) before it loads it, and herdr then never sees it ready. A saved
// decision in ~/.pi/agent/trust.json, keyed by canonical path, answers it;
// subfolders inherit the closest one. Throws rather than clobber a file it cannot parse.
function trustPiFolder(folder, trustPath = path.join(piAgentDir(), 'trust.json')) {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(trustPath, 'utf8')); }
  catch (err) { if (err.code !== 'ENOENT') throw new Error(`${trustPath}: ${err.message}`); }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error(`${trustPath}: not a JSON object`);
  let key = folder;
  try { key = fs.realpathSync(folder); } catch { /* not there yet */ }
  cfg[key] = true;
  fs.mkdirSync(path.dirname(trustPath), { recursive: true });
  fs.writeFileSync(trustPath, JSON.stringify(cfg, null, 2) + '\n');
}

// The coding agents an orchestrator can run (herdr's --kind). Orchestrators
// made before the setting existed have no `agent` and run Claude.
const AGENT_KINDS = ['claude', 'pi'];
const agentKind = (json) => (AGENT_KINDS.includes(json?.agent) ? json.agent : 'claude');
// The file each kind reads its instructions from at session start.
const contextFile = (kind) => (kind === 'pi' ? 'AGENTS.md' : 'CLAUDE.md');
// Where each kind finds the boss's project skills.
const skillsDir = (kind) => (kind === 'pi' ? ['.pi', 'skills'] : ['.claude', 'skills']);
const AGENT_LABELS = { claude: 'Claude Code', pi: 'Pi' };

const COLORS = ['#f2c531', '#ff7ab6', '#2bb3a3', '#8a5cf6', '#f0862e', '#38c172', '#4f7cff', '#e4573d'];
const NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const qaAgent = (slug) => `${slug}-qa`; // slug is at most 24 characters, so this fits herdr's 32
const opsAgent = (slug) => `${slug}-ops`;

function slugify(s) {
  const slug = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '');
  return slug && /^[a-z]/.test(slug) ? slug : (slug ? `o-${slug}`.slice(0, 24) : '');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// How long a workspace.create whose answer was lost may still take effect in herdr.
const LATE_CREATE_MS = 60_000;
// herdr agent names: [a-z][a-z0-9_-]{0,31}. Slug + repo can exceed 32, so cut.
function workerName(slug, repo) {
  const r = (slugify(repo) || 'repo').slice(0, 30);
  const full = `${slug}-${r}`;
  if (full.length <= 32) return full;
  // Too long: keep the repo readable and clip the orchestrator part instead.
  const head = slug.slice(0, Math.max(1, 32 - r.length - 1)).replace(/-+$/, '') || slug[0];
  return `${head}-${r}`.slice(0, 32).replace(/-+$/, '');
}

// "- none", "- n/a", "- –" and the like are empty sections, not entries.
const PLACEHOLDER = /^(none|nothing|n\/a|na|no blockers?|no questions?|-+|–|—|\(none\)|none yet|nothing yet|todo|tbd)\.?$/i;

// BOARD.md → { title, updated, tasks: [{done, text, owner, group}], blockers: [], questions: [{text, owner}], next: [], raw }
// group: the "### heading" a task sits under inside ## Tasks, or null.
// next: the boss's suggestions for what to ask it next, shown as chips above the task bar.
function parseBoard(raw) {
  const board = { title: '', updated: '', tasks: [], blockers: [], questions: [], next: [], raw: raw || '' };
  if (!raw) return board;
  let section = '', group = null;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (/^#\s+/.test(t) && !board.title) { board.title = t.replace(/^#\s+/, ''); continue; }
    if (/^updated:/i.test(t)) { board.updated = t.replace(/^updated:\s*/i, ''); continue; }
    if (/^##\s+/.test(t)) { section = t.replace(/^##\s+/, '').toLowerCase(); group = null; continue; }
    if (/^###\s+/.test(t)) { group = t.replace(/^###\s+/, '').trim() || null; continue; }
    const task = t.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (section.startsWith('task') && task) {
      let text = task[2].trim();
      let owner = null;
      const m = text.match(/\(@([a-z0-9_-]+)\)\s*$/i);
      if (m) { owner = m[1]; text = text.slice(0, m.index).trim(); }
      board.tasks.push({ done: task[1].toLowerCase() === 'x', text, owner, group });
    } else if (section.startsWith('blocker') && /^[-*]\s+/.test(t)) {
      const text = t.replace(/^[-*]\s+/, '').trim();
      if (!PLACEHOLDER.test(text)) board.blockers.push(text);
    } else if (section.startsWith('question') && /^[-*]\s+/.test(t)) {
      // "(@worker)" or "(@worker-a, @worker-b)" at the end names who is waiting.
      let text = t.replace(/^[-*]\s+/, '');
      if (PLACEHOLDER.test(text.trim())) continue;
      let owners = [];
      const m = text.match(/\((@[a-z0-9_-]+(?:\s*,\s*@[a-z0-9_-]+)*)\)\s*$/i);
      if (m) { owners = m[1].split(',').map((x) => x.trim().replace(/^@/, '')); text = text.slice(0, m.index).trim(); }
      board.questions.push({ text, owner: owners[0] || null, owners });
    } else if (section.startsWith('next') && /^[-*]\s+/.test(t)) {
      const text = t.replace(/^[-*]\s+/, '').trim();
      if (!PLACEHOLDER.test(text) && board.next.length < 3) board.next.push(text);
    }
  }
  return board;
}

// The Slack watcher may read Slack and write in its own folder, and nothing
// else, so a check never stops at a permission prompt and never posts.
const SLACK_TOOL = (t) => `mcp__claude_ai_Slack__slack_${t}`;
const SLACK_SETTINGS = {
  permissions: {
    allow: [
      ...['read_thread', 'read_channel', 'read_user_profile', 'get_reactions', 'search_channels', 'search_users', 'search_public', 'search_public_and_private'].map(SLACK_TOOL),
      'Read', 'Glob', 'Grep', 'Edit(./**)', 'Write(./**)', 'Bash(date:*)', 'Bash(ls:*)',
    ],
    deny: ['send_message', 'send_message_draft', 'schedule_message', 'add_reaction', 'create_canvas', 'update_canvas', 'create_conversation',
      'create_list', 'add_list_record', 'update_list', 'update_list_record', 'get_file_upload_url', 'complete_file_upload'].map(SLACK_TOOL),
  },
};
const WATCHES_HEAD = '# Slack watches\n\nOne per line: `- thread|channel|dm <Slack link, #channel or @name> — <why>`.\n\n';

// inbox/*.md → [{ file, kind, from, at, text }]; handled files live in inbox/done/.
// PEOPLE.md: the name on each desk next to the herdr agent name, so the boss
// knows who the user means by "ask Patrik". people: [{name, agent, role, repo}].
function peopleMarkdown(people) {
  const cell = (v) => String(v || '').replace(/[|`\r\n]/g, ' ').trim(); // values come from the renderer
  const cap = (n) => cell(n).charAt(0).toUpperCase() + cell(n).slice(1).toLowerCase();
  const order = { boss: 0, worker: 1, qa: 2, ops: 3 };
  const rows = [...people]
    .sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3) || String(a.name).localeCompare(String(b.name)))
    .map((p) => `| ${cap(p.name)} | ${cell(p.agent) ? `\`${cell(p.agent)}\`` : '–'} | ${p.role === 'boss' ? 'boss (you)' : cell(p.role) || '–'} | ${cell(p.repo) || '–'} |`);
  return [
    '# People',
    '',
    'Written by the office whenever someone sits down or leaves. The name is the one',
    'on their desk; use the agent name in herdr commands.',
    '',
    ...(rows.length ? ['| name | agent name | role | repo |', '|---|---|---|---|', ...rows] : ['_Nobody is at a desk yet._']),
    '',
  ].join('\n');
}

function readInbox(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.md')); } catch { return []; }
  const out = [];
  for (const name of names) {
    try {
      const raw = fs.readFileSync(path.join(dir, name), 'utf8');
      const msg = { file: name, kind: 'note', from: null, at: fs.statSync(path.join(dir, name)).mtimeMs, text: raw.trim() };
      const fm = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
      if (fm) {
        for (const line of fm[1].split(/\r?\n/)) {
          const kv = line.match(/^(\w+):\s*(.*)$/);
          if (kv) msg[kv[1].toLowerCase()] = kv[2].trim();
        }
        msg.text = fm[2].trim();
      }
      if (!msg.from) { const m = name.match(/^([a-z][a-z0-9_-]*?)-\d+\.md$/); if (m) msg.from = m[1]; }
      out.push(msg);
    } catch { /* skip unreadable */ }
  }
  return out.sort((a, b) => a.at - b.at);
}

// Sets one `key: value` line in a message's frontmatter (see readInbox),
// adding the block when the file has none. The rest of the file is kept.
function setFrontmatter(raw, key, value) {
  const line = `${key}: ${value}`;
  const fm = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!fm) return `---\n${line}\n---\n${raw}`;
  const lines = fm[1].split(/\r?\n/);
  const i = lines.findIndex((l) => l.toLowerCase().startsWith(`${key.toLowerCase()}:`));
  if (i === -1) lines.push(line); else lines[i] = line;
  return `---\n${lines.join('\n')}\n---\n${raw.slice(fm[0].length)}`;
}

class OrchestratorStore {
  // client: HerdrClient (null in fixture mode). onChange(): called when a
  // board or orchestrator.json changes so the renderer can be refreshed.
  constructor({ dir, client, onChange, briefTemplate, skillTemplate, qaTemplate, opsTemplate, slackTemplate, claudeConfig, claudeProjects, piTrust, piSessions }) {
    this.dir = dir;
    this.client = client;
    this.claudeConfig = claudeConfig || claudeConfigPath();
    this.claudeProjects = claudeProjects || claudeProjectsDir();
    this.piTrust = piTrust || path.join(piAgentDir(), 'trust.json');
    this.piSessions = piSessions || path.join(piAgentDir(), 'sessions');
    this.onChange = onChange || (() => {});
    this.briefTemplate = briefTemplate;
    this.skillTemplate = skillTemplate || '';
    this.qaTemplate = qaTemplate || '';
    this.opsTemplate = opsTemplate || '';
    this.slackTemplate = slackTemplate || '';
    this.watchers = new Map(); // slug -> fs.FSWatcher
    this.changeTimer = null;
    // Saved with the in-progress statuses, so reconcile() can tell a create or
    // restore still running here from one an earlier app run left unfinished.
    this.run = `${process.pid}-${Date.now()}`;
    fs.mkdirSync(path.join(this.dir, 'archive'), { recursive: true });
    for (const o of this.readAll()) { try { this.watch(o.slug); } catch { /* bad slug in a hand-edited json */ } }
  }

  // ---- disk ----

  // Slugs come from the renderer over IPC; only the shape slugify() makes may
  // become a path, so a stray "../x" can never point outside this.dir.
  folder(slug) {
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) throw new Error(`Invalid orchestrator slug: ${JSON.stringify(slug)}`);
    return path.join(this.dir, slug);
  }

  readAll() {
    let names = [];
    try { names = fs.readdirSync(this.dir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'archive').map((d) => d.name); } catch { return []; }
    const out = [];
    for (const name of names) {
      try {
        const json = JSON.parse(fs.readFileSync(path.join(this.dir, name, 'orchestrator.json'), 'utf8'));
        if (json.status === 'ended') continue;
        let raw = '';
        try { raw = fs.readFileSync(path.join(this.dir, name, 'BOARD.md'), 'utf8'); } catch { /* no board yet */ }
        let boardMtime = 0;
        try { boardMtime = fs.statSync(path.join(this.dir, name, 'BOARD.md')).mtimeMs; } catch { /* none */ }
        // worker agent name per repo, so the renderer can match inbox senders to desks
        const workerNames = {};
        for (const r of json.repos || []) workerNames[r.name] = workerName(json.slug, r.name);
        const board = parseBoard(raw);
        // Questions the user already answered from the office are hidden until the
        // boss rewrites the board without them (it may be blocked on a wait meanwhile).
        const answered = (json.answered || []).filter((a) => board.questions.some((q) => q.text === a.text));
        if (answered.length !== (json.answered || []).length) { json.answered = answered; try { this.write(name, json); } catch { /* read-only fixture */ } }
        board.answeredCount = 0;
        board.questions = board.questions.filter((q) => { const hit = answered.some((a) => a.text === q.text); if (hit) board.answeredCount++; return !hit; });
        // Suggestions the user sent stay hidden until the boss rewrites the board without
        // them, as answered questions do; declined ones stay hidden for good.
        const sent = (json.next_sent || []).filter((t) => board.next.includes(t));
        if (sent.length !== (json.next_sent || []).length) { json.next_sent = sent; try { this.write(name, json); } catch { /* read-only fixture */ } }
        board.next = board.next.filter((t) => !sent.includes(t) && !(json.declined || []).includes(t));
        // Alert files are written by the ops agent in the inbox's message format.
        out.push({ ...json, agent: agentKind(json), folder: path.join(this.dir, name), board, boardMtime, inbox: readInbox(path.join(this.dir, name, 'inbox')), alerts: readInbox(path.join(this.dir, name, 'alerts')), slack: this.readSlack(name, json), workerNames });
      } catch { /* skip broken folders */ }
    }
    return out.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }

  list() { return this.readAll(); }

  read(slug) {
    return JSON.parse(fs.readFileSync(path.join(this.folder(slug), 'orchestrator.json'), 'utf8'));
  }

  write(slug, json) {
    fs.writeFileSync(path.join(this.folder(slug), 'orchestrator.json'), JSON.stringify(json, null, 2) + '\n');
  }

  watch(slug) {
    if (this.watchers.has(slug)) return;
    const bump = (_event, file) => {
      if (file === 'PEOPLE.md') return; // the office writes it itself (setPeople)
      clearTimeout(this.changeTimer); this.changeTimer = setTimeout(() => this.onChange(), 300);
    };
    const ws = [];
    for (const dir of [this.folder(slug), path.join(this.folder(slug), 'inbox'), this.alertsFolder(slug), this.slackFolder(slug), this.waitingFolder(slug)]) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const w = fs.watch(dir, bump);
        w.on('error', () => this.unwatch(slug));
        ws.push(w);
      } catch { /* folder gone */ }
    }
    if (ws.length) this.watchers.set(slug, ws);
  }

  unwatch(slug) { for (const w of this.watchers.get(slug) || []) w.close(); this.watchers.delete(slug); }
  dispose() { for (const slug of [...this.watchers.keys()]) this.unwatch(slug); clearTimeout(this.changeTimer); }

  // reason: 'closed', 'boss workspace gone' or 'interrupted', shown in the archived list.
  async archive(slug, reason = null) {
    this.unwatch(slug);
    const from = this.folder(slug);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      const json = this.read(slug); json.status = 'ended'; json.ended_at = new Date().toISOString(); json.ended_reason = reason; this.write(slug, json);
    } catch { /* still archive */ }
    await fsp.rename(from, path.join(this.dir, 'archive', `${slug}-${stamp}`)).catch(() => {});
    this.onChange();
  }

  // An ended folder outside the archive is one whose move into or out of it was
  // cut short; the tabs skip it and the archived list cannot see it.
  async archiveStrays() {
    let names = [];
    try { names = fs.readdirSync(this.dir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'archive').map((d) => d.name); } catch { return; }
    for (const name of names) {
      try {
        if (JSON.parse(fs.readFileSync(path.join(this.dir, name, 'orchestrator.json'), 'utf8')).status !== 'ended') continue;
        await fsp.rename(path.join(this.dir, name), path.join(this.dir, 'archive', `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}`));
      } catch { /* unreadable, or moved meanwhile */ }
    }
  }

  // Archive folder names are `<slug>-<ISO stamp>`; the stamp brings T and Z.
  archivedFolder(id) {
    if (!/^[a-z][a-zA-Z0-9-]*$/.test(id)) throw new Error(`Invalid archived orchestrator: ${JSON.stringify(id)}`);
    return path.join(this.dir, 'archive', id);
  }

  // Newest first: [{ id, name, slug, color, branch, ended_at, ended_reason, title, done, total, open }].
  // open: an orchestrator with the same slug is running, so this one cannot come back.
  listArchived() {
    let names = [];
    try { names = fs.readdirSync(path.join(this.dir, 'archive'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
    const out = [];
    for (const id of names) {
      try {
        const json = JSON.parse(fs.readFileSync(path.join(this.archivedFolder(id), 'orchestrator.json'), 'utf8'));
        let raw = '';
        try { raw = fs.readFileSync(path.join(this.archivedFolder(id), 'BOARD.md'), 'utf8'); } catch { /* no board */ }
        const board = parseBoard(raw);
        out.push({
          id, name: json.name, slug: json.slug, color: json.color, branch: json.branch,
          ended_at: json.ended_at || null, ended_reason: json.ended_reason || null,
          title: board.title, done: board.tasks.filter((t) => t.done).length, total: board.tasks.length,
          open: fs.existsSync(this.folder(json.slug)),
        });
      } catch { /* skip broken folders */ }
    }
    return out.sort((a, b) => String(b.ended_at).localeCompare(String(a.ended_at)));
  }

  // Brings an archived orchestrator back: its folder returns, the boss gets a
  // new workspace and reopens its last conversation there (a fresh session
  // when there is none; the board and inbox carry the state either way).
  // Workers are left to the boss, as in create(). spec: { qa, instructions }.
  async restore(id, spec = {}, progress = () => {}) {
    const from = this.archivedFolder(id);
    let json;
    try { json = JSON.parse(fs.readFileSync(path.join(from, 'orchestrator.json'), 'utf8')); }
    catch { throw new Error('That archived orchestrator is gone or unreadable.'); }
    const slug = json.slug;
    if (fs.existsSync(this.folder(slug))) throw new Error(`An orchestrator called "${slug}" is already open. Close it first.`);
    const archived = structuredClone(json);
    const session = json.boss?.session_id || null;
    const used = this.usedColors();
    if (used.has(json.color)) json.color = COLORS.find((c) => !used.has(c)) || json.color;

    progress('Moving the folder back…');
    await fsp.rename(from, this.folder(slug));
    // Marked as this run's restore before herdr is asked: if the app dies from
    // here on, the next run's reconcile() finds it unfinished and archives it again.
    delete json.ended_at; delete json.ended_reason; delete json.trust_error;
    json.status = 'restoring';
    json.run = this.run;
    json.boss = { workspace_id: null, pane_id: null, agent: `${slug}-boss`, status: 'not_started', session_id: session };
    this.write(slug, json);
    const rollBack = async () => {
      try { this.write(slug, archived); } catch { /* moved back below either way */ }
      await fsp.rename(this.folder(slug), from).catch(() => {});
    };
    // A boss workspace that outlived its orchestrator (herdr refused to close it
    // in close()) would otherwise run next to the new one.
    if (!(await this.closeWorkspacesIn(this.folder(slug)))) {
      await rollBack();
      throw new Error('herdr could not confirm that no earlier boss workspace for this orchestrator is still open. Check herdr and try again.');
    }
    progress('Creating the boss workspace…');
    // Saved before asking: if the app dies mid-request, the next run still waits for a late workspace.
    json.boss.workspace_at = Date.now();
    this.write(slug, json);
    let ws;
    try {
      ws = await this.req('workspace.create', { cwd: this.folder(slug), label: `boss: ${json.name}`, focus: false });
    } catch (err) {
      if (err.answered) await rollBack(); else this.leaveToReconcile(slug, json);
      throw new Error(`workspace.create failed: ${err.message}`);
    }
    json.boss = {
      workspace_id: ws.workspace?.workspace_id || ws.workspace_id || null,
      pane_id: ws.root_pane?.pane_id || ws.pane?.pane_id || null,
      workspace_at: Date.now(),
      agent: `${slug}-boss`, status: 'not_started', session_id: session,
    };
    try {
      json.restored_at = new Date().toISOString();
      if ('qa' in spec) json.qa = !!spec.qa;
      if ('instructions' in spec) json.instructions = String(spec.instructions || '').trim();
      this.write(slug, json);
      // Settings may have changed while it was archived; the boss reads its brief at session start.
      this.writeBrief(json);
      this.writeHelperBriefs(json);
      this.watch(slug);

      const args = this.resumeArgs(json, session);
      if (!(session && args.length)) delete json.boss.session_id;
      progress(args.length ? 'Reopening the boss conversation…' : 'Starting a fresh boss…');
      this.trustFolders(json);
      await this.startBoss(json, args);
      json.boss.resumed = args.length > 0 && json.boss.status === 'started';
      json.status = 'running';
      this.write(slug, json);
    } catch (err) {
      this.leaveToReconcile(slug, json);
      throw err;
    }
    this.onChange();
    return json;
  }

  usedColors() { return new Set(this.readAll().map((o) => o.color)); }

  // How the boss reopens its last conversation: by session when it is known,
  // since --continue opens the newest one in the folder, which can belong to a
  // later orchestrator with the same name. [] when there is nothing to reopen.
  resumeArgs(json, session) {
    const folder = this.folder(json.slug);
    if (agentKind(json) === 'pi') {
      return session
        ? (hasPiConversation(folder, this.piSessions, session) ? ['--session', session] : [])
        : (hasPiConversation(folder, this.piSessions) ? ['--continue'] : []);
    }
    return session
      ? (hasConversation(folder, this.claudeProjects, session) ? ['--resume', session] : [])
      : (hasConversation(folder, this.claudeProjects) ? ['--continue'] : []);
  }

  // The boss brief, in the file the orchestrator's agent kind reads.
  writeBrief(json) {
    fs.writeFileSync(path.join(this.folder(json.slug), contextFile(agentKind(json))), this.brief(json));
  }

  // The QA reviewer's folder: a subfolder of the boss's, so the reviewer shares
  // the inbox and is archived with the orchestrator. It gets its own brief.
  qaFolder(slug) { return path.join(this.folder(slug), 'qa'); }
  // The ops agent's folder, the same way; it writes alert files to alertsFolder.
  opsFolder(slug) { return path.join(this.folder(slug), 'ops'); }
  alertsFolder(slug) { return path.join(this.folder(slug), 'alerts'); }
  // The Slack watcher's folder: its brief, the watch list, its state and the
  // waiting messages it found. See slack.js.
  slackFolder(slug) { return path.join(this.folder(slug), 'slack'); }
  waitingFolder(slug) { return path.join(this.slackFolder(slug), 'waiting'); }

  // The QA reviewer's and ops agent's briefs, rewritten on create and restore.
  writeHelperBriefs(json) {
    const file = contextFile(agentKind(json));
    if (this.qaTemplate) { fs.mkdirSync(this.qaFolder(json.slug), { recursive: true }); fs.writeFileSync(path.join(this.qaFolder(json.slug), file), this.qaBrief(json)); }
    if (this.opsTemplate) { fs.mkdirSync(this.opsFolder(json.slug), { recursive: true }); fs.writeFileSync(path.join(this.opsFolder(json.slug), file), this.opsBrief(json)); }
    fs.mkdirSync(this.alertsFolder(json.slug), { recursive: true });
    this.writeSlackFiles(json);
  }

  // The Slack watcher's brief, permissions and watch list. The watcher always
  // runs Claude (it reads Slack through Claude's Slack connector), so its brief
  // is CLAUDE.md whatever the orchestrator's agent kind.
  writeSlackFiles(json) {
    if (!this.slackTemplate) return;
    const folder = this.slackFolder(json.slug);
    fs.mkdirSync(path.join(folder, '.claude'), { recursive: true });
    fs.mkdirSync(this.waitingFolder(json.slug), { recursive: true });
    fs.writeFileSync(path.join(folder, 'CLAUDE.md'), this.slackBrief(json));
    fs.writeFileSync(path.join(folder, '.claude', 'settings.json'), JSON.stringify(SLACK_SETTINGS, null, 2) + '\n');
    // The list belongs to the user and the boss: a restore keeps it.
    if (!fs.existsSync(path.join(folder, 'WATCHES.md'))) fs.writeFileSync(path.join(folder, 'WATCHES.md'), WATCHES_HEAD);
  }

  // Before the watcher starts: an orchestrator created before the watcher
  // existed, or a Pi one, has no brief, permissions or Claude trust for slack/ yet.
  prepareSlack(slug) {
    this.writeSlackFiles(this.read(slug));
    trustFolder(this.slackFolder(slug), this.claudeConfig);
  }

  // Pre-accepts the agent's trust prompt for the boss, QA and ops folders (see
  // trustFolder, trustPiFolder), and Claude's for the Slack folder of a Claude
  // orchestrator. A Pi orchestrator leaves Claude's config alone until its
  // watcher starts (prepareSlack).
  trustFolders(json) {
    const pi = agentKind(json) === 'pi';
    try {
      for (const f of [this.folder(json.slug), this.qaFolder(json.slug), this.opsFolder(json.slug)]) pi ? trustPiFolder(f, this.piTrust) : trustFolder(f, this.claudeConfig);
      if (!pi) trustFolder(this.slackFolder(json.slug), this.claudeConfig);
    }
    catch (err) { json.trust_error = String(err.message || err); console.warn(`could not trust ${this.folder(json.slug)}: ${json.trust_error}`); }
  }

  // Placeholders shared by the boss brief and the QA brief.
  fill(template, json) {
    const kind = agentKind(json);
    return template
      .replace(/\{\{agent_kind\}\}/g, kind)
      .replace(/\{\{agent_label\}\}/g, AGENT_LABELS[kind])
      .replace(/\{\{context_file\}\}/g, contextFile(kind))
      .replace(/\{\{name\}\}/g, json.name)
      .replace(/\{\{slug\}\}/g, json.slug)
      .replace(/\{\{root\}\}/g, json.root || '')
      .replace(/\{\{branch\}\}/g, json.branch || '')
      .replace(/\{\{base\}\}/g, json.base || '')
      .replace(/\{\{base_or_default\}\}/g, json.base ? `\`${json.base}\`` : "each repo's default branch, `origin/HEAD`")
      .replace(/\{\{folder\}\}/g, this.folder(json.slug))
      .replace(/\{\{qa_folder\}\}/g, this.qaFolder(json.slug))
      .replace(/\{\{qa_agent\}\}/g, qaAgent(json.slug))
      .replace(/\{\{ops_folder\}\}/g, this.opsFolder(json.slug))
      .replace(/\{\{ops_agent\}\}/g, opsAgent(json.slug))
      .replace(/\{\{alerts\}\}/g, this.alertsFolder(json.slug))
      .replace(/\{\{slack_folder\}\}/g, this.slackFolder(json.slug))
      .replace(/\{\{people_path\}\}/g, path.join(this.folder(json.slug), 'PEOPLE.md'))
      .replace(/\{\{inbox\}\}/g, path.join(this.folder(json.slug), 'inbox'))
      .replace(/\{\{board_path\}\}/g, path.join(this.folder(json.slug), 'BOARD.md'));
  }

  qaBrief(json) { return this.fill(this.qaTemplate, json); }
  skill(json) { return this.fill(this.skillTemplate, json); }
  opsBrief(json) { return this.fill(this.opsTemplate, json); }
  slackBrief(json) { return this.fill(this.slackTemplate, json); }

  // ---- Slack watcher ----

  // What the office shows about the watcher: the watch list, the watcher's
  // state.json, the waiting messages and the clock from orchestrator.json.
  readSlack(name, json) {
    const folder = path.join(this.dir, name, 'slack');
    let watches = [], state = {};
    try { watches = parseWatches(fs.readFileSync(path.join(folder, 'WATCHES.md'), 'utf8')); } catch { /* none yet */ }
    try { const s = JSON.parse(fs.readFileSync(path.join(folder, 'state.json'), 'utf8')); if (s && typeof s === 'object') state = s; } catch { /* first check not done, or half written */ }
    return { interval: DEFAULT_INTERVAL, ...(json.slack || {}), watches, state, waiting: readInbox(path.join(folder, 'waiting')) };
  }

  // text: a Slack link, #channel or @name from the office. Returns the watch.
  addWatch(slug, text) {
    const w = watchFromInput(text);
    if (!w) throw new Error('Paste a Slack link, #channel or @name.');
    const file = path.join(this.slackFolder(slug), 'WATCHES.md');
    let raw = WATCHES_HEAD;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { fs.mkdirSync(this.slackFolder(slug), { recursive: true }); }
    fs.writeFileSync(file, addWatchLine(raw, { ...w, note: '' }));
    this.onChange();
    return { ...w, note: '' };
  }

  removeWatch(slug, target) {
    const file = path.join(this.slackFolder(slug), 'WATCHES.md');
    const raw = fs.readFileSync(file, 'utf8');
    const next = removeWatchLine(raw, String(target || ''));
    if (next !== raw) { fs.writeFileSync(file, next); this.onChange(); }
  }

  // Takes a waiting message out of the office, like dismissAlert.
  dismissWaiting(slug, file) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.md$/.test(String(file))) throw new Error(`Invalid waiting file: ${JSON.stringify(file)}`);
    const full = path.join(this.waitingFolder(slug), file);
    fs.writeFileSync(full, setFrontmatter(fs.readFileSync(full, 'utf8'), 'dismissed', 'true'));
    this.onChange();
  }

  setSlackInterval(slug, minutes) {
    const n = Number(minutes);
    if (!Number.isInteger(n) || n < 2 || n > 240) throw new Error('Check every 2 to 240 minutes.');
    this.slackTick(slug, { interval: n });
    this.onChange();
  }

  // A branch the orchestrator's worker is on that is not its own (a
  // sub-ticket's): its checkouts count as the orchestrator's from now on.
  claimBranch(slug, branch) {
    if (!branch || typeof branch !== 'string') throw new Error('No branch');
    const json = this.read(slug);
    if (branch === json.branch || (json.branches || []).includes(branch)) return;
    json.branches = [...(json.branches || []), branch];
    this.write(slug, json);
    this.onChange();
  }

  // The user opened the Slack dialog: the ticket goes quiet until something new comes or a day passes.
  markSlackSeen(slug) { this.slackTick(slug, { seen_at: new Date().toISOString() }); this.onChange(); }

  // Merges fields into the `slack` object of orchestrator.json (the clock in slack.js uses it too).
  slackTick(slug, fields) {
    const json = this.read(slug);
    json.slack = { ...(json.slack || {}), ...fields };
    this.write(slug, json);
  }

  // The user's standing instructions from settings, as a brief section.
  // Empty when there are none, so the brief reads the same as before.
  userInstructionsSection(json) {
    const text = String(json.instructions || '').trim();
    if (!text) return '';
    return `
## Standing instructions from the user

These come from the office settings and apply to everything you do and to how
you talk to the user. Follow them ahead of the style of the rules below, but
keep the board, inbox and worker protocol intact so the office can follow
along.

${text}
`;
  }

  brief(json) {
    const repos = json.repos || [];
    const rows = repos.map((r) => `| ${r.name} | \`${workerName(json.slug, r.name)}\` | ${r.branch || '–'} | ${r.path} |`);
    const table = repos.length
      ? ['| repo | worker agent name | current branch | path |', '|---|---|---|---|', ...rows].join('\n')
      : '_No git repos were found directly under the root folder._';
    return this.fill(this.briefTemplate, json)
      .replace(/\{\{user_instructions\}\}/g, this.userInstructionsSection(json))
      .replace(/\{\{base_line\}\}/g, json.base ? `\nBase for new worktrees: \`${json.base}\` (pass \`--base ${json.base}\` to \`worktree create\`)` : '')
      .replace(/\{\{repos_table\}\}/g, table);
  }

  // The QA flag the boss reads when its tasks are done (see the brief). The
  // office setting applies to every running orchestrator, so a switch made
  // mid-task still counts.
  setQa(enabled) {
    for (const o of this.readAll()) {
      try {
        const json = this.read(o.slug);
        if (!!json.qa === !!enabled) continue;
        json.qa = !!enabled;
        this.write(o.slug, json);
      } catch { /* read-only fixture or a half-written folder */ }
    }
    this.onChange();
  }

  // A new name for the tab and the boss's brief. The slug, folder, branch and
  // agent names stay, so nothing running has to move.
  rename(slug, name) {
    const n = String(name || '').replace(/\s+/g, ' ').trim();
    if (!n) throw new Error('Give it a name.');
    if (n.length > 60) throw new Error('Keep the name under 60 characters.');
    const json = this.read(slug);
    if (json.name === n) return;
    json.name = n;
    this.write(slug, json);
    try { this.writeBrief(json); } catch { /* read-only fixture */ }
    this.onChange();
  }

  // Standing instructions from settings. New bosses get them in their brief;
  // running ones get their brief rewritten, which their next session reads.
  setInstructions(text) {
    const instructions = String(text || '').trim();
    for (const o of this.readAll()) {
      try {
        const json = this.read(o.slug);
        if ((json.instructions || '') === instructions) continue;
        json.instructions = instructions;
        this.write(o.slug, json);
        this.writeBrief(json);
      } catch { /* read-only fixture or a half-written folder */ }
    }
    this.onChange();
  }

  // Who sits where, per orchestrator: { slug: [{name, agent, role, repo}] }.
  // Only rewrites a PEOPLE.md whose content changed.
  setPeople(bySlug) {
    for (const [slug, people] of Object.entries(bySlug || {})) {
      try {
        const file = path.join(this.folder(slug), 'PEOPLE.md');
        const text = peopleMarkdown(Array.isArray(people) ? people : []);
        let old = null;
        try { old = fs.readFileSync(file, 'utf8'); } catch { /* first write */ }
        if (old !== text) fs.writeFileSync(file, text);
      } catch { /* bad slug or a folder that is gone */ }
    }
  }

  // ---- repos on disk ----

  // Git repos directly under a root folder: [{ name, path, branch }].
  scanRepos(root) {
    const dir = root.replace(/^~(?=$|\/)/, process.env.HOME || '');
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (err) { throw new Error(`Cannot read ${dir}: ${err.code || err.message}`); }
    const out = [];
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      const git = path.join(full, '.git');
      if (!fs.existsSync(git)) continue;
      let branch = '';
      try {
        const head = fs.readFileSync(fs.statSync(git).isDirectory() ? path.join(git, 'HEAD') : git, 'utf8').trim();
        const m = head.match(/refs\/heads\/(.+)$/); branch = m ? m[1] : (head.startsWith('gitdir:') ? '' : head.slice(0, 8));
      } catch { /* unreadable HEAD */ }
      out.push({ name: e.name, path: full, branch });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Branches that already have a worktree, per repo under root: { repoName: [branch] }.
  async worktreeBranches(root) {
    const out = {};
    await Promise.all(this.scanRepos(root).map(async (r) => {
      try {
        const txt = await git(r.path, ['worktree', 'list', '--porcelain']);
        const branches = [...txt.matchAll(/^branch refs\/heads\/(.+)$/gm)].map((m) => m[1]);
        // the first entry is the main checkout; only linked worktrees count
        out[r.name] = branches.slice(1);
      } catch { out[r.name] = []; }
    }));
    return out;
  }

  // What is in each worktree before it is removed: uncommitted files and
  // commits not on the upstream. worktrees: [{ workspace_id, path, repo }].
  async worktreeStatus(worktrees) {
    return Promise.all(worktrees.map(async (w) => {
      const st = { ...w, dirty: 0, unpushed: 0, upstream: true, error: null };
      try {
        st.dirty = (await git(w.path, ['status', '--porcelain'])).split('\n').filter(Boolean).length;
        try { st.unpushed = Number((await git(w.path, ['rev-list', '--count', '@{u}..HEAD'])).trim()) || 0; }
        catch { st.upstream = false; st.unpushed = Number((await git(w.path, ['rev-list', '--count', 'HEAD', '--not', '--remotes'])).trim()) || 0; }
      } catch (err) { st.error = err.message; }
      return st;
    }));
  }

  // ---- herdr ----

  async req(method, params, timeoutMs = 90_000) {
    if (!this.client) throw new Error('not available in fixture mode');
    return this.client.request(method, params, timeoutMs);
  }

  // agent.start with name collision handling: -2 … -9. args go to the agent.
  async startAgent(paneId, baseName, args = [], kind = 'claude') {
    let lastErr = null;
    for (let i = 1; i <= 9; i++) {
      const name = i === 1 ? baseName : `${baseName}-${i}`;
      try {
        const timeout = args.length ? 120_000 : 60_000;
        // The client waits longer than herdr does, so herdr's own timeout is the one that fires.
        await this.req('agent.start', { pane_id: paneId, name, kind, timeout_ms: timeout, ...(args.length ? { args } : {}) }, timeout + 30_000);
        return name;
      } catch (err) {
        lastErr = err;
        if (!/name/i.test(String(err.message))) throw err; // only retry on name collisions
      }
    }
    throw lastErr;
  }

  // Closes every workspace with a pane in folder, such as a boss workspace that
  // outlived its orchestrator. False when herdr cannot be asked or a close fails.
  async closeWorkspacesIn(folder) {
    let snapshot;
    try { snapshot = (await this.req('session.snapshot', {}, 10_000)).snapshot; } catch { return false; }
    const ids = new Set((snapshot?.panes || []).filter((p) => p.cwd === folder || p.foreground_cwd === folder).map((p) => p.workspace_id));
    let closed = true;
    for (const id of ids) await this.req('workspace.close', { workspace_id: id }).catch(() => { closed = false; });
    return closed;
  }

  // What herdr holds for this run is unknown: workspace.create got no answer, or
  // something failed after it. The folder stays as an unfinished run for
  // reconcile(), which adopts or closes the boss workspace once a snapshot shows
  // it; snapshots asked for before now are ignored.
  leaveToReconcile(slug, json) {
    json.run = null;
    json.boss.workspace_at = Date.now();
    try { this.write(slug, json); } catch { /* nothing more to do */ }
  }

  // Starts the boss in its pane, retrying while the new shell settles.
  // Sets json.boss.status to 'started', or records boss.error.
  async startBoss(json, args = []) {
    let bossErr = null;
    for (let attempt = 1; attempt <= 3 && json.boss.status !== 'started'; attempt++) {
      try {
        await sleep(attempt === 1 ? 600 : 2000);
        json.boss.agent = await this.startAgent(json.boss.pane_id, json.boss.agent, args, agentKind(json));
        json.boss.status = 'started';
      } catch (err) { bossErr = err; }
    }
    if (json.boss.status !== 'started') json.boss.error = String(bossErr?.message || bossErr || 'unknown');
  }

  // spec: { name, root, branch, base, qa, instructions, agent }
  // Creates the boss workspace and starts the boss, which then waits for the
  // user's first prompt at its desk (the terminal takes images, a text box
  // cannot). Workers are the boss's business: it opens worktrees on `branch`
  // in the repos the task needs. progress(line) reports steps to the wizard.
  // Resolves to the final json.
  async create(spec, progress = () => {}) {
    const slug = slugify(spec.name);
    if (!slug) throw new Error('Name must contain a letter or digit.');
    if (fs.existsSync(this.folder(slug))) throw new Error(`An orchestrator called "${slug}" already exists.`);
    const root = String(spec.root || '').trim().replace(/\/+$/, '');
    if (!root) throw new Error('Pick the root folder that holds your repos.');
    const branch = String(spec.branch || '').trim();
    if (!branch) throw new Error('Give the worktree branch a name.');
    if (/[\s~^:?*\[\\]|\.\.|^\/|\/$|@\{/.test(branch)) throw new Error('That is not a valid git branch name.');
    const repos = this.scanRepos(root); // throws if the folder cannot be read
    const rootAbs = root.replace(/^~(?=$|\/)/, process.env.HOME || '');
    const used = this.usedColors();
    const color = COLORS.find((c) => !used.has(c)) || COLORS[this.readAll().length % COLORS.length];
    const json = {
      version: 2, name: spec.name.trim(), slug, color, status: 'creating', run: this.run, created_at: new Date().toISOString(),
      root: rootAbs, branch, base: spec.base?.trim() || null, repos, qa: !!spec.qa,
      instructions: String(spec.instructions || '').trim(), agent: agentKind(spec),
      boss: { workspace_id: null, pane_id: null, agent: `${slug}-boss`, status: 'not_started' },
    };

    progress('Writing brief, skill and board…');
    fs.mkdirSync(path.join(this.folder(slug), 'inbox', 'done'), { recursive: true });
    const skill = path.join(this.folder(slug), ...skillsDir(json.agent), 'orchestrate');
    fs.mkdirSync(skill, { recursive: true });
    if (this.skillTemplate) fs.writeFileSync(path.join(skill, 'SKILL.md'), this.skill(json));
    this.write(slug, json);
    fs.writeFileSync(path.join(this.folder(slug), 'BOARD.md'), `# ${json.name}\nUpdated: not yet\n\n## Tasks\n\n## Blockers\n`);
    this.writeBrief(json);
    fs.writeFileSync(path.join(this.folder(slug), 'PEOPLE.md'), peopleMarkdown([]));
    this.writeHelperBriefs(json);

    // An archived orchestrator with the same name used this folder; its boss workspace may still be open.
    if (!(await this.closeWorkspacesIn(this.folder(slug)))) {
      await fsp.rm(this.folder(slug), { recursive: true, force: true });
      throw new Error('herdr could not confirm that no earlier boss workspace with this name is still open. Check herdr and try again.');
    }
    progress('Creating the boss workspace…');
    // Saved before asking: if the app dies mid-request, the next run still waits for a late workspace.
    json.boss.workspace_at = Date.now();
    this.write(slug, json);
    let ws;
    try {
      ws = await this.req('workspace.create', { cwd: this.folder(slug), label: `boss: ${json.name}`, focus: false });
    } catch (err) {
      if (err.answered) await fsp.rm(this.folder(slug), { recursive: true, force: true });
      else this.leaveToReconcile(slug, json);
      throw new Error(`workspace.create failed: ${err.message}`);
    }
    json.boss.workspace_id = ws.workspace?.workspace_id || ws.workspace_id || null;
    json.boss.pane_id = ws.root_pane?.pane_id || ws.pane?.pane_id || null;
    json.boss.workspace_at = Date.now();
    try {
      this.write(slug, json);
      this.watch(slug);

      progress('Starting the boss…');
      this.trustFolders(json);
      await this.startBoss(json);
      json.status = 'running';
      this.write(slug, json);
    } catch (err) {
      this.leaveToReconcile(slug, json);
      throw err;
    }
    this.onChange();
    return json;
  }

  // text: the prompt; question: when set, the board question this answers;
  // next: when set, the board suggestion (## Next) the user sent.
  async promptBoss(slug, text, question = null, next = null) {
    const json = this.read(slug);
    if (json.boss.status !== 'started') throw new Error('The boss is not running.');
    // By pane: herdr clears the name when the boss's process in the pane is replaced.
    const r = await this.req('agent.prompt', { target: json.boss.pane_id || json.boss.agent, text });
    if (question) json.answered = [...(json.answered || []).filter((a) => a.text !== question), { text: question, at: new Date().toISOString() }];
    if (next) json.next_sent = [...(json.next_sent || []).filter((t) => t !== next), next];
    if (question || next) { this.write(slug, json); this.onChange(); }
    return r;
  }

  // A board suggestion the user does not want. The boss reads `declined` in
  // orchestrator.json before it suggests again (see the brief).
  declineNext(slug, text) {
    const json = this.read(slug);
    const t = String(text || '').trim(); if (!t) return;
    json.declined = [...(json.declined || []).filter((x) => x !== t), t].slice(-20);
    this.write(slug, json);
    this.onChange();
  }

  // Takes an alert out of the office: `dismissed: true` in the alert file, so a
  // restart does not bring it back. The ops agent and the board are unaffected.
  dismissAlert(slug, file) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.md$/.test(String(file))) throw new Error(`Invalid alert file: ${JSON.stringify(file)}`);
    const full = path.join(this.alertsFolder(slug), file);
    fs.writeFileSync(full, setFrontmatter(fs.readFileSync(full, 'utf8'), 'dismissed', 'true'));
    this.onChange();
  }

  // Closing removes the orchestrator's worktrees. mode 'push': commit every
  // dirty worktree with `message` and push its branch first, aborting before
  // any removal if a commit or push fails; mode 'discard': remove with force.
  // worktrees: [{ workspace_id, path, repo }] recognised by the renderer;
  // workerPanes: the agents in them (closed first so nothing writes mid-remove).
  async close(slug, { mode = 'discard', message = '', worktrees = [], workerPanes = [] }, snapshot, progress = () => {}) {
    const json = this.read(slug);
    // Closing mid-start would move the folder while create() or restore() is still writing to
    // it, or while reconcile() is still waiting to see whether herdr made its boss workspace.
    if (json.status === 'creating' || json.status === 'restoring') throw new Error(`${json.name} is still starting. Wait until it is running or archived, then close it.`);
    const livePanes = new Set((snapshot?.panes || []).map((p) => p.pane_id));
    const liveWs = new Set((snapshot?.workspaces || []).map((w) => w.workspace_id));
    if (mode === 'push') {
      const msg = message.trim() || `${json.name}: orchestrator work`;
      for (const w of worktrees) {
        progress(`${w.repo}: committing…`);
        const dirty = (await git(w.path, ['status', '--porcelain'])).trim();
        if (dirty) { await git(w.path, ['add', '-A']); await git(w.path, ['commit', '-q', '-m', msg]); }
        progress(`${w.repo}: pushing…`);
        const branch = (await git(w.path, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
        await git(w.path, ['push', '-u', 'origin', branch]);
      }
    }
    for (const paneId of workerPanes) {
      if (!snapshot || livePanes.has(paneId)) await this.req('pane.close', { pane_id: paneId }).catch(() => {});
    }
    for (const w of worktrees) {
      progress(`${w.repo}: removing worktree…`);
      if (!snapshot || liveWs.has(w.workspace_id)) await this.req('worktree.remove', { workspace_id: w.workspace_id, force: true });
    }
    if (json.boss.workspace_id && (!snapshot || liveWs.has(json.boss.workspace_id))) {
      await this.req('workspace.close', { workspace_id: json.boss.workspace_id }).catch(() => {});
    }
    // The refresh may not have saved the boss's session yet, and Restore needs it to reopen this conversation.
    const session = (snapshot?.agents || []).find((a) => a.pane_id === json.boss.pane_id)?.agent_session?.value;
    if (session && session !== json.boss.session_id) { json.boss.session_id = session; this.write(slug, json); }
    await this.archive(slug, 'closed');
  }

  // Slice 1: a running orchestrator whose boss workspace is gone is archived.
  // A create or restore that an earlier app run left unfinished is running if
  // its boss came up; otherwise its workspace is closed and it is archived as
  // interrupted, so Restore can start it cleanly.
  // Returns [{ name, reason }] archived so the app can show a notice. askedAt: when the
  // snapshot was requested; refreshes overlap, so one asked for before a boss
  // workspace was created can arrive after its create or restore has finished.
  async reconcile(snapshot, askedAt = Infinity) {
    if (!snapshot?.workspaces) return [];
    await this.archiveStrays();
    const live = new Set(snapshot.workspaces.map((w) => w.workspace_id));
    const gone = [];
    for (const o of this.readAll()) {
      if (askedAt <= (o.boss.workspace_at || 0)) continue;
      if ((o.status === 'creating' || o.status === 'restoring') && o.run !== this.run) {
        // herdr may have made the workspace after the app saved its last ids; then only the folder identifies it.
        const folder = this.folder(o.slug);
        const pane = o.boss.pane_id
          ? { pane_id: o.boss.pane_id, workspace_id: o.boss.workspace_id }
          : (snapshot.panes || []).find((p) => p.cwd === folder || p.foreground_cwd === folder);
        const agent = pane && (snapshot.agents || []).find((a) => a.pane_id === pane.pane_id);
        if (agent) {
          const json = this.read(o.slug);
          json.status = 'running';
          json.boss = { ...json.boss, workspace_id: pane.workspace_id, pane_id: pane.pane_id, agent: agent.name || json.boss.agent, status: 'started', session_id: agent.agent_session?.value || json.boss.session_id || null };
          delete json.boss.error;
          this.write(o.slug, json);
          continue;
        }
        // A workspace.create whose answer was lost can still show up; give it time before archiving.
        if (!pane && Date.now() - (o.boss.workspace_at || 0) < LATE_CREATE_MS) continue;
        // A close that fails leaves the run unfinished for the next refresh; once the workspace is really gone, the snapshot stops listing it.
        if (pane && live.has(pane.workspace_id) && !(await this.req('workspace.close', { workspace_id: pane.workspace_id }).then(() => true, () => false))) continue;
        gone.push({ name: o.name, reason: 'interrupted' });
        await this.archive(o.slug, 'interrupted');
        continue;
      }
      if (o.status === 'running' && o.boss.workspace_id && !live.has(o.boss.workspace_id)) {
        gone.push({ name: o.name, reason: 'boss workspace gone' });
        await this.archive(o.slug, 'boss workspace gone');
        continue;
      }
      // The boss's session (a Claude id, a pi session file), kept so Restore can reopen exactly this conversation.
      const session = (snapshot.agents || []).find((a) => a.pane_id === o.boss.pane_id)?.agent_session?.value;
      if (o.status === 'running' && session && session !== o.boss.session_id) {
        const json = this.read(o.slug); json.boss.session_id = session; this.write(o.slug, json);
      }
    }
    return gone;
  }
}

module.exports = { OrchestratorStore, parseBoard, peopleMarkdown, readInbox, setFrontmatter, slugify, workerName, qaAgent, opsAgent, trustFolder, claudeConfigPath, hasConversation, trustPiFolder, hasPiConversation, piSessionDir, agentKind, contextFile, AGENT_KINDS, COLORS };
