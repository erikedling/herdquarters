// Slugs reach the store from the renderer over IPC and are joined into paths
// under <userData>/orchestrators. Only what slugify() can produce may pass.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OrchestratorStore, slugify } = require('../orchestrators');

function store() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-'));
  return new OrchestratorStore({ dir, client: null, onChange: () => {}, briefTemplate: '' });
}

test('folder() accepts what slugify() produces', () => {
  const s = store();
  for (const name of ['Search relevance', 'Release 2026', '123 go', 'o']) {
    const slug = slugify(name);
    assert.strictEqual(s.folder(slug), path.join(s.dir, slug));
  }
});

test('folder() rejects anything that could leave the orchestrators dir', () => {
  const s = store();
  for (const bad of ['../x', '..', '/etc', 'a/b', 'a\\b', '', 'A', '-a', 'a b', 'a\0b']) {
    assert.throws(() => s.folder(bad), /slug/i, JSON.stringify(bad));
  }
});

// ---- the boss folder and Claude's trust dialog ----
// Every orchestrator folder is new to Claude Code, which then opens its
// "trust this folder?" dialog; herdr reports the boss as blocked and refuses
// the first task. The store pre-accepts trust the way Claude documents it.
const { trustFolder, qaAgent } = require('../orchestrators');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'orch-')); }

test('trustFolder() marks the folder trusted in a fresh config', () => {
  const cfg = path.join(tmp(), '.claude.json');
  trustFolder('/x/boss', cfg);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(cfg, 'utf8')), { projects: { '/x/boss': { hasTrustDialogAccepted: true } } });
});

test('trustFolder() keeps everything else in the config', () => {
  const cfg = path.join(tmp(), '.claude.json');
  fs.writeFileSync(cfg, JSON.stringify({ theme: 'dark', projects: { '/other': { hasTrustDialogAccepted: true, allowedTools: ['x'] }, '/x/boss': { allowedTools: ['y'] } } }));
  trustFolder('/x/boss', cfg);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(cfg, 'utf8')), {
    theme: 'dark',
    projects: { '/other': { hasTrustDialogAccepted: true, allowedTools: ['x'] }, '/x/boss': { allowedTools: ['y'], hasTrustDialogAccepted: true } },
  });
});

test('trustFolder() refuses to clobber a config it cannot parse', () => {
  const cfg = path.join(tmp(), '.claude.json');
  fs.writeFileSync(cfg, '{not json');
  assert.throws(() => trustFolder('/x/boss', cfg));
  assert.strictEqual(fs.readFileSync(cfg, 'utf8'), '{not json');
});

// A herdr client that records calls and answers like the real one.
function fakeClient(overrides = {}) {
  const calls = [];
  const answers = {
    'workspace.create': () => ({ workspace: { workspace_id: 'w1' }, root_pane: { pane_id: 'w1:p1' } }),
    'agent.start': () => ({}),
    'session.snapshot': () => ({ snapshot: { panes: [] } }),
    ...overrides,
  };
  return { calls, request: async (method, params, timeoutMs) => { calls.push({ method, params, timeoutMs }); const a = answers[method]; if (!a) throw new Error(`unexpected ${method}`); return a(params); } };
}

// A failed assertion skips a test's dispose(), and its fs watchers would keep the run alive.
const opened = [];
test.after(() => { for (const s of opened) s.dispose(); });

function storeWith(client) {
  const dir = tmp();
  const claudeConfig = path.join(dir, '.claude.json');
  const claudeProjects = tmp();
  const briefTemplate = fs.readFileSync(path.join(__dirname, '..', 'orchestrator-brief.md'), 'utf8');
  const qaTemplate = fs.readFileSync(path.join(__dirname, '..', 'qa-brief.md'), 'utf8');
  const opsTemplate = fs.readFileSync(path.join(__dirname, '..', 'ops-brief.md'), 'utf8');
  const skillTemplate = fs.readFileSync(path.join(__dirname, '..', 'orchestrator-skill.md'), 'utf8');
  const slackTemplate = fs.readFileSync(path.join(__dirname, '..', 'slack-brief.md'), 'utf8');
  const piTrust = path.join(dir, 'pi-trust.json');
  const piSessions = tmp();
  const s = new OrchestratorStore({ dir, client, onChange: () => {}, briefTemplate, skillTemplate, qaTemplate, opsTemplate, slackTemplate, claudeConfig, claudeProjects, piTrust, piSessions });
  opened.push(s);
  return { s, claudeConfig, claudeProjects, piTrust, piSessions };
}

test('create() trusts the boss folder, starts the boss and leaves it waiting for the user', async () => {
  const client = fakeClient();
  const { s, claudeConfig } = storeWith(client);
  const json = await s.create({ name: 'Trusty', root: tmp(), branch: 'x/trusty' });
  s.dispose();
  const cfg = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
  assert.strictEqual(cfg.projects[s.folder('trusty')].hasTrustDialogAccepted, true);
  assert.deepStrictEqual(client.calls.map((c) => c.method), ['session.snapshot', 'workspace.create', 'agent.start']);
  assert.strictEqual(json.boss.status, 'started');
  assert.strictEqual(json.boss.pane_id, 'w1:p1'); // the tab opens this desk's terminal
  assert.ok(!('first_task' in json));
  // the brief tells the boss the task comes as its first prompt
  assert.match(fs.readFileSync(path.join(s.folder('trusty'), 'CLAUDE.md'), 'utf8'), /first prompt/);
});

// ---- QA review ----
// The reviewer sits in the boss's room, in a subfolder of the boss's folder
// with its own brief. The boss reads the `qa` flag when its tasks are done;
// the office setting writes that flag into every running orchestrator.

test('create() writes the QA reviewer brief and records the qa flag', async () => {
  const { s, claudeConfig } = storeWith(fakeClient());
  const json = await s.create({ name: 'Reviewed', root: tmp(), branch: 'x/r', base: 'main', qa: true });
  s.dispose();
  assert.strictEqual(json.qa, true);
  const qaBrief = fs.readFileSync(path.join(s.qaFolder('reviewed'), 'CLAUDE.md'), 'utf8');
  assert.match(qaBrief, /QA reviewer of the "Reviewed" orchestrator/);
  assert.match(qaBrief, new RegExp(`from: ${qaAgent('reviewed')}`));
  assert.match(qaBrief, /never edit code/);
  assert.ok(!/\{\{/.test(qaBrief), 'no placeholder left in the QA brief');
  const bossBrief = fs.readFileSync(path.join(s.folder('reviewed'), 'CLAUDE.md'), 'utf8');
  assert.match(bossBrief, /## QA review/);
  assert.match(bossBrief, new RegExp(`agent start ${qaAgent('reviewed')}`));
  assert.match(bossBrief, /`main`/); // the base to diff against
  assert.ok(!/\{\{/.test(bossBrief), 'no placeholder left in the boss brief');
  // both folders are trusted, so neither agent stops at Claude's dialog
  const cfg = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
  assert.strictEqual(cfg.projects[s.qaFolder('reviewed')].hasTrustDialogAccepted, true);
});

test('setQa() flips the flag on every running orchestrator', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'One', root: tmp(), branch: 'x/1', qa: false });
  await s.create({ name: 'Two', root: tmp(), branch: 'x/2', qa: false });
  s.setQa(true);
  assert.deepStrictEqual(s.list().map((o) => [o.slug, o.qa]), [['one', true], ['two', true]]);
  s.setQa(false);
  assert.deepStrictEqual(s.list().map((o) => o.qa), [false, false]);
  s.dispose();
});

// Standing instructions from settings land in the boss brief as their own
// section; changing them later rewrites every running boss's CLAUDE.md.
test('create() puts the user\'s instructions in the boss brief, or nothing when empty', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'Terse', root: tmp(), branch: 'x/t', instructions: '  Keep replies short.  ' });
  await s.create({ name: 'Plain', root: tmp(), branch: 'x/p' });
  s.dispose();
  const brief = fs.readFileSync(path.join(s.folder('terse'), 'CLAUDE.md'), 'utf8');
  assert.match(brief, /## Standing instructions from the user\n[^]*Keep replies short\./);
  assert.strictEqual(s.read('terse').instructions, 'Keep replies short.');
  const plain = fs.readFileSync(path.join(s.folder('plain'), 'CLAUDE.md'), 'utf8');
  assert.ok(!/Standing instructions/.test(plain));
  assert.ok(!/\{\{/.test(plain), 'no placeholder left in the brief');
});

test('setInstructions() rewrites the brief of every running orchestrator', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'One', root: tmp(), branch: 'x/1' });
  await s.create({ name: 'Two', root: tmp(), branch: 'x/2' });
  s.dispose();
  s.setInstructions('Say what is going on.');
  for (const slug of ['one', 'two']) {
    assert.strictEqual(s.read(slug).instructions, 'Say what is going on.');
    assert.match(fs.readFileSync(path.join(s.folder(slug), 'CLAUDE.md'), 'utf8'), /Say what is going on\./);
  }
  s.setInstructions('');
  assert.ok(!/Standing instructions/.test(fs.readFileSync(path.join(s.folder('one'), 'CLAUDE.md'), 'utf8')));
});

