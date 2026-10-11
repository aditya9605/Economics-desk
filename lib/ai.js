'use strict';
// Calls to an AI model (Google Gemini on its free tier, or Claude): triage headlines, analyse stories into
// linkage cards, and write the day's front page. Every reply is checked before use.
// Figures that do not appear in the source text are flagged.

const KINDS = ['event', 'channel', 'variable', 'outcome'];
const IMPACT_KEYS = ['inflation', 'growth', 'rupee', 'fiscal', 'markets', 'trade'];

const SYSTEM = [
  'You are the research desk for an Indian economics educator who teaches UPSC aspirants.',
  'Write in simple, direct English for a smart reader who is not an economist: short sentences and everyday words.',
  'Avoid jargon such as hawkish, dovish, risk premium, headwinds or tailwinds. Say what actually happens instead (for example "raises rates to fight rising prices"). If a technical term is needed, explain it in a few words.',
  'Rephrase in your own words; never copy sentences from the source.',
  'Use only facts stated in the source text you are given. Never add figures, dates or names that are not in it.',
  'When you reason beyond the source (a likely effect, a transmission channel), mark that step as added.',
  'Reply with JSON only, no prose before or after it.'
].join(' ');

async function call(opts, prompt, maxTokens) {
  if (opts.mock) return opts.mock(prompt);
  if (opts.provider === 'gemini') return callGemini(opts, prompt, maxTokens);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: opts.model, max_tokens: maxTokens || 1500, system: SYSTEM, messages: [{ role: 'user', content: prompt }] })
  });
  if (!res.ok) throw await httpError('Claude', res);
  const data = await res.json();
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  return extractJson(text);
}

async function callGemini(opts, prompt, maxTokens) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(opts.model) + ':generateContent';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: Math.max(2048, (maxTokens || 1500) * 2), temperature: 0.4 }
    })
  });
  if (!res.ok) throw await httpError('Gemini', res);
  const data = await res.json();
  const cand = (data.candidates || [])[0];
  const text = cand && cand.content && (cand.content.parts || []).map((p) => p.text || '').join('');
  if (!text) throw new Error('Gemini returned no text' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : ''));
  return extractJson(text);
}

async function httpError(name, res) {
  let detail = '';
  try { const j = await res.json(); detail = (j.error && (j.error.message || j.error.status)) || ''; } catch (e) {}
  const err = new Error(name + ' API HTTP ' + res.status + (detail ? ': ' + String(detail).slice(0, 200) : ''));
  err.status = res.status;
  err.rateLimited = res.status === 429;
  return err;
}

function extractJson(text) {
  const s = String(text || '');
  const a = Math.min(...['{', '['].map((c) => { const i = s.indexOf(c); return i < 0 ? Infinity : i; }));
  const b = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
  if (!isFinite(a) || b < a) throw new Error('No JSON in reply');
  return JSON.parse(s.slice(a, b + 1));
}

// Trims to a length without cutting a word in half.
function str(v, max) {
  if (typeof v !== 'string') return '';
  const s = v.replace(/\s+/g, ' ').trim(), m = max || 400;
  if (s.length <= m) return s;
  const cut = s.slice(0, m - 1), sp = cut.lastIndexOf(' ');
  return (sp > m * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-–]+$/, '') + '…';
}

