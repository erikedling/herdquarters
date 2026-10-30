// Whether a folder given as OFFICE_USER_DATA is the real data folder or inside
// it. Compared by canonical path, so a symlink to the real folder is caught
// too, and without case on macOS and Windows: a missing tail keeps the casing
// it was given, so Agent-Office would otherwise pass before agent-office exists.
const fs = require('node:fs');
const path = require('node:path');

// A folder that does not exist yet: resolve the nearest one that does and put the missing tail back.
function canonical(dir) {
  const abs = path.resolve(dir);
  try { return fs.realpathSync.native(abs); } catch {
    const up = path.dirname(abs);
    return up === abs ? abs : path.join(canonical(up), path.basename(abs));
  }
}

function isRealDataFolder(dir, real, platform = process.platform) {
  const fold = platform === 'darwin' || platform === 'win32' ? (p) => p.toLowerCase() : (p) => p;
  const rel = path.relative(fold(canonical(real)), fold(canonical(dir)));
  // A child named "..dev" is inside; only a real parent step is outside.
  return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

module.exports = { isRealDataFolder };
