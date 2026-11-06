# Scheduler, admin console, dashboards, backups, analytics

> Moved verbatim from the root CLAUDE.md on 2026-11-06 to keep it short. The rules in CLAUDE.md
> still bind; this file is the detail and history. When you change this area, update this file
> (a dated section: what, why, env vars, the verify-pipeline §). "See X below/above" may point to a
> section now in another docs/claude file: `grep -rn "X" docs/claude`.

## Scheduled Jobs

`services/scheduler.js`, started from `index.js`. This process is the only
always-on single-instance component in the system (`ecosystem.config.js` pins
it to one fork), which is why the timer lives here.

- **Daily customer alerts** (job `search-alerts`, renamed from
  `search-alerts-weekly`) — calls `web`'s own `POST /api/cron/search-alerts`
  (Bearer `CRON_SECRET`). The engine does not reimplement the sweep — a second
  definition of "a new match" would drift from the one customers see on their
  Alertes tab.
  - **Daily, because frequency is per search now** (`daily` / `weekly` / `off`,
    `customer_saved_searches.alert_frequency`); the web side skips a search
    alerted too recently for its own frequency. `SEARCH_ALERT_HOUR` (default 9)
    is the only knob; `SEARCH_ALERT_DAY` is no longer read.
  - **Chunked.** The web endpoint handles one keyset page of saved searches
    under a 45s budget and returns `{done, cursor}`; `runSearchAlertSweep`
    posts the cursor back until `done` (capped at `MAX_SWEEP_CHUNKS`, and a
    cursor that does not move ends it). The old single five-minute request
    loaded every saved search at once. A failed chunk fails the run and the
    next tick starts over — `saved_search_notifications` means nothing already
    sent is resent.
  - web's `lib/searchAlertSweep.js` has the matching rules (new approved
    listings only, a widened `getListings` result is never an alert, verified
    and not-opted-out numbers only). §18 of verify-pipeline pins this side.
- **Idempotent across restarts** via the `job_runs` table: a run is skipped
  when one already succeeded within `MIN_GAP_MS` (20 hours). A deploy landing
  inside the 09:00 firing hour is a no-op, not a second round of real
  WhatsApp messages. A *failed* run deliberately does not advance
  `succeeded_at`, so the next tick retries instead of skipping the day.

### One tick, many jobs — and two kinds of idempotence

The tick is **60 seconds** (it was 10 minutes) and the work is a `JOBS` array
of `{ name, shouldRun(now), run() }`. The old interval is what made the
scheduler single-purpose: a 15-minute SLA checked every 10 minutes fires
somewhere between 15 and 25 minutes late, which is not a 15-minute SLA.

Six jobs are registered, in order: `search-alerts`, `viewing-sla`,
`viewing-checkin`, `ops-health-alerts`, `listing-stats-rollup`. `shouldRun` must be **cheap** — it runs once a minute per
job forever — and is where "is there anything to do?" belongs, so `job_runs`
records real work rather than a heartbeat. Jobs run sequentially and each
swallows its own failure: the SLA sweep throwing must never stop the
post-visit check-in behind it.

**`job_runs` cannot express per-entity idempotence and must not be asked to.**
It is keyed by job NAME, one row per job, so it answers "did this sweep run"
and nothing finer. "Have we already alerted on viewing request #47" is a fact
about the request and lives on the row — `viewing_requests.sla_alerted_at`,
`.checkin_sent_at`. Confusing the two either spams one customer or skips every
other one.

## Admin console at scale (engine side)

The web console (web/CLAUDE.md, "Built for 30k agents") asks the engine for one
page at a time. What the engine added for that:

- **Filters are SQL, never a fetch-and-slice.** `listConversations` (q over
  wa_id / assigned_agent / notes, `ai_active`), `listAllViewingRequests`
  (`q`, `agent_ids`, `commune`, `from`/`to`, `view`), and the new
  `listLeadMatches` (`GET /admin/lead-matches`: commune, budget OVERLAP, min
  score, outcome). `%`/`_` in a search term are escaped. Summaries/facets are
  unfiltered so a filtered page never zeroes the other chips.