// ---------- Triage ----------
function triagePrompt(batch) {
  return [
    'Below are news headlines with short snippets. For each, decide whether it belongs on an Indian economics dashboard.',
    'Keep (a) economic news that matters for India: policy, data, markets, trade, fiscal, banking, energy, labour, agriculture, global economy; and',
    '(b) non-economic news (politics, protests, war, diplomacy, courts, climate, health, technology) that has a plausible, explainable effect on India\'s economy. Mark these spillover=true.',
    'Drop routine items (auction notices, stock tips, company PR, celebrity, sport) and anything with no economic angle.',
    'priority: 5 = would change how a teacher explains the economy this week; 1 = minor.',
    'category: a short label such as "Monetary policy", "Fiscal", "Trade", "Markets", "Energy", "Geopolitics", "Polity", "Climate", "Global".',
    'Reply as JSON: [{"i": 0, "keep": true, "priority": 4, "spillover": false, "category": "Fiscal"}, ...] with one entry per headline.',
    '',
    JSON.stringify(batch.map((b, i) => ({ i, source: b.sourceName, headline: b.title, snippet: (b.text || '').slice(0, 220) })))
  ].join('\n');
}
function validateTriage(reply, n) {
  const out = new Array(n).fill(null);
  (Array.isArray(reply) ? reply : []).forEach((r) => {
    if (!r || typeof r.i !== 'number' || r.i < 0 || r.i >= n) return;
    out[r.i] = { keep: !!r.keep, priority: Math.max(1, Math.min(5, Math.round(+r.priority || 1))), spillover: !!r.spillover, category: str(r.category, 40) || 'Economy' };
  });
  return out;
}
async function triage(opts, batch) {
  return validateTriage(await call(opts, triagePrompt(batch), 2500), batch.length);
}

// ---------- Analysis ----------
function analysePrompt(item) {
  return [
    'Turn this news item into a card for the dashboard.',
    'Fields:',
    '- headline: a plain, direct sentence of at most 16 words that says what happened and why it matters. No wordplay.',
    '- summary: 45 to 80 words in your own words, with the key figures from the source. Explain any technical term in passing.',
    '- context: 1 or 2 sentences of background so a newcomer understands the story: what the institution or term is, or what happened before. Use only well-established general knowledge or facts from the source.',
    '- marks: 2 to 6 exact substrings of YOUR summary to bold (figures, dates, names of schemes or bodies, the decision).',
    '- chain: 3 to 5 steps showing how the news travels into India\'s economy, in plain words. Each step {"kind": "event" (what happened) | "channel" (how it spreads) | "variable" (what it hits) | "outcome" (result), "label": at most 10 words, "added": true if the step is your inference rather than stated in the source}.',
    '- impacts: likely direction for India of inflation, growth, rupee (1 = rupee stronger), fiscal (1 = fiscal position better), markets, trade (1 = trade balance better). Use 1, -1 or 0. Use 0 when unclear.',
    '- eureka: one or two simple sentences a teacher can say in class that reveal a surprising economic link. This is your analysis.',
    '- concept: the economics idea this illustrates, in plain words, at most 8 words.',
    '- syllabus: UPSC paper and topic, for example "GS3 · External sector".',
    '- category: a short plain label such as "Interest rates", "Taxes", "Trade", "Markets", "War and oil", "Protests and markets", "Weather and farms".',
    'Reply as one JSON object with exactly these fields.',
    '',
    'Source: ' + item.sourceName,
    'Headline: ' + item.title,
    'Text: ' + (item.text || '(headline only)').slice(0, 3500)
  ].join('\n');
}

function numbersIn(s) {
  return (String(s).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => n.replace(/,/g, '')).filter((n) => n.length > 1 || +n > 9);
}
// Returns the figures in `out` that cannot be found in `source`.
function unmatchedFigures(out, source) {
  const src = new Set(numbersIn(source));
  const srcFlat = String(source).replace(/,/g, '');
  return numbersIn(out).filter((n) => !src.has(n) && srcFlat.indexOf(n) < 0);
}

