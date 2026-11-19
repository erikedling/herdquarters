// live: reload the window; restart, deps, bootstrap, shell: applied by shell/bootstrap.js at the next launch. See docs/GUIDE.md.
const { execFile } = require('node:child_process');
const { electronMajor } = require('./shell/rebuild');

const LIVE = /^(renderer\/|docs\/|test\/|\.github\/|README\.md$|CONTRIBUTING\.md$|LICENSE$|SECURITY\.md$|\.gitignore$)/;
// Under renderer/ but also required by the main process; test/main-graph.test.js keeps this list complete.
const MAIN_LOADS = new Set(['renderer/note-rows.js']);
const isLive = (f) => LIVE.test(f) && !MAIN_LOADS.has(f);
const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 60 * 60_000;
const READY_TIMEOUT_MS = 30_000;

function classify(files, { electronNow = null, electronNext = null } = {}) {
  if (electronNow !== null && electronNext !== null && electronNow !== electronNext) return 'shell';
  if (files.includes('package-lock.json')) return 'deps';
  if (files.every(isLive)) return 'live';
  return files.some((f) => f.startsWith('shell/')) ? 'bootstrap' : 'restart';
}

function gitIn(cwd) {
  return (args) => new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' } }, (err, stdout, stderr) => {
      if (err) { err.stderr = stderr; reject(err); } else resolve(String(stdout).trim());
    });
  });
}

const lines = (s) => String(s || '').split('\n').filter(Boolean);

class Updater {
  // onStuck: the window did not come back even after a live update was undone; only a restart helps then.
  constructor({ shell, send = () => {}, onStuck = () => {}, electronVersion = process.versions.electron, git = shell ? gitIn(shell.checkout) : null, now = Date.now }) {
    this.onStuck = onStuck;
    this.shell = shell;
    // The bundle's copy, which is what the bootstrap reads and writes state.json with.
    this.launch = shell?.launch || require('./shell/launch');
    this.send = send;
    this.electronNow = Number(String(electronVersion).split('.')[0]);
    this.git = git;
    this.now = now;
    this.timers = [];
    this.busy = null;
    this.awaitingLoad = null;
    this.s = { enabled: !!shell, branch: shell?.branch || 'main', status: 'idle', kind: null, target: null, commits: [], current: null, checkedAt: null, error: null, notice: null };
  }

  view() { return { ...this.s, commits: [...this.s.commits] }; }

  set(patch) {
    Object.assign(this.s, patch);
    this.send(this.view());
  }

  async start({ firstCheckMs = FIRST_CHECK_MS, everyMs = CHECK_EVERY_MS } = {}) {
    if (!this.shell) return;
    this.set({ notice: this.launch.readState(this.shell.root).notice || null, current: await this.describe('HEAD').catch(() => null) });
    this.timers.push(setTimeout(() => this.check(), firstCheckMs));
    this.timers.push(setInterval(() => this.check(), everyMs));
  }

  stop() { for (const t of this.timers) clearTimeout(t); clearTimeout(this.reloadTimer); this.timers = []; }

  async describe(rev) {
    const [sha, date, subject] = (await this.git(['log', '-1', '--format=%h%x09%cI%x09%s', rev])).split('\t');
    return { sha, date, subject };
  }

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
      const state = this.launch.readState(root);
      const current = await this.describe('HEAD');
      const base = { checking: false, checkedAt: this.now(), error: null, current, skipped: null };
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
      const failed = { checking: false, checkedAt: this.now(), error: this.launch.shortError(err) };
      // After a --branch install, the branch is usually deleted when its PR merges.
      if (branch !== 'main' && /couldn't find remote ref/i.test(`${err?.message}\n${err?.stderr}`)) {
        failed.error = `The branch ${branch} is gone, probably merged. Run npm run install-app -- --reset to go back to main.`;
        if (!['pending', 'restart', 'applying'].includes(this.s.status)) Object.assign(failed, { status: 'gone', kind: null, target: null, commits: [] });
      }
      this.set(failed);
    }
    return this.view();
  }

  // Restart kinds are not checked out yet: main.js reads some files lazily and must not see a mix.
  async apply(target) {
    if (!this.shell || this.s.status !== 'available' || target !== this.s.target) return { ok: false, error: 'nothing to apply' };
    const { root, branch = 'main' } = this.shell;
    if (this.s.kind !== 'live') {
      this.launch.updateState(root, { pending: target });
      this.set({ status: 'restart', applyError: null });
      return { ok: true, restart: true };
    }
    this.set({ status: 'applying', applyError: null });
    try {
      if (await this.git(['status', '--porcelain', '--untracked-files=no'])) throw new Error(`the app's checkout at ${this.shell.checkout} has local changes; npm run install-app -- --reset starts it over`);
      if (!(await this.git(['merge-base', '--is-ancestor', 'HEAD', target]).then(() => true, () => false))) {
        throw new Error(`the app's checkout has commits that ${target.slice(0, 7)} does not; npm run install-app -- --reset starts it over`);
      }
      this.previous = await this.git(['rev-parse', 'HEAD']);
      await this.git(['checkout', '-q', '-B', branch, target]);
    } catch (err) {
      this.set({ status: 'available', applyError: this.launch.shortError(err) });
      return { ok: false, error: this.s.applyError };
    }
    this.awaitingLoad = target;
    return { ok: true, reload: true };
  }

  // After a live update's reload: no ready message in time puts the previous commit back and reloads again.
  watchReload(reload, ms = READY_TIMEOUT_MS) {
    clearTimeout(this.reloadTimer);
    this.readyMs = ms;
    this.reloadTimer = setTimeout(() => this.revertLive(reload).catch(() => this.onStuck()), ms);
  }

  async revertLive(reload) {
    const target = this.awaitingLoad;
    if (!this.shell || !target) return;
    const { root, branch = 'main' } = this.shell;
    this.awaitingLoad = null;
    await this.git(['checkout', '-q', '-B', branch, this.previous]);
    const notice = { kind: 'rolledBack', from: target, to: this.previous, error: 'the window did not come up after the update', at: this.now() };
    this.launch.updateState(root, { bad: target, notice });
    this.set({ status: 'current', kind: null, target: null, commits: [], notice });
    this.reloadTimer = setTimeout(() => this.onStuck(), this.readyMs ?? READY_TIMEOUT_MS);
    reload();
  }

  async loaded() {
    clearTimeout(this.reloadTimer);
    if (!this.shell || !this.awaitingLoad) return;
    this.launch.markGood(this.shell.root, this.awaitingLoad);
    this.awaitingLoad = null;
    this.set({ status: 'current', kind: null, target: null, commits: [], current: await this.describe('HEAD').catch(() => this.s.current) });
  }

  later() {
    if (this.s.status === 'restart') this.set({ status: 'pending' });
    return this.view();
  }

  dismissNotice() {
    if (this.shell) this.launch.updateState(this.shell.root, { notice: null });
    this.set({ notice: null });
    return this.view();
  }
}

module.exports = { Updater, classify, isLive, LIVE, MAIN_LOADS };
