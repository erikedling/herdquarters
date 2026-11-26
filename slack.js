// The Slack watcher: an agent at a desk in the boss's room that reads the
// Slack threads, channels and DMs in <boss folder>/slack/WATCHES.md and writes
// a file to slack/waiting/ for each message waiting on the user. The office
// runs the clock: every refresh, runSlack() decides per orchestrator whether
// to start the watcher, clear its context or ask it to check.
// See ../designs/slack-watcher.md.

const { setTimeout: delay } = require('node:timers/promises');

const KINDS = ['thread', 'channel', 'dm'];
const LINE = /^[-*]\s+(thread|channel|dm)\s+(\S+)(?:\s+[—–-]+\s+(.*))?$/;

// WATCHES.md → [{ kind, target, note }]. Lines that are not watches are skipped.
function parseWatches(raw) {
  const out = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const m = line.trim().match(LINE);
    if (m) out.push({ kind: m[1], target: m[2], note: (m[3] || '').trim() });
  }
  return out;
}

// What the user pasted or typed → { kind, target }, or null when it is not
// something the watcher can read. A message link (/p<ts>) is its thread;
// /archives/<id> alone is a channel, or a DM when the id starts with D.
const SLACK_LINK = /^https:\/\/[a-z0-9-]+(?:\.enterprise)?\.slack\.com\/archives\/([A-Z0-9]+)(\/p\d+)?(\?[^\s]*)?$/;
function watchFromInput(text) {
  const t = String(text || '').trim();
  const link = t.match(SLACK_LINK);
  if (link) return { kind: link[2] ? 'thread' : link[1].startsWith('D') ? 'dm' : 'channel', target: t };
  const channel = t.match(/^#([a-z0-9._-]+)$/i);
  if (channel) return { kind: 'channel', target: `#${channel[1].toLowerCase()}` };
  const person = t.match(/^@([a-z0-9._-]+)$/i);
  if (person) return { kind: 'dm', target: `@${person[1].toLowerCase()}` };
  return null;
}

// Adds a watch as a new last line, unless its target is already there. The
// rest of the file stays as the boss or the user wrote it.
function addWatchLine(raw, { kind, target, note = '' }) {
  if (!KINDS.includes(kind) || !target || /\s/.test(target)) throw new Error('Not a Slack watch');
  const text = String(raw || '');
  if (parseWatches(text).some((w) => w.target === target)) return text;
  const line = `- ${kind} ${target}${note ? ` — ${String(note).replace(/[\r\n]+/g, ' ').trim()}` : ''}\n`;
  return text && !text.endsWith('\n') ? `${text}\n${line}` : text + line;
}

function removeWatchLine(raw, target) {
  const lines = String(raw || '').split('\n');
  const kept = lines.filter((l) => { const m = l.trim().match(LINE); return !m || m[2] !== target; });
  return kept.length === lines.length ? raw : kept.join('\n');
}

// ---- the clock ----

const DEFAULT_INTERVAL = 10; // minutes
const BOOT_MS = 2 * 60_000;  // a watcher being started gets this long to show up
const CLEAR_MS = 2000;
const IDLE = new Set(['idle', 'done']);

// What to do now for one orchestrator: 'none', 'start', 'clear' or 'check'.
// slack: the `slack` object in orchestrator.json ({ interval, last_tick,
// phase, cleared_at, started_at }); agent: { status } or null.
function slackDue({ watches, slack = {}, agent, kind = 'claude', now }) {
  if (!watches) return 'none';
  if (!agent) return slack.started_at && now - slack.started_at < BOOT_MS ? 'none' : 'start';
  if (!IDLE.has(agent.status)) return 'none';
  if (kind === 'claude' && slack.phase === 'cleared') return now - (slack.cleared_at || 0) >= CLEAR_MS ? 'check' : 'none';
  const interval = (Number(slack.interval) || DEFAULT_INTERVAL) * 60_000;
  if (slack.last_tick && now - slack.last_tick < interval) return 'none';
  return kind === 'codex' ? 'check' : 'clear';
}

// The watcher's pane: an agent in the Slack folder, or one named for the
// watcher. Prefer the selected kind if a legacy watcher is also present.
function findSlackAgent(snapshot, folder, name, kind, workspace) {
  const inFolder = (a) => a.cwd === folder || a.foreground_cwd === folder;
  const named = (a) => a.name === name
    || (a.name?.startsWith(name + '-') && /^[2-9]$/.test(a.name.slice(name.length + 1)));
  const candidates = (snapshot?.agents || []).filter((a) => (
    (!workspace || !a.workspace_id || a.workspace_id === workspace) && (inFolder(a) || named(a))
  ));
  const a = candidates.find((x) => x.agent === kind && inFolder(x))
    || candidates.find((x) => x.agent === kind)
    || candidates.find(inFolder)
    || candidates[0];
  return a ? {
    pane_id: a.pane_id,
    status: a.agent_status,
    kind: a.agent,
    managed: !!workspace && a.workspace_id === workspace && inFolder(a) && named(a),
  } : null;
}

const slackAgent = (slug) => `${slug}-slack`; // slug is at most 24 characters, so this fits herdr's 32
const slackAgentKind = (orchestrator) => orchestrator.agent === 'codex' ? 'codex' : 'claude';

async function startSlackAgent(store, pane, name, kind) {
  const args = kind === 'codex' ? ['--sandbox', 'workspace-write'] : [];
  const retryDelays = [250, 500, 1000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await store.startAgent(pane, name, args, kind);
    } catch (err) {
      const retryDelay = retryDelays[attempt];
      // A newly created tab can be visible before its shell is ready.
      if (err.code !== 'agent_pane_busy' || retryDelay === undefined) throw err;
      await delay(retryDelay);
    }
  }
}

