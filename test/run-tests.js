'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { parseFeed } = require('../lib/feeds');
const rules = require('../lib/rules');
const claude = require('../lib/ai');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.error('FAIL ' + name + '\n     ' + e.message); process.exitCode = 1; }
}
const fx = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');

test('parses RSS with CDATA, HTML and dates', () => {
  const items = parseFeed(fx('econ.xml'));
  assert.strictEqual(items.length, 4);
  assert.ok(!items[0].text.includes('<p>'));
  assert.strictEqual(items[0].published, '2026-10-01T06:30:00.000Z');
});

test('keyword rules keep economy news, keep spillovers, drop noise', () => {
  assert.strictEqual(rules.score('Bollywood actor launches new fashion line', '', 'econ'), null);
  assert.ok(rules.score('Rupee slips to 96 per dollar', '', 'econ').keep);
  const s = rules.score('Tankers attacked near Strait of Hormuz, crude jumps', '', 'general');
  assert.ok(s.keep);
  assert.strictEqual(rules.score('Heritage walk organised in old city', 'Residents joined', 'general').keep, false);
});

test('figures not in the source are flagged', () => {
  const miss = claude.unmatchedFigures('GST rose 14.7% to ₹2.04 lakh crore, up from 1.95', 'Gross GST rose 14.7% to ₹2.04 lakh crore');
  assert.deepStrictEqual(miss, ['1.95']);
  assert.deepStrictEqual(claude.unmatchedFigures('FPIs sold ₹35,861 crore', 'sold ₹35861 crore'), []);
});

test('story replies are cleaned and checked', () => {
  const item = { title: 'GST up 14.7%', text: 'Gross GST rose 14.7% to ₹2.04 lakh crore.' };
  const s = claude.validateStory({ headline: 'GST tops ₹2 lakh crore', summary: 'GST rose 14.7% to ₹2.04 lakh crore.', marks: ['14.7%', 'not there'], chain: [{ kind: 'weird', label: 'x' }], impacts: { inflation: 5, rupee: -0.4, fiscal: 1 } }, item);
  assert.deepStrictEqual(s.marks, ['14.7%']);
  assert.strictEqual(s.chain[0].kind, 'variable');
  assert.strictEqual(s.impacts.inflation, 1);
  assert.strictEqual(s.impacts.rupee, 0);
  assert.strictEqual(s.figureCheck, '');
  const bad = claude.validateStory({ headline: 'GST up', summary: 'GST rose 18% this month.' }, item);
  assert.ok(bad.figureCheck.includes('18'));
  assert.throws(() => claude.validateStory({ headline: '' }, item));
});

test('triage replies are bounded', () => {
  const v = claude.validateTriage([{ i: 0, keep: true, priority: 9, category: 'Fiscal' }, { i: 7, keep: true }], 2);
  assert.strictEqual(v[0].priority, 5);
  assert.strictEqual(v[1], null);
});

test('edition replies need a real thread and valid quiz answers', () => {
  const e = claude.validateEdition({ thread: { title: 'T', nodes: [{ label: 'a' }, { label: 'b' }, { label: 'c' }], storyIds: ['s1', 'zz'] }, quiz: [{ q: 'Q', options: ['a', 'b'], answer: 3 }, { q: 'Q2', options: ['a', 'b'], answer: 1 }] }, ['s1']);
  assert.deepStrictEqual(e.thread.storyIds, ['s1']);
  assert.strictEqual(e.quiz.length, 1);
  assert.throws(() => claude.validateEdition({ thread: { nodes: [{ label: 'a' }] } }, []));
});

test('JSON is extracted from a chatty reply', () => {
  assert.deepStrictEqual(claude.extractJson('Here you go:\n{"a": [1]}\nThanks'), { a: [1] });
});

