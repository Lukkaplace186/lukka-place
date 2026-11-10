# Outbound WhatsApp — delivery, templates, desk, alerts

> Moved verbatim from the root CLAUDE.md on 2026-11-06 to keep it short. The rules in CLAUDE.md
> still bind; this file is the detail and history. When you change this area, update this file
> (a dated section: what, why, env vars, the verify-pipeline §). "See X below/above" may point to a
> section now in another docs/claude file: `grep -rn "X" docs/claude`.

## Outbound WhatsApp (moved out of "Viewing-Request Notifications")


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
WhatsApp is the only notification channel this product has. *(Superseded
2026-11-10: agents get app push through FCM — "App alerts" at the end of this
file. There is still no browser push, on purpose.)*

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
- **Text inside the 24 h window, template outside it** (2026-10-27, owner:
  the template shows as "[annonce_en_ligne]" in Chakra's inbox and the old
  text with its link was preferred). `services/sessionWindow.js` keeps each
  number's last inbound message (`whatsapp_last_inbound`, written by the
  webhook's inbound loop); `deliverModerationVerdict` sends the old text when
  the agent wrote within 23 h (1 h margin), else the template, else the text.
  No record = outside (the table started empty on 2026-10-27). Each accepted
  template send is logged. §54.

## Agent templates approved 2026-11-03 — switched on 2026-11-04

All four are on the INTAKE account, French, set in the engine `.env`:

- `DESK_ALERT_TEMPLATE=alerte_bureau` — every desk copy; the keepalive stops asking "OK".
- `AGENT_LEAD_MATCH_TEMPLATE=agent_lead_match` (approved as MARKETING) — the
  "Trouver pour moi" push, five variables as `leadDispatch.templateParams`.
- `LISTING_AVAILABILITY_TEMPLATE=disponibilite_annonce_agent` — sent with the
  three quick-reply payloads; a template approved without them is refused and
  the check falls back to buttons / numbered text.
- `AGENT_ENQUIRY_TEMPLATE=nouvelle_demande_agent` — `services/agentEnquiryAlert.js`,
  used by listing, profile and project enquiries: text inside the agent's 24 h
  window, else the template (agent, subject, client, message; DYNAMIC button =
  lead id), else the text. A listing enquiry now records its lead before the
  alert so the button has an id. The profile enquiry's desk warning only fires
  when the alert still went as text outside the window. §73.
- **All four were approved with a PICTURE header** — a send without it is
  #132012. `TEMPLATES_WITH_IMAGE` (comma list, read at call time) names them,
  and `chakra.sendTemplate` adds `TEMPLATE_HEADER_IMAGE` (else
  `VIEWING_REQUEST_TEMPLATE_IMAGE`) to any listed template whose caller passed
  no image, so every caller is covered. Live-tested 2026-11-04 to the desk.
- **`annonce_en_ligne` is OFF again (2026-11-05, owner).** Its "Visit website"
  button opened a 404 for listing #685, while `/listings/685` itself answered
  200 — the button URL registered at Meta is not `/listings/{{1}}`.
  `LISTING_APPROVED_TEMPLATE` is commented out in production, so every
  approval goes as the text with `https://lukkaplace.com/listings/<id>`, which
  only reaches an agent who wrote within 24 h. To bring the template back, fix
  its button at Meta to `https://lukkaplace.com/listings/{{1}}` (listing pages
  are `/listings/`, never `/biens/`).
- **The "Toujours disponible ?" check is PAUSED (2026-11-05, owner: to be
  reworked).** `AVAILABILITY_CHECK=off` in production makes the
  `listing-availability-check` job never run (`availabilityCheck.checkEnabled`,
  read at call time); answers to questions already sent are still handled.
  Delete the line and restart to resume. §74. **Reworked 2026-11-09**: the
  same job now sends one "Faites le point" request per agent
  (whatsapp-intake-and-agents.md) and needs the new template
  `LISTING_STATUS_TEMPLATE` (`disponibilite_annonce_agent` is per listing and
  no longer sent). Resume only after the migration and the template.
