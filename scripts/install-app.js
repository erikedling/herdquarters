// npm run install-app [-- --out <path> --root <dir> --remote <url> --reset]; see "The Dock app" in docs/GUIDE.md.
//   --out <path>     the app (default ~/Applications/Herdquarters.app)
//   --root <dir>     the app's own folder (default ~/Library/Application Support/Herdquarters)
//   --remote <url>   what the checkout tracks (default: this repo's origin)
//   --reset          put the app's checkout back on origin/main, dropping its local changes and update state
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { makeApp, checkTarget, args } = require('./make-app');
const launch = require('../shell/launch');
const { wantedMajor } = require('../shell/rebuild');

const repo = path.join(__dirname, '..');
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

  if (!fs.existsSync(path.join(checkout, '.git'))) {
    const remote = a.remote || run('git', ['-C', repo, 'remote', 'get-url', 'origin']);
    console.log(`cloning ${remote} into ${checkout}`);
    fs.mkdirSync(root, { recursive: true });
    run('git', ['clone', '--quiet', '--branch', 'main', remote, checkout], { stdio: 'inherit' });
  } else if (a.reset) {
    console.log(`resetting ${checkout} to origin/main`);
    resetCheckout({ root, checkout });
  } else {
    console.log(`keeping the checkout at ${checkout} (--reset puts it back on origin/main)`);
  }
  console.log('installing its packages');
  await launch.installModules(root, checkout);

  if (wantedMajor(repo) !== wantedMajor(checkout)) {
    console.warn(`warning: this checkout has Electron ${wantedMajor(repo)}, the app's checkout wants ${wantedMajor(checkout)}; the app rebuilds itself on first launch`);
  }
  makeApp({ out, root, checkout, shellSrc: path.join(checkout, 'shell') });
  console.log(`\nbuilt ${out}\nQuit Herdquarters if it is running (npm start), open the app, and drag it to the Dock to keep it there.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`install-app: ${launch.shortError(err)}`);
    process.exit(1);
  });
}

module.exports = { resetCheckout };
