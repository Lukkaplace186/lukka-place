# Lukka Place - System Rules & Architecture

This file holds the rules that bind every change. The detail and history of each
subsystem live in `docs/claude/*.md` (index at the bottom): **read the area file
before changing that area**, and update it (not this file) with what you learned.
Add a rule here only when it applies across the whole system.

## System Architecture & Data Flow
- **Intake Engine** (Node.js/Express, this repo): Captures raw listings via WhatsApp, parses attributes using GPT-4o (`services/openai.js`), and stores them locally in SQLite (`services/db.js`). This is a staging/intake queue, not public data — never read it as a source for the public storefront. One exception, owner decision 2026-11-04: the PRICES of WhatsApp group captures feed the price guide's medians as market observations (never a listing, never a page) — see `docs/claude/market-data.md`.
- **Admin Panel** (Laravel): Operates on admin.lukkaplace.com as our back-office CMS for human moderation and approval. External to this repo — do not build a competing property-moderation admin here. The web console in `web/app/admin/*` (conversations, leads, viewings, agents, market data…) is in scope; property moderation in Laravel is not touched.
- **Database** (Supabase / Postgres): The single source of truth for approved, public listings. `services/postgres.js` (`syncListingToPostgres`) is the write path, used when an agent's listing is published. `services/propertyRepository.js` is a **read-only** path — every query there applies the approval filter below and never bypasses it. The Next.js storefront queries Supabase itself, independently.
- **Public Storefront** (Next.js, `web/`, its own `web/CLAUDE.md`): Lives on lukkaplace.com and queries Supabase directly for listings.

### Public listing filter (verified against live data — do not use the literal `published`/`status = 'approved'` wording)
`properties` has no `published` column, and `status` is an **integer**, not a string — `status = 'approved'` is a type error in Postgres, not an empty result. The real condition, confirmed against production:

```sql
WHERE status = 1 AND approve_status = 1
```

`approve_status` (integer: `0` = pending moderation, `1` = approved by the Laravel admin panel) is the actual moderation gate. `status = 1` is a separate active/enabled flag. Pending listings must **not** appear on the public storefront. Sold/closed analytics filter `approve_status = 1` only (a sold listing has `status = 0`). `listing_status` is NULL on legacy rows: compare it with `IS DISTINCT FROM`, never `<>`.

### Security — Supabase access from Next.js
The storefront queries Supabase directly (chosen over a proxying Express endpoint). This means:
- The Supabase **service_role key** (bypasses Row Level Security, full read/write) must only ever be used **server-side** — Server Components, Route Handlers, or Server Actions. It must never reach the browser: never in a `NEXT_PUBLIC_*` env var, never imported into a `'use client'` component, never returned in an API response body.
- Every public listings query must include the filter above. The query-time filter is the only thing keeping pending/unapproved listings off the storefront: the engine and web both connect as `postgres`, which owns the tables and has BYPASSRLS, so no RLS policy can ever filter their reads.
- **What RLS does do here: it shuts PostgREST.** `properties` and `agents` have RLS ON with no policy, and since `migrations/20261015_rls_lockdown.sql` so do the fourteen tables that were open to the public anon key with full grants (`customers` with its password hashes, `customer_favorites`, `customer_saved_searches`, `page_views`, `whatsapp_clicks`, `listing_events`, `agent_performance_logs`, `bot_locks`, `bot_sessions`, `exchange_rates`, both `footer_*_links`, `plan_change_requests`, `saved_search_notifications`); anon/authenticated privileges on them and their sequences are revoked. Nothing in this system uses the anon key (supabase-js is Storage-only, with the service_role key), so no policy is needed.
- **New tables start closed.** The same migration removed anon/authenticated from `postgres`'s default privileges in `public` (tables and sequences). A new migration no longer needs its own `REVOKE ALL … FROM anon, authenticated`, but keeping one is harmless and still protects a table created by `supabase_admin` (the dashboard), whose defaults `postgres` cannot change. If the app is ever moved to a login role without BYPASSRLS that does not own these tables, every one of them returns zero rows until policies exist.
- **Never a bare `SET` through the pooler (port 6543).** It sticks to a shared server connection and broke production writes on 2026-09-15. Read-only probes use `BEGIN READ ONLY … COMMIT`; settings use `SET LOCAL` inside a transaction.

