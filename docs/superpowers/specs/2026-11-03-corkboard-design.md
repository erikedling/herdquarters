# Corkboard: todos and reminders you can see and edit

Mockups: https://claude.ai/artifact/FsJVsnj6Pc5ezkg1barXPu (the top section, "Your pick", is the design. The rest of the page shows options that were turned down.)

## Why

Today reminders only exist through PiPi. You ask in chat, PiPi writes
`<userData>/assistant/reminders/<YYYYMMDD-HHMM>-<name>.md`, and when one is due
a ⏰ line with a ✓ shows in PiPi's speech bubble (`renderer/assistant.js`
`renderBubble`). You can't see upcoming reminders anywhere and you can't add,
change or remove one without chatting. There are no todos at all.

The user wants todos and reminders to be a visible part of Herdquarters. They
want to look at them and to add, change and remove them by hand, while PiPi can
still do the same through chat.

## Goals

- A **corkboard** on the office wall with a **sticky note** per open todo.
- Add, open, edit, complete and remove notes by hand, without PiPi.
- A note has a **title**, optional **details** (long text, only shown when
  the note is open), an optional **time** and a **color** (10 colors).
- **A note with a time is a reminder.** There is one list. Reminders fire as
  they do today: a chime and a line in PiPi's bubble.
- **PiPi reads and writes the same notes.** Whatever it adds through chat shows
  up on the board, and whatever you do on the board is what PiPi sees.
- A **big board** that opens over the office and shows every note, for when the
  wall board is full.
- A **pixel-art menu bar**, styled as a wooden plaque, at the far right of
  reception. It has the corkboard, sidebar and settings buttons.
- A cleaner **top bar**: a small pixel logo and the tabs only.

## Non-goals

- Snooze, repeating reminders, due-date pickers beyond "pick a day and time".
- Drag to reorder or drag between rows (could come later).
- Several boards (per tab or per project).
- Syncing with any outside todo app or calendar.
- Changing how the dart board works.

## Anti-goals (would be a failure even if it works)

- The board feels like a generic web form pasted into the pixel office. It must
  look like it belongs next to the building, PiPi and the dart board.
- A note you edit by hand gets overwritten by PiPi, or a note PiPi adds doesn't
  show up until a restart.
- A reminder that used to fire stops firing after the change, including
  reminders written before this feature existed.
- The board only works while PiPi is turned on. The notes belong to the user,
  and the board works with the assistant off.

## What it looks like

### Top bar

- `.brand` loses the gradient square and the "Herdquarters" text. In their
  place is a 12×12 pixel logo of the building from `docs/images/welcome.png`
  (red roof line, peach wall, blue windows, brown door, a strip of grass). The
  pixel map is in the mockup page's script (`ART.logo`). The app name stays as
  the element's `title` (and `document.title`), so `#brand-name`'s job moves
  to a tooltip.
- The 🐾, ☰ and ⚙ buttons leave the top bar.
- **🐾 is removed.** Cats and dogs are still turned on and off under
  Settings → Appearance. `petsHidden` is no longer settable from the UI. On
  load, treat a stored `petsHidden: true` as false, so nobody is left with
  hidden pets and no way to bring them back.

### Menu bar in reception

- It sits at the far right of `#reception`, after `#reception-list`, and never
  scrolls or gets pushed out. Reception cards shrink and cut long text off with
  "…" before the menu bar does.
- **Look (picked: wooden plaque).** A plank in the same wood as the corkboard
  frame: fill `#8a5a2b`, a 2px `#4a2f17` border, a lighter top inner line
  `#b07a45`, a darker bottom inner line `#5c3a1c`, and a 4×4 nail
  (`#d8c3a0`) in the top corners. The buttons have no fill of their own: on
  hover they turn a lighter wood, and when pressed or on they turn a darker
  wood with an inset shadow. Edges are hard, with no border radius.