- **`view=escalated` is not a status.** It is PENDING + `sla_alerted_at`
  (`VIEWING_FEED_VIEWS`); status stays PENDING, same rule as Speed-to-lead.
- **Timestamps compare through `datetime(@x)`.** `created_at` is
  `YYYY-MM-DD HH:MM:SS`; a raw ISO `…T…` compares lexically wrong on the
  boundary day. `getMatchingStats` was fixed the same way (2026-09-14).
- **`viewing_requests.commune`** (idempotent ALTER) is the listing's commune,
  copied at notify time by `setViewingRouting` (COALESCE — a NULL never
  overwrites). Visit-request leads carry no commune and Postgres has no
  commune column, so this copy is what makes commune filtering possible.
  Older rows: `node scripts/backfill-viewing-communes.js [--write]` (dry run by
  default, fills NULLs only).
- **`messages.sender` / `intent` / `tool_calls`** (idempotent ALTER) are
  written by whoever records the message: inbound defaults to `customer`;
  `buyerConversation` records `ai` + tool names and the routed intent;
  `listingEnquiry` records `system` + `listing_enquiry`; the admin reply
  route records `agent`. An outbound row with no sender stays NULL — never
  inferred later. `GET /admin/conversations/:id` now returns the LATEST 200
  messages plus `messages_total`.
- **`GET /admin/leads/counts?wa_ids=`** (≤200) and **`GET /admin/lead-analytics`**
  back /admin/customers and Lead Analytics. Delivery health there is
  accepted/refused sends plus agents who answered — never a delivered count.
- **`GET /admin/work-queues`** (engine counts for the console's work queues and
  sidebar badges) and **`GET /admin/health`** (job_runs outcomes, last inbound
  traffic, send failures, DB size, delivery config) back the dashboard and
  `/admin/health`. `GET /admin/lead-matches` also takes `agent_id`.
- **Rejection reasons reach the agent.** `POST /admin/properties/:id/notify`
  accepts `reason_code` + `note`; `MODERATION_REJECTION_REASONS` holds the
  French wording per code (web/lib/moderation.js lists the codes). No code and
  no note keeps the original generic message; an unknown code is never echoed.
- Admin sort/filter columns are indexed (`CREATE INDEX IF NOT EXISTS` at boot).
  Covered by `scripts/verify-pipeline.js` §23.

### Pushed operational alerts (`services/opsAlerts.js`)

A fourth scheduler job, `ops-health-alerts`, every 5 minutes. It evaluates the
same `db.getEngineHealth()` report `/admin/health` shows, plus a live
`SELECT 1` against Postgres (10s timeout), and alerts on: Postgres unreachable
(critical), a job whose last run failed and has not succeeded since (never the
alert job itself), no inbound WhatsApp traffic for `OPS_ALERT_SILENCE_HOURS`
(24 — a database that never had traffic does not alert), and
`OPS_ALERT_FAILED_PUSHES` (3) or more refused agency pushes in 24h.

- **Incidents, not messages.** `ops_alerts` (SQLite) holds one row per
  incident; a partial unique index allows one OPEN row per `alert_key`. The
  desk hears the opening and the resolution, never every sweep in between.
- **Nothing is marked notified that was not sent.** With
  `OPS_WHATSAPP_NUMBER` unset (production today) incidents still open and show
  on `/admin/health` and the console's Health badge (`openAlerts` on
  `GET /admin/work-queues`, `alerts.open/recent` on `GET /admin/health`). An
  incident opened while the number was unset is sent once a number exists, if
  still open. A failed send records `notify_error` and retries hourly, not per
  sweep. A resolution is only announced for an incident the desk was told of.
- Session messages, same 24h rule as everything else in "Outbound WhatsApp".
- Covered by `scripts/verify-pipeline.js` §29.

## Agent dashboard at scale (engine side)

