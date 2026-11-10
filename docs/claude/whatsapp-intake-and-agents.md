# WhatsApp intake, agent onboarding and accounts

> Moved verbatim from the root CLAUDE.md on 2026-11-06 to keep it short. The rules in CLAUDE.md
> still bind; this file is the detail and history. When you change this area, update this file
> (a dated section: what, why, env vars, the verify-pipeline §). "See X below/above" may point to a
> section now in another docs/claude file: `grep -rn "X" docs/claude`.

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

The "names a kind of property" half is a word list (`FAMILY_WORDS`, copied in
`group-reader/lib/prefilter.js`). A word missing from it costs a whole
listing: on 2026-11-01 "Plusieurs Morcellements … prix 700 000$" (land, never
saying "terrain") arrived while the agent's apartment was in the 7-day
correction window, the model called it a correction, the boundary saw no
property, and it was stored nowhere. *morcellement(s)* / *lotissement(s)* now
count as land on both sides.

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
  and — **only with `GROUP_CAPTURE_PUBLISH=on`** — published to the approval
  queue at once: no "OK", no onboarding, no quota. **Since 2026-11-05 (owner)
  the default is off: a capture stays a draft that is never published and
  only feeds the price guide** (marketSources/whatsappGroup.js reads it);
  draftAutoSubmit skips group captures, and the relay receipt says
  "enregistrée pour les prix du marché (non publiée)". **Per group
  (2026-11-09, owner): `GROUP_CAPTURE_PUBLISH_GROUPS`** (comma-separated
  JIDs, read at call time) publishes only the groups whose admins agreed to
  have their listings taken — Prince immo tout kin
  (120363344702370143@g.us) first; the other groups stay prices-only. A
  relay burst names no group and follows `GROUP_CAPTURE_PUBLISH` alone.
  With publishing on:
  no photo → kept as a draft (photo rule), named in the receipt.
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
  only when the account has no password — a password and its sessions are kept
  — and never with `issue_link: false` (the profile checkbox, which also
  verifies through here).
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

### An agent's other WhatsApp numbers (2026-11-03)

