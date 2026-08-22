# Lukka Place — Next.js Marketplace (Phase 1) Implementation Plan

Status: **draft — awaiting approval, no code written yet.**

This plan follows the architecture in [CLAUDE.md](CLAUDE.md). It's grounded in the live Supabase schema (queried directly against production while writing this, not assumed) and the existing engine code, not a generic Next.js scaffold plan.

---

## 0. Key findings from inspection (why this plan looks the way it does)

1. **No read path exists yet.** `services/postgres.js` only writes to Supabase. The storefront needs entirely new query code — there's nothing to reuse from this repo except `GET /locations` and the taxonomy knowledge encoded in `services/postgres.js`'s comments.
2. **Commune is not a column.** Only `quartier` is a direct column on `properties`. Commune is stored by tagging `property_amenities` with one of amenity ids 21–44 (see `COMMUNE_AMENITY_IDS` in `services/postgres.js`). Reading it back requires a join through `property_amenities` → `amenities` → `amenity_contents`, not a simple `SELECT commune`.
3. **The approval filter is `status = 1 AND approve_status = 1`** (both integers) — confirmed against live data (§ see CLAUDE.md). 8 properties currently qualify; 5 more exist but are pending and must stay invisible.
4. **CORS**: the Express engine has no CORS middleware. A browser-side `fetch('https://engine.lukkaplace.com/locations')` from `lukkaplace.com` would be blocked. Solution below avoids needing any engine change.
5. **Zero backend changes are required for Phase 1.** `GET /locations` already exists and is sufficient if fetched server-side (see §3).

---

## 1. Open items I'm flagging, not blocking on

These don't stop Phase 1 from being buildable, but they're real decisions worth a look before or shortly after:

- **Repo location**: I'm proposing a new `/web` subdirectory in *this* repo (`lukka-place-engine`) — a monorepo-style sibling to `services/`, `routes/`, etc. — rather than a separate repo. Easy to split out later; keeps things in one place for now since you asked me to build this "in Claude Code" against this codebase. Say the word if you'd rather it be a separate repo from the start.
- **DB credentials**: Phase 1 as planned reuses the engine's existing Supabase Postgres credentials (`DB_HOST`/`DB_USER`/etc., copied into the Next.js app's own `.env.local` — a second, independent connection, not a shared one). These credentials currently have full read/write access. I'd recommend creating a **read-only Postgres role** in Supabase scoped to `SELECT` on just the tables the storefront needs, so a leaked frontend `.env` can't write to production. This needs Supabase dashboard/SQL access to set up — I can write the `CREATE ROLE`/`GRANT` SQL if you want, but creating it is a call worth making explicitly since it's a permissions change.
- **Production domain/hosting**: CLAUDE.md states the target end state (`lukkaplace.com` → Next.js, `admin.lukkaplace.com` → Laravel), but *how* and *when* that cutover happens (DNS change, hosting platform, whether `lukkaplace.com` currently serves the Laravel app directly) is still unresolved from my earlier questions. Doesn't block local development at all — only matters once we're ready to actually ship this live.
- **"Monthly rental income if applicable" (detail page)**: I don't have market comparable data to compute a real rental *yield*. My planned interpretation: for a `transaction_type = 'location'` listing, its own price *is* the monthly rental figure — shown as such. For `'vente'` listings, this section simply doesn't render (nothing to show without external market data). Flag if you meant something else.

---

## 2. Tech stack

