# Lead routing, enquiries and agent matching

> Moved verbatim from the root CLAUDE.md on 2026-11-06 to keep it short. The rules in CLAUDE.md
> still bind; this file is the detail and history. When you change this area, update this file
> (a dated section: what, why, env vars, the verify-pipeline §). "See X below/above" may point to a
> section now in another docs/claude file: `grep -rn "X" docs/claude`.

## Lead Routing Rules

> **Superseded 2026-11-09** (owner decision): the WhatsApp button now goes
> through the Lukka Place number first — see "WhatsApp through Lukka Place
> first" at the end of this file. The call button still goes to the agent.
> The text below is the earlier rule, kept for its history.

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

- **Without its link (2026-11-10).** A customer sent the storefront text with
  no URL (no web builder omits it: every caller of `buildWhatsAppMessage`
  passes the listing id, so it was removed in the chat). The fixed opening
  "je vous contacte via Lukka Place au sujet de ce bien" now identifies the
  enquiry on its own (`parseLinklessEnquiry`): the facts line (type, "quartier,
  commune", price) and the Réf. line are matched against live listings
  (`propertyRepository.findLiveListingsForEnquiry`: same price and/or the same
  reference under the public filter, then type, commune and quartier in JS).
  Exactly one match is handled like a link. None or several: a lead with no
  listing (`listing-whatsapp-enquiry`, `property_id` NULL, "annonce non
  identifiée"), a desk alert naming the candidates, and a reply asking for the
  listing's link — never the agent help; one lead and one alert per 24 h. The
  opening also lifts the no-media guard, since customers send it with a
  screenshot. §97.

## Automated Agent Matching (live)

> **Changed 2026-11-10**: requests now go in waves with a one-tap claim — see
> "Matching in waves" at the end of this file. The trigger, the ranking SQL and
> the `lead_matches` / `lead_proposals` split below still hold; "the best
> seven at once", the responsiveness multiplier, the ×1.05 up-to-date boost
> and the template note do not.

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
- **Up-to-date portfolio preference (2026-11-09, owner decision)** — an
  incentive to answer the fortnightly availability check. An agency whose
  public live listings (`status = 1 AND approve_status = 1 AND listing_status
  IS DISTINCT FROM 'closed'`, at least one) are ALL up to date gets ×1.05 on
  its adjusted score and wins an exact tie (`UP_TO_DATE_BOOST` in
  `leadDispatch.js`, `upToDateAgentIds` in `agentRanking.js`). Up to date =
  `availability_confirmed_at`, else the later of `created_at` / `moderated_at`,
  within 14 days — the same rule as web's `UP_TO_DATE_SQL` (web/CLAUDE.md,
  "Incentives for keeping listings up to date"); change both together. Smaller
  than the responsiveness and fairness bands on purpose: it reorders near-ties,
  never outranks a clearly better match, and never removes anyone. The columns
  are read through `to_jsonb(p)`; any read failure means no boost for anyone.
  The shared agent gate is unchanged. verify-pipeline §92.
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

## Profile enquiries and unverified agents (2026-11-03)

- **"Demandez ce bien à cet agent"** (web `agents/[id]` form) now sends
  `agent_id`, and `POST /admin/leads` hands a `agent-profile-inquiry` lead to
  `services/agentProfileEnquiry.js`. Before, the lead named no commune, so
  `leadDispatch` skipped it and nobody was told (lead #21 sat unseen from
  2026-10-25). The lead is assigned to that agent (their Demandes inbox), the
  agent is alerted only through `directRoutingBlocker` (and not when the
  account is deleted), and the desk always gets a copy that says whether the
  agent was reached — and, when the agent has not written to us in 24 h
  (`sessionWindow`), that the session message probably did not land. Same
  recipient rule as listing and project enquiries: never the ranked agencies.
- **Unverified agent sending a listing**: `identifySender` still attributes
  nothing and `shouldOnboard` still stays quiet, but the intake reply now
  carries `agentOnboarding.unverifiedAccountNote` — "compte pas encore
  vérifié", log in at /compte/agent/connexion and send the code shown (or the
  support number when the account has no password). Never verified from the
  message itself: only the password holder can open a code. Measured
  2026-11-03: agent #103 opened an agent account, never sent its code, then
  opened and verified a customer account on the same number; the two
  accounts are independent and WhatsApp intake never reads `customers`.
- §69 of verify-pipeline.

## Customer → agent interactions, counted (2026-11-04)

Reported 2026-11-04: a customer reached a commissionnaire from the site, the
desk phoned him, and he WhatsApped the customer from his own phone. None of it
existed on our side: a chat between two personal numbers is invisible to this
system by construction, so it is only ever counted if somebody records it.

- **"Mise en relation"** (`services/teamIntroduction.js`,
  `POST /admin/team-introductions`): a `leads` row, source
  `'team-introduction'`, assigned to the agent (`db.recordTeamIntroductionLead`,
  one transaction) so it sits in their Demandes inbox, where they mark it
  CONTACTED. New lead columns `contact_channel` (phone | whatsapp | in_person |
  other) and `recorded_by` (idempotent ALTER). Status CONTACTED when the desk
  says the agent already reached the customer, else NEW. No commune, so
  `leadDispatch` never pushes it; nothing is sent to anybody.
- **`GET /admin/interaction-counts?days=`** (`db.getInteractionCounts`): the
  engine half of web's `/admin/interactions` — `INTERACTION_LEAD_SOURCES`
  (listing WhatsApp enquiries, profile and project requests, introductions)
  and viewing requests, grouped by agent and listing; `contacted` = moved past
  NEW (viewings: `first_response_at`, or a recorded `direct_contact_at` since 2026-11-07 — see docs/claude/viewings.md, "Direct contact"). Not "Trouver pour moi" searches (several
  agencies) and not `listing-visit-request` leads (counted once, through their
  viewing request). Web adds the storefront taps and names the agents.
- §71 of verify-pipeline.

## "Un client vous contacte": the agent is told at the tap (2026-11-08)