- **Buttons, left to right.** Each icon is 12×12 pixel art (maps in the
  mockup's `ART.note`, `ART.side`, `ART.gear`), drawn crisp:
  1. **Corkboard.** It opens the big board. It has a red badge with the number
     of open notes. When a reminder is due, the button wiggles.
  2. **Sidebar.** Same as today's ☰ (`settings.sidebar`).
  3. **Settings.** Same as today's ⚙.
- The plaque keeps the same wood colors in every theme, like the corkboard. The
  focus ring uses the theme's accent.

### Corkboard on the wall

- It hangs on the wall to the right of the building: its own column in
  `#workspace`, after `#building`, so it never covers a room. The dart board
  stays inside the building's right edge. While a terminal is open beside the
  office, the column hides and the corkboard button still opens the big board.
  It is drawn in the office's pixel style: a cork fill
  (`#8a6a45`), a `#5c4128` frame and a hard drop shadow.
- It shows open notes as sticky notes in a grid that fits the space (about 6–8
  in a normal window). Each note shows:
  - the title (cut off after two lines),
  - its time if it has one ("⏰ 15:00", "⏰ Fri 09:00"), in a mono face,
  - a ≡ mark in the corner when it has details,
  - a red pin at the top. Notes tilt slightly, alternating, like the mock.
- An **overdue** reminder shows "late" after its time. A **due** reminder
  wiggles until it is dismissed.
- The last spot is a dashed **＋** that adds a note.
- When there are more open notes than fit, the last note spot becomes a
  **"+N more"** stack, and clicking it opens the big board.
- Which notes are on the wall: overdue first, then today's by time, then undated
  ones newest first, then later ones by time. Whatever doesn't fit goes into
  "+N more".
- PiPi treats the board as a perch (add it to `PERCH` in `renderer/bird.js`).
  When PiPi creates a note, it flies to the board.
- While the big board is open, the wall board and the dart board are hidden.

### An open note

Clicking a note opens it in a small popover next to the board, in the app's
panel style, with a 6px strip along the top in the note's color:

- **Title**: bold, up to two lines tall. A newline becomes a space.
- **Details**: a multi-line text area for longer text. It's only shown here,
  never on the board.
- **Remind me**: a native date and time field (`datetime-local`) with a ✕ to
  clear it. Clearing the time turns the reminder into a plain todo.
- **Color**: 10 swatches: yellow `#ffe27a`, orange `#ffb06b`, pink `#ffb8c6`,
  red `#ff8f8f`, lilac `#d4b8ff`, sky `#a9c4ff`, teal `#8fe3e0`, mint
  `#9fe3b8`, lime `#d8f07a`, paper `#f4efe6`. New notes are yellow.
- **Remove** deletes the note. **✓ Done** completes it.
- Edits save as you type (debounced). Esc or a click outside closes the
  popover. A new note opens with the title focused, and a note left with an
  empty title is thrown away when the popover closes.

### Big board

- The corkboard button (or "+N more") opens a large corkboard over the office
  area. It doesn't cover the top bar or reception.
- It has two labeled rows: **Overdue · Today** (overdue, then today's by time,
  then undated) and **Later** (future days by time). Notes are the same as on
  the wall, a little bigger, with titles in full.
- A ＋ in each row adds a note. A note added in Later starts with tomorrow
  09:00.
- Clicking a note opens the same popover. Esc, the button again or a click
  on the dimmed edge closes the big board.

## How it works

### Storage: notes are files, like reminders are today

Notes live in `<userData>/assistant/notes/`, one markdown file per note,
read with the existing `readInbox` / `setFrontmatter` helpers in
`orchestrators.js`:

```markdown
---
title: Call Noor
due: 2026-11-03T15:00:00+01:00
color: pink
status: open
created: 2026-11-03T08:12:00+01:00
---
About the onboarding flow for the new billing page.

- Ask if the 14-day trial starts at signup
```

- The body is the **details**. `due` is optional (missing means a plain todo).
  `color` is one of the ten names (unknown or missing means yellow). `status`
  is `open` or `done`.
- File name: `<YYYYMMDD-HHMMSS>-<slug>.md` from the creation time, unique by
  adding `-2` and so on. The renderer never builds paths; it sends file names,
  and main checks them with `path.basename(file) === file` as
  `dismissReminder` does.
- **Migration.** The first time the store prepares, each file in `reminders/`
  moves to `notes/`. The first line of the old text becomes the title, the
  rest becomes the details, and `due` and `status` carry over. Then
  `reminders/` is left empty. Old reminders keep firing.
- Done notes stay on disk with `status: done`. PiPi's dream already prunes
  done reminders older than 7 days. Point that rule at `notes/`.

### Main process

- Add a `NotesStore` (new file `notes.js`, pure functions plus a small class
  over a folder) with `list()`, `create({ title, details, due, color })`,
  `update(file, patch)`, `done(file)` and `remove(file)`, plus pure helpers
  that are easy to test: `parseNote`, `noteRows(notes, now)` (sorts into
  overdue / today / undated / later) and `dueNotes(notes, now)`.
- The store doesn't depend on the assistant being on or its session running.
  `ensureAssistant()` creates the folder today. The notes store must work when
  the assistant is disabled.
- IPC in `main.js`: `notes-list`, `notes-create`, `notes-update`, `notes-done`
  and `notes-remove`, plus a `notes` event that pushes the full list to the
  renderer after any change.
- **Seeing PiPi's edits live.** Watch `notes/` with `fs.watch` (debounced about
  200 ms) and push `notes` on any change. Also push on the existing 30 s
  `assistantClock`, as a fallback.
