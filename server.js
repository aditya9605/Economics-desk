'use strict';
// Economy Desk: a personal, live economics dashboard.
// Polls news feeds, sorts them, asks an AI model (Gemini free tier or Claude) to draw the economic linkages,
// and pushes updates to the page. Runs with no AI at all too, using general patterns.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { parseFeed, fetchText } = require('./lib/feeds');
const store = require('./lib/store');
const rules = require('./lib/rules');
const ai = require('./lib/ai');
const { templateFor } = require('./lib/templates');

const ROOT = __dirname;
const env = process.env;
const PORT = +env.PORT || 3000;
const POLL_MINUTES = +env.POLL_MINUTES || 15;
const MAX_AGE_HOURS = +env.MAX_AGE_HOURS || 72;
const GEMINI_KEY = env.GEMINI_API_KEY || '';
const CLAUDE_KEY = env.ANTHROPIC_API_KEY || '';
const MOCK = env.CLAUDE_MOCK === '1' || env.AI_MOCK === '1';
const PROVIDER = MOCK ? 'mock' : CLAUDE_KEY ? 'claude' : GEMINI_KEY ? 'gemini' : 'none';
const FREE = PROVIDER === 'gemini';
const MODEL = PROVIDER === 'claude' ? (env.CLAUDE_MODEL || 'claude-sonnet-5-5') : (env.GEMINI_MODEL || 'gemini-3.5-flash-lite');
// Free tiers allow only a small number of requests a day, so the defaults are cautious.
const AI_CALLS_PER_DAY = +env.AI_CALLS_PER_DAY || (FREE ? 20 : 300);
const AI_EVERY_MINUTES = +env.AI_EVERY_MINUTES || (FREE ? 90 : 15);
const STORIES_PER_CALL = +env.STORIES_PER_CALL || 6;
const EDITION_HOURS = +env.EDITION_HOURS || (FREE ? 6 : 3);
const ACCESS_KEY = env.ACCESS_KEY || '';
const file = (v, d) => path.resolve(ROOT, v || d);
const SOURCES_FILE = file(env.SOURCES_FILE, 'config/sources.json');
const DATA_FILE = file(env.DATA_FILE, 'data/state.json');
const SEED_FILE = file(env.SEED_FILE, 'seed/edition.json');
const PULSE_FILE = file(env.PULSE_FILE, 'config/pulse.json');
const WATCH_FILE = file(env.WATCH_FILE, 'config/watch.json');
const EXTRAS_FILE = file(env.EXTRAS_FILE, 'config/extras.json');
const PUBLIC = path.join(ROOT, 'public');

const AI = PROVIDER === 'none' ? null : { provider: PROVIDER, apiKey: PROVIDER === 'claude' ? CLAUDE_KEY : GEMINI_KEY, model: MODEL, mock: MOCK ? require('./lib/mock') : null };
const sources = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
const seed = store.load(SEED_FILE, null);
let db = store.load(DATA_FILE, null) || { items: {}, edition: null, editionAt: 0, analysedSinceEdition: 0 };
db.ai = db.ai || { date: '', calls: 0, lastRun: 0, pausedUntil: 0, lastError: '' };
const sourceStatus = {};
let lastRefresh = null, refreshing = false, liveInr = null;
const clients = new Set();

const resolveUrl = (u) => (u.startsWith('file:') && !u.startsWith('file://') ? pathToFileURL(path.resolve(ROOT, u.slice(5))).href : u);
const ageH = (it, now) => (now - Date.parse(it.published || it.firstSeen)) / 36e5;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- Duplicate detection across outlets ----------
const STOP = new Set('the a an of to in on for and with at by from as is are be its it this that after over into amid says said will new india indias'.split(' '));
function tokens(t) { return new Set(t.toLowerCase().replace(/[^a-z0-9₹%. ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))); }
function similar(a, b) {
  const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0;
  let n = 0; A.forEach((w) => { if (B.has(w)) n++; });
  return n / Math.min(A.size, B.size);
}
function findDuplicate(item, now) {
  for (const it of Object.values(db.items)) {
    if (it.id === item.id || it.dupOf || Math.abs(Date.parse(it.published || it.firstSeen) - Date.parse(item.published || item.firstSeen)) > 36 * 36e5) continue;
    if (similar(it.title, item.title) >= 0.6) return it;
  }
  return null;
}

