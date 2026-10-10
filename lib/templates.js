'use strict';
// Free, no-AI linkages. When a story has not been analysed by an AI model, the dashboard still shows
// the general chain of effects for that kind of news, clearly labelled as a general pattern.
// Order matters: the first matching template wins.

const T = [
  { re: /\b(repo rate|monetary policy|mpc|policy rate|rate (hike|cut))\b/i, category: 'Interest rates',
    context: 'The repo rate is the rate at which the RBI lends money to banks. Banks usually move their loan and deposit rates in the same direction.',
    concept: 'How interest rates control inflation',
    chain: ['RBI changes its key rate', 'Banks change loan and deposit rates', 'Borrowing and spending change', 'Prices and growth respond'],
    impacts: { inflation: -1, growth: -1, rupee: 1, markets: -1 } },
  { re: /\b(fed|federal reserve|us interest rate|treasury yield)\b/i, category: 'World economy',
    context: 'The US Federal Reserve sets interest rates for the world\'s biggest economy. Its moves shift the dollar and global investment flows.',
    concept: 'Why US interest rates move the rupee',
    chain: ['US interest rates change', 'Dollar and US returns change', 'Foreign money moves in or out of India', 'Rupee and share prices react'],
    impacts: { rupee: -1, markets: -1 } },
  { re: /\b(crude|brent|oil price|opec|hormuz|petrol|diesel)\b/i, category: 'War and oil',
    context: 'India buys more than 85% of its crude oil from abroad, so world oil prices feed straight into its import bill and prices at home.',
    concept: 'Supply shock: when costs push prices up',
    chain: ['Oil prices change', 'India\'s import bill changes', 'Rupee and transport costs move', 'Inflation and RBI decisions follow'],
    impacts: { inflation: 1, rupee: -1, trade: -1, fiscal: -1 } },
  { re: /\b(war|missile|airstrike|ceasefire|attack on|conflict|iran|israel|ukraine|red sea|houthi)\b/i, category: 'War and oil',
    context: 'Wars in oil-producing regions or along shipping routes raise the cost of oil and freight for importers like India.',
    concept: 'Geopolitical risk and prices',
    chain: ['Conflict abroad', 'Oil and shipping costs change', 'India\'s import bill and rupee', 'Prices at home'],
    impacts: { inflation: 1, rupee: -1, markets: -1, trade: -1 } },
  { re: /\b(tariff|import duty|trade deal|fta|trade agreement|anti-dumping|export ban)\b/i, category: 'Trade',
    context: 'A tariff is a tax on imports. It makes goods from one country costlier in another, so buyers may switch suppliers.',
    concept: 'How tariffs shift trade',
    chain: ['Tariff or trade deal announced', 'Prices of traded goods change', 'Exports and imports shift', 'Jobs in exporting industries'],
    impacts: { trade: -1, growth: -1 } },
  { re: /\b(exports?|imports?|trade deficit|current account)\b/i, category: 'Trade',
    context: 'The trade deficit is how much more India buys from abroad than it sells. A wider gap needs more dollars and can weaken the rupee.',
    concept: 'Trade balance and the rupee',
    chain: ['Exports or imports change', 'Demand for dollars changes', 'Rupee moves', 'Import prices and inflation'],
    impacts: { trade: -1, rupee: -1 } },
  { re: /\b(rupee|forex|foreign exchange reserves|dollar index)\b/i, category: 'Rupee',
    context: 'The rupee\'s value against the dollar decides how much India pays for imports and earns from exports. The RBI uses its dollar reserves to smooth sharp swings.',
    concept: 'Weak rupee: winners and losers',
    chain: ['Rupee moves against the dollar', 'Import costs and export earnings change', 'Importers and exporters affected in opposite ways', 'Inflation and company profits'],
    impacts: { rupee: -1, inflation: 1 } },
  { re: /\b(fpi|fii|foreign (portfolio )?investors?|fdi)\b/i, category: 'Markets',
    context: 'Foreign investors buy and sell Indian shares and bonds. Large selling pushes share prices down and weakens the rupee.',
    concept: 'Capital flows and markets',
    chain: ['Foreign investors buy or sell', 'Share prices move', 'Demand for rupees changes', 'Rupee moves'],
    impacts: { markets: -1, rupee: -1 } },
  { re: /\b(gst|tax collection|direct tax|income tax|cess|fiscal deficit|budget|borrowing|disinvestment)\b/i, category: 'Taxes and spending',
    context: 'The government\'s tax collection and spending decide its fiscal deficit, the gap it fills by borrowing. More borrowing can push up interest rates.',
    concept: 'Fiscal deficit and borrowing',
    chain: ['Tax or spending changes', 'Government\'s deficit changes', 'Government borrowing changes', 'Interest rates and spending power'],
    impacts: { fiscal: 1 } },
  { re: /\b(inflation|cpi|wpi|price rise|food prices)\b/i, category: 'Prices',
    context: 'Inflation is how fast prices rise. The RBI aims to keep retail inflation near 4% and adjusts interest rates to do so.',
    concept: 'Inflation and the RBI\'s target',
    chain: ['Prices rise faster or slower', 'Household budgets change', 'RBI reconsiders interest rates', 'Loans and savings'],
    impacts: { inflation: 1 } },
  { re: /\b(gdp|growth rate|iip|industrial output|pmi|core sector)\b/i, category: 'Growth',
    context: 'GDP growth measures how fast the economy\'s total output rises. Other indicators such as factory output give early signals.',
    concept: 'Measuring growth',
    chain: ['Output figures released', 'Picture of demand and jobs', 'Government and RBI plans', 'Investor confidence'],
    impacts: { growth: 1 } },
  { re: /\b(monsoon|rainfall|drought|flood|heatwave|cyclone|kharif|rabi|msp|crop)\b/i, category: 'Weather and farms',
    context: 'About half of India\'s workforce depends on farming, and many crops depend on the monsoon. Weather shocks move food prices and rural incomes.',
    concept: 'Weather, food prices and rural demand',
    chain: ['Weather or crop news', 'Farm output changes', 'Food prices and rural incomes', 'Inflation and demand for goods'],
    impacts: { inflation: 1, growth: -1 } },
  { re: /\b(protest|agitation|bandh|strike|blockade|unrest)\b/i, category: 'Protests and markets',
    context: 'Protests matter to the economy when they disrupt work and supply, or when they might change government policy, taxes or spending.',
    concept: 'Political risk and investors',
    chain: ['Protest or strike', 'Disruption or policy uncertainty', 'Output, supply or investor mood', 'Prices, markets or growth'],
    impacts: { markets: -1 } },
  { re: /\b(election|poll|coalition|government formation)\b/i, category: 'Politics and economy',
    context: 'Elections can change who sets economic policy. Investors watch for promises on spending, taxes and welfare.',
    concept: 'Policy uncertainty',
    chain: ['Election or political change', 'Expected policy changes', 'Spending, tax and reform plans', 'Markets and investment'],
    impacts: {} },
  { re: /\b(supreme court|high court|verdict|ruling|tribunal)\b/i, category: 'Courts and economy',
    context: 'Court rulings can change rules for companies, taxes or government contracts, and so affect investment.',
    concept: 'Rule of law and investment',
    chain: ['Court ruling', 'Rules for businesses change', 'Costs or certainty for investors', 'Investment decisions'],
    impacts: {} },
  { re: /\b(bank|nbfc|npa|loan growth|credit|upi|digital payment)\b/i, category: 'Banking',
    context: 'Banks turn savings into loans for homes, businesses and farms. Their health decides how easily the economy can borrow.',
    concept: 'Credit and growth',
    chain: ['Banking news', 'Lending conditions change', 'Borrowing by firms and households', 'Investment and spending'],
    impacts: { growth: 1 } },
  { re: /\b(sensex|nifty|stock market|shares|ipo|sebi)\b/i, category: 'Markets',
    context: 'Share prices reflect what investors expect about company profits, interest rates and the economy.',
    concept: 'What moves share prices',
    chain: ['Market move', 'Investor wealth and mood', 'Company fundraising', 'Spending and investment'],
    impacts: { markets: 1 } }
];

const KEYS = ['inflation', 'growth', 'rupee', 'fiscal', 'markets', 'trade'];

function match(title, text) {
  const hay = title + ' ' + String(text || '').slice(0, 500);
  return T.find((t) => t.re.test(title)) || T.find((t) => t.re.test(hay)) || null;
}

function templateFor(title, text) {
  const t = match(title, text);
  if (!t) return null;
  const kinds = ['event', 'channel', 'variable', 'outcome'];
  const impacts = {};
  // Direction depends on the specific news (a price can rise or fall), so a general pattern sets no direction.
  KEYS.forEach((k) => { impacts[k] = 0; });
  return {
    category: t.category, context: t.context, concept: t.concept, impacts,
    chain: t.chain.map((label, i) => ({ kind: kinds[Math.min(i, 3)], label, added: true }))
  };
}

module.exports = { templateFor };
