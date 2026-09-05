# Lukka Place - System Rules & Architecture

## System Architecture & Data Flow
- **Intake Engine** (Node.js/Express, this repo): Captures raw listings via WhatsApp, parses attributes using GPT-4o (`services/openai.js`), and stores them locally in SQLite (`services/db.js`). This is a staging/intake queue, not public data — never read it as a source for the public storefront.
- **Admin Panel** (Laravel): Operates on admin.lukkaplace.com as our back-office CMS for human moderation and approval. External to this repo — do not build a competing property-moderation admin here. A separate, narrower admin surface for WhatsApp conversations/leads (see "WhatsApp Property-Search Assistant" below) is in scope for this repo; property moderation itself is not.
- **Database** (Supabase / Postgres): The single source of truth for approved, public listings. `services/postgres.js` (`syncListingToPostgres`) is the write path, used when an agent's listing is published. `services/propertyRepository.js` is a **read-only** path, added for the WhatsApp search assistant's `search_properties`/`get_property` tools — every query there applies the same approval filter below and never bypasses it. The Next.js storefront still queries Supabase itself, independently.
- **Public Storefront** (Next.js): Lives on lukkaplace.com and queries Supabase directly for listings.

### Public listing filter (verified against live data — do not use the literal `published`/`status = 'approved'` wording)
`properties` has no `published` column, and `status` is an **integer**, not a string — `status = 'approved'` is a type error in Postgres, not an empty result. The real condition, confirmed against production:

```sql
WHERE status = 1 AND approve_status = 1
```

`approve_status` (integer: `0` = pending moderation, `1` = approved by the Laravel admin panel) is the actual moderation gate. `status = 1` is a separate active/enabled flag, always `1` in current data but included for correctness. As of the last check, 8 properties satisfy this; 5 more exist but are still pending approval and must **not** appear on the public storefront.

### Security — Supabase access from Next.js
The storefront queries Supabase directly (chosen over a proxying Express endpoint). This means:
- The Supabase **service_role key** (bypasses Row Level Security, full read/write) must only ever be used **server-side** — Server Components, Route Handlers, or Server Actions. It must never reach the browser: never in a `NEXT_PUBLIC_*` env var, never imported into a `'use client'` component, never returned in an API response body.
- Every public listings query must include the filter above. There is currently no Row Level Security policy on `properties` enforcing this at the database level — the query-time filter is the only thing preventing pending/unapproved listings from being publicly visible. Do not rely on RLS being there.

## Data Schema & Location Hierarchy
- **Location Normalization**: NEVER hardcode or invent locations. ALWAYS resolve Communes and Quartiers against `kinshasa_locations.json` using `services/locations.js` (`resolveCommune`, `resolveQuartier`, `quartiersForCommune`, `cascadeCommuneChange`).
- **Property Classifications**: Support "Parcelle" (with sub-types: "Maison Type Locataire", "Villa", "Terrain Nu" — see `services/openai.js`'s `PARCELLE_SUBTYPES`) and "Appartement". A listing is only "Appartement" if it explicitly describes a unit within a multi-story building — plot dimensions, a gated compound, or "Type Locataire"/"Portes" language means "Parcelle", never "Appartement".
- **Schema Attributes**: Always handle:
  - `parcelle_subtype` — sub-classification, only meaningful when `property_type = 'parcelle'`.
  - `units_count` (integer) — "X Portes" / "Type Locataire" door count.
  - `reference` — the listing's **own** explicit code (e.g. "Réf: LKP-2026-0091"), distinct from `quartier`. Never conflate the two: `quartier` is a place/landmark, `reference` is an identifier for the listing itself.
- **Landmarks**: Always use the French term "référence" (not "repère") in any user-facing or prompt-facing French text.

## Lead Routing Rules
- **WhatsApp CTA**: All "Contact on WhatsApp" buttons must route to Lukka Place's central WhatsApp number (the same number this engine's Chakra integration already runs on) — never a per-listing agent number. No per-listing contact number is synced to Supabase today.
- **Message Format**:
  ```
  Bonjour, je suis intéressé par l'annonce Ref: {reference} ({property_type} à {commune}). Est-elle toujours disponible ?
  ```

## WhatsApp Property-Search Assistant (in progress)

