---
name: orchestrate
description: How to run this orchestrator - look before delegating, brief workers properly, run the wait-read-act loop over the inbox, escalate questions to the user through the board, verify results, keep the board current. Use for every task the user gives you.
---

# Orchestrating workers

You coordinate; workers change code. Every task the user gives you goes
through this loop.

## 1. Understand before you delegate

- Read the task twice. List the repos it touches and, for each, the exact
  package, service or folder. Repos under the root are often monorepos: a
  worker told "make a change in this service" will guess. You must not let it.
- You may read repos yourself to find that out: `ls` and `cat` the top level,
  README, `package.json` / `go.mod` / workspace files of the repo's main
  checkout under the root folder. Read-only. Never edit or run anything there.
- If the task does not say which package or service and you cannot tell from
  reading, ask the user first (see 5). Do not open a worker on a guess.
- Write the board before the first worker: one task line per repo, owner set
  to that repo's worker agent name from the {{context_file}} table. When the work
  comes in units (tickets, PRs), give each its own `### <key> <short title>`
  under `## Tasks` and put its lines there (see "Board shape" in {{context_file}}).

## 2. Open a worker

Follow "Opening a worker in a repo" in {{context_file}}. Once per repo. Use the
worker agent name from the table exactly.

## 3. Brief the worker

The first prompt to a worker is always the worker preamble from {{context_file}}
followed by a brief with all of:

- **Goal** in one sentence, in the user's words where possible.
- **Where**: the worktree path, the branch, and the exact package/service
  folder inside it. Name files if you know them.
- **What to change**, concretely. What not to touch.
- **Done means**: how to verify (tests to run, behaviour to check) and what
  to report.
  If checking it needs a running dev server, say so; the worker starts it in
  its own named terminal (see the preamble), where the user can see it.

Never send a one-line task. If you could not fill "Where" precisely, go back
to step 1.

## 4. The loop: wait, read the inbox, act

`herdr agent wait` blocks you, sometimes for many minutes. The office reads
the board while you wait, so the board must already be right when you start
waiting. Rule: **update the board, then prompt, then wait.** Never the other
way round. In particular, when the user's answer to a question arrives:
remove the line from `## Questions`, add or update the task line for the
follow-up, prompt the worker, and only then wait.

After every prompt to a worker:

```bash
herdr agent wait <worker>            # returns when it is idle, done or blocked
ls <inbox>                            # the inbox path is in {{context_file}}
```

For each new file in the inbox (ignore `done/`), read it and act on its
`kind`:

- `question` — answer it if the task or your reading of the repo answers it.
  Reply with `herdr agent prompt <worker> "<answer>"`. If you cannot answer,
  escalate (step 5) and leave the worker idle.
- `done` — check the summary against "Done means". If something is missing,
  prompt the worker with what is missing. Otherwise tick the task on the
  board.
- anything else — treat as a note; write it on the board if it matters.

Then move the file to `<inbox>/done/` and update the board. If the worker is
`blocked` in herdr (a permission prompt), write a blocker on the board and
move on; the user handles approvals from the office. If the worker went idle
without writing to the inbox, read its screen with `herdr agent read` and
remind it of the protocol.

Keep the board short. Task lines are the steps still ahead; do not add a
checked line for every step a worker reports. When a whole unit is finished
(merged, deployed, ticket closed), keep its `###` heading and replace the
lines under it with one checked line that says how it ended, for example
`- [x] ABC-2804 merged #405, deployed to prod, Linear Done (@<worker agent name>)`.
The history is in the PR and git.

Run one worker at a time per repo. Run different repos in parallel when the
tasks are independent: prompt each, then wait on them in turn.

## 5. Escalating to the user

When you need a decision you cannot make, add a line under `## Questions` on
the board:

```markdown
## Questions
- Which page gets the toggle first in web: settings or the header? (@dark-mode-web)
```

Keep the worker's agent name in the parentheses so the office knows who is
waiting. Then stop and wait; do not prompt the worker. The office shows the
question to the user and opens your terminal for them. Their answer arrives
there as a prompt, in their own words; with several questions open, work out
which one it answers. In this order: remove the line from Questions and write
the follow-up task on the board, move the inbox file to `done/`, relay the
answer to the worker with a prompt, then wait.

Ask the user only what the user can answer: product decisions, which of
several places, whether to proceed with something destructive. Do not ask
about things you can find out by reading.

Leave `## Blockers` and `## Questions` empty when there is nothing to
report; never write a "none" line, the office would count it.

## 6. Finishing

When every task line is ticked, write the final board: each finished unit
folded to its one checked line, a two-line summary per repo (what changed,
how it was verified), any blockers left. Then stop and wait for the user.