test('qaAgent() names fit herdr\'s 32-character limit for any slug', () => {
  assert.strictEqual(qaAgent('abc'), 'abc-qa');
  assert.ok(qaAgent('a'.repeat(24)).length <= 32);
});

// ---- restore ----
// A herdr restart takes the boss workspace with it, and reconcile() archives the
// orchestrator. Restore moves the folder back, gives the boss a new workspace
// and reopens its last conversation there.

// Claude Code keeps a folder's transcripts under projects/<path with every non-alphanumeric as ->.
function saveConversation(claudeProjects, folder) {
  const dir = path.join(claudeProjects, folder.replace(/[^a-zA-Z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'abc.jsonl'), '{}\n');
}

async function archivedOne(client) {
  const ctx = storeWith(client);
  await ctx.s.create({ name: 'Back Office', root: tmp(), branch: 'x/back-office' });
  fs.writeFileSync(path.join(ctx.s.folder('back-office'), 'BOARD.md'), '# Back office\n\n## Tasks\n- [x] one\n- [ ] two\n');
  await ctx.s.archive('back-office', 'boss workspace gone');
  client.calls.length = 0;
  return ctx;
}

test('listArchived() shows why and when each one ended, with its task count', async () => {
  const { s } = await archivedOne(fakeClient());
  const [a] = s.listArchived();
  s.dispose();
  assert.match(a.id, /^back-office-\d{4}-/);
  assert.deepStrictEqual({ name: a.name, slug: a.slug, branch: a.branch, ended_reason: a.ended_reason, done: a.done, total: a.total, open: a.open },
    { name: 'Back Office', slug: 'back-office', branch: 'x/back-office', ended_reason: 'boss workspace gone', done: 1, total: 2, open: false });
});

test('restore() brings the folder back and continues the boss conversation in a new workspace', async () => {
  const client = fakeClient({ 'workspace.create': () => ({ workspace: { workspace_id: 'w9' }, root_pane: { pane_id: 'w9:p1' } }) });
  const { s, claudeProjects } = await archivedOne(client);
  saveConversation(claudeProjects, s.folder('back-office'));
  const json = await s.restore(s.listArchived()[0].id);
  s.dispose();
  const call = (method) => client.calls.find((c) => c.method === method);
  assert.deepStrictEqual(client.calls.map((c) => c.method), ['session.snapshot', 'workspace.create', 'agent.start']);
  assert.strictEqual(call('workspace.create').params.cwd, s.folder('back-office'));
  assert.deepStrictEqual(call('agent.start').params.args, ['--continue']);
  assert.strictEqual(json.status, 'running');
  assert.ok(!('ended_at' in json));
  assert.deepStrictEqual({ ws: json.boss.workspace_id, pane: json.boss.pane_id, status: json.boss.status, resumed: json.boss.resumed },
    { ws: 'w9', pane: 'w9:p1', status: 'started', resumed: true });
  assert.deepStrictEqual(s.listArchived(), []);
  assert.strictEqual(s.list()[0].board.tasks.length, 2);
});

test('restore() starts a fresh boss when there is no conversation to continue', async () => {
  const client = fakeClient();
  const { s } = await archivedOne(client);
  const json = await s.restore(s.listArchived()[0].id);
  s.dispose();
  assert.ok(!('args' in client.calls.find((c) => c.method === 'agent.start').params));
  assert.strictEqual(json.boss.resumed, false);
});

test('restore() refuses while an orchestrator with the same name is open', async () => {
  const client = fakeClient();
  const { s } = await archivedOne(client);
  const { id } = s.listArchived()[0];
  await s.create({ name: 'Back Office', root: tmp(), branch: 'x/other' });
  assert.strictEqual(s.listArchived()[0].open, true);
  await assert.rejects(s.restore(id), /already open/);
  s.dispose();
  assert.strictEqual(s.listArchived().length, 1);
});

test('restore() leaves the folder in the archive when the workspace cannot be created', async () => {
  // herdr answered with an error, so it made nothing and the restore can roll back at once.
  const client = fakeClient({ 'workspace.create': () => { throw Object.assign(new Error('herdr is down'), { answered: true }); } });
  const { s } = await archivedOne(fakeClient());
  s.client = client;
  const { id } = s.listArchived()[0];
  await assert.rejects(s.restore(id), /herdr is down/);
  s.dispose();
  assert.deepStrictEqual(s.listArchived().map((a) => ({ id: a.id, reason: a.ended_reason })), [{ id, reason: 'boss workspace gone' }]);
  assert.strictEqual(fs.existsSync(s.folder('back-office')), false);
});

test('archivedFolder() rejects anything that could leave the archive', () => {
  const s = store();
  for (const bad of ['../x', '..', '/etc', 'a/b', '', 'A-1']) assert.throws(() => s.archivedFolder(bad), /archived/i, JSON.stringify(bad));
  assert.strictEqual(s.archivedFolder('a-2026-10-12T07-20-53-437Z'), path.join(s.dir, 'archive', 'a-2026-10-12T07-20-53-437Z'));
});

test('reconcile() ignores a snapshot asked for before the boss workspace existed', async () => {
  const client = fakeClient();
  const { s } = await archivedOne(client);
  const askedAt = Date.now() - 1;
  await s.restore(s.listArchived()[0].id);
  // The snapshot predates workspace.create, so it does not list w1.
  assert.deepStrictEqual(await s.reconcile({ workspaces: [] }, askedAt), []);
  assert.strictEqual(s.list().length, 1);
  // A snapshot asked for afterwards that still lacks w1 means the workspace is really gone.
  assert.deepStrictEqual(await s.reconcile({ workspaces: [] }, Date.now()), [{ name: 'Back Office', reason: 'boss workspace gone' }]);
  s.dispose();
});

test('agent.start gets a longer client timeout than the one herdr waits for', async () => {
  const client = fakeClient();
  const { s, claudeProjects } = await archivedOne(client);
  saveConversation(claudeProjects, s.folder('back-office'));
  await s.restore(s.listArchived()[0].id);
  s.dispose();
  const start = client.calls.find((c) => c.method === 'agent.start');
  assert.ok(start.timeoutMs > start.params.timeout_ms, `${start.timeoutMs} <= ${start.params.timeout_ms}`);
});

// The app quit or crashed during a create or restore: the folder is left with
// the in-progress status and the earlier run's id.
function leaveUnfinished(s, slug, status, boss = {}) {
  const json = s.read(slug);
  Object.assign(json, { status, run: 'an-earlier-run' });
  Object.assign(json.boss, boss);
  s.write(slug, json);
}

test('reconcile() keeps an unfinished restore whose boss came up, and marks the boss started', async () => {
  const { s } = await archivedOne(fakeClient());
  await s.restore(s.listArchived()[0].id);
  leaveUnfinished(s, 'back-office', 'restoring', { status: 'not_started' });
  const snapshot = { workspaces: [{ workspace_id: 'w1' }], agents: [{ pane_id: 'w1:p1', name: 'back-office-boss-2' }] };
  assert.deepStrictEqual(await s.reconcile(snapshot), []);
  s.dispose();
  const json = s.read('back-office');
  assert.deepStrictEqual({ status: json.status, boss: json.boss.status, agent: json.boss.agent }, { status: 'running', boss: 'started', agent: 'back-office-boss-2' });
});

test('reconcile() closes the workspace of an unfinished restore with no boss and archives it for Restore', async () => {
  const client = fakeClient({ 'workspace.close': () => ({}) });
  const { s } = await archivedOne(client);
  await s.restore(s.listArchived()[0].id);
  leaveUnfinished(s, 'back-office', 'restoring', { status: 'not_started' });
  client.calls.length = 0;
  assert.deepStrictEqual(await s.reconcile({ workspaces: [{ workspace_id: 'w1' }], agents: [] }), [{ name: 'Back Office', reason: 'interrupted' }]);
  s.dispose();
  assert.deepStrictEqual(client.calls, [{ method: 'workspace.close', params: { workspace_id: 'w1' }, timeoutMs: 90_000 }]);
  assert.deepStrictEqual(s.listArchived().map((a) => ({ reason: a.ended_reason, open: a.open })), [{ reason: 'interrupted', open: false }]);
});

test('reconcile() archives a create an earlier run left before it had a workspace', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'Half Made', root: tmp(), branch: 'x/half' });
  leaveUnfinished(s, 'half-made', 'creating', { workspace_id: null, pane_id: null, workspace_at: undefined });
  assert.deepStrictEqual(await s.reconcile({ workspaces: [] }), [{ name: 'Half Made', reason: 'interrupted' }]);
  s.dispose();
  assert.strictEqual(s.listArchived()[0].ended_reason, 'interrupted');
});

