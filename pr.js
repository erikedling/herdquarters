// "Open pull request": ask the GitHub CLI for the PR of the branch checked out
// in a folder. `gh pr view` with no argument finds it for the current branch
// (open, merged or closed). Nothing goes through a shell; the PATH gets the
// usual CLI folders, as for the editor (see editor.js).
const path = require('node:path');
const { envWithPath } = require('./editor');

// Resolves { url, number, state } or null when the branch has no PR; rejects
// with a message to show when gh is missing, logged out or the folder is not a
// GitHub checkout.
function findPullRequest(folder, { execFile = require('node:child_process').execFile, fs = require('node:fs'), env = process.env } = {}) {
  if (!folder || !path.isAbsolute(folder)) return Promise.reject(new Error('No folder to look in.'));
  // A missing cwd fails the spawn with ENOENT too, which would read as "no gh".
  if (!fs.existsSync(folder)) return Promise.reject(new Error(`Folder is gone: ${folder}`));
  return new Promise((resolve, reject) => {
    execFile('gh', ['pr', 'view', '--json', 'url,number,state'], { cwd: folder, env: envWithPath(env), timeout: 15000 }, (err, stdout, stderr) => {
      if (!err) {
        try { const { url, number, state } = JSON.parse(stdout); return resolve({ url, number, state }); }
        catch { return reject(new Error('gh gave an answer I could not read.')); }
      }
      const msg = String(stderr || err.message || '').trim();
      if (err.code === 'ENOENT') return reject(new Error('The GitHub CLI (gh) is not installed. Install it with: brew install gh'));
      if (/no pull requests? found/i.test(msg)) return resolve(null);
      if (/gh auth login/i.test(msg)) return reject(new Error('The GitHub CLI is not logged in. Run: gh auth login'));
      reject(new Error(msg || 'gh failed.'));
    });
  });
}

module.exports = { findPullRequest };
