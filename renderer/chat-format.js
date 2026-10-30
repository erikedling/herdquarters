// Pure helpers for the assistant's chat window: its markdown as safe HTML,
// what an hq:// link opens, and OFFICE.md (the tickets and people it can
// link to). No DOM, so test/chat-format.test.js runs them in node; the
// browser gets them as window.officeChat.
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // hq://desk/<pane>, hq://tab/<slug>, hq://slack/<slug>, or a web link.
  function linkTarget(href) {
    const hq = String(href || '').match(/^hq:\/\/(desk|tab|slack)\/([^\s/?#]+)$/);
    if (hq) return hq[1] === 'desk' ? { kind: 'desk', id: decodeURIComponent(hq[2]) } : { kind: hq[1], slug: decodeURIComponent(hq[2]) };
    if (/^https?:\/\/[^\s]+$/.test(href)) return { kind: 'web', url: href };
    return null;
  }

  // Inline: `code`, **bold**, _italic_, [text](link). Text is escaped first;
  // a link is kept only when linkTarget() knows it.
  function inline(text) {
    const codes = [];
    let s = esc(text).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => {
      const raw = href.replace(/&amp;/g, '&');
      return linkTarget(raw) ? `<a href="${esc(raw)}">${label}</a>` : m;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])_([^_]+)_(?=[\s.,!?)]|$)/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
  }

  // Blocks: paragraphs, - and 1. lists, ``` code, # headings (as a bold line).
  function md(text) {
    const lines = String(text || '').replace(/\r/g, '').split('\n');
    const out = [];
    let para = [], list = null;
    const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
    const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('```')) {
        flushPara(); flushList();
        const code = [];
        while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
        out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
        continue;
      }
      const bullet = line.match(/^\s*[-*]\s+(.*)$/), numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (bullet || numbered) {
        flushPara();
        const tag = bullet ? 'ul' : 'ol';
        if (list && list.tag !== tag) flushList();
        if (!list) list = { tag, items: [] };
        list.items.push((bullet || numbered)[1]);
        continue;
      }
      flushList();
      const heading = line.match(/^#{1,6}\s+(.*)$/);
      if (heading) { flushPara(); out.push(`<p><strong>${inline(heading[1])}</strong></p>`); continue; }
      if (!line.trim()) { flushPara(); continue; }
      para.push(line);
    }
    flushPara(); flushList();
    return out.join('');
  }

  const POSE = { working: 'working', idle: 'idle', done: 'done', blocked: 'needs the user', away: 'asking its boss', alert: 'raising an alert' };

  // OFFICE.md. names: character names by index (characters.js).
  function officeMarkdown({ orchestrators = [], desks = [], names = [], now = Date.now() }) {
    const view = (typeof module !== 'undefined' && module.exports) ? require('./view') : window.officeView;
    const out = ['# The office right now', '', 'Written by the office. Link with these in your answers; the links open things in the office:',
      '`hq://tab/<slug>` shows a ticket, `hq://desk/<pane>` opens that agent\'s terminal (the conversation with it), `hq://slack/<slug>` opens the ticket\'s Slack findings.', '', '## Tickets', ''];
    if (!orchestrators.length) out.push('None open.');
    for (const o of orchestrators) {
      const mine = desks.filter((d) => d.orch?.slug === o.slug);
      const card = view.ticketCard(o, mine, now);
      const waiting = view.waitingCount(o, mine, now);
      const bits = [o.branch ? `branch \`${o.branch}\`` : '', card.total ? `${card.done}/${card.total} tasks` : 'no tasks yet', waiting ? `${waiting} waiting on you` : ''].filter(Boolean);
      out.push(`- [${o.name}](hq://tab/${o.slug}) — ${bits.join(', ')} · Slack: hq://slack/${o.slug}`);
    }
    out.push('', '## People', '');
    const people = desks.filter((d) => d.kind === 'agent' && d.character != null);
    if (!people.length) out.push('Nobody at a desk.');
    const orchName = (slug) => orchestrators.find((o) => o.slug === slug)?.name || slug;
    for (const d of people) {
      const name = names.length ? names[d.character % names.length] : d.title || d.id;
      const where = d.role === 'boss' ? `boss of ${orchName(d.orch.slug)}`
        : d.orch ? `${d.role || 'worker'} in ${d.floor} for ${orchName(d.orch.slug)}`
          : `in ${d.floor}`;
      out.push(`- [${name}](hq://desk/${d.id}) — ${where}, ${POSE[d.pose] || d.pose}`);
    }
    return out.join('\n') + '\n';
  }

  const api = { md, linkTarget, officeMarkdown, esc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.officeChat = api;
})();
