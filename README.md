# Economy Desk

A personal, live economics dashboard for teaching. It reads Indian newspapers, PIB and the RBI through the day. An AI model then picks out what matters for the economy, including non-economic news with economic effects, and draws the chain of cause and effect for each story. Each story also gets a line you can use in class.

This is a separate project from the UPSC current affairs app. It has its own repository, its own server and its own link.

## What you see

- **Key numbers strip**: repo rate, CPI, the US Fed rate, Sensex, Brent, rupee, GDP, GST, FPI flows and forex reserves. Tap a tile for its source and date. A coloured dot shows how well each number is verified.
- **Thread of the day**: the most surprising chain of the day, for example "US election date → oil → rupee → inflation → Sensex".
- **Linked stories**: each card has a short summary with key facts in bold and a chain of effects. It also has an impact compass (inflation, growth, rupee, fiscal, markets, trade), a "Eureka for class" box, the concept it illustrates, the UPSC paper and its sources. Spillover stories (politics, war, protests, climate or courts affecting the economy) have a purple top edge.
- **Web of linkages**: a network diagram showing which stories move which variables.
- **Concept of the day**, a **rate-cycle chart**, a **who gains and who loses** panel, a **calendar** of upcoming data releases with countdowns, and a **three-question quiz** for class.
- **Class mode**: a full-screen slideshow of the day's eureka lines for projecting in class. Use the arrow keys to move.
- **New** tags show what arrived since your last visit.

Blue boxes and dashed outlines mark the AI's analysis. Everything else restates what the source reported.

## How it works

1. Every 15 minutes the server reads the feeds in `config/sources.json`. These are 9 business feeds, PIB, the RBI and 6 general news feeds. Keyword rules keep English stories that are plausibly economic, plus non-economic news (war, protests, weather) that may affect the economy. They drop the rest, including stories in other languages, investing tips, tributes and ceremonies. The AI then makes the final call and rejects anything without a direct economic link.
2. The same story from several papers is merged into one card, with "Also in" links.
3. About every 90 minutes, the most important new stories are sent to an AI model in one request: Google Gemini on its free tier, or Claude if you add a Claude key. It writes them up in simple language with a background line, a chain of effects and a line for class. The server then checks every figure against the source text. Any figure it cannot find is labelled "Needs checking".
4. Every 6 hours the AI writes the front page: story of the day, concept, quiz, and who gains and who loses.
5. Only stories the AI has rewritten and judged directly economic are shown. Stories waiting for analysis are counted in a note at the top. Without any AI key, the keyword-filtered stories are shown with the outlet's headline and a general pattern instead.
6. The open page updates by itself.

The free Gemini tier allows only a limited number of requests a day, and Google does not publish the exact number for every model. The app stays within 20 a day by default and pauses for an hour if Google says the limit is reached. Your actual limit is shown in Google AI Studio. If it is higher, raise `AI_CALLS_PER_DAY`.

## What you keep up to date by hand

Live market prices need paid data services, so some numbers are kept in small files you can edit on GitHub:

- `config/pulse.json`: the key numbers strip. Edit `value`, `change`, `asOf` and `source` when the RBI, MoSPI or the Fed release new data. The rupee tile updates by itself once a day from a free market-rate service.
- `config/watch.json`: the calendar of upcoming releases and meetings.
- `config/extras.json`: the rate-cycle chart data.

The seeded figures were researched on 10 October 2026. Their verification level is shown on each tile.

## Settings

Set these as environment variables (in Render: your service, then Environment):

| Name | Default | What it does |
| --- | --- | --- |
| `GEMINI_API_KEY` | none | Free key from aistudio.google.com. Turns on story-by-story analysis. |
| `GEMINI_MODEL` | gemini-3.5-flash-lite | Which free Gemini model to use. |
| `ANTHROPIC_API_KEY` | none | Optional, paid. If set, Claude is used instead of Gemini. |
| `ACCESS_KEY` | none | Makes the dashboard private. Open it once as `https://your-link/?key=YOURKEY`, and that browser remembers it. |
| `AI_CALLS_PER_DAY` | 20 (Gemini), 300 (Claude) | Daily cap on AI requests. |
| `AI_EVERY_MINUTES` | 90 (Gemini), 15 (Claude) | How often new stories are sent for analysis. |
| `STORIES_PER_CALL` | 6 | Stories analysed in one request. |
| `EDITION_HOURS` | 6 (Gemini), 3 (Claude) | How often the front page is rewritten. |
| `POLL_MINUTES` | 15 | How often feeds are read. This is free and needs no AI. |
| `MAX_AGE_HOURS` | 72 | How long stories stay on the page. |

## Cost

Nothing, if you use the free Gemini key without billing, Render's free plan and UptimeRobot's free plan. A Claude key is optional and is billed per use.

## Sources and their limits

- Feed addresses in `config/sources.json` follow each outlet's published RSS pattern. Only the Business Standard feed could be checked from where this was built. The **Sources** panel at the bottom right of the dashboard shows which feeds work. Fix or delete any that fail.
- The Finance Ministry, Ministry of Commerce and Economic Survey publish no feeds. Their releases reach the dashboard through PIB, which carries every ministry's press releases.
- Some sites block cloud servers. If a feed shows an HTTP 403 error in the Sources panel, that is the reason.
- Stories from newspapers are labelled "Press report". Only PIB and RBI items are labelled "Official source". Check figures against the official release before teaching from them.

## Try it on your own computer (optional)

```
npm run demo
```

Then open http://localhost:3000. This uses sample feeds and a stand-in for the AI, so it runs offline. `npm test` runs the checks.

## What was tested

18 checks pass. They cover feed parsing, story selection, duplicate merging, the figure check, the Gemini request format and rate-limit handling, validation of AI replies, the no-AI mode, the access key and the web server, all using sample feeds and a stand-in for the AI. The real Gemini and Claude APIs, the real newspaper feeds and the free rupee-rate service were not reachable from where this was built, so they have not been run.
