'use strict';
// Keyword rules. Used to sort stories when no Claude key is set, and to stop obvious noise early.

const ECON = [
  [/\b(repo|monetary policy|mpc|rbi|reserve bank)\b/i, 5, 'Monetary policy'],
  [/\b(inflation|cpi|wpi|price rise)\b/i, 4, 'Inflation'],
  [/\b(gdp|growth rate|iip|pmi|core sector|output)\b/i, 4, 'Growth'],
  [/\b(budget|fiscal deficit|gst|tax|cess|borrowing|disinvestment|finance ministry|nirmala|sitharaman)\b/i, 4, 'Fiscal'],
  [/\b(export|import|trade deficit|tariff|duty|fta|trade deal|wto|commerce ministry)\b/i, 4, 'Trade'],
  [/\b(rupee|forex|dollar|fpi|fii|fdi|current account|remittance)\b/i, 4, 'External sector'],
  [/\b(sensex|nifty|stock market|shares|sebi|ipo|bond yield|g-sec)\b/i, 3, 'Markets'],
  [/\b(crude|oil price|brent|opec|lng|coal|power tariff|fuel price)\b/i, 4, 'Energy'],
  [/\b(bank|nbfc|npa|credit growth|loan|upi|fintech)\b/i, 3, 'Banking'],
  [/\b(jobs|unemployment|plfs|wages|labour code)\b/i, 3, 'Labour'],
  [/\b(msp|kharif|rabi|monsoon|food grain|fertiliser|farm)\b/i, 3, 'Agriculture'],
  [/\b(scheme|pli|capex|infrastructure|railway|highway|semiconductor)\b/i, 2, 'Policy'],
  [/\b(fed|federal reserve|ecb|imf|world bank|recession)\b/i, 4, 'Global']
];
const SPILL = [
  [/\b(war|strike|missile|ceasefire|hormuz|red sea|houthi|iran|israel|ukraine|russia sanctions)\b/i, 4, 'Geopolitics'],
  [/\b(protest|agitation|bandh|blockade|strike by|unrest|riot)\b/i, 3, 'Polity'],
  [/\b(election|poll result|coalition|government falls)\b/i, 2, 'Polity'],
  [/\b(supreme court|high court|verdict|ruling)\b/i, 2, 'Judiciary'],
  [/\b(heatwave|flood|cyclone|drought|el nino|la nina|earthquake|landslide)\b/i, 3, 'Climate'],
  [/\b(pandemic|outbreak|virus)\b/i, 3, 'Health'],
  [/\b(trump|white house|tariff|sanction|china|pakistan|bangladesh)\b/i, 2, 'Geopolitics'],
  [/\b(cyber ?attack|outage|ai model|chip export)\b/i, 2, 'Technology']
];
const NOISE = /\b(cricket|ipl|bollywood|box office|actor|actress|horoscope|recipe|fashion|celebrity|wedding|trailer|web series|quiz:)\b/i;

function score(title, text, kind) {
  const hay = title + ' ' + (text || '').slice(0, 400);
  if (NOISE.test(title)) return null;
  let best = null, pts = 0;
  for (const [re, p, cat] of ECON) if (re.test(hay)) { pts += p; if (!best || p > best.p) best = { p, cat }; }
  if (best) return { keep: true, priority: Math.min(5, Math.max(1, Math.round(pts / 2))), spillover: false, category: best.cat };
  if (kind === 'general') {
    let s = null, sp = 0;
    for (const [re, p, cat] of SPILL) if (re.test(hay)) { sp += p; if (!s || p > s.p) s = { p, cat }; }
    if (s && sp >= 3) return { keep: true, priority: Math.min(4, Math.round(sp / 2)), spillover: true, category: s.cat };
    return { keep: false };
  }
  return { keep: kind === 'econ', priority: 1, spillover: false, category: 'Economy' };
}

module.exports = { score, NOISE };
