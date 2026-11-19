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
from the clipboard, the same way it does in a normal terminal. A file copied
in Finder pastes as its path instead, and files dropped on the panel (it gets
a dashed outline while you drag) type their paths; Claude Code attaches a path
to an image as the picture. Copying joins
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
- Hover an empty desk and press **✦** to start an agent there: Claude,
  Pi or Codex (`herdr agent start --kind claude|pi|codex`). Once herdr detects it, the desk
  gets a person.
- In the panel, **Shift+Enter** and **Option+Enter** insert a newline in
  Claude Code instead of sending (the desk summary is tuned for Claude Code's
  screen too; for Pi and Codex it shows the last lines). Option types the
  keyboard layout's characters (@ is Option+2 on Swedish - Pro), and
  **Option+Left/Right** jump a word. **Option+P**, **Option+O**, **Option+D**
  and **Option+Y** go to Claude Code as its shortcuts (switch model, fast mode,
  delete word forward, yank-pop), so π œ ∂ µ (on Swedish - Pro) can't be typed
  in the panel.

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
takes the full window. Toggle it with the sidebar button on the menu bar in reception, or in settings.

Settings (**⚙**) opens a window with five sections: Appearance, Move HQ,
Assistant, Agents and General. Appearance has ten color themes, each with a dark and a
light version (or **System** to follow macOS). The terminal keeps its own colors.
Drag its right edge to resize it; double-click the edge to reset the width.

### Right-click

Right-click a row in the sidebar, or a desk, pod sign or wall in the scene:

- **Pane**: Open, Open folder in editor, Rename…, Start Claude here / Start Pi here / Start Codex here (shells), Close.
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
worktree branch name, optionally a base, and the agent: Claude Code, Pi or Codex
(remembered for the next one). Rename one later with ✎ on its card (or
double-click the card); its slug, folder and branch stay. The app creates a herdr workspace
for the boss (its folder holds the brief, `BOARD.md` and
`orchestrator.json` under the app's data directory), marks that folder as
trusted for Claude/Pi (Codex keeps its own trust/approval prompts),
starts the boss and opens its terminal: you
give it the task there, images included. Nothing else is opened.

**Claude, Pi or Codex.** `orchestrator.json` has `"agent": "claude"`, `"pi"` or `"codex"`
(missing means claude, so older orchestrators keep running Claude). The boss,
its workers, QA and ops all start with that kind; the tab's tooltip shows it.
Per kind:

| | Claude Code | Pi | Codex CLI |
|---|---|---|---|
| brief (boss, `qa/`, `ops/`) | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` |
| `orchestrate` skill | `.claude/skills/` | `.pi/skills/` | `.agents/skills/` |
| folder trust | `projects[<folder>].hasTrustDialogAccepted` in `~/.claude.json` | `<folder>: true` in `~/.pi/agent/trust.json` | Native interactive prompts; global config is not rewritten |
| restore | `claude --resume <id>` / `--continue` | `pi --session <session file>` / `--continue` | `codex resume <id>` / `resume --last` |

herdr reports a Pi session as the path of its `.jsonl` file under
`~/.pi/agent/sessions/`; that path is what Restore reopens.

Codex uses its native interactive CLI, [AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
briefs and [skills](https://developers.openai.com/codex/skills), not Claude's
headless protocol. Install and sign in to Codex before starting it. Accept any
first-run, folder trust or permission prompts in its embedded terminal (including
worker, QA and ops terminals). If startup times out while a prompt is open,
complete that prompt in the existing terminal rather than launch another agent.
Codex boss startup and restore include
`--sandbox workspace-write --add-dir <configured repository root>`
(the `root` in `orchestrator.json`), so a boss in its data folder can clone and
create worktrees under that root. Generated worker, QA and ops launch commands
carry the same sandbox and extra writable root; paths with spaces are kept as one
argument. The explicit sandbox is required because read-only permissions reject
`--add-dir`, which can otherwise prevent startup in a new data folder.
Standalone shell-desk starts have no configured repository root and do not add
one. This does not grant access to inbox/helper folders or worktrees outside
that root: those may still need separate native permission approval.
Herdquarters does not bypass Codex's sandbox or change its global configuration.

Restore passes the session id recorded by herdr to `codex resume <id>`. If the
session has been deleted, Codex reports that error; no unrelated session is
silently substituted. For older archives without an id, `resume --last` uses
Codex's cwd-filtered lookup and starts fresh when none exists. The app cannot
distinguish those two outcomes from herdr's readiness response. This avoids
depending on Codex's private session-storage layout.

The assistant and Slack watcher are fixed-provider Claude services even for
Codex/Pi orchestrators. They still require Claude Code (and the watcher's Claude
Slack connector); selecting Codex does not migrate them.

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
#design-system"), and it adds the thread of any Slack link in a task on its
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
wrap onto a second row, then the top bar scrolls. Drag a card to reorder the
orchestrators (Office stays first, **+** last; Escape or a drop outside the
strip cancels), or move the focused card with Option+←/→. The order is kept per
machine in settings (`tabOrder`); new orchestrators go at the end. The
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
ran, `pi --session` with the recorded session file, `codex resume` with its
recorded id, or the kind's continue/last option for older archives); with no saved conversation it starts
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
so it knows what to link. The bird button on reception's menu bar opens the chat
too. Its badge shows how many answers you haven't read, or **!** when a
reminder is due or the brief is ready.

You can send it screenshots and other images: paste one into the chat (⌘V),
drop it on the chat, or pick it with 📎. Up to four go with a message, and
big ones are scaled down first. The last 40 are kept in `chat-images/` in its
folder, so they still show in the chat after a restart.

The first time, it gets to know you. On its days (settings, Monday to Friday
by default) from the morning time (08:30 by default) it gives a brief: what
waits on you across every orchestrator and in Slack, today's meetings
(Microsoft 365, once connected and allowed) and reminders. Ask it to remind you
of something, or to put something on your list, and it pins a note on the
corkboard (see below); the office fires a reminder on time with a chime and a
bubble, and ✓ marks it done. On the other days it stays
quiet: no brief, no calling you, no visits to tickets. Reminders still fire,
and it answers when you open the chat.

Its memory is plain markdown in `<app data>/assistant/memory/`: `ME.md` (you),
`NOW.md` (current focus), `INDEX.md` and one card per project in `projects/`
with pointers to where the details live (boards, archives, PRs, threads), and
`journal/` for each day's notes. It reads only the first three up front and
follows the pointers when it needs more. After a quiet half hour, about once a
day, the office asks it to **dream**: fold the journal into the cards, merge
and prune, delete old journal days. Then it starts a fresh session, so its
context stays small.

PiPi (`renderer/bird.js`, sprite frames in `renderer/pipi-sprite.js`) is drawn
on a canvas over the office: shaded pixel art in the theme's accent color, or
as a real bird. Pick one under **Settings → PiPi → Bird**: Theme (the
default), European robin, blue tit, European goldfinch, common kingfisher,
Eurasian bullfinch, northern cardinal, blue jay, scarlet macaw, rainbow
lorikeet, Gouldian finch, budgerigar, cockatiel, painted bunting,
lilac-breasted roller, keel-billed toucan, Atlantic puffin or Java sparrow.
Each species (`renderer/pipi-species.js`) is a palette for its plumage plus
its own crest, tail, beak, wing marks and head and body markings (the Java
sparrow also its eyes, chest mark and puffed cheeks); a bird without a crest
ruffles its head feathers instead. Every species does everything below, and
the feathers it drops are its own colors. A saved species that no longer
exists falls back to Theme. `npx electron scripts/pipi-previews.js <folder>`
renders an animated preview of each species, a sheet of every pose and every
species on every theme. It has squash and stretch, a walk and a flap cycle and
particles. It walks along the edges it perches on and flies between ticket
cards, room signs, desks and reception, with a shadow under it. It watches the
cursor and startles (dropping a feather) when you sweep past fast; hover to
make it happy, hold to pet it (hearts), double-click for a flip. When a ticket
has something waiting on you it pecks at that card; when a ticket's tasks are
all done it celebrates there with confetti. It talks while it answers, yawns
and stretches when it wakes up, gets sleepy late in the afternoon, and sleeps
in its nest on top of the menu bar at night and while it dreams. For a due
reminder or the morning brief it hovers under the top bar with a bubble.

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
each kind on or off.

Each space has its own look (`renderer/decor.js`), picked from its name so it
never changes: every repo's floor has its own wall color and wood, every room
(checkout) its own rug color and pattern (plain, stripes, dots, a border or a
checker), and every agent keeps their own mug and one personal thing on the
desk, like a plant, a rubber duck, a photo or a trophy. The boss floor keeps
the house look.

Every agent pane is drawn as one of 21 characters (`renderer/figure.js`),
assigned on first sight so no two agents in the office look alike while there
are 21 or fewer.

## The corkboard

Your todos and reminders are sticky notes on a corkboard on the wall to the
right of the building (`renderer/corkboard.js`). Each note has a title, longer
details that only show when you open it, an optional time and one of ten
colors. A note with a time is a reminder: it fires on time like the ones the
assistant sets, wiggles on the board while it is due, and shows "late" after
its time. Click a note to open it and edit it, ✓ **Done** finishes it,
**Remove** deletes it, and **＋** pins a new one. Changes save as you type.

The wall fits eight places. When there are more notes, the last one becomes a
"+N more" stack. The corkboard button on the menu bar (the wooden plaque at
the right end of reception, which also holds the sidebar and settings
buttons) opens the big board over the office, with every note in two rows:
**Overdue · Today** (then notes without a time) and **Later**. Its red badge
counts the open notes. While a terminal is open beside the office, the wall
board steps aside; the button still opens the big board.

Notes are markdown files in `<app data>/assistant/notes/` (`notes.js`), one
per note, and the assistant edits the same files: when it pins a note, the
bird flies to the board. Reminders from before the corkboard
(`assistant/reminders/`) move in as notes the first time they are read. The
board works with the assistant switched off.

## Plan usage

The right end of the status bar shows how much of your Claude and Codex plan
limits is left: a bar per window (5 hours and the week), the percentage
(`84% left`), and the time left until it resets (`↺2h05`). The bars drain as
you use the limit. Set it to show what is used instead (`16% used`, bars that
fill up) in Settings > General. Either way, a bar turns amber when 25% or less
is left and red at 10% or less.
Click it for every window, per-model weeks included, with the exact reset
times, when the numbers were checked, a ↻ to check now, and a warning when
Claude's sign-in ends within a week.

The numbers come from the CLIs themselves, so no token is read and nothing
is sent anywhere new (`usage.js`):

- **Claude**: `claude -p /usage --safe-mode` (no hooks, MCP servers, plugins
  or CLAUDE.md) with session saving off, run in an empty `usage-probe` folder
  in the app's data folder. It costs no tokens and takes about two seconds.
- **Codex**: `codex app-server`, asking `account/rateLimits/read` and stopping it.

A CLI that is not installed is left out; with neither, nothing shows. Signed out
or on a plan without limits, the popover says so instead of showing 0%.
When a check fails (offline, say), the last numbers stay, dimmed, with the time
they are from, and that provider is tried again after 5, 10, then 30 minutes.
The CLIs are found on `PATH` and in the usual install folders
(`~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.npm-global/bin`),
so a Dock launch finds them too.

**Usage limits** in Settings > General turns it on and off (on by default),
picks what it shows (remaining, the default, or used), and sets how often it
checks: every 5, 10 (the default), 15 or 30 minutes.
It also checks when the window gets focus and the numbers are over two minutes old.
Turning it off, or quitting, stops a check that is still running.

## Settings

**PiPi** holds the assistant's settings: on or off, its name, which bird it
is (Theme, in the accent color, is the default), the morning brief's time
and days, and the dart board. **Reset to defaults** sets every section back,
PiPi's bird to Theme too.

**Style** sets the shape of the whole app. **Toybox** is the default. **Modern** is the smooth, rounded look in your theme and dark/light mode. The five retro styles are pixel looks with hard edges, solid outlines and pixel fonts (`renderer/retro.css`, fonts bundled in `renderer/fonts/`, SIL Open Font License), and each brings its own colors, so the theme and mode only apply to Modern: **Workshop** (wood, cork and paper), **Quest** (16-bit RPG menus), **Handheld** (four shades of green), **Toybox** (the welcome screen's pastels) and **Workstation** (a beige early-90s desktop). The terminal keeps its own colors in every style. `OFFICE_DEV_SETTINGS='{"style":"quest"}'` opens in one.

**Move HQ** moves the office somewhere else, just for looks: Office (as it always was), Garden, Space station, Beach club, North Pole, Under water, Midsommar meadow, Haunted mansion or Coffeehouse, or **Surprise me** for a new place each day (never the Office, never yesterday's). Each place has its own walls, floor, window, door, plants, rugs, idle animation and dart board, one thing everyone wears (a sun hat, a bubble helmet, sunglasses…) and touches for the cat and the dog; the status bubbles stay the same. **Seasonal visits** (on by default) take the office to the Haunted mansion Oct 24–31, the North Pole Dec 1–26 and the Midsommar meadow Jun 19–25, local time, then back to the pick; a visit wins over Surprise me. Locations show in Modern and Toybox; the other styles keep the Office. The logic is in `renderer/locations.js`, the art in `renderer/location-art.js`, the rugs in `renderer/decor.js`.


The settings button on the menu bar in reception opens settings: the style, the theme, office size (zooms
the office and reception, not the terminal), whether the terminal opens as a
split panel beside the office (the default) or takes the full window, the
split panel width, the workspace sidebar, the editor command for "Open in
editor", the alert sound, plan usage (what it shows and how often it checks), updates (Ask or Automatic, see
[the Dock app](#the-dock-app-and-updates)), and the two orchestrator options above (boss
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

## The Dock app and updates

`npm run install-app` sets up a Herdquarters.app you can keep in the Dock, so
you no longer need `npm start`. It clones the repo into a checkout the app owns,
`~/Library/Application Support/Herdquarters/app` (never the one you ran it
from), installs its packages there, and builds `~/Applications/Herdquarters.app`
around it (`--out`, `--root` and `--remote` change those). The checkout tracks
`https://github.com/erikedling/herdquarters.git`, so its hourly fetch needs no
SSH key; `--remote` points it elsewhere, such as a fork. Quit `npm start`,
open the app and drag it to the Dock. Run it again to rebuild the app; the
checkout and its update state are kept. `--out` must name a `.app`, and an
existing one is only replaced if this script built it.

To try a branch that is not merged yet, install with `--branch`:

```sh
npm run install-app -- --branch fregus/some-change
```

The app then runs that branch and offers what is pushed to it, the same way it
does for `main`. A rerun keeps the branch the checkout tracks. To go back to
`main`, run `npm run install-app -- --reset`; switching straight to another
branch also needs `--reset`. When the branch is merged and deleted, the app
stops finding updates and says so; run `npm run install-app -- --reset` to go
back to main.

The app is a copy of Electron's own bundle with the name and icon, signed ad
hoc (`scripts/make-app.js`). An app built on your Mac is not quarantined, so it
opens without an Apple Developer ID. Its code is `shell/bootstrap.js`, which
prepares the checkout and then runs that checkout's `main.js`, so the app uses
the same data folder (`~/Library/Application Support/agent-office`) as
`npm start`: settings, orchestrators, PiPi's memory and the notes are all already
there. Only one of the two runs at a time; opening the second focuses the first.

An app opened from the Dock gets the system's short PATH. At launch the
bootstrap asks your shell for its PATH (`$SHELL -ilc`, interactive so `.zshrc`
counts, 5 s at most; it usually takes about a second) and puts it first, so
herdr, `claude`, `codex`, `gh`, `git` and `npm` are found as in a terminal.

**Updates.** The app fetches `origin/main` (or its `--branch`) 30 s after
launch and then every hour, and sorts what came in by what applying it takes (`updater.js`):

- Only `renderer/`, docs, tests and other files the app never loads: checked out
  and applied with a window reload. The terminal that was open opens again.
  Agents, herdr and PiPi carry on; only an open dialog or unsent text is lost.
  A `renderer/` file the main process also requires (`note-rows.js`) is listed in
  `MAIN_LOADS` in `updater.js`; `test/main-graph.test.js` walks main's requires
  and fails when a new one is missing.
- Anything `main.js` or `preload.js` loads (the main-process modules, the briefs,
  scripts): needs a restart. It is checked out at the next launch, before
  `main.js` loads, so a running app never mixes old and new files.
- `shell/` changed: as above. The app runs its own copy of `shell/`, so at that
  launch it checks that each new file parses, swaps them into the bundle, signs
  it again and starts over. The bundle's entry point is `shell/loader.js`, which
  is never swapped: the previous set waits in `shell.prev` next to `state.json`
  (outside the bundle, so its signature stays valid) until a window has come up, and if the new `bootstrap.js` throws, or six launches pass
  without a window, it puts the previous set back and rolls the commit back.
- `package-lock.json` changed: as above, with `npm ci` at that launch. The old
  `node_modules` is moved aside first and put back if the install fails, and
  `state.json` records which lockfile it was installed from, so an install that
  was cut short is done again at the next launch.
- Another Electron major: as above, and the app downloads that Electron and
  rebuilds itself first, which can take a few minutes. It tries once per commit;
  if the app still does not match after that, it goes back to the last good one.

A launch that has to install or rebuild shows a small *Updating Herdquarters…*
window while it works, then starts again. The window cannot be closed, and ⌘Q
asks first: **Stop and quit** stops npm, puts the old `node_modules` back and
quits on the version it had.

Settings > General > Updates picks **Ask** (the default) or **Automatic**. Ask
shows a bar under the top bar: *Update available* with the changes (the PR
titles), **Update now** and **Later** (hidden until something newer comes).
Automatic applies reload-only updates by itself once nothing is going on: no
dialog or settings open, no half-typed text, no terminal focused and no key
pressed in the last minute. An update that needs a restart always asks, in both
modes: **Restart now** (a few seconds, agents keep running) or **On next
launch**. **Check now** in settings checks at once. A check that fails (offline)
stays quiet and is tried again in an hour; settings shows the error.

A version counts as started when the window says so: `renderer/ready.js`, the
last script, checks that every part set itself up and that none of the window's
own scripts (`renderer/*.js`) threw, and sends `renderer-ready`. A rejected call
to something outside the window, such as herdr still starting or `gh` offline,
is only logged. If a new commit throws while `main.js` loads, or the window
has not said it is ready within 30 s, the bootstrap checks out the last commit
that did start, starts again and says so in the bar. A live update that does not
come up is undone the same way with a reload; if even that window does not come
back, a dialog offers to restart. That commit is not offered
again; the next one is. The checkout belongs to the app: if it has local changes,
or commits that `origin/main` does not have, updates stop and say why instead of
dropping them. Its state is in `state.json` next to it.

If the app cannot get itself going again (a bad commit was marked good, the
checkout has local changes or a history of its own), reset it from any source
checkout:

```sh
npm run install-app -- --reset
```

That fetches, puts the app's checkout back on `origin/main`, or on the branch
`--branch` names (local changes and commits there are dropped), clears the update state, installs the packages and
builds the app again. The data folder is not touched.

Contributors keep using `npm start`; the updater only runs inside the app.

## Dev flags

- `OFFICE_FIXTURE=1 npm start` renders a fake session with every pose and many of the characters.
- `OFFICE_DEV_SETTINGS='{"theme":"ocean"}' npm start` applies a settings patch on launch;
  `{"activeTab":"dark-mode"}` opens the fixture's orchestrator tab.
- `OFFICE_ASSISTANT=talk|dream|idle|wave` sets the assistant's mood in fixture runs, `OFFICE_CHAT=1` opens its chat.
- `OFFICE_MODAL=<create|closed|remove|orchestrator|archived|slack:<slug>> npm start` opens that dialog on launch;
  `OFFICE_TOOLTIP=<pane_id>` shows a desk tooltip; `OFFICE_SETTINGS_OPEN=1` opens settings, `=assistant` (or
  `appearance`, `hq`, `agents`, `general`) on that section; `OFFICE_USAGE_OPEN=1` opens the plan usage popover.
- Fixture runs show made-up plan usage; `OFFICE_USAGE_LIVE=1` reads the real `claude` and `codex` CLIs instead.
- `OFFICE_OPEN=<pane_id> npm start` opens that desk's terminal on launch.
- `OFFICE_CORKBOARD=big|note|both npm start` opens the big corkboard, the first note on the wall, or a note on the big board.
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