test('seed edition is complete', () => {
  const s = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'edition.json'), 'utf8'));
  assert.ok(s.stories.length >= 6 && s.pulse.length >= 6 && s.thread.nodes.length >= 4);
  s.stories.forEach((st) => { (st.marks || []).forEach((m) => assert.ok(st.summary.includes(m), st.id + ': ' + m)); });
  s.quiz.forEach((q) => assert.ok(q.answer < q.options.length));
});


test('general patterns cover common news without guessing a direction', () => {
  const { templateFor } = require('../lib/templates');
  const t = templateFor('Oil prices ease as Iran tensions cool', '');
  assert.ok(t && t.chain.length >= 3 && t.chain.every((c) => c.added));
  assert.ok(Object.values(t.impacts).every((v) => v === 0));
  assert.strictEqual(templateFor('Heritage walk organised in old city', ''), null);
});

const pendingAsync = [];
pendingAsync.push((async () => {
  // Gemini request shape and error handling, with fetch stubbed (no network).
  const realFetch = global.fetch;
  let seen = null;
  global.fetch = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"cards":[{"i":0,"headline":"GST tops ₹2 lakh crore","summary":"GST rose 14.7% to ₹2.04 lakh crore.","marks":["14.7%"],"chain":[],"impacts":{}},{"i":1,"headline":""}]}' }] } }] }) }; };
  const items = [{ sourceName: 'X', title: 'GST up 14.7%', text: 'Gross GST rose 14.7% to ₹2.04 lakh crore.' }, { sourceName: 'X', title: 'Other', text: 'Other' }];
  const out = await claude.analyseBatch({ provider: 'gemini', apiKey: 'k', model: 'gemini-test' }, items);
  test('Gemini request is well formed and a batch reply is validated per story', () => {
    assert.ok(seen.url.includes('/models/gemini-test:generateContent'));
    assert.strictEqual(seen.init.headers['x-goog-api-key'], 'k');
    const body = JSON.parse(seen.init.body);
    assert.strictEqual(body.generationConfig.responseMimeType, 'application/json');
    assert.ok(body.contents[0].parts[0].text.startsWith('Turn each of these news items'));
    assert.ok(out[0] && out[0].headline.startsWith('GST'));
    assert.strictEqual(out[1], null);
  });
  global.fetch = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'Quota exceeded' } }) });
  let err = null;
  try { await claude.analyseBatch({ provider: 'gemini', apiKey: 'k', model: 'm' }, items); } catch (e) { err = e; }
  test('a rate-limit reply is recognised so the server can pause', () => { assert.ok(err && err.rateLimited); });
  global.fetch = realFetch;
})());


test('front-page reply: duplicate groups and numbers are checked', () => {
  const stories = [{ id: 's1', summary: 'Sensex rose 879 points to 72,472 on Friday.' }, { id: 's2', summary: 'Other.' }];
  const e = claude.validateEdition({ thread: { title: 'T', nodes: [{ label: 'a' }, { label: 'b' }, { label: 'c' }] },
    sameEvent: [['s1', 's2', 'zz'], ['s1']],
    numbers: [{ id: 'sensex', value: '72,472', direction: 'up', storyId: 's1' }, { id: 'brent', value: '105', storyId: 's1' }, { id: 'bogus', value: '1', storyId: 's1' }] }, ['s1', 's2'], stories);
  assert.deepStrictEqual(e.sameEvent, [['s1', 's2']]);
  assert.strictEqual(e.numbers.length, 1);
  assert.strictEqual(e.numbers[0].value, '72,472');
});

test('long text is shortened at a word boundary', () => {
  const src = 'Middle East supply risks pushed crude oil prices past $100 per barrel, forcing state-run oil firms to buy dollars';
  const s = claude.str(src, 60);
  assert.ok(s.endsWith('…') && s.length <= 61);
  const last = s.slice(0, -1).split(' ').pop();
  assert.ok(src.split(/[ ,]+/).includes(last), last);
});