A second WhatsApp flow, separate from the agent-listing-intake pipeline above: a customer messaging the same number to search for a property, rather than an agent submitting one. Foundation built; not yet wired into `routes/webhook.js`'s live routing — see the note at the bottom of this section.

- **Conversation state machine** — `services/conversationState.js`. States: `NEW`, `COLLECTING_REQUIREMENTS`, `SEARCHING_PROPERTIES`, `SHOWING_RESULTS`, `PROPERTY_SELECTED`, `ANSWERING_PROPERTY_QUESTIONS`, `VIEWING_REQUEST`, `CONTACT_REQUEST`, `HUMAN_HANDOFF`, `CLOSED`. Transitions are validated, not free-form — the AI interprets natural language, but only this module decides whether a state change is legal. Every active state can reach `HUMAN_HANDOFF` directly ("je veux parler à quelqu'un"); `CLOSED` only reopens via `NEW` ("nouvelle recherche").
- **Storage** — `services/db.js`, four new SQLite tables (same file as `listings`, brand new tables so no `ALTER TABLE` migration path): `conversations` (one row per search thread, holds the requirements collected so far + `ai_active` for human handoff + `last_shown_property_ids` so "le premier"/"moins cher" can resolve), `messages` (full transcript, both directions), `leads` (`status` one of `NEW`/`CONTACTED`/`QUALIFIED`/`VIEWING_REQUESTED`/`VIEWING_COMPLETED`/`CONVERTED`/`LOST`), `viewing_requests` (`requested_time` is free text — "demain matin" is a real answer, not a structured slot the conversation collects).
- **Property matching** — `services/propertyRepository.js` (real Supabase reads, reuses `web/lib/listings.js`'s exact filter conventions: the `status = 1 AND approve_status = 1` gate, commune resolved via `property_amenities`) feeds `services/propertyMatching.js` (ranks by budget fit / bedroom match / listing freshness; widens a commune-scoped search that returns zero results to city-wide, flagged via `widened: true` so the reply can say so honestly rather than presenting it as an exact match). No distance/geo ranking here — correction to an earlier note in this file: `properties.latitude`/`longitude` **do exist** as real columns (verified directly against the live schema), they're just `NULL` on every currently-approved listing, so there's no real per-property coordinate to rank by yet. See "Interactive Property Map" below for how `web/` derives a real position anyway.
- **AI tool-calling layer** — `services/openai.js`, appended below `parseMessage()` as a fully separate pipeline (own system prompt `BUYER_SYSTEM_PROMPT`, own model call in `runBuyerTurn`). Six tools (`search_properties`, `get_property`, `get_location`, `create_enquiry`, `request_viewing`, `handoff_to_agent`), each backed by a real executor — `search_properties`/`get_property` call `propertyMatching`/`propertyRepository` (real Supabase reads), `get_location` calls the real `kinshasa_locations.json` data, `create_enquiry`/`request_viewing`/`handoff_to_agent` write real `leads`/`viewing_requests`/`conversations` rows via `services/db.js`. Identity/requirements (`conversationId`, `waId`, known requirements) are bound from the caller's `context`, never from model-supplied tool arguments — the model can propose an action, never assert whose lead it is. `runBuyerTurn` loops tool-call → real execution → feed result back to the model, capped at `BUYER_MAX_TOOL_ITERATIONS` (4) with an honest fallback reply if the model never settles on final text. Nothing in `parseMessage()`/`SYSTEM_PROMPT`/`RESPONSE_FORMAT` was touched — same file, purely additive, reverified by `scripts/verify-pipeline.js` (293/293 passing, including every pre-existing check unchanged).
- **Live routing** — `routes/webhook.js` forks: `!extracted.is_listing && !pending && extracted.intent === 'buyer_request'` routes to `services/buyerConversation.js`'s `handleBuyerMessage` instead of the agent-intake reply, via a new `if` block with its own early `return`, inserted immediately before the original (byte-for-byte unmodified) `if (extracted.is_listing) {...} else if (pending) {...}` chain. The `!pending` guard is deliberate and tested (`scripts/verify-pipeline.js` §14d): a sender with a listing still awaiting `'OK'` is never redirected into the buyer flow, even if a correction reply happens to get misclassified as `buyer_request`.
  - `services/buyerConversation.js` owns the orchestration: load/create the conversation, honor `ai_active` (silent once a human has taken over — the message is still recorded for the agent, but no auto-reply is sent), call `runBuyerTurn`, merge real requirements straight out of the model's own `search_properties` tool-call arguments (no second extraction call), advance conversation state (`COLLECTING_REQUIREMENTS` → `SEARCHING_PROPERTIES` → `SHOWING_RESULTS` after a real search — both hops are required, `conversationState.js`'s transition table has no direct edge), and send the reply via the same `services/chakra.js` used by the agent-intake path.
  - A `runBuyerTurn` failure degrades to `BUYER_ASSISTANT_FALLBACK_REPLY` rather than leaving the customer without a reply or throwing a stack trace back at them.
