const path = require('node:path');

// Since Electron 43 a dialog without a defaultPath opens in Downloads instead
// of where the user last was, so the picker remembers that itself.
function createFolderPicker(showOpenDialog) {
  let lastDir;
  return async function pickFolder(win, defaultPath) {
    const r = await showOpenDialog(win, { title: 'Open repo', properties: ['openDirectory', 'createDirectory'], defaultPath: defaultPath || lastDir });
    if (r.canceled || !r.filePaths?.length) return null;
    lastDir = path.dirname(r.filePaths[0]);
    return r.filePaths[0];
  };
}

module.exports = { createFolderPicker };
