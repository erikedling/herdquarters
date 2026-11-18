// Last script: the Dock app marks a version good on this message, so a part that threw while starting keeps it from counting.
(function () {
  const PARTS = ['officeView', 'officeTerminal', 'officeSidebar', 'officeTabs', 'officeSettings', 'officeUpdates', 'officeWelcome', 'officeNotice'];
  const missing = PARTS.filter((k) => !window[k]);
  const errors = window.__errors || [];
  if (missing.length || errors.length) {
    console.error(`not ready: ${[...missing.map((k) => `${k} missing`), ...errors].join('; ')}`);
    return;
  }
  window.office.ready?.();
})();
