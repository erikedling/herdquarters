// An app opened from the Dock gets launchd's PATH (/usr/bin:/bin:/usr/sbin:/sbin),
// and everything it starts inherits it: herdr, PiPi's claude, gh, npm. Ask the
// user's shell once at launch. Interactive as well as login, because tools like
// fnm and ~/.local/bin are often set up in .zshrc only.
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MARK = '__HQ_PATH__';
const FALLBACK = [path.join(os.homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];

const split = (p) => String(p || '').split(':').filter(Boolean);

function loginShellPath({ shell = process.env.SHELL || '/bin/zsh', run = execFileSync, timeoutMs = 5000, env = process.env } = {}) {
  try {
    // Markers, since an interactive shell may print a greeting or a prompt first.
    const out = run(shell, ['-ilc', `printf '%s%s%s' ${MARK} "$PATH" ${MARK}`], {
      encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'], env,
    });
    const m = String(out).match(new RegExp(`${MARK}([^\\n]*?)${MARK}`));
    return m && m[1] ? m[1] : null;
  } catch {
    return null;
  }
}

// The shell's entries first, then whatever the app already had, then the usual install folders.
function mergePath(current, fromShell, extra = FALLBACK) {
  const out = [];
  for (const p of [...split(fromShell), ...split(current), ...extra]) if (!out.includes(p)) out.push(p);
  return out.join(':');
}

function importLoginPath(env = process.env, opts = {}) {
  const fromShell = loginShellPath({ env, ...opts });
  env.PATH = mergePath(env.PATH, fromShell, opts.extra);
  return { path: env.PATH, fromShell: fromShell !== null };
}

module.exports = { loginShellPath, mergePath, importLoginPath, FALLBACK };
