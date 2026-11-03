// Color themes, each with a dark and a light version. A theme sets the base
// colors on <html>; style.css mixes the rest (hover, rooms, tinted banners)
// from them. Midnight dark is the original look, which style.css pins exactly.
// The terminal keeps its own colors. Pure data plus apply(), so
// test/themes.test.js can check every theme in node.
(function () {
  const KEYS = ['bg', 'bg-2', 'panel', 'line', 'text', 'muted', 'accent', 'working', 'blocked', 'done', 'idle', 'warn'];
  const t = (bg, bg2, panel, line, text, muted, accent, working, blocked, done, idle, warn) =>
    ({ bg, 'bg-2': bg2, panel, line, text, muted, accent, working, blocked, done, idle, warn });

  const THEMES = [
    { id: 'midnight', name: 'Midnight',
      dark: t('#1b1e2b', '#232738', '#2a2f42', '#3a4059', '#e6e8f0', '#9aa3bd', '#4f7cff', '#4f7cff', '#ff5d5d', '#38c172', '#8a93a6', '#ffd28a'),
      light: t('#eef1f8', '#e3e7f1', '#ffffff', '#cdd3e2', '#1f2433', '#5f6880', '#3d6af0', '#3d6af0', '#e5484d', '#2f9e5f', '#7a8296', '#d99a1e') },
    { id: 'synthwave', name: 'Synthwave',
      dark: t('#1a1033', '#221542', '#2b1a4f', '#45306e', '#f3e9ff', '#b3a1d6', '#ff3ea5', '#00e5ff', '#ff4d6d', '#7cff6b', '#8f7fb3', '#ffd60a'),
      light: t('#fff0fa', '#fbe3f3', '#ffffff', '#efc6e2', '#2a1440', '#7a5f93', '#d6187f', '#0096b3', '#e0234e', '#2f9e44', '#8a7aa3', '#d4a300') },
    { id: 'forest', name: 'Forest',
      dark: t('#141f19', '#19281f', '#1f3328', '#33503f', '#e3efe6', '#9cb5a5', '#6fcf73', '#5fb8e8', '#e8664f', '#6fcf73', '#84978a', '#e9a23b'),
      light: t('#eef5ec', '#e2ecdf', '#ffffff', '#c8d9c4', '#1d2b21', '#5d7363', '#2e8b3d', '#2f7fb5', '#c4432f', '#2e8b3d', '#7d8f80', '#c27a10') },
    { id: 'ocean', name: 'Ocean',
      dark: t('#0d1b2a', '#122336', '#1b2f45', '#2c4866', '#e2eef8', '#93abc2', '#3fb8e8', '#3fb8e8', '#ff7b6b', '#4fd6ad', '#7f93a8', '#ffc861'),
      light: t('#eaf6fb', '#dcedf6', '#ffffff', '#bcd8e8', '#10263a', '#557089', '#0b84b8', '#0b84b8', '#e5594a', '#1fa889', '#7890a5', '#d39412') },
    { id: 'candy', name: 'Candy',
      dark: t('#2a1a2e', '#33203a', '#3d2643', '#5a3a62', '#fde9f6', '#c9a6c4', '#ff8fc7', '#7fd6ff', '#ff5f7e', '#9be86a', '#a28aa6', '#ffd36e'),
      light: t('#fff3f8', '#fde6f0', '#ffffff', '#f2c9dc', '#3a1d33', '#8a6580', '#e0559b', '#2f9fd0', '#e03a5c', '#4fa82a', '#a08a9c', '#d69a00') },
    { id: 'sunset', name: 'Sunset',
      dark: t('#2a1612', '#331b16', '#40221b', '#5e3428', '#fdebe1', '#c9a293', '#ff8a4c', '#ffb347', '#ff4f6a', '#8fd16a', '#a38a80', '#ffd166'),
      light: t('#fff4ec', '#fbe7d8', '#ffffff', '#f0cdb5', '#3a1d12', '#8a6455', '#e2631f', '#d97b00', '#c9305e', '#4f9a2c', '#9a857a', '#c98f00') },
    { id: 'terminal', name: 'Terminal',
      dark: t('#0b0f0b', '#0f150f', '#141c14', '#234023', '#c8f5c8', '#6fa36f', '#39ff7a', '#39ff7a', '#ff4d4d', '#b4ff5c', '#5d7a5d', '#ffcc00'),
      light: t('#f2f7f2', '#e5eee5', '#ffffff', '#c4d8c4', '#0f2a14', '#4f6f53', '#14a04a', '#14a04a', '#d33a3a', '#5c9c16', '#7f927f', '#b38f00') },
    { id: 'fjord', name: 'Fjord',
      dark: t('#242933', '#2a303c', '#2f3644', '#434c5e', '#eceff4', '#a3adbf', '#88c0d0', '#81a1c1', '#bf616a', '#a3be8c', '#8790a3', '#ebcb8b'),
      light: t('#eceff4', '#e5e9f0', '#ffffff', '#d0d6e1', '#2e3440', '#5e6779', '#5e81ac', '#5e81ac', '#bf616a', '#6d9a52', '#8790a3', '#c49a3c') },
    { id: 'espresso', name: 'Espresso',
      dark: t('#1f1712', '#261c16', '#30241c', '#4a382b', '#f2e6da', '#b9a28e', '#d9a066', '#6fb3d2', '#e06c5a', '#9fbf6a', '#9a8a7c', '#e8c170'),
      light: t('#f8f1e9', '#efe4d7', '#ffffff', '#e0cfbc', '#2e2018', '#7a6352', '#a8642a', '#3d82a6', '#c74b39', '#6a8f35', '#988878', '#b9861c') },
    { id: 'lavender', name: 'Lavender',
      dark: t('#1e1a2e', '#241f37', '#2c2643', '#453d63', '#eee9ff', '#aca2cc', '#b69cff', '#8fb4ff', '#ff7a9c', '#8be0c5', '#8f88a8', '#ffd59e'),
      light: t('#f5f2ff', '#ebe6fb', '#ffffff', '#d8cff3', '#251d3d', '#6c6290', '#7b5ce0', '#4f72e0', '#e05a85', '#2fb08b', '#8b84a3', '#c98a2a') },
  ];

  // Styles: the shape of the whole UI. Modern is the app as it was, colored by
  // the theme. The retro styles are pixel looks (retro.css) that bring their own
  // colors and mode, so the theme and dark/light only apply to Modern.
  const STYLES = [
    { id: 'modern', name: 'Modern', note: 'Smooth and rounded, in your theme' },
    { id: 'workshop', name: 'Workshop', note: 'Wood, cork and paper', mode: 'light',
      colors: t('#efe0bf', '#e6d3ac', '#fff8e6', '#8a6a45', '#2a2010', '#7a6545', '#3e7fc4', '#3e7fc4', '#c8423a', '#4f9a3a', '#8a7a60', '#e8a33a') },
    { id: 'quest', name: 'Quest', note: '16-bit RPG menus', mode: 'dark',
      colors: t('#0b0f2b', '#10164a', '#1a237a', '#4a58b8', '#f2f4ff', '#9aa8e8', '#ffd25a', '#7aa2ff', '#ff5a6e', '#5ce08a', '#8090d8', '#ffd25a') },
    { id: 'handheld', name: 'Handheld', note: 'Four shades of green', mode: 'light',
      colors: t('#c4d88a', '#8bac0f', '#c4d88a', '#0f380f', '#0f380f', '#306230', '#306230', '#306230', '#0f380f', '#306230', '#306230', '#0f380f') },
    { id: 'toybox', name: 'Toybox', note: 'The welcome screen, pastel', mode: 'light',
      colors: t('#bfe3ff', '#ffd9c2', '#ffffff', '#2b2d42', '#2b2d42', '#5f6585', '#4f7cff', '#4f7cff', '#e8606b', '#3fae4f', '#8a90a6', '#ffb02e') },
    { id: 'workstation', name: 'Workstation', note: 'A beige desktop, early 90s', mode: 'light',
      colors: t('#e0d9c9', '#d8d0c0', '#f4f0e6', '#8a8478', '#1a1a1a', '#5a5448', '#2848b8', '#2848b8', '#c0282e', '#1f7a3a', '#6a6458', '#b8860b') },
  ];

  const byId = (id) => THEMES.find((x) => x.id === id) || THEMES[0];
  const styleById = (id) => STYLES.find((x) => x.id === id) || STYLES[0];
  // mode: 'dark' | 'light' | 'system'; systemDark: what the OS prefers.
  const resolveMode = (mode, systemDark) => (mode === 'system' ? (systemDark ? 'dark' : 'light') : mode === 'light' ? 'light' : 'dark');

  // The colors and mode on screen: a retro style's own, else the theme's.
  function resolve(themeId, mode, styleId, systemDark) {
    const style = styleById(styleId);
    if (style.colors) return { style: style.id, theme: style.id, mode: style.mode, colors: style.colors };
    const theme = byId(themeId);
    const m = resolveMode(mode, systemDark);
    return { style: 'modern', theme: theme.id, mode: m, colors: theme[m] };
  }

  function apply(id, mode, styleId) {
    const r = resolve(id, mode, styleId, window.matchMedia?.('(prefers-color-scheme: dark)').matches);
    const root = document.documentElement;
    root.dataset.theme = r.theme;
    root.dataset.mode = r.mode;
    if (r.style === 'modern') delete root.dataset.style; else root.dataset.style = r.style;
    for (const k of KEYS) root.style.setProperty(`--${k}`, r.colors[k]);
  }

  const api = { THEMES, STYLES, KEYS, byId, styleById, resolveMode, resolve };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  window.officeThemes = { ...api, apply };
})();