const busy = new Set(); // slugs with a start or prompt in flight

// Called from every refresh. store: OrchestratorStore; client: HerdrClient.
async function runSlack({ store, client, snapshot, now = Date.now() }) {
  await Promise.all(store.list().map(async (o) => {
    if (o.status !== 'running' || o.boss?.status !== 'started' || busy.has(o.slug)) return;
    const slack = o.slack || {};
    const folder = store.slackFolder(o.slug);
    const name = slackAgent(o.slug);
    const kind = slackAgentKind(o);
    const agent = findSlackAgent(snapshot, folder, name, kind, o.boss.workspace_id);
    const wrongKind = agent?.kind && agent.kind !== kind;
    const replace = wrongKind && agent.managed;
    if (replace && !IDLE.has(agent.status)) return;
    const action = slackDue({
      watches: (slack.watches || []).length,
      slack: replace ? {} : slack,
      agent: wrongKind ? null : agent,
      kind,
      now,
    });
    if (action === 'none') return;
    busy.add(o.slug);
    try {
      if (action === 'start') {
        store.prepareSlack(o.slug);
        if (replace) await client.request('pane.close', { pane_id: agent.pane_id });
        store.slackTick(o.slug, { started_at: now, phase: null, last_tick: null });
        const tab = await client.request('tab.create', { workspace_id: o.boss.workspace_id, cwd: folder, label: 'slack', focus: false });
        const pane = tab.root_pane?.pane_id || tab.pane?.pane_id;
        if (!pane) throw new Error('tab.create returned no pane');
        await startSlackAgent(store, pane, name, kind);
      } else if (action === 'clear') {
        // Type the slash command so Claude handles it as a command.
        await client.request('pane.send_text', { pane_id: agent.pane_id, text: '/clear' });
        await client.request('pane.send_keys', { pane_id: agent.pane_id, keys: ['enter'] });
        store.slackTick(o.slug, { phase: 'cleared', cleared_at: now, last_tick: now });
      } else if (action === 'check') {
        store.slackTick(o.slug, kind === 'codex' ? { phase: null, last_tick: now } : { phase: null });
        const brief = kind === 'codex' ? 'AGENTS.md' : 'CLAUDE.md';
        await client.request('agent.prompt', { target: agent.pane_id, text: `Check Slack now: follow "One check" in your ${brief}, then stop.` });
      }
    } catch (err) {
      console.warn(`slack watcher ${o.slug} (${action}): ${err.message || err}`);
    } finally {
      busy.delete(o.slug);
    }
  }));
}

module.exports = { parseWatches, watchFromInput, addWatchLine, removeWatchLine, slackDue, findSlackAgent, slackAgent, slackAgentKind, runSlack, DEFAULT_INTERVAL };
