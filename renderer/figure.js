// SVG for one desk with (optionally) a person at it.
// pose: 'working' | 'blocked' | 'alert' | 'done' | 'idle' | 'unknown' | 'empty'
// ('alert': the ops agent with an open alert, on its feet with a red !)
// character: index into CHARACTERS, picked per pane in app.js so every agent
// in the office looks like a different person.
// The markup is static per pose; motion comes from CSS keyframes on the
// classed groups (.arm-l, .arm-r, .head, .screen). All characters share the
// same body geometry so those animations work for everyone; only hair,
// clothes, skin and accessories differ.
(function () {
  const W = 160, H = 118;
  // Where each pose stands. dx/dy shift the whole figure; onDesk draws it
  // in front of the desk with its feet on the desktop, otherwise it stands
  // behind the desk, beside the monitor.
  const PLACEMENT = {
    working: { dx: 0, dy: 0, onDesk: false },   // sitting behind the monitor
    done:    { dx: 40, dy: -23, onDesk: true }, // climbed onto the desk to wave
    blocked: { dx: 44, dy: -14, onDesk: false },
    alert:   { dx: 44, dy: -14, onDesk: false },
    idle:    { dx: 44, dy: -14, onDesk: false },
    unknown: { dx: 44, dy: -14, onDesk: false },
  };

  const SKIN = {
    porcelain: '#f7dcc4', fair: '#f1c9a5', olive: '#e0b48a', tan: '#c98e5a',
    brown: '#9c6535', deep: '#6b4423',
  };

  // hair: style + color. top: style + color (+ accent). pants: color.
  // extras: any of glasses, sunglasses, beard, moustache, earrings,
  // headphones, freckles, badge.
  const CHARACTERS = [
    { skin: SKIN.fair,      hair: { style: 'short',    color: '#3b2f2f' }, top: { style: 'plain',      color: '#4f7cff' }, pants: '#2b2f3f', extras: ['glasses'] },
    { skin: SKIN.brown,     hair: { style: 'long',     color: '#1c1512' }, top: { style: 'plain',      color: '#e4573d' }, pants: '#3d5a99', extras: [] },
    { skin: SKIN.olive,     hair: { style: 'bald',     color: '#8b8f99' }, top: { style: 'sweater',    color: '#3a9e6a' }, pants: '#2b2f3f', extras: ['beard'] },
    { skin: SKIN.deep,      hair: { style: 'afro',     color: '#171210' }, top: { style: 'plain',      color: '#f2c531' }, pants: '#1f2330', extras: [] },
    { skin: SKIN.porcelain, hair: { style: 'bun',      color: '#e8c56a' }, top: { style: 'turtleneck', color: '#8a5cf6' }, pants: '#2b2f3f', extras: ['earrings'] },
    { skin: SKIN.porcelain, hair: { style: 'spiky',    color: '#d9642a' }, top: { style: 'hoodie',     color: '#f0862e', accent: '#c4671c' }, pants: '#3d5a99', extras: ['freckles'] },
    { skin: SKIN.tan,       hair: { style: 'short',    color: '#b9bcc6' }, top: { style: 'blazer',     color: '#243a6b', accent: '#f4f4f8', tie: '#c0392b' }, pants: '#1a1d29', extras: [] },
    { skin: SKIN.fair,      hair: { style: 'mohawk',   color: '#2fa8ff' }, top: { style: 'plain',      color: '#1f1f26' }, pants: '#2b2f3f', extras: ['earrings'] },
    { skin: SKIN.olive,     hair: { style: 'ponytail', color: '#6b3f21' }, top: { style: 'plain',      color: '#2bb3a3' }, pants: '#b08d5a', extras: [] },
    { skin: SKIN.fair,      hair: { style: 'beanie',   color: '#7a4a2a', hat: '#d33f49' }, top: { style: 'hoodie', color: '#6f7d3a', accent: '#55612b' }, pants: '#2b2f3f', extras: [] },
    { skin: SKIN.tan,       hair: { style: 'short',    color: '#4a3423' }, top: { style: 'striped',    color: '#f4f4f8', accent: '#2b4c7e' }, pants: '#3d5a99', extras: ['headphones'] },
    { skin: SKIN.brown,     hair: { style: 'bob',      color: '#1c1512' }, top: { style: 'plain',      color: '#ff7ab6' }, pants: '#1f2330', extras: ['glasses'] },
    { skin: SKIN.porcelain, hair: { style: 'sides',    color: '#e6e6ea' }, top: { style: 'cardigan',   color: '#7b2d3e', accent: '#f4f4f8' }, pants: '#5c5f6b', extras: ['beard'] },
    { skin: SKIN.deep,      hair: { style: 'cap',      color: '#171210', hat: '#2d6a4f' }, top: { style: 'plain', color: '#f4f4f8' }, pants: '#1f2330', extras: [] },
    { skin: SKIN.fair,      hair: { style: 'short',    color: '#ff5fa2' }, top: { style: 'turtleneck', color: '#1f1f26' }, pants: '#1f1f26', extras: ['sunglasses'] },
    { skin: SKIN.porcelain, hair: { style: 'long',     color: '#f1d27a', band: '#e4573d' }, top: { style: 'plain', color: '#b39ddb' }, pants: '#3d5a99', extras: [] },
    { skin: SKIN.olive,     hair: { style: 'short',    color: '#1c1512' }, top: { style: 'vest',       color: '#f4f4f8', accent: '#9ccc3c' }, pants: '#5c5f6b', extras: ['moustache'] },
    { skin: SKIN.brown,     hair: { style: 'bun',      color: '#b9bcc6' }, top: { style: 'cardigan',   color: '#d4a017', accent: '#f9efd2' }, pants: '#2b2f3f', extras: ['glasses'] },
    { skin: SKIN.deep,      hair: { style: 'buzz',     color: '#171210' }, top: { style: 'hoodie',     color: '#c0392b', accent: '#962d22' }, pants: '#1f2330', extras: ['earrings'] },
    { skin: SKIN.porcelain, hair: { style: 'curly',    color: '#7a4a2a' }, top: { style: 'striped',    color: '#3a9e6a', accent: '#f4f4f8' }, pants: '#b08d5a', extras: ['freckles'] },
    { skin: SKIN.fair,      hair: { style: 'bob',      color: '#4a2f22' }, top: { style: 'striped',    color: '#3a9e6a', accent: '#f4f4f8' }, pants: '#2b3a5c', extras: ['earrings'] },
  ];

  // Head centre is (65, 44 + dy), radius 12. Hair pieces drawn before the
  // face sit behind it (long hair, afro); pieces drawn after sit on top.
  function hairBack(hair, dy) {
    const c = hair.color;
    switch (hair.style) {
      case 'long': return `<rect x="52" y="${34 + dy}" width="26" height="26" rx="7" fill="${c}"/>`;
      case 'bob': return `<rect x="52" y="${34 + dy}" width="26" height="18" rx="6" fill="${c}"/>`;
      case 'afro': return `<circle cx="65" cy="${41 + dy}" r="16" fill="${c}"/>`;
      case 'curly': return `<circle cx="56" cy="${38 + dy}" r="6" fill="${c}"/><circle cx="74" cy="${38 + dy}" r="6" fill="${c}"/><circle cx="65" cy="${32 + dy}" r="6" fill="${c}"/><circle cx="53" cy="${46 + dy}" r="4.5" fill="${c}"/><circle cx="77" cy="${46 + dy}" r="4.5" fill="${c}"/>`;
      case 'ponytail': return `<rect x="74" y="${36 + dy}" width="7" height="20" rx="3.5" fill="${c}"/>`;
      case 'sides': return `<rect x="51" y="${40 + dy}" width="6" height="10" rx="3" fill="${c}"/><rect x="73" y="${40 + dy}" width="6" height="10" rx="3" fill="${c}"/>`;
      default: return '';
    }
  }

  function hairFront(hair, dy) {
    const c = hair.color;
    const cap = `<rect x="53" y="${30 + dy}" width="24" height="10" rx="5" fill="${c}"/>`;
    switch (hair.style) {
      case 'short': return cap;
      case 'buzz': return `<rect x="54" y="${31 + dy}" width="22" height="7" rx="4" fill="${c}"/>`;
      case 'long': return cap + (hair.band ? `<rect x="53" y="${35 + dy}" width="24" height="3" fill="${hair.band}"/>` : '');
      case 'bob': return cap;
      case 'bun': return cap + `<circle cx="65" cy="${29 + dy}" r="5" fill="${c}"/>`;
      case 'ponytail': return cap;
      case 'spiky': return `<polygon points="53,${40 + dy} 55,${28 + dy} 59,${36 + dy} 62,${26 + dy} 66,${35 + dy} 70,${26 + dy} 73,${36 + dy} 76,${29 + dy} 77,${40 + dy}" fill="${c}"/>`;
      case 'mohawk': return `<rect x="61" y="${24 + dy}" width="8" height="14" rx="3" fill="${c}"/>`;
      case 'afro': return '';
      case 'curly': return '';
      case 'sides': return '';
      case 'bald': return '';
      case 'beanie': return `<rect x="52" y="${27 + dy}" width="26" height="14" rx="7" fill="${hair.hat}"/><rect x="52" y="${37 + dy}" width="26" height="4" fill="${hair.hat}" opacity=".6"/><circle cx="65" cy="${27 + dy}" r="3" fill="#f4f4f8"/>`;
      case 'cap': return cap + `<rect x="53" y="${29 + dy}" width="24" height="9" rx="4.5" fill="${hair.hat}"/><rect x="66" y="${35 + dy}" width="18" height="3.5" rx="1.75" fill="${hair.hat}"/>`;
      default: return cap;
    }
  }

  function faceExtras(ch, dy) {
    let s = '';
    for (const x of ch.extras) {
      switch (x) {
        case 'glasses':
          s += `<g fill="none" stroke="#2a2d3a" stroke-width="1.3"><circle cx="60" cy="${45 + dy}" r="3.6"/><circle cx="70" cy="${45 + dy}" r="3.6"/><line x1="63.6" y1="${45 + dy}" x2="66.4" y2="${45 + dy}"/></g>`;
          break;
        case 'sunglasses':
          s += `<rect x="55.5" y="${42 + dy}" width="8.5" height="6" rx="2" fill="#15161c"/><rect x="66" y="${42 + dy}" width="8.5" height="6" rx="2" fill="#15161c"/><rect x="63" y="${44 + dy}" width="4" height="1.5" fill="#15161c"/>`;
          break;
        case 'beard':
          s += `<path d="M55 ${46 + dy} Q65 ${62 + dy} 75 ${46 + dy} Q70 ${52 + dy} 65 ${52 + dy} Q60 ${52 + dy} 55 ${46 + dy} Z" fill="${ch.hair.color}"/>`;
          break;
        case 'moustache':
          s += `<rect x="59" y="${48.5 + dy}" width="12" height="2.6" rx="1.3" fill="${ch.hair.color}"/>`;
          break;
        case 'earrings':
          s += `<circle cx="53" cy="${48 + dy}" r="1.6" fill="#f2c531"/><circle cx="77" cy="${48 + dy}" r="1.6" fill="#f2c531"/>`;
          break;
        case 'headphones':
          s += `<path d="M52 ${44 + dy} A13 13 0 0 1 78 ${44 + dy}" fill="none" stroke="#2a2d3a" stroke-width="2.5"/><rect x="49.5" y="${41 + dy}" width="5" height="9" rx="2" fill="#2a2d3a"/><rect x="75.5" y="${41 + dy}" width="5" height="9" rx="2" fill="#2a2d3a"/>`;
          break;
        case 'freckles':
          s += `<g fill="#c47a4a" opacity=".8"><circle cx="58" cy="${49 + dy}" r=".9"/><circle cx="61" cy="${50 + dy}" r=".9"/><circle cx="69" cy="${50 + dy}" r=".9"/><circle cx="72" cy="${49 + dy}" r=".9"/></g>`;
          break;
      }
    }
    return s;
  }

  // Drawn over the torso (x 49..81, y 56..86 + dy).
  function topDetail(top, dy) {
    const a = top.accent;
    switch (top.style) {
      case 'hoodie':
        return `<path d="M55 ${58 + dy} Q65 ${52 + dy} 75 ${58 + dy} Q65 ${64 + dy} 55 ${58 + dy} Z" fill="${a}"/><line x1="62" y1="${62 + dy}" x2="61" y2="${72 + dy}" stroke="#f4f4f8" stroke-width="1"/><line x1="68" y1="${62 + dy}" x2="69" y2="${72 + dy}" stroke="#f4f4f8" stroke-width="1"/>`;
      case 'blazer':
        return `<rect x="59" y="${56 + dy}" width="12" height="30" fill="${a}"/><polygon points="59,${56 + dy} 65,${66 + dy} 71,${56 + dy}" fill="${a}"/><rect x="63" y="${57 + dy}" width="4" height="16" rx="1.5" fill="${top.tie}"/>`;
      case 'cardigan':
        return `<rect x="60" y="${56 + dy}" width="10" height="30" fill="${a}"/><circle cx="59" cy="${66 + dy}" r="1.2" fill="#1a1d29"/><circle cx="59" cy="${72 + dy}" r="1.2" fill="#1a1d29"/><circle cx="59" cy="${78 + dy}" r="1.2" fill="#1a1d29"/>`;
      case 'vest':
        return `<path d="M49 ${60 + dy} L57 ${56 + dy} L65 ${68 + dy} L73 ${56 + dy} L81 ${60 + dy} L81 ${86 + dy} L49 ${86 + dy} Z" fill="${a}"/>`;
      case 'striped':
        return `<rect x="49" y="${62 + dy}" width="32" height="4" fill="${a}"/><rect x="49" y="${70 + dy}" width="32" height="4" fill="${a}"/><rect x="49" y="${78 + dy}" width="32" height="4" fill="${a}"/>`;
      case 'turtleneck':
        return `<rect x="58" y="${51 + dy}" width="14" height="7" rx="3" fill="${top.color}"/>`;
      case 'sweater':
        return `<rect x="49" y="${56 + dy}" width="32" height="30" rx="8" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="1" stroke-dasharray="2 3"/>`;
      default:
        return '';
    }
  }

  function person(pose, ch, askColor = null) {
    // Sitting means working. Everyone else is on their feet: blocked with a
    // hand up, done waving, idle and unknown just standing by the desk.
    // askColor: a visitor at the boss's desk, standing with a question bubble
    // in the orchestrator's colour.
    const standing = pose !== 'working';
    const place = PLACEMENT[pose] || PLACEMENT.idle;
    const dy = place.dy;
    const shirt = ch.top.color;
    const armL = pose === 'working'
      ? `<rect class="arm arm-l" x="42" y="${62 + dy}" width="9" height="20" rx="4" fill="${shirt}"/>`
      : `<rect class="arm arm-l" x="40" y="${58 + dy}" width="9" height="24" rx="4" fill="${shirt}"/>`;
    let armR;
    if (pose === 'done') {
      armR = `<rect class="arm arm-r wave" x="90" y="${30 + dy}" width="9" height="30" rx="4" fill="${shirt}"/>`;
    } else if (pose === 'blocked' || pose === 'alert') {
      armR = `<rect class="arm arm-r raise" x="82" y="${28 + dy}" width="9" height="32" rx="4" fill="${shirt}"/>`;
    } else if (pose === 'working') {
      armR = `<rect class="arm arm-r" x="79" y="${62 + dy}" width="9" height="20" rx="4" fill="${shirt}"/>`;
    } else {
      armR = `<rect class="arm arm-r" x="81" y="${58 + dy}" width="9" height="24" rx="4" fill="${shirt}"/>`;
    }
    const bubble = askColor
      ? `<g class="bubble"><rect x="18" y="2" width="28" height="22" rx="6" fill="${askColor}"/><text x="32" y="18" text-anchor="middle" font-size="15" font-weight="700" fill="#1f2330">?</text></g>`
      : pose === 'blocked' || pose === 'alert'
      ? `<g class="bubble"><rect x="18" y="2" width="28" height="22" rx="6" fill="#ff5d5d"/><text x="32" y="18" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">${pose === 'alert' ? '!' : '?'}</text></g>`
      : pose === 'done'
        ? `<g class="bubble"><rect x="18" y="2" width="28" height="22" rx="6" fill="#38c172"/><text x="32" y="18" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">✓</text></g>`
        : '';
    const legs = standing ? `
        <rect x="53" y="${82 + dy}" width="10" height="26" rx="3" fill="${ch.pants}"/>
        <rect x="67" y="${82 + dy}" width="10" height="26" rx="3" fill="${ch.pants}"/>
        <rect x="51" y="${104 + dy}" width="13" height="5" rx="2" fill="#1a1d29"/>
        <rect x="66" y="${104 + dy}" width="13" height="5" rx="2" fill="#1a1d29"/>` : '';
    return `
      <g class="person-pos" transform="translate(${place.dx} 0)">
      <g class="person pose-${pose}">
        ${bubble}
        ${legs}
        <rect class="torso" x="49" y="${56 + dy}" width="32" height="30" rx="8" fill="${shirt}"/>
        ${topDetail(ch.top, dy)}
        ${armL}${armR}
        <g class="head">
          ${hairBack(ch.hair, dy)}
          <circle cx="65" cy="${44 + dy}" r="12" fill="${ch.skin}"/>
          <circle cx="60" cy="${45 + dy}" r="1.5" fill="#222"/><circle cx="70" cy="${45 + dy}" r="1.5" fill="#222"/>
          ${hairFront(ch.hair, dy)}
          ${faceExtras(ch, dy)}
        </g>
      </g>
      </g>`;
  }

  function desk(pose, opts = {}) {
    const screenOn = pose === 'working' || pose === 'blocked' || pose === 'alert' || pose === 'done' || pose === 'idle' || pose === 'away';
    const screenFill = pose === 'working' ? '#9fd0ff' : screenOn ? '#5b6f8a' : '#2a2f3d';
    // The boss gets a darker, longer desk with a high-back chair and a lamp;
    // a worker gets a small tag in its orchestrator's colour on the desk front.
    const boss = !!opts.boss;
    const wood = boss ? '#6b3a2a' : '#a5754d', leg = boss ? '#4a2718' : '#7a5433';
    return `
      <!-- chair back -->
      <rect x="${boss ? 44 : 47}" y="${boss ? 60 : 70}" width="${boss ? 42 : 36}" height="${boss ? 36 : 26}" rx="6" fill="${boss ? '#23283a' : '#2f3446'}"/>
      <!-- desk -->
      <rect x="${boss ? 4 : 10}" y="84" width="${boss ? 124 : 112}" height="10" rx="3" fill="${wood}"/>
      <rect x="${boss ? 12 : 18}" y="94" width="8" height="18" fill="${leg}"/>
      <rect x="${boss ? 112 : 106}" y="94" width="8" height="18" fill="${leg}"/>
      ${boss ? '<rect x="110" y="62" width="3" height="22" fill="#3a4052"/><path d="M100 64 L123 64 L119 56 L104 56 Z" fill="#f2c531"/>' : ''}
      ${opts.tag ? `<rect x="14" y="86" width="8" height="6" rx="1.5" fill="${opts.tag}"/>` : ''}
      <!-- monitor -->
      <rect x="38" y="52" width="54" height="34" rx="4" fill="#1f2330"/>
      <rect class="screen ${pose === 'working' ? 'glow' : ''}" x="42" y="56" width="46" height="26" rx="2" fill="${screenFill}"/>
      <rect x="60" y="86" width="10" height="4" fill="#1f2330"/>
      <!-- keyboard -->
      <rect x="48" y="79" width="34" height="4" rx="1" fill="#3a4052"/>`;
  }

  // A worker standing at the boss's desk with a question (no desk of its own).
  window.figureVisitorSVG = function figureVisitorSVG(character = 0, color = '#f2c531') {
    const ch = CHARACTERS[((character % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length];
    return `<svg class="figure visitor" viewBox="52 0 72 110" width="72" height="110" aria-hidden="true">${person('idle', ch, color)}</svg>`;
  };

  window.CHARACTER_COUNT = CHARACTERS.length;
  window.CHARACTERS = CHARACTERS;

  window.figureSVG = function figureSVG(pose, character = 0, opts = {}) {
    const place = PLACEMENT[pose];
    const ch = CHARACTERS[((character % CHARACTERS.length) + CHARACTERS.length) % CHARACTERS.length];
    const figure = pose === 'empty' || pose === 'away' ? '' : person(pose, ch);
    return `<svg class="figure" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
      ${place && !place.onDesk ? figure : ''}
      ${desk(pose, opts)}
      ${place && place.onDesk ? figure : ''}
    </svg>`;
  };
})();