- **Next.js 14, App Router**, plain JavaScript (`.js`/`.jsx`, matching the file paths you specified — `app/page.js`, `app/listings/page.js`, `app/listings/[id]/page.js`) — not TypeScript, to match what was asked for.
- **Tailwind CSS**, configured with a placeholder "clean, high-contrast" palette (deep charcoal/navy text, single accent color, generous white space, soft card shadows) — a Rightmove/Zillow-*shaped* starting point, swappable once real brand colors/logo exist.
- **`pg`** (not `@supabase/supabase-js`) for the data layer. Reasoning: the commune-via-amenity join (finding #2 above) is an awkward fit for PostgREST's embedding syntax; raw SQL mirrors exactly how `services/postgres.js` already talks to this schema, so the two codebases stay conceptually consistent. `@supabase/supabase-js` isn't needed for anything else in Phase 1 — photos are just plain HTTPS URLs already stored in `featured_image`/`property_slider_images`, no client library required to display them.

---

## 3. Data layer

### 3.1 `lib/db.js` — server-only Postgres client
A `pg.Pool`, same TLS posture as `services/postgres.js` (`ssl: { rejectUnauthorized: false }` — Supabase's pooler). Never imported from a `'use client'` file.

### 3.2 `lib/listings.js` — query functions

```sql
-- getListings({ transactionType, propertyType, parcelleSubtype, commune, quartier, limit, offset })
SELECT
  p.id, p.price, p.purpose, p.type, p.beds, p.bath, p.area, p.quartier,
  p.parcelle_subtype, p.units_count, p.reference, p.featured_image,
  pc.title, pc.slug, pc.address,
  catc.name AS category_name,
  (
    SELECT ac.name FROM property_amenities pa
    JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
    WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
    LIMIT 1
  ) AS commune
FROM properties p
JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
JOIN property_categories cat ON cat.id = p.category_id
JOIN property_category_contents catc ON catc.category_id = cat.id AND catc.language_id = 26
WHERE p.status = 1 AND p.approve_status = 1
  -- + optional filters: p.purpose, p.type, p.parcelle_subtype, commune (subquery match), p.quartier
ORDER BY p.created_at DESC
LIMIT $n OFFSET $m
```

```sql
-- getListingById(id) — same joins, plus:
-- (SELECT array_agg(image ORDER BY id) FROM property_slider_images WHERE property_id = p.id) AS gallery
-- WHERE p.id = $1 AND p.status = 1 AND p.approve_status = 1
```

The `id` lookup **repeats the approval filter** — a guessed/leaked URL to a pending listing must 404, exactly like the grid. This is a rule worth stating once and following everywhere reads happen: **every query against `properties` filters on `status = 1 AND approve_status = 1`, no exceptions.**

`transaction_type` maps to `purpose` (`'vente'` → `'sale'`, `'location'` → `'rent'` — see `services/postgres.js`'s existing mapping) and `property_type` maps to `type`/`category_id`, not a direct string column — filtering by property type means filtering by `category_id` (resolved via `CATEGORY_FALLBACK_FR`) or matching on `catc.name`.

### 3.3 `lib/locations.js` — server-side fetch wrapper

```js
async function getLocationHierarchy() {
  const res = await fetch(`${process.env.ENGINE_API_BASE}/locations`, {
    next: { revalidate: 3600 }, // reference data changes essentially never
  });
  return res.json(); // { communes: string[], locations: { [commune]: string[] } }
}
```

Called once per request from a Server Component (`app/page.js`), passed down as a prop to a `'use client'` `<SearchBar>` — the cascading commune→quartier logic then runs **entirely client-side against already-fetched data**, no further network calls, no CORS involved at all (the only cross-origin-shaped request happens server-to-server).

### 3.4 Environment variables (new, in the Next.js app's own `.env.local`)

| Variable | Server/Public | Purpose |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | server-only | Supabase Postgres (ideally the read-only role from §1) |
| `ENGINE_API_BASE` | server-only | e.g. `https://engine.lukkaplace.com`, for the `/locations` fetch |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | public | Lukka Place's business number, for the CTA link |

---

## 4. Pages & components

### `app/layout.js`
Root layout: header (logo, nav), footer, Tailwind globals, font setup.

### `app/page.js` — Homepage (Server Component)
- Hero banner.
- Fetches `getLocationHierarchy()` server-side, renders `<SearchBar initialLocations={...} />` (Client Component).

**`<SearchBar>`** (client): transaction type toggle (Sale/Rent), `<LocationCascadeSelect>` (commune `<select>` → filters quartier `<select>` from the in-memory hierarchy, resetting quartier on commune change — mirrors `services/locations.js`'s `cascadeCommuneChange` logic, reimplemented as a small client-side pure function), property type `<select>` (Parcelle → reveals a sub-type `<select>` with Maison Type Locataire/Villa/Terrain Nu; Appartement → no sub-type). Submits as a query string to `/listings`.

### `app/listings/page.js` — Results grid (Server Component)
Reads `searchParams`, calls `getListings(...)`, renders a `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` grid of `<ListingCard>`, plus pagination (reusing the existing `limit`/`offset` shape). Empty state for zero results.

**`<ListingCard>`**: `featured_image` (`next/image`, remote pattern configured for the Supabase Storage domain), price formatted as USD, `${area} m²`, a "X Portes" badge only rendered when `units_count` is not null, commune/quartier badges, `reference` shown small and muted (e.g. `Réf: LKP-2026-0091`).

### `app/listings/[id]/page.js` — Detail page (Server Component)
`getListingById(id)` → `notFound()` if missing *or* not approved (same filter, see §3.2). Renders:
- `<PhotoGallery>` (featured image + slider images, simple lightbox — I'll pick a small dependency-free implementation rather than pull in a heavy carousel library, unless you'd prefer a named one).
- `<PropertyMetrics>`: price, area, price/m² (computed), the rental-income line per §1's stated interpretation.
- `<WhatsAppCTA>` (client, for the click handler): floating fixed-position button, `href="https://wa.me/${NEXT_PUBLIC_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}"` where `message` is exactly CLAUDE.md's template, filled with this listing's `reference`, `property_type`, `commune`.

---

## 5. Step-by-step build order

1. Scaffold Next.js app in `/web` (App Router, Tailwind, JS, ESLint).
2. `lib/db.js` + `lib/listings.js` — data layer, with the SQL above.
3. `lib/locations.js` — engine fetch wrapper.
4. Base layout + Tailwind theme tokens.
5. `<SearchBar>` + cascading location logic + homepage.
6. `<ListingCard>` + results grid page + pagination + empty state.
7. `<PhotoGallery>` + `<PropertyMetrics>` + `<WhatsAppCTA>` + detail page + 404 handling.
8. Manual QA: all three pages, mobile/tablet/desktop breakpoints, zero-results state, missing/pending-listing 404, a real search round-trip against production Supabase data.
9. (Follow-up, not blocking) Read-only Postgres role for the storefront's DB user.
10. (Follow-up, not blocking) Domain/hosting cutover plan for the real `lukkaplace.com`.

---

Waiting for your go-ahead (or corrections) before writing any code.
