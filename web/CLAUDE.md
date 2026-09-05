# Lukka Place — Web (Next.js storefront)

Public marketplace for [Lukka Place](../CLAUDE.md) (the root repo is the WhatsApp
intake engine — that CLAUDE.md covers the overall system architecture and data
flow; this file is scoped to this Next.js app specifically). Live at
lukkaplace.com.

**Next.js 16 (App Router), Tailwind v4, plain JS (no TypeScript).** See
`AGENTS.md` before touching anything App-Router-shaped — this version has real
breaking changes from older training data (async `params`/`searchParams`,
`fetch` no longer cached by default, etc.).

## Data & security rules

- **Every query against `properties` filters on `status = 1 AND approve_status = 1`, no exceptions.** There is no Row Level Security on this table — the query-time filter in `lib/listings.js` is the only thing keeping pending/unapproved listings private. A detail-page lookup by id repeats this filter too: a guessed/leaked URL to a pending listing must 404, never partially render.
- **DB credentials are server-only.** `lib/db.js` imports the `server-only` package specifically to make an accidental import from a `'use client'` file a build error, not just a review miss. Never let `DB_*` env vars near a `NEXT_PUBLIC_` name or a client component.
- **Commune is not a column.** It's tagged via `property_amenities` onto one of amenity ids 21–44 (see the engine's `services/postgres.js`, `COMMUNE_AMENITY_IDS`). Reading it back means joining `property_amenities` → `amenity_contents`, not `SELECT commune`. `quartier`, `parcelle_subtype`, `units_count`, `reference` *are* real columns.
- **Category names are capitalised in the database** — the live values are `'Appartement'` and `'Maison'`, not lowercase. The property-type filter compared against a hardcoded lowercase `'appartement'` for months and silently matched nothing; it now uses `LOWER(catc.name) = $n`. Don't "simplify" that back to an exact match.
- **Don't hardcode filter option lists.** `getPropertyTypeFacets()` derives the property types (with real counts) from the database, so an option that would return zero results is never offered. Same principle as `getCommuneShowcase()` / `getPopularCommunes()`.
- **This app talks to two things**: the Supabase Postgres DB directly (via `pg`, read-only in intent — see the TODO in `.env.local` about a scoped DB role that hasn't been created yet), and the engine's `GET /locations` (via `lib/locations.js`, fetched server-side only — never client-side, which is what avoids needing CORS on the engine).
  - **The engine being down must not take `/listings` down.** That fetch only feeds the filter bar's commune→quartier hierarchy; the listings themselves come from Postgres. Use `getLocationHierarchySafe()`, which returns empty on failure so the page falls back to DB-derived communes. `/listings` used to 500 outright whenever the engine was unreachable.

## No fabricated data — this one comes up constantly

Never invent a value to fill a UI slot that has no real data behind it. When a
reference design assumes something we don't have, either map it onto real
data, source a properly-licensed real asset, or render an honest absence —
don't guess. Examples already in this codebase:

- No per-listing agent phone/email/name/photo exists in Supabase → all "Contact" CTAs route through the one real WhatsApp number (`NEXT_PUBLIC_WHATSAPP_NUMBER`) and render an honest disabled state (not a dead `wa.me` link) when that env var is empty — see `WhatsAppCTA.js`, `EnquiryCard.js`, `MobileListingBar.js`. The reference portals put an agent card in exactly the slot `EnquiryCard` occupies; that is the single most tempting thing to fabricate here.
- No real Lukka Place social accounts exist yet → Facebook/Instagram icons in `Footer.js` are inert `<span>`s, not `<a href="#">`.
- `ExploreCommunes.js` shows **a real photo of a real approved listing in that commune**, plus that commune's real listing count (`getCommuneShowcase()`). It used flat gradients before, because a stock photo captioned "Gombe" would have been a fabrication. A commune whose latest listing has no usable photo falls back to the typographic treatment rather than borrowing another commune's image.
- Card chip badges are limited to what the data can prove: photo count (`gallery.length`), "Location" (`purpose`), door count (`units_count`). No "Price cut" (no price history exists), no days-on-market shaming, no invented amenity hooks. See `ListingBadges.js`. ("Nouveau", 14-day `created_at`, used to be one of these — removed entirely from every listing on an explicit instruction; not a data-honesty issue, the badge was real, it's just gone now.)
- The hero background (`public/hero-kinshasa.jpg`) is a real, properly-licensed photo (CC BY-SA 2.0, Wikimedia Commons — MONUSCO/Abel Kavanagh) with the required credit rendered in `Hero.js`. It has been re-encoded to ~330 KB (it shipped at 5.6 MB). Anything that replaces it keeps both properties: real licence, visible credit where the licence asks for one.
- `PropertyMetrics.js` shows a rental listing's own price as its monthly income and nothing for a sale listing — no market-comparable dataset exists to estimate a yield. `/plan` stays an honest empty page for the same reason: a budget calculator would need financing rates we don't have.
- `lib/currency.js` is a **manually-maintained, dated** rate, not a live FX feed. Everything that displays CDF says so — `<Price>` marks it "≈" with a dated tooltip, and `CurrencyBridge.js` states the date in copy. Don't imply it's live.

## Design system

Warm luxury palette over a Zillow/Rightmove-style portal information
architecture: the references supply the skeleton (filter pills, card anatomy,
map/results split, desktop rail), the palette and type supply the skin.

**Density is deliberate and split by surface**: `/listings` is dense and
scannable like the references; `/` and `/listings/[id]` are airy and emotive.
Scan fast to find, linger to decide.

- **Tokens live in `app/globals.css`** (Tailwind v4 — there is no config file). Ground is `canvas` (`#FBF9F6`, warm, deliberately not `#fff`) with white `surface` cards on top; that figure/ground separation is what the previous all-`#ffffff` palette lacked and why cards needed shadows to be visible.
  - Naming: the ground is `canvas`, **not** `stone` — Tailwind ships a built-in `stone-*` scale and having both `bg-stone-deep` (ours) and `bg-stone-800` (theirs) reads as a typo.
  - The old `--color-lukka-blue*` tokens are **gone**. They held a dark slate identical to the body text, so nothing could read as a primary action. Don't reintroduce a token whose name doesn't match its value.
- **Bronze contrast rule — computed, not assumed. Follow it exactly:**
  - white on `--bronze` (`#A6642A`) = **4.69:1**, passes AA → bronze is a **fill** colour.
  - `--bronze` as text on `--canvas` = **4.46:1**, **fails AA** → never use it for body-size text.
  - `--bronze-deep` (`#7E4A1C`) on `--canvas` = **6.93:1**, passes → all bronze text, links and small icons.
- **Type is sans-led**, and there is now exactly one scale for the whole application — see the **Typography** section below, which supersedes any per-surface heading convention. Plus Jakarta Sans carries all UI, filters, prices, card data and body copy; DM Serif Display is an *accent only*, at regular weight, for page and section titles on every surface including `/admin`. No mono family is loaded: reference codes use `.u-ref`. (This bullet previously named Inter and Fraunces — both were replaced by the "WhiteBlue Royal" pass and the note was stale.)
- **Utilities that carry the look**: `.u-eyebrow` (uppercase 11px/0.12em — the editorial workhorse), `.u-tabular` (**every price**, or grid columns go ragged), `.u-ref`, `.u-lift` / `.u-lift-lg` (the only real elevations; cards use hairline `border-line` instead of shadows).
- **Colours that can't reach CSS**: `lib/mapIcons.js` (SVG data URIs) and `lib/mapStyle.js` (Google Maps `styles` array) hardcode the palette because neither can resolve CSS custom properties. Keep them in step by hand.

## Typography — one scale, four surfaces

**Before this, the app ran four typographic dialects on one font stack**, which
is why the storefront, the agent portal, the Espace Client and `/admin` read as
different products: the public site set headings in DM Serif, the agent portal
used the serif for its page title but ad-hoc `text-[1.125rem] font-bold` sans
for every card heading, the client portal had a third set of arbitrary sizes,
and `/admin` used the display face **zero times** — every heading sans-bold at
`text-xl` / `text-[1.3125rem]` / `text-sm`.

**Two families, one hierarchy, applied identically everywhere** (tokens and
utilities in `app/globals.css`):

| Utility | Face | Size | Use |
| --- | --- | --- | --- |
| `.u-title-hero` | DM Serif | 32→40px | the h1 of an editorial full-page (Espace Client, /compte/alertes, /compte/demandes) |
| `.u-title-page` | DM Serif | 28→30px | every dashboard page header — agent AND admin |
| `.u-title-section` | DM Serif | 22px | a band within a page; auth-card titles; empty-state titles |
| `.u-title-card` | Sans 700 | 17px | the heading inside one card or panel |
| `.u-title-sub` | Sans 700 | 15px | a group label above a field cluster |
| `.u-micro` / `.u-micro-strong` | Sans 400/600 | 13px | the dashboard workhorse: table cells, filter controls, form labels |
| `.u-stat` | Sans 800 tabular | 28px | a headline metric on a stat tile |

**Use these instead of writing a new arbitrary `text-[…]`.** A one-off size is
exactly how the four dialects happened. `.u-price`, `.u-body`, `.u-meta`,
`.u-eyebrow`, `.u-ref` and `.u-tabular` are unchanged and still apply.

The serif is what makes an admin console read as part of the same product as
the storefront — it is why it now appears there at all. It stays regular
weight only (the face has no bold cut) and never carries UI or data.

## Listing lifecycle — three independent axes

Conflating any two of these is the bug that keeps recurring:

| Column | Meaning | Who owns it |
| --- | --- | --- |
| `approve_status` | moderation: 0 pending / 1 approved / 2 rejected | admin only |
| `listing_status` | market state: `active` / `under_offer` / `closed` | agent (+ admin override) |
| `status` | visibility: 1 public / 0 hidden | agent ("Archiver") and admin ("Suspendre") |

- **Archiving is `status = 0`** — the existing active/enabled flag the public
  filter already excludes. No new visibility mechanism was invented; the only
  new column is `archived_at`, which records *when*, so an agent archive is
  distinguishable from a listing that was simply never enabled.
- **Closing a transaction requires a real price AND a real date.**
  `markListingSoldAction` writes `sold_price` + `sold_at` and sets
  `status = 0`, so a concluded property leaves public search. `sold_at` exists
  because days-on-market was previously derived from `updated_at`, which moves
  every time anything on the row changes — a listing touched three months after
  closing reported a three-month-longer DOM.
- **`lib/dataExport.js` filters on `approve_status = 1` ONLY**, and is the one
  query in this codebase that deliberately does not apply the public
  `status = 1 AND approve_status = 1` gate. Filtering on `status` there would
  drop every SOLD listing — the rows carrying `sold_price`, `sold_at` and the
  achieved-vs-asking delta, i.e. the entire commercial value of the dataset.
  Consumers who want live supply only filter the new `currently_listed` column.
  `tests/unit/data-export.test.js` asserts this on the SQL text, not on rows.

## Admin console

- **`lib/adminListings.js` is separate from `lib/agentListings.js` on purpose.**
  The latter enforces `AND agent_id = $n` on every statement — that scoping is
  its whole point and must never be weakened. An admin needs to reach any
  listing, including the ~23 with no agent attached. Two modules with two
  explicit authority models beats one module with a "skip the ownership check"
  flag someone eventually passes from the wrong place.
- **Granular override editing** (`/admin/listings/[id]`) is what the console was
  missing entirely: it previously offered exactly two verbs, Approuver and
  Rejeter, so a listing with a transposed price or a missing commune could only
  be bounced back to its agent over WhatsApp. That is why 6 approved listings
  still carry no commune tag — nobody had a way to add one.
- **Suspendre ≠ Rejeter.** Rejection is a moderation verdict that notifies the
  agent their listing was refused; suspension is operational and reversible in
  one click, leaving approval intact. `?status=suspended` is a fourth
  moderation queue reading a *different column* (`status = 0 AND
  approve_status = 1`) — see `LISTING_MODERATION_STATUSES`.
- **`/admin/agents/[id]`** owns identity, territory (specialty vs coverage —
  they score differently in the matcher), the verification badge, session
  revocation, WhatsApp password-reset links, and portfolio reassignment.
  `agents.phone` is deliberately **not** editable: it is the primary
  identifier, and changing it would silently invalidate listing attribution,
  the verification that granted the badge, and sessions.
- **Duplicate detection** flags same-normalised-phone and same-email groups
  only, never name similarity. The phone normaliser folds DRC shorthand onto
  `243…` and leaves every other country's digits alone — an unconditional
  `243` prefix turned a real UK number in production into `243447932673460`.
- **Quotas are per-PACKAGE, not per-agent.** This schema has no per-agent quota
  column; a UI implying one would promise an override nothing enforces.
- **`plan_change_requests`** is the queue behind the agent-facing "Demander ce
  forfait". There is no payment gateway by product decision — approving a
  request assigns the package and writes the ledger row in one action.

## Layout & shell

- **Public pages live in the `app/(site)/` route group**; `app/admin` and `app/api` sit outside it. The shell (`Header` / `Footer`) is in `app/(site)/layout.js`, and the root layout is deliberately bare. Before this, everything nested in one root layout and `/admin` rendered the public header and footer *underneath* its own chrome. Route groups don't change URLs.
- **Spacing contract, defined once in `app/(site)/layout.js`**: `pt-16` clears the fixed `h-16` Header. Don't re-implement this per page — four pages used to compensate ad hoc with different values.
- **There is no desktop left icon rail, and no persistent mobile bottom bar.** `SideRail.js` (a fixed 76px `Rechercher`/`Favoris`/`Demandes`/`Compte` column, `hidden lg:flex`) and `BottomNav.js` (the same four destinations, `lg:hidden`, fixed to the viewport bottom) have both been removed entirely — the former because web/Design's screens never carried one, the latter on an explicit instruction to favour a Rightmove-style pattern (no persistent bottom chrome, floating per-page actions instead). All four destinations are still reachable: `Rechercher` via the search icon/FilterBar, `Favoris` and `Demandes` as text links in Header's top-right utility row (desktop) or its hamburger Sheet menu (mobile — the last consumer of `components/navItems.js`'s shared `NAV_ITEMS`), `Compte` via the account dropdown or that same Sheet. Any element that used to clear BottomNav's height (`FloatingControlBar.js`, `MobileListingBar.js`, `ListingsSplitView.js`'s mobile fullscreen map layer) now sits at the true viewport bottom instead — check each if you're touching mobile-bottom-anchored UI, the clearance math changed everywhere it applied.
- `FilterBar` sticks at `top-16` (under the header) and `ListingsSplitView`'s map sticks at `top-[8.5rem]` (under both). Those numbers are coupled — change one, check the others.
- **The header is solid on every route, homepage included.** It used to start transparent over the hero photo and solidify on scroll (`Hero.js` carried `-mt-16` to bleed up under it, cancelling the layout's `pt-16`). The "Landing refondue" screen is explicit that it never goes transparent — the wordmark has to stay legible over whatever photograph the hero carries — so the scroll listener, the `overHero` flag and every `inverted` variant it drove (including `CurrencyToggle`'s) are gone, and the hero band starts below the header.

## Gotchas that cost real debugging time

- **Tailwind v4: no `tailwind.config.js`.** Any `--color-*` / `--font-*` in the `@theme` block becomes a utility automatically.
- **Don't trust an uncommon `grid-cols-N`/`col-span-N` to get generated.** `lg:grid-cols-10` silently never made it into the compiled CSS once. Prefer an arbitrary-value template (`grid-cols-[42%_minmax(0,1fr)]`) for anything beyond 1–6.
- **`@tailwindcss/postcss` and `tailwindcss` are devDependencies the *production build* still needs.** `npm install --omit=dev` breaks `next build`. Full `npm install` before building, even in production.
- **`useSearchParams()` forces a Suspense boundary around its caller.** `/favoris` called it at the top level, which put the *entire page* inside `<Suspense fallback={null}>` — verified in a browser, `<main>` rendered completely empty and the boundary never resolved. If a page needs one query param for one section, read `window.location.search` in an effect there instead of gating the whole page. If you do use the hook, scope it to the smallest component and never give it a `null` fallback.
- **Radix exit animations don't complete in a non-compositing tab.** With `document.hidden`, CSS animations sit at `currentTime: 0`, `animationend` never fires, and Radix `Presence` never unmounts — so a closed Dialog lingers in the DOM with `data-state="closed"` and keeps `body { overflow: hidden }`. This is an artifact of headless/hidden browser panes, **not** a code bug; it resolves the moment the page actually composites. Don't "fix" it.
- **`cn()` (tailwind-merge), not string concatenation, whenever a component accepts a `className` override.** `FavoriteButton` concatenated, so a caller's `bg-transparent` and the component's `bg-surface/90` both survived and CSS source order decided the winner instead of the caller.
- **`area` is a TEXT column carrying `'0'`, not NULL, when unknown** — a naive render produces "0 m²". Use `hasArea()` in `lib/listingView.js`.

## Component conventions

- **`lib/listingView.js` owns values derived from a listing row** — images, spec items, dates, location line, description snippet. The three card designs each re-derived these, which is exactly how the same 14-day recency condition once ended up rendering "Just Added" in one file and "Nouveau" in two others; that specific value (`isNewListing`) has since been removed from this module entirely along with the badge it fed, but the "one source of truth" principle stands for everything still here.
- **Three listing card designs exist on purpose** — `ListingCard.js` (horizontal, Rightmove-style 1-large-2-small photo collage, used on `/favoris`), `ListingCardVertical.js` (grid card for the `/listings` split view), `FeaturedListingCard.js` (homepage carousel teaser). One visual language, three layouts. Don't collapse them.
- **`SafeImage.js` for any listing-sourced image, never bare `next/image`** — some stored objects genuinely 400 at source, and a visitor should see the real "no photo" placeholder rather than a broken-image icon. `PhotoGallery`'s thumbnails used bare `next/image` and had no fallback while the main frame did.
- **UI primitives come from `components/ui/*` (shadcn, Radix).** Installed: `button`, `card`, `dialog`, `dropdown-menu`, `popover`, `sheet`, `tabs`. Add more with `npx shadcn@latest add <name>` — and **diff `app/globals.css` afterwards**, it has silently overwritten the palette before.
  - **Popover, not DropdownMenu, for filter panels.** DropdownMenu implements roving focus and typeahead over menu *items*, which fights any text or number input inside it. See `FilterPill.js`.
  - Radix content portals to `document.body`, so it is **outside the `<form>`**. `FilterBar` therefore owns every filter value in React state and renders hidden inputs inside the form; the pill panels and the sheet are pure UI. Don't put a named form field inside a portalled panel and expect it to submit.
- **Icons are `lucide-react`, always**, with `ICON_SIZE` / `ICON_STROKE_WIDTH` from `lib/constants.js`. The hand-rolled WhatsApp/Facebook/Instagram brand SVGs in `Footer.js` and `WhatsAppCTA.js` are the one deliberate exception — this lucide version ships no brand glyphs (confirmed by a failed build, not assumed).
- **Motion is `framer-motion` via `lib/motion.js`** — `revealUp`/`revealStagger` (section reveals), `imageZoom` (card photo on hover), `heroDrift`, `fadeScale`, `cardHoverProps`, `fadeInUp`. **Gate every decorative preset through `useMotionSafe()` (`lib/useMotionSafe.js`)** — `prefers-reduced-motion` was honoured nowhere before. Read the scope note at the top of `lib/motion.js` before wrapping a Radix `Dialog`/`Sheet` in `motion.div`: they animate via `data-state` + `tw-animate-css`, and layering framer-motion on top without `AnimatePresence` + `forceMount` breaks the exit rather than improving it.

## Known gaps (real, documented, not to be papered over)

- **`price_period` / `deposit_months`** — the `ALTER TABLE properties ADD COLUMN price_period text, ADD COLUMN deposit_months integer;` migration this was waiting on has run (2026-08-19, confirmed directly against `information_schema.columns`), and `SELECT_FIELDS` (`lib/listings.js`) now selects both. Before this, `services/postgres.js` (engine repo) was already writing both fields on *every* sync — since `syncListingToPostgres` is fire-and-forget and swallows its own errors, that meant every listing publish was silently failing to reach Postgres at all, with the submitting agent seeing a normal success reply. Existing Postgres rows still have `NULL` for both until their next sync; `DepositBadge` only starts showing real values as listings get republished or freshly submitted.
- **`latitude` / `longitude` are now read, but are populated on only 8 of 31 approved listings.** `SELECT_FIELDS` omitted both columns until 2026-09-04, which meant `lib/geocoding.js`'s `source: 'existing'` branch was dead for *every* listing on the site: each map view re-geocoded client-side against a billable Google API, once per session, while the rows that did carry coordinates went unused — and the km-radius filter in the same module queried those same columns, so there were two sources of truth for one location, disagreeing by construction. The SELECT is fixed and verified live (`listing #256: existing`). Persisting coordinates at publish time still needs an **IP-restricted `GOOGLE_MAPS_SERVER_KEY`**: the browser key is HTTP-referrer-restricted and Google refuses it server-side. Until then the other 23 fall back to commune centroid + deterministic jitter, which `ListingLocationMap` labels honestly.
- **Google Maps is currently failing on the live site** with "This page can't load Google Maps correctly" — pins resolve and markers are created, so the pipeline works, but tiles are refused. That signature is billing/quota on the Google Cloud project, not a code fault. `localhost` is also absent from the browser key's referrer allow-list, so the map cannot be exercised in local dev at all (confirmed on both :3001 and :3002).
- **`NEXT_PUBLIC_WHATSAPP_NUMBER` *is* set** (`.env.local`). A previous version of this note said otherwise and was stale. The real exposure is production: `.env.local` is hand-maintained and untracked, and `ecosystem.config.js` does not set it, so a fresh deploy that loses that file makes `WhatsAppCTA`/`CallCTA` build `wa.me/undefined` — a live link to nowhere — while the ~15 `getCentralWhatsAppHref` call sites render their disabled state.
- **Commune tags: 6 of 31 approved listings still carry none.** `scripts/backfill-commune-tags.js` recovered 7 from real address text; the rest have no commune in their text, or are ambiguous. Note that **"Kinshasa" is both the city and one of the 24 communes**, and every address here ends with the city — so that name is excluded from automatic matching entirely. A listing genuinely in Kinshasa commune has to be tagged by a human.
- **No logo file yet.** `components/Brand.js` renders a set-type wordmark; drop the client's SVG at `public/brand/` and flip `LOGO_SRC` / `MARK_SRC`. Nothing else imports a brand mark.
- **Per-listing agent contact — the schema limitation this used to describe is resolved; a real self-service path now exists.** `properties.agent_id` (FK) is the mechanism, joined to `agents`/`agent_infos`. **Correction, checked directly against live Supabase (this note previously said otherwise and was stale): `agents.phone` is `character varying(32)`, not a 32-bit integer — it holds a real E.164 `wa_id` (e.g. `243997123456`) with no truncation risk.** Phase 2 added the admin-side `assignAgentToListingAction` (`web/app/admin/agents/actions.js`) that populates `agent_id` for real; Phase 4 added genuine agent self-service accounts (`agents.password_hash`, phone-verified via a real WhatsApp OTP — see `lib/agentAuth.js`), independent of Laravel's own unused `agents.password` column. A listing without an attributed agent still correctly falls back to the central `WhatsAppCTA` number, same as before — this is no longer the only path, just the honest fallback when there's genuinely no agent attached yet.

## Testing

- **`npm test`** runs the unit tier: Node's built-in `node --test`, no test framework dependency, matching the engine's own hand-rolled `scripts/verify-pipeline.js` precedent. 72 tests.
- Two flags carry the whole thing and are not optional: **`--conditions=react-server`** makes `import 'server-only'` a genuine no-op (that package exports a zero-byte file under that condition), which is what lets ~30 `lib/` modules be imported at all; and `tests/support/hooks.mjs` uses **`module.registerHooks`** to resolve the `@/` alias and retry extensionless specifiers with `.js` — Next resolves both implicitly, plain Node ESM resolves neither.
- The unit tier substitutes `lib/db.js` with a recording fake pool (`tests/support/fakePool.js`), which buys the assertion class that matters most here: **SQL text invariants**. `properties` has no row-level security, so the `status = 1 AND approve_status = 1` filter is the only thing keeping unapproved listings private — and a test comparing returned rows would pass just as happily with that filter deleted, as long as the fixture held no pending rows. `tests/unit/listings-sql.test.js` asserts on the emitted SQL instead, which cannot be fooled that way.
- **`npm run test:http` and `npm run test:chain` talk to live production data** and are gated behind an explicit `QA_ALLOW_PROD=1`. They are deliberately excluded from CI.
- CI (`.github/workflows/ci.yml`) runs both suites on push. Node 22 is in the engine matrix as **non-blocking**: the production VPS runs 22, and 8 photo webhook tests fail there while passing on 24, with byte-identical code and dependencies (verified by checksum against the deployed server). Production photo handling works on 22, so this is a harness discrepancy — tracked rather than hidden. eslint is non-blocking too, over 3 pre-existing `react-hooks/set-state-in-effect` errors in deliberate hydration-safety code.

## Deployment

- PM2 process name `lukka-place-web`, port `3002` (the engine owns `3000` on the same VPS). Config: `ecosystem.config.js`.
- **Production data lives outside the repo directory**: the engine reads `DB_PATH=/var/data/lukka_place.db` and `UPLOADS_DIR=/var/data/uploads` from its `.env`. The `lukka_place.db` sitting in the engine's own directory on the VPS is a stale, empty leftover — do not read it and conclude the pipeline is broken.
- **`next build` takes ~23 minutes on this VPS.** Run it detached (`nohup`, writing to a log with a sentinel line) and poll for completion, rather than holding an SSH session open — and only `pm2 restart` *after* the build reports success, so a failed build never takes the site down.
- Traefik routing lives outside this repo, on the VPS at `/docker/n8n/dynamic/lukkaplace.yml` (file-provider dynamic config, same pattern as `engine.lukkaplace.com`'s router — `host.docker.internal:3002`).
- Deploy = tar (excluding `node_modules`, `.next`, `.env.local`) → scp → extract over the existing `/var/www/lukka-place-web` → full `npm install` → `npm run build` → `pm2 restart lukka-place-web --update-env`.
- `.env.local` on the VPS is hand-maintained, not part of the deploy archive — don't overwrite it by including it in the tarball.

@AGENTS.md
