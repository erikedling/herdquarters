// Fake herdr snapshot for developing the scene without a live session. Run
// with OFFICE_FIXTURE=1. Mirrors a plausible session (four repos, two of them
// with linked worktrees, one closed worktree per repo that has any) but gives
// the agents one of every state. Every path and name here is invented.
const HOME = '/Users/dev';
const REPOS = `${HOME}/code`;
const WT = `${HOME}/.herdr/worktrees`;

const repo = (name) => ({ key: `${REPOS}/${name}/.git`, name, root: `${REPOS}/${name}` });
const R = {
  office: repo('agent-office'),
  catalog: repo('catalog-api'),
  recs: repo('recommendation-service'),
  infra: repo('platform-infra'),
};

const wt = (r, checkout, linked) => ({
  checkout_path: checkout, is_linked_worktree: linked, repo_key: r.key, repo_name: r.name, repo_root: r.root,
});
const ws = (id, label, worktree, focused = false) => ({
  workspace_id: id, number: 1, label, focused, pane_count: 1, tab_count: 1,
  active_tab_id: `${id}:t1`, agent_status: 'idle', worktree,
});
const pane = (id, wsId, cwd, label) => ({
  pane_id: id, workspace_id: wsId, tab_id: `${wsId}:t1`, cwd, foreground_cwd: cwd,
  focused: false, revision: 1, terminal_id: `term_${id}`, agent_status: 'unknown', ...(label ? { label } : {}),
});
const agent = (paneId, wsId, cwd, status, title, seq) => ({
  ...pane(paneId, wsId, cwd), agent: 'claude', agent_status: status,
  terminal_title: title, terminal_title_stripped: title, state_change_seq: seq,
});
const entry = (path, branch, linked, open) => ({
  path, branch, is_linked_worktree: linked, is_bare: false, is_detached: false, is_prunable: false,
  label: path.split('/').pop(), open_workspace_id: open,
});

// The "Search relevance" orchestrator (fixture/orchestrators) works on this branch.
const ORCH_BRANCH = 'mia/search-relevance-endpoints';

const P = {
  officeMain: R.office.root,
  officeSprites: `${WT}/agent-office/pixel-sprites`,
  officeTest: `${WT}/agent-office/test`,
  catalogMain: R.catalog.root,
  catalogSearch: `${WT}/catalog-api/mia-search-relevance-endpoints`,
  // A second checkout of the same repo for the orchestrator: an alternative implementation.
  catalogSearchB: `${WT}/catalog-api/mia-search-relevance-endpoints--b`,
  catalogClosed: `${WT}/catalog-api/dev-search-index-uses-real-ids-instead-of-placeholders`,
  recsMain: R.recs.root,
  recsClosed: `${R.recs.root}/.claude/worktrees/cancelled-experiment`,
  infraMain: R.infra.root,
  boss: `${__dirname}/fixture/orchestrators/search-relevance`,
};

exports.worktrees = function worktrees() {
  const source = (r, checkout, wsId) => ({ repo_key: r.key, repo_name: r.name, repo_root: r.root, source_checkout_path: checkout, source_workspace_id: wsId });
  return {
    [R.office.key]: {
      source: source(R.office, P.officeMain, 'w1'),
      worktrees: [
        entry(P.officeMain, 'main', false, 'w1'),
        entry(P.officeTest, 'test', true, 'w11'),
        entry(P.officeSprites, 'pixel-sprites', true, 'wP'),
      ],
    },
    [R.catalog.key]: {
      source: source(R.catalog, P.catalogMain, 'wC'),
      worktrees: [
        entry(P.catalogMain, 'main', false, 'wC'),
        entry(P.catalogClosed, 'dev/search-index-uses-real-ids-instead-of-placeholders', true, null),
        entry(P.catalogSearch, ORCH_BRANCH, true, 'wZ'),
        entry(P.catalogSearchB, `${ORCH_BRANCH}--b`, true, 'wY'),
      ],
    },
    [R.recs.key]: {
      source: source(R.recs, P.recsMain, 'wF'),
      worktrees: [
        entry(P.recsMain, ORCH_BRANCH, false, 'wF'),
        entry(P.recsClosed, 'cancelled-experiment', true, null),
      ],
    },
    [R.infra.key]: {
      source: source(R.infra, P.infraMain, 'wR'),
      worktrees: [entry(P.infraMain, ORCH_BRANCH, false, 'wR')],
    },
  };
};

