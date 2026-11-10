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

## WhatsApp through Lukka Place first (2026-11-09)

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