Owner request 2026-11-08, after a customer → agent WhatsApp chat went unseen:
when a customer is trying to reach an agent, tell the agent straight away.
The tap on a verified agent's WhatsApp / "Appeler" button is the one moment we
know (web already stores it); what follows is between two personal numbers.

- **Web** (`lib/contactTapAlert.js`): `/api/telemetry/lead-click` (DIRECT_WA)
  and `/api/track` `call_click` (DIRECT) call the engine in `after()`, only
  for `viewer_kind = 'visitor'` — never the agent, team, bots, prefetch, or a
  central-number tap.
- **Engine** (`services/contactTapAlert.js`, `POST /admin/contact-taps`):
  public listing + the shared agent gates (`directRoutingBlocker`, not
  deleted), then "🏠 [Lukka Place] Un client vous contacte" to the agent with
  the listing and two buttons, `contact_tap_replied|nothing:<id>`
  ("J'ai répondu" / "Rien reçu"; "On s'est parlé" / "Aucun appel" for a call).
  Only the alerted number can answer; the first answer stands. No buttons →
  the alert still goes as plain text, without the question.
- **Stored** in SQLite `contact_tap_alerts` (written before the send, so two
  taps a second apart alert once). Dedupe: one alert per listing per visitor
  per 24 h, one per listing per 30 min whoever tapped.
- **It does not know the customer**: a tap is anonymous and is not a message;
  the text says "vient d'appuyer", never "vous a écrit".
- **Shown** on `/admin/interactions`: "Agents prévenus en direct de N taps :
  X ont confirmé avoir répondu" and a per-agent "Réponse confirmée" column
  (`getInteractionCounts().contactTaps`). Never added to a total.
- **Delivery**: a session message, so it reaches an agent who wrote to our
  number in the last 24 h only; a Meta template is the follow-up.
  `CONTACT_TAP_ALERT=off` disables it.
- §85 of verify-pipeline; web `tests/unit/contact-tap-alert.test.js`.

## "Mon déménagement" requests carry the customer's story (2026-11-07)

Web's card-by-card signup (web/CLAUDE.md, same heading) asks why the customer
is moving. Nothing is sent to agencies from the cards; only the customer's
"Envoyer ma demande aux agences" tap on `/compte/client/projet` creates a lead,
`source = 'move-project'`, through the same `POST /admin/leads` and
`dispatchLead` as "Trouver pour moi".

- **`leads.move_story`** (TEXT, idempotent ALTER): the story in French, built
  by web's `moveStoryFr` from the answers ("Projet : nouveau travail · 5–6
  personnes · quitte un appartement à Lingwala · entrée : dans le mois").
  Whitespace-folded and capped at 500 characters by the route. NULL on every
  other lead.
- **The plain-text agency alert prints it** (`fallbackText`, one `•` line). The
  approved template has no slot for it, so a template send does not carry it;
  the agent's dashboard card does either way, because the story also opens the
  lead's `requirements_summary` (AgentLeadCard shows three lines).
- Why the questions are on the web account and not WhatsApp: a WhatsApp
  question only reaches someone inside the 24-hour window, and a cold customer
  needs a template for every one.
- §80 of verify-pipeline.

## "Mon déménagement": the 24-hour promise and the end of a move (2026-11-07)

- **The project page promises** "Si aucune agence ne vous a écrit sous 24 h,
  l'équipe Lukka Place vous contacte". `services/moveFollowup.js`
  (`move-request-followup`, every 15 min, before `sqlite-backup`) keeps it: a
  `move-project` lead 24 h–7 days old, status NEW/CONTACTED/QUALIFIED, with no
  `lead_proposals` row, goes to the ops desk (`sendDeskAlert`, desk template
  when set) with the customer's number and story and the admin link. The
  customer is not messaged by the engine (they are cold); a person calls.
  `leads.followup_alerted_at` is stamped after the attempt, whoever was
  reached, so nobody is told twice; "nobody told" is logged when
  `OPS_WHATSAPP_NUMBER` is unset. `MOVE_FOLLOWUP=off` disables. §81.
- **"C'est le bon !"** on web sets the project's last lead to `CONVERTED`
  (`PATCH /admin/leads/:id`) — the first code path that reaches that status.
- **The no-account "Trouver pour moi" form** now sends the situation chips
  as `move_story` too (reasons only).

## Recording every customer ↔ agent interaction — first step (2026-11-09)

