# The Herdquarters guide

Everything the office does, in detail. For the short version, see the
[README](../README.md).

The app's name is `productName` in package.json; `scripts/brand.js` (run on
install and by `npm start`) writes it and `assets/icon.icns` into the dev
Electron bundle so the Dock, Cmd+Tab and the menu bar show them instead of
"Electron". Change the name there and start the app again.

Your herdr agents as people in an office building. The first launch shows a
short welcome tour; Settings > General > Welcome tour shows it again.

- **Floor** = one git repo
- **Room** = one checkout. The door shows the branch name, with the folder
  name underneath. Solid border: main checkout, dashed: linked worktree.
- **Desk** = one pane. Agent panes get a person, plain shells an empty desk.

Poses: typing = working, red `?` with a raised hand = blocked on you,
green `✓` waving = finished since you last looked, sitting = idle.
Click a desk or a reception ticket to focus that pane in herdr and open it in
the terminal panel on the right. The panel streams the pane through
`herdr terminal session control <pane>` (JSON over pipes): herdr renders the
pane at the panel's size and sends frames, keystrokes and scrolls go back the
same way, a few milliseconds each way. herdr allows one controlling client
per pane: the app keeps one stream per pane (a double-click or a tab switch
racing a click does not start a second), and if a pane is still held by a
client that is gone, such as an earlier run of the app, the attach is retried
with takeover. Close it with the ✕ button or Cmd+W.
Cmd+Left/Right jump to line start/end, Cmd+Backspace/Delete delete to line
start/end (the readline keys, as Warp sends them). Cmd+V pastes text, and when the
clipboard holds an image (even with a link or HTML next to it, as Slack and
browsers add) it sends Ctrl+V to the agent so Claude Code picks the image up
from the clipboard, the same way it does in a normal terminal. Copying joins
the rows herdr wrapped a long line over (herdr redraws each row with a cursor
move, so xterm alone would break a long URL at every row). URLs are links:
click one to open it in the browser. While text is selected the frames are
held so the highlight stays on what you selected; copying, clicking, typing or
scrolling releases them. Hover a desk to see the last lines of its screen
without opening it.

The app icon is `assets/icon.svg`; `npm run icon` renders `icon.png` (dock
icon) and `icon.icns` (for packaging) from it. The welcome tour's scenes are
painted on a canvas by `renderer/scenes.js`; `npm run art` paints the same
scenes into `docs/images/` for the README, as looping animated PNGs
(`scripts/apng.js`).

## Terminals

- An empty desk is a plain shell pane. Click it to open it in the panel; it
  streams the same way an agent pane does.
- Hover a room's door and press **+** for a new terminal (a new herdr tab in
  that workspace).
- Hover a desk and press **✕** to close it. An idle shell closes at once; a
  shell with something running, or an agent, asks first.
- Hover an empty desk and press **✦** to start an agent there: Claude or
  Pi (`herdr agent start --kind claude|pi`). Once herdr detects it, the desk
  gets a person.
- In the panel, **Shift+Enter** and **Option+Enter** insert a newline in
  Claude Code instead of sending (the desk summary is tuned for Claude Code's
  screen too; for Pi it shows the last lines).

## Sidebar

The workspace tree on the left mirrors herdr's: repo, then each checkout with
its branch, then the panes in it. Agent rows show the character's name, the
pane title and its state; shell rows say `shell`; **+ shell** opens a new
terminal in that checkout, and **N closed** lists worktrees that are on disk
but not open. Click a repo's name to collapse it to one line (the line then
shows its agent count); the collapsed set is remembered. **+ repo** at the
bottom opens any folder as a new herdr workspace, which becomes a new repo
in the office when the folder is a git checkout. The focused pane is highlighted and the one open in the
terminal panel has a blue bar. Clicking a pane opens it, clicking a repo or
checkout scrolls the scene to it. The sidebar stays put when the terminal
takes the full window. Toggle it with **☰** in the top bar or in settings.

Settings (**⚙**) opens a window with four sections: Appearance,
Assistant, Agents and General. Appearance has ten color themes, each with a dark and a
light version (or **System** to follow macOS). The terminal keeps its own colors.
Drag its right edge to resize it; double-click the edge to reset the width.

### Right-click

Right-click a row in the sidebar, or a desk, pod sign or wall in the scene:

- **Pane**: Open, Open folder in editor, Rename…, Start Claude here / Start Pi here (shells), Close.
- **Checkout**: Open in editor, New terminal, New worktree…, Close room (a main checkout
  says Close repo: it leaves the office, the checkout stays on disk), and for
  linked worktrees Remove worktree from disk.