function validateStory(r, item) {
  if (!r || typeof r !== 'object') throw new Error('Not an object');
  const headline = str(r.headline, 140), summary = str(r.summary, 700);
  if (!headline || !summary) throw new Error('Missing headline or summary');
  const chain = (Array.isArray(r.chain) ? r.chain : []).map((n) => ({ kind: KINDS.includes(n && n.kind) ? n.kind : 'variable', label: str(n && n.label, 80), added: !!(n && n.added) }))
    .filter((n) => n.label).slice(0, 6);
  const impacts = {};
  IMPACT_KEYS.forEach((k) => { const v = Math.round(+((r.impacts || {})[k]) || 0); impacts[k] = v > 0 ? 1 : v < 0 ? -1 : 0; });
  const marks = (Array.isArray(r.marks) ? r.marks : []).map((m) => str(m, 80)).filter((m) => m && summary.includes(m)).slice(0, 6);
  const source = item.title + ' ' + (item.text || '');
  const missing = unmatchedFigures(headline + ' ' + summary, source);
  return {
    headline, summary, marks, chain, impacts,
    context: str(r.context, 500), eureka: str(r.eureka, 500), concept: str(r.concept, 80), syllabus: str(r.syllabus, 60), category: str(r.category, 40) || 'Economy',
    figureCheck: missing.length ? 'Figures not found in the source text: ' + missing.slice(0, 4).join(', ') + '. Check before use.' : ''
  };
}
async function analyse(opts, item) {
  return validateStory(await call(opts, analysePrompt(item), 1400), item);
}

// Several stories in one request, which keeps within free-tier request limits.
function batchPrompt(items) {
  const one = analysePrompt({ sourceName: '', title: '', text: '' });
  const rules = one.slice(one.indexOf('Fields:'), one.indexOf('Reply as one JSON object'));
  return [
    'Turn each of these news items into a card for the dashboard.',
    rules,
    'Reply as JSON: {"cards": [{"i": <item number>, ...the fields above}]}, one card per item, in any order.',
    '',
    JSON.stringify(items.map((it, i) => ({ i, source: it.sourceName, headline: it.title, text: (it.text || '(headline only)').slice(0, 1800) })))
  ].join('\n');
}
async function analyseBatch(opts, items) {
  const reply = await call(opts, batchPrompt(items), 900 * items.length + 400);
  const cards = Array.isArray(reply) ? reply : (reply && Array.isArray(reply.cards) ? reply.cards : []);
  const out = new Array(items.length).fill(null);
  cards.forEach((c) => {
    if (!c || typeof c.i !== 'number' || c.i < 0 || c.i >= items.length || out[c.i]) return;
    try { out[c.i] = validateStory(c, items[c.i]); } catch (e) { /* leave this one for later */ }
  });
  return out;
}

// ---------- Edition ----------
function editionPrompt(stories) {
  return [
    'From today\'s cards below, write the dashboard\'s front page. Use only facts that appear in the cards.',
    'Fields:',
    '- thread: the single most surprising chain of the day linking non-economic news to the economy. {"title": one or two plain, direct sentences saying what happened and what it led to, "dek": one sentence of context, "nodes": 4 or 5 steps like the cards\' chains (kind, label, note of at most 10 words, added), "classLine": a question to ask the class with its answer (do not start with \"Ask the class\"), "storyIds": ids of the cards used}.',
    '- concept: {"term", "explain": two sentences, "today": how today\'s news illustrates it, "corners": exactly 3 short labels only if the concept is a trilemma, otherwise []}.',
    '- sides: the day\'s biggest price or policy move and who it hurts and helps. {"title", "losers": 3 or 4 short items, "winners": 3 or 4 short items}.',
    '- quiz: 3 multiple-choice questions on today\'s news for UPSC aspirants. [{"q", "options": 4 strings, "answer": index 0-3, "why": one or two sentences}].',
    '- sameEvent: groups of card ids that report the same event or decision, so they can be merged. [["id1","id2"], ...]. Only group cards that are clearly about the same event.',
    '- numbers: the latest values of these indicators, ONLY where a card states the figure explicitly: ' + NUMBER_IDS.join(', ') + '. [{"id", "value": the figure exactly as written in the card, digits only with commas or decimals, "change": a short plain phrase from the card such as "+879 points on 9 Oct", "direction": "up"|"down"|"flat", "asOf": the date the card gives for the figure, "storyId"}]. Leave an indicator out if no card states it.',
    'Reply as one JSON object with fields thread, concept, sides, quiz, sameEvent, numbers.',
    '',
    JSON.stringify(stories.map((s) => ({ id: s.id, published: s.published, category: s.category, headline: s.headline, summary: s.summary, chain: s.chain.map((c) => c.label), eureka: s.eureka })))
  ].join('\n');
}
const NUMBER_IDS = ['sensex', 'nifty', 'brent', 'inr', 'cpi', 'repo', 'gdp', 'gst', 'fpi', 'fx', 'fed'];

