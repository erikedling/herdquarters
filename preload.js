const { contextBridge, ipcRenderer } = require('electron');

// The preload is sandboxed: only Electron's built-ins can be required, so the
// app name arrives as an argument from main.js (webPreferences.additionalArguments).
const appName = (process.argv.find((a) => a.startsWith('--office-app-name=')) || '').slice('--office-app-name='.length);

contextBridge.exposeInMainWorld('office', {
  appName,
  homeDir: process.env.HOME || process.env.USERPROFILE || '',
  onSnapshot: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('snapshot', handler);
    return () => ipcRenderer.removeListener('snapshot', handler);
  },
  refresh: () => ipcRenderer.invoke('refresh'),
  setHerdrAutostart: (enabled) => ipcRenderer.invoke('herdr-autostart-set', { enabled }),
  focusPane: (paneId) => ipcRenderer.invoke('focus-pane', paneId),
  readPane: (paneId, lines) => ipcRenderer.invoke('read-pane', paneId, lines),
  orchestrator: {
    create: (spec) => ipcRenderer.invoke('orchestrator-create', spec),
    close: (args) => ipcRenderer.invoke('orchestrator-close', args),
    prompt: (args) => ipcRenderer.invoke('orchestrator-prompt', args),
    list: () => ipcRenderer.invoke('orchestrator-list'),
    listArchived: () => ipcRenderer.invoke('orchestrator-list-archived'),
    restore: (args) => ipcRenderer.invoke('orchestrator-restore', args),
    setQa: (enabled) => ipcRenderer.invoke('orchestrator-set-qa', { enabled }),
    declineNext: (args) => ipcRenderer.invoke('orchestrator-decline-next', args),
    dismissAlert: (args) => ipcRenderer.invoke('orchestrator-dismiss-alert', args),
    setPeople: (people) => ipcRenderer.invoke('orchestrator-set-people', { people }),
    claimBranch: (args) => ipcRenderer.invoke('orchestrator-claim-branch', args),
    rename: (args) => ipcRenderer.invoke('orchestrator-rename', args),
    setInstructions: (text) => ipcRenderer.invoke('orchestrator-set-instructions', { text }),
    scanRepos: (root) => ipcRenderer.invoke('scan-repos', { root }),
    worktreeStatus: (worktrees) => ipcRenderer.invoke('orchestrator-worktree-status', { worktrees }),
    worktreeBranches: (root) => ipcRenderer.invoke('orchestrator-worktree-branches', { root }),
    onProgress: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('orchestrator-progress', h); return () => ipcRenderer.removeListener('orchestrator-progress', h); },
    onChange: (cb) => { const h = (_e, list) => cb(list); ipcRenderer.on('orchestrators', h); return () => ipcRenderer.removeListener('orchestrators', h); },
  },
  slack: {
    addWatch: (args) => ipcRenderer.invoke('slack-add-watch', args),
    removeWatch: (args) => ipcRenderer.invoke('slack-remove-watch', args),
    dismiss: (args) => ipcRenderer.invoke('slack-dismiss', args),
    setInterval: (args) => ipcRenderer.invoke('slack-set-interval', args),
    seen: (args) => ipcRenderer.invoke('slack-seen', args),
  },
  assistant: {
    configure: (patch) => ipcRenderer.invoke('assistant-configure', patch),
    dismiss: (args) => ipcRenderer.invoke('assistant-dismiss', args),
    seen: () => ipcRenderer.invoke('assistant-seen'),
    history: () => ipcRenderer.invoke('assistant-history'),
    send: (text) => ipcRenderer.invoke('assistant-send', text),
    office: (markdown) => ipcRenderer.invoke('assistant-office', markdown),
    onState: (cb) => ipcRenderer.on('assistant', (_e, state) => cb(state)),
    onChat: (cb) => ipcRenderer.on('assistant-chat', (_e, ev) => cb(ev)),
  },
  workspace: {
    create: (args) => ipcRenderer.invoke('workspace-create', args),
    pickFolder: (args) => ipcRenderer.invoke('pick-folder', args || {}),
  },
  worktree: {
    open: (args) => ipcRenderer.invoke('worktree-open', args),
    create: (args) => ipcRenderer.invoke('worktree-create', args),
    close: (args) => ipcRenderer.invoke('workspace-close', args),
    remove: (args) => ipcRenderer.invoke('worktree-remove', args),
    removePath: (args) => ipcRenderer.invoke('worktree-remove-path', args),
  },
  devSettings: () => ipcRenderer.invoke('dev-settings-get'),
  devTriggers: () => ipcRenderer.invoke('dev-triggers-get'),
  clipboardPeek: () => ipcRenderer.invoke('clipboard-peek'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openInEditor: (args) => ipcRenderer.invoke('open-in-editor', args),
  findPullRequest: (args) => ipcRenderer.invoke('pr-find', args),
  pane: {
    create: (args) => ipcRenderer.invoke('pane-create', args),
    close: (args) => ipcRenderer.invoke('pane-close', args),
    rename: (args) => ipcRenderer.invoke('pane-rename', args),
    processInfo: (args) => ipcRenderer.invoke('pane-process-info', args),
    startAgent: (args) => ipcRenderer.invoke('agent-start', args),
  },
  term: {
    open: (opts) => ipcRenderer.invoke('term-open', opts),
    input: (id, data) => ipcRenderer.send('term-input', { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send('term-resize', { id, cols, rows }),
    scroll: (id, direction, lines) => ipcRenderer.send('term-scroll', { id, direction, lines }),
    close: (id) => ipcRenderer.invoke('term-close', id),
    onData: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('term-data', h); return () => ipcRenderer.removeListener('term-data', h); },
    onExit: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('term-exit', h); return () => ipcRenderer.removeListener('term-exit', h); },
  },
});