// ---------- One refresh cycle ----------
async function fetchAll(now) {
  let added = [];
  await Promise.all(sources.map(async (s) => {
    const st = (sourceStatus[s.short] = { name: s.name, short: s.short, kind: s.kind, official: !!s.official, ok: false, error: null, count: 0, checked: new Date().toISOString() });
    try {
      const parsed = parseFeed(await fetchText(resolveUrl(s.url), 20000));
      st.ok = parsed.length > 0; st.count = parsed.length;
      if (!parsed.length) st.error = 'Feed returned no items. Check the address.';
      for (const p of parsed) {
        const id = store.idFor(p.link);
        if (db.items[id]) continue;
        const it = { id, source: s.short, sourceName: s.name, kind: s.kind, official: !!s.official, title: p.title, link: p.link, text: (p.text || '').slice(0, 3500), published: p.published, firstSeen: new Date(now).toISOString(), state: 'new' };
        if (ageH(it, now) > MAX_AGE_HOURS) continue;
        db.items[id] = it; added.push(it);
      }
    } catch (e) { st.error = e.message; }
  }));
  return added;
}

// ---------- AI request budget ----------
function aiAllowed(now, n) {
  if (!AI) return false;
  const today = new Date(now).toISOString().slice(0, 10);
  if (db.ai.date !== today) { db.ai.date = today; db.ai.calls = 0; }
  if (now < (db.ai.pausedUntil || 0)) return false;
  return db.ai.calls + (n || 1) <= AI_CALLS_PER_DAY;
}
async function aiCall(now, fn) {
  db.ai.calls++;
  try { const r = await fn(); db.ai.lastError = ''; return r; }
  catch (e) {
    db.ai.lastError = e.message;
    if (e.rateLimited) { db.ai.pausedUntil = now + 60 * 60000; log('[ai] rate limited; pausing for an hour'); }
    throw e;
  }
}

async function triageNew(now) {
  const fresh = Object.values(db.items).filter((it) => it.state === 'new');
  for (const it of fresh) {
    if (it.state !== 'new') continue;
    const dup = findDuplicate(it, now);
    if (!dup) continue;
    // Keep the copy with the fuller text as the main card; the other becomes an "Also in" link.
    let keep = dup, drop = it;
    if (dup.state === 'new' && (it.text || '').length > (dup.text || '').length) { keep = it; drop = dup; }
    drop.state = 'dup'; drop.dupOf = keep.id;
    keep.alsoIn = Array.from(new Set((keep.alsoIn || []).concat(drop.sourceName, drop.alsoIn || [])));
    if (drop.official && !keep.official) keep.officialLink = drop.link;
  }
  const todo = fresh.filter((it) => it.state === 'new');
  // Sorting headlines with AI only when requests are plentiful (Claude). On a free tier, keyword rules do it.
  const useAi = AI && !FREE;
  for (let i = 0; i < todo.length; i += 30) {
    const batch = todo.slice(i, i + 30);
    let verdicts = null;
    if (useAi && aiAllowed(now)) {
      try { verdicts = await aiCall(now, () => ai.triage(AI, batch)); } catch (e) { log('[triage]', e.message); }
    }
    batch.forEach((it, j) => {
      const v = (verdicts && verdicts[j]) || rules.score(it.title, it.text, it.kind) || { keep: false };
      it.triage = v; it.state = v.keep ? 'kept' : 'dropped';
    });
  }
}

async function analyseKept(now) {
  if (!AI) return 0;
  if (now - (db.ai.lastRun || 0) < AI_EVERY_MINUTES * 60000 - 30000) return 0;
  const kept = Object.values(db.items).filter((it) => it.state === 'kept' && ageH(it, now) <= MAX_AGE_HOURS && (it.fails || 0) < 3);
  if (!kept.length) return 0;
  kept.sort((a, b) => b.triage.priority - a.triage.priority || Date.parse(b.published || b.firstSeen) - Date.parse(a.published || a.firstSeen));
  db.ai.lastRun = now;
  let n = 0;
  // Leave one request a day for the front page.
  const batches = FREE ? 1 : 2;
  for (let b = 0; b < batches; b++) {
    const group = kept.slice(b * STORIES_PER_CALL, (b + 1) * STORIES_PER_CALL);
    if (!group.length || !aiAllowed(now, 2)) break;
    try {
      const cards = await aiCall(now, () => ai.analyseBatch(AI, group));
      group.forEach((it, i) => {
        if (cards[i]) { it.story = cards[i]; it.state = 'ready'; n++; }
        else it.fails = (it.fails || 0) + 1;
      });
    } catch (e) { group.forEach((it) => { it.fails = (it.fails || 0) + 1; }); log('[analyse]', e.message); break; }
  }
  db.analysedSinceEdition += n;
  return n;
}

