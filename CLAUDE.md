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
  {property_type} à {commune} — {price}
  Réf. {reference}

  Est-il toujours disponible ? Si oui, quand serait-il possible de le visiter ?

  https://lukkaplace.com/listings/{id}
  ```
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
  - **The list pane is unchanged** — still paginated on the full filters, location included.
  - **Positions**: stored coordinates, else the commune centroid (flagged `approximate`), else no pin and counted `unlocated` — never a made-up point. `/listings` no longer geocodes listings in the browser at all; `PropertyMap`'s client cascade above now serves only the detail page. One compact pill states listings in view; its ⓘ button opens the breakdown (on a centroid, matching but unplaceable, truncated) rather than stacking three pills over a phone-sized map.
  - **Index**: `migrations/20260916_properties_geo_index.sql`, a partial expression index on `LAT_EXPR`/`LNG_EXPR` (`latitude`/`longitude` are TEXT, so a raw-column composite could not serve a numeric range). The planner needs the identical expression — `web/tests/unit/map-viewport.test.js` compares the two texts.
- **Publish-time geocoding** (`services/geocoding.js`): after COMMIT, `syncListingToPostgres` fills blank `latitude`/`longitude` with the same landmark rule and precision check as the client cascade (a commune outline is refused, a key/quota refusal throws rather than cascading). Needs `GOOGLE_MAPS_SERVER_KEY` (IP-restricted; requests go out over IPv4 because the VPS is dual-stack). Never overwrites an existing coordinate; a correction that changes quartier, commune tag or landmark reference clears the old one first. Backfill: `node scripts/backfill-listing-coordinates.js [--write]`. §30 of verify-pipeline.
- **Markers**: classic `google.maps.Marker` instances (not the newer `AdvancedMarkerElement` — that needs a Cloud Console Map ID and wasn't necessary here; `Marker` still works, just prints a deprecation warning), each rendered as a dense price tag. **No clustering, at any zoom** — every listing is its own price tag, on an explicit product direction (clustering was re-added with the viewport map and removed again the same day, 2026-09-14; `@googlemaps/markerclusterer` is still in `web/package.json` but imported nowhere). Stacking: higher price in front, a building one above its priciest unit, the hovered/selected pin above everything. Co-located pins are separated by the fan described above.
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

Five jobs are registered, in order: `search-alerts`, `viewing-sla`,
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

## Verification & Commands
- **Verification Command**: Always run `npm run verify` before declaring a backend task complete.
- **Test Coverage**: Do not touch schema fields without updating `scripts/verify-pipeline.js`.