Gap analysis (artifact https://claude.ai/artifact/7zx3wa2XF3ps7bxHMdrE5J):
in 30 days, 102 taps on an agent's own WhatsApp button and 17 on "Appeler"
against 9 requests we could follow; 379 of 382 listings sent customers to
the agent's personal number. Owner decisions the same day: the listing
WhatsApp button will go through the Lukka Place number first (replacing the
dual contact policy above — not built yet), agents keep their own WhatsApp
but every dashboard tap is recorded, and customers get a 24 h "un agent vous
a-t-il contacté ?" follow-up once `suivi_demande_client` is approved.

Built in this first step:

- **Every WhatsApp message in and out** — SQLite `whatsapp_message_log`
  (`services/messageLog.js`), written by `chakra.js` after each send Chakra
  accepted (text, interactive with its button labels, template with its name
  and values) and by the webhook for each inbound (text, button id, media
  count; a redelivered wamid once). `MESSAGE_LOG=off` stops it. Read by
  `GET /admin/whatsapp-log?wa_id=` and shown as "Historique WhatsApp" on
  `/admin/customers/[id]` and the agent's Activité tab. The log starts
  2026-11-09; nothing is backfilled.
- **Dashboard taps** — `agent_contact_attempts` (`POST /admin/contact-attempts`,
  web `POST /api/agent/contact-attempt` with the agent from the session cookie
  and the Demandes ownership rules; `components/AgentContactLink.js` on the
  lead card, visit card, quick replies, alternatives "Ouvrir dans mon
  WhatsApp", "À faire" and the agenda). A NEW lead moves to CONTACTED with the
  channel; a double tap within 2 min counts once; a visit is only annotated
  (no status, no direct contact — opening WhatsApp is not proof).
  "J'ai déjà contacté le client" on a NEW lead card records source `declared`.
- **Bugs fixed**: `agentRanking` now applies the shared agent gate (verified,
  not deleted, routing not off — verification was only +10 points, so a lead
  could be pushed to an unverified or deleted agent); the lead-card reply box
  (`assertOwnedLead`, now web `lib/agentLeadOwnership.js` `findOwnedLead`)
  accepts dispatcher pushes and the lead's own agent_id.
- **The assistant's hand-over** (`handoff_to_agent`) now alerts the desk with
  the customer's number and a link to the conversation; it alerted nobody.
- Not in this step, folded into the CTA re-route: taps on the agent profile,
  directory, Projets neufs and Espace Client buttons (they will go through our
  number instead of being counted).
- §90 of verify-pipeline; web `tests/unit/agent-contact-attempts.test.js`.

## Contacts — every customer → agent contact, one row each (2026-11-15)

Owner, the same day as the switch below: "where can I see exactly which
customer contacted which agent, I can't be blind here". `/admin/contacts`
(Operations, `leads.view`) lists what `/admin/interactions` counts, one row
per contact: date, customer, agent, listing / project / page, channel, and
what happened next. Rules in web `lib/contactLog.js` (pure), reads in
`lib/contactLogLoader.js`, CSV through `/admin/export/contacts`.

- **Sources**: Postgres direct WhatsApp taps (`whatsapp_clicks` DIRECT_WA),
  direct call taps (`listing_events` call_click DIRECT), `agent_contact_taps`
  and `chat_threads`; engine `GET /admin/contact-log` (`db.listContactLog`):
  enquiries to our number, profile / project requests, desk introductions,
  visit requests (from `viewing_requests`, not their lead), and the tap
  alerts, paired with taps by `lib/contactTapMatch.js` (calls too). Customers'
  taps only; a tap to our central number is not listed (its message is). A
  repeat tap by the same visitor within 10 min is greyed and not counted.
- **Follow-up column**: taps — the alert and the agent's « J'ai répondu / Rien
  reçu »; enquiries — NEW or handled, and the customer's answer to the 24 h
  follow-up (NOT_YET → "Client : pas encore contacté"); visits — the status;
  Messagerie — whether the agent replied.
- **Who the customer is**: the number for anything that reached our number or
  a form; for a tap only when the customer was signed in —
  `whatsapp_clicks.customer_id` and `listing_events.customer_id` (call taps),
  from the customer session cookie (signature checked, not the DB). An
  anonymous tap stays "Anonyme": nothing is asked before WhatsApp opens.
- **Taps outside a listing were invisible** after the switch: the agent
  profile, the directory, project pages and the Espace Client visit /
  proposal cards opened the agent's WhatsApp and recorded nothing. Their
  direct links now carry `data-contact-*` (web `lib/contactTapAttrs.js`); one
  listener (`components/ContactTapBeacon.js`, in the (site) and (portfolio)
  layouts) posts `/api/telemetry/contact-tap` → `agent_contact_taps`
  (`lib/agentContactTaps.js`). The agent is resolved in SQL — a project's
  `developments.agent_id`, a listing's agent, or the named agent only if it
  exists and is not deleted. No agent alert for these taps.
- Migration `migrations/20261115_contact_log.sql` (two columns, one table,
  RLS on, anon revoked); everything reads through `to_jsonb` / `to_regclass`,
  so the page works before it runs. Each source is read alone: one down shows
  an error banner, never a silent gap; more than 5,000 rows in a source says so.
- §116 of verify-pipeline; web `tests/unit/contact-log.test.js`.

## WhatsApp straight to the agent again (2026-11-15)

Owner decision, reversing the section below: the storefront's WhatsApp
buttons go to the verified agent's own WhatsApp. Reason: customers had to
write twice — to our number, then again to the `wa.me` link our bot replied
with (screenshots from 2026-11-15, listings 850, 869, 883, 920) — and the
owner judged most would not. Lukka Place's number is no longer in the
conversation.

- **Web**: `routesViaLukka()` (`lib/leadRouting.js`) is false unless
  `NEXT_PUBLIC_WHATSAPP_DIRECT_TO_AGENT=off` (build time — a web rebuild is
  needed to change it). Unset and `=on` both mean direct. Same gate as before:
  only a verified, routable agent's number is ever used (lib/listings.js nulls
  it otherwise); everyone else still opens the central number, and
  `listingEnquiry` / `contactRelay` keep handling what arrives there (old
  links, unverified agents).
- **What is recorded** (nothing new to store): every tap is a
  `whatsapp_clicks` row with routing `DIRECT_WA`, agent, listing, button and
  visitor; a customer's tap sends the agent "Un client vous contacte" with
  « J'ai répondu / Rien reçu » (`services/contactTapAlert.js`, deduped 24 h
  per visitor + 30 min per listing, template outside the 24 h window), and
  the answer is stored on `contact_tap_alerts`. Taps count per agent in
  `/admin/interactions` (`whatsappDirect`).
- **Console**: `/admin/telemetry`'s tap log has an "Agent prévenu" column —
  A répondu / Dit n'avoir rien reçu / Prévenu · sans réponse / Alerte non
  envoyée / Déjà prévenu (clic précédent) / Pas d'alerte. Engine
  `GET /admin/contact-taps?property_ids=&since=` (`db.listContactTapAlerts`)
  serves the alerts for the page's listings; web `lib/contactTapMatch.js`
  pairs each with its tap on listing + visitor + time (alert within 2 min
  after the tap), since no column links the two rows. Engine down → "Non
  disponible", never "not told".
- **Still unknown, by construction**: whether the customer actually sent the
  message (a tap is not a message), and the customer's number unless they
  are signed in. Proof would need the agent's own number on the WhatsApp
  Business API (Meta "coexistence"), not checked for Chakra/DRC yet.
- §115 of verify-pipeline; web `tests/unit/contact-tap-match.test.js`,
  `tests/unit/whatsapp-via-lukka.test.js`, `tests/unit/lead-routing.test.js`.