// Shown for stories no AI has analysed: the outlet's own headline and opening lines,
// plus the general pattern for this kind of news (clearly labelled), at no cost.
function basicStory(it) {
  const words = (it.text || '').split(/\s+/).filter(Boolean);
  const tpl = templateFor(it.title, it.text);
  return {
    headline: it.title, summary: words.slice(0, 55).join(' ') + (words.length > 55 ? '…' : ''), marks: [],
    chain: tpl ? tpl.chain : [], impacts: tpl ? tpl.impacts : {}, context: tpl ? tpl.context : '', eureka: '',
    concept: tpl ? tpl.concept : '', syllabus: '', category: (it.triage && it.triage.category) || (tpl && tpl.category) || 'Economy',
    figureCheck: '', basic: true, pattern: !!tpl
  };
}

// Ranking: important stories stay near the top for about a day, then newer news takes over.
function rankScore(it, now) {
  return it.triage.priority * 4 + (it.story && !it.story.basic ? 3 : 0) - ageH(it, now);
}

function storyList(now, order) {
  const merged = db.merged || {};
  const live = Object.values(db.items).filter((it) => (it.state === 'ready' || it.state === 'kept') && ageH(it, now) <= MAX_AGE_HOURS);
  const extra = {};
  live.forEach((it) => {
    const p = merged[it.id];
    if (p && p !== it.id && db.items[p]) (extra[p] = extra[p] || []).push({ name: 'Also in ' + it.sourceName, url: it.link });
  });
  const time = (it) => Date.parse(it.published || it.firstSeen);
  return live
    .filter((it) => !(merged[it.id] && merged[it.id] !== it.id && db.items[merged[it.id]]))
    .sort(order === 'latest' ? (a, b) => time(b) - time(a) : (a, b) => rankScore(b, now) - rankScore(a, now))
    .slice(0, 50)
    .map((it) => {
      const s = it.story || basicStory(it);
      const status = s.figureCheck ? 'check' : it.official ? 'official' : 'press';
      const srcs = [{ name: it.sourceName, url: it.link, official: it.official }];
      if (it.officialLink) srcs.push({ name: 'Official release', url: it.officialLink, official: true });
      (it.alsoIn || []).forEach((n) => srcs.push({ name: 'Also in ' + n, url: it.link }));
      (extra[it.id] || []).forEach((x) => srcs.push(x));
      return {
        id: it.id, kind: it.triage.spillover ? 'spillover' : 'economy', category: s.category || it.triage.category,
        headline: s.headline, summary: s.summary, context: s.context || '', marks: s.marks, chain: s.chain, impacts: s.impacts, eureka: s.eureka,
        concept: s.concept, syllabus: s.syllabus, status, statusNote: s.figureCheck || '', sources: srcs.slice(0, 5),
        published: it.published || it.firstSeen, priority: it.triage.priority, basic: !!s.basic, pattern: !!s.pattern
      };
    });
}

async function maybeEdition(stories, now) {
  const analysed = stories.filter((s) => !s.basic && s.chain.length && s.status !== 'check');
  if (!AI || analysed.length < 3 || !aiAllowed(now)) return;
  const stale = now - (db.editionAt || 0) > EDITION_HOURS * 36e5;
  if (db.edition && !stale && db.analysedSinceEdition < 6) return;
  try {
    const ed = await aiCall(now, () => ai.edition(AI, analysed.slice(0, 20)));
    db.edition = ed; db.editionAt = now; db.analysedSinceEdition = 0;
    applyEdition(ed, analysed, now);
    log('[edition] written;', ed.sameEvent.length, 'duplicate groups,', ed.numbers.length, 'numbers');
  } catch (e) { log('[edition]', e.message); }
}

// Merge repeats of the same event, and take fresh key numbers from the news.
function applyEdition(ed, stories, now) {
  db.merged = db.merged || {};
  const byId = {}; stories.forEach((s) => { byId[s.id] = s; });
  (ed.sameEvent || []).forEach((g) => {
    const items = g.map((id) => db.items[id]).filter(Boolean);
    if (items.length < 2) return;
    items.sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0) || b.triage.priority - a.triage.priority || Date.parse(a.published || a.firstSeen) - Date.parse(b.published || b.firstSeen));
    const primary = db.merged[items[0].id] || items[0].id;
    items.forEach((it) => { if (it.id !== primary) db.merged[it.id] = primary; });
  });
  db.pulseNews = db.pulseNews || {};
  (ed.numbers || []).forEach((n) => {
    const s = byId[n.storyId]; if (!s) return;
    db.pulseNews[n.id] = Object.assign({}, n, { published: s.published, source: s.sources[0].name, url: s.sources[0].url, headline: s.headline, at: new Date(now).toISOString() });
  });
}

