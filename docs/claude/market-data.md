# Market prices — benchmarks and market observations

> Moved verbatim from the root CLAUDE.md on 2026-11-06 to keep it short. The rules in CLAUDE.md
> still bind; this file is the detail and history. When you change this area, update this file
> (a dated section: what, why, env vars, the verify-pipeline §). "See X below/above" may point to a
> section now in another docs/claude file: `grep -rn "X" docs/claude`.

## Benchmark pricing (`web/lib/marketBenchmarks.js`, `/admin/market-data`)

Moved from `/admin/benchmarks`, which is now the agent leaderboard — see
"Direct-to-Agent Routing, Price Capture & Agent Performance".

Medians of real closed transactions by commune × purpose × property_type —
asking, achieved, the negotiation gap, and days on market. Built **on**
`lib/dataExport.js`'s conventions rather than forking them: the same
`approve_status = 1`-only gate (filtering on `status` would drop every sold
listing, i.e. the entire dataset), the same `sold_at`-preferred DOM.

- **A cell below `MIN_SAMPLE` (5) is suppressed**, medians nulled, count kept.
  A "median" of two sales is not a median, and this figure is meant to be
  quotable to a bank. A suppressed cell still shows its real count, because "3
  ventes, pas encore assez" is truer than an absent row that reads as "no
  activity".
- **Communes are derived from the data, never hardcoded** — Gombe / Ngaliema /
  Lingwala are where volume is expected, not a fixed list.
- **No imputation**: a close with no recorded `sold_price` is excluded rather
  than stood in for by the asking price, which would make the negotiation gap
  look like zero — the exact number this dataset exists to measure.
- Admin-only and `noindex`, behind the same `ADMIN_SESSION_COOKIE` gate as the
  CSV export. **Expect it to be mostly empty**: very few transactions are
  recorded yet, and that is an accurate report on the market record.

## Market observations — asking prices from outside Lukka Place (2026-11-04)

`services/marketObservations.js` + `services/marketSources/*`, Postgres
`market_observations` / `market_source_runs`
(`migrations/20261104_market_observations.sql`). Feeds web's price guide
(`/combien-coute`, web `lib/marketGuide.js`) and `/admin/market-data/marche`.
Our ~175 live rentals left most commune × bedroom pairs below the 5-listing
minimum; the market is mostly posted elsewhere. §72 of verify-pipeline.

- **Facts only.** Price, period, bedrooms, kind, furnished, commune, the
  source's id and link (+ a ≤200-char title for the admin list). No photo,
  description or phone. Nothing is ever shown as a listing.
- **Sources, chosen by their terms of use (read 2026-11-04):**
  collected nightly — `whatsapp_group` (our own group captures from SQLite,
  never a group in `EXCLUDED_GROUP_JIDS` — empty since Vitesse maximale 5/5 was
  authorised on 2026-11-04), `immo24` (public WP REST
  feed), `imcongo` (6 result pages, Crawl-delay 10; terms forbid reproduction,
  nothing is reproduced), `alain_realty` (sitemap + pages), `smartimmo`
  (sitemap + schema.org; the UUIDv7 id dates the advert), `mediacongo`
  (added later on 2026-11-04: the property classifieds' list pages back to
  COLLECT_SINCE, ~110 pages, Crawl-delay 10; an advert page only for a
  rental or an unclear title, for the bedroom count — its first
  "annonce_data" block is an HTML comment and is ignored; mostly sales, ~1 in
  8 is a rental; same terms position as IMCongo;
  `migrations/20261104_market_source_mediacongo.sql` widens the source CHECK).
  **Hand-entered only**
  (web form): `facebook` (Meta forbids automated collection) and `zwandako`
  (its terms forbid robots — ~8,000 adverts in its public feed; written
  permission would change that). keur-immo.com blocks bots. The Africanvestor
  page is a published ESTIMATE (web `lib/data/published-rent-estimates.json`),
  never in a median.
- **Politeness** (`marketSources/http.js`): one request at a time per site,
  ≥3 s apart or the site's Crawl-delay, robots.txt read at run time and obeyed
  (`ROBOTS_DISALLOWED`), identifying User-Agent, no cookies.
- **Cleaning** (`normaliseObservation`): only adverts posted since
  `COLLECT_SINCE` (2026-01-01) where the source dates them; francs, day/week
  rates, a rent outside 30–20,000 $/month or a sale outside 1k–20M $ are KEPT
  with `excluded_reason` (SmartImmo carries "210 000 USD / mois" on sales);
  "0 chambres" on a house is unknown; communes through `locations.js`
  (`resolvePlace`, unique answers only). A team member's exclusion is
  `manual:<code>` and survives every refresh.
- **Job `market-observations`** (before sqlite-backup), 2h Kinshasa
  (`MARKET_COLLECT_HOUR`), `MARKET_COLLECTION=off` disables. It STARTS the
  collection in the background and returns — tens of minutes of spaced
  requests must not hold the scheduler tick; an in-process flag stops a second
  run. SmartImmo reads at most `MARKET_MAX_DETAIL_FETCHES` (600) new adverts a
  night, so its ~1,080-advert backlog drains in two nights; adverts already
  stored are only marked seen. One source failing never stops the others and
  shows on the admin page (`market_source_runs.last_error`).
