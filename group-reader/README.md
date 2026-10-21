# Lukka Place group reader

The engine receives WhatsApp through the Cloud API (Chakra), and the Cloud API
**never delivers group messages**. So listings that brokers post in their
admin-only WhatsApp groups never reach Lukka Place. This service fixes that.

It logs in as a **linked device** of the "Lukka Place Annonces" SIM (the same
way WhatsApp Web does), reads only the groups you list, batches each broker's
burst of photos and text, drops chatter, and POSTs every listing to the
engine's `POST /internal/group-posts`. The engine then treats it like any
other intake.

It is a separate process with its own `package.json`. It does not import
any engine module.

## ⚠️ Ban risk (read this first)

This uses [Baileys](https://github.com/WhiskeySockets/Baileys), an
**unofficial** WhatsApp Web client. That is against WhatsApp's Terms of
Service. WhatsApp can log the device out or **ban the number** at any time,
without warning. The owner accepted this risk **for the annonces SIM only**:

- **Never link the business numbers** (+243 976 321 848 intake,
  +243 846 962 654 notifications) or anyone's personal phone. If WhatsApp bans
  the linked number, it loses WhatsApp entirely.
- The reader is strictly read-only, to look as passive as possible. It never
  sends a message. It never marks anything read (no blue ticks). It sends no
  "online" presence (`markOnlineOnConnect: false`) and does not sync history.
  It never asks a poster's phone to re-upload expired media. Its delivery
  receipts are WhatsApp's "inactive" kind, the same as a phone that is
  switched off. Keep it that way. Adding any send greatly raises the ban risk.
- Run one instance only. Two readers on the same login keep kicking each other
  off, and that is exactly the kind of behaviour that gets a number flagged.
- Keep the SIM's phone switched on and connected now and then. A linked device
  is dropped when its main phone has been offline for about 14 days.
- Use the SIM's phone like a person would. Join groups by invitation, and don't
  join dozens of groups in one day.
- If it gets banned, the phase-1 relay (staff forwarding posts from the SIM's
  phone, `services/groupRelay.js`) still works on a new SIM.

## Setup (VPS)

```bash
cd /path/to/lukka-place-engine/group-reader
npm ci --omit=dev
```

Node 20.12 or newer is required (for `util.parseEnv` and Baileys).

### Environment

The reader loads `group-reader/.env` first, then the engine's `../.env`. A
variable that is already set always wins. Usually only the
`GROUP_READER_GROUPS` line needs adding to the engine's `.env`.

| Variable | Default | |
|---|---|---|
| `GROUP_READER_GROUPS` | — (required) | Comma list of group JIDs to read (`1203630…@g.us`). Every other chat is ignored. |
| `API_SECRET` | — (required, from the engine's `.env`) | Sent as `x-api-key`. |
| `ENGINE_URL` | `http://127.0.0.1:3000` | The engine. |
| `UPLOADS_DIR` | `../uploads` (from the engine's `.env`) | Photos are written to `$UPLOADS_DIR/listings/grp_<msgid>-<n>.jpg`. It **must** be the engine's directory: the engine serves and reads `/uploads/listings/…` from there. |
| `GROUP_READER_AUTH_DIR` | `/var/data/group-reader-auth` | Baileys multi-file login state. This **is** the login, so keep it private. Anyone with a copy can read the SIM's WhatsApp. |
| `GROUP_READER_STATE_FILE` | `/var/data/group-reader-forwarded.json` | Ids of messages already sent to the engine, so a restart never re-sends them. |
| `GROUP_READER_QR_PNG` | `$GROUP_READER_AUTH_DIR/link-qr.png` | The linking QR, also as an image. |
| `GROUP_READER_LOG_LEVEL` | `warn` | Baileys' own (pino) log level. |

### 1. Link the annonces SIM (once)

Run it in a terminal, not under PM2, so you can see the QR:

```bash
node index.js --list-groups
```

On the annonces SIM's phone, go to WhatsApp → **Appareils connectés** →
**Connecter un appareil** and scan the QR shown in the terminal. If the
terminal can't show it, `scp` the PNG at `$GROUP_READER_QR_PNG` to your
computer and scan that. The QR changes about every 20 seconds, and the PNG is
rewritten each time.

### 2. Choose the groups

Once linked, `--list-groups` prints every group the SIM is a member of and
then exits:

```
120363012345678901@g.us	Immo Kin Location	(212 members, admin-only)
120363098765432109@g.us	Agents Limete	(87 members)
```

Copy the JIDs you want into the engine's `.env`:

```
GROUP_READER_GROUPS=120363012345678901@g.us,120363098765432109@g.us
```

At startup the reader warns about any listed group the SIM has not joined.
After joining a new group, run `--list-groups` again, add its JID, and restart
the reader with `pm2 restart lukka-group-reader`.

### 3. Run it under PM2

The app is declared in the repo's `ecosystem.config.js` as
`lukka-group-reader`: one fork-mode instance, `restart_delay` 15 s, and
`kill_timeout` 30 s so that stopping it still sends any open batches.

```bash
pm2 start ecosystem.config.js --only lukka-group-reader
pm2 save
pm2 logs lukka-group-reader
```

## What it does with a message

1. **Filter.** It drops anything that is not in a group listed in
   `GROUP_READER_GROUPS`. That covers direct messages, `status@broadcast`,
   other groups, the SIM's own messages, history sync, reactions, stickers
   and voice notes.
2. **Download.** It downloads photos as soon as they arrive, because WhatsApp
   media links expire.
3. **Batch.** It groups messages per (group, author) until that author has
   been quiet for **10 s**, or for at most **60 s** after their first message.
   This is the same idea as the engine's webhook buffer.
4. **Pre-filter.** A batch is sent only if it has a photo, or if its text names
   a kind of property **and** a price. This is a copy of `standsAloneAsListing`
   from the engine's `services/listingBoundary.js`, kept in
   `lib/prefilter.js`; if you change one, change the other. "Bonjour la
   famille" and "toujours dispo ?" never cost an extraction call.
5. **Post.** It sends this to `POST $ENGINE_URL/internal/group-posts`:

   ```json
   { "via": "reader", "groupJid": "…@g.us", "groupName": "Immo Kin Location",
     "posterPhone": "243810000000", "posterName": "Jean",
     "text": "…", "photos": ["/uploads/listings/grp_<msgid>-0.jpg"],
     "wamids": ["…"] }
   ```

   `posterPhone` is `null` when WhatsApp hides the poster's number. In
   groups that use WhatsApp's LID privacy addressing, the participant is an
   opaque `…@lid` id, and the reader never passes those digits off as a phone
   number. `posterName` and `groupName` can also be `null`.
6. **Handle the reply.**
   - **2xx**: done. The message ids are recorded in `GROUP_READER_STATE_FILE`.
   - **4xx**: logged and dropped. The ids are recorded too, so the post is not
     tried again.
   - **5xx or network error**: retried at 2 s, 4 s, 8 s … (up to 2 min), 8
     attempts in total. After that a `GAVE UP` line is logged and the photos
     stay on disk.

## Disconnects and relinking

The reader reconnects by itself, with backoff from 5 s up to 5 min.

- **`connectionReplaced`**: it waits 60 s and logs that another instance may
  be using the same login.
- **Logged out** (the device was unlinked on the phone, or WhatsApp banned or
  logged out the number): it logs a loud `LOGGED OUT` banner and **exits with
  code 2**. PM2 restarts it, and it then prints a QR that nobody scans. Group
  listings stop arriving until someone relinks:

  ```bash
  pm2 stop lukka-group-reader
  rm -rf /var/data/group-reader-auth
  node index.js --list-groups    # scan the QR again from the annonces SIM
  pm2 start lukka-group-reader
  ```

  If the number itself was banned, don't relink another SIM straight away.
  First check why it happened: too many groups joined at once, or a second
  instance running.

## Tests

```bash
npm test
```

The tests cover the pre-filter, the batching (with fake timers), the
group/DM/LID rules, the forwarded-id store and the forwarder's
retry/drop rules. They make no network calls and need no WhatsApp login.
