// Collects uncaught renderer errors so the main process can read them in debug runs.
window.__errors = [];
window.addEventListener("error", (e) => window.__errors.push(`${e.message} @${(e.filename || "").split("/").pop()}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => window.__errors.push(`rejection: ${e.reason && e.reason.message || e.reason}`));
