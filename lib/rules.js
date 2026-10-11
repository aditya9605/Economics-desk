'use strict';
// Keyword rules: the first, free filter. They keep English stories that are plausibly about the economy
// and drop obvious noise before any AI request is spent. The AI then makes the final call on relevance.

const ECON = [
  [/\b(repo rate|monetary policy|mpc|rbi|reserve bank|interest rates?)\b/i, 5, 'Interest rates'],
  [/\b(inflation|cpi|wpi|price rise|food prices)\b/i, 4, 'Prices'],
  [/\b(gdp|growth rate|iip|pmi|core sector|industrial output|economic growth|recession)\b/i, 4, 'Growth'],
  [/\b(union budget|fiscal deficit|gst|direct tax|income tax|tax collections?|cess|government borrowing|disinvestment|finance ministry|ministry of finance|ministry of commerce|department of economic affairs|economic review|economic survey|sitharaman)\b/i, 4, 'Taxes and spending'],
  [/\b(exports?|imports?|trade deficit|tariffs?|customs duty|import duty|fta|trade deal|trade agreement|wto|commerce ministry)\b/i, 4, 'Trade'],
  [/\b(rupee|forex|foreign exchange|fpis?|fiis?|fdi|current account|remittances?)\b/i, 4, 'Rupee and capital flows'],
  [/\b(sensex|nifty|stock markets?|sebi|ipo|bond yields?|g-secs?)\b/i, 3, 'Markets'],
  [/\b(crude|oil prices?|brent|opec|lng|petrol|diesel|fuel prices?|power tariff)\b/i, 4, 'Energy'],
  [/\b(banks?|banking|nbfcs?|npas?|bad loans|credit growth|upi|digital payments?)\b/i, 3, 'Banking'],
  [/\b(jobs|unemployment|plfs|wages|labour codes?|layoffs|hiring)\b/i, 3, 'Jobs'],
  [/\b(msp|kharif|rabi|monsoon|foodgrains?|fertili[sz]ers?|farmers?|crop)\b/i, 3, 'Farming'],
  [/\b(pli|capex|infrastructure|semiconductors?|manufacturing|msmes?)\b/i, 2, 'Industry'],
  [/\b(federal reserve|the fed|ecb|imf|world bank|global economy)\b/i, 4, 'World economy']
];
const SPILL = [
  [/\b(war|missile|airstrikes?|ceasefire|hormuz|red sea|houthis?|iran|israel|ukraine|sanctions?)\b/i, 4, 'War and oil'],
  [/\b(protests?|agitation|bandh|blockade|strike by|unrest|truckers'? strike)\b/i, 3, 'Protests'],
  [/\b(elections? results?|exit polls?|coalition|government falls)\b/i, 2, 'Politics'],
  [/\b(supreme court|high court)\b.*\b(tax|bank|company|companies|telecom|mining|tariff|gst|land|power)\b/i, 3, 'Courts'],
  [/\b(heatwave|floods?|cyclone|drought|el ni[nñ]o|la ni[nñ]a|crop damage|unseasonal rain)\b/i, 3, 'Weather'],
  [/\b(pandemic|outbreak)\b/i, 3, 'Health'],
  [/\b(trump|white house|sanctions?|china|chinese)\b.*\b(trade|tariffs?|exports?|imports?|rupee|oil|chips?|rare earths?)\b/i, 3, 'Geopolitics']
];

// Items that are never economy news worth teaching from.
const NOISE = new RegExp([
  'cricket', 'ipl', 'bollywood', 'box office', 'actor', 'actress', 'horoscope', 'recipe', 'fashion', 'celebrity', 'wedding', 'trailer', 'web series', 'quiz',
  'investing tips', 'investment tips', 'stocks? to buy', 'stock picks?', 'buy or sell', 'target price', 'multibagger', 'should you (buy|invest|sell)',
  'personal finance', 'tax[- ]saving tips', 'how to (save|invest|file)', 'best mutual funds?',
  'pays? tributes?', 'pays? homage', 'tributes? to', 'jayanti', 'birth anniversary', 'death anniversary', 'greets', 'condoles', 'condolences',
  'navratri', 'diwali greetings', 'festival greetings', 'yoga day', 'swachh', 'magnitude earthquake'
].map((w) => '\\b' + w + '\\b').join('|'), 'i');

// True when a headline is mostly in a non-Latin script (for example Hindi), so it can be skipped.
function isEnglish(s) {
  const letters = String(s || '').match(/\p{L}/gu) || [];
  if (!letters.length) return false;
  const latin = letters.filter((c) => /[A-Za-z]/.test(c)).length;
  return latin / letters.length >= 0.8;
}

function score(title, text, kind) {
  if (!isEnglish(title) || NOISE.test(title)) return null;
  const body = String(text || '').slice(0, 400);
  // A match in the headline counts fully. A match only in the text counts if it is a strong economic term.
  let best = null, pts = 0;
  for (const [re, p, cat] of ECON) {
    const inTitle = re.test(title), inBody = !inTitle && p >= 4 && re.test(body);
    if (inTitle || inBody) { pts += inTitle ? p : p / 2; if (!best || p > best.p) best = { p, cat }; }
  }
  let s = null, sp = 0;
  for (const [re, p, cat] of SPILL) if (re.test(title)) { sp += p; if (!s || p > s.p) s = { p, cat }; }
  // A non-economic event (war, protest, weather...) is a "ripple effect" story, whether or not the headline
  // already names the economic effect.
  if (best && pts >= 3) return { keep: true, priority: Math.min(5, Math.max(1, Math.round(pts / 2))), spillover: !!(s && sp >= 3), category: s && sp >= 3 ? s.cat : best.cat };
  if (s && sp >= 3) return { keep: true, priority: Math.min(4, Math.round(sp / 2)), spillover: true, category: s.cat };
  return { keep: false };
}

module.exports = { score, NOISE, isEnglish };
