// Move HQ: the places the office can move to, and which one is in effect on
// a given day. A seasonal visit wins, then Surprise me's place of the day,
// else the user's pick. Purely visual; location-art.js draws them. Pure, so
// test/locations.test.js can check it in node.
(function () {
  const LOCATIONS = [
    { id: 'office', name: 'Office', note: 'Where it all started' },
    { id: 'garden', name: 'Garden', note: 'Sun hats on' },
    { id: 'space', name: 'Space station', note: 'Bubble helmets' },
    { id: 'beach', name: 'Beach club', note: 'Sunglasses on' },
    { id: 'north', name: 'North Pole', note: 'Santa hats' },
    { id: 'water', name: 'Under water', note: 'Masks and snorkels' },
    { id: 'midsommar', name: 'Midsommar meadow', note: 'Flower crowns' },
    { id: 'haunted', name: 'Haunted mansion', note: 'Witch hats' },
    { id: 'coffeehouse', name: 'Coffeehouse', note: 'Headphones on' },
  ];
  const SURPRISE = { id: 'surprise', name: 'Surprise me', note: 'A new place each day' };
  // Months count from 0, days are inclusive, in local time.
  const SEASONS = [
    { id: 'haunted', label: 'Halloween visit', month: 9, from: 24, to: 31 },
    { id: 'north', label: 'Christmas visit', month: 11, from: 1, to: 26 },
    { id: 'midsommar', label: 'midsummer visit', month: 5, from: 19, to: 25 },
  ];
  // Only these styles draw the office the way the locations are painted.
  const STYLES = ['modern', 'toybox'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const byId = (id) => LOCATIONS.find((l) => l.id === id) || LOCATIONS[0];
  const applies = (styleId) => STYLES.includes(styleId);
  const seasonOn = (date) => SEASONS.find((s) => date.getMonth() === s.month && date.getDate() >= s.from && date.getDate() <= s.to) || null;
  // Days since 1970 by the local calendar, so the day turns at local midnight.
  const dayNumber = (date) => Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);

  function hash(s) {
    let h = 0x811c9dc5;
    for (const c of String(s)) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  // Every place but the Office once per block of days, shuffled per block.
  // A block never starts with the place the last one ended on.
  const PLACES = LOCATIONS.filter((l) => l.id !== 'office').map((l) => l.id);
  function block(n) {
    const list = [...PLACES];
    let h = hash(`surprise:${n}`);
    for (let i = list.length - 1; i > 0; i--) {
      const j = h % (i + 1);
      [list[i], list[j]] = [list[j], list[i]];
      h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
    }
    return list;
  }
  // The day's place in its block, or the next one in the block that is not
  // in avoid (yesterday's place, tomorrow's seasonal visit).
  function placeOfDay(date, avoid = []) {
    const day = dayNumber(date), n = Math.floor(day / PLACES.length), i = day - n * PLACES.length;
    const list = block(n);
    if (list[0] === block(n - 1)[PLACES.length - 1]) [list[0], list[1]] = [list[1], list[0]];
    for (let k = 0; k < PLACES.length; k++) if (!avoid.includes(list[(i + k) % PLACES.length])) return list[(i + k) % PLACES.length];
    return list[i];
  }
  const dayFrom = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);
  // What Surprise me shows on a day: never the place of the day before or of
  // a seasonal visit the next day. Once a day steps aside, the days after it
  // step too, so the walk starts where the place is known for sure: the last
  // day of the latest visit, at most half a year back. Without visits the
  // blocks never repeat a place on their own.
  function surpriseFor(date, seasonal = true) {
    if (seasonal === false) return placeOfDay(date);
    let back = 0;
    while (back < 366 && !seasonOn(dayFrom(date, -back))) back++;
    let shown = back < 366 ? seasonOn(dayFrom(date, -back)).id : null;
    for (let k = back - 1; k >= 0; k--) shown = placeOfDay(dayFrom(date, -k), [shown, seasonOn(dayFrom(date, 1 - k))?.id]);
    return shown;
  }

  // The user's pick: a location id or 'surprise'.
  const pickOf = ({ location } = {}) => (location === SURPRISE.id ? SURPRISE.id : byId(location).id);

  // { id, why: 'season' | 'surprise' | 'pick', season?, back? }. back: the
  // first day after the visit.
  function inEffect(settings = {}, date = new Date()) {
    const pick = pickOf(settings);
    const season = settings.seasonal !== false && seasonOn(date);
    if (season) return { id: season.id, why: 'season', season, back: new Date(date.getFullYear(), season.month, season.to + 1) };
    if (pick === SURPRISE.id) return { id: surpriseFor(date, settings.seasonal), why: 'surprise' };
    return { id: pick, why: 'pick' };
  }

  // The line under the cards when the office is somewhere else than the pick.
  function status(settings, date = new Date()) {
    const e = inEffect(settings, date), pick = pickOf(settings);
    if (e.why === 'pick' || e.id === pick) return null;
    const name = byId(e.id).name;
    if (e.why === 'surprise') return `Today: ${name} (Surprise me) · somewhere new tomorrow`;
    return `Today: ${name} (${e.season.label}) · back to ${pick === SURPRISE.id ? SURPRISE.name : byId(pick).name} on ${MONTHS[e.back.getMonth()]} ${e.back.getDate()}`;
  }

  const api = { LOCATIONS, SURPRISE, SEASONS, STYLES, byId, applies, seasonOn, surpriseFor, pickOf, inEffect, status, dayNumber };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.officeLocations = api;
})();