test('reconcile() leaves a restore still running in this app run alone', async () => {
  const { s } = await archivedOne(fakeClient());
  await s.restore(s.listArchived()[0].id);
  const json = s.read('back-office'); json.status = 'restoring'; s.write('back-office', json);
  assert.deepStrictEqual(await s.reconcile({ workspaces: [] }), []);
  s.dispose();
  assert.strictEqual(s.read('back-office').status, 'restoring');
});

test('a restore the app died in before herdr answered is archived again by the next run', async () => {
  // workspace.create never answers: the app quits while waiting for it.
  const client = fakeClient({ 'workspace.create': () => new Promise(() => {}) });
  const { s, claudeConfig, claudeProjects } = await archivedOne(fakeClient());
  s.client = client;
  s.restore(s.listArchived()[0].id);
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(s.read('back-office').status, 'restoring');
  s.dispose();
  const next = new OrchestratorStore({ dir: s.dir, client: fakeClient(), onChange: () => {}, briefTemplate: '', claudeConfig, claudeProjects });
  opened.push(next);
  // The create may still go through after the app died, so the next run waits before archiving.
  assert.deepStrictEqual(await next.reconcile({ workspaces: [], agents: [] }), []);
  const json = next.read('back-office'); json.boss.workspace_at = Date.now() - 61_000; next.write('back-office', json);
  assert.deepStrictEqual(await next.reconcile({ workspaces: [], agents: [] }), [{ name: 'Back Office', reason: 'interrupted' }]);
  next.dispose();
  assert.deepStrictEqual(next.listArchived().map((a) => ({ name: a.name, open: a.open })), [{ name: 'Back Office', open: false }]);
});

// herdr made the boss workspace, but the app died before saving its ids: only its folder identifies it.
test('reconcile() finds an unsaved boss workspace by its folder, and closes it when no boss came up', async () => {
  const client = fakeClient({ 'workspace.close': () => ({}) });
  const { s } = await archivedOne(client);
  await s.restore(s.listArchived()[0].id);
  leaveUnfinished(s, 'back-office', 'restoring', { workspace_id: null, pane_id: null, workspace_at: undefined, status: 'not_started' });
  client.calls.length = 0;
  const snapshot = { workspaces: [{ workspace_id: 'w7' }], panes: [{ pane_id: 'w7:p1', workspace_id: 'w7', cwd: s.folder('back-office') }], agents: [] };
  assert.deepStrictEqual(await s.reconcile(snapshot), [{ name: 'Back Office', reason: 'interrupted' }]);
  s.dispose();
  assert.deepStrictEqual(client.calls.map((c) => [c.method, c.params.workspace_id]), [['workspace.close', 'w7']]);
});

test('reconcile() adopts an unsaved boss workspace by its folder when the boss came up', async () => {
  const { s } = await archivedOne(fakeClient());
  await s.restore(s.listArchived()[0].id);
  leaveUnfinished(s, 'back-office', 'restoring', { workspace_id: null, pane_id: null, workspace_at: undefined, status: 'not_started' });
  const snapshot = {
    workspaces: [{ workspace_id: 'w7' }],
    panes: [{ pane_id: 'w7:p1', workspace_id: 'w7', cwd: '/somewhere/else', foreground_cwd: s.folder('back-office') }],
    agents: [{ pane_id: 'w7:p1', name: 'back-office-boss' }],
  };
  assert.deepStrictEqual(await s.reconcile(snapshot), []);
  s.dispose();
  const { status, boss } = s.read('back-office');
  assert.deepStrictEqual({ status, ws: boss.workspace_id, pane: boss.pane_id, boss: boss.status }, { status: 'running', ws: 'w7', pane: 'w7:p1', boss: 'started' });
});

// ---- which conversation, and failed workspace.create ----

