const { app, BrowserWindow, ipcMain, clipboard, dialog, shell } = require('electron');
const path = require('node:path');
const { HerdrClient } = require('./herdr-client');
const { StreamManager, resolveHerdr } = require('./streams');
const { shouldAutostart, startHerdrServer } = require('./autostart');
const { OrchestratorStore, AGENT_KINDS } = require('./orchestrators');
const { runSlack } = require('./slack');
const { AssistantStore, runAssistant } = require('./assistant');
const { AssistantSession } = require('./assistant-session');
const { productName: APP_NAME } = require('./package.json');
const { openInEditor } = require('./editor');
const { findPullRequest } = require('./pr');
const { createWorktreeLister } = require('./worktrees');
const { coalesce } = require('./coalesce');
const { isRealDataFolder } = require('./data-folder');
app.setName(APP_NAME); // the menu bar and dock label come from the bundle: see scripts/brand.js
// Electron derives the data directory from the product name; keep the one the
// app has always used so settings and orchestrators stay where they are.
const realUserData = path.join(app.getPath('appData'), 'agent-office');
if (!process.env.OFFICE_SCREENSHOT) app.setPath('userData', realUserData);

// OFFICE_USER_DATA=<dir> runs a second copy beside the real app, to try a
// branch: its own settings and orchestrators, no single-instance lock, and it
// never starts herdr. It shares the running herdr, so desks are real.
const devUserData = process.env.OFFICE_USER_DATA ? path.resolve(process.env.OFFICE_USER_DATA) : null;
if (devUserData && isRealDataFolder(devUserData, realUserData)) {
  console.error('OFFICE_USER_DATA must not be the real data folder or inside it');
  app.exit(1);
} else if (devUserData) {
  require('node:fs').mkdirSync(devUserData, { recursive: true });
  app.setPath('userData', devUserData);
}

// Screenshot runs get their own data directory so they never fight the
// running app for the localStorage lock (that stall showed up as a 4 s
// start). Settings come from OFFICE_DEV_SETTINGS in those runs anyway.
if (process.env.OFFICE_SCREENSHOT) {
  app.setPath('userData', path.join(require('node:os').tmpdir(), 'agent-office-screenshot'));
}
// One window per machine: a second launch focuses the first instead of
// sharing its data directory.
if (!process.env.OFFICE_SCREENSHOT && !devUserData && !app.requestSingleInstanceLock()) {
  app.quit();
}

const client = new HerdrClient();
let win = null;
const toRenderer = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };
const terminals = new StreamManager(toRenderer);
const worktreeLister = createWorktreeLister(client);

// Orchestrators (boss + workers). Folders live under userData; in fixture
// mode the prototype's fixture/orchestrators so the fixture can ship one.
let orchestrators = null;
function ensureOrchestrators() {
  if (orchestrators) return orchestrators;
  const dir = process.env.OFFICE_FIXTURE
    ? path.join(__dirname, 'fixture', 'orchestrators')
    : path.join(app.getPath('userData'), 'orchestrators');
  orchestrators = new OrchestratorStore({
    dir,
    client: process.env.OFFICE_FIXTURE ? null : client,
    briefTemplate: require('node:fs').readFileSync(path.join(__dirname, 'orchestrator-brief.md'), 'utf8'),
    skillTemplate: require('node:fs').readFileSync(path.join(__dirname, 'orchestrator-skill.md'), 'utf8'),
    qaTemplate: require('node:fs').readFileSync(path.join(__dirname, 'qa-brief.md'), 'utf8'),
    opsTemplate: require('node:fs').readFileSync(path.join(__dirname, 'ops-brief.md'), 'utf8'),
    slackTemplate: require('node:fs').readFileSync(path.join(__dirname, 'slack-brief.md'), 'utf8'),
    onChange: () => toRenderer('orchestrators', orchestrators.list()),
  });
  return orchestrators;
}