- **`listing_stats_daily`** (`migrations/20260917_agent_dashboard_scale.sql`,
  plus `page_views (path, created_at)`, `whatsapp_clicks (listing_id,
  created_at)` and `listing_events (listing_id, created_at)` indexes — before
  this, every agent view count scanned `page_views` whole). Written only by
  `services/listingStatsRollup.js`, scheduler job `listing-stats-rollup`, every
  10 minutes, registered last. It RECOUNTS whole UTC days from the day before
  the newest rolled-up day and upserts them, so a missed tick, a late event or
  a re-run cannot double-count; an empty table recounts all history, which is
  the backfill. Window bound is explicit UTC midnight, events for deleted
  listings are dropped by `JOIN properties`, one transaction with a 120s
  statement timeout. web reads it only while fresh (≤30 min) and falls back to
  raw events otherwise.
- **SQLite ownership indexes** at boot: `leads (property_id)`,
  `leads (assigned_agent)`, `leads (agent_id)`, `viewing_requests (property_id)`
  — the three OR'd signals every agent inbox load filters on were unindexed.
  `listViewingRequestsForOwner`'s `COALESCE(vr.property_id, l.property_id)` still
  cannot use an index; stamping `agent_id` on leads/viewings at creation is the
  real fix.
- **Agent verification** (`migrations/20260917_agent_verification.sql`):
  `agents.verification_level` / `verification_reviewed_at` / `_by` and
  `agent_verification_documents`. No engine code reads it yet; see web/CLAUDE.md.
- Covered by `scripts/verify-pipeline.js` §31.

## SQLite backups (2026-10-15)

`services/sqliteBackup.js`, scheduler job `sqlite-backup` (last), nightly in
the Kinshasa hour `SQLITE_BACKUP_HOUR` (default 3); a night the engine was down
is caught up once 26h pass without a success, and a failure waits 15 min before
retrying. Before this, `/var/data/lukka_place.db` (leads, viewing requests,
conversations, pending questions) had no backup at all.

- **The backup API, never `cp`.** The database is in WAL mode; recent commits
  live in `-wal` until a checkpoint, so copying the `.db` drops them. Each
  snapshot passes `PRAGMA integrity_check` before it is gzipped and named.
- **Kept 14 days** (`SQLITE_BACKUP_KEEP_DAYS`) in `SQLITE_BACKUP_DIR` (default
  `/var/data/backups`) and in the private Supabase Storage bucket
  `SQLITE_BACKUP_BUCKET` (default `engine-backups`, created private, a public
  bucket is refused). Off-site pruning runs only after that night's upload
  succeeded. A failed upload fails the job, which `ops-health-alerts` reports.
- `node scripts/backup-sqlite.js [--local-only | --list | --restore-test [name|path]]`
  from the engine dir; the restore steps are in that file's header. §49.
- **Deployed 2026-10-15** together with the RLS lockdown migration (applied to
  production the same day; nothing is open to anon any more). First manual run:
  56 KB snapshot uploaded, `--restore-test` matched every table row for row.

## Engagement tracking — the full funnel rollup (2026-09-29)

`migrations/20260929_engagement_tracking.sql` adds `visitor_id` to the three
event tables, `page_views.listing_id` (backfilled from the path — a
derivation, not a guess), `listing_events.routing_type`, `search_events`, and
six `listing_stats_daily` columns. web/CLAUDE.md, "Engagement tracking", has
the write side.

- `services/listingStatsRollup.js` now recounts, per listing per UTC day:
  views, WhatsApp taps, saves, **calls, gallery opens, gallery completions,
  shares, unique visitors and visit requests**. Visit requests are this
  engine's SQLite (`db.countViewingRequestsByPropertyDay`, the same
  `COALESCE(vr.property_id, l.property_id)` attribution as the export count),
  handed to Postgres as a JSON parameter — the rollup is the only place both
  stores are in reach.
- `unique_visitors` is per day. A weekly "personnes" figure must be counted
  from raw events (`COUNT(DISTINCT visitor_id)`), never by summing days.
- Nothing is filtered in the rollup: every viewer is written (tagged
  `viewer_kind` — visitor / owner / agent / staff / bot / prefetch, web
  `lib/trackIngest.js`) and counted, and filtering only here would make the
  rollup disagree with web's raw-table fallback for the same week.
- Before the migration runs, the full statement fails with 42703 inside a
  SAVEPOINT and the original three-column statement runs instead
  (`legacy: true` in the result). Any other failure still rolls back.
- §39 of verify-pipeline.