## WhatsApp through Lukka Place first (2026-11-09 — reversed 2026-11-15, see above)

Owner decision after the gap analysis (102 direct WhatsApp taps in 30 days,
nothing recorded after any of them). Replaces the dual contact policy above
for WhatsApp; the "Appeler" tel: link still goes to the verified agent.

- **Web** (`lib/leadRouting.js`): a verified, routable agent's listing button
  resolves to routing `VIA_LUKKA` — the central number with the unchanged
  storefront message (the listing link stays last). `contactWhatsAppHref`
  does the same for the agent profile, the agent directory (link
  `/agents/<id>`), a project page (`/projets/<slug>`) and the Espace Client
  visit and proposal cards (`/listings/<id>`). `NEXT_PUBLIC_WHATSAPP_DIRECT_TO_AGENT=on`
  (build time) restores the agent's own number; with no central number set
  the agent's number is used anyway.
- **Taps**: `whatsapp_clicks.routing_type = 'VIA_LUKKA'`
  (`migrations/20261109_whatsapp_via_lukka.sql`; before it runs the tap is
  kept with no routing type, lib/leadClicks.js retries on 23514). No "Un client
  vous contacte" alert for these taps — the agent is alerted when the message
  actually arrives. `/admin/interactions` does not count the tap (the message
  is counted as the WhatsApp enquiry); Lead Analytics' conversion divides
  enquiries by central + via-Lukka taps.
- **Engine, listing** (`services/listingEnquiry.js`): the lead is assigned to
  the listing's agent; the reply is `services/contactHandoff.js`
  `agentHandoffReply` — "<agent> a reçu votre demande … avec votre numéro",
  the agent's wa.me link and number. A second message from the same customer
  about the same listing within 24 h, or one from a customer with an open
  visit on it (Espace Client), is a follow-up: no new lead, no new alert,
  "Bonjour à nouveau". The agent alert now says the customer has their number.
  An agent who is not routable: the earlier desk reply, unchanged.