test('restore() reopens the archived boss session by id, not the newest one in the folder', async () => {
  const client = fakeClient();
  const { s, claudeProjects } = await archivedOne(client);
  const setSession = (id, session) => {
    const file = path.join(s.archivedFolder(id), 'orchestrator.json');
    const json = JSON.parse(fs.readFileSync(file, 'utf8')); json.boss.session_id = session; fs.writeFileSync(file, JSON.stringify(json));
  };
  const first = s.listArchived()[0].id;
  setSession(first, 'aaa-first');
  // A later orchestrator with the same name, archived too: same boss folder, newer conversation.
  await s.create({ name: 'Back Office', root: tmp(), branch: 'x/second' });
  await new Promise((r) => setTimeout(r, 5));
  await s.archive('back-office', 'closed');
  setSession(s.listArchived()[0].id, 'bbb-second');
  saveConversation(claudeProjects, s.folder('back-office'));
  for (const id of ['aaa-first', 'bbb-second']) fs.writeFileSync(path.join(claudeProjects, s.folder('back-office').replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`), '{}\n');
  client.calls.length = 0;
  const json = await s.restore(first);
  s.dispose();
  assert.deepStrictEqual(client.calls.find((c) => c.method === 'agent.start').params.args, ['--resume', 'aaa-first']);
  assert.strictEqual(json.boss.resumed, true);
});

test('restore() starts fresh when the recorded session has no transcript, rather than guess', async () => {
  const client = fakeClient();
  const { s, claudeProjects } = await archivedOne(client);
  const { id } = s.listArchived()[0];
  const file = path.join(s.archivedFolder(id), 'orchestrator.json');
  const archived = JSON.parse(fs.readFileSync(file, 'utf8')); archived.boss.session_id = 'gone-session'; fs.writeFileSync(file, JSON.stringify(archived));
  saveConversation(claudeProjects, s.folder('back-office'));
  const json = await s.restore(id);
  s.dispose();
  assert.ok(!('args' in client.calls.find((c) => c.method === 'agent.start').params));
  assert.strictEqual(json.boss.resumed, false);
});

test('reconcile() records the boss session id from the snapshot', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'Sessions', root: tmp(), branch: 'x/sessions' });
  const snapshot = { workspaces: [{ workspace_id: 'w1' }], agents: [{ pane_id: 'w1:p1', name: 'sessions-boss', agent_session: { value: 'abc-123' } }] };
  await s.reconcile(snapshot, Date.now() + 1);
  s.dispose();
  assert.strictEqual(s.read('sessions').boss.session_id, 'abc-123');
});

test('reconcile() ignores a snapshot asked for in the same millisecond the workspace appeared', async () => {
  const { s } = await archivedOne(fakeClient());
  const json = await s.restore(s.listArchived()[0].id);
  assert.deepStrictEqual(await s.reconcile({ workspaces: [] }, json.boss.workspace_at), []);
  s.dispose();
});




// ---- a workspace.close that fails ----


test('reconcile() keeps retrying an unfinished run whose workspace will not close, and archives it once it is gone', async () => {
  const { s } = await archivedOne(fakeClient());
  await s.restore(s.listArchived()[0].id);
  leaveUnfinished(s, 'back-office', 'restoring', { status: 'not_started' });
  s.client = fakeClient({ 'workspace.close': () => { throw new Error('busy'); } });
  assert.deepStrictEqual(await s.reconcile({ workspaces: [{ workspace_id: 'w1' }], agents: [] }), []);
  assert.strictEqual(s.read('back-office').status, 'restoring');
  assert.deepStrictEqual(await s.reconcile({ workspaces: [], agents: [] }), [{ name: 'Back Office', reason: 'interrupted' }]);
  s.dispose();
});

test('reconcile() keeps the saved session id when the snapshot does not report one yet', async () => {
  const { s } = await archivedOne(fakeClient());
  await s.restore(s.listArchived()[0].id);
  leaveUnfinished(s, 'back-office', 'restoring', { status: 'not_started', session_id: 'kept-session' });
  await s.reconcile({ workspaces: [{ workspace_id: 'w1' }], agents: [{ pane_id: 'w1:p1', name: 'back-office-boss' }] });
  s.dispose();
  assert.strictEqual(s.read('back-office').boss.session_id, 'kept-session');
});

// ---- an earlier boss workspace, a lost workspace.create, closing mid-start ----

test('restore() closes an earlier boss workspace still open in the folder before making a new one', async () => {
  const { s } = await archivedOne(fakeClient());
  const folder = s.folder('back-office');
  const client = fakeClient({
    'session.snapshot': () => ({ snapshot: { panes: [{ pane_id: 'w3:p1', workspace_id: 'w3', cwd: folder }] } }),
    'workspace.close': () => ({}),
  });
  s.client = client;
  await s.restore(s.listArchived()[0].id);
  s.dispose();
  assert.deepStrictEqual(client.calls.map((c) => c.method).slice(0, 3), ['session.snapshot', 'workspace.close', 'workspace.create']);
});

test('restore() rolls back when herdr will not close an earlier boss workspace', async () => {
  const { s } = await archivedOne(fakeClient());
  const folder = s.folder('back-office');
  const client = fakeClient({
    'session.snapshot': () => ({ snapshot: { panes: [{ pane_id: 'w3:p1', workspace_id: 'w3', cwd: folder }] } }),
    'workspace.close': () => { throw new Error('busy'); },
  });
  s.client = client;
  const { id } = s.listArchived()[0];
  await assert.rejects(s.restore(id), /earlier boss workspace/);
  s.dispose();
  assert.ok(!client.calls.some((c) => c.method === 'workspace.create'));
  assert.deepStrictEqual(s.listArchived().map((a) => a.id), [id]);
});

test('restore() leaves a lost workspace.create to reconcile(), which waits for a late workspace before archiving', async () => {
  const { s } = await archivedOne(fakeClient());
  const folder = s.folder('back-office');
  s.client = fakeClient({ 'workspace.create': () => { throw new Error('workspace.create: timeout'); }, 'workspace.close': () => ({}) });
  await assert.rejects(s.restore(s.listArchived()[0].id), /timeout/);
  assert.strictEqual(s.read('back-office').status, 'restoring');
  assert.deepStrictEqual(s.listArchived(), []);
  // Nothing in herdr yet: the create may still go through, so wait.
  assert.deepStrictEqual(await s.reconcile({ workspaces: [], panes: [], agents: [] }, Date.now() + 1), []);
  // It went through late: close it and archive.
  const late = { workspaces: [{ workspace_id: 'w5' }], panes: [{ pane_id: 'w5:p1', workspace_id: 'w5', cwd: folder }], agents: [] };
  assert.deepStrictEqual(await s.reconcile(late, Date.now() + 1), [{ name: 'Back Office', reason: 'interrupted' }]);
  s.dispose();
  assert.deepStrictEqual(s.client.calls.filter((c) => c.method === 'workspace.close').map((c) => c.params.workspace_id), ['w5']);
});

test('reconcile() archives a lost workspace.create that never showed up once the wait is over', async () => {
  const { s } = await archivedOne(fakeClient());
  s.client = fakeClient({ 'workspace.create': () => { throw new Error('workspace.create: connection closed'); } });
  await assert.rejects(s.restore(s.listArchived()[0].id), /connection closed/);
  const json = s.read('back-office'); json.boss.workspace_at = Date.now() - 61_000; s.write('back-office', json);
  assert.deepStrictEqual(await s.reconcile({ workspaces: [], panes: [], agents: [] }), [{ name: 'Back Office', reason: 'interrupted' }]);
  s.dispose();
});

test('create() removes the folder when herdr rejects workspace.create, and leaves a lost one to reconcile()', async () => {
  const rejected = storeWith(fakeClient({ 'workspace.create': () => { throw Object.assign(new Error('bad cwd'), { answered: true }); } })).s;
  await assert.rejects(rejected.create({ name: 'Half Made', root: tmp(), branch: 'x/half' }), /bad cwd/);
  rejected.dispose();
  assert.strictEqual(fs.existsSync(rejected.folder('half-made')), false);
  const lost = storeWith(fakeClient({ 'workspace.create': () => { throw new Error('workspace.create: timeout'); } })).s;
  await assert.rejects(lost.create({ name: 'Half Made', root: tmp(), branch: 'x/half' }), /timeout/);
  lost.dispose();
  assert.deepStrictEqual({ status: lost.read('half-made').status, run: lost.read('half-made').run }, { status: 'creating', run: null });
});

test('close() refuses while this run is still restoring the orchestrator', async () => {
  const { s } = await archivedOne(fakeClient());
  let release;
  s.client = fakeClient({ 'workspace.create': () => new Promise((r) => { release = r; }) });
  const restoring = s.restore(s.listArchived()[0].id);
  await new Promise((r) => setTimeout(r, 50));
  await assert.rejects(s.close('back-office', {}, null), /still starting/);
  release({ workspace: { workspace_id: 'w1' }, root_pane: { pane_id: 'w1:p1' } });
  await restoring;
  s.dispose();
  assert.strictEqual(s.read('back-office').status, 'running');
});

test('restore() hands a failure after the workspace exists to reconcile() instead of leaving it stuck', async () => {
  const client = fakeClient({ 'workspace.close': () => ({}) });
  const { s } = await archivedOne(client);
  s.briefTemplate = null; // writing the brief throws
  await assert.rejects(s.restore(s.listArchived()[0].id));
  const json = s.read('back-office');
  assert.deepStrictEqual({ status: json.status, run: json.run, ws: json.boss.workspace_id }, { status: 'restoring', run: null, ws: 'w1' });
  // The same app run can now recover it: the boss pane has no agent, so it is closed and archived.
  assert.deepStrictEqual(await s.reconcile({ workspaces: [{ workspace_id: 'w1' }], agents: [] }, Date.now() + 1), [{ name: 'Back Office', reason: 'interrupted' }]);
  s.dispose();
});

// ---- strays, closing during recovery, session on close ----

test('reconcile() moves an ended folder left outside the archive back in', async () => {
  const { s } = await archivedOne(fakeClient());
  const { id } = s.listArchived()[0];
  // A restore cut short right after moving the folder out of the archive.
  fs.renameSync(s.archivedFolder(id), s.folder('back-office'));
  assert.deepStrictEqual(s.listArchived(), []);
  await s.reconcile({ workspaces: [] });
  s.dispose();
  assert.deepStrictEqual(s.listArchived().map((a) => a.name), ['Back Office']);
  assert.strictEqual(fs.existsSync(s.folder('back-office')), false);
});

test('close() refuses while recovery is still waiting on an unfinished run', async () => {
  const { s } = await archivedOne(fakeClient());
  s.client = fakeClient({ 'workspace.create': () => { throw new Error('workspace.create: timeout'); } });
  await assert.rejects(s.restore(s.listArchived()[0].id), /timeout/);
  assert.strictEqual(s.read('back-office').run, null);
  await assert.rejects(s.close('back-office', {}, null), /still starting/);
  s.dispose();
  assert.strictEqual(fs.existsSync(s.folder('back-office')), true);
});

test('close() saves the boss session from the snapshot before archiving', async () => {
  const { s } = storeWith(fakeClient({ 'workspace.close': () => ({}) }));
  await s.create({ name: 'Sessions', root: tmp(), branch: 'x/sessions' });
  const snapshot = { workspaces: [{ workspace_id: 'w1' }], panes: [], agents: [{ pane_id: 'w1:p1', name: 'sessions-boss', agent_session: { value: 'closing-session' } }] };
  await s.close('sessions', {}, snapshot);
  s.dispose();
  const file = path.join(s.archivedFolder(s.listArchived()[0].id), 'orchestrator.json');
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).boss.session_id, 'closing-session');
});

test('restore() saves when it asked herdr for the workspace before asking', async () => {
  const { s } = await archivedOne(fakeClient());
  let seen = null;
  s.client = fakeClient({ 'workspace.create': () => { seen = s.read('back-office').boss.workspace_at; return new Promise(() => {}); } });
  const before = Date.now();
  s.restore(s.listArchived()[0].id);
  await new Promise((r) => setTimeout(r, 50));
  s.dispose();
  assert.ok(seen >= before, `workspace_at ${seen} was not saved before workspace.create`);
});

// ---- board parsing ----
const { parseBoard } = require('../orchestrators');

test('parseBoard() puts each task under the ### heading above it, and the counts stay flat', () => {
  const b = parseBoard(['# T', '## Tasks', '- [ ] loose', '### ABC-1 Billing', '- [x] fix (@w)', '- [ ] deploy',
    '### ABC-2 Colours', '- [x] ABC-2 merged #9', '## Blockers', '### not a group', '## Questions', '- why?'].join('\n'));
  assert.deepStrictEqual(b.tasks.map((t) => [t.text, t.group, t.done, t.owner]), [
    ['loose', null, false, null],
    ['fix', 'ABC-1 Billing', true, 'w'],
    ['deploy', 'ABC-1 Billing', false, null],
    ['ABC-2 merged #9', 'ABC-2 Colours', true, null],
  ]);
  assert.strictEqual(b.questions.length, 1);
});

// ---- people ----
// The office names every agent (Patrik, Anna, …). PEOPLE.md in the boss folder
// maps those names to herdr agent names so the user can say "ask Patrik".

test('create() points the boss brief at PEOPLE.md and writes an empty roster', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'Names', root: tmp(), branch: 'x/names' });
  s.dispose();
  const people = path.join(s.folder('names'), 'PEOPLE.md');
  assert.ok(fs.readFileSync(path.join(s.folder('names'), 'CLAUDE.md'), 'utf8').includes(people));
  assert.match(fs.readFileSync(people, 'utf8'), /Nobody is at a desk yet/);
});

test('setPeople() writes boss first, then workers, with agent names and repos', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'Names', root: tmp(), branch: 'x/names' });
  s.dispose();
  s.setPeople({ names: [
    { name: 'PATRIK', agent: 'names-api', role: 'worker', repo: 'api' },
    { name: 'ANNA', agent: 'names', role: 'boss', repo: '' },
  ] });
  const text = fs.readFileSync(path.join(s.folder('names'), 'PEOPLE.md'), 'utf8');
  const rows = text.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| name'));
  assert.deepStrictEqual(rows, ['| Anna | `names` | boss (you) | – |', '| Patrik | `names-api` | worker | api |']);
});

test('setPeople() leaves an unchanged file alone and ignores bad slugs', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'Names', root: tmp(), branch: 'x/names' });
  s.dispose();
  const file = path.join(s.folder('names'), 'PEOPLE.md');
  const people = { names: [{ name: 'ERIK', agent: 'names-web', role: 'worker', repo: 'web' }] };
  s.setPeople(people);
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(file, past, past);
  const before = fs.statSync(file).mtimeMs;
  s.setPeople({ ...people, '../evil': [] });
  assert.strictEqual(fs.statSync(file).mtimeMs, before);
  assert.ok(!fs.existsSync(path.join(s.dir, '..', 'evil')));
});

// ---- ops agent and alerts ----
// The ops agent sits in the boss's room like the QA reviewer and writes alert
// files the office reads directly, so the banner does not wait for the boss.
const { opsAgent, setFrontmatter, parseBoard: parse } = require('../orchestrators');

test('opsAgent() fits herdr\'s 32 characters for the longest slug', () => {
  const slug = slugify('a very long orchestrator name that goes on');
  assert.ok(opsAgent(slug).length <= 32, opsAgent(slug));
  assert.match(opsAgent(slug), /^[a-z][a-z0-9_-]{0,31}$/);
});

test('create() writes the ops brief, trusts its folder and makes the alerts folder', async () => {
  const { s, claudeConfig } = storeWith(fakeClient());
  await s.create({ name: 'Watched', root: tmp(), branch: 'x/w' });
  s.dispose();
  const ops = fs.readFileSync(path.join(s.opsFolder('watched'), 'CLAUDE.md'), 'utf8');
  assert.match(ops, /ops agent of the "Watched" orchestrator/);
  assert.match(ops, new RegExp(`from: ${opsAgent('watched')}`));
  assert.ok(ops.includes(s.alertsFolder('watched')));
  assert.ok(!/\{\{/.test(ops), 'no placeholder left in the ops brief');
  const boss = fs.readFileSync(path.join(s.folder('watched'), 'CLAUDE.md'), 'utf8');
  assert.match(boss, new RegExp(`agent start ${opsAgent('watched')}`));
  assert.match(boss, /## Next/);
  assert.ok(!/\{\{/.test(boss), 'no placeholder left in the boss brief');
  assert.ok(fs.statSync(s.alertsFolder('watched')).isDirectory());
  const cfg = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
  assert.strictEqual(cfg.projects[s.opsFolder('watched')].hasTrustDialogAccepted, true);
});

test('list() reads alert files and dismissAlert() marks one dismissed, keeping the rest', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'Alarm', root: tmp(), branch: 'x/a' });
  s.dispose();
  const file = 'api-1760000000.md';
  fs.writeFileSync(path.join(s.alertsFolder('alarm'), file), '---\nstatus: open\nrepo: api\nenv: prod\ntitle: 5xx 4% since deploy\nlink: https://grafana.example/d/x\n---\nErrors since 14:02.\n');
  const [o] = s.list();
  assert.deepStrictEqual(o.alerts.map((a) => [a.file, a.status, a.repo, a.title, a.text]), [[file, 'open', 'api', '5xx 4% since deploy', 'Errors since 14:02.']]);
  s.dismissAlert('alarm', file);
  const [a] = s.list()[0].alerts;
  assert.strictEqual(a.dismissed, 'true');
  assert.strictEqual(a.status, 'open');
  assert.strictEqual(a.text, 'Errors since 14:02.');
});

test('dismissAlert() refuses names that could leave the alerts folder', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'Safe', root: tmp(), branch: 'x/s' });
  s.dispose();
  for (const bad of ['../orchestrator.json', '../../x.md', 'a/b.md', '.hidden.md', 'x.json', '']) {
    assert.throws(() => s.dismissAlert('safe', bad), /alert file/i, JSON.stringify(bad));
  }
});

test('setFrontmatter() replaces or adds one key and keeps the body', () => {
  assert.strictEqual(setFrontmatter('---\nstatus: open\nrepo: api\n---\nbody\n', 'status', 'resolved'), '---\nstatus: resolved\nrepo: api\n---\nbody\n');
  assert.strictEqual(setFrontmatter('---\nstatus: open\n---\nbody', 'dismissed', 'true'), '---\nstatus: open\ndismissed: true\n---\nbody');
  assert.strictEqual(setFrontmatter('just text\n', 'dismissed', 'true'), '---\ndismissed: true\n---\njust text\n');
});

test('parseBoard() reads up to three ## Next suggestions and skips placeholders', () => {
  const b = parse('# T\n## Tasks\n- [ ] a\n## Next\n- none\n- Watch the deploy of #12 to prod (30 min)\n- QA review of all worktrees\n- third\n- fourth\n');
  assert.deepStrictEqual(b.next, ['Watch the deploy of #12 to prod (30 min)', 'QA review of all worktrees', 'third']);
  assert.deepStrictEqual(parse('# T\n## Tasks\n- [ ] a\n').next, []);
});

test('a sent suggestion hides until the boss drops it; a declined one stays hidden', async () => {
  const client = fakeClient({ 'agent.prompt': () => ({}) });
  const { s } = storeWith(client);
  await s.create({ name: 'Chips', root: tmp(), branch: 'x/c' });
  s.dispose();
  const board = (lines) => fs.writeFileSync(path.join(s.folder('chips'), 'BOARD.md'), `# Chips\n## Tasks\n- [x] done\n## Next\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
  board(['Watch the deploy', 'QA review']);
  await s.promptBoss('chips', 'Watch the deploy', null, 'Watch the deploy');
  s.declineNext('chips', 'QA review');
  assert.deepStrictEqual(s.list()[0].board.next, []);
  board(['QA review']); // the boss acted on the sent one and dropped it
  assert.deepStrictEqual(s.list()[0].board.next, []);
  assert.deepStrictEqual(s.read('chips').next_sent, []);
  board(['Watch the deploy']); // suggested again later: shown again
  assert.deepStrictEqual(s.list()[0].board.next, ['Watch the deploy']);
});

// ---- prompting the boss ----
// herdr clears an agent's name when the process in its pane exits or is
// replaced, so a boss that was restarted in its pane has no name any more.
// The pane id stays, and agent commands accept it as the target.

test('promptBoss() targets the boss pane, which outlives the agent name', async () => {
  const client = fakeClient({ 'agent.prompt': () => ({}) });
  const { s } = storeWith(client);
  await s.create({ name: 'Renamed', root: tmp(), branch: 'x/renamed' });
  s.dispose();
  await s.promptBoss('renamed', 'hello');
  const call = client.calls.find((c) => c.method === 'agent.prompt');
  assert.deepStrictEqual(call.params, { target: 'w1:p1', text: 'hello' });
});

// ---- Slack watcher ----
// The watcher sits in the boss's room in slack/, reads WATCHES.md (written by
// the office and the boss) and writes waiting/ files the office turns into a
// reception ticket. See ../designs/slack-watcher.md.
const { slackAgent, parseWatches } = require('../slack');

test('create() writes the Slack brief, its permissions and an empty watch list, and trusts the folder', async () => {
  const { s, claudeConfig } = storeWith(fakeClient());
  await s.create({ name: 'Chatty', root: tmp(), branch: 'x/c' });
  s.dispose();
  const folder = s.slackFolder('chatty');
  const brief = fs.readFileSync(path.join(folder, 'CLAUDE.md'), 'utf8');
  assert.match(brief, /Slack watcher of the "Chatty" orchestrator/);
  assert.ok(brief.includes(path.join(folder, 'waiting')));
  assert.ok(!/\{\{/.test(brief), 'no placeholder left in the Slack brief');
  const settings = JSON.parse(fs.readFileSync(path.join(folder, '.claude', 'settings.json'), 'utf8'));
  assert.ok(settings.permissions.allow.includes('mcp__claude_ai_Slack__slack_read_thread'));
  assert.ok(settings.permissions.deny.includes('mcp__claude_ai_Slack__slack_send_message'));
  assert.ok(!settings.permissions.allow.some((t) => /send|schedule|create|update|add_/.test(t)), 'the watcher may not write to Slack');
  assert.deepStrictEqual(parseWatches(fs.readFileSync(path.join(folder, 'WATCHES.md'), 'utf8')), []);
  assert.ok(fs.statSync(path.join(folder, 'waiting')).isDirectory());
  const boss = fs.readFileSync(path.join(s.folder('chatty'), 'CLAUDE.md'), 'utf8');
  assert.ok(boss.includes(path.join(folder, 'WATCHES.md')));
  assert.ok(!/\{\{/.test(boss), 'no placeholder left in the boss brief');
  const cfg = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
  assert.strictEqual(cfg.projects[folder].hasTrustDialogAccepted, true);
  assert.ok(slackAgent('chatty').length <= 32);
});

test('prepareSlack() gives an orchestrator made before the watcher its brief, permissions and trust', async () => {
  const { s, claudeConfig } = storeWith(fakeClient());
  await s.create({ name: 'Older', root: tmp(), branch: 'x/o' });
  s.dispose();
  fs.rmSync(s.slackFolder('older'), { recursive: true });
  const cfg = JSON.parse(fs.readFileSync(claudeConfig, 'utf8')); delete cfg.projects[s.slackFolder('older')]; fs.writeFileSync(claudeConfig, JSON.stringify(cfg));
  s.prepareSlack('older');
  assert.match(fs.readFileSync(path.join(s.slackFolder('older'), 'CLAUDE.md'), 'utf8'), /Slack watcher of the "Older" orchestrator/);
  assert.ok(fs.existsSync(path.join(s.slackFolder('older'), '.claude', 'settings.json')));
  assert.strictEqual(JSON.parse(fs.readFileSync(claudeConfig, 'utf8')).projects[s.slackFolder('older')].hasTrustDialogAccepted, true);
});

test('restore keeps the watch list the boss and the user wrote', async () => {
  const { s } = storeWith(fakeClient());
  const json = await s.create({ name: 'Keep', root: tmp(), branch: 'x/k' });
  s.dispose();
  fs.writeFileSync(path.join(s.slackFolder('keep'), 'WATCHES.md'), '- channel #ours\n');
  s.writeHelperBriefs(json);
  assert.strictEqual(fs.readFileSync(path.join(s.slackFolder('keep'), 'WATCHES.md'), 'utf8'), '- channel #ours\n');
});

test('addWatch() and removeWatch() edit WATCHES.md; list() carries the watches', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'Ears', root: tmp(), branch: 'x/e' });
  s.dispose();
  assert.deepStrictEqual(s.addWatch('ears', ' #Checkout-Redesign '), { kind: 'channel', target: '#checkout-redesign', note: '' });
  s.addWatch('ears', 'https://example.slack.com/archives/C01/p1729680000123456');
  s.addWatch('ears', '#checkout-redesign');
  assert.deepStrictEqual(s.list()[0].slack.watches.map((w) => [w.kind, w.target]), [
    ['channel', '#checkout-redesign'], ['thread', 'https://example.slack.com/archives/C01/p1729680000123456'],
  ]);
  assert.throws(() => s.addWatch('ears', 'checkout'), /Slack link, #channel or @name/);
  s.removeWatch('ears', '#checkout-redesign');
  assert.deepStrictEqual(s.list()[0].slack.watches.map((w) => w.target), ['https://example.slack.com/archives/C01/p1729680000123456']);
});

test('list() reads the watcher state and waiting messages; dismissWaiting() marks one', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'Wait', root: tmp(), branch: 'x/w' });
  s.dispose();
  const folder = s.slackFolder('wait');
  fs.writeFileSync(path.join(folder, 'state.json'), JSON.stringify({ last_check: '2026-10-27T14:32:00Z', error: null, watches: { '#a': { summary: 'Checkout redesign' } } }));
  const file = 'C0456-1729680000.123456.md';
  fs.writeFileSync(path.join(folder, 'waiting', file), '---\nstatus: open\nwatch: #a\nlink: https://example.slack.com/archives/C0456/p1729680000123456\nauthor: Patrik\ntitle: VAT in the discount price?\nwhy: aimed at you\n---\nShould it include VAT?\n');
  let { slack } = s.list()[0];
  assert.strictEqual(slack.interval, 10);
  assert.strictEqual(slack.state.watches['#a'].summary, 'Checkout redesign');
  assert.deepStrictEqual(slack.waiting.map((m) => [m.file, m.status, m.author, m.title]), [[file, 'open', 'Patrik', 'VAT in the discount price?']]);
  s.dismissWaiting('wait', file);
  ({ slack } = s.list()[0]);
  assert.strictEqual(slack.waiting[0].dismissed, 'true');
  assert.strictEqual(slack.waiting[0].text, 'Should it include VAT?');
  for (const bad of ['../state.json', '../../orchestrator.json', 'a/b.md', '.x.md', 'x.json', '']) {
    assert.throws(() => s.dismissWaiting('wait', bad), /waiting file/i, JSON.stringify(bad));
  }
});

test('list() survives a missing or broken state.json', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'Bare', root: tmp(), branch: 'x/b' });
  s.dispose();
  assert.deepStrictEqual(s.list()[0].slack.state, {});
  fs.writeFileSync(path.join(s.slackFolder('bare'), 'state.json'), '{half');
  assert.deepStrictEqual(s.list()[0].slack.state, {});
});

