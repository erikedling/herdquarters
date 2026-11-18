// The kinds of bird PiPi can be: the theme-colored classic, plus real
// species in their real plumage. Each has a palette for pipi-sprite.js's
// keys and a look: shapes (crest, tail, beak), wing marks, and head and body
// markings as functions of the spot on the head or body (nx, ny from -1 to
// 1, facing right, light from the top left). No DOM, so node can run it.
(function () {
  // '#rrggbb' or 'rgb(r, g, b)', as getComputedStyle may give either.
  const rgb = (c) => {
    const m = String(c).trim().match(/^#([0-9a-f]{6})$/i);
    if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    const r = String(c).match(/\d+(\.\d+)?/g);
    return r ? r.slice(0, 3).map(Number) : [79, 124, 255];
  };
  const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;

  // The classic PiPi, from the theme's accent ([r, g, b]).
  function themePalette(a) {
    const k = [0, 0, 0], w = [255, 255, 255];
    return {
      O: mix(a, [20, 16, 34], 0.78), B: mix(a, k, 0), S: mix(a, k, 0.28), H: mix(a, w, 0.35),
      C: '#fff3dc', D: '#ecd0a2', W: mix(a, k, 0.18), X: mix(a, k, 0.45),
      Y: '#ffb02e', Z: '#d9730f', L: '#e8902a', K: '#1a1420', G: '#ffffff', P: '#ff8fa3',
    };
  }

  const near = (nx, ny, x, y, r) => (nx - x) ** 2 + (ny - y) ** 2 < r * r;
  const EYE = [0.33, -0.08]; // where the eye sits on the head

  const SPECIES = [
    {
      id: 'theme', name: 'Theme', note: 'The classic PiPi, in your theme\'s accent color',
      look: {}, palette: null,
    },
    {
      id: 'robin', name: 'European robin', latin: 'Erithacus rubecula',
      note: 'Olive-brown, with the orange face and breast edged in blue-grey',
      look: {
        crest: 'none', beak: 'thin',
        head: (nx, ny) => (nx > 0.0 && ny > -0.5 ? 'E' : nx > -0.25 && ny > -0.35 ? 'N' : null),
        body: (nx, ny, belly) => (belly && ny < 0.2) || (nx > 0.3 && ny < 0.25) ? 'E' : (nx > 0.05 && ny < 0.35 && !belly) ? 'N' : null,
      },
      palette: {
        O: '#2b2118', B: '#8a6d48', S: '#66502f', H: '#ad916a', C: '#f6f1e8', D: '#ddd2c2',
        E: '#f2772a', e: '#d65f1a', N: '#9aa6b2', W: '#76593a', X: '#4f3b25',
        Y: '#3a2e26', Z: '#241c16', L: '#c09079', K: '#120d0a', G: '#ffffff', P: '#ff8fa3',
      },
    },
    {
      id: 'blue-tit', name: 'Blue tit', latin: 'Cyanistes caeruleus',
      note: 'Cobalt cap and wings, white face with a navy eye stripe, yellow belly',
      look: {
        crest: 'none', crestKey: 'A', beak: 'thin', wing: 'bar', tailKeys: { W: 'T', X: 'U' },
        head: (nx, ny) => {
          if (ny < -0.45) return 'A';
          if (ny > -0.32 && ny < -0.02 && nx > -0.7) return 'M';
          if (nx < -0.6) return 'M';
          if (ny > 0.6 && nx > 0.2) return 'M';
          return 'Q';
        },
      },
      palette: {
        O: '#17223d', B: '#9daa4c', S: '#7a8a36', H: '#c3cd74', C: '#f6d93c', D: '#d9b524',
        A: '#2f7fd6', a: '#2463ad', M: '#1b2a52', Q: '#f6f7fb', V: '#9cc8f2',
        W: '#4a8fd8', X: '#2c5ea8', T: '#3c76c4', U: '#2a5596',
        Y: '#2b2b33', Z: '#1a1a20', L: '#6c7a96', K: '#0d1020', G: '#ffffff', P: '#ff8fa3',
      },
    },
    {
      id: 'goldfinch', name: 'European goldfinch', latin: 'Carduelis carduelis',
      note: 'Red face, black-and-white head, buff back, black wings with a gold bar',
      look: {
        crest: 'none', crestKey: 'A', beak: 'finch', wing: 'bar', tailKeys: { W: 'T', X: 'U' },
        head: (nx, ny) => {
          if (nx > 0.36 && ny < 0.5) return 'M';
          if (ny < -0.38) return 'A';
          if (nx < -0.25 && nx > -0.55) return 'A';
          if (nx <= -0.55) return null;
          return 'Q';
        },
        body: (nx, ny, belly) => (belly && ny < 0.15 && nx < 0.55 ? 'E' : null),
      },
      palette: {
        O: '#1c1514', B: '#b98d5e', S: '#93704a', H: '#d7b68c', C: '#f7f2ea', D: '#e1d4c0',
        E: '#e3c49a', e: '#c9a67a', A: '#1f1b1d', a: '#141113', M: '#d8212e', Q: '#f7f3ee',
        W: '#221d1f', X: '#121012', V: '#f8d21a', T: '#221d1f', U: '#121012',
        Y: '#f0d6bf', Z: '#c9a58b', L: '#c9a08a', K: '#120d0a', G: '#ffffff', P: '#ff8fa3',
      },
    },
    {
      id: 'kingfisher', name: 'Common kingfisher', latin: 'Alcedo atthis',
      note: 'Electric blue back, orange cheeks and belly, white throat, dagger beak',
      look: {
        crest: 'none', crestKey: 'A', beak: 'dagger', tail: 'stub', wing: 'spots', tailKeys: { W: 'T', X: 'U' },
        head: (nx, ny) => {
          if (ny > 0.5 && nx > 0.0) return 'Q';
          if (nx < -0.4 && ny > 0.05 && ny < 0.5) return 'Q';
          if (ny > 0.28) return 'A';
          if (nx > 0.5 && ny > -0.35) return 'E';
          if (nx > -0.4 && ny > -0.05) return 'E';
          return 'A';
        },
      },
      palette: {
        O: '#0b2230', B: '#22c3e8', S: '#1592b5', H: '#8beaf8', C: '#f27c26', D: '#cb5d14',
        E: '#f27c26', e: '#cb5d14', A: '#1e8fb8', a: '#166d8f', Q: '#f7fbff',
        W: '#1e82aa', X: '#145a7a', V: '#5fd0ef', T: '#1a6d94', U: '#114a66',
        Y: '#1d1b20', Z: '#2c2428', L: '#e5483a', K: '#0a0a10', G: '#ffffff', P: '#ff8fa3',
      },
    },
    {
      id: 'bullfinch', name: 'Eurasian bullfinch', latin: 'Pyrrhula pyrrhula',
      note: 'Black cap, dove-grey back, rose-red cheeks and breast, white wing bar',
      look: {
        crest: 'none', crestKey: 'A', beak: 'finch', wing: 'bar', tailKeys: { W: 'T', X: 'U' },
        head: (nx, ny) => (ny < -0.3 || (nx > 0.55 && ny < 0.25) ? 'A' : nx > -0.45 ? 'E' : null),
        body: (nx, ny, belly) => (belly || (nx > 0.35 && ny < 0.3) ? (ny > 0.75 ? 'Q' : 'E') : null),
      },
      palette: {
        O: '#131317', B: '#8d96a6', S: '#6c7486', H: '#b0b8c6', C: '#e8665a', D: '#c84b45',
        E: '#ea6a5c', e: '#c94c44', A: '#1c1c22', a: '#121216', Q: '#f2f2f4',
        W: '#24242c', X: '#111116', V: '#e6e8ee', T: '#1c1c22', U: '#0e0e12',
        Y: '#2a2a30', Z: '#151518', L: '#5a4a48', K: '#08080c', G: '#ffffff', P: '#ff8fa3',
      },
    },
    {
      id: 'cardinal', name: 'Northern cardinal', latin: 'Cardinalis cardinalis',
      note: 'All scarlet with a pointed crest, black mask and a stout orange beak',
      look: {
        crest: 'peak', beak: 'finch',
        head: (nx, ny) => ((nx > 0.42 && ny > -0.28) || (ny > 0.45 && nx > 0.15) ? 'M' : null),
      },
      palette: {
        O: '#2a0a0e', B: '#d81f2a', S: '#a8121e', H: '#f45a5c', C: '#e8363c', D: '#b81a24',
        M: '#151012', W: '#b8182a', X: '#861018',
        Y: '#ff6a2a', Z: '#d9461a', L: '#b0705a', K: '#0a0608', G: '#ffffff', P: '#ff8fa3',
      },
    },
    {
      id: 'blue-jay', name: 'Blue jay', latin: 'Cyanocitta cristata',
      note: 'Blue crest and back, white face, black necklace, barred blue wings',
      look: {
        crest: 'jay', beak: 'short', tail: 'long', wing: 'bar', tailKeys: { W: 'T', X: 'U' },
        head: (nx, ny) => {
          if (ny > 0.72 || (nx > -0.38 && nx < -0.18 && ny > -0.1)) return 'M';
          if (nx > -0.18 && ny > -0.2) return 'Q';
          return null;
        },
        body: (nx, ny) => (nx > 0.0 && ny < -0.45 && ny > -0.75 ? 'M' : null),
      },
      palette: {
        O: '#0e1830', B: '#4b88dc', S: '#33649f', H: '#8fbcf2', C: '#f2f3f6', D: '#cfd4de',
        M: '#141822', Q: '#f4f5f8', W: '#3b7fe0', X: '#1d2f5a', V: '#f2f5fb', T: '#3b7fe0', U: '#1d2f5a',
        Y: '#1d1d22', Z: '#111114', L: '#2b2b33', K: '#06080e', G: '#ffffff', P: '#ff8fa3',
      },
    },
    {
      id: 'scarlet-macaw', name: 'Scarlet macaw', latin: 'Ara macao',
      note: 'Scarlet, with yellow and blue wings, a white face and a long tail',
      look: {
        crest: 'none', beak: 'hook', tail: 'long', wing: 'bar', tailKeys: { W: 'T', X: 'U' },
        head: (nx, ny) => (nx > 0.05 && ny > -0.4 && ny < 0.45 ? 'M' : null),
      },
      palette: {
        O: '#3a0a0e', B: '#e2222a', S: '#b0141c', H: '#ff6a5c', C: '#e6292c', D: '#b3141c',
        M: '#f5ede6', W: '#d61c26', X: '#1f5fd0', V: '#ffc916', T: '#d61c26', U: '#1f5fd0',
        Y: '#f0e7d8', Z: '#24242a', L: '#5d5f6a', K: '#1a1206', G: '#ffffff', P: '#ff8fa3',
      },
    },
    {
      id: 'rainbow-lorikeet', name: 'Rainbow lorikeet', latin: 'Trichoglossus moluccanus',
      note: 'Violet-blue head, orange breast, lime collar, green back, blue belly',
      look: {
        crest: 'none', crestKey: 'A', beak: 'hook', tail: 'long', tailKeys: { W: 'T', X: 'U' },
        head: (nx, ny) => (nx < -0.6 && ny > 0.1 ? 'N' : 'A'),
        body: (nx, ny, belly) => {
          if (nx > -0.2 && ny < -0.55) return 'N';
          if ((belly && ny < 0.3) || (nx > 0.35 && ny < 0.2)) return 'E';
          return null;
        },
      },
      palette: {
        O: '#12142c', B: '#22b03e', S: '#168a2e', H: '#74d86c', C: '#2c34b0', D: '#1e2384',
        A: '#3c48cc', a: '#2a339e', E: '#ff5a1f', e: '#e0360f', N: '#b8e61f',
        W: '#1fa03a', X: '#126e26', T: '#23a83e', U: '#146b26',
        Y: '#ff3b1f', Z: '#c4210f', L: '#6a6a72', K: '#120806', G: '#ffffff', P: '#ff8fa3',
      },
    },
    {
      id: 'gouldian-finch', name: 'Gouldian finch', latin: 'Chloebia gouldiae',
      note: 'Red face ringed in black and turquoise, purple breast, yellow belly',
      look: {
        crest: 'none', crestKey: 'A', beak: 'finch', tailKeys: { W: 'T', X: 'U' },
        head: (nx, ny) => {
          const r = Math.hypot(nx - 0.55, (ny - 0.05) * 1.1);
          if (r < 0.78) return 'M';
          if (r < 0.98) return 'A';
          if (r < 1.2) return 'N';
          return null;
        },
        body: (nx, ny, belly) => {
          if (belly && ny < 0.15) return 'E';
          if (nx > 0.35 && ny < 0.15) return 'E';
          return null;
        },
      },
      palette: {
        O: '#141228', B: '#3eb245', S: '#2a8a33', H: '#7ed562', C: '#ffd420', D: '#e0ae10',
        E: '#9244d6', e: '#702eae', M: '#e5262a', A: '#141214', a: '#141214', N: '#4cd8e2',
        W: '#38a242', X: '#24702c', T: '#1d1d22', U: '#0e0e12',
        Y: '#f2e2c8', Z: '#e0606a', L: '#e0a8a0', K: '#0a0608', G: '#ffffff', P: '#ff8fa3',
      },
    },
    {
      id: 'budgerigar', name: 'Budgerigar', latin: 'Melopsittacus undulatus',
      note: 'Grass green with a yellow face, violet cheek spots and scalloped wings',
      look: {
        crest: 'none', crestKey: 'M', beak: 'hook', tail: 'long', wing: 'scallop', tailKeys: { W: 'T', X: 'U' },
        head: (nx, ny) => {
          if (near(nx, ny, 0.2, 0.55, 0.2)) return 'Q';
          if (nx > -0.15 && ny > -0.55) return 'M';
          return Math.round(ny * 6.5) % 2 ? 'N' : 'M';
        },
      },
      palette: {
        O: '#17280e', B: '#7cd232', S: '#52a82a', H: '#b4f06c', C: '#90e042', D: '#62b830',
        M: '#f6e842', N: '#1e1e1e', Q: '#5a4fd8', W: '#f6e842', X: '#2b2b2b', V: '#1e1e1e',
        T: '#2a6fd0', U: '#1f4f9a',
        Y: '#cbbd8e', Z: '#a79b70', L: '#8b8fa8', K: '#0a0a10', G: '#ffffff', P: '#ff8fa3',
      },
    },
    {
      id: 'cockatiel', name: 'Cockatiel', latin: 'Nymphicus hollandicus',
      note: 'Soft grey with a yellow face and crest, orange cheeks, white wing patch',
      look: {
        crest: 'plume', crestKey: 'M', beak: 'hook', tail: 'long', wing: 'patch', tailKeys: { W: 'T', X: 'U' },
        head: (nx, ny) => {
          if (near(nx, ny, 0.15, 0.3, 0.27)) return 'Q';
          if (nx > -0.35 && ny > -0.95) return 'M';
          return null;
        },
      },
      palette: {
        O: '#24252b', B: '#90929a', S: '#6d6f77', H: '#b8bac1', C: '#a6a8af', D: '#86888f',
        M: '#f6de5a', Q: '#f08a2a', W: '#7c7e86', X: '#56585f', V: '#f4f4f4', T: '#6d6f77', U: '#4d4f55',
        Y: '#aba49a', Z: '#7f7870', L: '#a3958e', K: '#0a0808', G: '#ffffff', P: '#ff8fa3',
      },
    },
    {
      id: 'painted-bunting', name: 'Painted bunting', latin: 'Passerina ciris',
      note: 'Violet-blue head with a red eye ring, lime back, scarlet underparts',
      look: {
        crest: 'none', crestKey: 'A', beak: 'finch', tailKeys: { W: 'T', X: 'U' },
        head: (nx, ny) => (near(nx, ny, EYE[0] + 0.03, EYE[1] + 0.04, 0.34) ? 'M' : ny > 0.5 && nx > 0.1 ? 'E' : 'A'),
        body: (nx, ny, belly) => (belly || (nx > 0.35 && ny < 0.25) || nx < -0.8 ? 'E' : null),
      },
      palette: {
        O: '#1d1438', B: '#9cd43c', S: '#74ab26', H: '#c8f072', C: '#e5262a', D: '#b8161f',
        E: '#e5262a', e: '#b8161f', A: '#3d5ee2', a: '#2c45b4', M: '#e5262a',
        W: '#5e9a2e', X: '#3d6a1e', T: '#6d3f6a', U: '#452a45',
        Y: '#8d93a3', Z: '#6a7080', L: '#8a7f78', K: '#0a0610', G: '#ffffff', P: '#ff8fa3',
      },
    },
    {
      id: 'lilac-breasted-roller', name: 'Lilac-breasted roller', latin: 'Coracias caudatus',
      note: 'Lilac breast, turquoise belly, ultramarine wings and tail streamers',
      look: {
        crest: 'none', crestKey: 'A', beak: 'short', tail: 'streamers', wing: 'bar', tailKeys: { W: 'T', X: 'U' },
        head: (nx, ny) => {
          if (ny < -0.42) return 'A';
          if (ny < -0.22 && nx > -0.3) return 'Q';
          if (ny > -0.16 && ny < 0.0 && nx > -0.55 && nx < 0.6) return 'N';
          if (ny > 0.05) return 'E';
          return 'A';
        },
        body: (nx, ny, belly) => ((belly && ny < 0.25) || (nx > 0.35 && ny < 0.2) ? 'E' : null),
      },
      palette: {
        O: '#1a1630', B: '#a07c50', S: '#7c5d38', H: '#c4a374', C: '#5ccbe8', D: '#3aa6c8',
        E: '#c58ad8', e: '#a26cb8', A: '#a9c46c', a: '#86a050', Q: '#f4f6f0', N: '#2a2420',
        W: '#2fb8c8', X: '#1c2a8a', V: '#2c5ad8', T: '#2a8ab0', U: '#1a2a5a',
        Y: '#26262c', Z: '#141418', L: '#c9c3a0', K: '#0a0808', G: '#ffffff', P: '#ff8fa3',
      },
    },
    {
      id: 'keel-billed-toucan', name: 'Keel-billed toucan', latin: 'Ramphastos sulfuratus',
      note: 'Glossy black with a lemon bib, a red band and a huge rainbow beak',
      look: {
        crest: 'none', crestKey: 'A', beak: 'toucan', tailKeys: { W: 'T', X: 'U' },
        head: (nx, ny) => {
          if (near(nx, ny, EYE[0] + 0.03, EYE[1] + 0.04, 0.3)) return 'M';
          if (nx > -0.3 && ny > -0.25) return 'E';
          return null;
        },
        body: (nx, ny, belly) => {
          if ((belly && ny < 0.12) || (nx > 0.3 && ny < 0.05)) return 'E';
          if (belly && ny < 0.3) return 'N';
          return null;
        },
      },
      palette: {
        O: '#07070b', B: '#363644', S: '#22222c', H: '#62627e', C: '#30303c', D: '#20202a',
        A: '#363644', a: '#22222c', E: '#ffd60a', e: '#e8b800', M: '#74d64e', N: '#e0222a', W: '#3c3c4a', X: '#22222c', T: '#363644', U: '#1c1c24',
        Y: '#8ad63a', Z: '#ff8a1f', I: '#e0222a', J: '#3a86e0', L: '#4a7fd6', K: '#06060a', G: '#ffffff', P: '#ff8fa3',
      },
    },
    {
      id: 'puffin', name: 'Atlantic puffin', latin: 'Fratercula arctica',
      note: 'Black and white, pale grey face, striped orange-and-slate beak, orange feet',
      look: {
        crest: 'none', crestKey: 'A', beak: 'puffin', tail: 'stub', tailKeys: { W: 'T', X: 'U' },
        head: (nx, ny) => (ny < -0.42 || nx < -0.45 || ny > 0.78 ? 'A' : 'Q'),
        body: (nx, ny, belly) => (nx > -0.1 && ny < -0.5 ? 'A' : null),
      },
      palette: {
        O: '#0a0a0e', B: '#33333f', S: '#20202a', H: '#5c5c74', C: '#f6f7f9', D: '#d3d7de',
        A: '#2c2c38', a: '#1c1c24', Q: '#e6e9ee', W: '#383846', X: '#1e1e26', T: '#2c2c38', U: '#16161c',
        Y: '#566782', Z: '#f2552a', J: '#f6c92a', L: '#ff7a1a', K: '#08080c', G: '#ffffff', P: '#ff8fa3',
      },
    },
    {
      id: 'java-sparrow', name: 'Java sparrow', latin: 'Padda oryzivora',
      note: 'Grey, with white cheeks, a coral beak, a white star mark on the chest and a yellow glint in the eye',
      look: {
        crest: 'none', beak: 'chunky', eyes: 'spark', chest: 'star', tailKeys: { W: 'T', X: 'U' },
        cheek: { dx: 2.6, dy: 2.2, rx: 4.4, ry: 2.4 },
        head: (nx, ny) => (((nx - 0.2) / 0.62) ** 2 + ((ny - 0.08) / 0.52) ** 2 < 1 ? 'Q' : ny > 0.42 && nx > -0.2 ? 'E' : null),
        body: (nx, ny, belly) => {
          if (ny > 0.7) return 'C';
          if (ny > 0.6) return 'D';
          return belly || (nx > 0.3 && ny < 0.3) ? 'E' : null;
        },
      },
      palette: {
        O: '#2a2a30', B: '#b4b4ba', S: '#98989f', H: '#cdcdd2', C: '#e8d3c0', D: '#d2b7a1',
        E: '#adadb3', e: '#9a9aa1', Q: '#ffffff', R: '#ffffff', F: '#ffe98a',
        W: '#a6a6ad', X: '#86868e', T: '#6f6f77', U: '#55555c',
        Y: '#f2705f', Z: '#c9474c', I: '#ffa898', L: '#ea625c', K: '#16151c', G: '#ffffff', P: '#ff8fa3',
      },
    },
  ];

  const byId = (id) => SPECIES.find((s) => s.id === id) || SPECIES[0];
  const api = { SPECIES, byId, themePalette, rgb };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.pipiSpecies = api;
})();
