// User settings: theme, UI scale, terminal layout, panel width, sidebar, editor, QA review, alert sound, herdr autostart, office animals, boss instructions, the assistant (on, name, morning time). Stored per machine.
(function () {
  const KEY = 'agent-office.settings';
  const DEFAULTS = { scale: 0.85, termLayout: 'split', panelWidth: 46, sidebar: true, sidebarWidth: 250, activeTab: 'office', orchRoot: '', orchAgent: 'claude', qa: false, alertSound: true, herdrAutostart: true, cats: true, dogs: true, petsHidden: false, instructions: '', editor: 'code', theme: 'midnight', mode: 'dark', assistant: true, assistantName: 'PiPi', morning: '08:30' };
  let settings = { ...DEFAULTS };
  try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* keep defaults */ }

  function save() { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ } }

  function apply() {
    const root = document.documentElement;
    window.officeThemes?.apply(settings.theme, settings.mode);
    root.style.setProperty('--ui-scale', String(settings.scale));
    root.style.setProperty('--sidebar-width', `${settings.sidebarWidth}px`);
    root.style.setProperty('--panel-width', `${settings.panelWidth}%`);
    document.body.classList.add('layout-office');
    document.body.classList.toggle('term-full', settings.termLayout === 'full');
    window.officeSidebar?.setVisible(settings.sidebar);
    window.officeTerminal?.layoutChanged?.();
    window.officeRerender?.();
    syncAssistantName();
    syncForm();
    syncMain();
  }

  // Main decides whether to start herdr, so it needs the setting from here.
  let sentAutostart = null;
  function syncMain() {
    if (settings.herdrAutostart === sentAutostart) return;
    sentAutostart = settings.herdrAutostart;
    window.office.setHerdrAutostart?.(sentAutostart !== false);
  }

  function set(patch) {
    Object.assign(settings, patch); save(); apply();
    if ('assistant' in patch || 'morning' in patch || 'assistantName' in patch) pushAssistant();
  }
  // The assistant's clock runs in main; it keeps its own copy of these.
  const pushAssistant = () => window.office.assistant?.configure({ enabled: settings.assistant, morning: settings.morning, name: settings.assistantName });
  // Same rule as assistantName() in assistant.js: one line, 24 characters, PiPi when empty.
  const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24).trim() || DEFAULTS.assistantName;
  // Every label that says the assistant's name, plus the bird's tooltips.
  function syncAssistantName() {
    const name = cleanName(settings.assistantName);
    for (const $n of document.querySelectorAll('.assistant-name')) if ($n.textContent !== name) $n.textContent = name;
    document.getElementById('bird')?.setAttribute('title', `${name}: click to chat, hold to pet, double-click for a flip`);
    document.getElementById('chat-tab')?.setAttribute('title', `Chat with ${name}`);
    window.officeAssistant?.renamed?.();
  }

  // ---- settings window ----
  const $pop = document.getElementById('settings');
  const $btn = document.getElementById('settings-btn');
  const $pets = document.getElementById('pets-btn');
  function syncForm() {
    if (!$pop) return;
    $pop.querySelector('#set-scale').value = Math.round(settings.scale * 100);
    $pop.querySelector('#set-scale-val').textContent = `${Math.round(settings.scale * 100)}%`;
    $pop.querySelector('#set-width').value = settings.panelWidth;
    $pop.querySelector('#set-width-val').textContent = `${settings.panelWidth}%`;
    $pop.querySelector('#set-width-row').classList.toggle('disabled', settings.termLayout === 'full');
    // The class only greys it out; disabled also keeps the keyboard and screen readers off it.
    $pop.querySelector('#set-width').disabled = settings.termLayout === 'full';
    for (const r of $pop.querySelectorAll('input[name=termLayout]')) r.checked = r.value === settings.termLayout;
    for (const r of $pop.querySelectorAll('input[name=sidebar]')) r.checked = r.value === (settings.sidebar ? 'on' : 'off');
    for (const r of $pop.querySelectorAll('input[name=mode]')) r.checked = r.value === settings.mode;
    renderThemes();
    const $qa = $pop.querySelector('#set-qa'); if ($qa) $qa.checked = !!settings.qa;
    const $as = $pop.querySelector('#set-assistant'); if ($as) $as.checked = settings.assistant !== false;
    const $an = $pop.querySelector('#set-assistant-name'); if ($an && document.activeElement !== $an) $an.value = settings.assistantName;
    const $mo = $pop.querySelector('#set-morning'); if ($mo && document.activeElement !== $mo) $mo.value = settings.morning;
    const $snd = $pop.querySelector('#set-alert-sound'); if ($snd) $snd.checked = settings.alertSound !== false;
    const $cats = $pop.querySelector('#set-cats'); if ($cats) $cats.checked = !!settings.cats;
    const $dogs = $pop.querySelector('#set-dogs'); if ($dogs) $dogs.checked = !!settings.dogs;
    $pets?.classList.toggle('off', settings.petsHidden || (!settings.cats && !settings.dogs));
    const $auto = $pop.querySelector('#set-herdr-autostart'); if ($auto) $auto.checked = settings.herdrAutostart !== false;
    const $ed = $pop.querySelector('#set-editor'); if ($ed && document.activeElement !== $ed) $ed.value = settings.editor || '';
    // Leave the box alone while it is being typed in; it is read on change.
    const $ins = $pop.querySelector('#set-instructions'); if ($ins && document.activeElement !== $ins) $ins.value = settings.instructions || '';
  }
  // A swatch per theme in the current mode: background, a bar, three status dots.
  function renderThemes() {
    const $grid = $pop.querySelector('#set-themes'); if (!$grid || !window.officeThemes) return;
    const { THEMES, resolveMode } = window.officeThemes;
    const m = resolveMode(settings.mode, window.matchMedia('(prefers-color-scheme: dark)').matches);
    const html = THEMES.map((t) => {
      const c = t[m];
      return `<button class="theme-card ${t.id === window.officeThemes.byId(settings.theme).id ? 'active' : ''}" data-theme="${t.id}" title="${t.name}">
        <span class="theme-pv" style="background:${c.bg}"><i style="background:${c['bg-2']}"></i><span style="background:${c.panel}"><b style="background:${c.working}"></b><b style="background:${c.blocked}"></b><b style="background:${c.done}"></b></span></span>
        <span class="theme-name">${t.name}</span>
      </button>`;
    }).join('');
    if ($grid._html !== html) { $grid._html = html; $grid.innerHTML = html; }
  }
  function showSection(name) {
    for (const $t of $pop.querySelectorAll('.settings-tab')) $t.classList.toggle('active', $t.dataset.section === name);
    for (const $s of $pop.querySelectorAll('.settings-section')) $s.hidden = $s.dataset.section !== name;
  }
  const open = () => { $pop.hidden = false; };
  const close = () => { $pop.hidden = true; };
  $btn?.addEventListener('click', () => ($pop.hidden ? open() : close()));
  // A click on the dimmed backdrop closes it, a click in the window does not.
  $pop?.addEventListener('mousedown', (e) => { if (e.target === $pop) close(); });
  $pop?.querySelector('#set-close')?.addEventListener('click', close);
  $pop?.querySelector('.settings-nav')?.addEventListener('click', (e) => { const $t = e.target.closest('.settings-tab'); if ($t) showSection($t.dataset.section); });
  $pop?.querySelector('#set-themes')?.addEventListener('click', (e) => { const $t = e.target.closest('.theme-card'); if ($t) set({ theme: $t.dataset.theme }); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$pop.hidden) close(); });
  // System mode follows the OS as it switches.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (settings.mode === 'system') apply(); });
  $pop?.addEventListener('input', (e) => {
    if (e.target.id === 'set-scale') set({ scale: Number(e.target.value) / 100 });
    if (e.target.id === 'set-width') set({ panelWidth: Number(e.target.value) });
    if (e.target.name === 'termLayout') set({ termLayout: e.target.value });
    if (e.target.name === 'sidebar') set({ sidebar: e.target.value === 'on' });
    if (e.target.name === 'mode') set({ mode: e.target.value });
    if (e.target.id === 'set-assistant') set({ assistant: e.target.checked });
    // QA review: new orchestrators get it from the wizard; running ones get the flag now.
    if (e.target.id === 'set-alert-sound') { set({ alertSound: e.target.checked }); if (e.target.checked) window.officeAlerts?.chime(); }
    // Ticking a species also brings the animals back if the paw had hidden them.
    if (e.target.id === 'set-cats') set({ cats: e.target.checked, ...(e.target.checked ? { petsHidden: false } : {}) });
    if (e.target.id === 'set-dogs') set({ dogs: e.target.checked, ...(e.target.checked ? { petsHidden: false } : {}) });
    if (e.target.id === 'set-herdr-autostart') set({ herdrAutostart: e.target.checked });
    if (e.target.id === 'set-qa') { set({ qa: e.target.checked }); window.office.orchestrator?.setQa?.(e.target.checked); }
  });
  $pop?.querySelector('#set-morning')?.addEventListener('change', (e) => { if (/^\d\d:\d\d$/.test(e.target.value)) set({ morning: e.target.value }); });
  $pop?.querySelector('#set-assistant-name')?.addEventListener('change', (e) => { set({ assistantName: cleanName(e.target.value) }); e.target.value = settings.assistantName; });
  $pop?.querySelector('#set-editor')?.addEventListener('change', (e) => set({ editor: e.target.value.trim() }));
  // Boss instructions: saved when the box loses focus, then pushed to every boss brief.
  $pop?.querySelector('#set-instructions')?.addEventListener('change', (e) => {
    set({ instructions: e.target.value.trim() });
    window.office.orchestrator?.setInstructions?.(settings.instructions);
  });
  // The paw in the top bar hides the animals and brings back the ones ticked
  // in settings (both, when none are).
  $pets?.addEventListener('click', () => {
    if (!settings.cats && !settings.dogs) set({ cats: true, dogs: true, petsHidden: false });
    else set({ petsHidden: !settings.petsHidden });
  });
  document.getElementById('sidebar-btn')?.addEventListener('click', () => set({ sidebar: !settings.sidebar }));
  $pop?.querySelector('#set-reset')?.addEventListener('click', () => set({ ...DEFAULTS }));
  $pop?.querySelector('#set-welcome')?.addEventListener('click', () => { close(); window.officeWelcome?.open(); });

  window.office.devSettings?.().then((patch) => { if (patch) set(patch); });
  window.officeSettings = { get: () => ({ ...settings }), assistantName: () => cleanName(settings.assistantName), defaults: { ...DEFAULTS }, set, apply, openPopover: open };
  apply();
  pushAssistant();
})();