// Structural events: anything that adds, removes, moves or focuses a
// workspace, tab or pane. Each one triggers a fresh snapshot.
// The assistant (see assistant.js): a headless Claude session with its own
// clock, independent of herdr. Its answers stream to the chat window as
// 'assistant-chat' events. Fixture runs get a canned one from fixture.js.
let assistant = null;
let session = null;
function ensureAssistant() {
  if (assistant) return assistant;
  assistant = new AssistantStore({
    dir: path.join(app.getPath('userData'), 'assistant'),
    orchestratorsDir: ensureOrchestrators().dir,
    template: require('node:fs').readFileSync(path.join(__dirname, 'assistant-brief.md'), 'utf8'),
  });
  session = new AssistantSession({ dir: assistant.dir });
  session.on('session', ({ id }) => assistant.tick({ session_id: id }));
  session.on('delta', ({ text }) => toRenderer('assistant-chat', { type: 'delta', text }));
  session.on('tool', ({ name }) => toRenderer('assistant-chat', { type: 'tool', name }));
  session.on('message', ({ text }) => { assistant.appendChat({ role: 'assistant', text }); toRenderer('assistant-chat', { type: 'message', text }); });
  session.on('idle', ({ error }) => { if (error) assistant.appendChat({ role: 'note', text: `⚠️ ${error}` }); toRenderer('assistant-chat', { type: 'idle', error }); sendAssistant(); });
  session.on('exit', ({ error }) => {
    // A session that cannot be resumed (or crashed) is dropped; the memory files carry on.
    if (error) { assistant.tick({ session_id: null }); assistant.appendChat({ role: 'note', text: `⚠️ ${assistant.config().name} stopped: ${error.split('\n').pop()}` }); }
    toRenderer('assistant-chat', { type: 'idle', error });
    sendAssistant();
  });
  return assistant;
}
function sendAssistant() {
  if (process.env.OFFICE_FIXTURE) return toRenderer('assistant', require('./fixture').assistant());
  toRenderer('assistant', ensureAssistant().view(session));
}
function assistantClock() {
  if (process.env.OFFICE_FIXTURE) return sendAssistant();
  if (process.env.OFFICE_SCREENSHOT) return; // a screenshot never starts a real session
  const store = ensureAssistant();
  if (runAssistant({ store, session }) !== 'none') toRenderer('assistant-chat', { type: 'history', chat: store.chat() });
  sendAssistant();
}

const STRUCTURE_EVENTS = [
  'workspace.created', 'workspace.updated', 'workspace.metadata_updated',
  'workspace.renamed', 'workspace.moved', 'workspace.reordered',
  'workspace.closed', 'workspace.focused',
  'worktree.created', 'worktree.opened', 'worktree.removed',
  'tab.created', 'tab.closed', 'tab.focused', 'tab.renamed', 'tab.moved',
  'pane.created', 'pane.closed', 'pane.updated', 'pane.focused',
  'pane.moved', 'pane.exited', 'pane.agent_detected',
].map((type) => ({ type }));

let structureSub = null;
let statusSub = null;
let statusSubKey = '';
let refreshTimer = null;
let lastGood = null;
// Autostart: the setting lives in the renderer and arrives over IPC.
const autostart = { enabled: null, starting: false, lastAttemptAt: null, failed: null };

function send(payload) {
  if (process.env.OFFICE_DEBUG) console.log('[debug] send snapshot ok=%s agents=%s win=%s', payload.ok, payload.snapshot?.agents?.length, !!win && !win.isDestroyed());
  if (win && !win.isDestroyed()) win.webContents.send('snapshot', payload);
}

// The poll and herdr events both refresh, and listing worktrees takes a few
// hundred ms: overlapping refreshes could send an older snapshot last.
const refresh = coalesce(refreshOnce);

async function refreshOnce() {
  if (process.env.OFFICE_DEBUG) console.log('[debug] refresh +%dms', Date.now() - t0);
  if (process.env.OFFICE_FIXTURE) {
    send({ ok: true, snapshot: require('./fixture').snapshot(), worktrees: require('./fixture').worktrees(), orchestrators: ensureOrchestrators().list(), at: Date.now() });
    return;
  }
  try {
    const askedAt = Date.now();
    const result = await client.request('session.snapshot');
    const snapshot = result.snapshot;
    lastGood = snapshot;
    ensureStatusSubscription(snapshot);
    const worktrees = await worktreeLister.list(snapshot);
    const store = ensureOrchestrators();
    const archived = await store.reconcile(snapshot, askedAt);
    // The Slack watchers' clock. Not awaited: starting a watcher can take a minute.
    runSlack({ store, client, snapshot }).catch((err) => console.warn(`slack: ${err.message || err}`));
    send({ ok: true, snapshot, worktrees, orchestrators: store.list(), archived, at: Date.now() });
  } catch (err) {
    await maybeStartHerdr(err.code);
    send({ ok: false, error: String(err.message || err), snapshot: lastGood, herdr: herdrStatus(), at: Date.now() });
  }
}

