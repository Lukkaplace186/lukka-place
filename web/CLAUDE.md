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
- Card chip badges are limited to what the data can prove: "Nouveau" (14-day `created_at`), photo count (`gallery.length`), "Location" (`purpose`), door count (`units_count`). No "Price cut" (no price history exists), no days-on-market shaming, no invented amenity hooks. See `ListingBadges.js`.
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
- **Type is sans-led.** Inter carries the hero (800), all UI, filters, prices, card data and body copy. Fraunces is an *accent only* — section titles, `/a-propos`, detail-page section headings — held at **400–500**. Never Fraunces for UI or data; never at a heavy weight (the previous design set a display serif at `font-extrabold`, the heaviest cut of a face whose whole character lives at regular weight). No mono family is loaded: reference codes use `.u-ref`.
- **Utilities that carry the look**: `.u-eyebrow` (uppercase 11px/0.12em — the editorial workhorse), `.u-tabular` (**every price**, or grid columns go ragged), `.u-ref`, `.u-lift` / `.u-lift-lg` (the only real elevations; cards use hairline `border-line` instead of shadows).
- **Colours that can't reach CSS**: `lib/mapIcons.js` (SVG data URIs) and `lib/mapStyle.js` (Google Maps `styles` array) hardcode the palette because neither can resolve CSS custom properties. Keep them in step by hand.

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

- **`lib/listingView.js` owns values derived from a listing row** — images, spec items, "is new", dates, location line, description snippet. The three card designs each re-derived these, which is exactly how the same 14-day condition ended up rendering "Just Added" in one file and "Nouveau" in two others.
- **Three listing card designs exist on purpose** — `ListingCard.js` (horizontal, Rightmove-style 1-large-2-small photo collage, used on `/favoris`), `ListingCardVertical.js` (grid card for the `/listings` split view), `FeaturedListingCard.js` (homepage carousel teaser). One visual language, three layouts. Don't collapse them.
- **`SafeImage.js` for any listing-sourced image, never bare `next/image`** — some stored objects genuinely 400 at source, and a visitor should see the real "no photo" placeholder rather than a broken-image icon. `PhotoGallery`'s thumbnails used bare `next/image` and had no fallback while the main frame did.
- **UI primitives come from `components/ui/*` (shadcn, Radix).** Installed: `button`, `card`, `dialog`, `dropdown-menu`, `popover`, `sheet`, `tabs`. Add more with `npx shadcn@latest add <name>` — and **diff `app/globals.css` afterwards**, it has silently overwritten the palette before.
  - **Popover, not DropdownMenu, for filter panels.** DropdownMenu implements roving focus and typeahead over menu *items*, which fights any text or number input inside it. See `FilterPill.js`.
  - Radix content portals to `document.body`, so it is **outside the `<form>`**. `FilterBar` therefore owns every filter value in React state and renders hidden inputs inside the form; the pill panels and the sheet are pure UI. Don't put a named form field inside a portalled panel and expect it to submit.
- **Icons are `lucide-react`, always**, with `ICON_SIZE` / `ICON_STROKE_WIDTH` from `lib/constants.js`. The hand-rolled WhatsApp/Facebook/Instagram brand SVGs in `Footer.js` and `WhatsAppCTA.js` are the one deliberate exception — this lucide version ships no brand glyphs (confirmed by a failed build, not assumed).
- **Motion is `framer-motion` via `lib/motion.js`** — `revealUp`/`revealStagger` (section reveals), `imageZoom` (card photo on hover), `heroDrift`, `fadeScale`, `cardHoverProps`, `fadeInUp`. **Gate every decorative preset through `useMotionSafe()` (`lib/useMotionSafe.js`)** — `prefers-reduced-motion` was honoured nowhere before. Read the scope note at the top of `lib/motion.js` before wrapping a Radix `Dialog`/`Sheet` in `motion.div`: they animate via `data-state` + `tw-animate-css`, and layering framer-motion on top without `AnimatePresence` + `forceMount` breaks the exit rather than improving it.

## Known gaps (real, documented, not to be papered over)

- **`price_period` / `deposit_months`** — the `ALTER TABLE properties ADD COLUMN price_period text, ADD COLUMN deposit_months integer;` migration this was waiting on has run (2026-08-19, confirmed directly against `information_schema.columns`), and `SELECT_FIELDS` (`lib/listings.js`) now selects both. Before this, `services/postgres.js` (engine repo) was already writing both fields on *every* sync — since `syncListingToPostgres` is fire-and-forget and swallows its own errors, that meant every listing publish was silently failing to reach Postgres at all, with the submitting agent seeing a normal success reply. Existing Postgres rows still have `NULL` for both until their next sync; `DepositBadge` only starts showing real values as listings get republished or freshly submitted.
- **`latitude` / `longitude`** are real columns but NULL on every approved listing, so every pin is resolved client-side per session via `lib/geocoding.js` (geocode → commune centroid → deterministic 200–400 m privacy jitter) and never persisted. `ListingLocationMap` labels this honestly.
- **`NEXT_PUBLIC_WHATSAPP_NUMBER` is unset in `.env.local`**, so every enquiry CTA currently renders its disabled state. Set a real number before this is worth deploying.
- **No logo file yet.** `components/Brand.js` renders a set-type wordmark; drop the client's SVG at `public/brand/` and flip `LOGO_SRC` / `MARK_SRC`. Nothing else imports a brand mark.
- **Per-listing agent contact — the schema limitation this used to describe is resolved; a real self-service path now exists.** `properties.agent_id` (FK) is the mechanism, joined to `agents`/`agent_infos`. **Correction, checked directly against live Supabase (this note previously said otherwise and was stale): `agents.phone` is `character varying(32)`, not a 32-bit integer — it holds a real E.164 `wa_id` (e.g. `243997123456`) with no truncation risk.** Phase 2 added the admin-side `assignAgentToListingAction` (`web/app/admin/agents/actions.js`) that populates `agent_id` for real; Phase 4 added genuine agent self-service accounts (`agents.password_hash`, phone-verified via a real WhatsApp OTP — see `lib/agentAuth.js`), independent of Laravel's own unused `agents.password` column. A listing without an attributed agent still correctly falls back to the central `WhatsAppCTA` number, same as before — this is no longer the only path, just the honest fallback when there's genuinely no agent attached yet.

## Deployment

- PM2 process name `lukka-place-web`, port `3002` (the engine owns `3000` on the same VPS). Config: `ecosystem.config.js`.
- Traefik routing lives outside this repo, on the VPS at `/docker/n8n/dynamic/lukkaplace.yml` (file-provider dynamic config, same pattern as `engine.lukkaplace.com`'s router — `host.docker.internal:3002`).
- Deploy = tar (excluding `node_modules`, `.next`, `.env.local`) → scp → extract over the existing `/var/www/lukka-place-web` → full `npm install` → `npm run build` → `pm2 restart lukka-place-web --update-env`.
- `.env.local` on the VPS is hand-maintained, not part of the deploy archive — don't overwrite it by including it in the tarball.

@AGENTS.md
