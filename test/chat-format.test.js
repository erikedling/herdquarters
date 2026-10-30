// The chat window: the assistant's markdown becomes safe HTML, its hq://
// links open things in the office, and OFFICE.md tells it what it can link.
const test = require('node:test');
const assert = require('node:assert');
const { md, linkTarget, officeMarkdown } = require('../renderer/chat-format');

test('md(): paragraphs, bold, code, lists and links, with HTML escaped', () => {
  assert.strictEqual(md('Hi **Mia**, see `BOARD.md`.'), '<p>Hi <strong>Mia</strong>, see <code>BOARD.md</code>.</p>');
  assert.strictEqual(md('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
  assert.strictEqual(md('1. first\n2. second'), '<ol><li>first</li><li>second</li></ol>');
  assert.strictEqual(md('a\n\nb'), '<p>a</p><p>b</p>');
  assert.strictEqual(md('line one\nline two'), '<p>line one<br>line two</p>');
  assert.strictEqual(md('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  assert.strictEqual(md('[Maja](hq://desk/wB:p1)'), '<p><a href="hq://desk/wB:p1">Maja</a></p>');
  assert.strictEqual(md('[PR](https://github.com/acme/x/pull/1)'), '<p><a href="https://github.com/acme/x/pull/1">PR</a></p>');
  // anything else is not a link
  assert.strictEqual(md('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>');
  assert.strictEqual(md('```\nconst a = 1;\n```'), '<pre><code>const a = 1;</code></pre>');
  assert.strictEqual(md('## Today'), '<p><strong>Today</strong></p>');
});

test('linkTarget(): what a link in the chat opens', () => {
  assert.deepStrictEqual(linkTarget('hq://desk/wB:p1'), { kind: 'desk', id: 'wB:p1' });
  assert.deepStrictEqual(linkTarget('hq://tab/search-relevance'), { kind: 'tab', slug: 'search-relevance' });
  assert.deepStrictEqual(linkTarget('hq://slack/search-relevance'), { kind: 'slack', slug: 'search-relevance' });
  assert.deepStrictEqual(linkTarget('https://example.com/a'), { kind: 'web', url: 'https://example.com/a' });
  assert.strictEqual(linkTarget('hq://nope/x'), null);
  assert.strictEqual(linkTarget('file:///etc/passwd'), null);
});

test('officeMarkdown(): every ticket and person, with the links to use', () => {
  const o = { slug: 'search', name: 'Search relevance', branch: 'mia/search', board: { tasks: [{ done: true }, { done: false }], questions: ['q'] } };
  const desks = [
    { id: 'wB:p1', kind: 'agent', character: 0, role: 'boss', orch: { slug: 'search' }, floor: 'Search relevance', pose: 'working' },
    { id: 'wC:p1', kind: 'agent', character: 1, role: 'worker', orch: { slug: 'search' }, floor: 'catalog-api', pose: 'idle' },
    { id: 'wR:p1', kind: 'agent', character: 2, floor: 'platform-infra', pose: 'blocked' },
    { id: 'wR:p2', kind: 'shell', character: 3, floor: 'platform-infra', pose: 'idle' },
  ];
  const text = officeMarkdown({ orchestrators: [o], desks, names: ['Maja', 'Jonas', 'Patrik', 'Sara'], now: 0 });
  assert.match(text, /- \[Search relevance\]\(hq:\/\/tab\/search\) — branch `mia\/search`, 1\/2 tasks, 1 waiting on you · Slack: hq:\/\/slack\/search/);
  assert.match(text, /- \[Maja\]\(hq:\/\/desk\/wB:p1\) — boss of Search relevance, working/);
  assert.match(text, /- \[Jonas\]\(hq:\/\/desk\/wC:p1\) — worker in catalog-api for Search relevance, idle/);
  assert.match(text, /- \[Patrik\]\(hq:\/\/desk\/wR:p1\) — in platform-infra, needs the user/);
  assert.doesNotMatch(text, /Sara/); // a plain shell is nobody to talk to
});
