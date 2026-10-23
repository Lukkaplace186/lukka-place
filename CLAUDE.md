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
- Every public listings query must include the filter above. The query-time filter is the only thing keeping pending/unapproved listings off the storefront: the engine and web both connect as `postgres`, which owns the tables and has BYPASSRLS, so no RLS policy can ever filter their reads.
- **What RLS does do here: it shuts PostgREST.** `properties` and `agents` have RLS ON with no policy, and since `migrations/20261015_rls_lockdown.sql` so do the fourteen tables that were open to the public anon key with full grants (`customers` with its password hashes, `customer_favorites`, `customer_saved_searches`, `page_views`, `whatsapp_clicks`, `listing_events`, `agent_performance_logs`, `bot_locks`, `bot_sessions`, `exchange_rates`, both `footer_*_links`, `plan_change_requests`, `saved_search_notifications`); anon/authenticated privileges on them and their sequences are revoked. Nothing in this system uses the anon key (supabase-js is Storage-only, with the service_role key), so no policy is needed.
- **New tables start closed.** The same migration removed anon/authenticated from `postgres`'s default privileges in `public` (tables and sequences). A new migration no longer needs its own `REVOKE ALL … FROM anon, authenticated`, but keeping one is harmless and still protects a table created by `supabase_admin` (the dashboard), whose defaults `postgres` cannot change. If the app is ever moved to a login role without BYPASSRLS that does not own these tables, every one of them returns zero rows until policies exist.

