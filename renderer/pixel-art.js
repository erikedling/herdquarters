// Small pixel-art pictures for the chrome: the logo in the top bar and the
// icons on the menu bar in reception. Each is a 12×12 map, one letter per
// pixel ('.' is see-through), drawn as a crisp SVG at any whole scale.
(function (root) {
  const ART = {
    // The building from the welcome screen: roof, wall, windows, door, grass.
    logo: { pal: { r: '#e8606b', p: '#ffd9c2', w: '#8fc8ff', d: '#7a4a2a', g: '#5cc46a' }, rows: [
      '..rrrrrrrr..', '.rrrrrrrrrr.', '.pppppppppp.', '.pwwpwwpwwp.', '.pwwpwwpwwp.', '.pppppppppp.',
      '.pwwpwwpwwp.', '.pwwpwwpwwp.', '.pppppppppp.', '.ppppddpppp.', '.ppppddpppp.', 'gggggggggggg'] },
    // A small bird: the assistant's chat.
    bird: { pal: { o: '#3d2a17', b: '#8fc8ff', c: '#fff3dc', k: '#1a1420', y: '#ffb02e', l: '#e8902a' }, rows: [
      '............', '....oooo....', '...obbbbo...', '..obbbbkbo..', '..obbbbbboyy', '.obbbbbbboy.',
      'obbccccbbo..', 'obccccccbo..', '.obccccbo...', '..oooooo....', '....l..l....', '...ll.ll....'] },
    // A sticky note with a pin: the corkboard.
    note: { pal: { r: '#ff5d5d', k: '#3d2a17', y: '#ffe27a', l: '#c9a640' }, rows: [
      '.....rr.....', '.kkkkrrkkkk.', '.kyyyyyyyyk.', '.kyllllllyk.', '.kyyyyyyyyk.', '.kyllllllyk.',
      '.kyyyyyyyyk.', '.kyllllyyyk.', '.kyyyyyyyyk.', '.kyyyyyyykk.', '.kkkkkkkkk..', '............'] },
    // A window with a side panel: the workspace sidebar.
    side: { pal: { k: '#f3e6d2', b: '#3d2a17', a: '#8fc8ff' }, rows: [
      '............', 'kkkkkkkkkkkk', 'kaaakbbbbbbk', 'kaaakbbbbbbk', 'kaaakbbbbbbk', 'kaaakbbbbbbk',
      'kaaakbbbbbbk', 'kaaakbbbbbbk', 'kaaakbbbbbbk', 'kaaakbbbbbbk', 'kkkkkkkkkkkk', '............'] },
    // A cog: settings.
    gear: { pal: { g: '#f3e6d2' }, rows: [
      '....gggg....', '.gg.gggg.gg.', '.gggggggggg.', '..ggg..ggg..', 'gggg....gggg', 'ggg......ggg',
      'ggg......ggg', 'gggg....gggg', '..ggg..ggg..', '.gggggggggg.', '.gg.gggg.gg.', '....gggg....'] },
  };

  // An <svg> string for ART[name], `scale` CSS px per pixel.
  function svg(name, scale = 2) {
    const art = ART[name];
    if (!art) return '';
    const w = art.rows[0].length, h = art.rows.length;
    let rects = '';
    art.rows.forEach((row, y) => [...row].forEach((c, x) => {
      if (art.pal[c]) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${art.pal[c]}"/>`;
    }));
    return `<svg viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  }

  // Fill every <span data-pixel="name" data-scale="2"> under `root`.
  function draw(rootEl) {
    for (const el of rootEl.querySelectorAll('[data-pixel]')) el.innerHTML = svg(el.dataset.pixel, Number(el.dataset.scale) || 2);
  }

  const api = { ART, svg, draw };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.officePixels = api;
})(typeof window !== 'undefined' ? window : globalThis);
