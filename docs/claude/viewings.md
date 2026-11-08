# Viewing requests — notifications, agent loop, SLA, booking, ratings

> Moved verbatim from the root CLAUDE.md on 2026-11-06 to keep it short. The rules in CLAUDE.md
> still bind; this file is the detail and history. When you change this area, update this file
> (a dated section: what, why, env vars, the verify-pipeline §). "See X below/above" may point to a
> section now in another docs/claude file: `grep -rn "X" docs/claude`.

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
- **Monday's numbers as a template (2026-10-26).** `AGENT_WEEKLY_TEMPLATE`
  (`bilan_hebdo_agent`, UTILITY, fr, submitted the same day, intake account:
  first name, week start "19 octobre", views, WhatsApp clicks, most-viewed
  listing, to-do joined with " · " — whole items only, within Meta's 200
  characters; static button → /compte/agent). Sent by `deliverDigest` on a
  Monday with views, and it is then the whole message (no day template, no
  text). Unset, no views or refused → the digest exactly as before. The 14
  "sent" weekly digests of 2026-10-26 were session messages, most outside
  the 24h window. §-test next to the day template's. Switched on 2026-10-27
  and put **on hold the same day** (owner, until customer traction):
  `AGENT_WEEKLY_DIGEST=off` in production makes Monday an ordinary day — no
  weekly numbers, no stale-project nudge; the template name is commented out.
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

## After a visit that did not work out: the next step comes from us (2026-11-07)

The fall-through reason used to be answered "Répondez à ce message si vous
souhaitez que nous vous proposions d'autres biens" — the customer had to come
back. When no rating question is asked, `recordFalloffReason` now sends
`falloffNextText`: up to three real homes from `alternativesFor` (the whole
lead's criteria, the visited home excluded), or that same honest thanks when
there are none. The customer just wrote to us, so the session message
arrives. §81.

## Direct contact: the agent reached the customer from their own phone (2026-11-07)

Reported 2026-11-07: the desk chased an agent about a visit request that showed
no reply; the agent had answered the customer on WhatsApp from their own phone.
A chat between two personal numbers never reaches the engine, so the only way
we learn of it is somebody telling us. Three ways in, one record on the row:
`viewing_requests.direct_contact_at` (when it was RECORDED — not a guess at
when the agent wrote), `direct_contact_channel` (whatsapp | phone | in_person |
other, leads.contact_channel's words) and `direct_contact_by` (AGENT_WHATSAPP |
AGENT_DASHBOARD | DESK). First record wins.

- **The 2-hour check** (`viewing-contact-check` job, `runContactCheckSweep`,
  `CONTACT_CHECK_MS`): a PENDING, DIRECT_WA request 2–24 h old with no
  `first_response_at` and no direct contact gets "Avez-vous déjà contacté le
  client ?" sent to its agent — a separate message with
  buttons `viewing_contact_wa|contact_call|contact_not:<id>` (WhatsApp allows
  three reply buttons and the alert's three are taken), typed 1/2/3 through
  `pending_agent_actions` kind CONTACT_CHECK when the buttons fail. Same
  authorisation as the alert's buttons. Once per request
  (`contact_check_sent_at`). `VIEWING_CONTACT_CHECK=off` disables it.
  It is a session message: an agent who got the alert as a template (outside
  the 24 h window) may not receive it. **Two hours, not ten minutes** (owner
  decision, same day: ten minutes was too soon to chase an agent), so it comes
  AFTER the 15-minute escalation and an escalated request is still asked; it
  tells the desk whether the customer was reached before anyone phones the
  agent. Requests over 24 h old are never asked, so a deploy does not chase old
  ones.
- **"Oui"** records the contact and thanks the agent; the customer is not
  messaged. **"Pas encore"** records nothing and re-sends the alert with its
  three buttons.
- **The SLA sweep skips a request with a direct contact on file**
  (`listViewingRequestsAwaitingSla`): no desk alert, no alternatives sent to a
  customer who is already talking to the agent. Only the dashboard button
  (or the desk) can record one inside 15 minutes; the WhatsApp check comes
  later.
- **Web**: the agent's visit card has "J'ai déjà contacté le client" (behind
  "···", PENDING/RESCHEDULED only) → `recordViewingDirectContactAction`; the
  desk has "Contact direct confirmé" in a row's menu on `/admin/viewings`
  (`viewings.manage`, audited `viewing.direct_contact`), and the row shows
  the channel, who said it and when. Both go through
  `POST /admin/viewing-requests/:id/direct-contact` (`recordDirectContact`;
  the dashboard path re-checks the agent like `respondFromDashboard`). Sends
  nothing.
- **Not a response time.** `first_response_at`, `agent_response_via` and
  Postgres `agent_performance_logs` are untouched: we do not know when the
  agent actually wrote. `getInteractionCounts` counts a direct contact as
  contacted; the telemetry "answered" figure still means answered through our
  loop.
- The alert itself now says "Vous écrivez ou appelez le client directement ?
  Répondez quand même ici" — in the session text only; an approved template's
  body is fixed in Meta.
- §82 of verify-pipeline.
