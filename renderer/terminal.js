// Side panel with an embedded terminal attached to one desk. The main process
// streams the pane through `herdr terminal session control` (streams.js);
// this file owns xterm, keys, wheel and the panel chrome.
(function () {
  const $panel = document.getElementById('termpanel');
  const $host = document.getElementById('term-host');
  const $title = document.getElementById('term-title');
  const $sub = document.getElementById('term-sub');
  const $dot = document.getElementById('term-dot');
  const $status = document.getElementById('term-status');
  const $close = document.getElementById('term-close');

  let term = null;      // xterm instance (created once, reused)
  let fit = null;
  let current = null;   // { id, paneId }
  let resizeTimer = null;

  // Keystrokes and paste bytes for the attached pane. Typing means the user
  // is done with any selection, so output resumes (see onFrame).
  function sendInput(data) {
    if (!current) return;
    if (term.hasSelection()) term.clearSelection();
    window.office.term.input(current.id, data);
  }

  function ensureTerm() {
    if (term) return;
    term = new Terminal({
      fontFamily: 'ui-monospace, Menlo, "JetBrains Mono", monospace',
      fontSize: 12,
      lineHeight: 1.15,
      cursorBlink: true,
      allowProposedApi: true,
      macOptionIsMeta: true, // Option+Enter reaches the agent as Meta+Enter (newline in Claude Code)
      scrollback: 0,         // herdr owns the scrollback; the wheel scrolls the pane (see onWheel)
      smoothScrollDuration: 0,
      // OSC 8 hyperlinks (Claude Code prints these): xterm's default would
      // window.open them inside Herdquarters; send them to the browser instead.
      linkHandler: { activate: (_ev, url) => window.office.openExternal(url), allowNonHttpProtocols: false },
      theme: {
        background: '#0f1118', foreground: '#dfe3f0', cursor: '#c9d2ff',
        selectionBackground: 'rgba(201,210,255,.25)',
        black: '#1b1e2b', brightBlack: '#5d6580',
      },
    });
    fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open($host);
    enableWebgl();
    term.onData(sendInput);
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== 'keydown') return true;
      // Esc with the panel focused still goes to the agent (Claude uses it),
      // so closing is Cmd+W / the button, not Esc.
      if (ev.metaKey && ev.key === 'w') { ev.preventDefault(); close(); return false; }
      // Paste: images cannot travel through the browser paste event, so look
      // at the clipboard ourselves. Cmd+V and Ctrl+V both work.
      if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey && ev.key.toLowerCase() === 'v') { ev.preventDefault(); pasteFromClipboard(); return false; }
      // Cmd+arrows, Cmd+Backspace/Delete, Shift+Enter (see term-keys.js).
      const bytes = window.termKeys.keyToBytes(ev);
      if (bytes) { ev.preventDefault(); sendInput(bytes); return false; }
      return true;
    });
    term.element.addEventListener('paste', (ev) => { ev.preventDefault(); ev.stopPropagation(); pasteFromClipboard(); }, true);
    // Copy: join the rows herdr wrapped a long line over (see term-copy.js).
    // Runs before xterm's own copy handler, which would break the line per row.
    term.element.addEventListener('copy', (ev) => {
      if (!term.hasSelection()) return;
      ev.clipboardData.setData('text/plain', window.termCopy.selectionText(term));
      ev.preventDefault(); ev.stopPropagation();
      term.clearSelection(); // copied; let the output move again
    }, true);
    // URLs are links: click opens them in the browser (see term-links.js).
    term.registerLinkProvider(window.termLinks.linkProvider(term, (url) => window.office.openExternal(url)));
    term.onSelectionChange(releaseHeld);
    term.attachCustomWheelEventHandler(onWheel);
    // If the pane turns mouse tracking on, undo it in xterm only so drag-select
    // keeps working (see term-select.js). The pane still gets our wheel scrolls.
    window.office.term.onData(({ id, data }) => { if (current && id === current.id) onFrame(data); });
    window.office.term.onExit(({ id, reason }) => {
      if (!current || id !== current.id) return;
      current = null; // so the next click on this desk attaches again
      showStatus(`Terminal gone (${reason}). Click the desk again to reconnect.`);
    });
    new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applyFit, 60);
    }).observe($host);
  }

  // GPU renderer; falls back to the DOM renderer if WebGL is unavailable
  // or the context is lost (e.g. after the display sleeps).
  function enableWebgl() {
    try {
      const webgl = new WebglAddon.WebglAddon();
      webgl.onContextLoss(() => { webgl.dispose(); console.warn('xterm: WebGL context lost, using DOM renderer'); });
      term.loadAddon(webgl);
    } catch (err) {
      console.warn('xterm: WebGL unavailable, using DOM renderer', err);
    }
  }

  // ---- frames and selection ----
  // Every frame redraws the screen in place, which would pull the text out
  // from under a selection (and xterm cannot follow it: the rows are moved by
  // cursor positioning, not scrolled). So while text is selected the frames
  // are held and applied once the selection clears: a click, a copy, a key.
  const HOLD_MAX = 4 * 1024 * 1024;
  const HOLD_MSG = 'Output paused while text is selected — copy, click or type to resume';
  let held = '';

  function write(data) { term.write(data, () => window.termSelect.keepSelectable(term)); }

  function onFrame(data) {
    if (!term.hasSelection()) { write(data); return; }
    held += data;
    if (held.length > HOLD_MAX) { term.clearSelection(); return; } // releaseHeld() applies it
    showStatus(HOLD_MSG);
  }

  function releaseHeld() {
    if (term.hasSelection() || !held) return;
    const data = held;
    held = '';
    if ($status.textContent === HOLD_MSG) hideStatus();
    write(data);
  }

  async function pasteFromClipboard() {
    if (!current) return;
    const clip = await window.office.clipboardPeek();
    if (!current) return;
    if (clip.hasImage) {
      // Ctrl+V byte: Claude Code reads the image straight from the clipboard.
      // Image wins even when text rides along (Slack and browsers add a link
      // or HTML next to a copied image), which is what Ctrl+V does in a
      // normal terminal too.
      sendInput('\x16');
    } else if (clip.hasText) {
      term.paste(clip.text); // honours bracketed paste mode
    }
  }

  // ---- wheel scrolling ----
  // herdr keeps the scrollback and renders the viewport for us, so scrolling
  // means asking it to move. Accumulate pixels, convert to whole lines using
  // the real cell height, and send one scroll command per animation frame.
  const SCROLL_SPEED = 1.0;
  let wheelAcc = 0, wheelRaf = null;

  function cellHeight() {
    const d = term._core?._renderService?.dimensions?.css?.cell;
    return d && d.height ? d.height : 16;
  }

  function onWheel(ev) {
    if (!current || ev.deltaY === 0) return true;
    if (term.hasSelection()) term.clearSelection(); // scrolling means the selection is done with
    const height = cellHeight();
    let dy = ev.deltaY;
    if (ev.deltaMode === WheelEvent.DOM_DELTA_LINE) dy *= height;
    else if (ev.deltaMode === WheelEvent.DOM_DELTA_PAGE) dy *= height * term.rows;
    wheelAcc += dy * SCROLL_SPEED;
    if (!wheelRaf) wheelRaf = requestAnimationFrame(flushWheel);
    ev.preventDefault();
    return false; // we handled it; xterm must not scroll its own (empty) buffer
  }

  function flushWheel() {
    wheelRaf = null;
    if (!current) { wheelAcc = 0; return; }
    const height = cellHeight();
    const lines = Math.trunc(wheelAcc / height);
    if (!lines) return;
    wheelAcc -= lines * height;
    const n = Math.min(Math.abs(lines), term.rows); // at most one page per frame
    window.office.term.scroll(current.id, lines < 0 ? 'up' : 'down', n);
  }

  function applyFit() {
    if (!term || $panel.hidden) return;
    try { fit.fit(); } catch { return; }
    if (current) window.office.term.resize(current.id, term.cols, term.rows);
  }

  function showStatus(msg) { $status.textContent = msg; $status.hidden = false; }
  function hideStatus() { $status.hidden = true; }

  // Opens run one at a time: a double-click or a tab switch racing a click
  // must not start two attachments (herdr refuses the second and the first
  // would be orphaned, holding the pane).
  let queue = Promise.resolve();
  function open(desk) {
    const run = queue.then(() => openNow(desk));
    queue = run.catch(() => {});
    return run;
  }

  async function openNow(desk) {
    ensureTerm();
    if (current && current.paneId === desk.paneId) { term.focus(); return; }
    await detach();
    $panel.hidden = false;
    document.body.classList.add('panel-open');
    $title.textContent = desk.title;
    $sub.textContent = `${desk.floor} · ${desk.room} · ${desk.paneId}`;
    setPose(desk.pose);
    hideStatus();
    held = '';
    term.reset();
    applyFit();
    const id = await window.office.term.open({ paneId: desk.paneId, cols: term.cols, rows: term.rows });
    current = { id, paneId: desk.paneId };
    term.focus();
  }

  async function detach() {
    wheelAcc = 0;
    held = '';
    if (!current) return;
    const { id } = current;
    current = null;
    await window.office.term.close(id);
  }

  async function close() {
    await detach();
    $panel.hidden = true;
    document.body.classList.remove('panel-open');
    window.officeSidebar?.refresh();
  }

  function setPose(pose) {
    $dot.className = `dot ${pose === 'blocked' ? 'blocked' : pose === 'working' ? 'working' : pose === 'done' ? 'done' : 'idle'}`;
  }

  // Called by app.js after each snapshot so the header follows the agent.
  function update(desks) {
    if (!current) return;
    const d = desks.find((x) => x.id === current.paneId);
    if (!d) { showStatus('That pane is gone.'); return; }
    $title.textContent = d.title;
    setPose(d.pose);
  }

  $close.addEventListener('click', close);
  document.getElementById('term-layout').addEventListener('click', () => {
    const cur = window.officeSettings.get().termLayout;
    window.officeSettings.set({ termLayout: cur === 'full' ? 'split' : 'full' });
  });
  // Drag the divider to resize the split; double-click resets. Width lives in settings.
  const $grip = document.getElementById('termpanel-resizer');
  let drag = null;
  $grip?.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const $side = document.getElementById('sidebar');
    drag = window.panelDrag.start({
      total: $panel.parentElement.getBoundingClientRect().width,
      reserved: $side && !$side.hidden ? $side.getBoundingClientRect().width : 0,
      panelWidth: $panel.getBoundingClientRect().width,
      startX: e.clientX,
    });
    $grip.setPointerCapture(e.pointerId);
    document.body.classList.add('panel-resizing');
    e.preventDefault();
  });
  // On window, not the grip, so the drag holds even if pointer capture does not.
  window.addEventListener('pointermove', (e) => {
    const pct = drag?.move(e.clientX);
    if (pct == null) return;
    document.documentElement.style.setProperty('--panel-width', `${pct}%`);
    layoutChanged();
  });
  const endDrag = () => {
    if (!drag) return;
    const pct = drag.end();
    drag = null;
    document.body.classList.remove('panel-resizing');
    if (pct !== null) window.officeSettings.set({ panelWidth: pct });
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  $grip?.addEventListener('dblclick', () => window.officeSettings.set({ panelWidth: window.officeSettings.defaults.panelWidth }));

  function layoutChanged() { clearTimeout(resizeTimer); resizeTimer = setTimeout(applyFit, 60); }
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(applyFit, 60); });

  window.officeTerminal = { open, close, update, layoutChanged, isOpenFor: (paneId) => current?.paneId === paneId };
  window.__term = () => term; // for test/fixtures/term-panel
})();