// A reported number is accepted only if its digits appear in the summary of the card it cites.
function validateNumbers(list, stories) {
  const byId = {}; stories.forEach((s) => { byId[s.id] = s; });
  const seen = {};
  return (Array.isArray(list) ? list : []).filter((n) => {
    if (!n || !NUMBER_IDS.includes(n.id) || seen[n.id] || !byId[n.storyId]) return false;
    const v = String(n.value || '').replace(/[^\d.,\-−–]/g, '');
    const digits = v.replace(/[^\d.]/g, '');
    if (!digits || !/\d/.test(digits)) return false;
    const hay = String(byId[n.storyId].summary).replace(/,/g, '');
    if (hay.indexOf(digits) < 0) return false;
    seen[n.id] = true; return true;
  }).map((n) => ({ id: n.id, value: String(n.value).replace(/[^\d.,\-−–]/g, '').replace(/^-/, '−'), change: str(n.change, 60), direction: ['up', 'down', 'flat'].includes(n.direction) ? n.direction : 'flat', asOf: str(n.asOf, 40), storyId: n.storyId }));
}

function validateEdition(r, ids, stories) {
  if (!r || !r.thread) throw new Error('No thread');
  const t = r.thread;
  const nodes = (Array.isArray(t.nodes) ? t.nodes : []).map((n) => ({ kind: KINDS.includes(n && n.kind) ? n.kind : 'variable', label: str(n && n.label, 90), note: str(n && n.note, 90), added: !!(n && n.added) })).filter((n) => n.label).slice(0, 5);
  if (nodes.length < 3) throw new Error('Thread too short');
  const quiz = (Array.isArray(r.quiz) ? r.quiz : []).filter((q) => q && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length)
    .map((q) => ({ q: str(q.q, 300), options: q.options.slice(0, 5).map((o) => str(o, 160)), answer: q.answer, why: str(q.why, 400) })).slice(0, 3);
  const c = r.concept || {};
  const corners = Array.isArray(c.corners) && c.corners.length === 3 ? c.corners.map((x) => str(x, 30)) : [];
  const sd = r.sides || {};
  const list = (a) => (Array.isArray(a) ? a.map((x) => str(x, 90)).filter(Boolean).slice(0, 4) : []);
  return {
    thread: { title: str(t.title, 220), dek: str(t.dek, 260), nodes, classLine: str(t.classLine, 360), storyIds: (Array.isArray(t.storyIds) ? t.storyIds : []).filter((x) => ids.includes(x)) },
    concept: c.term ? { term: str(c.term, 80), explain: str(c.explain, 400), today: str(c.today, 500), corners } : null,
    sides: sd.title && list(sd.losers).length && list(sd.winners).length ? { title: str(sd.title, 80), losers: list(sd.losers), winners: list(sd.winners) } : null,
    quiz,
    sameEvent: (Array.isArray(r.sameEvent) ? r.sameEvent : []).map((g) => (Array.isArray(g) ? Array.from(new Set(g.filter((x) => ids.includes(x)))) : [])).filter((g) => g.length > 1),
    numbers: validateNumbers(r.numbers, stories || [])
  };
}
async function edition(opts, stories) {
  return validateEdition(await call(opts, editionPrompt(stories), 3500), stories.map((s) => s.id), stories);
}

module.exports = { NUMBER_IDS, validateNumbers, str, call, triage, analyse, analyseBatch, batchPrompt, edition, validateStory, validateTriage, validateEdition, unmatchedFigures, extractJson, triagePrompt, analysePrompt, editionPrompt };
