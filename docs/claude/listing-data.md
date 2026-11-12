# Listing data — schema, extraction, media, types, cities

> Moved verbatim from the root CLAUDE.md on 2026-11-06 to keep it short. The rules in CLAUDE.md
> still bind; this file is the detail and history. When you change this area, update this file
> (a dated section: what, why, env vars, the verify-pipeline §). "See X below/above" may point to a
> section now in another docs/claude file: `grep -rn "X" docs/claude`.

## Data Schema & Location Hierarchy
- **Location Normalization**: NEVER hardcode or invent locations. ALWAYS resolve Communes and Quartiers against `kinshasa_locations.json` using `services/locations.js` (`resolveCommune`, `resolveQuartier`, `quartiersForCommune`, `cascadeCommuneChange`).
  - **Commune from the quartier (2026-10-07).** `kinshasa_locations.json` holds the official quartiers (checked against the communes' Wikipedia pages); `kinshasa_quartier_aliases.json` holds the names agents write that are not official ("GB" → Ngaliema, owner-confirmed; Mimosas, Righini, Synkin, Matonge…), each with a declared source. `inferCommune` / `inferListingLocation`: a name in ONE commune deduces it, stored as `parsed_json.commune_inferred_from` and shown on the intake card as "déduite de « … »" for the agent's OK to confirm; a name in SEVERAL (Salongo, Funa, Saïo, 24 Novembre…) is never guessed, and the card asks "« Funa » existe à Barumbu et à Limete. Dans quelle commune ?". A bare commune name as the reply (`communeNamedIn`, exact only) fills the draft. The extraction prompt tells the model not to deduce the commune itself.
  - **No citywide typo match.** With no commune, `resolveQuartier` used a 30% edit-distance match over every quartier and STORED the result ("Wangata" → Mangana, "tonde" → Konde). It now only canonicalises an exact (accent/numeral-folded) official name; typos need the same first letter, 1 edit (2 from 9 letters) and a single best candidate. Ordinary words that are also quartiers (École, Gare, Kasaï…) only count as the whole text.
  - **Adding an alias**: one commune needs a source (it produces a guess); adding a commune to an existing name is always safe (it only produces a question). Measured on every place agents had typed (2026-10-07): 10 deduced, 9/9 agreeing with the commune the agent tagged, 0 wrong; 12 asked. §47.
  - **The quartier keeps a quartier, the reference keeps the landmark (2026-11-03).** Agents typed "Maison communale de Kintambo, sur avenue" as the quartier, or left it empty with "Mbiza pigeon Référence maternité" in the reference. The prompt used to say "la référence précise va dans quartier"; it now says the quartier is a place name only and a landmark goes to `reference` (unless the message has a listing code). Once a commune is known (stated or deduced), `tidyListingLocation` (inside `inferListingLocation`, so intake and group captures, and in `normaliseRowLocation` at sync) searches **that commune's** quartiers and aliases only: a phrase that reads as a landmark (>25 chars, >3 words, or a word like avenue / maison / église / réf) moves to the reference — merged with a landmark already there, never over a code (`readsAsWords`, the geocoder's landmark rule) — and the quartier becomes the one the phrase names, else NULL; an empty quartier is filled from a quartier named in the reference. A short unknown name ("Righini", "Jamaïque") is kept as written. A correction writes the emptied quartier only through `quartier_cleared`. Old rows: `node scripts/backfill-quartier-landmarks.js [--write]` (Postgres + SQLite, dry run by default, each UPDATE guarded on the values it read). The admin editor's quartier is a picker filtered by commune with "Autre…" (web `components/QuartierPicker.js`). §70.
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

## OpenAI cost (2026-11-03)

- **Listing reading stays on gpt-4o** (intake, corrections, smart paste, buyer
  assistant). gpt-4o-mini was measured against it (`scripts/eval-intake-models.js`,
  real messages + hard cases): it merged a 3-listing paste into one, missed
  "c'est déjà loué", filled listing fields from a buyer's search, invented
  garantie months and put streets in `quartier`. It is no cheaper with photos
  (~33x tokens per image). Only `priceExtraction` uses it (`OPENAI_TEXT_MODEL`),
  because its answer must be a number literally in the text.