- **The agent morning digest is PAUSED (2026-11-06, owner).** `AGENT_DIGEST=off`
  in production makes the `agent-daily-digest` job never run
  (`agentDigest.digestEnabled`, read at call time) — no 08:00 "Votre journée
  sur Lukka Place", no `visites_programme_agent`. Its "N biens à confirmer"
  lines pointed at the availability check paused the day before. Delete the
  line and restart to resume. §77.

## Messagerie — WhatsApp alerts for unread site messages (2026-11-05)

The conversations themselves live in Postgres and on the site (web/CLAUDE.md,
"Messagerie"; tables `migrations/20261105_chat.sql`, applied 2026-11-05).
`services/chatNotify.js`, scheduler job `chat-notify` (registered after
`viewing-agent-done`, pinned in §24), every 2 minutes. §76 of verify-pipeline.

- **When**: a message from the other side unread for `CHAT_NOTIFY_DELAY_MIN`
  (3) minutes. Someone with the conversation open reads it within seconds
  (the page marks it read), so they are not pinged about what they see.
- **Once per unread run**: `chat_threads.agent_notified_at` /
  `customer_notified_at` is claimed by an UPDATE before sending; a new alert
  only when the first unread message is newer than that stamp (the person
  read everything since). Ten messages = one alert. The stamp stays when the
  send fails — no retry every 2 minutes.
- **Who**: agents with a verified phone, not deleted; customers with a
  verified phone who did not opt out of WhatsApp alerts. Never a blocked
  thread, never a run older than 7 days.
- **Quiet hours** 21 h – 7 h Kinshasa (`CHAT_NOTIFY_QUIET_FROM` / `_TO`):
  held until 7 h. `CHAT_NOTIFY=off` stops the job.
