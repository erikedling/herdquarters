// "Open in editor": run the user's editor command with a checkout folder as
// its only argument. The command comes from settings ("code", "cursor -n",
// "/usr/local/bin/zed"); the folder is one herdr told us about. Nothing goes
// through a shell. Electron launched from the Dock has a bare PATH, so the
// usual CLI locations are added before searching it.
const path = require('node:path');

const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', path.join(process.env.HOME || '', '.local/bin')];

// Splits the setting into command and flags. Tokens are plain words, flags or
// an absolute path; anything shell-like is refused so it cannot be smuggled in.
function parseEditor(setting) {
  const tokens = String(setting || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error('No editor set. Put its command in settings, for example "code".');
  for (const t of tokens) {
    if (!/^(\/[^\0]+|[\w.+-]+|--?[\w.=-]+)$/.test(t)) throw new Error(`Editor command has a part I will not run: ${t}`);
  }
  return { cmd: tokens[0], args: tokens.slice(1) };
}

function envWithPath(env = process.env) {
  const have = (env.PATH || '').split(':');
  const extra = EXTRA_PATH.filter((p) => !have.includes(p));
  return { ...env, PATH: [...have, ...extra].filter(Boolean).join(':') };
}

// macOS: an editor CLI hands the folder to the running app, which focuses the
// folder's window but leaves it in the Dock when it is minimized. Known
// editors by bundle id, so the window can be brought back afterwards.
const MAC_APPS = {
  code: 'com.microsoft.VSCode',
  'code-insiders': 'com.microsoft.VSCodeInsiders',
  cursor: 'com.todesktop.230313mzl4w4u92',
  windsurf: 'com.exafunction.windsurf',
  zed: 'dev.zed.Zed',
  subl: 'com.sublimetext.4',
  idea: 'com.jetbrains.intellij',
};
function macAppFor(cmd) { return MAC_APPS[path.basename(cmd)] || null; }

// Un-minimizes the editor windows titled with the folder's name, then brings
// the app to the front. Unminimizing goes through System Events, which needs
// the Accessibility permission; without it the app is still activated.
const RAISE_SCRIPT = `on run argv
  set appId to item 1 of argv
  set folderName to item 2 of argv
  try
    tell application "System Events"
      tell (first process whose bundle identifier is appId)
        repeat with w in windows
          if name of w contains folderName and value of attribute "AXMinimized" of w then set value of attribute "AXMinimized" of w to false
        end repeat
      end tell
    end tell
  end try
  tell application id appId to activate
end run`;

function raiseEditor({ cmd, folder }, { execFile = require('node:child_process').execFile, platform = process.platform } = {}) {
  const appId = macAppFor(cmd);
  if (platform !== 'darwin' || !appId) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile('osascript', ['-e', RAISE_SCRIPT, appId, path.basename(folder)], { timeout: 10000 }, (err) => resolve(!err));
  });
}

// Resolves once the editor is launched; rejects when the setting is bad, the
// folder is missing or the command cannot start (unknown command, not executable).
async function openInEditor({ editor, folder }, { spawn = require('node:child_process').spawn, fs = require('node:fs'), env = process.env, raise = raiseEditor } = {}) {
  const { cmd, args } = parseEditor(editor);
  if (!folder || !path.isAbsolute(folder)) throw new Error('No folder to open.');
  let stat;
  try { stat = fs.statSync(folder); } catch { throw new Error(`Folder is gone: ${folder}`); }
  if (!stat.isDirectory()) throw new Error(`Not a folder: ${folder}`);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args, folder], { detached: true, stdio: 'ignore', env: envWithPath(env) });
    child.once('error', (err) => reject(new Error(err.code === 'ENOENT' ? `Editor command not found: ${cmd}` : err.message)));
    child.once('spawn', () => { child.unref(); resolve(); });
    // The CLI exits once the app has the folder; then the window exists to raise.
    child.once('exit', () => { raise({ cmd, folder }).catch(() => {}); });
  });
}

module.exports = { parseEditor, openInEditor, envWithPath, raiseEditor, macAppFor, EXTRA_PATH };