- **Repo**: New worktree…, Closed worktrees…, Collapse/Expand, Open another repo.

**Rename** sets the pane's label in herdr (so herdr shows it too). A named
pane shows that name instead of the character and terminal title, in the
sidebar, in reception and in the terminal
header; the office desk keeps the character's name. Clear the name to go back
to the automatic one.

## Orchestrators (office tabs)

The top bar has a card per tab: **Office** shows everything; **+** creates an
orchestrator. An orchestrator's card shows its full name, what the team is
doing (working, idle, done) and a progress bar of the board's tasks. A flag on
its top border says what waits on you ("1 question for you", "3 waiting on
you") or that a deploy alert is open. Give it a name, the root folder that holds your repos, a
worktree branch name, optionally a base, and the agent: Claude Code or Pi
(remembered for the next one). Rename one later with ✎ on its card (or
double-click the card); its slug, folder and branch stay. The app creates a herdr workspace
for the boss (its folder holds the brief, `BOARD.md` and
`orchestrator.json` under the app's data directory), marks that folder as
trusted (a new folder would otherwise stop the boss at the trust prompt),
starts the boss and opens its terminal: you
give it the task there, images included. Nothing else is opened.

**Claude or Pi.** `orchestrator.json` has `"agent": "claude"` or `"pi"`
(missing means claude, so older orchestrators keep running Claude). The boss,
its workers, QA and ops all start with that kind; the tab's tooltip shows it.
Per kind:

| | Claude Code | Pi |
|---|---|---|
| brief (boss, `qa/`, `ops/`) | `CLAUDE.md` | `AGENTS.md` |
| `orchestrate` skill | `.claude/skills/` | `.pi/skills/` |
| folder trust | `projects[<folder>].hasTrustDialogAccepted` in `~/.claude.json` | `<folder>: true` in `~/.pi/agent/trust.json` |
| restore | `claude --resume <id>` / `--continue` | `pi --session <session file>` / `--continue` |

herdr reports a Pi session as the path of its `.jsonl` file under
`~/.pi/agent/sessions/`; that path is what Restore reopens.

**Boss instructions** (settings) is a free-text box whose contents go into
every boss's brief as a "Standing instructions from the user" section, for
things like "keep replies short but say what is going on". It is saved when
the box loses focus and written into the brief of every running orchestrator
too; a boss reads its brief at the start of a session, so for one already at
work paste the text into its terminal as well.

**QA review** (settings) adds a reviewer: when all of a boss's tasks are done
it opens a second desk in its own room, an agent in the `qa/` subfolder
of the boss's folder with its own brief (`qa-brief.md`). The reviewer reads
the diff in every worktree against the base and judges readability, clean
code and whether the change follows the repo's patterns (tests and linters
already ran in the workers; the reviewer runs nothing) and writes a report to
the boss's inbox. The
boss turns `must` and `should` findings into worker tasks and asks again until
the verdict is approved. The switch is live: it sets a `qa` flag in every
running orchestrator, which the boss reads when it is about to finish.

**Ops agent** watches deploys. Ask the boss to monitor or watch a deploy
("watch the deploy of #412") and it opens a third desk in its room, an
agent in the `ops/` subfolder with its own brief (`ops-brief.md`). The agent
follows the pipeline with `gh` until the deploy is out, then compares the
service's errors, latency, logs, traces and task health against the hour
before, every ~15 seconds for 30 minutes (or what you asked for), using the
monitoring and cloud tools your agent has (MCP servers, skills or CLIs). It
only reads. An error that points at the deployed change raises an alert on that check; a regression with no
clear link to the change needs two checks in a row; not being able to check
is an alert too. The alert is a file in `alerts/` in the boss's folder. The office reads that folder directly,
so the alert does not wait for the boss: a red banner under the top bar on
every tab (with the dashboard link, **Go to tab** and **Dismiss**), a chime
(**Alert sound** in settings), an orange ⚠ flag on the tab's card, the ops agent on its feet with
a red `!` and an alert ticket first in reception. The boss also gets an inbox
message and has the repo's worker look into the cause without changing
anything, then asks you under `## Questions` whether to fix it. Dismiss writes
`dismissed: true` into the file; the banner also goes when the ops agent marks
the alert resolved, with a "Recovered" notice.

**Slack watcher** tells you when someone in Slack is waiting for your answer.
Under the boss's whiteboard, **Slack · …** opens a dialog: paste a Slack link
(Copy link on a message, thread or channel), or type `#channel` or `@name`, and
press Enter to watch it; ✕ stops watching. You can also ask the boss ("watch
#checkout-redesign"), and it adds the thread of any Slack link in a task on its
own. The list is `slack/WATCHES.md` in the boss's folder. The office runs the
clock (every 10 minutes by default, set in the dialog): it starts a Claude agent
in `slack/` (brief: `slack-brief.md`), then before each check types `/clear` and
sends "Check Slack now", so the agent's context does not grow over the day. Its
memory is `slack/state.json`. Its `.claude/settings.json` allows the Slack read
tools and denies every Slack write tool, so it never stops at a permission
prompt and never posts. In a thread or DM, a message asking you something after
your last reply counts as waiting. In a channel, so do @-mentions of you or your
groups, replies in threads you posted in, and unanswered questions to the room
that look related to the orchestrator's work (when it cannot tell, it counts).
Each one is a file in `slack/waiting/` and shows as one reception ticket per
orchestrator, with the newest message. The ticket is highlighted while there
is something you have not seen in the dialog, and again when a message is
still waiting a day after you last opened it; otherwise it sits muted at the
end of reception. A reply or any emoji reaction from you, an answer from
someone else to a room question, or **Dismiss** in the dialog clears it. The
office has to be running for checks to happen.

**Free desks and suggestions.** Every boss room shows a **QA**, an **Ops** and
a **Slack** faded until someone sits there. Hover one for what it does; click it to
send the boss a ready-made prompt ("Run the QA review now", "Watch the deploy
of … to prod for 30 min") you can edit first. The boss also writes up to three
suggestions under `## Next` on the board when one fits, such as when you say you
are merging, a deploy starts, a flag goes on or all tasks are done. They show as
chips under the tabs (the row shows only when there are suggestions): a click sends one, ✕ declines it (kept in `declined`
in `orchestrator.json` so it is not suggested again).

The boss reads the task and decides which repos it needs. For each one it
creates the worktree on the branch (`herdr worktree create`), which opens as
a new room, starts a worker (the orchestrator's agent kind) in that room's pane, and works through
it with `herdr agent prompt`, `wait` and `read`. It never edits code itself
and keeps `BOARD.md` as a short task summary. The office recognises the
orchestrator's rooms by the branch: any checkout on that branch belongs to it
and the agents there are its workers. A repo can have more than one room: for
a second checkout, say two alternative implementations to compare, the boss
uses the branch `<branch>--<variant>` (git allows one worktree per branch),
and every `<branch>--…` checkout counts as the orchestrator's too. A
sub-ticket of a parent ticket can have its own branch: when one of the boss's
workers (named `<slug>-<repo>`) sits in a checkout on another branch, the
office claims that branch for the orchestrator (`branches` in
`orchestrator.json`), so the room stays in its tab. Closing the tab removes
those worktrees as well.

### Questions

Workers talk back to the boss through an inbox in the boss's folder: one
file per message, `question` or `done`, then they go idle so the boss wakes up
from `herdr agent wait`. A worker with an open question leaves its chair and
stands in the boss room with a bubble in the orchestrator's colour; its own
desk reads "at the boss" and the sidebar says `asking`. When the boss cannot
answer, it puts the question under `## Questions` on the board: the boss gets
the red ? (the sidebar says `asks you`), and reception gets one "needs you"
ticket for that boss, however many questions are open (hover it for the
list). Click it to open the tab and the boss's terminal, and answer there;
the boss relays the answer to the worker and clears the question. The boss's playbook lives in a `orchestrate` skill written into its
folder (`orchestrator-skill.md`).

An orchestrator's tab shows the boss room and only the assigned checkouts,
with the sidebar and reception filtered the same way. Give the boss tasks in
its terminal. Each tab remembers the terminal you last opened on it and brings it back
when you return, if that pane still exists; an orchestrator's tab with
nothing remembered opens the boss. With many orchestrators the cards
wrap onto a second row, then the top bar scrolls. The
boss room has a whiteboard: hover for the board (tasks with owners,
blockers) and the live state of each worker. On a long board, units with
work ahead (a `###` group or a ticket key such as `ABC-2801`) list their open
steps, and finished units fold to one line. Click the whiteboard to pin the
card: it scrolls, a click on a folded line opens it, and Escape or a click
elsewhere closes it. Workers carry the orchestrator's
colour on their desk and in the sidebar, where the right column reads `sub`
and the boss reads `orch`.

Close a tab with its ✕ (or right-click it). Closing stops the boss and its
workers and **removes the orchestrator's worktrees from disk** (the branch is
kept). The dialog lists what each worktree holds (uncommitted files, unpushed
commits) and offers to commit everything with one message and push each
branch first, or to discard. A failed commit or push aborts before anything
is removed. The wizard warns when the branch you type already has a worktree
in one of the repos, since the boss would reopen it with an earlier run's
leftovers. The folder is archived. Tabs are rebuilt from disk on
restart; an orchestrator whose boss workspace is gone (a herdr restart does
that) is archived with a notice. See `../designs/orchestrator-tabs.md` and `../designs/ops-agent.md`.

**Restore** brings an archived orchestrator back: press **Restore…** on that
notice, right-click **+**, or use the link in the new-orchestrator dialog. The
list shows each one's branch, when and why it ended and its task count. Restore
moves the folder back, gives the boss a new workspace and reopens its last
conversation there (`claude --resume` with the session id recorded while it
ran, `pi --session` with the recorded session file, or `--continue` for older
archives); with no saved conversation it starts
a fresh boss, which picks up from the board and inbox. The brief is rewritten
with the current settings. Workers are not restarted: the boss reopens the
worktrees it needs. An orchestrator cannot be restored while one with the same
name is open.

## The assistant

A little pixel bird lives in the office: PiPi, your assistant (`assistant.js`,
brief in `assistant-brief.md`). Give it another name under **Settings →
PiPi → Name**; the office, the chat and the bird's own brief use it from
then on. It is a headless Claude session
(`assistant-session.js`: `claude -p` with stream-json in and out) that the
office keeps running and resumes after a restart. Click the bird to chat; its
answers stream into the chat window as markdown, and its links open things in
the office: a person opens that agent's terminal (`hq://desk/<pane>`), a
ticket its room (`hq://tab/<slug>`), Slack findings the Slack dialog. The
office keeps `OFFICE.md` in its folder up to date with every ticket and desk
so it knows what to link. A **🐦 PiPi** tab bottom right opens the chat too,
with a dot when PiPi has something for you.

The first time, it gets to know you. On weekdays from the morning time
(settings, 08:30 by default) it gives a brief: what waits on you across every
orchestrator and in Slack, today's meetings (Microsoft 365, once connected and
allowed) and reminders. Ask it to remind you of something and it writes a file
to `reminders/`; the office fires it on time with a chime and a bubble, and ✓
marks it done.

Its memory is plain markdown in `<app data>/assistant/memory/`: `ME.md` (you),
`NOW.md` (current focus), `INDEX.md` and one card per project in `projects/`
with pointers to where the details live (boards, archives, PRs, threads), and
`journal/` for each day's notes. It reads only the first three up front and
follows the pointers when it needs more. After a quiet half hour, about once a
day, the office asks it to **dream**: fold the journal into the cards, merge
and prune, delete old journal days. Then it starts a fresh session, so its
context stays small.

PiPi (`renderer/bird.js`, sprite frames in `renderer/pipi-sprite.js`) is
drawn on a canvas over the office: shaded pixel art in the theme's accent
color, with squash and stretch, a walk and a flap cycle and particles. It
walks along the edges it perches on and flies between ticket cards, room
signs, desks and reception, with a shadow under it. It watches the cursor and
startles (dropping a feather) when you sweep past fast; hover to make it happy,
hold to pet it (hearts), double-click for a flip. When a ticket has something
waiting on you it pecks at that card; when a ticket's tasks are all done it
celebrates there with confetti. It talks while it answers, yawns and
stretches when it wakes up, gets sleepy late in the afternoon, and sleeps in
its nest by the chat tab at night and while it dreams. For a due reminder or
the morning brief it hovers under the top bar with a bubble.

## The office

A cozy pixel office, drawn in the same style as the welcome tour. Each repo
is one room sized to what is in it, so several repos share a row when they
fit. The back wall has windows with a cloudy sky (fewer in narrow rooms),
a sign with the repo name and agent count, the worktree buttons, and a door.
Each checkout is a rug on the wooden floor with a sign for the branch and
folder, potted plants in the corners, and desks in rows of up to three. A
pod is as wide as the desk columns it needs, and pods wrap into rows on the
floor. Desks carry the character's name on the nameplate; the pane's title
shows on hover and in the terminal header. People face you from behind
their desk: working types at a glowing laptop, idle leans back with eyes
shut, blocked and alert stand up with a hand raised, and done climbs onto
the desk to wave.
A desk's terminal opens beside the office (split view) or takes the whole
window, as set in settings; **⤢** in the terminal header switches on the spot.
In split view, drag the divider between the office and the terminal to resize
them; double-click it to reset. Close the terminal to get back to the office.

Each room in the Office layout has office animals (`renderer/animals.js`):
a cat (Måns, Sixten, Majken, Smulan or Doris) and a dog (Bamse, Ludde,
Kajsa, Tussan or Sigge). They go where they are useful. The cat sits beside
a desk that needs you (blocked or alert), otherwise naps on a working desk.
The dog wags and hops at a desk that just finished, otherwise sits by one
that needs you, otherwise lies at the feet of someone working. With nothing
to do, both stroll along the floor. They trot over when their spot changes;
click one to pet it. **Office cats** and **Office dogs** in settings switch
each kind on or off; the 🐾 in the top bar hides them all and brings back
the ones that are switched on.

Every agent pane is drawn as one of 21 characters (`renderer/figure.js`),
assigned on first sight so no two agents in the office look alike while there
are 21 or fewer.

## Settings

The gear in the top bar opens settings: the theme, office size (zooms
the office and reception, not the terminal), whether the terminal opens as a
split panel beside the office (the default) or takes the full window, the
split panel width, the workspace sidebar, the editor command for "Open in
editor", the alert sound, and the two orchestrator options above (boss
instructions and QA review). The ⤢ button in the terminal header toggles split
and full on the spot. Dragging the divider between the office and the split
terminal sets the same panel width (the slider follows); double-click it to
go back to 46%. Settings are stored in
the app's local storage.

## Worktrees

- Hover a floor and press **+ worktree** to create a branch and checkout
  under `~/.herdr/worktrees`; it opens as a new room.
- Worktrees that exist on disk but are not open are not drawn. The floor label
  shows **N closed**; press it for a list where each one can be opened or removed.
- Hover a door and press **‹›** to open the checkout in your editor. The
  command comes from settings (**Editor**, default `code`); flags are allowed
  and the folder is passed as the last argument, with no shell in between.
- Hover a door and press **–** to close the room. A linked worktree stays on
  disk and moves to the floor's closed list; a main checkout leaves the office
  and comes back with **+ repo**. If agents are still in the room a dialog
  lists them first, since closing shuts them down.
- Hover a linked worktree's door and press **✕** to remove the checkout from
  disk. A dialog confirms, warns about agents still in the room, and offers
  a force option for uncommitted changes. The branch itself is kept.

Note: attaching resizes the shared pane to the panel's size, so the pane in
your herdr window follows the panel width while it is open.

## Run

```sh
npm install
npm start
```

Reads the herdr socket at `~/.config/herdr/herdr.sock` (override with
`HERDR_SOCKET`). Subscribes to structure and agent-status events and
re-fetches `session.snapshot` on change, with a 3 s fallback poll.
When nothing listens on the socket at launch, it starts `herdr server` there
itself and leaves it running after it quits; a later outage is left alone.
Turn this off with "Start herdr" in settings. The server's output goes to
`herdr-autostart.log` in the app's data folder.

## Dev flags

- `OFFICE_FIXTURE=1 npm start` renders a fake session with every pose and many of the characters.
- `OFFICE_DEV_SETTINGS='{"theme":"ocean"}' npm start` applies a settings patch on launch;
  `{"activeTab":"search-relevance"}` opens the fixture's orchestrator tab.
- `OFFICE_ASSISTANT=talk|dream|idle|wave` sets the assistant's mood in fixture runs, `OFFICE_CHAT=1` opens its chat.
- `OFFICE_MODAL=<create|closed|remove|orchestrator|archived|slack:<slug>> npm start` opens that dialog on launch;
  `OFFICE_TOOLTIP=<pane_id>` shows a desk tooltip; `OFFICE_SETTINGS_OPEN=1` opens settings.
- `OFFICE_OPEN=<pane_id> npm start` opens that desk's terminal on launch.
- `OFFICE_USER_DATA=/tmp/agent-office-dev npm start` runs a second window beside the
  real app, for trying a branch. It keeps settings and orchestrators in that folder,
  skips the one-window lock and never starts herdr; it connects to the running herdr,
  so the desks and terminals are real. Opening a desk there resizes that pane for
  both windows, as any attach does.
- `OFFICE_WELCOME=<step> npm start` opens the welcome tour at that step (1–7). Screenshot
  runs skip the tour otherwise.
- `HERDR_BIN=/path/to/herdr` overrides the herdr binary used for the terminal stream and autostart.
- `OFFICE_SCREENSHOT=/path/out.png npm start` captures the window and quits. Screenshot
  runs use a temporary data directory so they do not block on the running app's
  localStorage lock; pass settings with `OFFICE_DEV_SETTINGS`.
