// The Slack watcher: an agent at a desk in the boss's room that reads the
// Slack threads, channels and DMs in <boss folder>/slack/WATCHES.md and writes
// a file to slack/waiting/ for each message waiting on the user. The office
// runs the clock: every refresh, runSlack() decides per orchestrator whether
// to start the watcher, clear its context or ask it to check.
// See ../designs/slack-watcher.md.

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
const CLEAR_MS = 2000;       // time for /clear to land before the check prompt
const IDLE = new Set(['idle', 'done']);

// What to do now for one orchestrator: 'none', 'start', 'clear' or 'check'.
// slack: the `slack` object in orchestrator.json ({ interval, last_tick,
// phase, cleared_at, started_at }); agent: { pane_id, status } or null.
function slackDue({ watches, slack = {}, agent, now }) {
  if (!watches) return 'none';
  if (!agent) return slack.started_at && now - slack.started_at < BOOT_MS ? 'none' : 'start';
  if (!IDLE.has(agent.status)) return 'none';
  if (slack.phase === 'cleared') return now - (slack.cleared_at || 0) >= CLEAR_MS ? 'check' : 'none';
  const interval = (Number(slack.interval) || DEFAULT_INTERVAL) * 60_000;
  return !slack.last_tick || now - slack.last_tick >= interval ? 'clear' : 'none';
}

// The watcher's pane: an agent running in the slack folder (herdr drops the
// agent name when the process is replaced; the folder stays), else by name.
function findSlackAgent(snapshot, folder, name) {
  const agents = snapshot?.agents || [];
  const a = agents.find((x) => x.cwd === folder || x.foreground_cwd === folder) || agents.find((x) => x.name === name);
  return a ? { pane_id: a.pane_id, status: a.agent_status } : null;
}

const slackAgent = (slug) => `${slug}-slack`; // slug is at most 24 characters, so this fits herdr's 32
const CHECK_PROMPT = 'Check Slack now: follow "One check" in your CLAUDE.md, then stop.';

const busy = new Set(); // slugs with a start or prompt in flight

// Called from every refresh. store: OrchestratorStore; client: HerdrClient.
async function runSlack({ store, client, snapshot, now = Date.now() }) {
  await Promise.all(store.list().map(async (o) => {
    if (o.status !== 'running' || o.boss?.status !== 'started' || busy.has(o.slug)) return;
    const slack = o.slack || {};
    const folder = store.slackFolder(o.slug);
    const agent = findSlackAgent(snapshot, folder, slackAgent(o.slug));
    const action = slackDue({ watches: (slack.watches || []).length, slack, agent, now });
    if (action === 'none') return;
    busy.add(o.slug);
    try {
      if (action === 'start') {
        store.slackTick(o.slug, { started_at: now, phase: null });
        store.prepareSlack(o.slug);
        const tab = await client.request('tab.create', { workspace_id: o.boss.workspace_id, cwd: folder, label: 'slack', focus: false });
        const pane = tab.root_pane?.pane_id || tab.pane?.pane_id;
        if (!pane) throw new Error('tab.create returned no pane');
        await store.startAgent(pane, slackAgent(o.slug));
      } else if (action === 'clear') {
        // Typed, not pasted: a pasted "/clear" would be sent to Claude as text.
        await client.request('pane.send_text', { pane_id: agent.pane_id, text: '/clear' });
        await client.request('pane.send_keys', { pane_id: agent.pane_id, keys: ['enter'] });
        store.slackTick(o.slug, { phase: 'cleared', cleared_at: now, last_tick: now });
      } else if (action === 'check') {
        store.slackTick(o.slug, { phase: null });
        await client.request('agent.prompt', { target: agent.pane_id, text: CHECK_PROMPT });
      }
    } catch (err) {
      console.warn(`slack watcher ${o.slug} (${action}): ${err.message || err}`);
    } finally {
      busy.delete(o.slug);
    }
  }));
}

module.exports = { parseWatches, watchFromInput, addWatchLine, removeWatchLine, slackDue, findSlackAgent, slackAgent, runSlack, DEFAULT_INTERVAL };
