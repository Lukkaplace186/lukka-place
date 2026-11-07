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
WhatsApp is the only notification channel this product has.

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
  Delete the line and restart to resume. §74.
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