## Rules that apply everywhere

- **Never invent data.** NULL means "not stated" and is a different claim from 0 / false. No guessed commune, price, coordinate, reference, template name, agent, or backfilled timestamp (`verified_at`, `sold_price`…). When a fact is unknown, say so in the UI or the message.
- **Locations**: never hardcode or invent one. Resolve communes and quartiers through `services/locations.js` (`resolveCommune`, `resolveQuartier`, `inferCommune`, `inferListingLocation`, `cascadeCommuneChange`) against `kinshasa_locations.json` (official), `kinshasa_quartier_aliases.json` (what agents write, each with a source), and `drc_locations.json` for other cities. A name in one commune deduces it (the agent confirms); a name in several is asked, never guessed. The quartier holds a place name; a landmark goes to `reference`. `web/lib/data/kinshasa-gazetteer.json` must contain every official quartier and alias. Detail: `docs/claude/listing-data.md`.
- **Place is always "quartier, commune"** (city added outside Kinshasa), through one helper per side: engine `services/locations.js` `placeLabel`, web `lib/placeLabel.js`.
- **French wording**: user- and prompt-facing French says "référence", never "repère".
- **Property classifications**: "Parcelle" (sub-types in `PARCELLE_SUBTYPES`: Maison Type Locataire, Villa, Terrain Nu) vs "Appartement" — only a unit in a multi-storey building is an Appartement; plot dimensions, a compound, "Type Locataire"/"Portes" mean Parcelle. Commercial space is `property_categories.type = 'commercial'`; a "bureau" named as a room of a house is not commercial.
- **Listing fields that must not be conflated**: `reference` (the listing's own code, or the agent's landmark) vs `quartier`; `deposit_months` / `advance_months` / `commission_months` are three separate costs ("3 + 1 + 1"), never summed; `features` (reader-facing bullets from the agent's own words) vs `amenities` (equipment vocabulary); `price_period` `jour`/`semaine` is short-term and never enters a monthly median.
- **The extraction prompt carries no pasteable example phrases** (the model copies them onto listings); keep the agent's own words, never add a detail. Listing reading stays on gpt-4o.
- **Agent gates are shared**: a number counts as an agent's only with `agents.phone_verified_at` set and the agent not deleted (`deleted_at`); direct routing also needs `direct_routing_enabled` not false. `resolveAgentId`, `identifySender`, `propertyRepository.directRoutingBlocker` and web `lib/listings.js` apply the same conditions — change one, change all.
- **WhatsApp goes through Lukka Place first** (owner decision 2026-11-09, replaces the dual contact policy): every "WhatsApp" button to an agent or developer (listing, profile, directory, project, Espace Client) opens the central number with the page's link (web `lib/leadRouting.js` — `resolveWhatsAppRouting`, `contactWhatsAppHref`); the engine (`services/listingEnquiry.js`, `services/contactRelay.js`) records the customer and a lead, alerts the agent and replies at once with the agent's WhatsApp. The verified agent's number stays on the page for calls (tel:). `NEXT_PUBLIC_WHATSAPP_DIRECT_TO_AGENT=on` restores direct links. "Demander une visite" is still the tracked visit pipeline. Detail: `docs/claude/leads-and-enquiries.md`.
- **WhatsApp delivery**: a session message reaches only someone who messaged our number in the last 24 h; outside it Chakra/Meta accept the send and nothing arrives. Templates are the only way to reach a cold contact. Template names are env vars, default `null`, read at call time; "accepted" is never proof of delivery. Intake number +243 976 321 848 sends almost everything; +243 846 962 654 is the notifications number and the ops desk (`OPS_WHATSAPP_NUMBER`). Detail: `docs/claude/whatsapp-delivery.md`.
- **Anything that messages a real person** runs after the commit, is fire-and-forget, never throws into its caller, and logs what was actually sent (or that nobody was reached).
- **Every WhatsApp send goes through `services/chakra.js`** (web through the engine's send routes), which records it in `whatsapp_message_log` with every inbound message; a raw HTTP send would be missing from the admin's WhatsApp history. Detail: `docs/claude/leads-and-enquiries.md`, "Recording every customer ↔ agent interaction".
- **Env flags** are read at call time; `FEATURE=off` disables, unset is the default. Paused in production on purpose: `AVAILABILITY_CHECK=off`, `AGENT_DIGEST=off`, `AGENT_WEEKLY_DIGEST=off`, `LISTING_APPROVED_TEMPLATE` commented out.
- **Duplicated engine (CJS) ↔ web (ESM) modules** must change together; each pair has a test comparing them (photo enhance, utility tags, commercial spaces, lease term, listing details, photo caps, listing quota, landmark rule, family words in `group-reader/lib/prefilter.js`).
- **wa_id / phone numbers are 7–15 digits** on both sides (`routes/admin.js`, `web/lib/phone.js`).

## Verification & Commands
- **Verification Command**: Always run `npm run verify` before declaring a backend task complete. Run it alone (it flakes beside a `next build`); locally it must be 0 failed.
- **Test Coverage**: Do not touch schema fields without updating `scripts/verify-pipeline.js`. Each feature has a numbered `§` section; check the highest number right before adding one (other sessions add them too).
- SQLite columns go in `services/db.js`'s idempotent ALTER lists; Postgres changes are idempotent `migrations/*.sql` run with `node scripts/run-sql-migration.js <file> [--write]` (dry run by default). Code must survive running before its migration (SAVEPOINT tolerating 42703, or `to_regclass` for a new table).
- Web tests: `cd web && npm test`; a single file needs the full flags including `--env-file=tests/unit.env`, or it talks to production.

## Area docs — read before changing that area

| File | Covers |
|---|---|
| `docs/claude/listing-data.md` | Location hierarchy in full, property types and classifications, schema attributes (`features`, entry costs, `reference`), utility tags, commercial spaces, practical details, short-term rentals, cities beyond Kinshasa, listing verification, videos and 20 photos, photo auto-correction, OpenAI cost |
| `docs/claude/whatsapp-intake-and-agents.md` | WhatsApp buyer assistant, auto-attribution, agent onboarding, new listing vs correction, group relay and reader, admin-created agents, extra WhatsApp numbers, plan quota, soft delete, sales referral codes, launch-readiness pass (intake card, voice notes, reverse phone verification, digest, trusted auto-approval), agent commands, "Toujours disponible ?", account attribution, growth launch |
| `docs/claude/leads-and-enquiries.md` | Lead routing and the WhatsApp message format, storefront WhatsApp enquiries, automated agent matching (`lead_matches` vs `lead_proposals`), projets neufs and developer self-serve, profile enquiries, interaction counts |
| `docs/claude/viewings.md` | Viewing-request notifications, the agent Accept / Autre créneau / Décliner loop, dashboard answers, status vocabulary, decline survey and closing price, Espace Client side, 15-minute SLA and check-in, `scheduled_at`, routing/price capture/agent performance, visit booking and bon de visite, agent ratings |
| `docs/claude/whatsapp-delivery.md` | What outbound WhatsApp actually delivers, templates (approved, on/off, image headers, link buttons), the two numbers, the ops desk phone, moderation alerts and verdicts, Messagerie chat alerts |
| `docs/claude/map-and-geocoding.md` | The listings map, viewport fetching, pins, geocoding cascade and name checks, publish-time geocoding |
| `docs/claude/ops-and-jobs.md` | Scheduler and job order, admin console at scale, ops alerts, agent dashboard at scale, SQLite backups, engagement tracking rollup |
| `docs/claude/market-data.md` | Benchmark pricing, market observations (sources, terms of use, cleaning, imports, pastes, prospects) |

Code comments, `web/CLAUDE.md` and the area docs still cite sections as `CLAUDE.md, "<heading>"`: those headings now live in `docs/claude/` — `grep -rn "<heading>" docs/claude` finds them.

Operational procedures (deploy, production SQL, templates, live QA, triage) are in the user-level skills `~/.claude/skills/lukka-*`; they load on their own when a task needs them.
