// Collects uncaught renderer errors so the main process can read them in debug runs.
// __scriptErrors holds only errors thrown by the window's own scripts, which renderer/ready.js judges by.
window.__errors = [];
window.__scriptErrors = [];
window.addEventListener("error", (e) => {
  const line = `${e.message} @${(e.filename || "").split("/").pop()}:${e.lineno}`;
  window.__errors.push(line);
  if (/\/renderer\/[^/]+\.js$/.test(e.filename || "")) window.__scriptErrors.push(line);
});
window.addEventListener("unhandledrejection", (e) => window.__errors.push(`rejection: ${e.reason && e.reason.message || e.reason}`));