`services/agentNumbers.js`, Postgres `agent_whatsapp_numbers`
(`migrations/20261103_agent_whatsapp_numbers.sql`). Agent #50 (Ayang
services) holds +243 974 585 309 but WhatsApps every listing from
+243 910 314 309, whose only `agents` row was their own deleted first attempt
(#49, the name-fold bug of 2026-10-20). Attribution matched the sender against
`agents.phone` alone, so 15 listings arrived unattributed and were assigned by
hand.

- **The team links the number** on the console's agent page ("Numéros
  WhatsApp d'envoi", `agents.manage`, audited + timeline note) →
  `POST/DELETE /admin/agents/:id/whatsapp-numbers` (requireApiKey). Like
  admin-verify, nobody proves the number: the team vouches. Linking claims the
  listings already filed under it (`claimListingsForNumber`); unlinking moves
  nothing back.
- **The three lookups accept it**: `identifySender` (greeting, attribution
  stamp, no onboarding ask), `resolveAgentId` (publish-time `agent_id`, and
  the claim), the WhatsApp quota. The account's own phone wins when both
  match, and every gate (`phone_verified_at`, `deleted_at`) is still the
  AGENT's. Not covered on purpose: the number is never public, never dialled
  by a CTA and never sent alerts (`agents.phone` stays that), and button taps
  are authorised against the number the alert went to.
- **Refused**: the agent's own phone, any live agent's phone, ours, one
  already linked (UNIQUE), a deleted agent. A number held only by a deleted
  account is allowed — that was this case.
- **Before the migration** nothing 42P01s: `extraNumbersAvailable` asks
  `to_regclass` (a yes is cached for the process, a no for a minute) and the
  old phone-only SQL runs; the console says the migration is missing.
- §68 of verify-pipeline; `web/tests/unit/agent-whatsapp-numbers.test.js`.

### What the agent sent, for the admin's review mode (2026-11-10)

`services/listingSource.js`, `GET /admin/properties/sources?ids=` (≤100,
read-only), verify-pipeline §96. Per property: the SQLite listing behind it
(`remote_property_id`, newest), its `raw_text`, and the sender's INBOUND
`whatsapp_message_log` rows from 15 min before to 30 min after the draft's
`created_at` (at most 12, oldest first; SQLite's `YYYY-MM-DD HH:MM:SS` is UTC).
No SQLite row = `channel: 'web'`. Web shows them as the queue's grey line and
in review mode beside what we extracted (web/CLAUDE.md, "Review mode"). The
`raw_text` can be empty when the listing was read from a photo: the messages
are the only record of what was typed then.

### Same agent, same listing — held and asked (2026-11-10)

Owner decision: the same property with ANOTHER agent is fine (co-mandates);
the SAME agent sending the same property twice is not. `services/resendGuard.js`,
verify-pipeline §95. Web half (flags, comparison, cleanup): web/CLAUDE.md,
"Duplicate listings".

- **Measured first** (production, 405 live/pending listings): 96 same-agent
  pairs shared ≥1 identical photo, but 76 of them were units of ONE message
  (created minutes apart, different bedrooms or prices — a building's units
  keep the building's photos). ~20 were real re-sends days apart (#472/#746:
  20 of 20 photos; #646/#790: same title, price, référence, quartier,
  bedrooms, 5 days apart). "Same title and price" was weak: 55 of its 68
  same-agent pairs shared no photo (generic titles, different flats).
- **The rule**: a draft repeats an earlier listing when the earlier one is
  live or pending (not deleted, rejected, hidden or closed), from the same
  verified agent or the same WhatsApp number, same transaction, same bedroom
  count (or either unstated), and shares ≥1 photo fingerprint or the
  identical message text (≥40 folded characters).
- **Photo fingerprints are in the stored name**: `whatsapp_<md5[0:13]>` of the
  original bytes (services/supabaseStorage.js `contentHash`), web
  `agent_<md5[0:13]>`. The full URL always differs (it carries the listing id),
  which is why the old URL comparison never caught a re-send. A photo re-sent
  from a phone gallery may be recompressed by WhatsApp and get a new
  fingerprint; the identical-text check still catches a pasted re-send.
- **At "OK"** (and the conversational confirmation), after the photo and quota
  gates: a re-send is not published; the agent is told which listing it
  repeats, why (N identical photos / the same text), where to edit it
  (/compte/agent/biens) and to reply **AUTRE** if it is another property.
  `parsed_json.resend_of` holds it; "AUTRE" (only on a held draft) sets
  `resend_cleared` and publishes. `draftAutoSubmit` never sends a held draft
  to moderation and drops it from its list until AUTRE (silent, like the job).
- **Fails open**: Postgres unreachable or any error → publishes as before.
- **The team taking a live copy offline** tells the agent which listing stays:
  `POST /admin/properties/:id/notify` status `withdrawn_duplicate` with
  `keep_id` (text only, no template).

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
  **A "Code Lukka Place" message that matches nothing is answered, never sent
  to intake** (2026-10-26: a customer's account was on her +243 number, her
  WhatsApp on a +33 one, and every code got the agent how-to reply). The
  code is open for another number → the reply names both numbers' last four
  digits and the signup link for that role; no open code → "plus valable,
  nouveau code sur le site". Only the prefilled wording triggers it — a bare
  6-digit price still falls through.
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
  (pinned in §24; `listing-auto-pause` now sits just before `sqlite-backup`).

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

## "Faites le point sur vos annonces" — one request per agent (2026-11-09)

Replaces the per-listing question below (owner decision). Measured before the
change: 35 agents hold ~380 live listings, 12 of them three quarters; one has
49, so at 3 questions a day every 14 days that agent was asked every day. The
three days it ran (2026-11-03→05) sent 13 questions: 4 "disponible", 8 never
answered, 1 "loué" that never gave its price. 4 of 380 listings had ever been
confirmed, and no rental or sale had a recorded price.

- **The job** (`services/agentStatusCheck.js`, still job `listing-availability-check`,
  same `AVAILABILITY_CHECK_HOUR` and `AVAILABILITY_CHECK=off` switch, which is
  still set in production): ONE message per agent with a verified phone,
  active and not deleted, who has a public listing (active, under offer, or
  auto-paused) unconfirmed for 14 days, and no request in 14 days. Confirming
  everything puts the whole portfolio on one clock. No reminder is ever sent.
  An agent who still owes another answer (`hasOpenAgentQuestion`) waits a day.
- **Record**: Postgres `agent_status_requests`
  (`migrations/20261109_agent_status_requests.sql`): one row per request, only
  the SHA-256 of the link's token, `expires_at` (7 days), delivery, opened_at,
  answers_count, all_confirmed_at. Claimed before the send, deleted when
  nothing went out. Without the table the job refuses to run.
- **Delivery**: template `LISTING_STATUS_TEMPLATE` (read at call time; link
  button first = `https://lukkaplace.com/point/{{1}}`, then the quick reply
  "Rien n'a changé" with payload `status_ok:<request id>`; `chakra.sendTemplate`
  now numbers quick replies from 1 when a link button is present). Without it,
  a session message with the link and an interactive button — and an agent
  outside the 24 h window is skipped WITHOUT claiming the cycle.
- **"Rien n'a changé"** (`handleStatusButtonReply`, routed before the old
  availability buttons): only the request's agent from their verified number,
  only while the link is valid; stamps every live listing (never an
  auto-paused one), writes one `listing_availability_checks` row each
  (`AVAILABLE` / `STILL_UNDER_OFFER`, `request_id`), and replies with a soft
  "si l'une d'elles est louée, touchez « Mettre à jour »".
- **The page** is web's (`/point/<token>`, web/CLAUDE.md "Faites le point").
- **Auto-pause** (`services/listingAutoPause.js`, job `listing-auto-pause`
  before `sqlite-backup`, 6h Kinshasa): **OFF** unless `LISTING_AUTO_PAUSE=on`
  (owner: switch on in about a month). Hides (`status = 0`,
  `properties.auto_paused_at`) a listing unconfirmed for 30 days whose agent
  was sent a request after that date, at least 3 days ago. Never deletes,
  never messages; the page lists it first with "Réactiver".
- The old per-listing answer handlers below still serve questions already
  sent; `runAvailabilityCheck` is no longer scheduled. §93 (and §40).

## "Toujours disponible ?" on WhatsApp — every 14 days (2026-09-29) — REPLACED 2026-11-09, see above

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

## Where accounts come from — engine half (2026-10-27)

`migrations/20261027_growth_attribution.sql` (Postgres: page-view campaign
columns, `visitor_touches`, `partners` / `partner_clicks` /
`partner_conversions`, `account_acquisitions`; one code namespace with
`sales_reps.referral_code`, enforced by triggers). Web owns almost all of it —
web/CLAUDE.md, "Where visitors and accounts come from". Engine side:
`services/accountAcquisition.js`, called from `upsertAgentFromWhatsApp` for an
account created there, in its own SAVEPOINT: `channel` whatsapp or admin, and
the rep's code when `attributeNewAgentInTransaction` attributed one (it now
returns `code`). A missing table records nothing; the account never depends
on it. §66 checks both channels.

## Growth launch — engine half (2026-10-27)

web/CLAUDE.md, "Referral credits, ad tracking and the launch pages", has the
model. Engine pieces:

- **`services/customerOnboarding.js`**: "Inscription Lukka Place (— Code :
  X)" creates a verified CUSTOMER in Postgres (one transaction, per-number
  advisory lock), credits the code's partner (never an agent's own number),
  writes `account_acquisitions` (channel whatsapp) and replies with a 72 h
  single-use link to web `/compte/activer` (only the SHA-256 stored). Routed
  in `routes/webhook.js` before the sales referral, with the listing-enquiry
  guards (no draft, no media). Matches only the pre-typed start, never
  "parrainage". An existing number is pointed to its login.