function herdrStatus() {
  if (autostart.starting) return { starting: true };
  if (autostart.failed) return { failed: autostart.failed };
  return null;
}

async function maybeStartHerdr(code) {
  if (devUserData) return;
  if (!(await shouldAutostart({ ...autostart, code, everAnswered: lastGood !== null, now: Date.now(), socketPath: client.socketPath }))) return;
  // The lsof check can take seconds: the setting may have been turned off, or another try begun, meanwhile.
  if (autostart.enabled !== true || autostart.starting) return;
  Object.assign(autostart, { starting: true, lastAttemptAt: Date.now(), failed: null });
  startHerdrServer({ bin: resolveHerdr(), socketPath: client.socketPath, logFile: path.join(app.getPath('userData'), 'herdr-autostart.log') })
    .catch((err) => { autostart.failed = String(err.message || err); })
    .finally(() => { autostart.starting = false; refresh(); });
}

function scheduleRefresh(delay = 120) {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, delay);
}

function ensureStructureSubscription() {
  if (structureSub) return;
  structureSub = client.subscribe(STRUCTURE_EVENTS, {
    onEvent: () => scheduleRefresh(),
    onClose: () => {
      structureSub = null;
      setTimeout(ensureStructureSubscription, 1500);
      scheduleRefresh();
    },
  });
}

// Agent status changes are per-pane subscriptions, so rebuild the
// subscription whenever the set of agent panes changes.
function ensureStatusSubscription(snapshot) {
  const paneIds = (snapshot.agents || []).map((a) => a.pane_id).sort();
  const key = paneIds.join(',');
  if (key === statusSubKey && statusSub) return;
  statusSub?.close();
  statusSub = null;
  statusSubKey = key;
  if (paneIds.length === 0) return;
  const subs = paneIds.map((pane_id) => ({ type: 'pane.agent_status_changed', pane_id }));
  statusSub = client.subscribe(subs, {
    onEvent: () => scheduleRefresh(),
    onClose: () => { statusSub = null; statusSubKey = ''; scheduleRefresh(1000); },
  });
}

// assets/icon.png is rendered from assets/icon.svg by `npm run icon`.
const ICON = path.join(__dirname, 'assets', 'icon.png');

