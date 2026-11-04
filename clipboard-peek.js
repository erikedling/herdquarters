// What is on the clipboard, for the terminal panel's paste: the text, and
// whether an image is there too (the panel lets the image win).

// Finder puts the file's icon as a TIFF next to a copied file. Electron 33's
// readImage() found it; Electron 45 lists it only as a raw macOS format.
const RAW_IMAGE = /^electron application\/osclipboard;format="(Apple PNG pasteboard type|NeXT TIFF v4\.0 pasteboard type)"$/;

function isImageType(type) {
  return type.startsWith('image/') || RAW_IMAGE.test(type);
}

// The image check is optional: if read() fails, still paste the text.
async function peekClipboard(clipboard) {
  const [items, text] = await Promise.all([clipboard.read().catch(() => []), clipboard.readText()]);
  const hasImage = items.some((item) => item.types.some(isImageType));
  return { hasText: text.length > 0, hasImage, text };
}

module.exports = { peekClipboard, isImageType };