- **Admin dashboard** (`web/app/admin/*`) — conversations + leads, per the decision above (lives in `web/`, never touches the Laravel admin or its schema). Backed by a new `routes/admin.js` on the engine (`GET/PATCH /admin/conversations[/:id]`, `POST /admin/conversations/:id/reply`, `GET/PATCH /admin/leads[/:id]`), mounted behind the same `requireApiKey` middleware `GET /listings` already uses — no new auth mechanism invented. `web/lib/adminApi.js` is the server-side client, same pattern as `web/lib/locations.js`'s `GET /locations` call, authenticated via a new `ENGINE_API_SECRET` env var (`web/.env.local`, mirrors the engine's own `API_SECRET`).
  - **Password gate on `web/admin/*`** — `web/lib/adminAuth.js` + `web/middleware.js`. A single shared team password (not per-agent accounts — deliberately the smallest real thing that answers "is this visitor a Lukka Place team member", matching what was actually asked for). No new dependency: Node's own `crypto` — `scryptSync` for the password hash (`ADMIN_PASSWORD_HASH`, `salt:hash` in `.env.local`, generated via `web/scripts/hash-admin-password.js`, never invented by me — whoever runs that script supplies the real password), `createHmac`/`timingSafeEqual` for a stateless signed session cookie (`ADMIN_SESSION_SECRET`) — same primitives the engine already uses for webhook signature verification. `middleware.js` runs in the Node.js runtime (not the default Edge runtime) specifically so those primitives are guaranteed available, and gates every `/admin/*` request except `/admin/login`; a request with no valid session cookie is redirected to login with `?next=` set to the original path. Session cookie is `httpOnly`, `sameSite: lax`, scoped to `path: '/admin'`, 12h TTL.
  - **Local dev test credentials only** — `.env.local`'s `ADMIN_PASSWORD_HASH`/`ADMIN_SESSION_SECRET` are throwaway values generated for testing (`lukka-admin-local-test` is the plaintext password). Generate real ones (`hash-admin-password.js` + a fresh random `ADMIN_SESSION_SECRET`) before deploying anywhere.
  - Caught by real QA, not the automated suite (this app has none yet — see below): `logoutAction` originally called `cookieStore.delete(ADMIN_SESSION_COOKIE)` with no `path`, which defaults to `/` — a *different* cookie from the one actually set at login (`path: '/admin'`), since browsers key cookies by name **and** path. Logging out appeared to work but left the real session cookie completely valid; a direct revisit to a protected page loaded normally instead of redirecting to login. Fixed by matching the path explicitly on delete. Worth remembering generally: cookie deletion must mirror every scoping attribute (`path`, `domain`) the cookie was originally set with, or it silently creates a second, unrelated cookie instead of clearing the first.
  - "Take over" / "Return to AI" / a rejected state change all go through the exact same `services/conversationState.js`-validated `updateConversationState` the AI itself uses (via `services/db.js`) — an admin action can never leave a conversation in a state the AI couldn't have reached, and an invalid one is a 400 with the same error message, not a 500.
  - A manual agent reply from the dashboard sends through the same `services/chakra.js` path the AI uses, and is recorded as a real outbound message in the transcript.
  - Caught by real (non-mocked) local QA, not the automated suite: a schema-evolution bug where the already-running dev server's live SQLite file predated the new `notes` column — `CREATE TABLE IF NOT EXISTS` only applies to a fresh file. Fixed with the same idempotent `ALTER TABLE` migration pattern `listings` already used (`services/db.js`'s `migrateConversations`), with a regression test that explicitly drops the column to simulate an old file — the always-fresh `_verify.db` scratch database could never have caught this on its own.

## Interactive Property Map (`web/`, local dev only)