## Data Schema & Location Hierarchy
- **Location Normalization**: NEVER hardcode or invent locations. ALWAYS resolve Communes and Quartiers against `kinshasa_locations.json` using `services/locations.js` (`resolveCommune`, `resolveQuartier`, `quartiersForCommune`, `cascadeCommuneChange`).
  - **Commune from the quartier (2026-10-07).** `kinshasa_locations.json` holds the official quartiers (checked against the communes' Wikipedia pages); `kinshasa_quartier_aliases.json` holds the names agents write that are not official ("GB" → Ngaliema, owner-confirmed; Mimosas, Righini, Synkin, Matonge…), each with a declared source. `inferCommune` / `inferListingLocation`: a name in ONE commune deduces it, stored as `parsed_json.commune_inferred_from` and shown on the intake card as "déduite de « … »" for the agent's OK to confirm; a name in SEVERAL (Salongo, Funa, Saïo, 24 Novembre…) is never guessed, and the card asks "« Funa » existe à Barumbu et à Limete. Dans quelle commune ?". A bare commune name as the reply (`communeNamedIn`, exact only) fills the draft. The extraction prompt tells the model not to deduce the commune itself.
  - **No citywide typo match.** With no commune, `resolveQuartier` used a 30% edit-distance match over every quartier and STORED the result ("Wangata" → Mangana, "tonde" → Konde). It now only canonicalises an exact (accent/numeral-folded) official name; typos need the same first letter, 1 edit (2 from 9 letters) and a single best candidate. Ordinary words that are also quartiers (École, Gare, Kasaï…) only count as the whole text.
  - **Adding an alias**: one commune needs a source (it produces a guess); adding a commune to an existing name is always safe (it only produces a question). Measured on every place agents had typed (2026-10-07): 10 deduced, 9/9 agreeing with the commune the agent tagged, 0 wrong; 12 asked. §47.
  - **web/lib/data/kinshasa-gazetteer.json must contain every official quartier and alias** (`web/tests/unit/places-sync.test.js`), except commune-level names (Binza, Bandal) which stay communes in search. Cité-Verte is Selembao, not Mont-Ngafula.
- **Property Classifications**: Support "Parcelle" (with sub-types: "Maison Type Locataire", "Villa", "Terrain Nu" — see `services/openai.js`'s `PARCELLE_SUBTYPES`) and "Appartement". A listing is only "Appartement" if it explicitly describes a unit within a multi-story building — plot dimensions, a gated compound, or "Type Locataire"/"Portes" language means "Parcelle", never "Appartement".
  Commercial space (bureau, boutique, entrepot, immeuble) is classified by its
  own rules — see "Commercial spaces" below; a "bureau" named as a room of a
  house never makes it commercial.
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
  - `features` (array) — the storefront's "Caractéristiques principales"
    bullets, extracted from the agent's own message. **Not a synonym for
    `amenities`, and the two must not be merged.** `amenities` is a flat
    equipment vocabulary used for matching and for the WhatsApp summary
    card; `features` is reader-facing prose for the public listing page and
    can carry a fact no equipment word covers ("eau et électricité 24h/24").
    The extraction prompt forbids repeating anything the page already states
    as structured data — price, garantie, chambres, commune, reference — and
    forbids inventing one to fill the section: `[]` is a correct answer.
    JSON text in SQLite, real `text[]` on `properties`
    (`scripts/migrate-listing-features.js` adds the column). Existing rows
    were backfilled by `scripts/backfill-listing-features.js`, which re-runs
    `parseMessage` over each listing's stored `raw_text` — the same POINTS
    FORTS rules as new intake, so there is one definition of a feature, not
    two — and writes SQLite **and** Postgres, because a Postgres-only write
    is nulled by the next `syncListingToPostgres`. Do not "simplify" it into
    a regex over the raw text: that was tried, measured at ~60–75% precise
    on the real corpus, and is why `migrate-listing-features.js`'s own
    line-filter backfill has never been run. `web/lib/descriptionParser.js`
    is the read side: real column first, then the AMENITY_KEYWORDS pass over
    the listing's text, then its own description lines, and the UI captions
    which of the three it used.
    **The prompt must not carry pasteable example phrases.** An earlier
    POINTS FORTS example, "Climatisation dans les chambres", was copied
    verbatim onto a listing whose message said only "2 climatiseurs" —
    inventing where the air conditioning is. The rule now is: keep the
    agent's own words, correct spelling, never add a detail.
- **Landmarks**: Always use the French term "référence" (not "repère") in any user-facing or prompt-facing French text.

## Lead Routing Rules

**Dual contact policy.** A listing detail page offers two different things on
purpose, and they route differently:

- **Direct contact is open and visible — for a verified agent.** The listing
  agent's real phone number is shown as both a `tel:` link ("Appeler l'agent")
  and a direct `wa.me` link, on desktop (`EnquiryCard`), mobile
  (`MobileListingBar`) and cards (`WhatsAppCTA`) alike, all through one rule:
  `web/lib/leadRouting.js`'s `resolveWhatsAppRouting`. In Kinshasa a listing
  with no reachable human behind it reads as a scam; showing the agency's own
  number is what makes the listing credible. **The number only reaches the
  page when `agents.phone_verified_at` is set AND
  `agents.direct_routing_enabled` is not false** — `web/lib/listings.js`
  nulls `agent_phone` otherwise, in SQL, and every CTA falls back to Lukka
  Place's central number (the `tel:` link renders not at all). Before this an
  unverified number was published as readily as a proven one. The engine's
  `propertyRepository.directRoutingBlocker` is the same three conditions for
  WhatsApp alerts; change one, change the other.
- **"Demander une visite" is the automated pipeline.** It never opens a chat
  client. It creates a real `leads` row plus a real `viewing_requests` row and
  dispatches over WhatsApp from the engine — see "Viewing-Request
  Notifications" below for who gets told, and the agent feedback loop for what
  happens next. This is the path that produces a tracked, measurable request;
  the direct buttons deliberately produce nothing we can see, which is the
  trade being made.

This supersedes the earlier rule that every "Contact on WhatsApp" button must
use the central number and never a per-listing agent number. That rule
described a state where no per-listing contact existed; `properties.agent_id`
now resolves to a real `agents.phone` for attributed listings.

**The mobile/desktop split is reconciled.** `MobileListingBar` used to route
to the central number while `EnquiryCard` routed to the agent, so one listing
offered two contacts depending on screen width. Both now use
`resolveWhatsAppRouting`. See "Direct-to-Agent Routing, Price Capture &
Agent Performance" below.

- **Message Format** (both direct buttons — `web/lib/whatsapp.js`'s
  `buildWhatsAppMessage`):
  ```
  Bonjour, je vous contacte via Lukka Place au sujet de ce bien :
  {property_type} à {quartier}, {commune} — {price}
  Réf. {reference}

  Est-il toujours disponible ? Si oui, quand serait-il possible de le visiter ?

  https://lukkaplace.com/listings/{id}
  ```
  - **Place is always "quartier, commune"** (product rule, 2026-10-07): this
    message, the site cards (`feedLocationLine`), the share card and caption,
    the agent intake card (Quartier line above Commune) and every engine alert
    ("🗺️ Lieu : Industriel, Limete"). One helper per side — web
    `lib/placeLabel.js`, engine `services/locations.js` `placeLabel` — which
    also prints a quartier that only repeats its commune once.
  - The `Réf.` line appears **only when `properties.reference` is set**. No
    fallback: the old slug fallback put
    "Ref: 2-chambres-appartement-a-louer-a-limete-286" in front of agents, and
    a made-up "LUK-{id}" would be an id dressed up as a reference, which
    `KeyFacts.js` refuses. The link already identifies the listing.
  - Each fact is stated once. WhatsApp unfurls the link into a card that
    already shows the title, so the old parenthetical repeated it.
  - `{price}` is `formatPrice(price, purpose, price_period)`: no "/ mois" on a
    sale, "/ an" on a yearly rent. Empty parts are dropped along with their
    separator.
  - The link stays last. `services/listingEnquiry.js` recognises the message
    by that link alone, and still parses the older "Ref: … Voir l'annonce :"
    wording from links already sitting in chats.

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
- **Viewport fetching (Rightmove/Zillow model) — `/listings` only.** The map no longer plots the list page's 12 cards. `components/ListingsMap.js` asks `GET /api/listings/map` (`web/lib/listings.js` `getMapMarkers`) for every approved listing matching the URL's filters inside the padded viewport, re-asking on `idle` (350ms debounce, in-flight request aborted, no request at all while the view stays inside the last padded box). Lightweight markers only; the preview card fetches the full listing through `/api/listings?ids=` when a pin is tapped.
  - **Location filters give way to the viewport.** With a box, `commune`/`quartier`/`radius` are dropped and every other filter still applies — so "2 chambres à Bandal" opens ON Bandal and panning out loads more 2-bedroom listings beyond it. A named place opens as a centre at a fixed zoom (`targetView`: the commune's geocoded point at 14, the quartier's at 15 when it lies within 5 km of its commune, else the verified centroid), **never a fit to Google's viewport for the place** — Limete's reaches into the river, and fitting it opened a phone on Brazzaville so the search looked dropped even though `commune=Limete` was in the URL (both list/map toggles copy the whole query string). A search naming no place opens on the Kinshasa core (`KINSHASA_DEFAULT_VIEW`, -4.325/15.312, zoom 13; 12.5 is not possible on the styled raster map) — not a fit to the listings' extent, which on a portrait phone zoomed out until Brazzaville filled the screen. `?extent=1` is only the fallback when a named place cannot be geocoded, and its box ignores coordinates outside a Kinshasa-province envelope. A non-location filter change keeps the view.
  - **A search never empties the map** (2026-09-24). A picked landmark ("St Luc", Ngaliema) is `?near=`, a place the map opens on (`targetView`, same ≤5 km sanity rule as a quartier), never `q` — as `q` it was a text filter no listing matched, so the map opened on Ngaliema with zero pins. A text `q` that leaves the view empty: matches elsewhere → the map fits their extent; matches nowhere → `q` is dropped from the URL (`router.replace`) with a banner "Aucun bien ne correspond à « … » — voici les biens à proximité". The search box × (or an empty Enter) removes q / near / commune / communes / quartier / radius / reference and the map area — the whole city returns; other filters stay. Suggestions close on any outside `pointerdown` (capture: Google's map swallows mouse events on touch) and when the text is deleted.
  - **Flights, cards, sheet, landmarks** (2026-09-24). A new place while the map is open flies there (`web/lib/mapFly.js`: step out until both ends fit, never past zoom 11, `panTo`, step in — the raster renderer cannot animate `moveCamera`; reduced motion jumps). On a phone a pin opens `MapCardCarousel` (swipeable cards of the listings in view, west to east, a snapshot so cards never reorder; a settled card lights and reveals its pin); desktop keeps `MapListingPreview`. The phone map is full screen, never split with a list (the half-height list sheet was tried and removed the same day, on product direction): the search floats over it (`MobileMapChrome`), and two floating pills (`MobileMapBar`, no white panel, the map runs edge to edge under them) hold "Voir N biens" (live count of the visible area; tap or swipe up → the swipeable cards) and "Liste" (the full list, carrying the map area). Pills and cards float `bottom-8`, above Google's logo/attribution line, which must stay visible; "Autour de moi" sits above the pills. Motion: new pins drop in staggered (`--lkp-delay`), a pin that becomes active hops, counts roll to their new value (`lib/useCountUp.js`), and a saved listing's heart flies to the header account icon (`lib/flyToAccount.js`, `data-fly-target="account"`). Dimming the pills while the map moves and a pulsing ring where a flight lands were tried and removed the same day, on product direction. All of it is off under reduced motion. Landmarks have verified points (`web/lib/data/landmark-points.json`, 106/151, built by `scripts/geocode-landmarks.js` on the VPS + `web/scripts/build-landmark-points.mjs`, ≤5 km from their commune): `near` is a 3 km radius around the landmark (ladder widens it) and cards say "à 1,2 km de UPN" from the listing's own point only. The parser turns a landmark into `near`; the gazetteer indexes St/Saint, RP/Rond-Point, Bd, Av aliases; Enter on unplaced text ("St lu") lands on the dropdown's first gazetteer match.
  - **The list pane is unchanged** — still paginated on the full filters, location included.
  - **Positions**: stored coordinates, else the commune centroid (flagged `approximate`), else no pin and counted `unlocated` — never a made-up point. `/listings` no longer geocodes listings in the browser at all; `PropertyMap`'s client cascade above now serves only the detail page. One compact pill states listings in view; its ⓘ button opens the breakdown (on a centroid, matching but unplaceable, truncated) rather than stacking three pills over a phone-sized map.
  - **Index**: `migrations/20260916_properties_geo_index.sql`, a partial expression index on `LAT_EXPR`/`LNG_EXPR` (`latitude`/`longitude` are TEXT, so a raw-column composite could not serve a numeric range). The planner needs the identical expression — `web/tests/unit/map-viewport.test.js` compares the two texts.
- **Publish-time geocoding** (`services/geocoding.js`): after COMMIT, `syncListingToPostgres` fills blank `latitude`/`longitude` with the same landmark rule and precision check as the client cascade (a commune outline is refused, a key/quota refusal throws rather than cascading). Needs `GOOGLE_MAPS_SERVER_KEY` (IP-restricted; requests go out over IPv4 because the VPS is dual-stack). Never overwrites an existing coordinate; a correction that changes quartier, commune tag or landmark reference clears the old one first. Backfill: `node scripts/backfill-listing-coordinates.js [--write]`. §30 of verify-pipeline.
- **Markers** (2026-09-23, "sleek map" pass): on `/listings`, HTML speech-bubble pills drawn by one `google.maps.OverlayView` (`web/lib/mapPinLayer.js`, styles `.lkp-pin` in `app/globals.css`) — the site font, CSS transitions, no Map ID, and off the deprecated `google.maps.Marker`. White with charcoal text and a stem whose tip is the coordinate; the active one (hovered card / open preview) royal blue; listings this browser opened (`lib/recentlyViewed.js`) or tapped greyed; `verified_at` a small check. **Every listing always shows its price**: no clustering, and the overlap-to-dot collapse tried the same day was removed on product direction ("the blue dots … I don't understand it"). Labels are the map's own format, `$750` / `$1.5k` / `$185k` / `$1.2M` (`compactPrice`), no "/m", "/an" kept for yearly rents. The detail page (2026-09-28) loads by itself near the viewport (Data Saver keeps the tap) and shows the one listing: with stored coordinates `ListingPinMap` at zoom 14, Rightmove-style: a round navy point with a type symbol (`lib/listingPin.js`), a pulse, the commune under it and a 500 m approximate-zone disc, no price — a comparison with nearby similar listings was tried and reverted the same day; without coordinates `PropertyMap`'s SVG `google.maps.Marker` tags (`lib/mapIcons.js`), same white/blue. Also: `cameraControl` off, "Autour de moi" (geolocation on tap, refused outside `KINSHASA_PROVINCE_ENVELOPE`), a 60s per-tab cache of marker answers, and the top pill is text only (no ⓘ) and hidden on a phone once settled — "Voir N biens" carries the count. Stacking: active on top, then higher price in front. Co-located pins are separated by the fan described above.
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

### The agent feedback loop — Accept / Autre créneau / Décliner

The alert carries three tappable reply buttons, and what the agent does with
them drives the rest. `services/viewingNotifications.js` owns the whole loop;
`routes/webhook.js` only routes into it.

- **Outbound** — `chakra.sendInteractiveButtons` (Meta's `interactive`/`button`
  payload, passed through Chakra like every other payload). Button ids are
  `viewing_accept:<id>` / `viewing_reschedule:<id>` / `viewing_decline:<id>`:
  the request id is **embedded in the id**, not inferred from "the most recent
  request from this agent", so an agent holding two open requests can answer
  the older one and a tap arriving a day late still resolves correctly.
- **Whether buttons actually arrive is not something this repo can assert.**
  Chakra is a pass-through and Meta accepts the payload, but this account's
  plan may or may not forward interactive messages. So `send()` catches a
  failed interactive send and falls back to the same text with a numbered
  menu, and **every handler accepts a typed `1`/`2`/`3` exactly as it accepts
  a tap**. The numbered path claims the agent's next message via
  `pending_agent_actions` (kind `VIEWING_RESPONSE`), because a typed "1"
  carries no request id.
- **Inbound** — `normaliseMessage` now extracts `interactive.button_reply`,
  `interactive.list_reply` and the older `button` shape into `replyId`, and
  `isUsable` accepts a message that has only that. Before this, a tap arrived
  with no text and no media, matched no `UNSUPPORTED_MESSAGE_TYPES` entry, and
  was **dropped in silence** — exactly how a feedback loop appears to work
  while doing nothing.
- **Authorisation is not optional.** `viewing_accept:3` is a guessable string.
  Every handler re-resolves the listing's real agent from Postgres and refuses
  a sender who isn't them; the refusal is silent to the sender, since
  answering "that belongs to someone else" confirms the id is real. A listing
  with no attributed agent is authorised for nobody.
- **Ordering in `routes/webhook.js`** — a tap is handled *first*, before the
  dedupe and before any billable work, and specifically before the
  pending-draft branch: an agent holding an unconfirmed listing who taps
  "✅ Accepter" would otherwise have the button's label read as a correction.
  A *typed* answer is handled later, after the draft-confirmation branch, so
  an `OK` on a pending listing still wins.
- **Anything that is not a plausible answer returns `handled: false`** and
  falls through to ordinary processing — the same posture the sale-price
  follow-up already takes. This is what stops a real property advert being
  swallowed because a questionnaire happened to be open, and it is tested
  end-to-end (§21: a listing sent mid-survey is still stored as a listing).

#### Answering from the web dashboard — same loop, same messages

`respondFromDashboard` in `services/viewingNotifications.js`, behind
`POST /admin/viewing-requests/:id/agent-response`, called by `web/`'s
`updateViewingRequestAction`. The agent portal's Visites tab used to `PATCH`
the status and stop. Reported 2026-09-15: an agent confirmed four visits and no
customer heard anything, while `first_response_at` stayed NULL, so every
response metric said the agent had never answered.

- **Same customer texts as the WhatsApp buttons** (`tenantAcceptedText`,
  `tenantRescheduleText`, `sendAlternativesToTenant`), and none of the messages
  addressed to the agent's own phone — they answered on the web.
- **Transitions are a table, enforced twice**: `DASHBOARD_TRANSITIONS` here,
  `web/lib/viewingActions.js` for which buttons exist. Confirm only from
  PENDING / RESCHEDULED. A refusal before agreement is DECLINED (alternatives to
  the customer, ops told); after agreement it is CANCELLED (customer and ops
  told, no alternatives). Repeating the current status sends nothing, so a
  double tap cannot message a customer twice.
- **Authorised by `agents.id`**, not phone, since that is what the dashboard
  session knows: the assigned agent once `reassigned_at` is set, otherwise the
  listing's agent or the `agent_id` stamped at notify time (which keeps this
  working while Postgres is unreachable).
- **Clears any WhatsApp question still open about that request**
  (`db.clearPendingAgentActionsForViewing`), so a later typed "1" cannot
  re-answer it with a contradictory message.
- **A reschedule to a phrase with no instant clears `scheduled_at`**, so a later
  confirmation cannot check in against the old slot.
- **A confirmation carries the agent's picked `scheduled_at`** (2026-09-22;
  `visitSchedule.resolveScheduledAtInput`, shared with the admin PATCH): a day
  with no hour → `scheduled-at-invalid`, a past instant → `scheduled-at-past`,
  both before anything is written or sent. Stored UTC `Z`; the customer is
  told that time. Without one, the customer's parseable phrase still pins it.
  `GET /viewing-requests` (owner list) now returns `scheduled_at`, the
  response stamps and `requested_slot_at` (the phrase parsed against the
  row's `created_at`). web/CLAUDE.md, "À faire aujourd'hui".
- **CANCELLED is never written to `agent_performance_logs.outcome_status`** —
  that column's CHECK has no CANCELLED, and the response was timed at the
  confirmation.
- **`PATCH /viewing-requests/:id` is unchanged**: it is the admin override and
  still tells nobody (`/admin/viewings`' Annuler uses it).
- **What `/admin/viewings` now shows**, stamped from both channels:
  `viewing_requests.agent_response_via` (WHATSAPP | DASHBOARD, with the first
  response time) and `customer_notified_at` — Chakra ACCEPTED the customer
  message, not delivery. The session-window rule under "What still gates
  delivery" still decides whether a customer who came in through the web form
  actually receives it. Covered by `scripts/verify-pipeline.js` §21b.

#### Status vocabulary — reused, not forked
The three buttons map onto the states the agent dashboard's Visit Scheduler
already renders:

| Button | `viewing_requests.status` |
|---|---|
| ✅ Accepter | `CONFIRMED` — the state its own Confirm action sets |
| 🕒 Autre créneau | `RESCHEDULED` — the state its Reprogrammer sets |
| ❌ Décliner | `DECLINED` — **new**; nothing could reach it before |

`DECLINED` is deliberately not a synonym for `CANCELLED`. Cancelled means the
visit was called off after being agreed; declined means the agent refused it
outright, and only the second should pull the customer into the alternatives
recovery path. Collapsing them would make agent response rate unmeasurable —
the same reason `lead_matches` and `lead_proposals` stay separate tables.

#### The decline survey, and where the closing price really goes
Declining sets `DECLINED`, sends the agent the three-option survey, **and at
the same time** sends the customer three real alternatives from
`propertyMatching` (never the listing just declined; an honest "nous n'avons
pas d'équivalent" when there are none, never an empty list). The customer
should not wait on the agent filling in a questionnaire to learn this visit
isn't happening.

Answering **1 (déjà loué/vendu)** retires the listing and asks what it closed
at. **This reuses the existing transaction record rather than creating a new
one**, and that is a deliberate departure from the original spec, which asked
for a `closed_transactions` table and a `closed_unverified`/`pending_delist`
status:

- `postgres.markPropertyUnderOffer` → `listing_status = 'under_offer'`
  immediately (off the market, no figure needed, honest about what we know).
- the price answer → `postgres.markPropertySold` →
  `listing_status = 'closed'`, `sold_price`, `sold_at`, `status = 0`.

That pair is already live, already what `web/`'s `markListingSoldAction` and
the WhatsApp status flow in `routes/webhook.js` both write, and already what
the institutional market export (asking vs achieved) is built on. A second
table and a second status vocabulary would have split the same fact across two
places and drifted. `'closed'` is never reached without a real `sold_price`
for that exact reason — an agent who answers *passer* leaves it at
`under_offer`, and no price is invented.

Ops is notified on every decline (`OPS_WHATSAPP_NUMBER`), told the reason, and
told explicitly when a property needs verifying and archiving.

#### Two write paths that could undo all of it

The decline → `under_offer` → `closed` chain was correct; two neighbouring
writes could silently reverse it, and both are now guarded.

- **`markPropertyAvailable` NULLed `sold_price` and `sold_at` unconditionally.**
  An agent replying "finalement c'est encore libre" on an already-closed
  listing erased the achieved-vs-asking pair that the market export's entire
  commercial value rests on, and which exists nowhere else. It now carries the
  same `listing_status IS DISTINCT FROM 'closed'` guard its sibling has, so
  reopening a closed listing is a deliberate act from the dashboard by someone
  who can see the figure they are discarding. `web/`'s own equivalent already
  refused this; the WhatsApp path was the way round it.
- **`syncListingToPostgres` rewrote `status = 1` on every sync**, and a
  correction to a published listing re-syncs (`resyncListing`). On a row
  `markPropertySold` had set to `status = 0`, that republished a sold listing
  while `listing_status` still said `'closed'` — the two axes disagreeing,
  which `web/CLAUDE.md` names as the bug that keeps recurring. The UPDATE path
  now reads the row's real `listing_status` **inside the transaction** and
  drops `status` from the update when it is `'closed'` or `'under_offer'`.
- **Both guards use `IS DISTINCT FROM`, not `<>`.** `listing_status` is NULL on
  rows predating the column (`dataExport.js` COALESCEs it for that reason), and
  `NULL <> 'closed'` is NULL rather than true — so a plain `<>` refused to
  retire every legacy listing, which is precisely the set an agent is most
  likely to report as already let.

#### What still gates delivery
Unchanged and worth repeating: interactive messages are **session messages**.
An agent who has not messaged this number in the last 24h receives neither the
buttons nor the numbered fallback, and no template is approved. The same is
true of every customer-facing message in this loop — a customer who reached us
through the web form has never messaged the business number, so the
confirmation, the reschedule proposal and the alternatives will not reach them
until a template exists. The loop is real and complete; Meta decides whether
it lands.

#### Storefront
No change was needed for "keep contact info fully open": `EnquiryCard`
already renders the listing agent's real number as both a `tel:` link and a
direct WhatsApp link, falling back to the central number only when the
listing has no attributed agent. That is the direct half of the dual contact
policy — see "Lead Routing Rules" above, which this loop is the other half of.

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

#### Template-first, and what that now actually means

**`chakra.sendTemplate` can carry quick-reply buttons.** This was the blocker
under the whole feedback loop: `sendInteractiveButtons` is a **session**
message type, so every tappable button in this product silently stops existing
for anyone outside the 24h window. A template is the only way to put buttons in
front of a cold contact, and `sendTemplate` now emits
`components: [{ type: 'button', sub_type: 'quick_reply', index, parameters: [{ type: 'payload', payload }] }]`.
Only the payload travels — labels are fixed in the approved template — and it
comes back as `interactive.button_reply.id`, the same field the interactive
path produces, so `parseViewingButtonId` needed no change. `index` must match
the order the template declares its buttons in. `otpCode` and `buttons` cannot
be combined: an AUTHENTICATION template's copy-code button already claims
index 0.

**Every template name now defaults to `null`.** `AGENT_LEAD_MATCH_TEMPLATE`
and `AGENT_OTP_TEMPLATE` used to default to `'agent_lead_match'` and
`'agent_auth_otp'` — names Meta has never heard of — so every send paid a
guaranteed-failing round trip (seven per lead dispatch) before falling back to
the session message that was always going to be what actually sent. Worse, that
failure was indistinguishable in the logs from an APPROVED template failing to
deliver. `chakra.templateConfigured(name)` is what callers use to tell "no
template configured" (expected during launch, quiet) from "template send
failed" (real, logged). `VIEWING_REQUEST_TEMPLATE` had made this choice
already; the other two have caught up.

**`OPS_WHATSAPP_NUMBER` is read at call time**, not module load, so ops can be
pointed at a different handset without `pm2 restart --update-env` — the same
shape as `web/lib/otpBypass.js`'s `otpBypassEnabled()`. It is still unset by
default, deliberately, and `index.js` now **warns at boot** when it is missing:
previously an unset ops number announced itself only at the moment a request
ALSO failed to reach an agent, so a healthy-looking deployment could be
dropping every desk copy in silence.

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

## Listing Enquiries from the Storefront's WhatsApp CTA

`services/listingEnquiry.js`. The other half of the dual contact policy: what
happens when somebody actually taps "Contacter sur WhatsApp" on a listing
page.

**The loop this closed.** The storefront pre-types the message
(`web/lib/whatsapp.js`'s `buildWhatsAppMessage`), so what arrives is:

```
Bonjour, je vous contacte via Lukka Place au sujet de ce bien :
Appartement à Limete — 1 100 $ / mois
Réf. Petit Boulevard, 2ᵉ Rue Industrielle

Est-il toujours disponible ? Si oui, quand serait-il possible de le visiter ?

https://lukkaplace.com/listings/293
```

(The loop below was diagnosed on the earlier "je suis intéressé par l'annonce
Ref: … Voir l'annonce : …" wording; recognition keys on the link, so both
parse.)

That reached gpt-4o as `is_listing: false`, `intent: 'question'`, matched no
branch, and came back — verbatim from a real production transcript — as
*« Pour vérifier la disponibilité, veuillez consulter directement l'annonce
sur notre site ou contacter l'agent responsable via le lien fourni. »*, sent
to somebody who had been on that page thirty seconds earlier and arrived
through that exact link. Nobody at Lukka Place was told the enquiry existed,
so nothing downstream was going to break the loop either.

- **Deterministic, and ahead of the model.** We wrote the message, so its
  shape is known and the listing id is in our own URL. The branch sits in
  `routes/webhook.js` beside the quick replies — before the media download
  and before `parseMessage` — and costs no extraction call at all
  (`scripts/verify-pipeline.js` §22 asserts the model is never called).
  The match is **host-anchored** (`lukkaplace.com`, plus localhost for QA):
  an agent pasting a competitor's `/listings/…` link is not a customer
  enquiry. Only numeric ids are accepted — every link the storefront emits
  uses one, and a slug cannot be told from a path segment without a query.
- **Three guards, same posture as every other interception here**: no
  `pending` draft, no media (a message with photos is a listing submission
  in this pipeline, and the enquiry message never carries any), and a
  listing that does not resolve live under `status = 1 AND approve_status = 1`
  returns `handled: false` and falls **through** to ordinary processing.
  Tested: a property advert that happens to quote a listing URL is still
  stored as a listing.
- **The reply is written from what actually happened.** It promises
  *"un de nos agents partenaires … vous recontactera très rapidement"*
  only when this module genuinely reached a human — the listing's own
  phone-verified agent (same `phone_verified_at` gate as `resolveAgentId`
  and `identifySender`), or `OPS_WHATSAPP_NUMBER`. When it reached nobody it
  says so and points at the listing's own contact details instead. A
  promised callback nobody has been asked to make is the same failure as the
  circular reply, one step later.
- **Recipients are the listing's agent plus the desk — never
  `services/leadDispatch.js`'s seven ranked agencies.** Same separation
  `viewingNotifications.js` documents: this enquiry names one specific
  listing, and broadcasting it to competitors is the wrong message to the
  wrong people.
- **It is recorded**, as a `leads` row with `source: 'listing-whatsapp-enquiry'`
  — distinct from `'listing-visit-request'` (the "Demander une visite" form)
  so the WhatsApp CTA's real conversion stays measurable — plus a
  `conversations` row with `selected_property_id` set, reusing an existing
  thread rather than forking one.
- Unchanged and still binding: these are **session messages**. A customer
  who has just messaged us is inside the 24h window, so the reply lands; the
  *agent* alert only lands if that agent has messaged this number recently.
  See "Outbound WhatsApp: what actually works" below.

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
A COMPLETED session whose `agents` row no longer exists (deleted from the
console) is cleared and the sender is asked again (2026-10-19); a
soft-deleted row still counts as an account and is never re-created. §52.

**A failed extraction is answered** (2026-10-19): when `parseMessage` throws
(rate limit, exhausted credit, timeout) `processGroup` sends
`EXTRACTION_FAILED_REPLY` ("merci de le renvoyer dans quelques minutes")
instead of leaving the agent on the "Message reçu, un instant…" ack. Nothing
is stored; a conversation under human handoff stays silent. §52.

**Launch replies** (2026-10-20, `services/quickReplies.js`, same guards as the
greeting: no draft pending, no media, not mid-onboarding, no buyer thread;
every open question — visit answers, price confirmation, availability — is
handled before it). A passive acknowledgment ("d'accord", "ok merci", 👍)
gets **no reply** and no model call. A signup question ("comment se passe
l'inscription", "c'est gratuit ?") gets `SIGNUP_REPLY` (two ways to join, the
signup link, "2 mois gratuits" as the owner stated, support +243 846 962 654)
— never when it names a property, a price or "je cherche". A message the
model judges not a listing, with nothing pending, gets the fixed
`FALLBACK_REPLY` instead of the model's prose, at most once per sender per
30 min (in memory). Listing, draft, correction and "OK" flows are unchanged. §55.

**Publish receipt and photos per property** (2026-10-20). The reply to "OK"
names every listing it created ("✅ *3 annonces bien reçues et en cours de
modération !*", then "1. Appartement à Kintambo — 500 $ / mois",
`listingCard.listingSummaryLine`). In a paste of several UNRELATED properties
(is_multi_property) each listing gets the photos sent with its own text:
`processGroup` tags every photo with its block (a message with text opens one),
stored as `parsed_json.photo_blocks`, and `db.photosByProperty` splits only
when blocks and properties line up exactly; otherwise every listing keeps every
photo, as a building's units always do. §59. The web admin's agent page edits
the person's first/last name (`updateAgentIdentity`); the phone stays locked.

### A new listing is never a correction (2026-10-21)

Measured on 2026-10-20: an agent posting listing after listing had complete
properties (8 photos, a price) returned `is_listing: false` by the model in
correction mode and merged into the previous draft, one into their NAME at
onboarding. `services/listingBoundary.js` decides from THIS burst's own text
(never the extraction, which in correction mode is the merged draft):

- names a kind of property (or offer wording) AND states a price, and is
  not worded as an edit ("pas X mais Y", "au lieu de", a leading "non"…);
- with photos → a new listing, unless every core fact it states matches the
  listing in context (the same property re-sent);
- without photos → a new listing when the model said intent `listing`, the
  text is ≥ 80 characters and price, kind of property or commune differs.
  With nothing in context (only the name question open), `listing` suffices.

A promoted burst is re-read WITHOUT the draft (one extra model call, only
then) and stored as its own row. Short edits name no property or no price,
so "non 1100$" still corrects. `completeOnboarding` also refuses a reply that
stands alone as a listing (`looks-like-listing`). This applies to everyone:
it replaces the literal "a changed price/commune/type is a new listing" ask,
which would have turned "non c'est 1100$" into a second listing. §61.

**Drafts nobody confirms reach moderation** (`services/draftAutoSubmit.js`,
job `draft-auto-submit`): a `pending_confirmation` draft with ≥1 photo is
published (into the approval queue, `approve_status = 0`) after
`DRAFT_AUTO_SUBMIT_HOURS` (default 3, `off` disables), stamped
`parsed_json.auto_submitted_at`, nothing sent to the agent. Same quota check
as "OK"; a full plan leaves it pending and re-asks a day later. A draft with
no photo stays pending (the photo rule holds on every publish path). §61.

### Listings from WhatsApp groups — relay and reader (2026-10-21)

**The Cloud API never delivers group messages**, not even for the business
number while it sits in brokers' groups through the WhatsApp Business app
(measured: 607 inbound messages in the log, none from a group). Most Kinshasa
listings are posted in admin-only groups, so a second number — a dedicated
SIM, a plain WhatsApp member of those groups, NEVER the business number —
brings them in. `services/groupRelay.js` is the one path for both ways in:

- **Relay** (`RELAY_NUMBERS`, read at call time): staff forward group posts
  from that SIM to the intake number. `routes/webhook.js` hands the burst to
  `handleRelayBurst` after the dedupe and BEFORE the pending-draft branch.
  `splitBurst`: each text message opens a post, a photo joins the post it
  follows, photos before any text join the first post, a lone "Agent :
  0812…" line names the poster of the posts after it.
- **Reader** (`group-reader/`, a Baileys linked device of the same SIM,
  unofficial: the SIM can be banned): `POST /internal/group-posts`
  (requireApiKey; `{groupJid, groupName, posterPhone, posterName, text,
  photos: ['/uploads/listings/…'], wamids}`), 503 when extraction fails so it
  retries. Sends nothing. `GROUP_READER_ENABLED` turns on the
  `group-reader:silent` ops alert (`GROUP_READER_SILENCE_HOURS`, 12).
- **Each post** is read alone (`parseMessage`, never with a draft), stored as
  its own listing with `parsed_json.source = 'whatsapp-group'`
  (+ `source_via`, `group_name`, `poster_phone`, `poster_name`, `relay_from`)
  and published to the approval queue at once: no "OK", no onboarding, no
  quota. No photo → kept as a draft (photo rule), named in the receipt.
  Chatter is dropped only when the model says no listing AND the text names
  no property + price AND there are no photos.
- **Duplicates**: `listing_fingerprints` (SQLite, 30 days). A post with real
  text (≥ 40 folded characters) is judged by its text alone — the same photos
  with a new price are a new post; only a post with no such text falls back to
  "every photo already seen". Same wamid → duplicate as usual.
- **Who it is filed under**: `wa_id` = the poster's number (the reader's
  participant, else a DRC number written in the post, never one of ours),
  else the relay. Never attributed unless that number is a verified agent
  (the usual sync gate), so a broker who verifies later claims them. Group
  captures are excluded from `findLatestPendingListing` /
  `findRecentPublishedListing`, so the poster's own next message is never a
  correction of a group post.
- **Nothing reaches the poster**: the moderation verdict
  (`POST /admin/properties/:id/notify`) goes to the agent a moderator
  attached (phone-verified), else nobody (`skipped: 'group-capture'`). The
  relay phone gets one receipt per burst (sent / sans photo / déjà reçue).
- **The moderator's context**: at the first sync `db.publishListing` writes a
  `console_admin_notes` row (listing, `admin_user_id` NULL, "Capture groupe
  WhatsApp") naming the group, the poster and the relay. The owners'
  "annonce à valider" alert fires as for any listing. §62.

### Agents created or verified by an admin — no code (2026-10-23)

`services/adminAgentAccounts.js`, behind `POST /admin/agents/admin-create`
and `POST /admin/agents/:id/admin-verify` (requireApiKey; web's console is the
only caller, web/CLAUDE.md has the pages). A third way a number becomes a
verified agent, beside the reverse code and WhatsApp onboarding: **the team
vouches for it.** Built for the group-capture brokers above, whose listings
stay unattributed until their number is verified, and for any agent the team
signs up in person.

- **Deliberately skips proof of ownership.** `phone_verified_at` is the gate
  `resolveAgentId`, `identifySender` and web's lead routing share — setting it
  publishes the number on the agent's listings and routes their enquiries to
  it. Never reachable from a public path or from `routes/webhook.js` (§66
  checks the source).
- **Create** reuses `agentOnboarding.upsertAgentFromWhatsApp`, with
  `source: 'admin'` (`onboarding_source = 'admin'`, the record of who vouched;
  no admin id is stored on `agents`), separate first/last names, communes as
  `primary_communes` = `serviced_communes`, and `refuseExisting`: any row with
  that number, soft-deleted included, refuses (409 `phone-taken`), under a
  per-number advisory lock. The WhatsApp path is unchanged ('whatsapp', never
  refuses).
- **Refused numbers**: not 7–15 digits; 243976321848 / 243846962654 (fixed in
  the module) plus `groupRelay.ownNumbers()` (desk, relay SIM, business env).
- **Verify** (existing account): sets `phone_verified_at`; refused for a
  deleted account and when another live verified account holds the number
  (`resolveAgentId` would pick one arbitrarily). An activation token is issued
  only when the account has no password — a password and its sessions are kept.
- **Claim**: `postgres.linkListingsToAgent` over the number's
  `remote_property_id`s (the onboarding claim: fills NULL `properties.agent_id`
  only, through resolveAgentId's gate), then `db.attributeListingsForWaId`
  stamps SQLite `listings.agent_id`. No full re-sync: `agent_id` is the field
  that changes. A capture not yet in Postgres (draft, no photo) is attributed
  at its first sync. Best-effort; the account exists either way.
- **The activation link** (`agentOnboarding.activationLink`, the onboarding
  magic link, only the SHA-256 stored) is returned to the console and sent by
  nobody: the admin copies it or opens their own WhatsApp with it.
- §66 of verify-pipeline.

### Plan listing limit on WhatsApp

`services/listingQuota.js`, called in `routes/webhook.js`'s draft-confirmation
branch after the photo gate and before `expandAndPublishListing`. A verified
agent whose agency's active plan (`packages.number_of_property`) would be
exceeded by the draft — a multi-unit/multi-property draft counts every listing
it publishes — gets the limit message with the upgrade link, and the draft stays
pending. Same counting rule as web/lib/listingQuotaRules.js. Fails open when
Postgres is unreachable or the sender is not a verified agent. §35.
While web's Abonnements tab is hidden (`cms_settings` 'site.features'
.agentSubscriptions, default off — web/CLAUDE.md, 2026-10-18) the refusal
points at /contact instead of the redirecting /compte/agent/abonnement.

### Console soft delete (2026-10-18)

web's bulk "Supprimer la sélection" sets `deleted_at` + `status = 0` on
agents / vendors / properties (`migrations/20261018_admin_soft_delete.sql`,
web/CLAUDE.md). Engine side: `resolveAgentId` and `identifySender` ignore a
deleted agent (nothing is attributed to it), and `syncListingToPostgres`
never rewrites `status = 1` on a deleted listing, same guard as closed /
under_offer. Run the migration before deploying — these queries name the
column.

### Sales-rep referral codes on WhatsApp

`services/salesReferral.js` (web half and the commission rules: web/CLAUDE.md,
"Launch commission policy"). A rep's wa.me link pre-types "… Code parrainage :
JEAN01".

- **Deterministic, before the quick replies and the model** (`routes/webhook.js`).
  Only the "parrain…" wording is matched, never "réf" (listings carry
  "Réf: LKP-…"). The code is checked against `sales_reps` and the first valid
  one is remembered per sender in SQLite `sales_referral_captures`.
- **Only a bare greeting + code is answered and stops there** (≤240 chars, no
  digits once the phrase is removed). A code inside a listing, a name reply
  (`completeOnboarding` strips it before `parseNameReply`) or a draft
  correction is recorded and the message carries on.
- **Attribution happens inside `upsertAgentFromWhatsApp`'s transaction, only
  for an account created there**, in a SAVEPOINT so a missing table or a bad
  code never costs the agent their account. Unknown / inactive / self-referral
  / existing agent → `sales_referral_refusals`, never credited.
- **Scheduler job `sales-commissions`** (registered before sqlite-backup): daily in the Kinshasa
  hour `SALES_COMMISSION_HOUR` (default 6, read against UTC), calls web's
  `POST /api/cron/sales-commissions` with `CRON_SECRET`; idempotent there.
  §34 of verify-pipeline.

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

## Customer side of requests and visits (Espace Client)

What the customer's own account can see and do, engine half. web/CLAUDE.md,
"Espace Client at scale", has the pages.

- **A request names up to five communes** (`services/leadCommunes.js`).
  `leads.communes` is a JSON array, primary first; `leads.commune` stays the
  first entry so every single-commune reader is unchanged. `dispatchLead`
  ranks each commune and merges agencies on their best score
  (`matched_commune` leads their message). Before this, web's form sent only
  the first commune and the other communes' agencies were never pushed. A
  `PATCH /leads/:id` that removes a commune resets proposals; one that only
  adds pushes the request to the new commune's agencies. §32.
- **A web visit request moves its lead to `VIEWING_REQUESTED`**
  (`db.markLeadViewingRequested`, only from NEW / CONTACTED / QUALIFIED). Only
  the WhatsApp assistant used to set it.
- **`GET /admin/viewing-requests/by-customer?wa_id=`** — a customer's own visits
  with the agent's answer, `scheduled_at` and check-in; no agent id, routing
  type or agent decline reason (`customer_reason_code` is only the customer's).
- **`respondFromCustomer`** (`POST /admin/viewing-requests/:id/customer-response`)
  with `CUSTOMER_TRANSITIONS`: `CANCEL` from PENDING / RESCHEDULED / CONFIRMED,
  `ACCEPT_SLOT` only from RESCHEDULED (pins `scheduled_at`). Authorised by the
  lead's `wa_id`; anybody else gets the same 404 as a missing id. Tells the
  listing's verified agent and ops, never echoes to the customer, clears open
  WhatsApp questions on both sides.
- **`viewing_requests.cancelled_by`** (`CUSTOMER` | `AGENT`): the dashboard's
  CANCELLED sets `AGENT`. A customer changing plans must never read as an
  agent failure.
- **Check-in and fall-through reason from the web**
  (`POST …/:id/checkin`, `…/:id/falloff-reason`) go through the same
  `recordCheckinResponse` / `recordFalloffReason` as WhatsApp, with
  `notifyCustomer: false` (no WhatsApp thank-you, no WhatsApp reason question).
  Refused before the agreed time. §33.

## Speed-to-lead: the 15-minute SLA and the post-visit check-in

`services/viewingSweeps.js`. Two scheduler jobs, both keyed off columns added
to `viewing_requests` (`scheduled_at`, `sla_alerted_at`, `checkin_sent_at`,
`checkin_response`) through the same idempotent-ALTER array `decline_reason`
already used.

- **15 minutes unanswered → escalate.** Ops is told *why* the agent did not
  answer — `agentReachability` distinguishes "never received it, number
  unverified" from "received it and ignored it", which need completely
  different responses and must not read the same. The customer gets real
  alternatives at the same time.
  - **The alternatives use the whole lead**, not just its commune:
    `transaction_type`, `price_min`/`price_max` and `bedrooms` are all passed
    to `propertyMatching`. The decline path passed only the commune, so a
    rental shopper could be offered a sale — the data to fix it was already on
    the row.
  - **Status stays `PENDING`.** The agent can still accept, and inventing an
    "EXPIRED" state would collapse "never answered" into the same bucket as
    "answered late", making response *rate* unmeasurable — the same reason
    `DECLINED` is not a synonym for `CANCELLED`.
- **2 hours after the agreed slot → ask the customer how it went.** Three
  answers (`GOOD` / `BAD` / `AGENT_ABSENT`), as buttons with a typed 1/2/3
  fallback. A 👍 or 👎 sets the lead to `VIEWING_COMPLETED`, which had existed
  in `LEAD_STATUSES` since it was written with **no code path able to reach
  it**. `AGENT_ABSENT` additionally escalates to ops the same day.
  - **It fires only on a real `scheduled_at`.** A confirmed visit with no
    agreed instant is never asked about: `requested_time` is free text
    ("demain matin") and `created_at` says nothing about when anyone met.
    Asking "how was your visit?" about a visit that may not have happened is
    worse than not asking.
- **Authorisation is the mirror image of the agent loop's.** The only person
  entitled to say how a visit went is the customer who attended it, so the
  check-in handler matches the sender against `leads.wa_id` and must **not**
  reuse `viewingNotifications.resolveContext`, which authorises the listing's
  agent. `pending_customer_actions` is a separate table from
  `pending_agent_actions` for the same reason — one table with a role
  discriminator invites a handler that checks the wrong rule for the row it
  loaded.

### `scheduled_at`: where the instant comes from

Accepting a request now pins it to a real time. `services/visitSchedule.js`'s
`parseFrenchSlot` reads what the customer already wrote — "demain 14h",
"samedi matin", "le 15 à 10h" — and the agent confirms it with one tap
(`viewing_slot_ok:<id>` / `viewing_slot_edit:<id>`); an unparseable phrase
falls back to asking, via `PENDING_KINDS.scheduleTime`.

- **A day with no hour is refused, never guessed.** "demain" alone returns
  null. Inventing 9am would produce a confident-looking slot nobody agreed to,
  and the check-in would then fire against it.
- **Stored in UTC with a `Z`, not `+01:00`.** Both are unambiguous instants,
  but only one sorts: the check-in sweep does `WHERE scheduled_at <= ?` and
  SQLite compares TEXT lexically, so a column mixing offsets would silently
  return the wrong rows rather than failing. Kinshasa's UTC+1 is applied once,
  at parse time.
- **Day-part words are matched most-specific-first** (`apres-midi` before
  `midi`), the same rule `parseDeclineReason` follows — otherwise "cet
  après-midi" reads as noon.
- The status is `CONFIRMED` and the customer is told **before** any of this:
  scheduling is a refinement on an answer already given, and an agent who
  ignores the slot question has still accepted the visit.

## Listing verification — "Vérifié par Lukka Place"

`properties.verified_at` + `verified_by` (`scripts/migrate-listing-verification.js`,
idempotent, **no backfill**). A **fourth** lifecycle axis, independent of the
three in `web/CLAUDE.md`, and the distinction is the whole point:

| | asks | set by |
|---|---|---|
| `approve_status` | was this listing fit to publish? | a moderator |
| `agents.phone_verified_at` | does this PERSON hold this number? | the OTP / WhatsApp onboarding |
| `verified_at` | did we confirm this PROPERTY is real, on these terms? | a human, from `/admin/listings/[id]` |

- **A timestamp, not a boolean.** Every comparable flag on this schema already
  is one (`phone_verified_at`, `sold_at`, `archived_at`); `is_verified` is
  derived as `verified_at IS NOT NULL`. A bare boolean cannot answer "who said
  so, and when" — the first question asked the day a verified listing turns out
  not to be real — and the market export wants the date.
- **Preconditions are reported, never enforced.** `getVerificationPreconditions`
  shows the admin the photo count, whether the agent's number is verified and
  whether a commune is tagged, then lets them decide. An automatic rule would
  derive the badge from facts that do not establish it, which is exactly the
  fabrication the no-invented-data rule forbids everywhere else.
- **Nothing is backfilled.** Nobody has verified any existing listing, and
  stamping a timestamp would record a verification that never happened.
- `verified_by` is NULL today and that is honest: `/admin` has one shared team
  password, not per-admin accounts, so there is no id to record and a fake one
  would be worse than none.
- Appended to `LISTING_EXPORT_COLUMNS` — **appended**, since that list is the
  CSV column order and a consumer's spreadsheet is keyed on it.

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

## Direct-to-Agent Routing, Price Capture & Agent Performance

`migrations/20260913_lead_routing_and_price_capture.sql` (run with
`node scripts/run-sql-migration.js <file> --write`, idempotent). **Adapted to
the real schema, deliberately not the literal brief**, and the reasons bind:

- **No `sold_price_usd` / `price_delta_*` columns.** `properties.sold_price`
  and `sold_at` (a DATE) already exist and every reader uses them; the deltas
  are derived at read time exactly as `web/lib/dataExport.js` does, so a
  corrected asking price never leaves a stale delta. Only the missing fact was
  added: `properties.price_source` (`WHATSAPP_AGENT_REPLY` / `ADMIN_DASHBOARD`
  / `DIRECT_INPUT`, CHECK-constrained). `postgres.recordSoldPrice` writes it in
  the same UPDATE as the price; web's `markListingSoldAction` writes
  `DIRECT_INPUT`; every path that clears `sold_price` clears it too.
- **`agents.direct_routing_enabled`** (default true) is the admin switch on
  `/admin/benchmarks`. It can switch a verified agent OFF; it can never switch
  an unverified number ON — enforced in the UPDATE's WHERE clause, not only
  the UI.
- **`agent_performance_logs`** uses BIGINT FKs (`agents.id`/`properties.id` are
  bigint, not UUID) with `ON DELETE CASCADE`, because agents delete their own
  listings from the web dashboard. One row per viewing request that REACHED an
  agent (partial unique index on `viewing_request_id`), written by
  `viewingNotifications.notifyViewingRequest`; first response latency by
  `logResponse` (COALESCE keeps the first); COMPLETED by the check-in.
  **Scope, stated on the page:** a direct `wa.me` chat is invisible to us and
  is not a "lead" here — the leaderboard measures viewing requests only.
- **`viewing_requests` is SQLite**, so its new columns are in
  `services/db.js`'s idempotent ALTER list: `agent_id`, `routing_type`
  (DIRECT_WA when a verified agent was actually alerted, CENTRAL_FALLBACK
  otherwise — recorded from what happened, not from what the page offered),
  `reassigned_at`, `first_response_at`, `decline_reason_code`,
  `decline_reason_by`. `COMPLETED` joins the status vocabulary and is reached
  only by a 👍/👎 check-in; "agent absent" never completes a request.
- **`whatsapp_clicks.routing_type` / `agent_id`**, written by
  `POST /api/telemetry/lead-click` (`trackLeadClick`, event
  `whatsapp_cta_clicked`). It REPLACES `trackEvent('whatsapp_click')` at the
  three CTAs — both would double-count the conversion rate. `agent_id` is read
  from `properties` in the INSERT, never from the request body.

**Price capture** (`services/priceExtraction.js`): a bare figure ("700",
"1 100 $") is written immediately, as before; a figure read from a sentence
("vendu à 700 dollars") or by the model ("sept cents") is read back and only
written on OUI (`CLOSING_PRICE_CONFIRM`, amount held in
`pending_agent_actions.amount`). Refused, never guessed: a message that reads
like a property advert (falls through to intake), francs, and any model answer
that is not one of the numbers literally in the text. The brief's
`/\b(\d{3,6})…/` regex was not used — it reads "2026" as a price and misses a
$80 rent. The receipt states the real delta against the asking price.

**Decline reasons** keep the agent's 3-option survey (mapped to
`PROPERTY_NO_LONGER_AVAILABLE` / `OTHER`); `PRICE_TOO_HIGH`,
`LOCATION_DESELECTED`, `TERMS_UNACCEPTABLE` are asked of the CUSTOMER after a
👎 check-in (`viewingSweeps.parseFalloffReason`). `decline_reason_by` keeps
the two apart.

**Admin overrides** (`routes/admin.js`): `GET /admin/viewing-requests/feed`
(all agents — not the owner-scoped list), `POST …/:id/reassign` (target must
pass `directRoutingBlocker`; after a reassign only the assigned agent's taps
are authorised), `POST …/:id/nudge` (agent only, never re-pings ops), `PATCH
…/:id` with `scheduled_at` (ISO with offset or "samedi 14h"; a day with no hour
is refused). `GET /api/admin/benchmarks/agent-performance` (index.js, API key)
answers 503 without Postgres rather than an empty leaderboard; commune averages
below 5 closes are suppressed, same rule as `marketBenchmarks.js`.

**Web pages**: `/admin/viewings`, `/admin/market-data` (which now also holds
the pricing medians formerly on `/admin/benchmarks`), `/admin/benchmarks`
(agent leaderboard + routing switch), `/admin/telemetry` (tap log, agents to
nudge, post-visit check-ins). The follow-ups shown are the real 15-minute SLA
and 2-hour check-in — there is no 24-hour job.

**Still true, and why the central fallback can reach nobody:**
`OPS_WHATSAPP_NUMBER` was unset on production at deploy time (2026-09-13), so
a request on a listing with no verified agent is logged and answered but no
human is alerted until it is set.

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

## Launch-readiness pass (2026-09-23)

- **The intake card is rendered from the stored row** (`services/listingCard.js`).
  The model still writes the greeting above it (in the agent's language); every
  fact on the card comes from `getListing(id)` after insert / correction, so
  what the agent approves with "OK" is what gets published. Before, the card
  was the model's prose and the row was post-processed separately — "pas
  3+1+1 mais 2+1+1" showed 2 months of garantie while 3 were stored.
  Multi-unit / multi-property drafts keep the model's itemised recap. A bare
  "non" (is_correction false) keeps the model's "which line is wrong?" reply.
- **Correction rules** (SYSTEM_PROMPT, "BOUCLE DE CORRECTION"): touch only
  what the message corrects; "pas X mais Y" / "Y au lieu de X" mean Y;
  "pas de commission" is 0; a bare "non" asks which line is wrong.
  `normaliseEntryCosts` now defers to the model when a message holds two
  different additive expressions, reads spoken "3 plus 1 plus 1", and only
  applies the "N mois" convention when that N is in THIS message (correction
  mode hands it the merged draft). `isAffirmative` also takes "ok merci",
  "c'est correct", 👍. Live eval: 15/15 messy French corrections.
- **Voice notes** (`services/voiceNotes.js`, `VOICE_TRANSCRIBE_MODEL`, default
  whisper-1): transcribed and folded into the message text exactly like a PDF
  flyer's text layer, so intake, corrections and "OK" work spoken. No language
  is forced (French/Lingala mix); an inaudible note gets `VOICE_UNREADABLE_REPLY`.
- **Reverse phone verification** (`services/phoneChallenges.js`,
  `migrations/20260923_phone_verification_challenges.sql`, web
  `lib/whatsappVerify.js`): the web verify page shows a 6-digit code the person
  sends FROM their WhatsApp; a message from number X holding a code that
  matches an open challenge FOR X marks it verified, before any listing logic.
  Matched on sender AND code — a number alone would let an agent's ordinary
  messages verify an account someone else opened on their number. Needs no
  Meta template. `AUTH_OTP_BYPASS=1` now means "send no code, verify this way"
  instead of "skip proof" (which let anyone claim an agency's listings).
- **Agent morning digest** (`services/agentDigest.js`, job
  `agent-daily-digest`, `AGENT_DIGEST_HOUR` default 8 Kinshasa): pending and
  today's visits, new customer requests, listings to confirm, listings in
  review; Mondays add last week's views/taps from `listing_stats_daily`.
  Nothing is sent to an agent with nothing to say. Once per agent per day
  (`agent_digest_sends`), "STOP RÉSUMÉ" opts out (`agent_digest_optouts`).
  Session message: reaches agents inside the 24h window until a template exists.
- **Trusted-agent auto-approval** (`services/trustedAutoApprove.js`, job
  `trusted-auto-approve`, every 5 min, `AUTO_APPROVE_TRUSTED=off` disables):
  promotes a pending listing only when its agent is active, phone-verified,
  holds a human-granted verification tier, has ≥5 HUMAN-approved listings and
  no rejection in 90 days — and the listing passes the moderator's publish
  checks plus a real photo and a commune tag. Recorded as a moderation
  (`moderation_note = 'auto:trusted-agent'`, `moderated_by` NULL); the agent gets
  the normal "en ligne" message. Both write paths still create
  `approve_status = 0`. With no verified-tier agent today, it approves nothing.
- Scheduler order is now: search-alerts, viewing-sla, viewing-checkin,
  viewing-agent-done, ops-health-alerts, listing-stats-rollup,
  draft-auto-submit, trusted-auto-approve, agent-daily-digest, listing-availability-check,
  market-snapshot, ops-desk-keepalive, sales-commissions, sqlite-backup
  (pinned in §24).

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

## The ops desk phone — OPS_WHATSAPP_NUMBER (2026-10-07)

`services/opsDesk.js`, set up with `scripts/ops-desk.js`. A dedicated SIM
receives every desk copy (viewing requests, listing enquiries, project
enquiries, declines, closing prices, ops alerts).

- **One reader.** `opsDesk.opsNumber()` normalises at call time: a local
  "0812…" / "812…" / "00243…" becomes 243…; anything not 7–15 digits is unset
  (and said so at boot). Every module that used to strip non-digits and send
  "0812345678" as-is now delegates to it. `/admin/health`'s config carries
  `opsDesk` (configured, last desk message, estimated window).
- **The 24h window is the whole game.** No template is approved, so every
  desk copy is a session message. A desk phone silent for 24h stops receiving
  everything while every send is still "accepted". Any message from the desk
  reopens it and is answered with when it closes; the `ops-desk-keepalive`
  job asks "répondez OK" once, 20h after the desk's last message (never after
  23h45 — it would not land). No reply → nothing more is sent.
- **The desk phone is not an agent.** `routes/webhook.js` hands a message
  from it to `handleDeskMessage` right after the button taps: no model call,
  never a listing, a forwarded listing is refused with an explanation. A
  number used as the desk loses agent commands and intake on purpose.
- **Setup** (VPS, engine dir): `node scripts/ops-desk.js set <n> --write` →
  `pm2 restart lukka-place-engine --update-env` → from the desk phone,
  WhatsApp "OK" to the business number → `node scripts/ops-desk.js test`.
  The script refuses the business number itself. §46 of verify-pipeline.

## Visit booking — picked slot, bon de visite, multi-visit (2026-09-29)

web/CLAUDE.md, "Visit booking, both agendas…", has the pages. Engine half:

- **`viewing_requests` columns** (idempotent ALTER list): `preferred_slot_at`
  (the customer's pick, UTC `Z`), `batch_id`, `agent_done_asked_at`,
  `agent_completed_at`, `agent_visit_outcome` (DONE | NOT_DONE),
  `visit_receipt_text`, `visit_receipt_sent_at`.
- **`POST /admin/viewing-requests`** takes `preferred_slot_at`
  (`visitSchedule.resolvePreferredSlotInput`: ISO with offset, future, ≤ 30
  days; anything else is a 400). `requested_time` is still the French phrase.
  The owner list's `requested_slot_at` prefers the pick while PENDING.
- **Accepting pins the pick** (`viewingNotifications.pickedSlot`, PENDING only —
  once the agent proposed another slot the original pick no longer applies):
  WhatsApp Accepter and a dashboard confirmation with no time of its own set
  `scheduled_at` to it and tell the customer that exact time; no slot-confirm
  buttons (that step exists only for a slot read out of free text).
- **Bon de visite** (`services/visitReceipt.js`, scheduler job
  `viewing-agent-done`, registered after `viewing-checkin`): 1 h after a
  CONFIRMED `scheduled_at` (never for visits older than 3 days) the verified
  agent is asked once, buttons `visit_done:<id>` / `visit_notdone:<id>` or a
  typed OUI / NON (pending kind `VISIT_DONE`, set only when the number has no
  other open question). `POST /admin/viewing-requests/:id/agent-completed`
  (`agent_id`, `outcome`) is the dashboard's path, authorised by agents.id like
  `respondFromDashboard`. DONE keeps the receipt text verbatim, sends it to the
  customer (template `VISIT_RECEIPT_TEMPLATE` when set — body "Merci pour votre
  visite du bien {{1}} le {{2}} avec {{3}}. Cette visite a été organisée par
  l'intermédiaire de Lukka Place." — else a session message), stamps
  `visit_receipt_sent_at` only when Chakra accepted it, and answers the agent
  with a wa.me link carrying the receipt. NOT_DONE tells ops. Written once;
  **the status stays CONFIRMED** — COMPLETED is still only the customer's
  check-in.
- **`POST /admin/viewing-requests/batch`** ("Mes visites"): ≤ 4 distinct
  listings, a valid pick each, one batch per number per hour (429). One lead +
  request per listing sharing `batch_id`; each listing's own agent is alerted
  about their listing only (`notifyOpsCopy: false`), and ops gets one summary.
- **`GET /admin/viewing-requests/busy-slots`** (`agent_id`, `property_ids`):
  CONFIRMED instants in the next 15 days (the web calendar shows 14 since
  2026-10-10), instants only.
- **The agent's alert names the portal** (2026-10-10): `agentMessage` ends
  with "Confirmer ou proposer une autre heure dans votre espace :
  /compte/agent/visites" above the listing link. The template variant already
  carried that link as {{5}}. **Measured the same day: 12 of 49 public
  listings have no agent, and `OPS_WHATSAPP_NUMBER` is still unset — a visit
  request on any of them reaches nobody** (request #8, property #256).
- **The agent alert's template is a branded card with a button** (2026-10-10,
  "like Yango's"): `VIEWING_REQUEST_TEMPLATE` (read at call time now) expects
  an optional IMAGE header (`VIEWING_REQUEST_TEMPLATE_IMAGE`, an https URL,
  sent only when set — `chakra.sendTemplate`'s new `headerImage`), FOUR body
  variables (agent, customer, listing, date and time) and a STATIC URL button
  to `/compte/agent/visites`, which needs no send-time parameter. The fifth
  body variable (the link) is gone; no template had been submitted. The exact
  wording is in the comment above `templateName` in viewingNotifications.js.
  Not approved yet — until it is, the alert is still a session message.
- **Two business numbers (2026-10-12).** +243 976 321 848 is the intake number
  (CHAKRA_PHONE_NUMBER_ID: listings in, every session message out).
  +243 846 962 654 is the notifications number; its WhatsApp account ("Lukka
  Place Admin") owns the approved `demande_visite_agent` template, and a
  template can only be sent by a number of the account that owns it — from the
  intake number Meta answers #132001. `chakra.sendTemplate`'s `sender` option
  (`senderTarget`) sends from it: `VIEWING_SENDER_PHONE_NUMBER_ID`, plus
  `VIEWING_SENDER_ACCESS_TOKEN` for Meta's Cloud API directly, or without a
  token through Chakra (`VIEWING_SENDER_PLUGIN_ID` optional). Unset → the
  intake number. Replies to that message land on the notifications number,
  not on this engine's webhook; the template's only action is a link button.
  The same number was set as OPS_WHATSAPP_NUMBER (the desk) on 2026-10-12.
- **The rest of the lifecycle as templates (2026-10-13).** Each is unset by
  default and falls back to its session text, so nothing that arrived before
  can be lost: `VIEWING_DESK_TEMPLATE` (copie_bureau_visite: agent or "Aucun
  agent prévenu", customer, listing, time), `VIEWING_CONFIRMED_TEMPLATE`
  (visite_confirmee_client: listing, time, agent), `VIEWING_PROPOSAL_TEMPLATE`
  (visite_proposition_client: listing, new time), `VIEWING_UNAVAILABLE_TEMPLATE`
  (visite_indisponible_client: listing, time asked, reason — used for a
  decline and for an agent's cancellation; a decline's alternatives still
  follow as text). `VIEWING_TEMPLATES_WITH_LINK` lists the templates approved
  with a DYNAMIC link button (sent the request id via `sendTemplate`'s
  `urlButton`); `VIEWING_TEMPLATES_FROM_SENDER` lists those that go out from
  the notifications number. The desk copy can never be one of those: its
  recipient is that number. `demande_visite_agent` is approved with an image
  header and a FIXED link button, so it is in neither list. Only viewing
  messages are covered: enquiries, ops alerts, digests and the availability
  check are still session messages, which is why the desk keepalive stays.
- **The agent's day as a template (2026-10-14).** `AGENT_DAY_TEMPLATE`
  (visites_programme_agent: first name, number of visits today, first visit
  time) is sent by `agentDigest.deliverDigest` when the agent has a CONFIRMED
  visit today; the rest of the digest follows as text only when it says
  anything beyond those visits.
- **Where they live (measured 2026-10-14):** the four new templates are on
  the INTAKE number's account (from the notifications number Meta answers
  #132001) and all four have a PICTURE header (without one, #132012). So
  production has `VIEWING_TEMPLATES_WITH_IMAGE` listing all four and
  `VIEWING_TEMPLATES_FROM_SENDER` empty; only `demande_visite_agent` goes out
  from the notifications number. `copie_bureau_visite` (Marketing, picture
  header, intake account) was switched on 2026-10-15: the desk copy of a new
  request no longer needs the desk's 24h window. Other desk messages still do.
- **v2 Utility templates (switched 2026-10-15).** `demande_visite_agent_v2`,
  `copie_bureau_visite_v2` and `visite_indisponible_client_v2` are approved as
  UTILITY on the INTAKE number (+243 976 321 848). Production `.env`:
  `VIEWING_REQUEST_TEMPLATE` / `VIEWING_DESK_TEMPLATE` /
  `VIEWING_UNAVAILABLE_TEMPLATE` name them, the last two replace their v1
  names in `VIEWING_TEMPLATES_WITH_IMAGE`, and `VIEWING_SENDER_PHONE_NUMBER_ID`
  is commented out — the agent-request send always goes through that sender
  when it is set, and from the notifications number Meta answers #132001.
  **`demande_visite_agent_v2` has a DYNAMIC link button**:
  `VIEWING_TEMPLATES_WITH_LINK=demande_visite_agent_v2`, without which Meta
  answers `#131008 Required parameter is missing` and the alert falls back to
  a session message. Live-tested on request #13 (listing #293, agent 37):
  sent "via template", the button opened that visit in the agent portal; the
  desk copy was accepted. `visite_indisponible_client_v2` is not exercised yet.
  `AGENT_LEAD_MATCH_TEMPLATE` is unset in production (`agent_lead_match` does
  not exist at Meta); set it again once a lead-match template is approved.
- **Days an agent takes no visits** are web-side only:
  `migrations/20261010_agent_visit_availability.sql` (Postgres, one row per
  agent), read and written by web's `lib/agentAvailability.js`. The engine
  does not read it — a request for a blocked day is refused by web's actions
  before it reaches `POST /admin/viewing-requests`.
- §43 of verify-pipeline.

## "Annonce à valider" — owners approve from their phone (2026-10-17)

`services/moderationAlerts.js`. Each listing entering the approval queue is
WhatsApped to `ADMIN_ALERT_NUMBERS` (the owners' phones; unset → the desk)
with a link to `/admin/listings/<id>`, where on a phone the decision panel and
photos now come before the editor. Two callers: `db.publishListing` on a
listing's FIRST Postgres sync (never a correction's re-sync) and
`POST /admin/moderation-alert` from web's `createListingAction`. Once per
listing (`moderation_alerts_sent`, written only after a send was accepted).
`MODERATION_ALERT_TEMPLATE` (body: number, what + where, agent; dynamic URL
button = listing id) when set, else a session message — which reaches an
owner's phone only within 24h of it messaging the intake number. §50.
Without its own template it now falls back to the desk-alert template below.

## Desk alerts and moderation verdicts as templates (2026-10-19)

Built so the desk and owners' phones need no daily "OK", and an agent hears
the moderation verdict however long it took. Every name is unset by default
and read at call time (set in `.env`, then `pm2 restart lukka-place-engine
--update-env`); unset or failing → the session text, so nothing that used to
arrive can be lost. All four live on the INTAKE number's account ("Lukka
Place", +243 976 321 848), UTILITY, French. §54.

- **`DESK_ALERT_TEMPLATE`** (`services/deskAlert.js`) — every message to
  `OPS_WHATSAPP_NUMBER` (visit copies, declines, SLA, closing prices, listing
  and project enquiries, ops alerts, `/admin/ops-notify`) and the owners'
  moderation-alert fallback. {{1}} = the message's first line, {{2}} = the
  rest on one line (Meta refuses newlines in a variable). While it is set the
  `ops-desk-keepalive` job asks nothing. Submitted as `alerte_bureau`:
  > Alerte Lukka Place : {{1}}
  >
  > {{2}}
  >
  > Vous recevez ce message car ce numéro reçoit les notifications de l'équipe Lukka Place.

  Button: Visit website, STATIC, "Ouvrir la console" → `https://lukkaplace.com/admin`.
- **`MODERATION_ALERT_TEMPLATE`** (`annonce_a_valider`): "Nouvelle annonce à
  valider sur Lukka Place : n° {{1}} — {{2}}. Agent : {{3}}." Button DYNAMIC
  "Valider l'annonce" → `https://lukkaplace.com/admin/listings/{{1}}`.
- **`LISTING_APPROVED_TEMPLATE`** (`annonce_en_ligne`, `routes/admin.js`
  `POST /properties/:id/notify`): "Bonne nouvelle ! Votre annonce n° {{1}}
  ({{2}}) a été validée et est maintenant en ligne sur Lukka Place." Button
  DYNAMIC "Voir l'annonce" → `https://lukkaplace.com/listings/{{1}}`.
- **`LISTING_REJECTED_TEMPLATE`** (`annonce_a_corriger`): "Votre annonce n°
  {{1}} ({{2}}) n'a pas pu être publiée pour le moment. Motif : {{3}}.
  Répondez à ce message avec les corrections et nous la vérifierons à
  nouveau." No button. {{3}} is the coded reason + the team's note, else
  "à préciser par notre équipe, qui vous contactera".
- {{2}} on both verdicts is "Appartement à louer — Limete" from the engine's
  row, "votre bien" when it holds nothing. The recipient is the WhatsApp
  submitter (SQLite); for a listing typed on the website (no SQLite row) it
  is the listing's own agent from Postgres, phone-verified and not deleted
  (`propertyRepository.getModerationRecipient`, no public filter — the
  listing is pending or rejected). Neither → 404, nothing sent (2026-10-20,
  #314–#317 had reached nobody). §57.

## "Notez l'agent" — verified agent ratings (2026-10-18)

`services/agentReviews.js`, Postgres `agent_reviews`
(`migrations/20261018_agent_reviews.sql`, applied to production 2026-10-18), SQLite copy
`viewing_requests.agent_rating` / `agent_rated_at`. web/CLAUDE.md has the pages.

- **Rates the AGENT, never the property** (product decision). The house is
  still the check-in's 👍/👎 and the customer's fall-through reason; the star
  question says "pas le bien lui-même".
- **Asked after every visit that happened**: 👍 → thank-you + "notez l'agent"
  in one message; 👎 → the property reason first, then the stars;
  "agent absent" → no stars (it is a no-show). Typed 1–5 (or ⭐⭐⭐, "4/5"),
  then an optional comment (PASSER skips; the comment question closes after
  2 h; a link or photos are never a comment). Pending kinds `AGENT_RATING` /
  `AGENT_REVIEW_COMMENT` in `pending_customer_actions`; anything else falls
  through. ≤2 stars tells ops.
- **Who may rate**: the lead's own wa_id only, once the check-in said
  GOOD/BAD, one rating per viewing request (UNIQUE), never edited. Rated
  against the reassigned agent, else the listing's agent, else the alerted one.
  `customer_hash` is SHA-256 of the number, never the number.
- **Postgres is the record**: SQLite is stamped only after the INSERT
  succeeded; Postgres down → "réessayez", question stays open.
- **Web**: `POST /admin/viewing-requests/:id/agent-rating` (Espace Client),
  `GET /admin/agent-reviews`, `PATCH /admin/agent-reviews/:id` (comment
  APPROVED/REJECTED; stars count either way). Public average from
  `MIN_PUBLIC_REVIEWS` (5), shared with web/lib/agentReviews.js.
- Monthly contest score (rating + response speed + visits done) is the
  planned follow-up, not built. §51 of verify-pipeline.

## WhatsApp commands for agents (2026-09-29)

`services/agentCommands.js`, routed in `routes/webhook.js` right after the
button taps: a text under 40 characters that starts with "!" and carries no
media — `!mesbiens`, `!share 310` / `!partager 310`, `!aide`; anything else
starting with "!" gets the command list. The sender must pass
`agentOnboarding.identifySender` (verified phone); others get one refusal and
web is never asked. The reply is built by web (`POST /api/internal/agent-command`,
Bearer `CRON_SECRET`, `WEB_BASE_URL`), so the caption is the share kit's own
and ownership / public rules are checked there; web unreachable → "réessayez",
never an engine-made caption. No model call, nothing stored in SQLite. §44.

## Listing videos and 20 photos (2026-10-21)

After launch, agents were seen sending videos with their photos; videos were
answered "format pas encore pris en charge" and lost. `services/listingMedia.js`
holds the rules. §63 of verify-pipeline.

- **The publish rule is now one photo OR one video** (`hasVisualMedia`), on
  every path that used to require a photo: "OK" and the conversational
  confirmation (`PHOTO_REQUIRED_REPLY` now says "Photo ou vidéo obligatoire"),
  onboarding's publish, `draftAutoSubmit` (its SQL counts `videos` too), group
  relay captures, and the model's own refusal (`photos_count` in the draft
  context counts photos + videos). Read "photo" as "photo or video" in the
  older sections above.
- **Caps**: 20 photos (`MAX_LISTING_PHOTOS`, same as web/lib/uploadLimits.mjs —
  change one, change the other; §63 and web's listing-videos test compare),
  3 videos (`MAX_LISTING_VIDEOS`). Applied in `db.js` on insert and on every
  correction (`mergeCapped`, first ones kept), and on the refs BEFORE any
  download. The vision model still reads the first `OPENAI_MAX_IMAGES` (10)
  photos — cost; every photo is stored. The intake card says "(maximum 20)".
- **Intake** (`routes/webhook.js`): `message.video` (caption included) is a
  media ref with a video mime; `mediaRefs` is photos + videos (so every "burst
  carries media" guard counts a video), `photoRefs` go to the model,
  `videoRefs` are downloaded one at a time (`chakra.downloadVideo`: attachment
  proxy then media id, 120 s, bytes must sniff as MP4/MOV/3GP/WebM,
  `MAX_VIDEO_BYTES` 64 MB) and stored by `mediaStorage.persistVideos`
  (`<key>-v<i>.mp4`). SQLite `listings.videos` (JSON, idempotent ALTER);
  `applyListingCorrection`'s 6th argument appends videos; multi-property pastes
  split videos by `video_blocks` like photos (a property with no video of its
  own is fine). A video with no caption joins the pending draft (card with
  "*Vidéos* : N", no model call); with no draft it gets `VIDEO_NEEDS_TEXT_REPLY`
  (the model does not watch videos, so there is nothing to read); one that
  cannot be fetched gets `VIDEO_DOWNLOAD_FAILED_REPLY`, never silence. The
  relay passes `downloadVideos`; the group reader (Baileys) still sends photos
  only.
- **Publish** (`syncListingToPostgres`): after COMMIT, `uploadListingVideos`
  puts each video in the listing bucket (`whatsapp_<hash>.<ext>`, no
  enhancement) and, when ffmpeg can cut one, a cover frame
  (`whatsapp_<hash>_poster.jpg`, ~1 s in). `properties.videos` jsonb
  `[{url, poster}]` (`migrations/20261021_listing_videos.sql`; before it, a
  logged 42703 and the sync stands). With no photo, the first cover is
  `featured_image`, so a video-only listing is not a "no image" card and
  `trustedAutoApprove`'s real-photo check is met. Laravel's single
  `video_url` / `video_image` are left alone.
- **ffmpeg**: `FFMPEG_PATH`, else the `ffmpeg-static` binary (new
  dependency — its install script downloads the binary; on the VPS check
  `node -e "console.log(require('ffmpeg-static'))"` points at a real file
  after `npm install`, `npm approve-scripts ffmpeg-static` if npm blocked it),
  else `ffmpeg` on PATH. None → no cover, the video still publishes.
- Web half: web/CLAUDE.md, "Listing videos".

## Verification & Commands
- **Verification Command**: Always run `npm run verify` before declaring a backend task complete.
- **Test Coverage**: Do not touch schema fields without updating `scripts/verify-pipeline.js`.

## Projets neufs — project enquiries and the demand report (2026-09-24)

web/CLAUDE.md, "Projets neufs & terrains", has the product. Engine half:

- `services/projectEnquiry.js` behind `POST /admin/project-enquiries`: re-reads
  the project under `status = 1 AND approve_status = 1`, records a lead
  (`source: 'project-enquiry'`, new SQLite column `leads.development_id`, no
  commune so `leadDispatch` never sees it), assigns it to the developer's
  `agents.id`, and alerts the developer (only through
  `propertyRepository.directRoutingBlocker`) plus `OPS_WHATSAPP_NUMBER`.
- `db.getDemandReport` behind `GET /admin/demand-report?days=`: distinct wa_ids
  per commune × transaction × bedrooms × budget band (`demandBudgetBand` reads
  price_max, else price_min, else "not stated"); multi-commune requests count
  in each commune. Supply is joined on the web side.
- Covered by `scripts/verify-pipeline.js` §36.

## Developer self-serve projects — engine half (2026-09-25)

web/CLAUDE.md, "Developers publish their own projects", has the product.
`migrations/20260925_developer_self_serve.sql` adds review columns on
`developments` and `properties.development_id` / `development_unit_type_id` /
`unit_label` / `unit_floor` (written by web only — `syncListingToPostgres`
never names them). Engine changes: `services/listingQuota.js` excludes
`development_id IS NOT NULL` (same clause as web); `trustedAutoApprove` never
approves a project unit (they are approved with their project);
`POST /admin/ops-notify` sends a one-line heads-up to `OPS_WHATSAPP_NUMBER`
(unset → `sent: false`, never an error); the Monday agent digest names a
public off-plan project with no construction photo for 60 days. §37.

## "Toujours disponible ?" on WhatsApp — every 14 days (2026-09-29)

`services/availabilityCheck.js`, scheduler job `listing-availability-check`
(daily at `AVAILABILITY_CHECK_HOUR`, default 10 Kinshasa, after the digest).
Record: Postgres `listing_availability_checks`
(`migrations/20260929_listing_availability_checks.sql`) — one row per question
sent, answers written onto it; web's dashboard answers add `channel =
'DASHBOARD'` rows. **Without that table the job refuses to run**: it is the only
thing that stops a daily re-ask.

- **Who is asked**: live, active listings (not project units) whose
  `availability_confirmed_at` — or, never confirmed, last change — is older
  than 14 days, not asked in 14 days, agent `status = 1` with a VERIFIED phone.
  Max 3 per agent per day; none to an agent who still owes an answer to any
  question (`db.hasOpenAgentQuestion`). 14 is shared with web's
  `CONFIRM_AFTER_DAYS` and the digest's `STALE_DAYS` (pinned on both sides).
- **The flow**: `Oui, disponible` stamps `availability_confirmed_at` (same WHERE
  as web). `Non, plus disponible` → `Loué / vendu` (under_offer now, "à quel
  loyer / prix ?", `recordSoldPrice` WHATSAPP_AGENT_REPLY, receipt with the
  delta, then "le client venait-il de Lukka Place ?") or `Retiré du marché`
  (`postgres.archivePropertyAsWithdrawn`: status 0 + archived_at — never a
  transaction). `Prix modifié` → new price through `postgres.setListingPrice`,
  then stamped. Ops is told of let/sold and withdrawn, not of price changes.
- **Anti-loop**:
  - `pending_listing_actions` (SQLite, keyed by wa_id + property id) rows are
    DELETED after 24h — on read and by each run's sweep — so a reply days later
    reaches ordinary processing instead of answering a newer question.
  - One open question per number across `pending_agent_actions` and
    `pending_listing_actions`: setting either deletes the other.
  - Numbered-text delivery (no buttons) asks that agent nothing else that day.
  - A button is honoured whenever it arrives, but only against the listing's
    current state: closed / archived / under offer → "déjà mis à jour", no write.
  - Any price more than 50% from the one on record (new asking or closing) is
    read back for OUI first; a typed correction is itself re-checked.
- **Authorisation**: every handler re-reads the listing's agent and refuses a
  sender who is not its verified number, silently.
- **`postgres.setListingPrice`**: Postgres UPDATE inside BEGIN, SQLite
  `listings.price` written before COMMIT, SQLite restored on failure unless the
  price is found to have landed. Sets `lukka.change_source` for the price-history
  trigger. The WhatsApp path uses it now; web's price edits move onto it with
  the engine endpoint in the data-integrity phase.
- **Template (to submit in Meta WhatsApp Manager, UTILITY, fr)**:
  "Bonjour {{1}}, concernant votre bien : {{2}} ({{3}}). Est-il toujours
  disponible ?" — {{1}} first name, {{2}} "Appartement … à Kintambo — 1 300 $ /
  mois", {{3}} "Réf. …" or "annonce n° 310" (never an invented reference).
  Quick replies in this order: **Oui, disponible · Non, plus disponible · Prix
  modifié**. Then set `LISTING_AVAILABILITY_TEMPLATE` (read at call time).
  Until then asks are session messages and only reach agents active in the
  last 24h.
- Admin: quality flag `availability_unanswered` (last two WhatsApp questions
  unanswered, nothing confirmed since) and the dashboard card "Disponibilité
  sans réponse" (web `lib/moderationQueue.js`, `lib/adminWorkQueues.js`; both
  read the table only once `to_regclass` finds it).
- §40 of verify-pipeline.

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

## Listing photo auto-correction (2026-09-28)

`services/photoEnhance.js` (engine) and `web/lib/photoEnhance.js` (browser):
one conservative correction, deliberately duplicated (CJS vs ESM) — change
one, change the other; `web/tests/unit/photo-enhance.test.js` fails if the two
disagree on a single pixel. It corrects the camera, never the property:

- **White balance** from near-neutral pixels only, 60% of the estimate,
  ±12% per channel. A room that really is yellow or green has few neutral
  pixels and keeps its colour. No grey-world average.
- **Lightness (e3)**: never darker. No black-point shift; a white stretch
  only when the photo has no real white (gain ≤1.25); then a gamma curve
  x^γ moving the median toward `LIGHTNESS_TARGET` 0.60, γ clamped to
  [0.72, 1]. White balance raises the weak channels only (smallest gain 1)
  and fades out at pure white, so windows stay clean white.
- **Vibrance** on every hue by how unsaturated it is — never per channel
  (that shifts hue); near-grey pixels and the skin/beige band are protected.
  No sharpening (amplifies phone noise and JPEG blocks).
- **Web**: `lib/photoShrink.js` runs it on the canvas before encoding, in its
  own try/catch; always on, no agent toggle (product decision).
- **WhatsApp**: `uploadListingPhotos` runs it through `sharp` (new engine
  dependency). The object name still hashes the ORIGINAL bytes; a corrected
  photo is stored as `…_e3.jpg` (`ENHANCE_VERSION`), never over the original,
  because next/image caches a URL for 30 days. The local file in UPLOADS_DIR
  is never modified. Bump `ENHANCE_VERSION` whenever the correction changes.
- **After any bulk URL change, warm the storefront's image cache**:
  `node scripts/warm-image-cache.js` on the VPS. New URLs start with no resized
  variants, and a first resize costs ~600 ms per photo flip (web/CLAUDE.md,
  "Deployment", has the permanent cache this fills).
- **Existing photos**: `node scripts/backfill-photo-enhance.js` (dry run,
  saves previews + measures every photo; `--strength` previews another
  target) → `--write` (uploads `_e3` copies built from the ORIGINALS — an
  `_e2` URL is resolved to its untouched object, never re-corrected — warms
  them through `services/imageCacheWarm.js` BEFORE switching, repoints
  `featured_image` + `property_slider_images` per listing in one transaction,
  writes a rollback map) → `--rollback <file>` undoes it. Own bucket only;
  originals are never deleted. `services/photoBackfill.js`, §38.
- **e5 (2026-10-10, same day as e4):** e4 was liked for brightness but read
  "washed out". Three causes, three fixes, all in the shared pure module: the
  lift is applied to LUMINANCE and the channels are scaled together (a
  per-channel gamma pulled them toward each other and drained colour); it
  fades in below `SHADOW_TOE` 0.4 (blacks stay black — door and window frames
  had gone grey); and an S-curve of up to `CONTRAST_MAX` 0.8, scaled by how
  much the photo was lifted, restores midtone contrast. `toneCurve` never
  returns less than its input, so "never darker" still holds per level. Mean
  brightness equal to e4 or higher on the seven comparison photos. Objects are
  `…_e5.jpg`.
- **e4 (2026-10-10):** photos still read as dim ("too dark", owner report).
  `LIGHTNESS_TARGET` 0.60 → 0.66 and `LIGHTNESS_GAMMA_MIN` 0.72 → 0.62, picked
  from side-by-side sheets of seven live photos (0.72 / 0.55 was tried and
  flattened white rooms). Still lighten-only; objects are `…_e4.jpg`. Existing
  photos need `backfill-photo-enhance.js --write` again (it rebuilds from the
  originals, so an `_e3` URL is never corrected twice). The same day the card
  photo scrim (`--scrim-image`, web/app/globals.css) went from a 0→62 % ink
  fade over the lower two thirds to a faint fade on the bottom edge.
- **e3 (2026-10-02):** e2 made 107 of 215 live photos darker (black point
  pulled down, no white lift on photos with a window or white wall), against a
  light brand. e3 is never darker: measured on all 215, average +22 mean
  brightness, 0 darker. "Lighter" (0.60) was picked over "moderate" (0.55)
  from a preview of real photos. Pinned by the web "never darker" tests and §38.
- **e2 (2026-09-28):** e1 re-encoded at q85 mozjpeg 4:2:0, which softened
  edges on already-compressed WhatsApp JPEGs (reported "fuzzy"). e2 is q92,
  4:4:4 chroma, plus `sharpen({ sigma: 0.5, m1: 0.3, m2: 0.6 })` — measured
  +12-19% edge energy vs the original, no halos. The web path only encodes
  once from the camera original, so it gets no sharpen; it does draw with
  `imageSmoothingQuality = 'high'` (the default 'low' blurred the downscale).

## Kinshasa utility tags — engine half (2026-09-29)

`services/utilities.js` holds the ten codes (`snel_stable`, `groupe`,
`solaire`, `regideso`, `citerne`, `forage`, `gardiennage`, `cloture`,
`route_asphaltee`, `acces_facile`) — duplicated in web `lib/utilityTags.js`
and the CHECK of `migrations/20260929_listing_utilities.sql` (web's
`utility-tags.test.js` compares all three).

- **Extraction**: `parseMessage` fills `utilities` (strict enum in the schema,
  prompt section "SERVICES") from the agent's own words only — the same "never
  add a detail" rule as POINTS FORTS; `[]` is a correct answer.
  `normaliseUtilities` drops anything off the list.
- **SQLite** `listings.utilities` (JSON text, idempotent ALTER), correctable,
  inherited by multi-unit expansion.
- **Postgres**: `syncListingToPostgres` writes `utilities` on INSERT only, in a
  SAVEPOINT that tolerates 42703 (before the migration). Web's editor owns the
  codes after publication, so a WhatsApp correction's resync can never undo an
  agent's edit.
- **Backfill** `node scripts/backfill-listing-utilities.js [--write]`: re-runs
  `parseMessage` over `raw_text` (costs one OpenAI call per listing), fills
  blanks only, writes SQLite and Postgres. Not run yet.
- §45 of verify-pipeline.

## Commercial spaces — offices, shops, warehouses (2026-10-19)

`services/commercial.js` (engine), `web/lib/commercialSpaces.js` (duplicated,
compared by both test suites), `migrations/20261019_commercial_spaces.sql`.

- **"Commercial" is `property_categories.type = 'commercial'`**, the
  back-office's own flag (Bureau, Boutique, Entrepôt, Immeuble), never a list
  of names. The migration adds the missing **Bureau / Office** category
  (no id sequence on that table: MAX + 1 under a lock, skipped when a French
  "Bureau" exists). Before it runs, a WhatsApp "bureau" still lands on
  Bâtiment (`CATEGORY_FALLBACK_FR.bureau = ['bureau', 'batiment']`). The
  engine caches categories per process: restart it after the migration.
- **Four specs** on `properties` and SQLite `listings`: `office_count`,
  `floor_level` (0 = rez-de-chaussée, -1 = sous-sol), `road_frontage`,
  `truck_access`. NULL = not stated, never "no"; only a stated yes is shown.
  Gated on type everywhere: a residential listing stores none, and a
  correction that turns a shop into an apartment clears them.
- **Extraction** (both schemas, prompt "LOCAUX COMMERCIAUX"): an office's room
  count goes to `office_count`, never `bedrooms`; `normaliseCommercialExtraction`
  nulls bedrooms and drops "bedrooms" from `missing_fields` for a commercial
  type. "dépôt" is a warehouse, "dépôt de garantie" is not.
- **Sync**: written on INSERT only, in a SAVEPOINT tolerant of 42703 (same
  posture as `utilities`) — the agent's editor owns them after publication.
- **Buyer assistant**: `search_properties` accepts `commercial` (category
  type) and `bureau` / `boutique` / `entrepot`.
- **Web**: reads go through `to_jsonb(p)` (`commercial_specs`), so nothing
  42703s before the migration; writes (`setListingCommercialSpecs`) re-check
  the category in SQL and report `'unavailable'` before it. Search:
  `?property_type=commercial`, a "Locaux commerciaux" facet only when ≥2
  commercial types have listings, a "Bureaux & commerces" group in every type
  picker and one homepage tile; landing pages `/location|vente/bureaux` and
  `/locaux-commerciaux` (an overlay facet like parcelle, never in an
  all-types total). Agent forms swap "Chambres" for the specs and read
  bathrooms as "Toilettes".
- **Not done**: the admin listing editor does not edit the specs yet; the
  storefront has no commercial-only filters (surface range, frontage).
- §53 of verify-pipeline; `web/tests/unit/commercial-spaces.test.js`.

## Cities beyond Kinshasa (2026-10-20) — engine half

Lubumbashi, Likasi, Kolwezi, Goma, Bukavu, Kisangani, Mbuji-Mayi, Kananga,
Matadi, Boma and Muanda, same shape as Kinshasa. `services/cities.js` is the
registry; `drc_locations.json` the data (Kinshasa stays in
kinshasa_locations.json, untouched). §58 of verify-pipeline.

- **Commune keys are unique nationwide.** Communes are stored as text in a
  dozen tables (leads, agents.primary_communes, developments,
  viewing_requests…), and Boma has a Kalamu (like Kinshasa) and a Kabondo
  (like Kisangani). A colliding name carries its city: "Kalamu (Boma)",
  "Kabondo (Kisangani)", "Kabondo (Boma)". Kinshasa's keys are never
  suffixed. `communeLabel` is how a key is shown; the key is also the
  commune amenity's name in both languages, so every `ac.name = commune`
  join keeps working.
- **Quartier data has sources or nothing.** Wikipedia (fr) gives full lists for
  Lubumbashi, Likasi and Goma, partial for Mbuji-Mayi and Kisangani, none for
  Kolwezi, Kananga, Boma, Bukavu (5 communes, owner-confirmed) and most of
  Matadi; an empty list means no source, never no quartiers. Muanda has no
  published communes: its listings carry the city and no commune.
  `drc_quartier_aliases.json` holds the owner's 2026-10-20 list as
  `status: "pending"` — several entries contradicted the published lists or
  named communes as quartiers, so none is read until a local agent confirms it
  (`"confirmed"` + who). Same rule as Kinshasa's aliases.
- **Resolution** (`services/locations.js`): with no city, a name Kinshasa also
  has keeps its Kinshasa reading — exactly what it meant before ("Industriel"
  → Limete). A city (the model's `city` field, the draft's, or a commune only
  one city has) restricts every lookup to that city ("Industriel" in
  Lubumbashi → Kampemba). A name two other cities share is asked, never
  guessed. A commune named like its own city (Lubumbashi, Goma, Matadi…) is not
  indexed as a place: every address there ends with it.
- **Intake**: `parseMessage` returns `city` (strict enum, null unless the
  message places the listing); SQLite `listings.city` (idempotent ALTER,
  correctable, inherited by units). The card adds "*Ville* : …" outside
  Kinshasa only; "Quartier, Commune" labels close with the city outside
  Kinshasa ("Bel-Air I, Kampemba, Lubumbashi").
- **Publish**: `syncListingToPostgres` sets `city_id` from the commune's city,
  else `listings.city`, else Kinshasa; a city the taxonomy lacks THROWS (never
  published as Kinshasa). The commune amenity comes from `location_communes`;
  before that table exists, Kinshasa's 24 hardcoded ids. Address and
  publish-time geocoding name the listing's city.
- **`location_communes`** (Postgres, `scripts/migrate-multi-city.js`, dry run
  by default) replaces `amenity_id BETWEEN 21 AND 44` everywhere in the engine:
  a 25th commune would have fallen outside that range (45–54 are equipment).
  RLS on, nothing granted. The script also adds the missing `property_cities`
  rows under their existing provinces. **Run it before deploying this engine**
  — the queries name the table. web/ still has ~25 files with the old range.
- **Buyer assistant**: `search_properties` / `get_location` take `city`; a
  commune search with no results widens to its CITY (`buildFilters` →
  `p.city_id`), not the country.
- **Visit clocks**: Katanga, the Kasaïs, Tshopo and the Kivus are UTC+2.
  `visitSchedule`'s functions take `{ utcOffset }` (default +1); viewing
  notifications, the bon de visite, the admin PATCH, the owner list's
  `requested_slot_at` and the digest's visit times pass the visit's commune
  offset (`viewing_requests.commune`). Scheduler hours stay Kinshasa hours.
- `GET /locations?city=` (default Kinshasa — the current web sees no change)
  also returns `cities` (keys + labels).
- **Not done yet**: the web half (city picker, gazetteer, centroids, map views,
  the ~25 `BETWEEN 21 AND 44` queries, web listing creation's hardcoded
  Kinshasa city_id), commune centroids (geocode on the VPS), new cities hidden
  on the storefront until they have 3–5 approved listings (owner decision).

## Short-term vs long-term rentals (2026-10-21)

Some rooms, studios and furnished flats in Kinshasa are let by the day or the
week. **No new column**: a rent quoted per day IS the short-term listing, so
the fact lives in `price_period`, which now also takes `'jour'` and
`'semaine'` beside `'mois'` / `'an'` / `'total'`. Long term is the standard
and the default — a rent with no period, or a monthly / yearly one.
`properties.price_period` is plain text with no CHECK, so nothing to migrate.

- `services/leaseTerm.js` (duplicated in `web/lib/leaseTerm.js`, compared by
  web's `lease-term.test.js`): `shortTermSql` / `longTermSql`, `periodSuffix`.
- **Extraction** (both prompts and the Gemini parser): "50$/jour", "la nuitée",
  "location journalière" → `jour`; "à la semaine" → `semaine`; never converted
  to a monthly figure. Without that wording a rent is long term.
- The intake card, publish receipt, availability check and moderation alert
  print "/ jour" / "/ semaine". The buyer assistant's `search_properties` takes
  `lease_term: 'short' | 'long'` (`propertyRepository.buildFilters`).
- **A short-term rent never enters a monthly median** (`marketSnapshot`, and on
  web every `price_period = 'an'` normalisation): its amount is NULL there,
  never multiplied by a guessed occupancy.
- §64 of verify-pipeline.

## Property types: Immeuble, Villa, Concession (2026-10-22)

`migrations/20261022_property_types_immeuble_villa_concession.sql`. Types are
`property_categories` rows, not an ENUM, so every dropdown follows the table.

- **Bâtiment (id 38) is renamed Immeuble** (French name + slug; English stays
  "Building"). Same id, so nothing on `properties` moves. **Villa** and
  **Concession** ("Compound" in English) are new residential categories,
  ids MAX + 1 like Bureau's.
- **Extraction**: `concession` joins PROPERTY_TYPES (both schemas, Gemini
  parser too), with a prompt rule — the word "concession" for the property
  itself (large walled plot sold or let whole, in ares / hectares), never a
  mining / forest / burial concession. A concession is not asked for bedrooms.
- **Publish** (`resolveCategory`): villa → Villa, else Maison; concession →
  Concession, else Terrain; immeuble and bureau's fallback find the building
  category under either name; a parcelle sub-typed villa → Villa, else Terrain
  as before. Restart the engine after the migration (taxonomy cache).
- **Buyer assistant**: `search_properties` takes villa, concession, immeuble
  (`CATEGORY_NAME_BY_SEARCH_TYPE`, Immeuble also matched as "bâtiment").
- Web half: web/CLAUDE.md, same heading. §53 of verify-pipeline.

## Practical listing details and four more types (2026-10-22)

`services/listingDetails.js`, `migrations/20261022_listing_details.sql`
(web half: web/CLAUDE.md, same heading). §65 of verify-pipeline.

- **Twelve nullable `properties` columns**, NULL = not stated: `furnished`
  (extracted since launch, never synced until now), `households_count`
  ("4 ménages dans la parcelle"), `landlord_on_site`, `has_generator` /
  `has_pool` / `has_gym` / `has_solar` (true or NULL, never false — an
  unticked box is "not stated"; `migrations/20261022_listing_equipment.sql`),
  `electricity_meter`
  ('prepaye' = Cash Power | 'individuel' | 'partage'), `plot_dimensions` (as
  written: "15/20", "5 ares", "1 ha"), `plot_area_m2`, `installments_available`
  / `installment_terms` (paiement échelonné, the agent's own words). Same
  columns in SQLite `listings` (idempotent ALTER), correctable, inherited by
  multi-unit expansion where they belong to the address.
- **`plot_area_m2` is never the model's arithmetic**: the prompt says to copy
  the size as written, and `parsePlotArea` computes it (ha > ares >
  dimensions > m²) on extraction, insert and every correction. Duplicated in
  web/lib/listingDetails.js; both suites run the same fixture table.
- **Gated on the kind of property** (`normaliseListingDetails`): no
  household facts on land or commercial space, no equipment on bare land, no plot on a flat /
  studio / room / office / shop, no instalments on a rent. Applied after the
  model, at insert, at correction (the draft's type decides) and at sync.
- **Sync**: INSERT only, SAVEPOINT tolerant of 42703, same posture as utilities
  and commercial specs — the agent's editor owns them after publication.
- **Three categories** (residential): Studio, Chambre / Annexe, Ferme /
  Terrain agricole. Extraction types `studio` (existed), `chambre`, `ferme`;
  each falls back to Appartement / Appartement / Terrain before the
  migration. Existing listings are not re-filed. The buyer assistant searches
  all three.
- **Removed the same day, on owner review**: toilet / shower location (columns
  dropped — no row held one) and the "Salle de fête" category (deleted — no
  row used it). SQLite keeps two unused toilet / shower columns.
- The intake card prints every stated detail ("*Terrain* : 15/20 (300 m² · 3 ares)").

