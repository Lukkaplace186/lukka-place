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
  - `deposit_months` / `advance_months` / `commission_months` — the three
    **separate** entry costs behind Kinshasa's "Garantie : 3 + 1 + 1" notation:
    refundable security deposit, rent paid in advance, and agency commission,
    in that order. Never sum them into `deposit_months` — that is the bug this
    split fixed ("3 + 1 + 1" was read back to agents as "Garantie : 5 mois",
    overstating the deposit by two months). "4+1" means deposit + advance, with
    commission NULL; a plain "Garantie : 3 mois" leaves the other two NULL
    (NULL = not stated, which is not the same claim as 0 = none required). Any
    total is derived at render time from the three, never stored.
    Not yet carried to Supabase: `properties` has `deposit_months` only, so
    `syncListingToPostgres` still syncs that one field (now correct) and drops
    the other two — they need an `ALTER TABLE` before the sync can include them.
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
- **Location resolution pipeline** (`lib/geocoding.js`), per the explicit product decision, in two halves — `resolveListingBase` (where a listing really is) then `placeResolvedListings` (where its pin goes). The split is load-bearing: which listings share a spot is not decidable one listing at a time, so every base point has to be known before any pin is placed.
  - **Resolving** is a cascade of real geocode queries, most specific first: (1) address + landmark reference + quartier + commune, (2) address + quartier + commune, (3) landmark reference + quartier + commune, (4) quartier + commune. It stops at the first result Google returns at genuine place precision (`location_type`/`types` inspected, not just `status === 'OK'`), so the common case still costs one call and a query that resolves to nothing simply hands over to the next. Duplicates collapse, so a listing with neither an address nor a landmark issues one query, not four.
  - **The reference is used as location text only when it reads as words** — at least one token of three or more letters, no digits inside it. That is not a contradiction of the `reference` vs `quartier` rule above: `reference` remains the listing's own field, and it is simply a fact about this data that agents fill it with a repère far more often than with a code. Every reference currently live is one — "Demiap", "Mimosas, Camp Docteur", "Birmanie Sur Macadam", "Petit Boulevard, 2ᵉ Rue Industrielle" — and in a city of unnamed streets that is the most useful token a geocoder can be given. An identifier ("LKP-2026-0091", "91", "A1") has no word in it and is left out. Note the rule is the presence of a WORD, not the absence of digits: "2ᵉ Rue Industrielle" is a street and has to survive. `scripts/geocode-listings.js` carries the same rule, deliberately duplicated (it is CommonJS, outside the app's module graph) — change one, change the other.
  - **Failing the whole cascade falls back to `KINSHASA_COMMUNE_CENTROIDS`** — real coordinates fetched live via `google.maps.Geocoder` against all 24 communes and hardcoded (not typed from memory). A listing with no structured `commune` tag also gets a real-text scan of its address/quartier for a known commune name before giving up (caught a real gap in QA — listing #226 has `commune: null` but its address literally contains "Ngiri-Ngiri"). Every commune-level pin landing on one identical point is deliberate rather than sloppy: it is exactly what lets the placement half recognise them as a group.
  - **Placing** applies the deterministic ~200-400m privacy jitter (seeded by listing id, so a pin lands on the same nearby point every reload, not a fresh random one) — standard real-estate-platform practice, not fabrication, since the underlying resolved point is always real. **Listings that resolved to the same point are fanned onto a ring instead of each picking an independent bearing.** Two independently seeded random angles can perfectly well come out a degree apart, which is one visible pin with the others hidden underneath; N evenly spaced slots cannot. Only the direction changes — the distance is the privacy blur those pins already carried — and the ring widens with group size (capped at 900m) so the commune-fallback case, which is most listings, stays legible without a pin drifting into the next commune. `lib/mapPinSpread.js`'s `spreadColocatedPins` still runs last as a screen-space safety net for two *independent* points that happen to jitter onto each other.
  - A listing with genuinely nothing to go on renders no pin at all, never a made-up coordinate.
  - **None of this is verifiable in local dev**: the browser key is HTTP-referrer-restricted and `localhost` is not on its allow-list, so the real Geocoder cannot be called at all here (`RefererNotAllowedMapError`). Every decision above is therefore a pure function that *takes* a geocoder rather than constructing one, and `web/tests/unit/geocoding.test.js` drives all of it with a fake that answers what a real one would — the cascade, the landmark rule against real live values, the commune-outline rejection, and pin separation for both a 3-listing building and a 12-listing commune fallback.
- **`@googlemaps/js-api-loader` v2.x note**: the `Loader` class (commonly shown in older tutorials/AI training data) throws `"The Loader class is no longer available in this version"` — this version's real API is the functional `setOptions({ key })` + `importLibrary(name)` pair. Caught by a live browser error, not assumed from familiarity with an older version.
- **Markers**: classic `google.maps.Marker` instances (not the newer `AdvancedMarkerElement` — that needs a Cloud Console Map ID and wasn't necessary here; `Marker` still works, just prints a deprecation warning), each rendered as a dense price tag. **There is no marker clustering** — `@googlemaps/markerclusterer` was removed on the direction change to that price-tag pattern (dd425f9), and this bullet said otherwise until now. Overlap between pins at the same location is handled by the fan described above, not by clustering.
- **Known environment limitation, not a code bug**: this session's sandboxed test browser has no real GPU (WebGL reports available but the renderer is unaccelerated software — `"WebKit WebGL"` with no hardware string), which makes Google's Maps JS API silently fall back to `StaticMapService.GetMapImage` (a static, non-interactive image) instead of the normal vector-tile renderer, so full interactive rendering (pan/zoom/cluster click/InfoWindow) could not be visually confirmed in that pane. What **was** confirmed directly: all 8 real listings resolve to real coordinates (`console.log` per listing — 7 geocoded, 1 via the commune-fallback fix above, 0 unresolved), `google.maps.Marker` instances are genuinely created (its deprecation warning only fires on real construction), no JS errors anywhere in the pipeline, and lint is clean. **Verify the actual interactive experience (pan/zoom/clusters/popup clicks) in a real desktop browser** — it should Just Work there; the static-image fallback is specific to unaccelerated/headless environments.

## Viewing-Request Notifications

`services/viewingNotifications.js`. A viewing request now actually sends
something. Before this module, **both** paths that create a `viewing_requests`
row — `routes/admin.js`'s `POST /viewing-requests` (the listing page's
"Demander une visite" form) and `services/openai.js`'s `executeRequestViewing`
(the WhatsApp buyer assistant's `request_viewing` tool) — wrote the row and
stopped. Nothing sent a message to anybody, while the listing page told the
visitor "l'agent vous répondra sur WhatsApp". Confirmed against production:
`viewing_requests` #1–#3 all held correct data and not one outbound send was
ever attempted for any of them.

- **Recipients are the listing's own agent, plus Lukka Place's desk** — never
  the seven ranked agencies `services/leadDispatch.js` pushes to. That module
  answers "who might have a property like this?"; a viewing request already
  names one specific listing, and broadcasting it to competing agencies is the
  wrong message to the wrong people. The two must not be merged.
- **The agent is resolved by `propertyRepository.getListingContactById`** — a
  new, deliberately narrow read, separate from `getPropertyById` because that
  one feeds the assistant's `get_property` tool, whose result is handed to a
  language model and can end up paraphrased to a customer; an agent's personal
  phone number has no business in that payload. Same `status = 1 AND
  approve_status = 1` gate as every other read there, and the same
  `phone_verified_at` gate as `postgres.js`'s `resolveAgentId` and
  `agentOnboarding`'s `identifySender` — an unverified number is somebody's
  claim, and messaging it would tell a stranger who is asking to visit an
  agency's properties.
- **`OPS_WHATSAPP_NUMBER`** (engine `.env`) receives a copy of every request,
  stating explicitly whether the agent was reached. It has **no default on
  purpose**: the obvious candidate, `NEXT_PUBLIC_WHATSAPP_NUMBER`, is this
  engine's own WhatsApp sender, and a WABA number cannot message itself. Unset
  means the ops copy is skipped; a request that reaches neither an agent nor
  ops logs `reached NOBODY` at error level, because that is exactly the state
  in which the visitor's "l'agent vous répondra" is silently false.
- **`VIEWING_REQUEST_TEMPLATE` is unset by default**, unlike
  `AGENT_LEAD_MATCH_TEMPLATE`/`AGENT_OTP_TEMPLATE`. Those two default to a name
  Meta has never heard of and pay a guaranteed-failing round trip on every
  send. With no template configured this goes straight to a session message.
- Fire-and-forget after the commit, same posture as `dispatchLeadInBackground`;
  never throws into its caller. Covered by `scripts/verify-pipeline.js` §20.

### Outbound WhatsApp: what actually works, and what silently doesn't

Diagnosed live 2026-09-12, against production logs and the production SQLite.
**Outbound is not broken as a channel** — `[chakra] reply sent to …` lines
prove agent-intake replies send fine. What fails, fails for three distinct
reasons, and only one of them was a code bug:

1. **Viewing requests sent nothing at all.** A code gap, fixed above.
2. **No approved Meta template exists.** `agent_auth_otp` (the signup OTP) and
   `agent_lead_match` (the agent-matching push) both return
   `(#132001) Template name does not exist in the translation`. This cannot be
   fixed in this repo — the templates live in Meta's WhatsApp Manager behind
   the Chakra account. Until they are approved, **every** outbound message
   falls back to a free-form session message.
3. **A session message only reaches somebody who messaged this business number
   in the last 24 hours.** Outside that window Chakra/Meta accept the call and
   the message never arrives. This is why a first-time registrant's OTP is a
   silent dead end (`web/lib/otpBypass.js` documents that, and
   `AUTH_OTP_BYPASS=1` is the live workaround), and why an agent who has not
   WhatsApped us recently will not receive a viewing-request notification even
   now that one is sent.

Note `POST /admin/send-whatsapp`'s "accepted by Meta" log line prints
`messageId: null` in production: Chakra does not forward Meta's
`{messages:[{id}]}` envelope, so that line confirms a 2xx and nothing more.
Do not read it as proof of delivery.

**`lead_matches` held 0 rows in production** as of this check: the agent
matching push has never fired, because every lead created so far carried no
`commune` (leads #1–#3 predate the structured fields; #4–#6 are
`listing-visit-request` rows, which correctly have none — a visit request
names a listing and must not be broadcast). `conversations`/`messages` are
also empty — the WhatsApp buyer assistant has never been routed to in
production.

**There is no web-push pipeline at all** — no service worker, no VAPID keys,
no FCM. Browser push notifications are not silent; they were never built.
WhatsApp is the only notification channel this product has.

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

## Auto-Attribution of Incoming Listings (live)

`services/agentOnboarding.js`'s `identifySender`, forked in `routes/webhook.js`
immediately after the listing row is inserted. One Postgres lookup per inbound
listing decides which of two things the intake reply says.

- **Recognised agent** (a row in `agents` whose digit-normalised `phone`
  matches the sender's `wa_id` **and** whose `phone_verified_at` is set): the
  listing is stamped with their `agents.id` and the reply greets them by name
  — "Bonjour {prénom} ! Votre bien a été reconnu et lié à votre compte." —
  with the same summary card the onboarding path shows, plus a link to
  `/compte/agent/biens`.
- **Nobody we know**: unchanged — the existing WhatsApp onboarding ask (name +
  agency, no OTP, account created in-flow). **Deliberately not replaced with a
  "go and sign up on lukkaplace.com" bounce**: sending an agent to a web form
  to retype what they already sent is strictly worse than the flow that
  already registers them without leaving WhatsApp.
- **Existing but unverified account**: neither. `identifySender` reports
  `registered: false` (so nothing is attributed to an account nobody proved
  they own), while `shouldOnboard` still sees the row and stays quiet rather
  than asking them to register a second time.

### Why the `phone_verified_at` gate is the same one twice
`identifySender`'s gate is deliberately identical to
`services/postgres.js`'s `resolveAgentId`, and the two must not drift: telling
an agent their listing is linked to their account is a promise that publishing
it will actually set `properties.agent_id`, and `resolveAgentId` refuses an
unverified account. A regression test asserts the unverified case on both
sides.

Note the consequence for **dual creation** (agent registered on the web with
the same number, then WhatsApps a listing): they are linked automatically, but
only once that number is verified. An inbound WhatsApp message is *not* treated
as self-verification here, unlike in the onboarding flow above — there the
sender creates the account, so it is theirs by construction; here the account
already exists and was created by someone else's session, so auto-verifying it
would let anyone who registered on the web with an agent's phone number collect
that agent's listings.

### `listings.agent_id` (SQLite) is a record, not the source of truth
The new column records who we recognised at intake, written by
`db.attributeListingToAgent` **after** the insert so the Postgres round trip
can never delay — or, if Postgres is down, prevent — storing the listing.
`syncListingToPostgres` still resolves attribution live at publish time, so an
account verified between intake and publication is picked up rather than frozen.
The write only ever fills a blank (`agent_id IS NULL`), so a redelivery or a
correction can never move a listing from one agent to another.

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

## wa_id validation is 7-15 digits, not 9-15

`routes/admin.js` gates `phone`/`wa_id` on `POST /admin/send-whatsapp`,
`POST /admin/send-whatsapp-template` and the leads query with
`/^\d{7,15}$/`. The 7-digit floor is E.164's real minimum (a 3-digit country
code plus a 4-digit subscriber number), not a typo for the old 9.

It was widened when `web/` opened signup to every country (see
`web/CLAUDE.md`, "Phone numbers are international now"): the old floor
rejected a legitimate short international number outright, and the person
signing up saw "we couldn't send you a code" for a number that was perfectly
valid. `web/lib/phone.js` applies the same 7..15 range, so the two layers
agree; changing one without the other reintroduces the gap.

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