const t0 = Date.now();
function createWindow() {
  // Screenshot runs render in a hidden window so they never steal focus or
  // clicks from whatever the user is doing.
  const headless = !!process.env.OFFICE_SCREENSHOT;
  win = new BrowserWindow({
    show: !headless,
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    title: APP_NAME,
    icon: ICON, // Linux/Windows; macOS uses the dock icon set below
    backgroundColor: '#1b1e2b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--office-app-name=${APP_NAME}`],
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Nothing web-shaped opens inside the app: new windows and navigations away
  // from index.html go to the user's browser (web URLs only) and are dropped here.
  const toBrowser = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {}); };
  win.webContents.setWindowOpenHandler(({ url }) => { toBrowser(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => {
    if (url === win.webContents.getURL()) return;
    event.preventDefault();
    toBrowser(url);
  });
  win.webContents.on('did-finish-load', () => {
    if (process.env.OFFICE_DEBUG) console.log('[debug] did-finish-load +%dms', Date.now() - t0);
    refresh();
    assistantClock();
    // OFFICE_SCREENSHOT=/path/out.png captures the window and quits. Timed from
    // page load: a cold start can take seconds before the renderer exists.
    if (process.env.OFFICE_SCREENSHOT) {
      setTimeout(async () => {
        // A hidden window may not have painted yet; poke layout and repaint first.
        await win.webContents.executeJavaScript('document.body.offsetHeight');
        win.webContents.invalidate();
        await new Promise((r) => setTimeout(r, 300));
        const img = await win.webContents.capturePage();
        require('node:fs').writeFileSync(process.env.OFFICE_SCREENSHOT, img.toPNG());
        app.quit();
      }, process.env.OFFICE_OPEN || process.env.OFFICE_TOOLTIP ? 4000 : (process.env.OFFICE_MODAL || process.env.OFFICE_DEBUG) ? 2500 : 1500);
    }
  });
  win.webContents.on('console-message', (event, legacyLevel, legacyMessage, legacyLine, legacySource) => {
    // Electron >= 32 passes a single details object; older versions pass positional args.
    const level = typeof event.level === 'string' ? event.level : ({ 0: 'verbose', 1: 'info', 2: 'warning', 3: 'error' }[legacyLevel] || 'info');
    const message = event.message ?? legacyMessage;
    const where = `${event.sourceId ?? legacySource}:${event.lineNumber ?? legacyLine}`;
    if (level === 'warning' || level === 'error') console.error(`[renderer:${level}] ${message} (${where})`);
  });
  if (process.env.OFFICE_DEBUG) {
    setTimeout(async () => {
      const info = await win.webContents.executeJavaScript(`JSON.stringify({
        office: typeof window.office, settings: typeof window.officeSettings, terminal: typeof window.officeTerminal,
        floors: document.querySelectorAll('.floor').length, conn: document.getElementById('conn').textContent,
        errors: window.__errors || null, scale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'),
        modalHidden: document.getElementById('modal').hidden, modalTitle: document.getElementById('modal-title').textContent,
      })`);
      console.log('[debug]', info);
    }, 6000);
  }
}

ipcMain.handle('refresh', () => refresh());
// The assistant: settings from the renderer, a reminder seen, the chat.
const assistantCall = (fn) => {
  if (process.env.OFFICE_FIXTURE) return { ok: true };
  try { const r = fn(ensureAssistant()); sendAssistant(); return { ok: true, ...(r || {}) }; } catch (err) { return { ok: false, error: String(err.message || err) }; }
};
ipcMain.handle('assistant-configure', (_e, patch) => assistantCall((a) => {
  const before = a.config().name;
  const config = a.configure(patch);
  if (config.enabled === false) session.stop();
  // A new name: the brief says it from the next message on.
  if (config.name !== before) {
    a.prepare();
    a.appendChat({ role: 'note', text: `🐦 ${before} is now called ${config.name}` });
    toRenderer('assistant-chat', { type: 'history', chat: a.chat() });
  }
  return { config };
}));
ipcMain.handle('assistant-dismiss', (_e, { file }) => assistantCall((a) => a.dismissReminder(file)));
ipcMain.handle('assistant-seen', () => assistantCall((a) => a.markMorningSeen()));
ipcMain.handle('assistant-history', () => (process.env.OFFICE_FIXTURE ? require('./fixture').assistantChat() : ensureAssistant().chat()));
ipcMain.handle('assistant-office', (_e, markdown) => assistantCall((a) => a.writeOffice(markdown)));
ipcMain.handle('assistant-send', (_e, text) => assistantCall((a) => {
  const t = String(text || '').trim();
  if (!t) return;
  a.appendChat({ role: 'user', text: t });
  if (!session.running) { a.prepare(); session.start(a.readState().session_id || null); a.tick({ started_at: Date.now() }); }
  session.send(t);
}));

// Turning it back on allows another try right away.
ipcMain.handle('herdr-autostart-set', (_e, { enabled }) => {
  if (enabled && autostart.enabled !== true) autostart.lastAttemptAt = null;
  autostart.enabled = !!enabled;
  if (!enabled) autostart.failed = null;
  return refresh();
});
// Dev aids, pulled by the renderer at startup (pushing on a timer raced the page load):
// OFFICE_DEV_SETTINGS='{"theme":"ocean"}' settings patch; OFFICE_MODAL=<create|closed|remove|orchestrator|archived>
// opens that dialog; OFFICE_OPEN=<pane_id> opens a desk's terminal; OFFICE_TOOLTIP=<pane_id> shows
// its tooltip; OFFICE_SETTINGS_OPEN=1 opens the settings window; OFFICE_CHAT=1 the assistant's chat;
// OFFICE_WELCOME=<step> opens the welcome tour at that step (screenshot runs skip it otherwise).
ipcMain.handle('dev-settings-get', () => (process.env.OFFICE_DEV_SETTINGS ? JSON.parse(process.env.OFFICE_DEV_SETTINGS) : null));
ipcMain.handle('dev-triggers-get', () => ({
  modal: process.env.OFFICE_MODAL || null, open: process.env.OFFICE_OPEN || null,
  tooltip: process.env.OFFICE_TOOLTIP || null, settingsOpen: !!process.env.OFFICE_SETTINGS_OPEN, chatOpen: !!process.env.OFFICE_CHAT,
  welcome: process.env.OFFICE_WELCOME || null, screenshot: !!process.env.OFFICE_SCREENSHOT,
}));
ipcMain.handle('focus-pane', (_e, paneId) => client.request('pane.focus', { pane_id: paneId }));
ipcMain.handle('read-pane', async (_e, paneId, lines = 8) => {
  try {
    const r = await client.request('pane.read', { pane_id: paneId, source: 'visible', lines, strip_ansi: true });
    return { ok: true, text: r.read?.text ?? '' };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// Worktree management. Every call answers { ok, error? } and triggers a refresh.
async function wt(fn) {
  try { const result = await fn(); scheduleRefresh(50); return { ok: true, result }; }
  catch (err) { scheduleRefresh(50); return { ok: false, error: String(err.message || err) }; }
}
// Orchestrators: create and restore (with progress lines), close, prompt the boss.
ipcMain.handle('orchestrator-create', async (_e, spec) => {
  try {
    const json = await ensureOrchestrators().create(spec, (line) => toRenderer('orchestrator-progress', { line }));
    scheduleRefresh(50);
    return { ok: true, orchestrator: json };
  } catch (err) { scheduleRefresh(50); return { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('orchestrator-close', (_e, { slug, mode, message, worktrees, workerPanes }) =>
  wt(() => ensureOrchestrators().close(slug, { mode, message, worktrees: worktrees || [], workerPanes: workerPanes || [] }, lastGood,
    (line) => toRenderer('orchestrator-progress', { line }))));
ipcMain.handle('orchestrator-worktree-status', async (_e, { worktrees }) => {
  try { return { ok: true, status: await ensureOrchestrators().worktreeStatus(worktrees || []) }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('orchestrator-worktree-branches', async (_e, { root }) => {
  try { return { ok: true, branches: await ensureOrchestrators().worktreeBranches(root) }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('orchestrator-prompt', (_e, { slug, text, question, next }) =>
  wt(() => ensureOrchestrators().promptBoss(slug, text, question || null, next || null)));
ipcMain.handle('orchestrator-decline-next', (_e, { slug, text }) => wt(() => ensureOrchestrators().declineNext(slug, text)));
ipcMain.handle('orchestrator-dismiss-alert', (_e, { slug, file }) => wt(() => ensureOrchestrators().dismissAlert(slug, file)));
ipcMain.handle('slack-add-watch', (_e, { slug, text }) => wt(() => ensureOrchestrators().addWatch(slug, text)));
ipcMain.handle('slack-remove-watch', (_e, { slug, target }) => wt(() => ensureOrchestrators().removeWatch(slug, target)));
ipcMain.handle('slack-dismiss', (_e, { slug, file }) => wt(() => ensureOrchestrators().dismissWaiting(slug, file)));
ipcMain.handle('slack-set-interval', (_e, { slug, minutes }) => wt(() => ensureOrchestrators().setSlackInterval(slug, minutes)));
// Fixture runs leave the shipped orchestrator.json alone, so the ticket stays new in screenshots.
ipcMain.handle('slack-seen', (_e, { slug }) => (process.env.OFFICE_FIXTURE ? { ok: true } : wt(() => ensureOrchestrators().markSlackSeen(slug))));
ipcMain.handle('orchestrator-list', () => ensureOrchestrators().list());
ipcMain.handle('orchestrator-list-archived', () => ensureOrchestrators().listArchived());
ipcMain.handle('orchestrator-restore', async (_e, { id, qa, instructions }) => {
  try {
    const json = await ensureOrchestrators().restore(id, { qa: !!qa, instructions: String(instructions || '') }, (line) => toRenderer('orchestrator-progress', { line }));
    scheduleRefresh(50);
    return { ok: true, orchestrator: json };
  } catch (err) { scheduleRefresh(50); return { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('orchestrator-set-qa', (_e, { enabled }) => { ensureOrchestrators().setQa(!!enabled); return { ok: true }; });
ipcMain.handle('orchestrator-rename', (_e, { slug, name }) => wt(() => ensureOrchestrators().rename(slug, name)));
ipcMain.handle('orchestrator-claim-branch', (_e, { slug, branch }) => wt(() => ensureOrchestrators().claimBranch(slug, branch)));
ipcMain.handle('orchestrator-set-people', (_e, { people }) => { ensureOrchestrators().setPeople(people || {}); return { ok: true }; });
ipcMain.handle('orchestrator-set-instructions', (_e, { text }) => { ensureOrchestrators().setInstructions(String(text || '')); return { ok: true }; });
ipcMain.handle('scan-repos', (_e, { root }) => {
  try { return { ok: true, repos: ensureOrchestrators().scanRepos(root) }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});

// Open a repo (any directory) as a new workspace; herdr detects the git checkout.
ipcMain.handle('workspace-create', (_e, { cwd, label }) =>
  wt(() => client.request('workspace.create', { cwd, label: label || null, focus: true })));
ipcMain.handle('pick-folder', async (_e, { defaultPath } = {}) => {
  const r = await dialog.showOpenDialog(win, { title: 'Open repo', properties: ['openDirectory', 'createDirectory'], defaultPath: defaultPath || undefined });
  return r.canceled || !r.filePaths?.length ? null : r.filePaths[0];
});
ipcMain.handle('worktree-open', (_e, { workspace_id, path }) =>
  wt(() => client.request('worktree.open', { workspace_id, path, focus: true })));
ipcMain.handle('worktree-create', (_e, { workspace_id, branch, base }) =>
  wt(() => client.request('worktree.create', { workspace_id, branch, base: base || null, focus: true })));
ipcMain.handle('workspace-close', (_e, { workspace_id }) =>
  wt(() => client.request('workspace.close', { workspace_id })));
ipcMain.handle('worktree-remove', (_e, { workspace_id, force }) =>
  wt(() => client.request('worktree.remove', { workspace_id, force: !!force })));
// A closed worktree has no workspace to point remove at: open it quietly first.
ipcMain.handle('worktree-remove-path', (_e, { source_workspace_id, path, force }) =>
  wt(async () => {
    const opened = await client.request('worktree.open', { workspace_id: source_workspace_id, path, focus: false });
    const id = opened.workspace?.workspace_id;
    if (!id) throw new Error('could not open worktree before removing it');
    return client.request('worktree.remove', { workspace_id: id, force: !!force });
  }));

// What is on the clipboard right now. The terminal panel uses this to decide
// whether a paste is text (send the text) or an image (send Ctrl+V so the
// agent reads the image from the clipboard itself, like it does in a terminal).
// Links clicked in the terminal panel open in the browser. Only web URLs:
// anything else the renderer could be tricked into sending stays closed.
ipcMain.handle('open-external', (_e, url) => {
  if (!/^https?:\/\//i.test(String(url))) return { ok: false, error: 'not a web URL' };
  return shell.openExternal(String(url)).then(() => ({ ok: true }), (err) => ({ ok: false, error: String(err.message || err) }));
});
// Open a checkout folder in the user's editor (command from settings).
ipcMain.handle('open-in-editor', async (_e, { editor, folder }) => {
  try { await openInEditor({ editor, folder }); return { ok: true }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});

// The PR of the branch checked out in a folder, via the GitHub CLI.
ipcMain.handle('pr-find', async (_e, { folder }) => {
  try { return { ok: true, pr: await findPullRequest(folder) }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});

ipcMain.handle('clipboard-peek', () => {
  const text = clipboard.readText();
  const hasImage = !clipboard.readImage().isEmpty();
  return { hasText: text.length > 0, hasImage, text };
});

// Pane management: new shell desk, close a desk, start an agent at a desk.
ipcMain.handle('pane-create', (_e, { workspace_id }) => wt(() => client.request('tab.create', { workspace_id, focus: false })));
ipcMain.handle('pane-rename', (_e, { pane_id, label }) => wt(() => client.request('pane.rename', { pane_id, label: label || null })));
ipcMain.handle('pane-close', (_e, { pane_id }) => wt(() => client.request('pane.close', { pane_id })));
ipcMain.handle('pane-process-info', async (_e, { pane_id }) => {
  try { const r = await client.request('pane.process_info', { pane_id }); return { ok: true, info: r.process_info }; }
  catch (err) { return { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('agent-start', (_e, { pane_id, name, kind }) =>
  wt(() => client.request('agent.start', { pane_id, name, kind: AGENT_KINDS.includes(kind) ? kind : 'claude', timeout_ms: 60000 })));

ipcMain.handle('term-open', (_e, opts) => terminals.open(opts));
ipcMain.on('term-input', (_e, { id, data }) => terminals.input(id, data));
ipcMain.on('term-resize', (_e, { id, cols, rows }) => terminals.resize(id, cols, rows));
ipcMain.on('term-scroll', (_e, { id, direction, lines }) => terminals.scroll(id, direction, lines));
ipcMain.handle('term-close', (_e, id) => terminals.close(id));

app.on('second-instance', () => { if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock && require('node:fs').existsSync(ICON)) app.dock.setIcon(ICON);
  createWindow();
  ensureStructureSubscription();
  // Fallback poll in case an event slips past the subscriptions.
  setInterval(refresh, 3000);
  // The assistant's clock: reminders, the morning brief and dreaming.
  setInterval(assistantClock, 30_000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { terminals.closeAll(); session?.stop(); });