- **`services/growthDaily.js`**: job `growth-daily` (registered before
  `sqlite-backup`, pinned in §24), `GROWTH_DAILY_HOUR` (default 7 Kinshasa).
  Web `POST /api/cron/growth-daily` writes the agents' referral credits and
  returns yesterday's summary; the engine sends it to `ADMIN_ALERT_NUMBERS`
  (else the desk) via `sendDeskAlert`. `GROWTH_DAILY_SUMMARY=off` keeps only
  the credit run. A failed credit run fails the job (ops alerts report it).
- `db.countLeadsByWaIds` also returns `firstViewingAt` (the credit rule's
  "visit request" action).
- §67 of verify-pipeline.
- **The referral announcement when an agent writes in**
  (`services/referralAnnounce.js`, 2026-11-03). The inbound loop reads the
  number's previous message time, records the new one, then schedules a
  check 45 s later — a side effect, the message is processed unchanged. For a
  verified agent (identifySender), at most once per number per 12 h in this
  process, never the desk or the relay, it asks web
  (`POST /api/internal/referral-announce`, Bearer CRON_SECRET), which sends
  the text to an agent never announced, or re-sends once when the earlier
  session announcement could not have landed (no message from them in the
  23 h before it). `REFERRAL_ANNOUNCE_ON_WRITE=off` disables. Run
  `migrations/20261103_referral_announcement_channel.sql` first. §68.