test('setSlackInterval() keeps it between 2 and 240 minutes; markSlackSeen() and slackTick() save to orchestrator.json', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'Clock', root: tmp(), branch: 'x/c' });
  s.dispose();
  s.setSlackInterval('clock', 30);
  assert.strictEqual(s.list()[0].slack.interval, 30);
  for (const bad of [1, 241, 'x', NaN, 2.5]) assert.throws(() => s.setSlackInterval('clock', bad), /minutes/, String(bad));
  s.markSlackSeen('clock');
  assert.ok(Date.parse(s.read('clock').slack.seen_at) > 0);
  s.slackTick('clock', { last_tick: 5, phase: 'cleared' });
  assert.deepStrictEqual({ ...s.read('clock').slack, seen_at: 'x' }, { interval: 30, seen_at: 'x', last_tick: 5, phase: 'cleared' });
});

test('claimBranch() saves a sub-ticket\'s branch once, never the own branch', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'Parent', root: tmp(), branch: 'mia/abc-1485' });
  s.dispose();
  s.claimBranch('parent', 'mia/abc-1490-sub');
  s.claimBranch('parent', 'mia/abc-1490-sub');
  s.claimBranch('parent', 'mia/abc-1485');
  assert.deepStrictEqual(s.read('parent').branches, ['mia/abc-1490-sub']);
  assert.throws(() => s.claimBranch('parent', ''), /No branch/);
});

