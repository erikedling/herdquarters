// Updates for the Dock app (see shell/). Fetches the tracked branch, sorts what
// came in by what applying it takes, and applies it:
//   live     only the renderer and files the app never reads: check out and reload the window
//   restart  anything main.js or preload.js loads: checked out at the next launch
//   deps     package-lock.json changed: as restart, with npm ci at that launch
//   shell    another Electron major: as restart, and the .app rebuilds itself at that launch
// Under `npm start` there is no shell and the updater stays off.
const { execFile } = require('node:child_process');
const launch = require('./shell/launch');
const { electronMajor } = require('./shell/rebuild');

const LIVE = /^(renderer\/|docs\/|test\/|\.github\/|\.pr-media\/|README\.md$|CONTRIBUTING\.md$|LICENSE$|SECURITY\.md$|\.gitignore$)/;
const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 60 * 60_000;

function classify(files, { electronNow = null, electronNext = null } = {}) {
  if (electronNow !== null && electronNext !== null && electronNow !== electronNext) return 'shell';
  if (files.includes('package-lock.json')) return 'deps';
  return files.every((f) => LIVE.test(f)) ? 'live' : 'restart';
}

function gitIn(cwd) {
  return (args) => new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; reject(err); } else resolve(String(stdout).trim());
    });
  });
}

const lines = (s) => String(s || '').split('\n').filter(Boolean);

class Updater {
  constructor({ shell, send = () => {}, electronVersion = process.versions.electron, git = shell ? gitIn(shell.checkout) : null, now = Date.now }) {
    this.shell = shell;
    this.send = send;
    this.electronNow = Number(String(electronVersion).split('.')[0]);
    this.git = git;
    this.now = now;
    this.timers = [];
    this.busy = null;
    this.awaitingLoad = null;
    this.s = { enabled: !!shell, status: 'idle', kind: null, target: null, commits: [], current: null, checkedAt: null, error: null, notice: null };
  }

  view() { return { ...this.s, commits: [...this.s.commits] }; }

  set(patch) {
    Object.assign(this.s, patch);
    this.send(this.view());
  }

  async start({ firstCheckMs = FIRST_CHECK_MS, everyMs = CHECK_EVERY_MS } = {}) {
    if (!this.shell) return;
    this.set({ notice: launch.readState(this.shell.root).notice || null, current: await this.describe('HEAD').catch(() => null) });
    this.timers.push(setTimeout(() => this.check(), firstCheckMs));
    this.timers.push(setInterval(() => this.check(), everyMs));
  }

  stop() { for (const t of this.timers) clearTimeout(t); this.timers = []; }

  async describe(rev) {
    const [sha, date, subject] = (await this.git(['log', '-1', '--format=%h%x09%cI%x09%s', rev])).split('\t');
    return { sha, date, subject };
  }

  // A check that fails keeps what the last one found; the settings row shows the error.
  check() {
    if (!this.shell) return Promise.resolve(this.view());
    if (this.s.status === 'applying') return Promise.resolve(this.view());
    if (!this.busy) this.busy = this.checkNow().finally(() => { this.busy = null; });
    return this.busy;
  }

  async checkNow() {
    const { root, branch = 'main' } = this.shell;
    this.set({ checking: true });
    try {
      await this.git(['fetch', '--quiet', 'origin', branch]);
      const head = await this.git(['rev-parse', 'HEAD']);
      const target = await this.git(['rev-parse', `refs/remotes/origin/${branch}`]);
      const state = launch.readState(root);
      const current = await this.describe('HEAD');
      const base = { checking: false, checkedAt: this.now(), error: null, current };
      if (target === head || target === state.bad) {
        this.set({ ...base, status: 'current', kind: null, target: null, commits: [], skipped: target === state.bad ? state.bad : null });
      } else if (target === state.pending) {
        this.set({ ...base, status: this.s.status === 'pending' ? 'pending' : 'restart', target });
      } else {
        const commits = lines(await this.git(['log', '--format=%h%x09%s', `${head}..${target}`])).map((l) => {
          const [sha, ...rest] = l.split('\t');
          return { sha, subject: rest.join('\t') };
        });
        const files = lines(await this.git(['diff', '--name-only', head, target]));
        const lock = await this.git(['show', `${target}:package-lock.json`]).catch(() => '');
        const kind = classify(files, { electronNow: this.electronNow, electronNext: electronMajor(lock) });
        this.set({ ...base, status: 'available', kind, target, commits });
      }
    } catch (err) {
      this.set({ checking: false, checkedAt: this.now(), error: launch.shortError(err) });
    }
    return this.view();
  }

  // Live: check out now; the caller reloads the window. Otherwise record it
  // for the next launch, which shell/bootstrap.js applies before main.js loads.
  async apply(target) {
    if (!this.shell || this.s.status !== 'available' || target !== this.s.target) return { ok: false, error: 'nothing to apply' };
    const { root, branch = 'main' } = this.shell;
    if (this.s.kind !== 'live') {
      launch.updateState(root, { pending: target });
      this.set({ status: 'restart', applyError: null });
      return { ok: true, restart: true };
    }
    this.set({ status: 'applying', applyError: null });
    try {
      if (await this.git(['status', '--porcelain', '--untracked-files=no'])) throw new Error(`the app's checkout at ${this.shell.checkout} has local changes`);
      await this.git(['checkout', '-q', '-B', branch, target]);
    } catch (err) {
      this.set({ status: 'available', applyError: launch.shortError(err) });
      return { ok: false, error: this.s.applyError };
    }
    this.awaitingLoad = target;
    return { ok: true, reload: true };
  }

  // The window finished loading. After a live update that makes the new commit the last good one.
  async loaded() {
    if (!this.shell || !this.awaitingLoad) return;
    launch.markGood(this.shell.root, this.awaitingLoad);
    this.awaitingLoad = null;
    this.set({ status: 'current', kind: null, target: null, commits: [], current: await this.describe('HEAD').catch(() => this.s.current) });
  }

  later() {
    if (this.s.status === 'restart') this.set({ status: 'pending' });
    return this.view();
  }

  dismissNotice() {
    if (this.shell) launch.updateState(this.shell.root, { notice: null });
    this.set({ notice: null });
    return this.view();
  }
}

module.exports = { Updater, classify, LIVE };
