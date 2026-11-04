<p align="center">
  <img src="docs/images/welcome.png" alt="Herdquarters: a pixel-art office building with a coding agent in every window" width="720">
</p>

<h1 align="center">Herdquarters</h1>

<p align="center"><b>Delegate tasks to a team of coding agents and keep track of all of them in one place.</b></p>

Running five agents in five terminals is a lot of tab-switching. Herdquarters
turns them into a small office. You give the work to a boss agent, the boss
hands it out to workers, and you can see at a glance who's typing, who's
waiting on you and who's done. A little bird called PiPi, your assistant,
makes sure you never forget what anyone is waiting for.

It's a desktop app built on [herdr](https://herdr.dev), the agent multiplexer
for your terminal, and works with [Claude Code](https://claude.com/claude-code),
[Pi](https://github.com/badlogic/pi-mono) and [Codex CLI](https://developers.openai.com/codex/cli).

<img src="docs/images/app.png" alt="The Herdquarters window in the Toybox style: tabs at the top, a deploy alert, and an office with a floor per repo, each with its own walls and rugs, the boss's team at their desks and a dart board on the wall" width="720">

## How it works

### 1. Tell the boss what you need

<img src="docs/images/delegate.png" alt="You tell the boss: add dark mode to web and api. The boss says: on it!" width="560">

Create an **orchestrator**: point it at the folder that holds your repos and
give the work a name. You get a **boss**, an agent that acts as your
assistant. Describe the task in plain words, screenshots welcome. The boss
plans it and hands it out, and never edits code itself.

### 2. The boss builds the team

<img src="docs/images/team.png" alt="The boss at the top, connected to three rooms called api, web and infra, each with a worker typing" width="560">

For each repo the task touches, the boss opens a **worker** in its own git
worktree, all on one shared branch. Workers code, run the tests and report
back. The boss keeps a **board** of what's done and what's next.

### 3. Step in only when it matters

<img src="docs/images/status.png" alt="Three desks: one person typing, one with a raised hand and a red question mark, one waving on top of the desk with a green check" width="560">

| You see | It means |
|---|---|
| Someone typing | working |
| A raised hand and a red **?** | waiting on you: a question or a permission prompt |
| A wave and a green **✓** | done since you last looked |

Questions line up in **reception** at the bottom of the window. Click a desk to
open that agent's terminal right in the app. The office cat goes and sits with
whoever is waiting for you. 🐈

### 4. Helpers on call

<img src="docs/images/helpers.png" alt="Three helpers: a QA reviewer with a magnifying glass, an ops agent watching a heartbeat monitor, and a Slack watcher with an envelope" width="560">

- **QA review**: when the work is done, a reviewer reads every diff for
  readability and the repo's patterns, and sends fixes back to the workers.
- **Deploy watch**: say "watch the deploy of #412" and an ops agent follows
  the pipeline, then compares errors and latency with the hour before. If
  something breaks, you get an alert.
- **Slack watch**: a read-only watcher checks the threads and channels you
  care about and tells you when someone is waiting for your answer.

### 5. Meet PiPi, your assistant

<img src="docs/images/assistant.png" alt="A chat window with PiPi: good morning, 2 bosses wait on you, remind me at 3, done. PiPi, a little blue bird, sits on a perch with a reminder bubble: 3:00 call Noor" width="560">

A little bird lives in the office. **PiPi** keeps track of what every boss
and Slack need from you, so you don't have to:

- a **morning brief** on the days you pick (Mon–Fri by default): what waits
  on you, your meetings and reminders; on other days it stays quiet
- **reminders**: "remind me at 3 to call Noor", and it chimes on time
- a **corkboard** of your todos: sticky notes on the office wall that you
  add, edit and tick off by hand, and that PiPi reads and writes too
- a **memory** of your projects in plain markdown files, tidied up while it
  sleeps

Click the bird to chat. It flies over to a ticket that needs you, celebrates
when one is done, and naps at night. Don't like the name? Call it whatever
you want in **Settings → PiPi**.

### 6. Pin your todos on the corkboard

<img src="docs/images/corkboard.png" alt="A corkboard on the office wall with colored sticky notes; one note is open with its title, details, reminder time and color" width="720">

Todos and reminders are sticky notes on a corkboard beside the office. Each
note has a title, longer details, an optional time and a color; a note with a
time chimes when it's due. Add, edit and tick them off by hand, or just tell
PiPi. When the wall fills up, the corkboard button opens a big board with
every note.

### 7. Make it yours

Every repo gets its own walls and floor, every room its own rug, and every
agent their own mug and something on the desk. Pick a style under
**Settings → Appearance**: **Toybox** (the default, shown here), **Workshop**,
**Quest**, **Handheld**, **Workstation**, or the smooth **Modern** look in one
of ten themes.

## Get started

You need:

- macOS (Linux and Windows are untested)
- [Node.js](https://nodejs.org) 22.12 or newer
- [herdr](https://herdr.dev)
- [Claude Code](https://claude.com/claude-code), [Pi](https://github.com/badlogic/pi-mono)
  or [Codex CLI](https://developers.openai.com/codex/cli), signed in
  (the assistant and Slack watcher still require Claude Code)
- [`gh`](https://cli.github.com) for PRs and deploy watching (optional)

```sh
git clone https://github.com/erikedling/herdquarters.git
cd herdquarters
npm install
npm start
```

`npm install` downloads the Electron binary, cached in `~/Library/Caches/electron`.
Behind a proxy, set `ELECTRON_GET_USE_PROXY=true` and `HTTPS_PROXY`.

A short welcome tour opens on first launch. At the end, press
**Create my first orchestrator** and tell your new boss what you need. If
herdr isn't running yet, the app starts it for you.

Already have agents running in herdr? They show up in the **Office** tab right
away: one floor per repo, one room per checkout, one desk per pane.

## Learn more

The [guide](docs/GUIDE.md) covers everything else: terminals and worktrees,
the board, the corkboard, boss instructions, styles and themes, pets and dev
flags.

## Develop

```sh
npm test                    # unit tests, plus a few Electron tests
OFFICE_FIXTURE=1 npm start  # a fake office with every pose, no herdr needed
npm run art                 # repaint the README animations
```

Every animation in this README is painted frame by frame on a `<canvas>` by
[`renderer/scenes.js`](renderer/scenes.js), the same scenes the welcome tour
shows, and saved as a looping animated PNG. Change a scene and run
`npm run art` to update them. The two screenshots (`app.png`,
`corkboard.png`) are the fixture office in the Toybox style, taken with
`OFFICE_SCREENSHOT` (see the guide's dev flags).

## License

[MIT](LICENSE)