test('rename() changes the name and the brief, keeps the slug, and wants a real name', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'Parent', root: tmp(), branch: 'mia/abc-1485' });
  s.dispose();
  s.rename('parent', '  news   feed (ABC-2563) ');
  assert.strictEqual(s.read('parent').name, 'news feed (ABC-2563)');
  assert.strictEqual(s.read('parent').slug, 'parent');
  assert.match(require('node:fs').readFileSync(require('node:path').join(s.folder('parent'), 'CLAUDE.md'), 'utf8'), /news feed \(ABC-2563\)/);
  assert.throws(() => s.rename('parent', '   '), /name/);
  assert.throws(() => s.rename('parent', 'x'.repeat(61)), /60/);
});

test('a pi orchestrator still gets a Claude Slack watcher, trusted only when it starts', async () => {
  const { s, claudeConfig } = storeWith(fakeClient());
  await s.create({ name: 'Pi Ears', root: tmp(), branch: 'x/pi-ears', agent: 'pi' });
  s.dispose();
  assert.match(fs.readFileSync(path.join(s.slackFolder('pi-ears'), 'CLAUDE.md'), 'utf8'), /Slack watcher of the "Pi Ears" orchestrator/);
  assert.ok(!fs.existsSync(claudeConfig));
  s.prepareSlack('pi-ears');
  const cfg = JSON.parse(fs.readFileSync(claudeConfig, 'utf8'));
  assert.strictEqual(cfg.projects[s.slackFolder('pi-ears')].hasTrustDialogAccepted, true);
  assert.strictEqual(cfg.projects[s.folder('pi-ears')], undefined);
});