Real Google Maps rendering on `/listings` (`?view=map`, toggle button next to Sort on desktop, "Carte"/"Liste" pill in `FloatingControlBar` on mobile) — same URL-driven-state convention as filters/sort/pagination, so the map/list choice is bookmarkable.

- **`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`** (`.env.local`) is HTTP-referrer-restricted — correct for a browser-shipped key, but it means **Google's Geocoding API cannot be called server-side with this key** ("API keys with referer restrictions cannot be used with this API" — confirmed directly against the real key, not assumed). So `web/lib/geocoding.js`'s pipeline runs **client-side**, inside `components/PropertyMap.js`, using `google.maps.Geocoder` after the Maps JS API loads in the browser — a real request there carries a genuine `Referer` header and works fine (also confirmed directly).
- **Location resolution pipeline** (`lib/geocoding.js`), per the explicit product decision: (1) geocode the listing's real address/quartier/commune text; if that only resolves to locality-level precision (no real street match — `location_type`/`types` inspected, not just `status === 'OK'`), (2) fall back to `KINSHASA_COMMUNE_CENTROIDS` — real coordinates fetched live via `google.maps.Geocoder` against all 24 communes and hardcoded (not typed from memory); a listing with no structured `commune` tag also gets a real-text scan of its address/quartier for a known commune name before giving up (caught a real gap in QA — listing #226 has `commune: null` but its address literally contains "Ngiri-Ngiri"); (3) apply a deterministic ~200-400m privacy jitter (seeded by listing id, so a pin lands on the same nearby point every reload, not a fresh random one) — standard real-estate-platform practice, not fabrication, since the underlying resolved point is always real. A listing with genuinely nothing to go on renders no pin at all, never a made-up coordinate.
- **`@googlemaps/js-api-loader` v2.x note**: the `Loader` class (commonly shown in older tutorials/AI training data) throws `"The Loader class is no longer available in this version"` — this version's real API is the functional `setOptions({ key })` + `importLibrary(name)` pair. Caught by a live browser error, not assumed from familiarity with an older version.
- **Clustering**: `@googlemaps/markerclusterer` against classic `google.maps.Marker` instances (not the newer `AdvancedMarkerElement` — that needs a Cloud Console Map ID and wasn't necessary here; `Marker` still works, just prints a deprecation warning).
- **Known environment limitation, not a code bug**: this session's sandboxed test browser has no real GPU (WebGL reports available but the renderer is unaccelerated software — `"WebKit WebGL"` with no hardware string), which makes Google's Maps JS API silently fall back to `StaticMapService.GetMapImage` (a static, non-interactive image) instead of the normal vector-tile renderer, so full interactive rendering (pan/zoom/cluster click/InfoWindow) could not be visually confirmed in that pane. What **was** confirmed directly: all 8 real listings resolve to real coordinates (`console.log` per listing — 7 geocoded, 1 via the commune-fallback fix above, 0 unresolved), `google.maps.Marker` instances are genuinely created (its deprecation warning only fires on real construction), no JS errors anywhere in the pipeline, and lint is clean. **Verify the actual interactive experience (pan/zoom/clusters/popup clicks) in a real desktop browser** — it should Just Work there; the static-image fallback is specific to unaccelerated/headless environments.

## Automated Agent Matching (live)

**The USP, and it is a push, not a pull.** Every customer request is scored
against the real agencies covering its commune and sent to the best seven on
WhatsApp *at the moment it is created* — nobody has to open a feed.

- **Trigger** — two call sites, deliberately both in the engine because it is
  the only component downstream of every intake channel AND the only one
  holding WhatsApp credentials: `routes/admin.js`'s `POST /leads` (the Espace
  Client's "Trouver pour moi" form and the agent-profile inquiry form both
  post here) and `services/openai.js`'s `executeCreateEnquiry` (the WhatsApp
  buyer assistant). Both call `dispatchLeadInBackground` — fire-and-forget,
  after the row is committed, so the customer's confirmation never waits on
  seven outbound sends and a dispatch failure can never fail the write.
- **Ranking** — `services/agentRanking.js`, in SQL against Postgres:
  commune coverage (50 pts for a `primary_communes` specialty, 20 for
  `serviced_communes`; agencies matching neither are excluded outright),
  real approved listings in that commune (≤25), listings that also fit the
  budget and bedroom count (≤15), verified WhatsApp number (10) — all
  multiplied by `packages.priority_multiplier`.