- **First run / one source**: `node scripts/collect-market-observations.js
  [--source imcongo] [--max 1200] [--write]` (dry run by default) on the VPS,
  after the migration.
- **Never counted twice** (web side): a published group capture is counted as
  the Lukka listing while public, not at all once rejected/deleted; the same
  rounded price in one commune × bedrooms on several sources counts as the
  most any one source shows.
- **Recent rents weigh double** (2026-11-05, owner): in a guide's median and
  p25–p75, an advert posted in the last 92 days (web `RECENT_DAYS`,
  `RECENT_WEIGHT` = 2; posted_at, else first_seen_at; a Lukka listing's later
  of created / moderated) counts twice. The stated number of listings stays
  the real count; the method note on /combien-coute says so.
- **A hand-copied batch** (more than the admin form is for):
  `node scripts/import-market-observations.js <file.json> [--write]`, file in
  `scripts/data/` (columns slug, kind, price, beds, commune, quartier,
  daysAgo; manual sources only). First one: `zwandako-2026-11-05.json`, 99
  Zwandako rentals the owner pasted (96 counted, 83 in Ngaliema). Rows count
  as online from the import and leave the guide 60 days later unless
  re-imported.
- **"Coller des annonces" — one paste, prices AND prospects (2026-11-05,
  owner: "so I don't have to do the job twice").** `services/marketPaste.js`
  behind `POST /admin/parse-market-paste` reads a pasted page (Facebook,
  Zwandako, a site, a WhatsApp group; ≤20,000 chars once cleaned, ≤40 adverts,
  one gpt-4o call, ~0.5–1 ¢) into adverts, each with its price facts and its poster's name,
  agency and number. Kept only when literally in the text: the number (last 9
  digits) and the price; the commune only when `locations.js` resolves it to
  one Kinshasa commune or deduces it from a quartier; a buyer's "je cherche"
  is not an advert. Stores nothing — web's /admin/market-data/marche shows
  each advert for checking, and one save writes the prices to
  `market_observations` (source_ref `paste:<hash of the facts + number>`, so a
  repost is one row; still no phone in that table) and the posters to
  `market_prospects` (`migrations/20261105_market_prospects.sql`, one row per
  number; a later paste fills a blank name/agency, adds the source, counts the
  advert, never touches the team's status or notes) in one transaction.
  `/admin/market-data/prospects` is the follow-up list that replaces the
  separate "Prospects agents" tracker page. §75; web
  `tests/unit/market-prospects.test.js`. **A whole Facebook group page can be
  pasted (2026-11-06)**: web's `cleanPastedText` keeps only the posts — link
  text kept (the poster's name), links, hashtags, "Facebook" / See more lines
  and WhatsApp-group promo lines removed, a post repeated or cut off by "See
  more" kept once (a 60,000-character page is mostly that). The box takes
  300,000 raw characters; a row whose price was not read starts unticked for
  the guide.

## Indice Lukka blends market observations (2026-11-11, owner request)

`/indice-lukka` no longer reads `market_snapshots_monthly` (Lukka listings
only, one month-end reading). It runs web `lib/lukkaIndex.js`: the price
guide's rules and de-duplication, per commune with the bedroom counts pooled
(the de-duplication key keeps the bedrooms), recent adverts weighing
`RECENT_WEIGHT` in the median and p25–p75 but never in the count, minimum
`MIN_PRICE_SAMPLE` adverts after de-duplication. The snapshots are still
written by the engine and still read by the admin.

- **One SQL "as of" an instant.** `marketGuide.js`'s observation filter is now
  `marketRentsSql(asOf)` (`NOW()` for the guide, unchanged text apart from a
  harmless `posted <= asOf`), so the index and the guide cannot drift. The
  Lukka side as of D: approved, created and moderated by D, public today or
  archived / closed after D (a suspended listing with no archive date is left
  out of past days), priced from `property_price_history` at D, else its
  current price. Exclusions made later apply to the past.
- **Month-on-month change** = the same SQL run as of one calendar month
  earlier, shown only when both days have the minimum sample AND the earlier
  day is on/after `INDEX_COMPARABLE_FROM` (2026-11-04, when external
  collection began; before it a past day could only be rebuilt from adverts
  still online afterwards). So the first change appears on 2026-12-04; until
  then the page says so.
- **Public method page** `/indice-lukka/methodologie` (in the sitemap): every
  number in its copy is interpolated from the rule constants, and its source
  list is `COLLECTED_SOURCES` / `MANUAL_SOURCES` with today's per-source counts
  (before de-duplication, never summed). `tests/unit/lukka-index.test.js`.
- **Not done:** a frozen monthly record of the blended index (a bank quoting
  "March" needs March to stay put) — that is an engine job + table, like
  `market-snapshot`.