- **Engine, profile / directory / project** (`services/contactRelay.js`,
  after the listing enquiry in the webhook, same guards): `/agents/<id>` →
  lead `agent-profile-whatsapp` assigned to that agent (counted as a profile
  enquiry), agent alerted (`nouvelle_demande_agent`), desk copy, handoff
  reply; `/projets/<slug>` → `projectEnquiry.findPublicProjectBySlug` +
  `handleProjectEnquiry` (the form's path), then the developer's WhatsApp.
  Unknown or non-public pages fall through to ordinary processing.
- The customer's chat with the agent after the handoff is between two
  personal phones and stays invisible — accepted by the owner; the lead, the
  dashboard taps and the 24 h follow-up (once `suivi_demande_client` is
  approved) are what we keep.
- §91 of verify-pipeline; web `tests/unit/whatsapp-via-lukka.test.js`,
  `tests/unit/lead-routing.test.js`.

## Matching in waves (2026-11-10)

Owner decisions 2026-11-10, after `/admin/matching` showed "10 requests, 9 with
no agency, 0 % response". Checked on production: only ONE of the 10 was an open
request (#22, Lingwala); the others were 4 visit requests, 3 profile enquiries,
1 listing enquiry and 1 desk introduction, each handled by its own path. #22
went to 7 agencies at the same second as plain session messages (no template
then), none of the 7 had stock to propose, and a "response" could only be a
proposal of an own listing — so 0 % was built in.

- **Open vs directed** (`db.DIRECTED_LEAD_SOURCES`, `isOpenRequestSource`):
  listing-visit-request, listing-whatsapp-enquiry, agent-profile-inquiry,
  agent-profile-whatsapp, project-enquiry, team-introduction, admin are
  directed and never matched. Everything else (espace-client-request, whatsapp,
  move-project, any new form) is open. `/admin/matching` counts open requests
  only and shows directed ones apart.
- **Waves** (`services/leadDispatch.js`): best 2 alone for 30 min, then the
  next 3, then 2 (`WAVE_SIZES`, `WAVE_WINDOW_MS`). The `lead-waves` job (every
  minute, `LEAD_WAVES=off` pauses it; wave 1 still goes) sends the next wave
  while fewer than 3 agencies have claimed. The wave number is taken with a
  guarded UPDATE so the sweep and an early advance cannot both send it. Only
  requests under 3 days old with `dispatch_wave` set are swept: nothing
  created before this change is woken.
- **Claim** (`services/leadClaims.js`): WhatsApp quick replies
  `lead_claim:<matchId>` / `lead_pass:<matchId>` (only from the number alerted)
  or the dashboard (`POST /admin/leads/:id/claim`, only the agent's own match).
  Up to `MAX_CLAIMS` = 3; the claim and the cap check are one transaction; the
  third claim closes the request. A claim is free (the monthly quota still
  counts proposals only) and sends the agency the customer's name, number and
  a wa.me link; the customer is told which agency took it (session message:
  a web-form customer may be outside the window, logged either way). "Pas
  dispo" is recorded; when the whole current wave said it, the next wave goes
  at once. A proposal from an agency that had not claimed counts as its claim.
- **The customer's number comes with the claim.** `GET /admin/leads` with
  `matched_agent_id` returns `my_match` and, for a request the agency reaches
  only through the matching and has not claimed, `wa_id` / `name` null and
  `customer_hidden: true` (web shows `AgentLeadClaimCard`). Before, every
  matched agency saw the number at once.
- **Desk** (`alertDeskOnce`, stamped on `leads.dispatch_desk_alerted_at` /
  `dispatch_desk_reason` before the send, so once per request): `no-commune`
  at once; `no-coverage` when no agency covers the commune (neighbours tried
  first, see below); `unclaimed` when every wave is spent with no claim.
  OPS_WHATSAPP_NUMBER via `deskAlert.sendDeskAlert`. `moveFollowup.js` skips
  a request the desk already got.
- **Neighbouring communes** (`services/communeNeighbours.js`): no agency in the
  requested commune → the nearest communes of the same city whose verified
  centre point is within 6 km (max 3), from web `KINSHASA_COMMUNE_CENTROIDS`
  (copied; verify-pipeline compares the two) and `drc_commune_centroids.json`.
  No hand-made adjacency list. The alert says "commune voisine"; the match
  records `matched_commune` and `neighbour_of`. Maluku has none → desk only.
- **WhatsApp assistant**: `create_enquiry` with no listing and no commune asks
  the customer once (in-memory per conversation, 2 h); a second call saves the
  request and the desk gets it.
- **Who is asked first**: score = ranking base (unchanged SQL, × plan
  multiplier) × priority level multiplier × fairness. The level
  (`services/agentPriority.js`, owner decision: visible to the agency only)
  replaces the responsiveness multiplier and the 2026-11-09 ×1.05 boost:
  up to date 30 pts (every live listing confirmed/published within 14 days),
  new listing in 30 days 15, requests answered in 60 days 35 (claim, pass or
  proposal; < 3 alerts = half), visits answered in 60 days 20 (< 2 = half).
  Or ≥ 70 (×1.25), Argent ≥ 40 (×1), Bronze (×0.8). A signal that cannot be
  read gives nobody its points. Paid plan = a boost, never a guaranteed wave 1.
  `GET /admin/agents/:id/priority` feeds the dashboard card.
- **Responsiveness** now counts claims and passes, and leaves out sends that
  FAILED (an alert that never left is not an ignored one); both window reads
  compare through `datetime()`.
- **Sending** (`notifyAgency`): inside the agency's 24 h window the
  interactive message with both buttons; outside, `AGENT_LEAD_CLAIM_TEMPLATE`
  (with buttons, not approved yet — draft in whatsapp-delivery.md) else
  `AGENT_LEAD_MATCH_TEMPLATE` (`agent_lead_match`, on in production, no
  buttons: the agency claims from the dashboard link), else the buttons
  message with a warning that it probably won't arrive; plain text last.
- Columns: `leads.dispatch_wave/_wave_at/_closed_at/_desk_alerted_at/_desk_reason`,
  `lead_matches.wave/matched_commune/neighbour_of/level/claimed_at/declined_at/answer_channel`
  (idempotent ALTER lists). "Relancer la diffusion" sends the next wave now and
  reopens a request closed for lack of agencies. verify-pipeline §94 (and
  §16 / §92 updated).

## The 24 h follow-up: "Un agent vous a-t-il contacté ?" (2026-11-10)

Owner decision 2026-11-09, built with the app (customer alert B6).
`services/requestFollowup.js`, job `request-followup` (every 10 min, 9–19 h
Kinshasa).

**Who is asked:**
- A request 24–72 h old, still `NEW` / `CONTACTED` / `QUALIFIED`, with an
  agent attached (`agent_id` or `assigned_agent`).
- Not visit requests (their own loop), desk introductions or admin requests.
- Once per request: `contact_followup_sent_at` is claimed before the send.
- At most one question per customer per day; a second request waits.

**How it is sent:**
1. **App:** a push opening `/compte/client/suivi/<id>`, where the three
   answers are buttons.
2. **Else WhatsApp, template:** `SUIVI_DEMANDE_TEMPLATE`
   (`suivi_demande_client`, three quick replies with payloads
   `suivi:<id>:yes|wait|stop`).
3. **Else WhatsApp, text:** a numbered text, only to a customer inside the
   24 h window. Outside it nothing is sent, and the channel is recorded as
   `none`.

Template to submit: UTILITY, fr, intake account. Body: "Bonjour, nous avons
transmis votre demande à un agent : {{1}}. Un agent vous a-t-il contacté ?".
Quick replies in this order: "Oui, c'est fait" / "Pas encore" / "Je ne
cherche plus".

**The three answers:**

| Answer | Effect |
|---|---|
| `YES` | The request becomes `CONTACTED` if it was `NEW` |
| `NOT_YET` | The desk is alerted. The agent is relaunched: a directed enquiry re-sends the agent alert; an open request gets its next wave (`dispatchNextWave`) |
| `NO_LONGER` | The request is closed (`LOST`) |

- Recorded once on the lead: `contact_followup_answer`, `_answered_at`, and
  `_answer_via`. The first answer stands.
- A WhatsApp answer is thanked on WhatsApp.

**Where answers come from:**
- **Template buttons and typed text:** `routes/webhook.js`, after the
  check-in handlers.
  - The answer is honoured only from the request's own number.
  - A typed answer counts only while a WhatsApp question is open (48 h).
  - A bare "non" is not read as "Pas encore": it answers too many other
    things.
- **Web:** `POST /admin/leads/:id/followup-answer` with the account's numbers.

`REQUEST_FOLLOWUP=off` stops the job; answers already sent are still handled.
verify-pipeline §102; web `tests/unit/push-notifications.test.js`.

## Direct contact, measured: what the customer asks for, and "Mon projet" reaches agencies (2026-11-16)

Owner, 2026-11-16, while the app is not live and WhatsApp runs on templates:
customers and agents should talk directly, "even if it means us not knowing
exactly what happened", but we want to know whether a customer is enquiring
or asking for a visit; and "Mon projet" / "Trouvez pour moi" requests "just
disappear". Measured on production the same day: 9 move projects saved, **0**
ever sent to an agency (7 of 9 had a city and no commune, and a request was
only sent on an explicit tap that refused it without a commune); 38 direct
WhatsApp taps in 7 days, 11 "Un client vous contacte" alerts, agents answered
about 40 %; every pre-typed message asked both "disponible ?" and "visiter ?".

**What the customer asks for (the tap carries it).**
- Every listing WhatsApp button (cards, the phone bar, the desktop card) opens
  a sheet first: « Je veux le visiter » / « Est-il toujours disponible ? » /
  « Une autre question » (web `components/WhatsAppIntentSheet.js`,
  `lib/whatsappIntent.js`). Each pre-types its own question line in the same
  storefront message (opening and link unchanged), so the choice saves the
  customer typing. WhatsApp still opens straight on the agent's number.
- Stored on the tap: `whatsapp_clicks.intent` ('visit' | 'availability' |
  'question', NULL = not asked) — `migrations/20261116_contact_intent.sql`;
  web retries without it on 42703 (`lib/leadClicks.js`).
- Sent with the agent alert (`services/contactTapAlert.js`, `intent` on
  `POST /admin/contact-taps`, stored on `contact_tap_alerts.intent`): the
  title says it ("Un client veut visiter votre bien"); a visit gets a third
  button « 📅 Visite fixée » (`contact_tap_visit:<id>` → answer `VISIT_SET`,
  counted as a reply and apart). Outside the 24 h window the approved
  `client_vous_contacte_agent` carries the intent in {{3}} ("pour : une
  demande de visite — Appartement à Limete"), with its two buttons only — no
  new template.
- The central number reads it back from the question line
  (`listingEnquiry.enquiryIntent`) for the agent's enquiry template message.
- `/admin/contacts`: "Ce que le client demande" — Une visite (a visit choice
  or a "Demander une visite" request) / Un renseignement / Inconnu (calls,
  messages, taps before this), as cards, a filter (`wants=`), a column and
  two CSV columns (`customer_asks_for`, `intent`). "Agent : visite fixée" is
  a follow-up state there and on `/admin/telemetry`.
- `NEXT_PUBLIC_WHATSAPP_INTENT=off` (build time) = one tap, old message.
  A call tap has no intent (nothing is asked before the dialer).

**"Mon projet" reaches agencies.**
- A project is sent as soon as it is saved — sign-up, login with answers, the
  cards — once, the first time it has rent/buy and a city or communes
  (`web/lib/moveProjectRequest.js` `autoSendMoveProject`, `onlyIfNeverSent`;
  an edit of a project already sent alerts nobody; the customer's button
  resends after 20 h). The sign-up card and the project page say it goes to
  agencies and that only an agency that takes it gets the number.
  `MOVE_AUTO_SEND=off` (web, call time) = the tap only.
- **City-wide requests**: a lead with no commune but a canonical city
  (`leads.city`, idempotent ALTER; `POST /admin/leads` `city`, through
  `cities.resolveCity`) goes to that city's agencies in the same waves
  (`leadDispatch.cityWideOf`, `agentRanking.rankAgentsForCity`: covers any
  commune of the city 20 + fitting stock 6 each ≤ 30 + stock 3 each ≤ 15 +
  verified 10, × plan, then level and fairness; shared agent gate; no
  neighbours). The alert says "Kinshasa (toutes communes)" and that the
  customer chose no commune. Neither city nor commune → the desk, as before.
- `/admin/move-projects`: "Envoyer aux agences" on a project never sent
  (`leads.manage`, confirmation, audited) — the backfill for the 9 stuck
  projects is the owner's call, row by row; the column shows "Kinshasa (toute
  la ville)" and why a project cannot go.
- **When an agency takes it** (`services/leadClaims.js`) the customer's message names the
  request's own city (a city-wide one never says "Kinshasa" by default) and
  carries the agency's WhatsApp link (verified, undeleted number only), so the
  customer can write first. Outside the window: `AGENCY_CLAIMED_TEMPLATE` once
  approved, else the text. A visit tap outside the agent's window:
  `CONTACT_TAP_VISIT_TEMPLATE` (three buttons) once approved. Drafts:
  whatsapp-delivery.md, "Two drafts for direct contact".
- **Review fixes before commit**: a send is reserved in Postgres before the
  engine is called (`claimMoveProjectSend`, one guarded UPDATE of
  `last_lead_at`; released if the call fails), so a slow automatic send and a
  tap never make two leads; the save waits 5 s at most for the send. The city
  ranking matches a bare commune name only when no other city has it
  (`agentRanking.cityCommuneNames`: Boma's "Kalamu (Boma)" never reaches
  Kinshasa's Kalamu agencies). Every click from the sheet, its backdrop
  included, stops before the card's link. « Une autre question » ends the
  message on the question line (link before it) so the customer types after it.
- verify-pipeline §117; web `tests/unit/direct-contact-intent.test.js`.

## Direct contacts become visits and outcomes (2026-11-20)

Owner, after reading the contacts export: customers ask for visits on
`/admin/contacts` but none reach the viewings page; "salvage more information
from the interactions". Measured 2026-11-15 → 20: 82 direct WhatsApp taps from
50 people, none with a number; 81 alerts, 28 button answers (43 % with
buttons, 24 % as a template); **0 « Visite fixée »** (the visit template
`client_veut_visiter_agent` is not switched on, so a template alert has no
visit button); 0 visit requests since 2026-11-15; agents typed "c'est
disponible", "nous nous sommes fixés pour une visite aujourd'hui", "donné moi
les images" to our number and nothing read it. Owner chose: the customer may
leave a name and number, optional.

- **The customer's number, optional** (web `components/WhatsAppIntentSheet.js`,
  `lib/visitContact.js`): « Je veux le visiter » (and the video step) shows
  name + WhatsApp number "pour recevoir la confirmation de la visite", or
  « Passer ». Remembered per device (localStorage `lukka_visit_contact`).
  Sent with the tap to `/api/telemetry/lead-click`, forwarded to the engine
  (`customer_name` / `customer_phone` on `POST /admin/contact-taps`), never
  written to `whatsapp_clicks`. Engine `services/contactTapAlert.js`: stored on
  `contact_tap_alerts`, the alert names the customer (session text and the
  template's {{3}}), and a lead is made (source `listing-direct-visit`, in
  `DIRECTED_LEAD_SOURCES` — never dispatched in waves) → the agent's
  Demandes and the 24 h « Un agent vous a-t-il contacté ? ». A repeat tap by
  the same visitor that brings the number attaches it to the earlier alert
  and tells the agent; another visitor's 30-minute dedupe never swallows a
  customer who left a number.
- **« Visite fixée » is a visit** (`services/directVisit.js`): the alert's lead
  (or a new one, wa_id '' when the customer left no number — "client du
  site"), a PENDING viewing request, routing DIRECT_WA, direct contact
  recorded (so the 15-min SLA and the 2-hour check skip it), linked on the
  alert. Then the agent is asked « Quand a-t-elle lieu ? »; a typed day + hour
  (`visitSchedule.parseFrenchSlot`, never a guessed hour; a day alone is asked
  again) confirms it: CONFIRMED + `scheduled_at`, response via WHATSAPP, the
  customer told when we have the number. From there it is an ordinary visit:
  `visite_effectuee_agent`, check-in, bon de visite, rating, "déjà loué".
  Customer sends skip an empty number (`tellCustomer`, `trySend`). The
  24 h follow-up skips a `listing-direct-visit` lead that has a visit.
- **Typed replies to the alert** (`services/contactTapReplies.js`, webhook after
  the availability handler): within 24 h of an alert to that number, short
  text (≤ 200), no media, no other question open. visit words / a day + hour →
  « Visite fixée » (confirmed at once when the text has both); "déjà loué",
  "plus disponible", "vendu" → answer + outcome CLOSED + « Retirer l'annonce du
  site ? » (`contact_tap_off|keep:<id>`, closes for its own agent, else under
  offer); "rien reçu" → NOTHING; "disponible", "dispo" → REPLIED and
  `availability_confirmed_at` stamped. Money or property words (an advert) and
  a bare "ok" are never an answer. Once per alert the agent is told our number
  is not the customer's; an unread short text gets that line and still falls
  through.
- **Outcomes** (`contact_tap_alerts.outcome`: VISIT_PLANNED, VISITED, TALKING,
  NOT_INTERESTED, CLOSED; latest stands): from typed replies and from "Faites
  le point" — « Vos contacts de la semaine » under the board, on the link page
  and `/compte/agent/point` (web `components/statusCheck/ContactOutcomes.js`,
  `lib/contactOutcomeRules.js`, engine `GET /admin/contact-taps/agent/:id`,
  `POST /admin/contact-taps/:id/outcome`, own agent only). Visite prévue /
  faite create the visit; faite also records the agent's DONE.
- **« Votre message est parti ? »** (the sheet): back on the page 3 s – 30 min
  after WhatsApp opened, Oui / Je n'ai pas réussi → `listing_events`
  `whatsapp_sent` / `whatsapp_not_sent`; a failure offers WhatsApp again, a
  call, or the visit form.
- **`/admin/contacts`**: the customer from the alert, the outcome and the visit
  link under the status, a « Parcours » column (`attachJourneys`: channel of
  arrival by `lib/trafficChannels.js`, latest search, other listings
  contacted, saves, a customer account later created on the same device —
  which then names an anonymous contact, marked "même appareil"); CSV gains
  outcome, viewing_id, arrived_by, journey, other_listings_contacted, saves,
  customer_from_device_account. Visits made this way show as "Visite fixée
  après un contact direct". `/admin/viewings` search matches a request id.
  Index migration `migrations/20261120_contact_journey_indexes.sql`.
- **Not switched on**: `CONTACT_TAP_VISIT_TEMPLATE` (`client_veut_visiter_agent`,
  draft in whatsapp-delivery.md "Two drafts for direct contact") — until it is
  approved, an agent outside the 24 h window gets no « Visite fixée » button,
  but a typed "visite demain 10h" or "Faites le point" still makes the visit.
- verify-pipeline §122; web `tests/unit/contact-salvage.test.js`.

## Customer sign-up push (2026-11-24, branch `feat/signup-boost`)

Owner: "make it as easy as possible for customers to sign up for free". Baseline
(14 days to 2026-11-24, `customer_signup_events` / `page_views`): 20,075
visitors, 99 % on a phone, ~90 % from Facebook ads, 81 % seeing one page;
~25 accounts (69 ever). The nudge showed to 324 people (9 opened, 5 accounts),
the after-WhatsApp sheet to 36 (1 opened, 0 accounts); 141 people tapped
WhatsApp and one had an account; 10 sign-ups were refused as "exists".

Built on this branch's base plus the live app branch's sign-in files
(`feat/agent-app-push`: "Continuer avec WhatsApp", `ContactSignupPrompt`,
`contactTapClaim`) and the NOT NULL password fix (`fix/contact-signup-password`,
`'!whatsapp'` marker) — production already runs those; a deploy merges file by
file onto the server copies as usual.

- **Feed alert card** (`components/FeedAlertCard.js`, `lib/feedAlertRules.js`):
  after the 3rd result on `/listings` page 1. With a commune/quartier (or another
  city) it is one button for that search; on the ad's "toutes les villes"
  landing it asks for a commune first (every listing of the city is the feed,
  not an alert). Entry `feed_alert`, "shown" counted when on screen.
- **Forms that already ask for a name and a number open the account**
  (`lib/guestAccount.js`, `lib/guestAccountRules.js`): "Trouver pour moi" and
  "Demander une visite" carry a "Créer mon compte gratuit" box, ticked by
  default, hidden when signed in. After the lead / visit succeeds: a known
  number → nothing created, a signed attempt cookie, and the confirmation
  (`AccountOfferCard`) links to the WhatsApp code screen; a new number with a
  name → account with the `'!whatsapp'` marker, **signed in at once** (see
  the next bullet), and the card says the account is open and links to the
  Espace Client. Never throws into the form. Demo numbers skipped. Entries
  `request` / `visit`.
- **A new number + a name = signed in, no WhatsApp step** (owner decision
  2026-11-24, same day: "too much friction asking them to send a code to our
  WhatsApp" — 3 of the 9 accounts opened through "Continuer avec WhatsApp" in
  14 days never sent it). `lib/newCustomerSession.js` `signInNewCustomer`,
  used by "Continuer avec WhatsApp" (`whatsappActions.js`, then `redirect(next)`
  back to the page, where the ♥ / alert resume runs) and by
  `lib/guestAccount.js`: session, remembered number, the device's WhatsApp
  taps claimed, the phone's saved homes and searches merged
  (`components/LocalSavesFields.js` → `localSavesFromForm`), CompleteRegistration.
  **Only for a number with no account a moment ago** — a known number is
  someone's and still needs the code from that WhatsApp (or the password).
  `phone_verified_at` stays NULL: partner referral credits (money) still
  count confirmed numbers only. Accepted risks, as for password accounts
  (2026-11-06): a typo sends our alerts to a stranger (every message has the
  stop link), and someone can open an account on a number that is not theirs;
  the real owner later signs in with the WhatsApp code and takes it over. A
  cold number is reached by template: `SEARCH_ALERT_TEMPLATE` =
  `alerte_nouveaux_biens` on the web (24 sends logged, last 2026-11-24).
  Copy no longer promises "un code depuis votre WhatsApp" to a new account.
- **A known number: a code WE send, typed on the site** (owner, same day:
  "asking them to message us is not efficient"). `lib/signInCode.js`
  (`signInCodeEnabled` = `AGENT_OTP_TEMPLATE` set and `CUSTOMER_SENT_CODE` not
  `off`; `sendSignInCode` → `sendCustomerOtp`, the authentication template),
  `lib/signInCodeLimits.js` (5 wrong tries wipe the code, 3 sends per account
  per 10 min, in memory), `whatsappActions.js` `sendSignInCodeAction` /
  `verifySignInCodeAction`, `components/SignInCodeForm.js`. "Continuer avec
  WhatsApp" and sign-up's "Ce numéro a déjà un compte" send the code at once;
  from a request / visit confirmation the code screen opens on "Recevoir mon
  code sur WhatsApp". The box sends itself at six digits (`one-time-code`
  autofill). The right code sets `phone_verified_at` (a real proof). "Code
  pas reçu ? Confirmez plutôt depuis WhatsApp" mounts the older panel (they
  send us a code) only when tapped — Chakra confirms no delivery. Labels reach
  the client components as props: production's shell ships only parts of
  `auth`. Without the template the screen is the older way, as before. If
  the code could not be sent, that panel is open at once; after 30 s with a
  code waiting, "Toujours pas de code ?" turns the link into a visible box.
- **Frictions pass** (owner, same day — the 14-day funnel: ~500 prompts shown
  for 20,075 visitors, nudge 4 % tapped, after-WhatsApp sheet 2 / 42):
  - **Asked on the page most visitors see.** `components/ListingAlertCard.js`,
    mid-page on a phone (after Équipements, before the map): "Recevez les
    biens comme celui-ci", the listing's `similarAlertQuery`. The desktop
    rail and the inline offer under the similar listings
    (`SimilarAlertButton`) count as the same entry, `listing_alert`.
  - **Nudge**: after a FIRST listing opened (`VIEWED_THRESHOLD` 1); on
    `/listings` with a commune (or another city) it offers the alert itself
    ("M'alerter sur WhatsApp") and signing in saves that search
    (`lib/signupNudgeRules.js` `nudgeNext` → `lkp_auth_return=alert`);
    elsewhere "Créer mon compte gratuit".
  - **In the WhatsApp sheet** (`WhatsAppIntentSheet`, visit step only): a
    ticked "Créer mon compte gratuit" beside the optional name and number.
    With both, `app/(site)/listings/whatsappAccountActions.js` is called
    WITHOUT waiting in the same tap that opens WhatsApp — a new number is
    signed in with the "homes like this one" alert saved; a known one gets
    the code offer on return. No step is added; the other answers go
    straight to WhatsApp. Entry `wa_sheet`.
  - **One screen**: `WhatsAppSignInForm` shows the name under the number
    (optional; required only after a new number came without one). The
    button is "Continuer" in the site's blue, without the WhatsApp glyph —
    it no longer opens WhatsApp.
  - **One way to open an account**: `/compte/inscription` uses the same
    no-password form, with the partner code field (`partner_code` →
    `recordWebSignupAttribution` `typedCode`). Only the "Mon projet" path
    (`?projet=1`, the move questions) keeps the password form, which saves
    the project. That page no longer reports `form_start` / `submit` (the
    old form's beacons); `form_view` and `created` remain.
  - **Money**: an account opened without a code has `phone_verified_at`
    NULL, so it does not earn a partner's credit (lib/referralCredits.js)
    until that number is confirmed by a code.
- **"Ce numéro a déjà un compte"** at sign-up (and its "Se connecter avec ce
  numéro" button) now opens the WhatsApp code screen on that account
  (`compte=existant`), unless the person answered the move cards (those keep
  the password path that saves the project). Still recorded as `refused/exists`.
- **Nudge** (`SignupNudge`): after a 2nd listing opened (was 3rd); its button
  opens the WhatsApp form in place (`AuthPromptModal` trigger `nudge`) instead
  of the sign-up page.
- **After WhatsApp** (`ContactSignupPrompt`): `trackLeadClick` fires the tap
  event (it had slid into `trackWhatsAppOutcome` in the 3-way merge — check
  this after every merge of `lib/analyticsClient.js`) with the listing's
  similar search (`lib/similarSearch.js`) and the visit sheet's optional
  name + number. The sheet says "Recevez les biens comme celui-ci", is
  prefilled, and signing in lands on those results with the alert and the
  listing saved (`similarAlertNext`).
- **Home search bell** (`SearchBar`, entry `home_hero`): "M'alerter des
  nouveaux biens ici" under "Voir N biens" once the search names a commune.
- **`/alertes-whatsapp`** (entry `alert_landing`, noindex): one screen for an
  ad — Louer/Acheter, commune, budget → the same alert flow.
- Saved searches now drop paging, sort, ad tags and `lkp_*` markers
  (`SaveSearchButton` → `isNotACriterion`), so an alert saved from an ad
  landing is the search, not the visit.

An "M'alerter des biens similaires" box in front of WhatsApp was left out on
2026-11-24 ("never in front of WhatsApp"); later that day the owner asked for
the account at the WhatsApp tap, built as a ticked box inside the visit step's
existing optional fields — no new step (see "Frictions pass" above).