- **Text inside the 24 h window, template outside it** (`sessionWindow`),
  same posture as the enquiry alerts. Both templates are unset by default;
  without one an alert outside the window goes as text and is logged
  "probably not delivered" — which is every customer who signed up on the
  website, until `nouveau_message_client` is approved. To submit (UTILITY,
  fr, intake account, DYNAMIC link button = the thread id):
  - `CHAT_AGENT_TEMPLATE` = `nouveau_message_agent`: « Bonjour {{1}}, {{2}}
    vous a écrit sur Lukka Place au sujet de : {{3}}. « {{4}} » Répondez
    depuis votre espace agent. » Button "Répondre" →
    `https://lukkaplace.com/compte/agent/messages/{{1}}`.
  - `CHAT_CUSTOMER_TEMPLATE` = `nouveau_message_client`: « Bonjour {{1}},
    {{2}} vous a répondu sur Lukka Place au sujet de : {{3}}. « {{4}} » »
    Button "Lire le message" → `https://lukkaplace.com/messages/{{1}}`.
  - If Meta approves either with a picture header, add it to
    `TEMPLATES_WITH_IMAGE` (#132012 otherwise). Register the button URLs
    exactly as written (the `annonce_en_ligne` 404 came from a wrong one).
- **No lead is recorded for a chat** (a change from the first plan): it would
  have sat in the agent's Demandes as a second, never-answered copy of the
  conversation. web's `/admin/interactions` counts conversations straight
  from `chat_threads` instead (channel `siteChat`, "answered" =
  `agent_first_reply_at`).

## Send logs carry the wamid; the OTP template delivers (2026-11-07)

- **Chakra answers a send with `{ _data: { whatsappMessageId } }`**, not Meta's
  `{ messages: [{ id }] }`. The "[admin] send-whatsapp(-template) … accepted by
  Meta" lines read only Meta's shape, so every send printed `messageId: null`
  and a delivered message looked like a lost one. `chakra.sentMessageId()`
  reads both; give Chakra support the wamid when a message never arrived.
  verify-pipeline §79.
- **No delivery receipts reach the webhook** (`[chakra] N status event(s)` has
  never been logged in production): only the receiving phone proves delivery.
- **`agent_auth_otp` works.** Authentication, fr, intake account, switched on
  as `AGENT_OTP_TEMPLATE` in web `.env.local`. A send with its copy-code
  button was delivered to the owner's phone on 2026-11-07, so password-reset
  codes reach cold numbers. The 2026-11-04 non-delivery did not reproduce.

## `agent_lead_claim` — request alert with claim buttons (draft, 2026-11-10)

To submit on the INTAKE account (+243 976 321 848). Until approved, agencies
outside their 24 h window get `agent_lead_match` (no buttons) and claim from
the dashboard link; inside the window they get the interactive message.

- **Name**: `agent_lead_claim` · **Category**: UTILITY · **Language**: French (fr)
- **Header**: IMAGE, like the other agent templates (then add the name to
  `TEMPLATES_WITH_IMAGE`), or none.
- **Body** (the same 5 variables as `agent_lead_match`, so `templateParams` is unchanged):

  > Bonjour {{1}},
  > Un client cherche un logement à {{2}} : {{3}} chambre(s), budget {{4}}.
  > Touchez « Je m'en occupe » pour recevoir son numéro (3 agences au plus), ou « Pas dispo » si vous n'avez rien à lui proposer.
  > Détails de la demande : {{5}}
  > Merci de répondre rapidement.

  (Meta refuses a body that ends on a variable, hence the last line.)

  - `{{1}}` agency/agent name — "Ritchie Mbaki"
  - `{{2}}` commune(s), the agency's own first — "Lingwala"
  - `{{3}}` bedrooms or "Non précisé" — "2"
  - `{{4}}` budget or "Budget non précisé" — "400 $ – 450 $"
  - `{{5}}` dashboard link — "https://lukkaplace.com/compte/agent/demandes?lead=22"
- **Footer**: "Vous recevez ce message car vous couvrez cette commune sur Lukka Place."
- **Buttons**: two QUICK REPLY, in this order: 1 « Je m'en occupe », 2 « Pas dispo ».
  The payloads (`lead_claim:<id>`, `lead_pass:<id>`) are set at send time.
- **Switch on**: `AGENT_LEAD_CLAIM_TEMPLATE=agent_lead_claim` in the engine
  `.env`, restart with `--update-env`, test-send to the desk number, tap both
  buttons. Keep `AGENT_LEAD_MATCH_TEMPLATE` as the fallback.

## App alerts — push first, WhatsApp as the fallback (2026-11-10)

**Why.** WhatsApp only reaches someone who wrote to us in the last 24 h unless
a template is approved, and several are missing or paused. The owner chose a
store app (Google Play + App Store) for agents, agents first, and no
browser-installed version (agents in DRC do not add sites to their home
screen). Plan: `~/.claude/plans/hi-claude-we-are-giggly-squirrel.md`. App
project: `mobile/` (Capacitor shell loading `/compte/agent`, README there).

- **Engine `services/pushNotify.js` `pushFirst`.** Each agent alert records a
  `notifications` row (the in-app "Alertes" inbox), pushes to the agent's
  `push_devices` through the FCM HTTP v1 API (OAuth token signed with the
  service account's key, so no `firebase-admin` dependency), and calls the
  alert's own WhatsApp send at once when it could not push: Postgres not
  configured, tables missing (before the migration), no verified/undeleted
  agent, no device, FCM not configured, every device refused, or
  `PUSH_NOTIFY=off`. A dead token (404 / UNREGISTERED / malformed
  registration token) is revoked; a network error is not. The WhatsApp half
  throws exactly as before, so callers keep their error handling.
- **Wired so far:** viewing requests (`viewingNotifications.notifyViewingRequest`,
  urgent), customer enquiries (`agentEnquiryAlert.sendAgentEnquiryAlert`, used by
  listing / profile / project / contact-link enquiries; urgent), unread chat for
  agents (`chatNotify.deliverAlert`, not urgent, quiet hours unchanged), listing
  approved / rejected (`routes/admin.js deliverModerationVerdict`) and trusted
  auto-approval (`trustedAutoApprove`), both not urgent. **Not yet:** lead match
  (waves), "Faites le point", contact taps, "La visite a eu lieu ?", contact
  check, digest. Desk, owner and customer alerts are untouched.
- **Urgent late copy.** A pushed urgent alert stores what its WhatsApp send
  needs in `notifications.fallback` and is due `PUSH_FALLBACK_MIN` (5, 1–120)
  minutes later. The `push-fallback` job (every tick, before `sqlite-backup`)
  claims due, unread rows (`whatsapp_fallback_at` first, `FOR UPDATE SKIP
  LOCKED`) and calls the kind's own sender (`FALLBACK_SENDERS`): viewing
  requests only while still PENDING for that agent
  (`sendViewingAlertFallback`), enquiries always. Older than 6 h → dropped.
  Opening the alert (`/compte/agent/alertes/<id>`) marks it read and cancels
  the copy.
- **Env** (engine, read at call time): `FCM_SERVICE_ACCOUNT` (path to the
  Firebase service-account JSON, or the JSON) — unset means alerts are
  recorded for the inbox but not pushed; `PUSH_NOTIFY=off`; `PUSH_FALLBACK_MIN`.
  Web: `NEXT_PUBLIC_PLAY_STORE_URL`, `NEXT_PUBLIC_APP_STORE_URL` (Réglages ›
  Application shows "bientôt disponible" until set).
- **Migration** `migrations/20261110_push_notifications.sql` (two tables, RLS
  on, nothing granted). Everything runs unchanged before it: all WhatsApp.
- **Web:** `/api/push/register` · `/unregister` · `/unread`, the inbox
  `/compte/agent/alertes`, `lib/appBridge.js` (only active inside the app,
  through `window.Capacitor`), logout revokes this phone (cookie
  `lukka_push_token`). web/CLAUDE.md, "Lukka Place app".
- verify-pipeline §98; web `tests/unit/push-notifications.test.js`.

### Customers, one app (2026-11-10, part 2 phase 0)

Owner decisions:
- **One "Lukka Place" app for everyone.** It starts at `/app`
  (`web/app/app/route.js`): a signed-in agent goes to `/compte/agent`,
  everyone else to the listings. App id `com.lukkaplace.app`.
- **Discovery alerts are app-only for app users** (saved-search matches, price
  drops, similar listings); customers without the app keep WhatsApp. Visit,
  request and chat alerts fall back to WhatsApp when left unread.
- Plan: `~/.claude/plans/hi-claude-we-are-giggly-squirrel.md` (phases 1–3 wire
  the customer alerts, the gaps, then the standard portal alerts).

What phase 0 built:
- **`pushNotify` takes `userType: 'customer'`**, with `customerId`, or `phone`
  matched against `customers.phone`. Visit and request alerts only know the
  lead's wa_id; this is the Espace Client's own phone match.
- **`category`**: checked against `notification_preferences` (no row = on;
  missing table = on). Off means not pushed, so WhatsApp goes as before.
- **Customers' urgent late copy** waits `PUSH_CUSTOMER_FALLBACK_MIN` (10).
- **The FCM data carries `audience`**, so a tap opens the right inbox.
- **`fallback.sender`** names the WhatsApp send when it is not the kind's own.
  `customer_text` is a plain text to `fallback.phone`.
- **`POST /admin/push`** (API key) lets web push: `{userType, userId|phone,
  kind, category?, title, body?, url?, urgent?, fallbackText?}` → `{pushed,
  reason}`. When `pushed` is false the caller sends its WhatsApp itself. Web
  helper: `lib/adminApi.js` `pushToAccount` (never throws).
- **Migration** `20261110_push_notifications.sql` now also creates
  `notification_preferences` (PK user_type, user_id, category).
- verify-pipeline §99.

### Customer alerts app-first (2026-11-10, part 2 phase 1)

Today's customer alerts try the app first. Without the app, every one of them
is the same WhatsApp message as before. Categories are the customer's Mon
profil switches.

- **Visits** (`viewingNotifications.tellCustomer`, category `visits`, opens
  `/compte/client/visites?visite=<id>`):
  - Urgent, with a late WhatsApp copy only while the visit is still in the
    status it was sent for (`sendCustomerVisitFallback`, `expectStatus`):
    - confirmed (WhatsApp accept, dashboard, desk), status `CONFIRMED`
    - new time proposed and its 3 h reminder, `RESCHEDULED`; the copy re-runs
      `proposalWhatsApp`, buttons included
    - cancelled by the agent, `CANCELLED`
    - the 15-minute "no answer yet", `PENDING`
  - Urgent, no status check: agent can't do the visit. One notification; the
    WhatsApp copy is the unavailable template plus the alternatives text.
  - Not urgent, no late copy:
    - post-visit check-in (the visit card carries the three answers)
    - visit receipt (`visitReceipt.sendReceipt`)
  - The proposal still claims the customer's next WhatsApp message whichever
    channel carried it.
- **An agency took the request** (`leadClaims`, category `requests`, opens
  `/compte/client/messages`): urgent, sender `customer_text`.
- **Chat** (`chatNotify.deliverAlert` customer role, category `messages`,
  opens `/messages/<thread>`): urgent, sender `customer_text`.
- **Website-side senders** go through `lib/adminApi.js`:
  - `sendToCustomerAppFirst` (urgent, the WhatsApp text as `fallbackText`):
    the agent's dashboard reply and alternatives.
  - The cron route `api/cron/search-alerts` calls `pushToAccount` for
    saved-search matches (`search_alerts`) and price drops on saved listings
    (`saved_listings`). These are app only when pushed, with no late copy
    (owner decision), and WhatsApp as before otherwise.
- **Stays on WhatsApp:** replies to a WhatsApp message the customer just
  sent (proposal thanks, check-in follow-ups, "Notez l'agent", enquiry
  handoff, signup welcome, assistant), and the codes.
- ~~Known gap: a customer who turned WhatsApp alerts off got these in the app
  neither.~~ Fixed in phase 2: the sweeps read them and the route only
  pushes.
- verify-pipeline §100; web `tests/unit/push-notifications.test.js`.

### New customer alerts (2026-11-10, part 2 phase 2)

New since the app. Every alert here is fire-and-forget. None of them has a
Meta template, so "WhatsApp in window" means a session text that is sent only
when the customer wrote to us in the last 24 h (`sessionWindow`).

**Opt-out fix.** The saved-search and price-drop sweeps now also read
customers who turned WhatsApp alerts off (`whatsapp_opted_out`). The cron
route pushes to them and never WhatsApps them.

**`services/customerAlerts.js`:**

| | Alert | Channel | Where it is sent |
|---|---|---|---|
| B1 | Visit request sent | push only | end of `notifyViewingRequest`; new requests only, not reassignments |
| B2 | Visit reminders: the evening before (18–21 h Kinshasa) and 2 h before | push, else WhatsApp in window | job `visit-reminders`, every 5 min |
| B3 | The desk changed the visit: cancelled or rescheduled from the console, or reassigned | push only | the console `PATCH /viewing-requests/:id` still WhatsApps nobody; reassignment via `reassignViewing` |
| B4 | The customer's own cancel or accept from the Espace Client | push only | `respondFromCustomer` |
| B7 | Nobody took the request (`unclaimed` / `no-coverage`): the team takes over | push, else WhatsApp in window | `leadDispatch.alertDeskOnce` |
| B8 | Move project, 24 h with no agency: the team is calling | push, else WhatsApp in window | `moveFollowup` |
| B12 | A project enquiry was passed on | push only | `projectEnquiry` |

Notes on B2:
- Each reminder is stamped on the row before it is sent, in the new SQLite
  columns `viewing_requests.reminder_eve_sent_at` and
  `reminder_soon_sent_at`.
- A 2 h reminder also closes the evening one.
- `VISIT_REMINDERS=off` stops the job.

**B5, an agent proposed a listing:** web `proposeListingAction` →
`notifyCustomerOfProposal`, using `sendToCustomerAppFirst` with the lead's
stored number. Category `requests`.

**B9–B11, saved listings** (`services/favoriteStatus.js`, job
`favorite-status`, 11 h Kinshasa):
- Detects a saved listing that was let or sold, went under offer, was
  withdrawn, or is back on the market.
- Records the last state told in the new Postgres table
  `favorite_status_notices`.
- First sight is recorded silently.
- App only, category `saved_listings`, at most 5 a customer per run.
- `FAVORITE_STATUS=off`, `FAVORITE_STATUS_HOUR`.

**B6** is built: see "The 24 h follow-up" in docs/claude/leads-and-enquiries.md.

verify-pipeline §101.

### Standard portal alerts, first batch (2026-11-10, part 2 phase 3)

App only, never WhatsApp: no template covers them, and the owner chose
app-only for discovery alerts. Only customers with the app are read.

- **C1, instant match.** Engine job `instant-alerts` runs at minutes 5, 15,
  25 and so on (`INSTANT_ALERTS=off`). It calls web's `/api/cron/instant-alerts`
  (`lib/instantMatchSweep.js`).
  - Same rules as the daily sweep: only listings published after the search
    was saved, never a widened result, nothing already notified.
  - Only searches of customers with a live device; the WhatsApp opt-out does
    not apply.
  - At most 3 a customer per 24 h.
  - A pushed listing is recorded in `saved_search_notifications`, so the
    daily alert skips it. A push that did not go records nothing, so the
    daily alert still carries it.
- **C3, similar listings** (`portalAlerts.similarListingsPath`): a
  `/listings` search on the same commune and type of deal, up to 30 % above
  the price.
  - Pushed after a visit took place (`visitReceipt`). `SIMILAR_SUGGESTIONS=off`.
  - The "let / sold" notice for a saved listing opens it too.
- **C8, new photos** (`favoriteStatus`): a saved listing still on the market
  with more photos than when last told. Uses the new column
  `favorite_status_notices.photo_count`.
- **C7, "Toujours en recherche ?"**: job `search-checkup`, Mondays 10 h
  Kinshasa (`SEARCH_CHECKUP=off`).
  - Each customer's oldest active search that has been saved for over 30 days.
  - Asked again only after 60 days.
- The rest of phase 3 is below ("Standard portal alerts, second batch").
- verify-pipeline §103; web `tests/unit/push-notifications.test.js`.

### Standard portal alerts, second batch (2026-11-10, part 2 phase 3)

**How they run.**
- Web computes them (`lib/portalDigests.js`), for app users only: every query
  reads customers with a live `push_devices` row.
- Every send is a push through `pushToAccount`, never WhatsApp.
- Repeats are stopped by the `notifications` rows the pushes write (kind +
  `ref_id`), so there is no bookkeeping table.
- The engine only calls web on time (`services/portalAlerts.js`,
  `/api/cron/portal-alerts`, one `task` per call).

| | Alert | Schedule | Notes |
|---|---|---|---|
| C2 | A price cut on a listing the customer visited or enquired about | job `portal-daily`, 12 h Kinshasa | See below |
| C5 | A new project in a commune the customer searches | same job | Public projects under 14 days old; one per customer per run |
| C9 | Weekly summary: new matches for their searches, unread messages | job `weekly-summary`, Sundays 18 h | Nothing on a quiet week; at most one per 6 days |
| C6 | Monthly price report | job `monthly-market`, the 1st at 10 h | The price guide (`getPriceGuides`) for the first commune they search, 2 bedrooms first; opens `/combien-coute/<slug>`; at most once in 25 days |
| C4 | New listing from a followed agency | rides on `instant-alerts` | See below |

**C2, price cut on an enquired listing:**
- The engine sends the wa_id × listing pairs from its SQLite: leads and
  visit requests, last 60 days.
- Same cut rule as the card badge.
- Only a cut made after the interest counts.
- Never a listing the customer saved: that one is the favourites' own
  message.

**C4, following an agency:**
- **Button:** "Suivre" on `/agents/<id>` (`components/FollowAgentButton.js`).
  A signed-out visitor gets a sign-in link that comes back to the page.
- **Route:** `POST /api/account/follows` uses the session's customer and a
  live agent, with a 100-follows cap.
- **New table:** `customer_follows`, in the push migration.
- **What is pushed:** listings published after the follow.

**Kill switches:** `PORTAL_DAILY=off`, `WEEKLY_SUMMARY=off`, `MONTHLY_MARKET=off`.

**Notifications can now open more pages:** `safeCustomerPath` and
`alertTarget` allow `/projets`, `/combien-coute` and `/agents`.

verify-pipeline §104; web `tests/unit/push-notifications.test.js`.
