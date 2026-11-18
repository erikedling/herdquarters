// Last script: the Dock app marks a version good on this message. Only the window's own code counts:
// a rejected IPC call (herdr still starting, gh offline) is outside it and is only logged.
(function () {
  const PARTS = ['officeView', 'officeTerminal', 'officeSidebar', 'officeTabs', 'officeSettings', 'officeUpdates', 'officeWelcome', 'officeNotice'];
  const missing = PARTS.filter((k) => !window[k]);
  const errors = window.__scriptErrors || [];
  if (missing.length || errors.length) {
    console.error(`not ready: ${[...missing.map((k) => `${k} missing`), ...errors].join('; ')}`);
    return;
  }
  const others = (window.__errors || []).filter((e) => !errors.includes(e));
  if (others.length) console.warn(`ready, with errors outside the window's code: ${others.join('; ')}`);
  window.office.ready?.();
})();