// ---- agent kind: Claude or Pi ----
// orchestrator.json `agent` picks the coding agent for the boss, QA and ops.
// Each kind reads its brief, skills, sessions and trust from its own places.
const { agentKind, contextFile, hasPiConversation, piSessionDir, trustPiFolder } = require('../orchestrators');

test('agentKind() defaults to claude, also for orchestrators made before the setting', () => {
  assert.strictEqual(agentKind({}), 'claude');
  assert.strictEqual(agentKind({ agent: 'pi' }), 'pi');
  assert.strictEqual(agentKind({ agent: 'codex' }), 'claude'); // only kinds the office knows
  assert.strictEqual(contextFile('claude'), 'CLAUDE.md');
  assert.strictEqual(contextFile('pi'), 'AGENTS.md');
});

test('create() records claude by default and starts the boss with kind claude', async () => {
  const client = fakeClient();
  const { s } = storeWith(client);
  const json = await s.create({ name: 'Plain', root: tmp(), branch: 'x/plain' });
  s.dispose();
  assert.strictEqual(json.agent, 'claude');
  assert.strictEqual(s.read('plain').agent, 'claude');
  assert.strictEqual(client.calls.find((c) => c.method === 'agent.start').params.kind, 'claude');
  assert.ok(fs.existsSync(path.join(s.folder('plain'), '.claude', 'skills', 'orchestrate', 'SKILL.md')));
  assert.ok(!fs.existsSync(path.join(s.folder('plain'), 'AGENTS.md')));
  assert.match(fs.readFileSync(path.join(s.folder('plain'), 'CLAUDE.md'), 'utf8'), /--kind claude --pane/);
});

