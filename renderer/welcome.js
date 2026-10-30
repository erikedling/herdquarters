// The welcome tour: a few painted scenes (scenes.js) that show what the
// office is for, the first time the app opens. It ends at the orchestrator
// wizard. Settings > General can show it again. Remembered per machine.
(function () {
  const KEY = 'agent-office.welcomed';
  const S = 8; // canvas pixels per scene pixel; CSS scales it down crisply

  const STEPS = [
    { scene: 'welcome', title: 'Welcome to Herdquarters',
      body: 'A cozy office for your coding agents. Hand off the work, watch the team get it done, and only step in when someone needs you.' },
    { scene: 'delegate', title: 'Tell the boss what you need',
      body: 'Every orchestrator comes with a boss: your assistant. Describe the task in plain words, screenshots welcome. The boss plans it and hands it out, and never touches the code itself.' },
    { scene: 'team', title: 'The boss builds the team',
      body: 'For each repo the task touches, the boss opens a worker in its own git worktree, all on one branch. Workers code, test and report back, and the boss keeps the board up to date.' },
    { scene: 'status', title: 'Step in only when it matters',
      body: 'Typing means working. A raised hand means someone is waiting on you, and a wave means done. Questions line up in reception, and the office cat goes to sit with whoever is waiting.' },
    { scene: 'helpers', title: 'Helpers on call',
      body: 'Ask the boss for a QA review before the PR. Have the ops agent watch a deploy and raise the alarm. Let the Slack watcher tell you when a colleague is waiting for your answer.' },
    { scene: 'assistant', title: (n) => `Meet ${n}, your assistant`,
      body: (n) => `${n} is the little bird in the office. It keeps track of what every boss and Slack need from you, gives you a morning brief, sets reminders and remembers the work. Click it to chat, and give it a new name in Settings if you like.` },
    { scene: 'go', title: 'Ready to delegate?',
      body: 'Pick the folder that holds your repos, give the work a name, and meet your boss. You can always come back to the whole office with the Office tab.' },
  ];

  let $root = null, step = 0, raf = 0, t0 = 0;
  // Titles and texts can mention the assistant, by whatever name it has now.
  const assistantName = () => window.officeSettings?.assistantName?.() || 'PiPi';
  const say = (v) => (typeof v === 'function' ? v(assistantName()) : v);
  const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function seen() { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } }
  function remember() { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } }

  function paint(now) {
    const $c = $root?.querySelector('canvas');
    if (!$c) return;
    window.herdScenes.draw($c.getContext('2d'), STEPS[step].scene, still() ? 0.4 : (now - t0) / 1000, S, { assistantName: assistantName() });
    if (!still()) raf = requestAnimationFrame(paint);
  }

  function render() {
    const s = STEPS[step], last = step === STEPS.length - 1;
    $root.querySelector('.welcome-title').textContent = say(s.title);
    $root.querySelector('.welcome-body').textContent = say(s.body);
    $root.querySelector('.welcome-dots').innerHTML = STEPS.map((_, i) =>
      `<button class="welcome-dot ${i === step ? 'active' : ''}" data-step="${i}" aria-label="Step ${i + 1}"></button>`).join('');
    $root.querySelector('#welcome-back').hidden = step === 0;
    $root.querySelector('#welcome-skip').textContent = last ? 'Look around first' : 'Skip';
    $root.querySelector('#welcome-next').textContent = last ? 'Create my first orchestrator' : step === 0 ? 'Show me' : 'Next';
    cancelAnimationFrame(raf);
    t0 = performance.now();
    paint(t0);
  }

  function go(i) { step = Math.max(0, Math.min(STEPS.length - 1, i)); render(); }

  function close(then) {
    remember();
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey, true);
    $root?.remove(); $root = null;
    then?.();
  }

  function onKey(e) {
    if (!$root) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(step + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(step - 1); }
  }

  function open(start = 0) {
    if ($root) return go(start);
    const { W, H } = window.herdScenes;
    $root = document.createElement('div');
    $root.className = 'welcome';
    $root.innerHTML = `
      <div class="welcome-card" role="dialog" aria-modal="true" aria-label="${esc(STEPS[0].title)}">
        <canvas class="welcome-scene" width="${W * S}" height="${H * S}"></canvas>
        <div class="welcome-text">
          <h2 class="welcome-title"></h2>
          <p class="welcome-body"></p>
        </div>
        <div class="welcome-foot">
          <div class="welcome-dots"></div>
          <div class="welcome-actions">
            <button id="welcome-skip" class="btn ghost"></button>
            <button id="welcome-back" class="btn">Back</button>
            <button id="welcome-next" class="btn primary"></button>
          </div>
        </div>
      </div>`;
    document.body.appendChild($root);
    $root.addEventListener('click', (e) => {
      const $dot = e.target.closest('.welcome-dot');
      if ($dot) return go(Number($dot.dataset.step));
      if (e.target.id === 'welcome-back') return go(step - 1);
      if (e.target.id === 'welcome-skip') return close();
      if (e.target.id === 'welcome-next') {
        if (step < STEPS.length - 1) return go(step + 1);
        close(() => window.officeTabs?.wizard());
      }
    });
    document.addEventListener('keydown', onKey, true);
    step = Math.max(0, Math.min(STEPS.length - 1, start));
    render();
    $root.querySelector('#welcome-next').focus();
  }

  // First launch shows it. Screenshot runs skip it unless OFFICE_WELCOME=<step>
  // asks for it.
  const devTriggers = window.office?.devTriggers?.() || Promise.resolve(null);
  devTriggers.then((t) => {
    if (t?.welcome) open(Number(t.welcome) - 1 || 0);
    else if (!t?.screenshot && !seen()) open();
  }).catch(() => {});

  window.officeWelcome = { open, steps: STEPS.length };
})();