- **Adjustment + dispatch** — `services/leadDispatch.js` weights that raw
  score by responsiveness and by recent volume (both from this engine's own
  SQLite), records one `lead_matches` row **before** each send, then notifies.
- **`lead_matches` vs `lead_proposals` are NOT the same fact and must stay
  separate tables.** `lead_matches` = "we chose this agency and notified
  them" (our action, no property, no cost to them). `lead_proposals` = "the
  agency answered with THIS property" (their action, `property_id NOT NULL`,
  and the row their paid monthly quota is counted from). Merging them would
  either bill an agency for a lead they were merely shown, or force a fake
  property id onto a notification — and would make response *rate*
  unmeasurable, since it is exactly matches without a matching proposal.
- **The agent side** — `leads.matchedAgentId` is a fourth ownership signal in
  `db.listLeads`, OR'd with property_ids / assigned_agent / agent_id. Without
  it the WhatsApp alert would deep-link into a dashboard that doesn't show the
  request.
- **The pull feed is gone.** `/compte/agent/demandes`'s "Opportunités
  communes" tab, `AgentOpenLeadCard`, `listOpenLeads` in `web/lib/adminApi.js`
  and `web/lib/demandFeed.js` were all removed. `GET /admin/leads/open` still
  exists on the engine but has no consumer.
- **Meta template** — `AGENT_LEAD_MATCH_TEMPLATE` (5 body variables: agent
  name, commune, bedrooms, budget, link). **Not yet approved** — confirmed
  live: Meta returns `(#132001) Template name does not exist in the
  translation`. Until it is, every push falls back to a plain session message,
  which reaches any agency that messaged the engine in the last 24h. The
  fallback is real and works; it is not a stub.
- **Inspect it** at `/admin/matching` (volume, coverage gaps, per-agency
  response rates) and per-request on `/admin/leads/[id]`, which also carries a
  "Relancer la diffusion" button (`POST /admin/leads/:id/dispatch`, idempotent
  via `UNIQUE (lead_id, agent_id)`).

## WhatsApp Agent Onboarding (live)

`services/agentOnboarding.js`. An unregistered sender who WhatsApps a listing
gets a real account without leaving WhatsApp and **without an OTP**.

1. Listing is stored as usual; because the sender has no `agents` row, the
   normal intake reply gets a structured summary card appended plus one
   question: name and agency.
2. Their answer creates the Postgres `agents` row with
   `phone_verified_at = NOW()`, publishes the pending listing (answering IS
   the confirmation for an unregistered sender — two acknowledgements for one
   action is one too many), retroactively claims every listing they ever sent
   (`linkListingsToAgent`), and replies with a single-use magic link.
3. `/compte/agent/activer?phone=…&token=…` sets their first password.

**Why no OTP:** a WhatsApp message *from* a number is strictly stronger proof
of control than an SMS code sent *to* it, and we already hold it before we
send anything. The token protects the password, not the phone. Only its
SHA-256 is stored (`agents.activation_token_hash`), it is cleared on redemption
in the same UPDATE that sets the password (so a replay updates zero rows),
and `token_version` is bumped alongside.

The ask is capped at `MAX_ASKS` (3) per sender via `agent_onboarding` in
SQLite, so someone who never answers is not nagged on every listing.

## Scheduled Jobs

`services/scheduler.js`, started from `index.js`. This process is the only
always-on single-instance component in the system (`ecosystem.config.js` pins
it to one fork), which is why the timer lives here.

- **Weekly customer alerts** — calls `web`'s own
  `POST /api/cron/search-alerts` (Bearer `CRON_SECRET`). That endpoint had been
  correct and complete for weeks with **nothing calling it**; its own doc
  comment said so. The engine does not reimplement the sweep — a second
  definition of "a new match" would drift from the one customers see on their
  Alertes tab.
- **Idempotent across restarts** via the `job_runs` table: a run is skipped
  when one already succeeded within `MIN_GAP_MS` (6 days). A deploy landing
  inside the Monday-09:00 firing window is a no-op, not a second round of real
  WhatsApp messages. A *failed* run deliberately does not advance
  `succeeded_at`, so the next tick retries instead of skipping the week.

## Verification & Commands
- **Verification Command**: Always run `npm run verify` before declaring a backend task complete.
- **Test Coverage**: Do not touch schema fields without updating `scripts/verify-pipeline.js`.
