# Lead routing, enquiries and agent matching

> Moved verbatim from the root CLAUDE.md on 2026-11-06 to keep it short. The rules in CLAUDE.md
> still bind; this file is the detail and history. When you change this area, update this file
> (a dated section: what, why, env vars, the verify-pipeline §). "See X below/above" may point to a
> section now in another docs/claude file: `grep -rn "X" docs/claude`.

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
  NEW (viewings: `first_response_at`). Not "Trouver pour moi" searches (several
  agencies) and not `listing-visit-request` leads (counted once, through their
  viewing request). Web adds the storefront taps and names the agents.
- §71 of verify-pipeline.
