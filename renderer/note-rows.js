// Where notes go on the corkboard, shared by main (notes.js) and the board
// (corkboard.js). A note: { file, title, due (ms or null), status, created }.
(function (root) {
  // Local midnight after `now`.
  function endOfDay(now) {
    const d = new Date(now);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  // Open notes in the big board's two rows. now: overdue and today's by time,
  // then undated ones newest first. later: future days by time.
  function noteRows(notes, now) {
    const open = notes.filter((n) => n.status !== 'done');
    const end = endOfDay(now);
    const timed = (a, b) => a.due - b.due;
    const today = open.filter((n) => n.due !== null && n.due < end).sort(timed);
    const undated = open.filter((n) => n.due === null).sort((a, b) => b.created - a.created || String(b.file).localeCompare(String(a.file)));
    const later = open.filter((n) => n.due !== null && n.due >= end).sort(timed);
    return { now: [...today, ...undated], later };
  }

  // Open reminders past their time, oldest first.
  const dueNotes = (notes, now) => notes.filter((n) => n.status !== 'done' && n.due !== null && n.due <= now).sort((a, b) => a.due - b.due);

  // What the wall board shows in `slots` places, the last being the ＋:
  // { notes, more } where more is how many did not fit (shown as a "+N" stack
  // in place of the last note).
  function wallNotes(notes, now, slots) {
    const { now: first, later } = noteRows(notes, now);
    const all = [...first, ...later];
    const room = Math.max(1, slots - 1);
    if (all.length <= room) return { notes: all, more: 0 };
    return { notes: all.slice(0, room - 1), more: all.length - (room - 1) };
  }

  // The time on a note: "11:00", "Tomorrow 16:00", "Fri 09:00", "12 Nov 10:00".
  // late: past its time.
  function timeLabel(due, now) {
    if (due === null || due === undefined) return null;
    const d = new Date(due);
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const end = endOfDay(now);
    const late = due <= now;
    const startToday = end - 86400_000;
    let day;
    if (due >= startToday && due < end) day = '';
    else if (due >= end && due < endOfDay(end + 1000)) day = 'Tomorrow ';
    else if (due < startToday && due >= startToday - 86400_000) day = 'Yesterday ';
    else if (Math.abs(due - now) < 6 * 86400_000) day = `${d.toLocaleDateString('en-GB', { weekday: 'short' })} `;
    else day = `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })} `;
    return { text: `${day}${hm}`, late };
  }

  const api = { endOfDay, noteRows, dueNotes, wallNotes, timeLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.officeNoteRows = api;
})(typeof window !== 'undefined' ? window : globalThis);
