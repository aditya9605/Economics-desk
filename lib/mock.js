'use strict';
// A stand-in for Claude, used by `npm run demo` and the tests. It never calls the network.
const rules = require('./rules');

function words(s, n) { const w = String(s || '').split(/\s+/).filter(Boolean); return w.slice(0, n).join(' '); }

module.exports = function mock(prompt) {
  if (prompt.startsWith('Below are news headlines')) {
    const list = JSON.parse(prompt.slice(prompt.lastIndexOf('\n[') + 1));
    return list.map((x) => Object.assign({ i: x.i }, rules.score(x.headline, x.snippet, /National|World|International|India/.test(x.source) ? 'general' : 'econ') || { keep: false }));
  }
  if (prompt.startsWith('Turn each of these news items')) {
    const list = JSON.parse(prompt.slice(prompt.lastIndexOf('\n[') + 1));
    return { cards: list.map((x) => Object.assign({ i: x.i }, module.exports('Turn this news item\nHeadline: ' + x.headline + '\nText: ' + x.text))) };
  }
  if (prompt.startsWith('Turn this news item')) {
    const head = (prompt.match(/\nHeadline: (.*)/) || [])[1] || 'Story';
    if (/Protest at Jantar Mantar/.test(head)) return { relevant: false, reason: 'No direct economic effect' };
    const text = (prompt.match(/\nText: ([\s\S]*)$/) || [])[1] || head;
    const summary = words(text, 60);
    const fig = (summary.match(/[₹$]?\d[\d,.]*\s?(?:%|per cent|crore|lakh crore|bps|billion)?/) || [])[0];
    return {
      headline: words(head, 14), summary, marks: fig ? [fig.trim()] : [],
      chain: [{ kind: 'event', label: words(head, 6) }, { kind: 'channel', label: 'Prices and expectations', added: true }, { kind: 'outcome', label: 'Effect on India\'s economy', added: true }],
      impacts: { inflation: /oil|crude|price/i.test(text) ? 1 : 0, growth: 0, rupee: /rupee|fpi|dollar/i.test(text) ? -1 : 0, fiscal: /gst|tax/i.test(text) ? 1 : 0, markets: /sensex|nifty/i.test(text) ? 1 : 0, trade: /tariff|export/i.test(text) ? -1 : 0 },
      relevant: true,
      keyFigure: fig ? { value: fig.trim(), label: 'Key figure' } : null,
      context: 'Demo background: with an AI key, this line explains the background.',
      eureka: 'Demo text: with an AI key, this box explains the surprising economic link for your class.',
      concept: 'Demo concept', syllabus: 'GS3 · Economy', category: 'Economy'
    };
  }
  if (prompt.startsWith('From today')) {
    const cards = JSON.parse(prompt.slice(prompt.lastIndexOf('\n[') + 1));
    const top = cards[0] || { id: 'x', headline: 'No stories yet', chain: ['Event', 'Channel', 'Outcome'] };
    return {
      thread: { title: top.headline, dek: 'Demo thread built from the top story.', nodes: top.chain.map((l, i) => ({ kind: ['event', 'channel', 'variable', 'outcome'][Math.min(i, 3)], label: l, note: '', added: i > 0 })), classLine: 'Demo question for the class.', storyIds: [top.id] },
      concept: { term: 'Demo concept', explain: 'Shown in demo mode.', today: 'With a Claude key this explains today\'s concept.', corners: [] },
      sides: { title: 'Demo: who gains, who loses', losers: ['Importers'], winners: ['Exporters'] },
      quiz: [{ q: 'Demo question?', options: ['A', 'B', 'C', 'D'], answer: 0, why: 'Demo answer.' }],
      sameEvent: [],
      numbers: cards.filter((c) => /2\.04 lakh crore/.test(c.summary)).slice(0, 1).map((c) => ({ id: 'gst', value: '2.04', change: '+14.7% from a year ago', direction: 'up', asOf: 'September', storyId: c.id }))
    };
  }
  throw new Error('Unknown prompt');
};