// ---------- End to end with the demo feeds and the mock model ----------
function boot(port, extraEnv) {
  const dataFile = path.join(os.tmpdir(), 'edesk-' + process.pid + '-' + port + '.json');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), SOURCES_FILE: 'test/fixtures/sources.json', CLAUDE_MOCK: '1', ANTHROPIC_API_KEY: '', MAX_AGE_HOURS: '100000', DATA_FILE: dataFile, POLL_MINUTES: '60' }, extraEnv || {}),
    stdio: 'ignore'
  });
  return { child, dataFile };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const a = boot(3931);
  const b = boot(3932, { ACCESS_KEY: 'secret123' });
  const c = boot(3933, { CLAUDE_MOCK: '', AI_MOCK: '' });
  try {
    await Promise.all(pendingAsync);
    await wait(2000);
    const desk = await (await fetch('http://localhost:3931/api/desk')).json();
    test('live desk has stories, spillovers and an edition', () => {
      assert.strictEqual(desk.mode, 'live');
      assert.ok(desk.stories.length >= 4, 'stories ' + desk.stories.length);
      assert.ok(desk.stories.some((s) => s.kind === 'spillover'), 'spillover');
      assert.ok(desk.thread && desk.thread.nodes.length >= 2, 'thread');
      assert.ok(!desk.stories.some((s) => /cricket|Bollywood|Heritage walk/i.test(s.headline)), 'noise dropped');
    });
    test('key numbers update themselves from the news', () => {
      const g = desk.pulse.find((x) => x.id === 'gst');
      assert.ok(g && /news report/.test(g.note), JSON.stringify(g));
      assert.strictEqual(g.value, '2.04');
    });
    test('duplicate headlines from two outlets merge into one card', () => {
      const gst = desk.stories.filter((s) => /GST/.test(s.headline));
      assert.strictEqual(gst.length, 1);
      assert.ok(gst[0].sources.length >= 2);
    });
    test('official source is labelled official', () => {
      const pib = desk.stories.find((s) => /economic review/i.test(s.headline));
      assert.ok(pib, 'PIB story present');
      assert.strictEqual(pib.status, 'official');
    });
    const home = await fetch('http://localhost:3931/');
    const html = await home.text();
    test('page is served with the desk inlined', () => {
      assert.strictEqual(home.status, 200);
      assert.ok(html.startsWith('<!doctype html>') && html.includes('<script id="snapshot" type="application/json">{"mode":"live"'));
    });
    const man = await fetch('http://localhost:3931/manifest.webmanifest');
    const trav = await fetch('http://localhost:3931/..%2Fserver.js');
    test('install files served; path traversal refused', () => {
      assert.ok((man.headers.get('content-type') || '').includes('manifest'));
      assert.ok(trav.status === 403 || trav.status === 404);
    });
    const free = await (await fetch('http://localhost:3933/api/desk')).json();
    test('with no AI key it still works, using labelled general patterns', () => {
      assert.ok(free.stories.length >= 4);
      assert.ok(free.stories.every((s) => s.basic));
      assert.ok(free.stories.some((s) => s.pattern && s.chain.length >= 3));
      assert.ok(/GEMINI_API_KEY/.test(free.notice));
    });
    const locked = await fetch('http://localhost:3932/api/desk');
    const unlock = await fetch('http://localhost:3932/?key=secret123', { redirect: 'manual' });
    const cookie = (unlock.headers.get('set-cookie') || '').split(';')[0];
    const opened = await fetch('http://localhost:3932/api/desk', { headers: { cookie } });
    test('access key protects the dashboard', () => {
      assert.strictEqual(locked.status, 401);
      assert.strictEqual(unlock.status, 302);
      assert.strictEqual(opened.status, 200);
    });
  } catch (e) {
    console.error('FAIL end-to-end\n     ' + e.message); process.exitCode = 1;
  } finally {
    [a, b, c].forEach((x) => { x.child.kill(); try { fs.unlinkSync(x.dataFile); } catch (e) {} });
    console.log(passed + ' checks passed' + (process.exitCode ? ', with failures' : ''));
  }
})();
