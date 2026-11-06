// What is on the clipboard, for the terminal panel's paste: the text, whether
// an image is there too, and the paths of any copied files (see
// renderer/paste-paths.js for what the panel pastes).
const { fileURLToPath } = require('node:url');

// Finder puts the file's icon as a TIFF next to a copied file. Electron 33's
// readImage() found it; Electron 45 lists it only as a raw macOS format.
const RAW_IMAGE = /^electron application\/osclipboard;format="(Apple PNG pasteboard type|NeXT TIFF v4\.0 pasteboard type)"$/;

// Electron maps macOS's copied-files pasteboard (NSFilenamesPboardType) to this.
const FILE_LIST = 'text/uri-list';

function isImageType(type) {
  return type.startsWith('image/') || RAW_IMAGE.test(type);
}

// RFC 2483 list: one URI per line, # lines are comments. Only file: URIs.
function fileUrisToPaths(uriList) {
  return uriList.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => /^file:/i.test(line))
    .flatMap((uri) => { try { return [fileURLToPath(uri)]; } catch { return []; } });
}

async function copiedFilePaths(items) {
  const item = items.find((it) => it.types.includes(FILE_LIST));
  if (!item) return [];
  const blob = await item.getType(FILE_LIST);
  return fileUrisToPaths(await blob.text());
}

// The image and file checks are optional: if they fail, still paste the text.
async function peekClipboard(clipboard) {
  const [items, text] = await Promise.all([clipboard.read().catch(() => []), clipboard.readText()]);
  const hasImage = items.some((item) => item.types.some(isImageType));
  const paths = await copiedFilePaths(items).catch(() => []);
  return { hasText: text.length > 0, hasImage, text, paths };
}

module.exports = { peekClipboard, isImageType, fileUrisToPaths };
