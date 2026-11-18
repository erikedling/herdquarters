// npm run install-app: sets up the Dock app. Clones the repo into a checkout
// the app owns (never this one), installs its run-time packages and builds
// Herdquarters.app around it. Run it again to rebuild the app; the checkout,
// the app's update state and the data folder are kept.
//   --out <path>     the app (default ~/Applications/Herdquarters.app)
//   --root <dir>     the app's own folder (default ~/Library/Application Support/Herdquarters)
//   --remote <url>   what the checkout tracks (default: this repo's origin)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { makeApp, args } = require('./make-app');
const { npmCi } = require('../shell/launch');
const { electronMajor } = require('../shell/rebuild');

const repo = path.join(__dirname, '..');
const run = (cmd, argv, opts = {}) => execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opts }).trim();

function main() {
  const a = args(process.argv.slice(2));
  const root = path.resolve(a.root || path.join(os.homedir(), 'Library', 'Application Support', 'Herdquarters'));
  const out = path.resolve(a.out || path.join(os.homedir(), 'Applications', 'Herdquarters.app'));
  const checkout = path.join(root, 'app');
  const remote = a.remote || run('git', ['-C', repo, 'remote', 'get-url', 'origin']);

  if (!fs.existsSync(path.join(checkout, '.git'))) {
    console.log(`cloning ${remote} into ${checkout}`);
    fs.mkdirSync(root, { recursive: true });
    run('git', ['clone', '--quiet', '--branch', 'main', remote, checkout], { stdio: 'inherit' });
  } else {
    console.log(`keeping the checkout at ${checkout}`);
  }
  console.log('installing its packages');
  npmCi(checkout);

  const lock = (dir) => { try { return electronMajor(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8')); } catch { return null; } };
  if (lock(repo) !== lock(checkout)) {
    console.warn(`warning: this checkout has Electron ${lock(repo)}, the app's checkout wants ${lock(checkout)}; the app rebuilds itself on first launch`);
  }
  makeApp({ out, root, checkout, shellSrc: path.join(checkout, 'shell') });
  console.log(`\nbuilt ${out}\nQuit Herdquarters if it is running (npm start), open the app, and drag it to the Dock to keep it there.`);
}

try {
  main();
} catch (err) {
  console.error(`install-app: ${err.message}`);
  process.exit(1);
}