- **Photos with a written listing (≥120 chars) go at `low` detail**
  (`OPENAI_IMAGE_DETAIL_WITH_TEXT`): 8 photos ~8,400 → ~700 input tokens, same
  extraction on the real photo listings. A short or absent caption (a flyer)
  keeps `OPENAI_IMAGE_DETAIL`.
- The ~13k-token system prompt + schema is already ~93% served from OpenAI's
  prompt cache (measured); `prompt_cache_key` keeps it so. Output caps
  (`max_completion_tokens`) are runaway guards sized for multi-property
  pastes — never 500. Incoming text is not truncated: a long broadcast is
  usually several listings, and cutting it drops them.
- **Reply speed.** The model writes only the greeting above a single
  listing's card ("Merci, c'est corrigé. Voici la fiche mise à jour :" for a
  correction) — never the card itself, which `listingCard` draws from the row
  and used to replace anyway. ~550 → ~340 output tokens, 1–2 s sooner per
  reply; extraction unchanged (it is emitted before the reply). Multi-unit /
  multi-property recaps are still the model's. An "OK" to a draft is flushed
  from the burst buffer at once instead of after `GROUP_IDLE_MS` (8 s).
- **Every model call logs its cost** (2026-11-04): `[ai-cost] <kind> <model>
  in= cached= (N%) out= cost=Xc` from the usage the API returned
  (`openai.callCost`, prices in `PRICES_PER_MILLION` — update them when
  OpenAI's change; an unknown model logs `cost=?`). Kinds: intake, buyer,
  smart-paste, closing-price. `grep "\[ai-cost\]" logs/pm2-out.log` gives
  the real cost per listing and the cache hit rate. Embeddings and voice
  notes are not logged (fractions of a cent).

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

## Fiche pratique — four one-tap questions after "OK" (2026-11-12)

`services/practicalFacts.js`, `migrations/20261112_listing_practical_facts.sql`
(web half: web/CLAUDE.md, same heading). §107 of verify-pipeline.

- **Why**: power and water are what a Kinshasa tenant asks first, and agents
  rarely write them in the advert, so the "Électricité" / "Eau" filters had
  little to filter. A structured answer from the agent is the only way to
  have them without inventing them (owner decision 2026-11-12).
- **When**: right after the publish receipt on both "OK" paths in
  routes/webhook.js, as reply buttons (session message — the agent just wrote
  to us). One question at a time: Courant (SNEL seulement / SNEL + groupe /
  SNEL + solaire), Eau (REGIDESO / REGIDESO + citerne / Forage ou puits),
  Accès en saison des pluies (Bon / Difficile / Route inondée), Frais de
  visite (Non / Oui). Each tap saves and asks the next; the fourth sends
  "fiche enregistrée"; a later tap is "réponse mise à jour". An agent who
  stops answering leaves the rest NULL — nothing is asked again.
- **Not asked**: bare land (`isLandOnly`), several unrelated properties pasted
  together, the registration path (agentOnboarding publishes on the name
  answer), draft auto-submit, group captures, `FICHE_PRATIQUE=off`. A
  building pasted as units is asked once and every unit gets each answer.
- **Who may answer**: only the number that sent the listing (`listings.wa_id`).
  Button id `fiche:<listing>:<c|e|a|f>:<value>`; anything else is not ours.
- **Stored**: SQLite `listings.power_supply`, `water_supply`, `rainy_access`,
  `visit_fee` (0/1), `practical_answered_at`; the same on `properties`
  (CHECKed text, boolean, timestamptz). NULL = not answered. Values are
  duplicated in web/lib/practicalFacts.js and the migration's CHECKs
  (web `practical-facts.test.js` compares the three).
- **Feeds the existing filters**: an answer ADDS the matching utility codes
  (groupe, solaire, regideso, citerne, forage, acces_facile) and the
  has_generator / has_solar ticks. Never removes anything; "SNEL seulement"
  and a difficult or flooded road add nothing.
- **Postgres**: each tap is mirrored with `updatePracticalFacts`
  (COALESCE — never clears a value); a tap that beats the first sync is
  retried once 20 s later and the INSERT path reads the row fresh. Tolerates
  42703 before the migration (logged, answers kept in SQLite).
