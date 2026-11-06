// What the terminal panel types for a paste or a drop. Files go in as their
// paths, escaped the way macOS Terminal does it; Claude Code turns a pasted
// path to an image into an image attachment.
(function (root) {
  // Shell specials and whitespace only, so names like "Skärmavbild" stay readable.
  const SPECIAL = /[\s\\'"`$&|;<>(){}[\]*?!#~^]/g;
  // A name with ESC in it could end the bracketed paste early and type the rest as keys.
  const CONTROL = /[\x00-\x1f\x7f]/g;

  function escapePath(path) {
    return path.replace(CONTROL, '').replace(SPECIAL, '\\$&');
  }

  function pathsToText(paths) {
    return paths.map(escapePath).join(' ');
  }

  function bracketed(text) {
    return `\x1b[200~${text}\x1b[201~`;
  }

  // clip is what clipboard-peek.js returns. Copied files win over the image
  // beside them, which is only Finder's icon for the file. An image without
  // files is pixels: Ctrl+V lets Claude Code read it from the clipboard.
  function pasteAction(clip) {
    if (clip.paths?.length) return { kind: 'paths', text: pathsToText(clip.paths) };
    if (clip.hasImage) return { kind: 'image' };
    if (clip.hasText) return { kind: 'text', text: clip.text };
    return null;
  }

  function dropAction(paths) {
    return paths.length ? { kind: 'paths', text: pathsToText(paths) } : null;
  }

  const api = { escapePath, pathsToText, bracketed, pasteAction, dropAction };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.pastePaths = api;
})(typeof window !== 'undefined' ? window : globalThis);
