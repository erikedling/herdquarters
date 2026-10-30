// Turns the visible screen of an agent pane into a short "what is it doing"
// summary. Tuned for Claude Code's layout; falls back to the last lines.
(function (root) {
  const RULE = /^\s*─{8,}.*$/;                                // input-box rules, sometimes carrying a title
  const OVERLAY = /\s*Jump to bottom \(click\)\s*↓\s*/g;      // herdr's scrollback hint, spliced into a line
  const ACTIVITY = /^\s*[✳✻✶✽✢·*]\s+(.+?)(?:…|\.\.\.)\s*(?:\(.*)?$/;         // "✳ Propagating… (2m 46s · ↓ 4.7k)"
  const FINISHED = /^\s*[✳✻✶✽✢·*]\s+(.+?)\s+for\s+([\dhms ]+?)\s*·\s*done\s+(.+?)\s*$/; // "✻ Cooked for 8s · done 10:36 AM"
  const RECAP = /^\s*※\s*recap:\s*/i;
  const MESSAGE = /^\s*⏺\s?/;                                  // assistant message / tool call bullet
  const NOISE = [
    /Update installed\s*·\s*Restart to update/,
    /^\s*(Tip|※ Tip):/i,
    /^\s*[▀▄█▌▐░▒▓▝▘▖▗▚▞]+/,                                    // banner art
    /^\s*(Opus|Sonnet|Haiku|Fable)\s+\d/,                        // banner model line
  ];
  const STATUS_BAR = /^\s*(⏵⏵|\/Users\/|~\/|ctx:\d+%)/;

  function transcriptLines(text) {
    const lines = String(text || '').replace(OVERLAY, ' ').split('\n');
    // The input box is the last short line starting with the prompt marker
    // that sits directly under a rule. Everything above that rule is transcript.
    let end = lines.length;
    for (let i = lines.length - 1; i > 0; i--) {
      if (/^\s*❯\s*$|^\s*❯\s[^\d]/.test(lines[i]) && lines[i].length < 200 && RULE.test(lines[i - 1])) { end = i - 1; break; }
    }
    if (end === lines.length) {
      while (end > 0 && (RULE.test(lines[end - 1]) || STATUS_BAR.test(lines[end - 1]) || !lines[end - 1].trim())) end--;
    }
    return lines.slice(0, end)
      .filter((l) => !RULE.test(l) && !NOISE.some((re) => re.test(l)))
      .map((l) => l.replace(/\s*\(disable recaps in \/config\)/, '').replace(/\s+$/, ''));
  }

  function compactLines(body, maxLines) {
    const out = [];
    for (const l of body) {
      if (!l.trim()) { if (out.length && out[out.length - 1] !== '') out.push(''); }
      else out.push(l.replace(/^\s{3,}/, (m) => m.slice(0, 2)));
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    while (out.length && out[0] === '') out.shift();
    const truncated = out.length > maxLines;
    return { lines: truncated ? out.slice(-maxLines) : out, truncated };
  }

  function summarizeScreen(text, { maxLines = 8 } = {}) {
    let lines = transcriptLines(text);
    let activity = null, finished = null, recap = null;

    // Status lines near the bottom: a spinner while working, or "done at".
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 12); i--) {
      const f = lines[i].match(FINISHED);
      if (f) { finished = { verb: f[1], took: f[2], at: f[3] }; lines.splice(i, 1); continue; }
      const a = lines[i].match(ACTIVITY);
      if (a && !activity) { activity = a[1].trim(); lines.splice(i, 1); }
    }

    // A recap block (※ recap: …) is the best summary of a finished turn.
    const ri = lines.findIndex((l) => RECAP.test(l));
    if (ri !== -1) {
      const block = [lines[ri].replace(RECAP, '')];
      for (let j = ri + 1; j < lines.length && lines[j].trim() && !MESSAGE.test(lines[j]); j++) block.push(lines[j]);
      recap = block.join('\n').replace(/\s+/g, ' ').trim();
      lines = lines.slice(0, ri);
    }

    // Otherwise the last assistant bullet (⏺) starts the message.
    let start = -1;
    for (let i = lines.length - 1; i >= 0; i--) if (MESSAGE.test(lines[i])) { start = i; break; }
    const body = (start !== -1 ? lines.slice(start) : lines).map((l) => l.replace(MESSAGE, ''));
    const { lines: shown, truncated } = compactLines(body, maxLines);

    return {
      activity,                         // "Propagating"          while working
      finished,                         // { verb, took, at }     after a turn ended
      recap,                            // one paragraph, if Claude printed one
      message: recap || shown.join('\n'),
      truncated: recap ? false : truncated,
    };
  }

  root.summarizeScreen = summarizeScreen;
})(typeof window !== 'undefined' ? window : module.exports);
