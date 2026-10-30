// Office animals in the office layout: a cat and/or a dog per floor, each
// going where it is most useful. The cat sits by a desk that needs you
// (blocked or alert), else naps on a working desk (the warm one). The dog
// celebrates a finished desk first, else sits by one that needs you, else
// lies at the feet of someone working. With nothing to do, both stroll.
// While a worker is away at the boss with a question, both wait by the door,
// and greet them at their desk when they come back.
// A floor with nobody at a desk has no animals: they are at home with their owners.
// The plan and the sprites are pure, so test/animals.test.js runs them in
// node; app.js places the animals. The browser gets window.officeAnimals.
(function () {
  const SPECIES = {
    cat: [
      { name: 'Måns', coat: { B: '#e8913a', S: '#b8611c', L: '#fbe3c4' } },
      { name: 'Sixten', coat: { B: '#2b2d36', S: '#1b1c22', L: '#f4f4f8' } },
      { name: 'Majken', coat: { B: '#8e96a8', S: '#69708a', L: '#d9dde6' } },
      { name: 'Smulan', coat: { B: '#f4f1ea', S: '#e8913a', L: '#2b2d36' } },
      { name: 'Doris', coat: { B: '#7a5433', S: '#4e3420', L: '#d2a86f' } },
    ],
    // Same hash as the cats, so dog i shares a floor with cat i: each coat
    // is picked to stand apart from its cat's.
    dog: [
      { name: 'Bamse', coat: { B: '#2b2d36', S: '#17181d', L: '#4a4d5a' } },
      { name: 'Ludde', coat: { B: '#e0b25e', S: '#b8863a', L: '#f6e2b4' } },
      { name: 'Kajsa', coat: { B: '#d9772e', S: '#a4521a', L: '#f6efe4' } },
      { name: 'Tussan', coat: { B: '#9aa1b0', S: '#6b7285', L: '#d4d8e0' } },
      { name: 'Sigge', coat: { B: '#f4f4f8', S: '#2b2d36', L: '#d9dde6' } },
    ],
  };

  // Which species the settings put on each floor.
  function speciesFor({ cats, dogs, petsHidden } = {}) {
    if (petsHidden) return [];
    return [cats && 'cat', dogs && 'dog'].filter(Boolean);
  }

  // Someone is in: a desk that is not a plain terminal. Free seats are 'empty'
  // too; skipping them keeps this in step with target(). A worker away at the
  // boss's desk is still in the office.
  function hasPeople(floor) {
    return floor.rooms.some((r) => r.desks.some((d) => !d.seat && d.pose !== 'empty'));
  }

  // An animal of the species per floor: hash of the floor key, then the next
  // one nobody on this tab has yet, so two floors side by side differ.
  // Both species use the same index on a floor (see the dog list).
  function namesFor(species, floorKeys) {
    const n = SPECIES[species].length;
    const taken = new Set();
    const out = new Map();
    for (const key of floorKeys) {
      let h = 0;
      for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
      let c = h % n;
      for (let step = 0; step < n && taken.has(c); step++) c = (c + 1) % n;
      taken.add(c);
      out.set(key, c);
    }
    return out;
  }

  // In order of preference: [poses, mode]. The first rule with a matching
  // desk on the floor wins; with none the animal strolls.
  const RULES = {
    cat: [[['blocked', 'alert'], 'sit'], [['away'], 'wait'], [['working'], 'nap']],
    dog: [[['done'], 'wag'], [['blocked', 'alert'], 'sit'], [['away'], 'wait'], [['working'], 'lie']],
  };
  const GREET_MS = 6000;

  // Where the animal goes: { mode, deskId }, plus awayIds (every desk away)
  // while waiting and until for a greeting. One already at a desk that still
  // qualifies stays there, so it does not hop between two blocked desks.
  function target(species, floor, prev = null, now = Date.now()) {
    const desks = floor.rooms.flatMap((r) => r.desks).filter((d) => !d.seat);
    const back = (id) => desks.find((d) => d.id === id && d.pose !== 'away' && d.pose !== 'empty');
    const returned = prev?.mode === 'wait' && prev.awayIds.map(back).find(Boolean);
    if (returned) return { mode: 'greet', deskId: returned.id, until: now + GREET_MS };
    if (prev?.mode === 'greet' && now < prev.until && back(prev.deskId)) return prev;
    for (const [poses, mode] of RULES[species]) {
      const list = desks.filter((d) => poses.includes(d.pose));
      if (!list.length) continue;
      const deskId = (prev?.mode === mode && list.find((d) => d.id === prev.deskId) || list[0]).id;
      return mode === 'wait' ? { mode, deskId, awayIds: list.map((d) => d.id) } : { mode, deskId };
    }
    return { mode: 'stroll', deskId: null };
  }

  // ---- sprites: one character per pixel, coat letters B (base), S (stripes
  // or ears), L (light), plus E (eyes, dog nose), N (nose, tongue), P (blush),
  // . (empty). Facing right, except the sitting poses, which face us.
  // Sitting poses face us, chibi style like the welcome tour's pets; P is a
  // blush. The cat's tail curls up on the right.
  const CAT_SIT = [
    'BB....BB..',
    'BNBBBBNB..',
    'BBBSSBBB..',
    'BBEBBEBB.B',
    'BBEBBEBB.B',
    'BPBNNBPBB.',
    '.BLLLLSBB.',
    '.BLLLLBBB.',
    '.BBLLBBB..',
    '.BLBBBLB..',
  ];
  const CAT_NAP = [
    '.........B.B..',
    '...BBBBBBBBBB.',
    '..BBSBBSBBBBBB',
    '.BBBBBBBBEBEBB',
    '.BSBBSBBBBBNPB',
    'BBBBBBBBBBBBB.',
    '.LLLLLLLLLL...',
  ];
  const CAT_WALK = [
    '...........B.B..',
    'B..........BBBB.',
    'B..........BBEBB',
    '.B..BBBBBBBBBPBN',
    '..BBBBSBBSBBLL..',
    '...BBBBBBBBBLL..',
    '...BBBBBBBBBB...',
  ];
  // Floppy ears, a nose and a tongue. The tail is drawn apart so it can wag.
  const DOG_SIT = [
    '..BBBBBBB..',
    'SSBBBBBBBSS',
    'SSBEBBBEBSS',
    'SSBEBBBEBSS',
    'SSPBEEEBPSS',
    'SSBBBNBBBSS',
    '..BBBNBBB..',
    '...BLLLLBB.',
    '...BLLLLBB.',
    '...BBLLBBB.',
    '...LB..BL..',
  ];
  const DOG_TAIL = [['..B', '.B.', 'B..'], ['...', 'BBB', 'B..']];
  const DOG_LIE = [
    '..........BBBB..',
    '.........SBBEBBB',
    'B........SBBBPBE',
    '.BBBBBBBBBSBBB..',
    '..BBBBBBBBBBBB..',
    '..BBLLLLLLBBBBB.',
  ];
  const DOG_WALK = [
    '............BBBB.',
    '...........SBBEBB',
    'B..........SBBPBE',
    '.B..BBBBBBBBBSB..',
    '..BBBBBBBBBBBB...',
    '...BBBBBBBBLLB...',
    '...BBBBBBBBBB....',
  ];
  const LEGS = [
    ['...B.B....B.B...', '...B.B....B.B...'],
    ['..B...B..B...B..', '.B.....B.B....B.'],
  ];
  const HEART = ['.R.R.', 'RRRRR', 'RRRRR', '.RRR.', '..R..'];
  const ZZZ = ['ZZZ', '..Z', '.Z.', 'ZZZ'];
  const DOT = ['E'];

  const FIXED = { E: '#1a1d29', N: '#f29aa8', P: '#ff9eb5', R: '#ff5d7a', Z: '#eef1f7' };

  function pixels(rows, coat, dx = 0, dy = 0) {
    const out = [];
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length;) {
        const ch = row[x];
        if (ch === '.') { x++; continue; }
        let w = 1;
        while (row[x + w] === ch) w++;
        out.push(`<rect x="${x + dx}" y="${y + dy}" width="${w}" height="1" fill="${coat[ch] || FIXED[ch]}"/>`);
        x += w;
      }
    });
    return out.join('');
  }

  const walk = (body, coat) => `<g class="pet-pose pet-walk"><g class="pet-step a">${pixels(body.concat(LEGS[0]), coat, 1, 9)}</g><g class="pet-step b">${pixels(body.concat(LEGS[1]), coat, 1, 9)}</g></g>`;

  // One SVG with every pose of the animal in it; office.css shows the one for
  // its current mode (.pet.mode-sit etc.) and flips it with .pet.left.
  const VW = 18, VH = 18;
  function animalSVG(species, index) {
    const list = SPECIES[species];
    const coat = list[((index % list.length) + list.length) % list.length].coat;
    const poses = species === 'cat'
      ? `<g class="pet-pose pet-sit">${pixels(CAT_SIT, coat, 4, 8)}</g>
        <g class="pet-pose pet-nap">${pixels(CAT_NAP, coat, 2, 11)}<g class="pet-z">${pixels(ZZZ, coat, 14, 5)}</g></g>
        ${walk(CAT_WALK, coat)}`
      : `<g class="pet-pose pet-sit pet-wag">${pixels(DOG_SIT, coat, 3, 7)}<g class="pet-tail a">${pixels(DOG_TAIL[0], coat, 13, 11)}</g><g class="pet-tail b">${pixels(DOG_TAIL[1], coat, 13, 11)}</g></g>
        <g class="pet-pose pet-lie">${pixels(DOG_LIE, coat, 1, 12)}</g>
        ${walk(DOG_WALK, coat)}`;
    return `<svg class="pet-sprite" viewBox="0 0 ${VW} ${VH}" width="${VW * 3}" height="${VH * 3}" shape-rendering="crispEdges" aria-hidden="true">
      <g class="pet-heart">${pixels(HEART, coat, 10, 0)}</g>
      <g class="pet-dots">${[0, 1, 2].map((i) => `<g class="pet-dot d${i}">${pixels(DOT, coat, 9 + 2 * i, 2)}</g>`).join('')}</g>
      ${poses}
    </svg>`;
  }

  const api = { SPECIES, GREET_MS, speciesFor, hasPeople, namesFor, target, animalSVG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.officeAnimals = api;
})();