test('list() reads an orchestrator.json without `agent` as claude', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'Old', root: tmp(), branch: 'x/old' });
  const json = s.read('old'); delete json.agent; s.write('old', json);
  const [o] = s.list();
  s.dispose();
  assert.strictEqual(o.agent, 'claude');
});

test('a pi orchestrator writes AGENTS.md briefs, a pi skill and pi trust, and starts every agent as pi', async () => {
  const client = fakeClient();
  const { s, claudeConfig, piTrust } = storeWith(client);
  const json = await s.create({ name: 'Pied', root: tmp(), branch: 'x/pied', agent: 'pi' });
  s.dispose();
  assert.strictEqual(json.agent, 'pi');
  assert.strictEqual(client.calls.find((c) => c.method === 'agent.start').params.kind, 'pi');
  const boss = fs.readFileSync(path.join(s.folder('pied'), 'AGENTS.md'), 'utf8');
  assert.ok(!fs.existsSync(path.join(s.folder('pied'), 'CLAUDE.md')));
  // workers, QA and ops are started by the boss with the orchestrator's kind
  assert.strictEqual(boss.match(/--kind pi --pane/g).length, 3);
  assert.ok(!/--kind claude|Claude Code|CLAUDE\.md|\{\{/.test(boss), 'no Claude wording or placeholder left');
  for (const f of [s.qaFolder('pied'), s.opsFolder('pied')]) {
    assert.ok(fs.existsSync(path.join(f, 'AGENTS.md')) && !fs.existsSync(path.join(f, 'CLAUDE.md')), f);
  }
  const skill = fs.readFileSync(path.join(s.folder('pied'), '.pi', 'skills', 'orchestrate', 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: orchestrate\n/);
  assert.ok(!/CLAUDE\.md|\{\{/.test(skill));
  assert.ok(!fs.existsSync(path.join(s.folder('pied'), '.claude')));
  // pi's trust file has the boss folder (QA and ops are below it); Claude's config is left alone
  const trust = JSON.parse(fs.readFileSync(piTrust, 'utf8'));
  assert.strictEqual(trust[fs.realpathSync(s.folder('pied'))], true);
  assert.ok(!fs.existsSync(claudeConfig));
});

test('startAgent() passes the kind to herdr', async () => {
  const client = fakeClient();
  const { s } = storeWith(client);
  await s.startAgent('w1:p1', 'x', [], 'pi');
  await s.startAgent('w1:p1', 'y');
  s.dispose();
  assert.deepStrictEqual(client.calls.map((c) => c.params.kind), ['pi', 'claude']);
});

test('trustPiFolder() adds the folder and keeps other decisions; refuses a file it cannot parse', () => {
  const dir = tmp();
  const file = path.join(dir, 'trust.json');
  fs.writeFileSync(file, JSON.stringify({ '/elsewhere': false }));
  trustPiFolder(dir, file);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { '/elsewhere': false, [fs.realpathSync(dir)]: true });
  fs.writeFileSync(file, '{oops');
  assert.throws(() => trustPiFolder(dir, file), /trust\.json/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{oops');
});

// pi keeps sessions under sessions/--<path with / as ->--/<stamp>_<id>.jsonl; herdr reports the file path.
function savePiSession(piSessions, folder, name = '2026-10-19T10-00-00-000Z_abc.jsonl') {
  const dir = piSessionDir(folder, piSessions);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), '{}\n');
  return path.join(dir, name);
}

test('piSessionDir() names the folder the way pi does', () => {
  assert.strictEqual(piSessionDir('/Users/dev/src/config', '/s'), '/s/--Users-dev-src-config--');
  assert.strictEqual(piSessionDir('/a/b c/d', '/s'), '/s/--a-b c-d--');
});

test('restore() of a pi orchestrator reopens the recorded pi session file, else continues, else starts fresh', async () => {
  const client = fakeClient();
  const ctx = storeWith(client);
  const { s, piSessions } = ctx;
  await s.create({ name: 'Pi Back', root: tmp(), branch: 'x/pi-back', agent: 'pi' });
  const folder = s.folder('pi-back');
  const archiveWith = async (session) => {
    if (fs.existsSync(folder)) await s.archive('pi-back', 'closed');
    const { id } = s.listArchived()[0];
    const file = path.join(s.archivedFolder(id), 'orchestrator.json');
    const json = JSON.parse(fs.readFileSync(file, 'utf8')); json.boss.session_id = session; fs.writeFileSync(file, JSON.stringify(json));
    client.calls.length = 0;
    return id;
  };
  const startArgs = () => client.calls.find((c) => c.method === 'agent.start').params;

  // no sessions at all: fresh
  let json = await s.restore(await archiveWith(null));
  assert.ok(!('args' in startArgs()));
  assert.strictEqual(startArgs().kind, 'pi');
  assert.strictEqual(json.boss.resumed, false);

  // the recorded session file exists: opened by path
  const file = savePiSession(piSessions, folder);
  json = await s.restore(await archiveWith(file));
  assert.deepStrictEqual(startArgs().args, ['--session', file]);
  assert.strictEqual(json.boss.resumed, true);
  assert.strictEqual(json.boss.session_id, file);

  // a session file of another folder is not this boss's: fresh rather than guess
  const other = savePiSession(piSessions, '/somewhere/else');
  json = await s.restore(await archiveWith(other));
  assert.ok(!('args' in startArgs()));
  assert.ok(!('session_id' in json.boss));

  // no recorded session, but the folder has one: --continue
  json = await s.restore(await archiveWith(null));
  s.dispose();
  assert.deepStrictEqual(startArgs().args, ['--continue']);
  assert.strictEqual(fs.existsSync(path.join(folder, 'AGENTS.md')), true);
});

test('hasPiConversation() needs a .jsonl in the folder\'s session dir', () => {
  const sessions = tmp();
  assert.strictEqual(hasPiConversation('/x/boss', sessions), false);
  const file = savePiSession(sessions, '/x/boss');
  assert.strictEqual(hasPiConversation('/x/boss', sessions), true);
  assert.strictEqual(hasPiConversation('/x/boss', sessions, file), true);
  assert.strictEqual(hasPiConversation('/x/boss', sessions, `${file}.gone.jsonl`), false);
  assert.strictEqual(hasPiConversation('/y/boss', sessions, file), false);
});

test('setInstructions() rewrites the brief in the file each orchestrator\'s kind reads', async () => {
  const { s } = storeWith(fakeClient());
  await s.create({ name: 'Cl', root: tmp(), branch: 'x/cl' });
  await s.create({ name: 'Pp', root: tmp(), branch: 'x/pp', agent: 'pi' });
  s.setInstructions('Be brief.');
  s.dispose();
  assert.match(fs.readFileSync(path.join(s.folder('cl'), 'CLAUDE.md'), 'utf8'), /Be brief\./);
  assert.match(fs.readFileSync(path.join(s.folder('pp'), 'AGENTS.md'), 'utf8'), /Be brief\./);
  assert.ok(!fs.existsSync(path.join(s.folder('pp'), 'CLAUDE.md')));
});