// Whether a rise in each indicator is good, bad or simply worth watching, for colouring.
const TONE_UP = { sensex: 'good', nifty: 'good', brent: 'bad', inr: 'bad', cpi: 'bad', repo: 'watch', gdp: 'good', gst: 'good', fpi: 'good', fx: 'good', fed: 'watch' };
function tone(id, dir) {
  if (dir === 'flat') return 'watch';
  const up = TONE_UP[id] || 'watch';
  if (up === 'watch') return 'watch';
  return dir === 'up' ? up : (up === 'good' ? 'bad' : 'good');
}

function pulseTiles(now) {
  const base = store.load(PULSE_FILE, null) || (seed && seed.pulse) || [];
  return base.map((t) => {
    const tileTime = Date.parse(t.date || '') || 0;
    const n = (db.pulseNews || {})[t.id];
    const newsTime = n ? Date.parse(n.published) || 0 : 0;
    const inrTime = t.id === 'inr' && liveInr ? Date.parse(liveInr.asOf) || 0 : 0;
    if (n && newsTime > tileTime && newsTime >= inrTime && now - newsTime < Math.max(10 * 864e5, MAX_AGE_HOURS * 36e5)) {
      return Object.assign({}, t, {
        value: n.value, change: n.change || 'From the news', dir: n.direction, tone: tone(t.id, n.direction),
        asOf: n.asOf || new Date(newsTime).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), status: 'press', source: n.source, url: n.url,
        note: 'Updated automatically from a news report: ' + n.headline, spark: null
      });
    }
    if (t.id === 'inr' && liveInr && inrTime > tileTime) {
      return Object.assign({}, t, { value: liveInr.value.toFixed(2), change: 'Daily reference rate', dir: 'flat', tone: 'watch', asOf: liveInr.asOf.replace(/ \+0000$/, ' UTC'), status: 'press', source: 'open.er-api.com market data', url: 'https://www.exchangerate-api.com/', note: 'Updated about once a day from market data. For the RBI reference rate, check the FBIL website.', spark: null });
    }
    return t;
  });
}

async function fetchInr() {
  try {
    const j = JSON.parse(await fetchText('https://open.er-api.com/v6/latest/USD', 10000, 'application/json'));
    if (j && j.rates && j.rates.INR) liveInr = { value: j.rates.INR, asOf: j.time_last_update_utc || '' };
  } catch (e) { /* keep the configured value */ }
}

async function refresh() {
  if (refreshing) return; refreshing = true;
  const now = Date.now();
  try {
    const added = await fetchAll(now);
    await triageNew(now);
    const analysed = await analyseKept(now);
    await maybeEdition(storyList(now), now);
    if (!MOCK) await fetchInr();
    prune(now);
    store.save(DATA_FILE, db);
    lastRefresh = new Date().toISOString();
    log('[refresh]', added.length, 'new,', analysed, 'analysed,', Object.keys(db.items).length, 'stored');
    broadcast();
  } catch (e) { log('[refresh] failed:', e.message); }
  finally { refreshing = false; }
}

function prune(now) {
  for (const [id, it] of Object.entries(db.items)) if (ageH(it, now) > MAX_AGE_HOURS * 2) delete db.items[id];
}