exports.snapshot = function snapshot() {
  // One of each state: working, blocked (needs you), done, idle, plus a
  // second working agent so the focused one is not the only one typing.
  const agents = [
    agent('wR:p1', 'wR', P.infraMain, 'working', 'Terraform plan for cluster upgrade', 955),
    // recommendation-service and the catalog-api worktree are the
    // "search-relevance" orchestrator's workers (fixture/orchestrators).
    agent('wF:p2', 'wF', P.recsMain, 'idle', 'Expose relevance score', 1025),
    agent('wZ:p1', 'wZ', P.catalogSearch, 'working', 'Search endpoint behind feature flag', 1005),
    agent('wY:p1', 'wY', P.catalogSearchB, 'working', 'Search endpoint, variant b: query param', 1006),
    agent('wB:p1', 'wB', P.boss, 'working', 'Search relevance boss', 1040),
    // The boss's ops agent, watching a deploy; the fixture has an open alert for it.
    { ...agent('wB:p2', 'wB', `${P.boss}/ops`, 'working', 'Watching recommendation-service deploy', 1041), name: 'search-relevance-ops' },
    // Its Slack watcher, between checks; the fixture has two messages waiting on the user.
    { ...agent('wB:p3', 'wB', `${P.boss}/slack`, 'idle', 'Slack watcher', 1042), name: 'search-relevance-slack' },
    { ...agent('wP:p1', 'wP', P.officeSprites, 'working', '20 different characters agent office', 1031), label: 'Office builder' },
    agent('w11:p1', 'w11', P.officeTest, 'idle', 'Claude Code', 1026),
    // A pi agent next to it, so the office shows a non-Claude kind.
    { ...agent('w11:p2', 'w11', P.officeTest, 'idle', 'π - office-test', 1027), agent: 'pi' },
  ];
  const panes = [
    ...agents,
    pane('w1:p4', 'w1', P.officeMain),
    pane('wC:p4', 'wC', P.catalogMain),
    pane('wF:p3', 'wF', P.recsMain),
    pane('wP:p2', 'wP', P.officeSprites, 'npm start'),
    pane('wR:p2', 'wR', P.infraMain),
  ];
  return {
    version: 'fixture', protocol: 20,
    focused_pane_id: 'wP:p1', focused_tab_id: 'wP:t1', focused_workspace_id: 'wP',
    workspaces: [
      ws('w1', 'agent-office', wt(R.office, P.officeMain, false)),
      ws('wC', 'catalog-api', wt(R.catalog, P.catalogMain, false)),
      ws('wF', 'recommendation-service', wt(R.recs, P.recsMain, false)),
      ws('wP', 'pixel-sprites', wt(R.office, P.officeSprites, true), true),
      ws('wR', 'platform-infra', wt(R.infra, P.infraMain, false)),
      ws('wZ', 'mia-search-relevance-endpoints', wt(R.catalog, P.catalogSearch, true)),
      ws('wY', 'mia-search-relevance-endpoints--b', wt(R.catalog, P.catalogSearchB, true)),
      ws('w11', 'test', wt(R.office, P.officeTest, true)),
      ws('wB', 'boss: Search relevance', undefined),
    ],
    tabs: [], layouts: [], agents, panes,
  };
};

// The assistant in fixture runs: a due reminder and the morning brief, so
// the bird has something to say. OFFICE_ASSISTANT=talk|dream|idle|wave|unread
// picks its mood (unread: an answer the user has not seen); OFFICE_CHAT=1
// opens the chat window.
exports.assistant = function assistant() {
  const now = Date.now();
  const mood = process.env.OFFICE_ASSISTANT || 'wave';
  return {
    enabled: true, running: true, busy: mood === 'talk', dreaming: mood === 'dream', morning: mood === 'wave', fixtureMood: mood,
    due: mood === 'wave' ? [{ file: 'noor.md', due: now - 60_000, text: 'Talk to Noor about the ranking weights (Search relevance).' }] : [],
    upcoming: [{ file: 'demo.md', due: now + 3 * 3600_000, text: 'Prep the demo for Friday' }],
    fixtureUnread: mood === 'unread' ? { text: 'Klara is stuck on the coverage check: it needs the prod VPN.', count: 2 } : null,
  };
};
exports.assistantChat = function assistantChat() {
  const t = Date.now() - 600_000;
  return [
    { role: 'note', text: '☀️ Morning brief', at: t },
    { role: 'assistant', text: 'Good morning Mia! Three things need you before lunch:\n\n1. **Search relevance**: [Maja](hq://desk/wB:p1) asks which service should own the endpoint.\n2. [Jonas on Slack](hq://slack/search-relevance) wants an answer about the flag.\n3. The deploy alert on **recommendation-service** is still open ([board](hq://tab/search-relevance)).\n\nYou have standup at 09:30 and a reminder to talk to Noor at 10.', at: t + 5000 },
    { role: 'user', text: 'Remind me to prep the demo at 15', at: t + 60_000 },
    { role: 'assistant', text: 'Done. I will nudge you at **15:00** today.', at: t + 65_000 },
  ];
};