- **Reminders.** `AssistantStore.view()` takes `due` / `upcoming` from the
  notes store instead of `reminders/`. Each item has a `title` (the bubble
  shows the title). `dismissReminder` becomes `notes.done(file)`. The chime
  and bubble keep their current behavior.
- `OFFICE_FIXTURE` mode returns a handful of example notes covering every
  color, a due one, an overdue one, a later one and one with details, so
  screenshots and the welcome flow show a full board.

### PiPi

- Update `assistant-brief.md`. "Reminders" becomes "Notes and reminders": it
  covers the file format above and says to use `title` for the short line and
  the body for context and links. To finish a note, set `status: done`. To
  change one, edit its frontmatter and keep the user's own text. Never
  rewrite a note's details unless asked. "What waits on the user" and the
  morning brief read from `notes/`.
- PiPi's permissions already allow `Edit(./**)` in its folder. Nothing new is
  needed.
- When PiPi creates a note, the renderer sees a new file and flies the bird to
  the board for a moment (`officeBird`).

### Renderer

- A new `renderer/corkboard.js` for the wall board, the big board and the note
  popover. The pixel icons and logo get a small shared helper that turns a
  pixel map into an SVG or a canvas.
- `renderer/settings.js`: the sidebar and settings buttons move into the menu
  bar, and the pets button and its handler are removed.
- `renderer/index.html` / `style.css`: the top bar markup, the menu bar inside
  `#reception`, and the board styles.

## Testing

- Dev flag `OFFICE_CORKBOARD=big|note|both` opens the big board and/or a note
  on launch, for screenshots.
- `node --test`: `parseNote`, migration from `reminders/`, `noteRows` sorting
  around midnight and for undated and overdue notes, `dueNotes`, file-name
  checks that reject paths, and color fallback.
- Update `test/settings-layout.test.js` for the moved buttons and the removed
  pets button. Add a test that a stored `petsHidden: true` loads as false.
- Take an `OFFICE_FIXTURE` screenshot (`OFFICE_SCREENSHOT`) to check the board,
  the menu bar and the top bar by eye in light and dark themes.

## Left to the builder

- Exact pixel sizes, note grid spacing and how many notes fit at each window
  size.
- The day and time picker inside the popover. It must be keyboard friendly and
  not a browser `prompt()`.
- Whether the wall board and the big board share one canvas or use DOM
  elements. DOM is likely easier for text and focus.
- Animation details (wiggle, PiPi flying to the board), as long as they respect
  `prefers-reduced-motion`.