// ---------- What the page receives ----------
function desk(order) {
  const now = Date.now();
  const stories = storyList(now, order);
  const pulse = pulseTiles(now);
  const extras = store.load(EXTRAS_FILE, {});
  const watch = (store.load(WATCH_FILE, null) || (seed && seed.watch) || []);
  const ed = db.edition;
  const enough = stories.length >= 3;
  const base = !enough && seed ? seed : null;
  const label = new Date(now).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  return {
    mode: 'live', updatedAt: lastRefresh, editionLabel: label + ' IST',
    notice: !AI ? 'No AI key is set. Stories show the outlet\'s own headline and opening lines, with the general pattern for that kind of news. Add a free GEMINI_API_KEY for story-by-story linkages and classroom lines.' : (base ? 'Collecting today\'s stories. Showing the researched edition of ' + (seed.editionLabel || 'the seed date') + ' until there are enough.' : (now < (db.ai.pausedUntil || 0) ? 'The free AI limit was reached, so new stories show general patterns for now. Analysis resumes automatically.' : '')),
    aiStatus: aiStatus(),
    pulse,
    thread: ed ? Object.assign({}, ed.thread, { sources: (ed.thread.storyIds || []).map((id) => stories.find((s) => s.id === id)).filter(Boolean).map((s) => s.sources[0]) }) : base ? base.thread : null,
    stories: enough ? stories : (base ? base.stories : stories),
    concept: ed && ed.concept ? ed.concept : base ? base.concept : null,
    rateCycle: extras.rateCycle || (seed && seed.rateCycle) || null,
    rupeeSides: ed && ed.sides ? ed.sides : (extras.rupeeSides || (seed && seed.rupeeSides) || null),
    watch,
    quiz: ed && ed.quiz && ed.quiz.length ? ed.quiz : base ? base.quiz : [],
    sources: Object.values(sourceStatus)
  };
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.css': 'text/css; charset=utf-8' };
function send(res, code, type, body, extra) { res.writeHead(code, Object.assign({ 'content-type': type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' }, extra || {})); res.end(body); }
function broadcast() { for (const c of clients) c.write('event: update\ndata: ' + Date.now() + '\n\n'); }

function authorised(req, url, res) {
  if (!ACCESS_KEY) return true;
  const cookie = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith('edk='));
  if (cookie && decodeURIComponent(cookie.slice(4)) === ACCESS_KEY) return true;
  if (url.searchParams.get('key') === ACCESS_KEY) {
    send(res, 302, 'text/plain', 'OK', { location: '/', 'set-cookie': 'edk=' + encodeURIComponent(ACCESS_KEY) + '; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax; Secure' });
    return false;
  }
  send(res, 401, 'text/html; charset=utf-8', '<!doctype html><meta name=viewport content="width=device-width"><p style="font:16px system-ui;padding:24px">This dashboard is private. Open it with the link that includes your key, for example <code>/?key=…</code></p>');
  return false;
}

function aiStatus() {
  if (!AI) return 'AI: off';
  const name = PROVIDER === 'gemini' ? 'Gemini (free tier)' : PROVIDER === 'claude' ? 'Claude' : 'demo';
  return 'AI: ' + name + ' · ' + (db.ai.date === new Date().toISOString().slice(0, 10) ? db.ai.calls : 0) + ' of ' + AI_CALLS_PER_DAY + ' requests used today' + (db.ai.lastError ? ' · last error: ' + db.ai.lastError.slice(0, 120) : '');
}

function page() {
  const body = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace('/*SNAPSHOT*/null', () => JSON.stringify(desk()).replace(/</g, '\\u003c'));
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#16222b"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Economy Desk"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="icon" href="/icon-192.png">' +
    '</head><body>' + body + '<script>if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(function(){});</script></body></html>';
}

function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/health') return send(res, 200, MIME['.json'], JSON.stringify({ ok: true, ai: aiStatus(), model: AI ? MODEL : null, lastRefresh, items: Object.keys(db.items).length, sources: Object.values(sourceStatus) }));
  if (!authorised(req, url, res)) return;
  if (url.pathname === '/api/desk') return send(res, 200, MIME['.json'], JSON.stringify(desk(url.searchParams.get('order') === 'latest' ? 'latest' : 'top')));
  if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write('retry: 10000\n\n'); clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, MIME['.html'], page());
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch (e) { return send(res, 400, 'text/plain', 'Bad request'); }
  const f = path.normalize(path.join(PUBLIC, rel));
  if (!f.startsWith(PUBLIC + path.sep)) return send(res, 403, 'text/plain', 'Forbidden');
  fs.readFile(f, (err, data) => err ? send(res, 404, 'text/plain', 'Not found') : send(res, 200, MIME[path.extname(f)] || 'application/octet-stream', data));
}

function start() {
  const server = http.createServer(handler);
  server.listen(PORT, () => {
    log('Economy Desk on http://localhost:' + PORT);
    log('AI:', PROVIDER === 'none' ? 'off (set GEMINI_API_KEY for free analysis)' : PROVIDER + ' ' + (MOCK ? '' : MODEL), '· up to', AI_CALLS_PER_DAY, 'requests a day · sources:', sources.length, '· feeds every', POLL_MINUTES, 'min');
  });
  refresh();
  setInterval(refresh, POLL_MINUTES * 60000);
  return server;
}

if (require.main === module) start();
module.exports = { start, refresh, desk, similar, handler };
