// npm run install-app [-- --out <path> --root <dir> --remote <url> --reset]; see "The Dock app" in docs/GUIDE.md.
//   --out <path>     the app (default ~/Applications/Herdquarters.app)
//   --root <dir>     the app's own folder (default ~/Library/Application Support/Herdquarters)
//   --remote <url>   what the checkout tracks (default: the public repo over HTTPS)
//   --branch <name>  the branch it tracks, to try one that is not merged yet (default: main, or the one it already tracks)
//   --reset          put the app's checkout back on origin/main (or --branch), dropping its local changes and update state
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { makeApp, checkTarget, args } = require('./make-app');
const launch = require('../shell/launch');
const { wantedMajor } = require('../shell/rebuild');

const repo = path.join(__dirname, '..');
// HTTPS, so the app's hourly fetch never needs an SSH key in the agent.
const DEFAULT_REMOTE = 'https://github.com/erikedling/herdquarters.git';
const remoteFor = (a) => (typeof a.remote === 'string' && a.remote) || DEFAULT_REMOTE;

function branchFor(a, current) {
  if (a.branch === true) throw new Error('--branch needs a name');
  const asked = a.branch || null;
  if (!current || a.reset) return asked || 'main';
  if (asked && asked !== current) throw new Error(`the app's checkout tracks ${current}; add --reset to switch it to ${asked}`);
  return current;
}

const currentBranch = (checkout) => {
  try { return launch.git(checkout, ['symbolic-ref', '--short', 'HEAD']); } catch { return null; }
};
const run = (cmd, argv, opts = {}) => String(execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }) ?? '').trim();

function resetCheckout({ root, checkout, branch = 'main' }) {
  launch.git(checkout, ['fetch', '--quiet', 'origin', branch]);
  launch.git(checkout, ['checkout', '-q', '-f', '-B', branch, `origin/${branch}`]);
  launch.updateState(root, { pending: null, booting: null, bad: null, notice: null, lastGood: null, rebuildTried: null, modulesFor: null });
}

async function main() {
  const a = args(process.argv.slice(2));
  const root = path.resolve(a.root || path.join(os.homedir(), 'Library', 'Application Support', 'Herdquarters'));
  const out = path.resolve(a.out || path.join(os.homedir(), 'Applications', 'Herdquarters.app'));
  const checkout = path.join(root, 'app');
  checkTarget(out);
  const cloned = fs.existsSync(path.join(checkout, '.git'));
  const branch = branchFor(a, cloned ? currentBranch(checkout) : null);

  if (!cloned) {
    const remote = remoteFor(a);
    console.log(`cloning ${remote} (${branch}) into ${checkout}`);
    fs.mkdirSync(root, { recursive: true });
    run('git', ['clone', '--quiet', '--branch', branch, remote, checkout], { stdio: 'inherit' });
  } else if (a.reset) {
    console.log(`resetting ${checkout} to origin/${branch}`);
    resetCheckout({ root, checkout, branch });
  } else {
    console.log(`keeping the checkout at ${checkout} (--reset puts it back on origin/main)`);
  }
  console.log('installing its packages');
  await launch.installModules(root, checkout);

  if (wantedMajor(repo) !== wantedMajor(checkout)) {
    console.warn(`warning: this checkout has Electron ${wantedMajor(repo)}, the app's checkout wants ${wantedMajor(checkout)}; the app rebuilds itself on first launch`);
  }
  makeApp({ out, root, checkout, branch, shellSrc: path.join(checkout, 'shell') });
  console.log(`\nbuilt ${out}\nQuit Herdquarters if it is running (npm start), open the app, and drag it to the Dock to keep it there.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`install-app: ${launch.shortError(err)}`);
    process.exit(1);
  });
}

module.exports = { resetCheckout, remoteFor, branchFor, DEFAULT_REMOTE };
