// A bare "origin" and a clone of it in a temp folder, for the updater and launch tests.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'init.defaultBranch=main', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function repos(files = { 'main.js': 'one\n', 'renderer/app.js': 'one\n', 'package-lock.json': '{"packages":{"node_modules/electron":{"version":"45.0.0"}}}\n' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-update-'));
  const origin = path.join(dir, 'origin.git');
  const work = path.join(dir, 'work');
  const checkout = path.join(dir, 'root', 'app');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  git(work, 'remote', 'add', 'origin', origin);
  const commit = (changes, message = 'change') => {
    for (const [f, text] of Object.entries(changes)) {
      fs.mkdirSync(path.dirname(path.join(work, f)), { recursive: true });
      fs.writeFileSync(path.join(work, f), text);
    }
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', message);
    git(work, 'push', '-q', 'origin', 'main');
    return git(work, 'rev-parse', 'HEAD');
  };
  const first = commit(files, 'first');
  fs.mkdirSync(path.dirname(checkout), { recursive: true });
  execFileSync('git', ['clone', '-q', '--branch', 'main', origin, checkout]);
  return { dir, origin, work, checkout, root: path.dirname(checkout), first, commit, head: () => git(checkout, 'rev-parse', 'HEAD'), git };
}

module.exports = { repos, git };
