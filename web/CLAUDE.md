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

- A per-listing agent phone is shown only for a **verified, routing-enabled** agent (`lib/listings.js` nulls `agent_phone` in SQL otherwise); every other "Contact" CTA routes through the one real WhatsApp number (`NEXT_PUBLIC_WHATSAPP_NUMBER`) and renders an honest disabled state (not a dead `wa.me` link) when that env var is empty. One rule for all three CTAs: `lib/leadRouting.js` (`WhatsAppCTA.js`, `EnquiryCard.js`, `MobileListingBar.js`), and each tap is logged with its routing through `trackLeadClick`. The reference portals put an agent card in exactly the slot `EnquiryCard` occupies; never fill it with an agent we cannot vouch for.
- No real Lukka Place social accounts exist yet → Facebook/Instagram icons in `Footer.js` are inert `<span>`s, not `<a href="#">`.
- `ExploreCommunes.js` shows **a real photo of a real approved listing in that commune**, plus that commune's real listing count (`getCommuneShowcase()`). It used flat gradients before, because a stock photo captioned "Gombe" would have been a fabrication. A commune whose latest listing has no usable photo falls back to the typographic treatment rather than borrowing another commune's image.
- Card chip badges are limited to what the data can prove: photo count (`gallery.length`), "Location" (`purpose`), door count (`units_count`). No "Price cut" (no price history exists), no days-on-market shaming, no invented amenity hooks. See `ListingBadges.js`. ("Nouveau", 14-day `created_at`, used to be one of these — removed entirely from every listing on an explicit instruction; not a data-honesty issue, the badge was real, it's just gone now.)
- The hero background (`public/hero-kinshasa.jpg`) is a real, properly-licensed photo (CC BY-SA 2.0, Wikimedia Commons — MONUSCO/Abel Kavanagh) with the required credit rendered in `Hero.js`. It has been re-encoded to ~330 KB (it shipped at 5.6 MB). Anything that replaces it keeps both properties: real licence, visible credit where the licence asks for one.
- `PropertyMetrics.js` shows a rental listing's own price as its monthly income and nothing for a sale listing — no market-comparable dataset exists to estimate a yield. `/plan` stays an honest empty page for the same reason: a budget calculator would need financing rates we don't have.
- **The USD→CDF rate is a real daily feed now** (`lib/exchangeRate.js`), not the
  manually-maintained constant this bullet used to describe. What did NOT change
  is the honesty framing, and it still binds: `<Price>` marks converted amounts
  "≈" with a dated tooltip, `CurrencyBridge.js` states the date in copy, and
  nothing presents it as a dealing rate — a daily reference figure is not a
  quote somebody can transact on.
  - **The displayed date is always the date the displayed number actually came
    from**, never "today". The feed publishes its own `time_last_update_utc`
    and that is what we render; when the fetch fails we fall back to
    `DEFAULT_CDF_PER_USD` carrying `DEFAULT_RATE_UPDATED_AT`, its real check
    date. Stamping a fallback with today's date would be a stale figure wearing
    a fresh one, on a number customers budget against — the same class of
    fabrication as the invented deposit terms two sections down.
  - **Frankfurter does not carry CDF** — it republishes the ECB majors, and a
    USD→CDF query returns nothing usable (confirmed against the live API). Any
    replacement source has to actually quote this exotic; `open.er-api.com` was
    picked because it does, needs no key, and reports its own publish date.
  - `lib/currencyRate.js` stays the single entry point every pricing surface
    reads. An admin's manual entry from `/admin/cms` still wins, but only while
    it is at least as recent as the feed — a correction, not a permanent pin.

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
- **Colours that can't reach CSS**: `lib/mapIcons.js` (SVG data URIs) and `lib/mapStyle.js` (Google Maps `styles` array) hardcode their colours because neither can resolve CSS custom properties.
- **The map is the one surface that deliberately leaves the site palette** — don't "fix" it back. `lib/mapStyle.js` renders real geography (green parks, blue water, a warm paper canvas, a warm road hierarchy) rather than the monochrome WhiteBlue treatment it used to carry: with no green, no water and no road hierarchy, Kinshasa disappeared and the map became a blank sheet pins floated on. Pin colour is a **data encoding**, not decoration — `lib/mapMarkerKinds.js` maps each real property category to one colour + one lucide glyph (blue appartement/duplex/penthouse, green maison/villa, orange terrain, red bâtiment/boutique/entrepôt, neutral ink for an unrecognised category), resolved `parcelle_subtype` first then `category_name`, the same precedence `typeLabel()` uses. `PropertyMap`'s legend is what gives those colours meaning; a new kind without a legend entry is an unexplained dot. Cluster bubbles carry a ring split into one arc per type present, sized by the real mix underneath. All of it is pinned by `tests/unit/map-markers.test.js` against the pure helpers, since the icon builders themselves need the Maps JS API.
  - **Stale above, kept for the reasoning:** the colour kinds, the legend and the ringed clusters were removed (dd425f9) in favour of royal-blue price tags — see the header of `lib/mapIcons.js`. Clustering briefly returned with the viewport map and was removed again: every listing renders as its own price tag at every zoom.
- **`/listings`' map is a viewport map, not a view of the page** (`components/ListingsMap.js`, `GET /api/listings/map`, `lib/mapViewport.js`). It shows every listing matching the URL filters inside the visible area and refetches when the map comes to rest; the 12-card list pane beside it stays paginated. On the map, commune/quartier/radius decide where it OPENS and then give way to the viewport, so panning out of Bandal still applies "2 chambres" to what comes into view. Root CLAUDE.md, "Interactive Property Map", has the full model; the detail page's single-listing map is still `PropertyMap`.

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

### Built for 30k agents — every list is one server page

The console used to fetch whole tables and slice nothing: `getAgents()` (every
agent, two correlated listing counts each) was called by six pages just to fill
`<select>`s, and `/admin/agents` rendered a 24-commune checkbox form into every
row. That is fine at 10 agents and a multi-megabyte page at 30,000.

- **URL-driven state, `lib/adminPagination.js`.** Page, page size (25/50/100
  only — an arbitrary size is an unbounded query) and every filter are query
  params. The Server Component asks the database for exactly one page
  (`LIMIT/OFFSET` + a `COUNT`); the browser never holds more than 100 rows, which
  is why there is no virtualisation layer. `buildHref` drops empty params and
  resets `page` whenever a filter changes. Shared UI: `app/admin/table/`
  (`TableToolbar` — debounced search, selects, dates; `Pagination`; `TableFrame`
  with a sticky header). `TableToolbar` takes current values as props rather
  than `useSearchParams()` (see Gotchas).
- **Never load every agent again.** Pick an agent with `app/admin/AgentPicker.js`
  (server-side type-ahead, ≤20 results, commune specialists first); name the
  agents a page shows with `getAgentNamesByIds`; list them with
  `listAgentsForAdmin`. `getAgents()` still exists for the public directory's
  callers but has no admin caller left — keep it that way.
- **Admin display names never fall back to `agents.username`** (it is the phone
  number): `ADMIN_AGENT_NAME` is person → agency → `Agent #id`.
- **Search escapes `%`/`_`** on both sides (Postgres `ilikeTerm`, engine
  `likeTerm`); a typed `%` is text.
- **`app/admin/error.js`** is the console's error boundary (Next 16 passes
  `retry`, not `reset`). `/admin/matching` 500'd for every admin because
  `const t = stats.totals` shadowed the translator one line before a `t()` call
  — `i18n-translator-binding.test.js` cannot see a shadowed `t`, so name data
  anything but `t`. Pages still load each data source independently
  (`Promise.allSettled`) and render an `ErrorNote` in place.
- **Agency search on `/admin/viewings`** is resolved to `agents.id` in Postgres
  (`searchAgentIds`, capped at 500) and OR'd engine-side with the customer
  name/number match — agency names do not live in SQLite. "Escalated" is the
  engine's `view=escalated` slice (PENDING + `sla_alerted_at`), not a status.
- **Conversations open in a slide-over at `?c=<id>`**, server-rendered like
  every other view, so a thread is linkable and survives a refresh. Sender,
  intent and assistant tool chips are written by the engine at record time
  (`messages.sender/intent/tool_calls`); older rows show "sender not recorded"
  rather than a guess. Listing-link and `wa.me` chips are pattern matches.
- **`/admin/market-data` asking-price stats (`lib/marketStats.js`)** use the
  PUBLIC gate (`status = 1 AND approve_status = 1`) — the opposite choice from
  `marketBenchmarks.js`, deliberately: a sold listing is not on the market.
  Yearly rent ÷ 12 exactly as `lib/format.js` renders it; `price <= 0` is "prix
  sur demande", counted apart and never averaged in as $0.
- **"Lead Analytics"** is the sidebar label for `/admin/telemetry` (URL kept).
  Its conversion rate divides WhatsApp enquiries by CENTRAL-number taps only — a
  direct-to-agent tap is invisible to us and is shown beside the rate, never in
  it. "Delivery health" is API-accepted vs refused plus agents who answered;
  there is no delivered count because Chakra forwards no receipts.

### Accounts, roles and the audit log

- **Individual team accounts** (`lib/adminUsers.js`, table `console_admin_users`,
  `migrations/20260914_admin_console_platform.sql` in the engine repo). NOT
  Laravel's `admins`/`role_permissions` — those belong to the external
  back-office. Nobody types another person's password: an owner invites by
  name/email/role on `/admin/team` and gets a single-use activation link (72h,
  only its SHA-256 stored) to send; the person sets their own password on
  `/admin/activate` (public in middleware, gated by the token). Lockout: 5 bad
  passwords lock the account 15 min; 20 failures from one IP in 15 min refuse
  that IP. The last active owner cannot be demoted or disabled.
- **Session tokens are `v2.<adminId>.<tokenVersion>.<exp>.<hmac>`**
  (`lib/adminAuth.js`). middleware.js checks signature + expiry only;
  `lib/adminSession.js` re-reads the account on every page (layout) and every
  action (`requireAdmin(permission)`), so disabling someone or resetting their
  access (both bump `token_version`) ends their sessions at once. The layout
  learns the path from `x-admin-pathname`, set (and overwritten) by middleware.
- **The shared password still works, deliberately, as bootstrap owner access**
  (`adminId 0`). Without it, deploying accounts would have locked the team out
  until someone created the first owner. Everything it does is audited as
  `shared-password` and a banner says so. **Turn it off with
  `ADMIN_SHARED_LOGIN=off` once an owner account is active.** A pre-v2 token is
  read as that shared session so nobody was signed out by the deploy.
- **Roles are `lib/adminRoles.js`**: owner / moderator / support / finance /
  analyst, a fixed permission table, `SECTION_PERMISSIONS` for pages (longest
  prefix wins). The sidebar hides what a role can't open; the layout and every
  Server Action enforce it. An unknown permission is refused, never open.
- **Every mutating action calls `recordAudit`** (`lib/adminAudit.js`,
  `console_admin_audit_log`, append-only, owner-readable at `/admin/audit`,
  exportable). Details never contain a password or a customer message body —
  replies record their length. `verified_by`, `moderated_by` and the exchange
  rate's `updated_by` now carry the real account (NULL/"shared" under the
  shared password, honestly).

### Operating the console

- **Approval queue** (`lib/moderationQueue.js`, `/admin/listings`): pending
  oldest first with waiting time; tabs pending / approved (public only) /
  rejected / suspended; quality flags computed in SQL (no/few photos, no
  commune/price/content, extraction-failure text, photo reused on another
  listing, same title+price, unverified/no agent) plus a price-outlier flag
  from cached commune medians (≥5 listings, ×3). **Flags are facts, never
  auto-verdicts.** Bulk approve runs the publishability check per listing and
  reports skips; reject requires a reason code (`lib/moderation.js`) stored in
  `properties.moderation_reason_code/_note/moderated_at/moderated_by` and sent
  to the agent (engine `MODERATION_REJECTION_REASONS`). The listing page has a
  decision panel and a photo manager that can only reorder/cover/remove photos
  already on the listing.
- **Work queues** (`lib/adminWorkQueues.js`, dashboard top, sidebar badges) mix
  Postgres counts and the engine's `GET /admin/work-queues`, cached 15s
  server-side; the browser polls `/admin/api/queue-counts` every 30s while
  visible (`LiveQueueCounts.js`). Queue pages show a "new items — refresh"
  pill rather than reshuffling rows under the cursor.
- **Global search** (Ctrl/⌘K, `lib/adminSearch.js`, `/admin/api/search`):
  listings, agents, agencies, customers, conversations — only the groups the
  role may open. Substring search is backed by pg_trgm GIN indexes.
- **Profiles**: `/admin/agents/[id]` has tabs (profile, listings in every
  state, requests routed to them, performance from `agent_performance_logs`,
  notes & history); `/admin/customers/[id]` merges leads, viewings and
  conversations into one timeline; `/admin/agencies[/id]` manages an agency's
  whole roster (bulk activate/suspend). Internal notes: `console_admin_notes`.
- **Every table exports CSV with its current filters** (`/admin/export/[dataset]`,
  paged through the same list function, capped at 10,000 rows, audited,
  formula-injection-safe) and supports **saved views** per person
  (`console_admin_saved_views`; not available under the shared password).
- **`/admin/billing`** is the renewal desk and ledger over `memberships`:
  expiring-in-30-days first; revenue is RECORDED revenue (trials excluded) —
  there is no gateway, so nothing claims reconciliation. The featured-listing
  picker on Subscriptions is a server-side search (it used to offer only the 50
  newest listings).
- **`/admin/health`** reports Postgres/engine latency, last inbound WhatsApp
  traffic, scheduled-job outcomes, send failures and missing delivery config,
  from what the platform records. **Alerts** come from the engine's
  `ops-health-alerts` sweep (root CLAUDE.md, "Admin console at scale"): open
  incidents show here and as the Health sidebar badge (`openAlerts`), and are
  WhatsApped to the desk only when `OPS_WHATSAPP_NUMBER` is set.
- **Keyset pagination** (`lib/adminPagination.js`: `parseCursor`,
  `keysetClause`, `pageCursors`) on the tables that grow without bound — audit
  log, customers, agents (newest sort), listing queue (oldest/newest sorts).
  The pager's arrows carry `?after=`/`?before=` cursors; numbered pages still
  jump by OFFSET; `buildHref` drops a cursor on any other change. The cursor's
  sort value is `created_at::text`, **never a JS Date** — Postgres keeps
  microseconds, a Date keeps milliseconds, and the round-trip would skip rows.
  CSV export follows the same cursors. Price/name/portfolio sorts stay OFFSET.
- **Branches** (`agency_branches`, `agency_branch_agents`,
  `migrations/20260915_agency_branches.sql`, `lib/adminBranches.js`): on
  `/admin/agencies/[id]` — create/edit/archive (`agents.manage`), filter the
  roster by branch, move selected agents from the roster's bulk bar. New tables,
  not an `agents.branch_id`, because `agents`/`vendors` are Laravel's too.
  Every read joins `b.vendor_id = a.vendor_id`, so an agent moved to another
  agency silently leaves their old branch. Communes come from the location
  hierarchy only.
- **Receipts** (`/admin/billing/[id]`): a printable receipt for a recorded
  payment, numbered `LP-<Kinshasa year>-<membership id>` (derived, not
  stored). Not a tax invoice, and says so; a trial or a row with no amount gets
  no receipt. The console chrome is `print:hidden`.
- **An agency's name is `vendorNameSql()` (`lib/vendorName.js`), never
  `vendors.username`.** For agencies created by WhatsApp onboarding or phone
  signup the username IS the phone digits — the first deploy of the agencies
  directory, billing ledger and receipts printed "243853580738" as the agency.
  Order: non-phone username → an agent's `agency_name` → "Agence #id".
  Covered by `tests/unit/admin-vendor-name.test.js`.
- **The migration also REVOKEs `anon`/`authenticated` on every `console_*`
  and branch table.** Supabase's default privileges grant those roles access
  to new `public` tables over its REST API; nothing here uses that path, and
  `console_admin_users` holds password hashes. Whether older, Laravel-owned
  tables carry the same grants has not been checked.

### Sales team and commissions (`/admin/sales`)

`migrations/20260919_sales_and_impersonation.sql`, `lib/sales.js` (SQL),
`lib/salesRules.js` (pure: periods, amounts, validation — shared with forms).

- **Nothing is typed in as a result.** A rep's figures come from agents assigned
  to them (`sales_account_assignments`, one active rep per agent, history kept)
  and what those agents' records say: "onboarded" = `phone_verified_at`;
  "subscription sold" = a `memberships` row that is a real payment (not a trial,
  price > 0, status 1) for the agent's vendor. **A vendor is credited only when
  all its assigned agents share one rep** — ambiguity credits nobody.
- **`credit_from`** is set when an agent is assigned (default today, never in
  the future): nothing before it earns anything. Crediting a rep for an agent
  they signed up last month is an explicit, audited date, not a default.
- **Commissions are generated, idempotently**, by "Calculer les commissions"
  (`syncSalesCommissions`, one transaction): subscription % of the payment in
  its own currency, a fixed onboarding bonus, and a target bonus for CLOSED
  Kinshasa months only. `UNIQUE (source_type, source_id)` means a membership,
  an agent or a rep-month is credited once, ever — reassigning an agent never
  double-pays. The plan's rate is snapshotted on each line, so editing a plan
  never rewrites earned money. There is no scheduled run: press the button.
- **Cancellations**: pending/approved subscription lines whose membership is no
  longer active are voided on the next run; a PAID one is flagged
  `clawback_due` and settled by a (negative) adjustment — a query never
  reverses money already handed over.
- **Lifecycle** pending → approved → paid (via a payout: one currency, rows
  locked `FOR UPDATE`, total > 0) or void (reason required). Money is never
  summed across USD/CDF anywhere.
- **Roles**: `sales.manage` (owner, finance) does every write; a rep never
  approves or pays their own lines. The new `sales` console role has
  `sales.view` and is sent to the rep record whose `admin_user_id` is theirs —
  any other rep id is a 404.
- The agent profile shows (and, for `sales.manage`, changes) the agent's rep.

#### Launch commission policy (plan kind `launch_milestones`)

`migrations/20260920_sales_launch_policy.sql`, `lib/launchCommission.js`
(pure: tiers, deltas, quality test, referral codes, fortnights),
`lib/salesLaunch.js` (SQL), `lib/salesReferral.js` (cookie, links, IP hash).
A plan is now `kind` subscription (above) or launch_milestones; the
subscription steps skip launch reps and vice versa.

- **Attribution is permanent and written once**, at account creation, in
  `sales_agent_attributions` (one row per agent, first valid referral wins):
  web signup (`/r/<CODE>` sets `lukka_ref` for 30 days without replacing a
  valid one → `/compte/agent/inscription?ref=` prefills the optional code
  field) or WhatsApp onboarding (engine, root CLAUDE.md). Never backfilled;
  existing agents are attributed only by an override with a 20+ character
  reason (`sales_attribution_changes`). An unknown code on the web form is sent
  back before the account exists; a failed lookup never blocks signup.
  Refusals (unknown, inactive, self-referral, existing agent) land in
  `sales_referral_refusals`. Every rep gets a code (JEAN01, from the first name
  if left empty); a code that brought an agent in can no longer change.
- **A confirmed listing is frozen in `sales_listing_credits` the first time the
  run sees it**: public, price, commune, title + description, ≥3 photos, none of
  the moderation queue's blocking flags, created after the attribution's
  `credit_from`. No FK to `properties` (agents hard-delete). It keeps counting
  while approved and either public or let/sold; rejected, deleted, archived or
  excluded stops it. Duplicate detection is title+price, so identical units in
  one building are not credited — deliberate, flagged here.
- **Qualified** = verified number + a name + ≥3 counting credits + not
  rejected; **payable** = qualified AND `validation_status = 'validated'`. Tiers
  are computed from payable counts only.
- **Ledger lines hold tier DELTAS** (`milestone` acq:<rep>:<n>, `listing_bonus`
  add:<rep>:<n>, `quality` quality:<rep>), so a rep's lines always sum to the
  cumulative tier and "pay only the difference" needs no arithmetic. A tier no
  longer met voids unpaid lines (`auto:below_threshold`, revived if met again;
  a person's void stands) and flags paid ones (`clawback_flagged_at`) — never a
  negative line by query. Quality: once, ≥15 checked credits, ≥80% valid on day
  30 (let/sold counts as valid).
- **The run** is `syncSalesCommissions` (one transaction, `SET LOCAL
  statement_timeout`), from the button, after every validation / exclusion /
  override, and daily at 06:00 Kinshasa via the engine's `sales-commissions`
  job → `POST /api/cron/sales-commissions` (Bearer CRON_SECRET).
- **Pages**: the rep page gains the referral toolkit (code, link, server-drawn
  QR SVG via `qrcode`, WhatsApp share, WhatsApp signup link), funnel, tiers,
  referred agents (validate / reject / move) and credited listings (exclude);
  the ledger gains a fortnight filter whose "pay" pays exactly that fortnight's
  approved lines, and payout-method suggestions. `/admin/sales/attribution`
  (`sales.manage`) lists refusals, overrides and patterns (3+ signups from one
  hashed connection, listings before the referral, day-30 failures) — facts,
  never automatic penalties. `/admin/sales/me` sends a rep to their page.

### Listing limits, the customer → agent chain, agencies, CMS hero

- **Plan listing limits are enforced** (`lib/listingQuotaRules.js` pure,
  `lib/listingQuota.js` SQL; engine twin `services/listingQuota.js` — change
  one, change the other). The cap is `packages.number_of_property` of the
  agency's active membership (vendor-wide; the most generous active listing
  plan; a 0/NULL package such as Photography Service sets no cap; no active
  membership → no cap). A slot is `status = 1 AND approve_status IN (0, 1)` and
  not closed — pending counts, archived / rejected / let-sold free a slot.
  Checked in `createListingAction` (after the offline-replay guard),
  `duplicateListingAction`, single and bulk "put back online", and on WhatsApp
  "OK" (after the photo gate; the draft stays pending). A refusal returns
  `{quota}` and `announceListingQuota` opens `components/ListingLimitDialog.js`
  (mounted in the agent layout) with "Mettre à niveau mon forfait" →
  `/compte/agent/abonnement`; Mes biens shows the banner and the add button
  opens the dialog instead of the form at the limit. **Production's Free plan
  allows 2 listings while the launch policy needs 3 to qualify an agent** —
  a pricing decision, not changed in code.
- **Viewings and leads always name an agent when one exists.** A request with
  no `agent_id` (pre-routing, or central fallback) shows the listing's own agent
  marked "non alerté" / "non attribué", with WhatsApp links to customer and
  agent (`app/admin/ContactCell.js`) and one click: "Alerter l'agent"
  (engine reassign, which notifies them) on viewings, "Attribuer à l'agent de
  l'annonce" on leads. `getAgentContactsByIds` (lib/agents.js) gives name,
  agency, digits-only phone and `routable` (verified, routing on, active).
  `/admin/leads` is now TableToolbar/TableFrame with engine-side search
  (`q`: name, number, commune, request, assigned agent) and an unassigned filter.
- **Agencies show a principal contact**: the agency's first agent, named like
  every console person (never `username`). "Agence #id" stays the honest
  agency name when none exists, flagged "sans nom d'agence"; search also finds
  agents' person names and numbers. Stored vendor phones with a leading "+" no
  longer print "++".
- **Sales team page** is organised around agents brought in (active
  assignments, which attributions mirror) and those agents' live listings, with
  qualified / to-validate counts; every count links to the filtered list on the
  rep page (`?gfilter=with_listing|qualified|awaiting#referred`), and each row has
  copy code, copy link, QR download (`/admin/sales/[id]/qr?format=png|svg`, same
  access as the rep page) and "pay this fortnight" (`?status=approved&fn=…&payout=1`
  opens the payout dialog). A rep whose code brought nobody in gets a how-to card.
- **CMS hero image** (`migrations/20260921_cms_settings.sql`, `lib/cmsSettings.js`,
  `lib/cmsHeroRules.js`, `app/admin/cms/HeroManager.js`): upload (resized to
  2400 px JPEG via sharp, stored under `cms/hero/` in the listing bucket) or a
  pasted URL on a next/image-allowed host, alt text, optional credit, live
  preview, reset. The homepage reads it per request (`getHeroSettings` never
  throws) and falls back to `Hero/hero-sunlit.jpg`.

### "View as" an agent or a customer (impersonation)

`lib/impersonationToken.js` (pure crypto + the edge decision),
`lib/impersonation.js` (sessions), `lib/impersonationCookies.js`,
`app/admin/impersonation/{actions.js,exit/route.js,page.js}`,
`components/ImpersonationBanner.js`.

- **Read-only, enforced in middleware.js for every path outside /admin**: any
  non-GET/HEAD/OPTIONS request is a 403 while the `lukka_impersonation` cookie
  is present. One rule at the edge instead of a check in each action. Reason:
  confirming a visit from an agent's dashboard WhatsApps a real customer, and a
  change made "as" someone is indistinguishable afterwards from theirs. The
  extra matcher entry uses `has: cookie`, so ordinary storefront traffic never
  reaches the proxy.
- **Who**: `accounts.impersonate` (owner, support), an individual console
  account (the shared password is refused), a written reason (10–500 chars).
- **How**: a real agent/customer session cookie is minted for the target with
  a 60-minute token, next to a signed `imp1.…` cookie (ADMIN_SESSION_SECRET
  under an `impersonation:` prefix) carrying session id + nonce + the admin's
  token_version. One open session per admin; exit, console logout, expiry, or
  the admin being disabled/reset ends it. The banner is fixed to the BOTTOM of
  the viewport (the storefront header and its sticky offsets own the top).
- **Logged** in `console_impersonation_sessions` (`/admin/impersonation`,
  owner) and as `impersonation.start`/`.end` in the audit log.
- **Known limit**: agent/customer tokens are stateless, so the minted target
  cookie stays valid until its own 60 minutes even after the row is ended;
  exit deletes it from the browser.

### Deliberately not done yet (and why)

- **Engine leads/conversations/viewings are still SQLite.** Moving them to
  Postgres rewrites every synchronous `services/db.js` call on the live
  WhatsApp path (better-sqlite3 is synchronous; `pg` is not, so every caller
  up the chain changes shape). That is a dual-write migration with its own
  parity checks and cutover, not something to fold into a console deploy.
- **Agency self-service staff** (an agency managing its own branches and
  users from `/compte/agent`) needs an agency-level login, which does not
  exist: agents log in individually and `vendors` has no account of its own.
  Branches are admin-managed until then.
- **Card payments, invoices issued before payment, and failed-payment
  tracking** need a payment gateway, which is out by product decision.
  Receipts cover what the ledger can honestly prove.

## Layout & shell

- **Public pages live in the `app/(site)/` route group**; `app/admin` and `app/api` sit outside it. The shell (`Header` / `Footer`) is in `app/(site)/layout.js`, and the root layout is deliberately bare. Before this, everything nested in one root layout and `/admin` rendered the public header and footer *underneath* its own chrome. Route groups don't change URLs.
- **Spacing contract, defined once in `app/(site)/layout.js`**: `pt-16` clears the fixed `h-16` Header. Don't re-implement this per page — four pages used to compensate ad hoc with different values.
- **There is no desktop left icon rail, and no persistent mobile bottom bar.** `SideRail.js` (a fixed 76px `Rechercher`/`Favoris`/`Demandes`/`Compte` column, `hidden lg:flex`) and `BottomNav.js` (the same four destinations, `lg:hidden`, fixed to the viewport bottom) have both been removed entirely — the former because web/Design's screens never carried one, the latter on an explicit instruction to favour a Rightmove-style pattern (no persistent bottom chrome, floating per-page actions instead). All four destinations are still reachable: `Rechercher` via the search icon/FilterBar, `Demandes` as a text link in Header's top-right utility row (desktop) or its hamburger Sheet menu (mobile — the last consumer of `components/navItems.js`'s shared `NAV_ITEMS`), `Compte` via the account dropdown or that same Sheet. **`Favoris` is no longer a desktop header link** — it was removed from that row, and now reaches desktop visitors through the account dropdown (signed in), the footer's new Compte column (signed out — the account icon is a bare login link with no dropdown behind it, so the footer is what keeps `/favoris` reachable at all for them), and the Sheet on mobile. Any element that used to clear BottomNav's height (`FloatingControlBar.js`, `MobileListingBar.js`, `ListingsSplitView.js`'s mobile fullscreen map layer) now sits at the true viewport bottom instead — check each if you're touching mobile-bottom-anchored UI, the clearance math changed everywhere it applied.
- `FilterBar` sticks at `top-16` (under the header) and `ListingsSplitView`'s map sticks at `top-[8.5rem]` (under both). Those numbers are coupled — change one, check the others.
- **Desktop header utility row, left to right**: search icon (only where nothing else on the page owns search), account, currency, `Demandes`, language, "Publier un bien". `Demandes` sits beside the currency toggle and the FR|EN control sits immediately before the CTA — both placements are deliberate and documented in `Header.js`. The language control is `LanguageToggle.js`, a segmented FR|EN pill rather than a `<select>`, matching `CurrencyToggle` beside it; it writes the `NEXT_LOCALE` cookie *and* the `lukka_locale` localStorage mirror, then `router.refresh()`es so Server Components re-render in the new language (see `lib/i18n/`).
- **The homepage's second section is personalised when it can be.** `app/(site)/page.js` renders `SavedListings` ("Biens Enregistrés") instead of `FeaturedListings` ("Sélection de la Semaine") for a signed-in visitor with at least one saved property. The choice comes from `lib/savedHome.js`'s `getSavedHomeSection()`, which returns `null` for a signed-out visitor *and* for a signed-in one with an empty shelf — the fallback covers both. Deliberate: an empty personalised shelf would replace a full section of real listings with a prompt. The shelf is a horizontal snap rail at every breakpoint (`SavedListingsRail.js`), unlike `FeaturedListingsCarousel`'s scroll-then-grid, because its length is a fact about the visitor rather than a catalogue that continues.
- **The header is solid on every route, homepage included.** It used to start transparent over the hero photo and solidify on scroll (`Hero.js` carried `-mt-16` to bleed up under it, cancelling the layout's `pt-16`). The "Landing refondue" screen is explicit that it never goes transparent — the wordmark has to stay legible over whatever photograph the hero carries — so the scroll listener, the `overHero` flag and every `inverted` variant it drove (including `CurrencyToggle`'s) are gone, and the hero band starts below the header.

## Gotchas that cost real debugging time

- **A Server Action request body is capped at 1 MB unless you configure it, and going over is invisible from the client.** This broke *every* manual listing submission from the agent dashboard while WhatsApp intake kept working, because intake is a plain Express route on the engine and never touches a Server Action. `experimental.serverActions.bodySizeLimit` was unset, so Next.js applied its 1 MB default and aborted the multipart upload with a 413 **before the action ran at all** — before validation, before `assertAgentSession`. A phone photo is 2-5 MB, so essentially nothing got through. Two things follow, and both are now enforced:
  - **The transport ceiling and the app's own photo budget live in one file** (`lib/uploadLimits.mjs`) and `next.config.mjs` *imports* the number rather than repeating it. Two numbers that were meant to agree and silently didn't is the whole bug. `tests/unit/upload-limits.test.js` pins the relationship. (`.mjs` because `next.config.mjs` is loaded by plain Node ESM — no `@/` alias, no `server-only`, and a `.js` file with `export` in it makes Node warn about a typeless package on every start.)
  - **Current figures: 10 MB per photo, 10 photos, 40 MB per submission, so a 41 MB transport ceiling.** Per-photo went 5 MB → 10 MB because 5 MB was below what a current phone camera produces and was rejecting ordinary photos. **Change these in `uploadLimits.mjs` only** — the `bodySizeLimit`, the FR/EN copy (`{max}` is interpolated, never typed) and the browser's pre-flight all follow from them, and the tests derive their fixtures from them too rather than hardcoding a count × size that silently stops testing anything.
  - **Raising the budget is also a memory decision.** Next.js buffers the entire multipart body in memory and then copies each file again for the Storage upload, so a 40 MB set costs roughly 90 MB on top of the ~70 MB idle baseline. `ecosystem.config.js`'s `max_memory_restart` went 300M → 768M with it: being killed mid-upload is strictly worse than refusing one, because the restart takes every other in-flight request down too. Check that cap whenever the budget moves.
  - **A 413 reaches the caller as a rejected promise, never as `{ ok: false }`.** Every imperative `await someAction(...)` therefore needs a `try/catch`, or the failure is *completely* silent: no toast, no error, the form still full, the button apparently dead. That is exactly what agents were reporting. `SmartPasteSection` was worse still — `setPending(false)` sat after an unguarded `await`, so a rejection left the button spinning forever. Guard the pending flag with `finally`, not just `catch`. The other imperative action calls in `components/Agent*.js` post small text payloads and cannot 413, but they can still reject on an expired session; they are not yet guarded.
- **Validate uploads in the browser too, with the same rule the action uses.** Not for security — the action re-checks, and must, since it is a public POST endpoint — but because a size verdict reached *after* the request is a verdict nobody can be told about. `validatePhotoSelection()` is shared by both sides and returns an i18n key + vars rather than a string, so the shared module stays free of the dictionary.
- **Browser page translation crashes React, and it looks like nothing else.** Edge's translator (also Chrome's and Google Translate) replaces each text node React rendered with `<font><font>…</font></font>`. React's next commit calls `removeChild` on a text node that is no longer there, the browser throws `NotFoundError: The node to be removed is not a child of this node`, and the route falls to Next's default global error, *"This page couldn't load — Reload to try again, or go back."* Reported 2026-09-15 on `/compte/agent/demandes?tab=visites`; any client update on any translated page can trigger it.
  - **How to recognise it:** that exact wording (no digest) means a *client* exception — a server error reads "A server error occurred". Nothing reaches `pm2-error.log`. Every reproduction without translation works, including curl, a dev server and a clean browser on production data. The tell was in the screenshot: the wordmark read "LukkaPlacer", and strings we hardcode in French appeared in inconsistent English.
  - **How to reproduce:** on a production build, walk `document.body`'s text nodes, replace each with `<font><font>text</font></font>`, then trigger a client navigation. Same screen, same error.
  - **The fix is `lib/translationDomGuard.js`**, an inline `beforeInteractive` script in `app/layout.js` that makes `Node.prototype.removeChild`/`insertBefore` tolerate a node something else already moved (the mitigation from facebook/react#11538). Shipped as a string so `tests/unit/translation-dom-guard.test.js` evaluates the exact bytes the browser runs. `insertBefore` appends rather than skipping — the widely copied variant skips, which silently drops the new tab's content.
  - **It does not need to precede the chunk `<script>` tags, and doesn't.** React DOM calls `parent.removeChild(node)` on the node at call time (no cached `Node.prototype` reference in `react-dom-client.production.js`), so landing before hydration is enough.
  - **The guard stops the crash; it does not stop stale text — keys do.** Both tabs on `/compte/agent/demandes` open with the same element shape, so unkeyed React reused those elements and patched their text in place — exactly the operation translation breaks. With the guard alone the page survived, but the previous tab's translated subtitle stayed on screen beside the new one. The two tab bodies are now keyed `<Fragment>`s, so a switch is a remount, which only removes and inserts whole elements. **When two conditional branches render look-alike markup, key them.**
  - **Deliberately not `translate="no"`.** That also prevents the crash, but removes a feature agents use on purpose — much of the EN dashboard is still hardcoded French. Opting out of translation is a product decision; tolerating it is the bug fix.
  - **Not version skew.** Next 16 already hard-reloads when a stale tab's build id mismatches the server's (`doMpaNavigation` in `fetch-server-response.js`), so a tab left open across a deploy does not produce this screen. No `deploymentId` is configured, and none is needed for that.
- **Tailwind v4: no `tailwind.config.js`.** Any `--color-*` / `--font-*` in the `@theme` block becomes a utility automatically.
- **Don't trust an uncommon `grid-cols-N`/`col-span-N` to get generated.** `lg:grid-cols-10` silently never made it into the compiled CSS once. Prefer an arbitrary-value template (`grid-cols-[42%_minmax(0,1fr)]`) for anything beyond 1–6.
- **`@tailwindcss/postcss` and `tailwindcss` are devDependencies the *production build* still needs.** `npm install --omit=dev` breaks `next build`. Full `npm install` before building, even in production.
- **`useSearchParams()` forces a Suspense boundary around its caller.** `/favoris` called it at the top level, which put the *entire page* inside `<Suspense fallback={null}>` — verified in a browser, `<main>` rendered completely empty and the boundary never resolved. If a page needs one query param for one section, read `window.location.search` in an effect there instead of gating the whole page. If you do use the hook, scope it to the smallest component and never give it a `null` fallback.
- **Radix exit animations don't complete in a non-compositing tab.** With `document.hidden`, CSS animations sit at `currentTime: 0`, `animationend` never fires, and Radix `Presence` never unmounts — so a closed Dialog lingers in the DOM with `data-state="closed"` and keeps `body { overflow: hidden }`. This is an artifact of headless/hidden browser panes, **not** a code bug; it resolves the moment the page actually composites. Don't "fix" it.
- **`cn()` (tailwind-merge), not string concatenation, whenever a component accepts a `className` override.** `FavoriteButton` concatenated, so a caller's `bg-transparent` and the component's `bg-surface/90` both survived and CSS source order decided the winner instead of the caller.
- **`area` is a TEXT column carrying `'0'`, not NULL, when unknown** — a naive render produces "0 m²". Use `hasArea()` in `lib/listingView.js`.
- **`agents.username` is the account's own phone digits, not a name.** Every account created through WhatsApp onboarding (`services/agentOnboarding.js`, engine repo) or this app's phone+password signup (`createAgent`) sets `username = phone`; the real name lives in `agent_infos.first_name`/`last_name`, one row per language. `lib/listings.js` selected `a.username AS agency_name` and so printed "33766517388" on every card and on the detail page's `EnquiryCard`, while `/agents/[id]` showed "NSUMBU Marie" all along because it reads through `lib/agents.js`'s `agent_infos` join. Resolve names through `AGENCY_NAME_EXPR` (`lib/listings.js`) or `agentDisplayName` (`lib/agencies.js`), never off `username` — and pass anything user-visible through `displayableAgencyName` (`lib/agentIdentity.js`), which refuses a phone-shaped string. **Join `agent_infos` LATERAL + `LIMIT 1`**: it is per-language and agent #28 really holds two rows, so a plain `LEFT JOIN` duplicates every one of that agent's cards.

## Component conventions

- **`lib/listingView.js` owns values derived from a listing row** — images, spec items, dates, location line, description snippet. The three card designs each re-derived these, which is exactly how the same 14-day recency condition once ended up rendering "Just Added" in one file and "Nouveau" in two others; that specific value (`isNewListing`) has since been removed from this module entirely along with the badge it fed, but the "one source of truth" principle stands for everything still here.
- **Three listing card designs exist on purpose** — `ListingCard.js` (horizontal, Rightmove-style 1-large-2-small photo collage, used on `/favoris`), `ListingCardVertical.js` (grid card for the `/listings` split view), `FeaturedListingCard.js` (homepage carousel teaser). One visual language, three layouts. Don't collapse them.
- **`SafeImage.js` for any listing-sourced image, never bare `next/image`** — some stored objects genuinely 400 at source, and a visitor should see the real "no photo" placeholder rather than a broken-image icon. `PhotoGallery`'s thumbnails used bare `next/image` and had no fallback while the main frame did.
- **UI primitives come from `components/ui/*` (shadcn, Radix).** Installed: `button`, `card`, `dialog`, `dropdown-menu`, `popover`, `sheet`, `tabs`. Add more with `npx shadcn@latest add <name>` — and **diff `app/globals.css` afterwards**, it has silently overwritten the palette before.
  - **Popover, not DropdownMenu, for filter panels.** DropdownMenu implements roving focus and typeahead over menu *items*, which fights any text or number input inside it. See `FilterPill.js`.
  - Radix content portals to `document.body`, so it is **outside the `<form>`**. `FilterBar` therefore owns every filter value in React state and renders hidden inputs inside the form; the pill panels and the sheet are pure UI. Don't put a named form field inside a portalled panel and expect it to submit.
- **Icons are `lucide-react`, always**, with `ICON_SIZE` / `ICON_STROKE_WIDTH` from `lib/constants.js`. The hand-rolled WhatsApp/Facebook/Instagram brand SVGs in `Footer.js` and `WhatsAppCTA.js` are the one deliberate exception — this lucide version ships no brand glyphs (confirmed by a failed build, not assumed).
- **Motion is CSS, not a library.** `framer-motion`, `lib/motion.js` and `lib/useMotionSafe.js` are gone (see "Mobile performance & resilience" below). The presets live in `app/globals.css`: `.u-pop` (a toggled icon — key the span on a counter and apply the class only when it is > 0, so it never plays on mount), `.u-reveal` (entrance on mount), `.u-rise` (small panel over the map), `.u-reveal-in-view` (scroll-driven, `animation-timeline: view()`, no JS; a browser without it shows the element with no reveal). All are gated on `prefers-reduced-motion` in the CSS itself. Radix `Dialog`/`Sheet` animate via `data-state` + `tw-animate-css`. Don't add a motion library back for decoration: it was ~40 KB gzip on every page for effects most of them never ran on a phone.

## Mobile performance & resilience

95%+ of visitors are on mid/low-end Android phones on 3G/4G in Kinshasa, paying
per megabyte. Baseline measured on production at 375px (2026-09-15), before this
pass: ~257 KB gzip of first-party JS on `/` served gzip-only, card photos at
q=90, the Maps JS API (~245 KB) loaded on every listing page before anyone
scrolled to it, invisible-but-tappable photo arrows on every card, and no
loading or error boundary anywhere outside the client portal and `/admin`.

- **Data budget.**
  - `images.qualities: [75]` and `minimumCacheTTL` 30 days (`next.config.mjs`).
    Storage object names are content hashes, so an optimised photo never goes
    stale. Don't reintroduce `quality={90}`: it doubled grid photo bytes, and a
    card and the gallery asking for different qualities download the same photo
    twice.
  - Maps load on demand. `ResponsiveMapPane` imports every map module through
    `next/dynamic`. `ListingLocationMap` shows an "Afficher la carte" button
    below 1024px or with Data Saver on, and on desktop loads once the frame is
    within 400px of the viewport. The frame keeps its height either way.
  - `lib/useSaveData.js` (`saveData` or a 2G `effectiveType`) skips work nobody
    asked for: auto-loading the map, preloading the neighbouring card photo.
    It never hides content, and it is false on the server and in
    Safari/Firefox.
  - Dialogs that only open on a tap (`AuthPromptModal`,
    `SearchAlertConfirmModal`) are `next/dynamic`. The DM Serif italic font
    file is not loaded.
  - **Compression**: `WEB_COMPRESS=off` turns off Next's own gzip so Traefik's
    `compress` middleware can serve brotli. Traefik skips a response that
    already has a Content-Encoding, so the two changes only work together. Set
    the env without the middleware and every page ships uncompressed.
- **Touch.**
  - Controls a thumb uses are ≥44px (`min-h-11`/`h-11`). A control drawn
    smaller gets `.u-hit`, whose `::after` pads the tap area to 44px. It needs
    a positioned element.
  - `CardImageCarousel`'s arrows are `hidden` below `sm` and
    `pointer-events-none` until hover or keyboard focus. Its dots don't respond
    to taps on a phone (a swipe is the control there).
  - Hand-written `:hover` rules in `globals.css` sit inside
    `@media (hover: hover)`, because Android keeps `:hover` on the last thing
    tapped. Tailwind's own `hover:` variant is already gated that way.
  - No `backdrop-filter` on touch devices: `.u-glass-*` switches to an opaque
    fill under `(hover: none)`, and bottom bars use `lg:backdrop-blur-*`. One
    blur per card is re-rendered on every scroll frame.
  - Text floor on phone-facing surfaces is 11px.
- **Agent photos are shrunk on the phone** (`lib/photoShrink.js`, used by
  `CreateListingDialog` and `AgentListingEditor`): 1600px long edge, JPEG 0.82,
  one photo at a time. A 4 MB camera photo becomes ~300 KB, and EXIF
  (including GPS) is dropped. Anything that can't be decoded, or doesn't come
  out smaller, is sent as the original. `lib/uploadLimits.mjs` still validates
  whatever is sent.
- **Slow and failed requests.**
  - `loading.js` exists at `(site)/`, `(site)/listings/[id]/`, `compte/agent/`
    and `(portfolio)/`, using `components/RouteSkeletons.js`.
  - Each sits at a segment root, so a search-param change inside a page
    (`/listings` filters, `?tab=`) does not flash the skeleton or remount the
    map.
  - `error.js` in the same three trees renders `components/RouteError.js`
    (Next 16 passes `retry`). It shows an offline-specific message when the
    browser reports no connection. `app/global-error.js` is inline-styled and
    bilingual because it replaces the root layout.
  - `OfflineBanner` (root layout) shows a pill while offline.
    `lib/networkError.js`'s `isNetworkError` separates a dropped connection
    from a server verdict. `ViewingPanel` and `AgentVisitRequestCard` offer
    "Réessayer" on the toast for the first; retrying is safe because the
    engine ignores a repeated status.
  - `ViewingPanel` acknowledges a tap at once. `sent` is keyed to the
    `viewing` object it was made against, so the refreshed timeline takes over
    by itself. It is not `useOptimistic`, which reverts when the action ends,
    before `router.refresh()` has delivered the new timeline.
- **PWA.** `app/manifest.js` (icons `public/brand/icon-192.png` / `icon-512.png`,
  resized from `app/icon.png`) and `public/sw.js`, registered in production only
  after `load`.
  - The worker caches `/_next/static` cache-first (200s only).
  - It serves `/_next/image` stale-while-revalidate (80 entries).
  - Navigations are network-first with a `/offline.html` fallback.
  - **It never caches HTML** (sessions, prices, availability). It does not
    touch `/api`, `/admin`, non-GET requests or other origins.
  - `/sw.js` is served `no-cache`. The kill switch is in its header comment.
    Pinned by `tests/unit/mobile-performance.test.js`, which runs the worker in
    a VM.
- **Real-user Web Vitals.** `components/WebVitals.js` beacons LCP/INP/CLS/FCP/TTFB
  (route with ids collapsed, connection class, Data Saver) to
  `POST /api/telemetry/vitals`. That route validates the payload and writes one
  `[vitals] {json}` line per metric to the web process log, with no table and
  no migration. Read with
  `pm2 logs lukka-place-web --lines 5000 --nostream | grep '\[vitals\]'`.
- **Open: React hydration error #418 on lukkaplace.com.** It predates this
  pass: the pre-deploy build, run on the VPS and reached through an SSH tunnel,
  throws it too. One cause is found and fixed. Listing dates were formatted in
  the runtime timezone, so the UTC server and a UTC+2 phone printed different
  days. Every listing date is now pinned to `LISTING_TIME_ZONE` in
  `lib/listingView.js`, and after that fix the live process reached directly
  on :3002 hydrates cleanly.
  - **Not the cause:** it still happens (3 errors per page) through
    `https://lukkaplace.com`, and none of these change that: brotli vs Next's
    own gzip, a service worker vs none, cleared storage and cookies.
  - **Already ruled out:** server HTML through Traefik has the same visible
    text as the direct HTML, and with vs without cookies.
  - **Next step:** a build with `reactProductionProfiling` or a non-minified
    React so the message names the mismatched node, loaded on the real
    hostname. A mismatch makes React re-render the page on the client, which
    is costly on low-end Android.
- **Deliberately not done here:**
  - **Cacheable HTML.** The locale cookie makes every route dynamic (see
    "Bilingual FR/EN"). The fix is the `app/[locale]/` migration, a URL change
    that is a product decision in its own right.
  - **Direct-to-Storage per-photo uploads with progress.** That needs
    signed upload URLs, ownership checks on the returned paths, and a new
    offline-replay contract. Shrinking already removes most of the upload time.
  - **`PropertyCard` as a Server Component.** It renders inside client parents
    (`ListingsSplitView`, both rails), so it stays a client component until
    those are restructured.

## Phone numbers are international now — the country is data, not a guess

The platform opened to diaspora customers (buying in Kinshasa from London,
Brussels, Toronto) and to agents listing property outside the DRC, so a phone
number can no longer be assumed Congolese.

- **`components/PhoneField.js` is the only phone input in the product.** It
  posts two fields: the typed number as `name`, and the picked ISO 3166-1
  country as `<name>Country`. Every Server Action reads both through
  `phoneFromForm(formData)` (`lib/phone.js`). A new form that renders a bare
  `<input type="tel">` reintroduces exactly the bug this replaced.
- **The bug it replaced was silent and damaging.** `normalizePhone`'s
  country-less branch recognises DRC shorthand, so a London number typed as
  `07932673460` was stored as `243793267346` — a real Kinshasa number
  belonging to somebody else. No error, no rejection: a working-looking
  account whose OTP, alerts and viewing confirmations all went to a stranger.
- **Three normalizers, three jobs, don't mix them up:**
  - `normalizePhone(input, country)` — raw text from a form. With a country
    it is exact; without one it still accepts DRC shorthand and refuses to
    guess at anything else.
  - `normalizeStoredPhone(value)` — a value that is ALREADY E.164 (a `wa_id`
    from the WhatsApp pipeline, a number off a row, the number in a signed
    cookie). Re-running `normalizePhone` on one of these rejects every
    non-DRC number, which is what turned international agents' activation
    links into "Lien expiré".
  - `splitPhone(e164)` — the inverse, for re-opening a stored number into
    the picker.
- **`lib/countries.js` holds E.164 dial codes only; country NAMES come from
  `Intl.DisplayNames`** in the reader's own locale. 230-odd hand-typed French
  strings plus 230 English ones is a FR/EN parity problem nobody on this team
  would maintain. `tests/unit/phone-countries.test.js` asserts every ISO code
  resolves to a real region name, which is what catches a typo'd code.
- **Trunk prefixes are per-country facts, not a blanket "strip the 0".** `''`
  for Italy and Côte d'Ivoire (the leading 0 is part of the number there),
  `'1'` across the NANP, `'0'` elsewhere. Getting this wrong deletes a real
  digit.
- **Seven dial codes are shared** (+1 across 24 NANP territories, +44 across
  the UK and the Crown Dependencies, …). `PRIMARY_FOR_DIAL` says which
  country a stored number displays as; without it, list order decided, and
  every British number was labelled "Guernsey".
- **The starting country is decided server-side** from `Accept-Language`
  (`lib/requestCountry.js`), so the first paint already shows the right dial
  code. Without it the field renders +243 and flips to +44 a moment after
  hydration — real, observed in the preview. A bare `fr` (no region) is
  ignored rather than maximised into `fr-FR`; that would default a Kinshasa
  visitor to France. After hydration a previous explicit choice
  (`localStorage`) and the visitor's own selection both win.
- **No flag images and no new dependency.** Flags are regional-indicator
  emoji. Windows ships no flag-emoji font, so they render there as the two
  ISO letters — which is exactly the code chip the alternative design would
  have drawn, and why there isn't a second one beside them.
- **Radix restores focus to the trigger on close, and that is wrong here.**
  Picking a country with Enter put focus back on the trigger button just in
  time for that same keystroke's keyup to "click" it and reopen the panel.
  `onCloseAutoFocus` is prevented, and `choose()` moves focus to the number
  input synchronously — the panel animates out over ~100ms and keystrokes
  land in the search box for the whole of it otherwise. Both confirmed in a
  real browser, not reasoned about.

## TESTING MODE — `AUTH_OTP_BYPASS=1` turns phone verification off

`lib/otpBypass.js`, read by the four auth entry points (customer signup and
login, agent signup and login). **Currently set on production**, deliberately,
so the end-to-end flow can be tested at all.

**Why it exists.** The `agent_auth_otp` template is not delivering, and
`lib/otpDelivery.js`'s session-message fallback only reaches somebody who
messaged the business number in the last 24 hours — which a first-time
registrant never has. So no new account could complete signup, and nothing
downstream of signup (listing attribution, the agent dashboard, demandes)
could be exercised.

**What it changes: exactly one thing.** Whether a code has to be presented.
Passwords are still scrypt-hashed through `lib/authCrypto.js`, sessions are
still the same signed tokens, and the bypassed path calls the same
`consumeAgentOtp` / `consumeCustomerOtp` the real path does — so the row ends
up in an identical state, including the retroactive listing claim that makes
an agent's already-WhatsApped listings appear on their dashboard.

**What it costs.** Phone verification is the only thing proving a registrant
holds the number they typed. With this on, anyone can register any number and
be treated as its owner — and since `consumeAgentOtp` claims every listing
ever sent from that number, an agent signup on somebody else's number hands
over that agency's portfolio. Acceptable for a closed testing window on known
numbers; **not** acceptable once real agents are onboarding themselves.

**Turning it off is `unset AUTH_OTP_BYPASS` + `pm2 restart lukka-place-web
--update-env`.** No code change and no revert — that is why it is an env flag
and not a commented-out block. The flag is read at call time, not module load,
so the restart is enough.

Not affected, and still OTP-gated: `/mot-de-passe-oublie` (self-service
password reset). Use the admin reset below instead while the template is down.

## Admin password reset — `lib/adminPasswordReset.js`

An admin can set any agent's or customer's password directly, from
`/admin/agents/[id]` (in the "Accès et sécurité" card, beside the WhatsApp
link) and from the new `/admin/customers` list.

- **It reuses `resetAgentPassword` / `resetCustomerPassword`**, not its own
  UPDATE. Those already carry the semantics a password change must have here:
  replace the hash, clear any in-flight reset code, bump `token_version` so
  every outstanding session dies, clear the login lockout. An admin-set
  password that skipped the `token_version` bump would leave whoever was
  already signed in on the old password still signed in — usually the exact
  situation the reset is being used to end.
- **The two realms keep their own hashers.** `agentAuth` and `customerAuth`
  are separate auth realms with separate session secrets
  (`tests/unit/auth-realms.test.js` pins that). They compute the same scrypt
  form today; that is not a guarantee to build on.
- **The typed password is shown in clear in the form.** Deliberate: the admin
  is about to read it out over WhatsApp, and a masked field they cannot check
  is how an account gets locked harder than it started. It is never logged,
  never returned by the action, and never sent anywhere — the admin relays it.
- **Why `/admin/customers` is a list with an inline reset, not a detail page.**
  Password reset is the only customer-account operation this console has any
  business performing; everything else a customer owns already shows on
  `/admin/leads` and `/admin/conversations`, keyed by phone. Agents keep their
  detail page because they have identity, territory and a portfolio to manage.
- This is also the only reset path customers have ever had — the activation-link
  mechanism is an `agents` table feature.

## Heading capitalization — Title Case in EN, sentence case in FR

Enforced by `tests/unit/heading-capitalization.test.js`, applied by
`node scripts/apply-title-case.mjs`, with the rule itself in
`lib/titleCase.js` and "which keys are headings" in
`scripts/heading-keys.mjs` — the transform and the test share both, so they
cannot drift.

**Two conventions, because the two languages have two:**

| | Rule | Example |
| --- | --- | --- |
| English | Title Case | "Create an Agent Account" |
| French | sentence case | "Créer un compte agent" |

Forcing English Title Case onto French would produce "Créer Un Compte
Agent", which reads to a French speaker the way "create an agent account"
reads to an English one. `apply-title-case.mjs` only ever opens `en.json`;
there is no code path that could Title-Case the French dictionary.

- **`subtitle` ends in `title`** and was swept into the first run of the
  transform, which turned a banner's body copy into "List Your Properties and
  Receive Customer Enquiries on WhatsApp." Subtitles are excluded explicitly
  in `heading-keys.mjs`. Watch for this whenever the suffix match is widened.
- **Not `text-transform: capitalize`.** That utility uppercases *every* word,
  giving "Are You **An** Estate Agent **Or** Agency?" — it has no concept of
  articles, conjunctions or prepositions, cannot leave an acronym alone, and
  would leave the underlying strings wrong anyway. The strings are
  transformed at source so the rendered text is the text in the dictionary.
- **Words with deliberate casing are never re-cased** — `WhatsApp`, `USD`,
  `CDF`. A naive capitalizer turns "WhatsApp" into "Whatsapp".
- **Interpolations are never touched** (`{count}`, `{name}`), and a template
  that OPENS with one is exempt from the capital check, since the capital
  comes from the value. `listings.results.heading` is `"{subject}
  {transaction} in {place}"` — the test asserts the strings that can fill
  `{subject}` instead of exempting that `<h1>` silently.
- **Checking a template's ingredients is not the same as checking the
  heading.** The `{subject}` fillers were asserted; `{transaction}` never
  was. It comes from `search.label.toRent` / `toBuy` / `available` — three
  keys that exist for this one `<h1>` and nothing else, and which read "to
  rent" / "for sale" / "available". So `/listings` shipped "Apartments to
  rent in Gombe": the very string this file used as its Title Case example,
  in sentence case. They are now "to Rent" / "for Sale" / "Available" (odd
  alone, correct in the only place they appear), and the test assembles the
  real heading — every subject × every transaction — rather than inspecting
  the parts. Change those three keys only together with that test.
- **There is deliberately no test asserting French is *not* Title Case.** The
  obvious version fires on every proper-noun meta title ("Contact — Lukka
  Place") and would need a hand-maintained exception list. See the comment in
  the test file.
- **The nine hardcoded French JSX headings are gone.** They rendered French —
  and therefore sentence case — to an English reader, because a heading
  written straight into JSX never meets the dictionary. All nine now go
  through `t()` (`account.requests.submitted`,
  `admin.agentPanel.subscriptionHistory`, `admin.moderation.content`,
  `admin.matching.title`, `admin.subscriptions.paymentsAndSubscriptions`,
  `admin.subscriptions.featuredListings`, `agent.editor.descriptionSection`,
  `agent.editor.photos`, and the already-existing `agent.subscription.title`),
  so the rule reaches them. `grep -rEn "<h[1-6][^>]*>[^<{]*[A-Za-zÀ-ÿ]" app
  components` is how you find a new one; it should stay empty.

### A heading is not always next to an `<h2>`

`heading-keys.mjs` unions **three** sources, not two. The third exists
because `<Panel title={t('admin.dashboard.trafficSource')}>` renders a real
`<h2>` — inside `Panel` — with no heading element anywhere near the call
site. Twenty-one headings (`Panel`, `Step`, `SectionHeading`, `PageShell`,
`AgentPageHeader`, `PortalEmpty`, `SectionTitle`, plus Radix's
`DialogTitle`/`SheetTitle`) sat outside this rule until the prop scan was
added, so "Sort by", "More filters" and "Traffic source" were shipping in
sentence case under an English Title Case convention.

- **Which props are heading props is derived, never listed.** A component is
  read for `<h2>{title}</h2>`, and `title` becomes a heading prop of that
  component. A hand-kept list is precisely what goes stale when someone adds
  a dashboard panel.
- **Radix's `DialogTitle`/`SheetTitle` are named explicitly**, since they are
  the one case that never appears as `<hN>` in our source — Radix renders the
  `<h2>` and wires `aria-labelledby` to it.
- **The prop scan is scoped to the opening tag, and children are scanned from
  after it.** `<SectionTitle action={<button>{t('…linkCopied')}</button>}>`
  puts a button's label *inside the opening tag*; scanning from the tag's
  start Title-Cased "Link copied" — a transient toast label — as though it
  were a section heading. Both halves of that (the heading it must catch, the
  label it must not) are pinned in the test file.
- **A key used as both a dialog title and the button that opens it gets Title
  Case in both places**, which is right here: this app's buttons already read
  "Log In" and "Create an Account".
- **A heading entry is not always a string.** `agent.listings.deleteBulkTitle`
  and `account.favorites.compareTitle` are `{ one, other }` plural objects,
  and both forms render into the same heading. A plain `typeof value ===
  'string'` check skipped them entirely — they were the last two English
  headings still in sentence case, and the naming convention had been
  matching them the whole time. `headingStrings()` in `heading-keys.mjs` is
  the one place that resolves an entry to the strings it can render; use it
  rather than `lookup()` when checking or rewriting heading copy.
- **A heading key that doesn't exist fails a test now.**
  `lib/i18n/translate.js` falls back silently in production, so a typo'd
  `t('admin.matching.titel')` ships an empty `<h1>` rather than an error, and
  `allHeadingKeys` drops unknown keys so the transform never trips over one —
  which is the same thing that would hide the typo. Both dictionaries are
  asserted to hold every key the JSX renders in a heading.

## Phone verification — WhatsApp OTP, both account types

**Customer signup no longer establishes a session.** It creates the row,
sends a code, and hands off to `/compte/inscription/verifier`; only a real
code establishes the session. Agents have worked this way since they were
built — customers were the side missing it, which meant a mistyped number
produced an account we could never reach again through the only channel this
product has.

- **`scripts/migrate-customer-phone-verification.js` must run before this
  code deploys.** `getCustomerByPhone` selects `otp_code_hash`,
  `otp_expires_at` and `phone_verified_at`; without the migration every
  customer login throws. Additive and re-runnable (`IF NOT EXISTS`).
- **Existing customers are NOT backfilled as verified.** Nobody proved those
  numbers, and stamping a timestamp would record a verification that never
  happened. They are asked once, on their next login — the same one-time step
  an unverified agent already goes through.
- **`lib/verifyAttempt.js` replaced the `?agent=<id>` / `?customer=<id>` query
  param.** That param was not a credential (the code is), but it was
  guessable, and two things followed: the resend button would fire a real
  WhatsApp message at whatever account id you typed into the URL, and the
  page could never show the number it had just texted. A signed httpOnly
  cookie fixes both — the page now confirms the last four digits back, which
  is how someone catches their own typo instead of waiting ten minutes for a
  code that was never coming. Same primitive and same reasoning as
  `lib/resetAttempt.js`.
- **`/compte/inscription/verifier` is in `middleware.js`'s public list**, for
  the same reason the agent one is: it is the step *before* a session exists.
  Gating it on a session bounces every new customer to a login they cannot
  pass until they enter the very code that page is asking for. Pinned in
  `tests/unit/middleware.test.js`.
- **`lib/otpDelivery.js` is the one way a code leaves this app**, and it is
  template-first with a session-message fallback. Meta only delivers a
  free-form message to someone who messaged the business in the last 24h, so
  a first-time registrant never receives one — accepted with a real message
  id, silently never delivered. The fallback exists because the template
  lives in Meta's WhatsApp Manager and may be missing or pending approval;
  when it is, a session message still reaches everyone who has messaged us
  recently. Both failing is reported as a real failure, never swallowed. The
  password-reset flow was a bare free-form send until now and went through
  this too.
- **OTP primitives live in `lib/authCrypto.js`** (`hashOtp`, `verifyOtp`,
  `otpExpiresAt`, `OTP_TTL_MS`), re-exported from `agentAuth.js` for the
  callers that already imported them there. One 10-minute lifetime for every
  code this product sends; a customer-flavoured copy is how two "10 minutes"
  quietly become 10 and 15.
- Signup verification (`otp_code_hash`) and password reset
  (`reset_otp_code_hash`) are **separate column pairs on both tables**. One
  flow must never invalidate the other's in-flight code.

## Known gaps (real, documented, not to be papered over)

- **`price_period` / `deposit_months`** — the `ALTER TABLE properties ADD COLUMN price_period text, ADD COLUMN deposit_months integer;` migration this was waiting on has run (2026-08-19, confirmed directly against `information_schema.columns`), and `SELECT_FIELDS` (`lib/listings.js`) now selects both. Before this, `services/postgres.js` (engine repo) was already writing both fields on *every* sync — since `syncListingToPostgres` is fire-and-forget and swallows its own errors, that meant every listing publish was silently failing to reach Postgres at all, with the submitting agent seeing a normal success reply. Existing Postgres rows still have `NULL` for both until their next sync; `DepositBadge` only starts showing real values as listings get republished or freshly submitted.
- **`advance_months` / `commission_months` now exist on `properties` and are rendered** — this note previously said they did not, and was stale. The `ALTER TABLE` ran (`scripts/migrate-entry-cost-columns.js`), `syncListingToPostgres` writes all three, `SELECT_FIELDS` selects them, `lib/listingView.js`'s `entryTerms()` renders the full "3 + 1 + 1 mois" KeyFacts cell, and `components/EntryCostsBreakdown.js` itemises who receives each poste (avance and garantie to the Bailleur, commission to the Agent/Agence) with a derived total. **The genuine caveat that remains**: legacy rows may carry a SUMMED value in `deposit_months` from before the engine split the fields, and those are indistinguishable from a real long deposit without re-reading the original WhatsApp text. Nothing fills a missing advance or commission with a "standard" figure — there is no standard, and a guess here is a number a customer would budget against.
- **`parent_building_id` / `building_name` exist and are selected, but no row carries one yet.** Added by `scripts/migrate-building-columns.js` (run against production 2026-09-11, both nullable, partial index on `parent_building_id`). The engine stamps them only on listings published through multi-unit expansion (`services/db.js` `expandAndPublishListing`), which no production listing has used yet — so `lib/buildingGroups.js` is live but every listing currently groups as itself, which renders exactly as it did before. The first multi-unit WhatsApp paste to be confirmed is what will draw the first building pin. Nothing is backfilled: a pre-existing listing has no building to belong to, and inventing a group id would invent a building.
- **`latitude` / `longitude` are now read, but are populated on only 8 of 31 approved listings.** `SELECT_FIELDS` omitted both columns until 2026-09-04, which meant `lib/geocoding.js`'s `source: 'existing'` branch was dead for *every* listing on the site: each map view re-geocoded client-side against a billable Google API, once per session, while the rows that did carry coordinates went unused — and the km-radius filter in the same module queried those same columns, so there were two sources of truth for one location, disagreeing by construction. The SELECT is fixed and verified live (`listing #256: existing`). Persisting coordinates at publish time still needs an **IP-restricted `GOOGLE_MAPS_SERVER_KEY`**: the browser key is HTTP-referrer-restricted and Google refuses it server-side. Until then the other 23 fall back to commune centroid + deterministic jitter, which `ListingLocationMap` labels honestly.
  - **Update (2026-09-14):** the engine now geocodes at publish time (`services/geocoding.js`, run from `syncListingToPostgres`) whenever `GOOGLE_MAPS_SERVER_KEY` is in the ENGINE's `.env`, and `scripts/backfill-listing-coordinates.js` (engine repo) fills older rows through the same code. The key already existed in this app's `.env.local` on the VPS; `scripts/geocode-listings.js` here predates the cascade and precision check and should not be used for new backfills. A listing that still has no coordinates is placed at its commune centroid by `/api/listings/map` and counted on the map badge.
- **Google Maps is currently failing on the live site** with "This page can't load Google Maps correctly" — pins resolve and markers are created, so the pipeline works, but tiles are refused. That signature is billing/quota on the Google Cloud project, not a code fault. `localhost` is also absent from the browser key's referrer allow-list, so the map cannot be exercised in local dev at all (confirmed on both :3001 and :3002).
- **`NEXT_PUBLIC_WHATSAPP_NUMBER` *is* set** (`.env.local`). A previous version of this note said otherwise and was stale. The real exposure is production: `.env.local` is hand-maintained and untracked, and `ecosystem.config.js` does not set it, so a fresh deploy that loses that file makes `WhatsAppCTA`/`CallCTA` build `wa.me/undefined` — a live link to nowhere — while the ~15 `getCentralWhatsAppHref` call sites render their disabled state.
- **Commune tags: 6 of 31 approved listings still carry none.** `scripts/backfill-commune-tags.js` recovered 7 from real address text; the rest have no commune in their text, or are ambiguous. Note that **"Kinshasa" is both the city and one of the 24 communes**, and every address here ends with the city — so that name is excluded from automatic matching entirely. A listing genuinely in Kinshasa commune has to be tagged by a human.
- **`features` (`text[]`) exists on `properties`, is rendered, and is populated on 32 of the 48 approved listings** — the "Caractéristiques principales" list on the detail page (`components/listings/PropertyDescription.js`, `lib/descriptionParser.js`). Column added by the engine's `scripts/migrate-listing-features.js`; filled on every new listing by the extraction itself, and on existing ones by the engine's `scripts/backfill-listing-features.js` (run 2026-09-13), which re-ran that same extraction over each listing's original WhatsApp message — not a regex, and never the public description, which is prose on all 48 rows. Checked after the run: 189 bullets, 5.9 per listing, 0 phone-shaped, and every line in an 8-listing sample traceable to its source message. **The other 16 have no original message on file** (properties 197, 226, 227, 239, 240, 253, 254, 256, 257, 264, 265, 266, 298, 300, 301, 302 — pre-engine, or created through the agent form) and stay NULL by design: they fall back to the AMENITY_KEYWORDS pass, which carries its own weaker caption. Known residue, left deliberately: the extraction sometimes repeats a room count KeyFacts also shows ("2 salles de bain"), and can normalise a bare "Sécurité" to the stock "Sécurité assurée" — redundant or mildly rephrased, never an invented physical fact.
- **`listing_events` is a new, empty table** (`scripts/setup-listing-events.js`) holding `listing_saved` / `listing_unsaved`, written by `POST /api/track`. Nothing reads it yet — `lib/analytics.js` has no query against it, so the save funnel is recorded but not yet on the dashboard. `whatsapp_clicks.price` was added by the same script and is NULL on every row written before it; those events genuinely predate the measurement and are not backfilled.
- **No logo file yet.** `components/Brand.js` renders a set-type wordmark; drop the client's SVG at `public/brand/` and flip `LOGO_SRC` / `MARK_SRC`. Nothing else imports a brand mark.
- **Per-listing agent contact — the schema limitation this used to describe is resolved; a real self-service path now exists.** `properties.agent_id` (FK) is the mechanism, joined to `agents`/`agent_infos`. **Correction, checked directly against live Supabase (this note previously said otherwise and was stale): `agents.phone` is `character varying(32)`, not a 32-bit integer — it holds a real E.164 `wa_id` (e.g. `243997123456`) with no truncation risk.** Phase 2 added the admin-side `assignAgentToListingAction` (`web/app/admin/agents/actions.js`) that populates `agent_id` for real; Phase 4 added genuine agent self-service accounts (`agents.password_hash`, phone-verified via a real WhatsApp OTP — see `lib/agentAuth.js`), independent of Laravel's own unused `agents.password` column. A listing without an attributed agent still correctly falls back to the central `WhatsAppCTA` number, same as before — this is no longer the only path, just the honest fallback when there's genuinely no agent attached yet.

## Bilingual FR/EN — how it works and what will bite you

French is the default and is not a "source language of convenience": listings,
communes and agents are French-first, and `lib/i18n/config.js`'s
`DEFAULT_LOCALE` encodes that. English exists for the diaspora audience — the
same audience the USD/FC toggle was built for.

**Locale is a cookie (`NEXT_LOCALE`), not a `/fr` `/en` route segment.** That
was a deliberate trade-off, recorded in `lib/i18n/config.js`: no restructuring
of ~100 route files into `app/[locale]/`, no rewrite of every internal
`<Link href>`, and one canonical URL per page so existing shares keep working.
The cost is that reading the cookie opts a route into dynamic rendering — the
seven public routes that used to prerender (`/`, `/a-propos`, `/contact`,
`/favoris`, `/agents`, `/messages`, `/plan`) are now `ƒ`. Everything else was
already dynamic. If per-locale static prerendering ever matters more, the
migration is to `app/[locale]/`, not to reading the cookie in fewer places.

- **Dictionaries** — `lib/i18n/fr.json` / `en.json`, ~1,185 keys each, grouped
  into 18 top-level namespaces. `tests/unit/i18n.test.js` asserts they stay
  key-for-key identical, that no value is blank, and that `{placeholder}` sets
  match between the two — a "{count} biens" translated without its count is
  silent data loss.
- **Reading a string** — `await getT()` in a Server Component or Server Action
  (`lib/i18n/server.js`), `useT()` in a client one (`lib/i18n/client.js`).
  Never import `lib/i18n/server.js` from anything reachable by a `'use client'`
  file: it pulls in `server-only` and `next/headers`, and the build fails.
- **Namespaces are shipped per surface.** Each layout passes only what its own
  subtree renders, so `/admin`'s copy never reaches a public visitor (~6KB
  gzip saved per public page). `tests/unit/i18n-namespaces.test.js` walks the
  real import graph and fails if a client component resolves a namespace its
  layout doesn't provide — that gap is otherwise silent in production, warned
  about only in dev.

### The three mistakes that actually happened here, repeatedly

1. **`t` in a module-level constant.** `const LABELS = { a: t('x') }` at the top
   of a file is a `ReferenceError` at import — `t` only exists inside a
   component or action. Constants hold `labelKey` strings and the consumer
   resolves them at render. Every label map in this codebase follows that shape
   (`components/navItems.js` is the reference).
2. **`t` in a default parameter.** `function X({ label = t('y') })` has the same
   problem: parameter defaults are evaluated where `t` is not in scope. The
   default moves into the body (`CopyLinkButton`, `ShareOnWhatsAppButton`,
   `LocationAutocomplete` all do this, with a comment).
3. **A function that calls `t()` without binding one.** This is the dangerous
   one: **the build passes and the page 500s at render.** It shipped several
   times during the migration and was caught in a browser, not by `npm run
   build`. `tests/unit/i18n-translator-binding.test.js` now checks every
   top-level declaration. Two cases are worth remembering — `Wordmark`
   (`components/Brand.js`) is a NAMED export, so an earlier check that only
   looked at default exports saw nothing while every page rendering the header
   crashed; and an earlier version of that test missed `FavoritesSection`
   because an apostrophe in French JSX text was read as the start of a string
   literal and threw off its brace counting.

### What is deliberately NOT translated

- **Real data**: listing titles, descriptions, commune and quartier names,
  agency names, `category_name` out of `property_category_contents`. Only
  labels around them are keys. `typeLabel()` translates the parcelle sub-type
  and passes `category_name` through untouched.
- **`AMENITY_KEYWORDS` (`lib/constants.js`)** and
  **`EXTRACTION_FAILURE_MARKERS` (`app/admin/listings/actions.js`)** — French
  keyword lists matched against listing text that is itself French.
  Translating either would break the matcher, not localise it.
- **The `flexibility` option VALUES** in the customer request form: the chosen
  option is stored as free text and appended to what partner agencies read, so
  translating the value would change what lands in the database depending on
  the customer's display language. Only its visible label follows the toggle.
- **The agent password-reset WhatsApp message (`lib/agents.js`)** — it is sent
  to the agent, but triggered by an admin. Translating it would render it in
  the *admin's* language, not the recipient's.

### Verifying a change

Static scanning is not sufficient and repeatedly under-reported here: strings
hide in ternary branches, template literals, default parameters and multi-line
JSX that a line-based scan does not see. The check that actually settles it is
fetching each route twice with `cookie: NEXT_LOCALE=fr` and `=en` and looking
for French in the English render — that works on output, so the source shape
cannot fool it. `npm run build` catches neither an unbound `t` nor a missing
namespace; the two i18n tests above exist because of that.

## Testing

- **`npm test`** runs the unit tier: Node's built-in `node --test`, no test framework dependency, matching the engine's own hand-rolled `scripts/verify-pipeline.js` precedent. 102 tests, three of which (`i18n.test.js`, `i18n-namespaces.test.js`, `i18n-translator-binding.test.js`) guard the bilingual layer — see the FR/EN section above for why the build alone does not.
- Two flags carry the whole thing and are not optional: **`--conditions=react-server`** makes `import 'server-only'` a genuine no-op (that package exports a zero-byte file under that condition), which is what lets ~30 `lib/` modules be imported at all; and `tests/support/hooks.mjs` uses **`module.registerHooks`** to resolve the `@/` alias and retry extensionless specifiers with `.js` — Next resolves both implicitly, plain Node ESM resolves neither.
- The unit tier substitutes `lib/db.js` with a recording fake pool (`tests/support/fakePool.js`), which buys the assertion class that matters most here: **SQL text invariants**. `properties` has no row-level security, so the `status = 1 AND approve_status = 1` filter is the only thing keeping unapproved listings private — and a test comparing returned rows would pass just as happily with that filter deleted, as long as the fixture held no pending rows. `tests/unit/listings-sql.test.js` asserts on the emitted SQL instead, which cannot be fooled that way.
- **`npm run test:http` and `npm run test:chain` talk to live production data** and are gated behind an explicit `QA_ALLOW_PROD=1`. They are deliberately excluded from CI.
- CI (`.github/workflows/ci.yml`) runs both suites on push. Node 22 is in the engine matrix as **non-blocking**: the production VPS runs 22, and 8 photo webhook tests fail there while passing on 24, with byte-identical code and dependencies (verified by checksum against the deployed server). Production photo handling works on 22, so this is a harness discrepancy — tracked rather than hidden. eslint is non-blocking too, over 3 pre-existing `react-hooks/set-state-in-effect` errors in deliberate hydration-safety code.

## Agent growth toolkit (branch `feat/agent-growth-toolkit`)

- **Dashboard context is memoised per request.** `getAgentDashboardContext`
  is wrapped in React `cache()`; the layout and every page call it, and before
  the wrap each request did the work twice (four engine round trips).
- **Analytics read the rollup when it is fresh.** `lib/analytics.js`'s
  `isRollupFresh()` (≤30 min, `listing_stats_daily`, written by the engine's
  `listing-stats-rollup` job) routes per-listing totals, the trend chart and
  month deltas to the rollup, and falls back to raw events otherwise —
  including before `migrations/20260917_agent_dashboard_scale.sql` runs. UTC
  days, same as every other bucket here. The rolling "30 derniers jours" card
  stays on raw (indexed) events: a rolling window is not day-aligned.
- **"Visuel & partage"** (actions menu on Mes biens): `lib/listingShareCopy.js`
  (French caption — always French, it is read by the agent's customers),
  `lib/listingFlyer.js` + `app/compte/agent/biens/[id]/visuel/route.js`
  (1080×1080 PNG via `next/og`, ≤3 real photos fetched only from our hosts,
  Plus Jakarta Sans fetched from Google Fonts once per process with a
  default-face fallback). Images go through `sharp` (already a Next
  dependency): WebP → PNG/JPEG, since satori decodes neither WebP nor AVIF,
  EXIF rotation, since satori ignores orientation and a phone photo otherwise
  renders on its side, and a resize so three 8 MB photos aren't a 30 MB
  payload. sharp missing is survivable — a JPEG/PNG still renders, anything
  else is skipped.
  **The card is royal blue (`--blue`) and the QR code is gone**, both on an
  explicit product decision (2026-09-16): the caption under the image already
  carries the link, so the QR was a worse second route to the same page, and
  the space now holds the AGENT's own logo, name and phone (`loadAgentBrand`)
  so every share doubles as their marketing. No logo means their initials on a
  white card; no name and no logo means no brand block at all, never a Lukka
  Place mark passed off as the agent's. The phone appears only under the
  public listing page's own rule (verified AND direct routing not switched
  off). **Most agents have no image yet** — 7 of 10 in production — so the
  initials fallback is the common case until they upload one in Paramètres.
  - **The gold badge is earned, not decoration** (2026-09-16). It renders only
    for `agents.verification_level` of 'verified' / 'agency_partner' — the tier
    a team member sets from `/admin/verifications` after reviewing documents —
    and a 'standard' agent gets nothing rather than an unbacked trust mark.
    **Every production agent is 'standard' today, so no flyer shows it yet**;
    that is what makes it worth something to the agents who earn it. Gold is
    `#f59e0b` with INK text and check, not white: white on that gold is 2.1:1,
    under even the 3:1 bar for a graphic.
  - The photo seams are 6px of the white ground showing through (`GAP`; 2px
    read as a hairline at Status size). Under the price are two lines,
    "Appartement • 24 Novembre, Lingwala" then "2 chambres • 2 salles de bain"
    (`roomSpecs`, full words — the abbreviated one-line `compactSpecs` and the
    0.6-opacity photo watermark were both removed 2026-09-16 on product
    direction). The Lukka Place mark is the white roofline
    (`public/brand/icon-dark.png`, `loadPlatformMark`) set above the
    "Lukka Place lukkaplace.com" text — roof over name is the real lockup, and
    the full wordmark PNG would print the name twice. The WhatsApp glyph beside the phone is the same hand-rolled
    path `WhatsAppCTA.js` carries (lucide ships no brand marks), drawn as an
    `<img>` data URI because a missing glyph in the loaded face would render
    as a blank box.
  - **The caption is WhatsApp-formatted**: `*…*` bold on the purpose, place
    and price, and a `📞 *Contact agent*` line carrying the number — gated by
    `agentContactPhone`, the same verified/routing rule the listing page uses,
    so the caption can never publish a number the site itself refuses to show.
    The asterisks show literally outside WhatsApp; accepted, since that is
    where this text is posted.
  Ownership is `p.agent_id = $3` in SQL; `shareBlocker()` refuses pending,
  rejected, archived, under-offer and closed listings because the link points
  at a public page that would 404 or mislead. There is no web link that
  posts to a WhatsApp Status: the Web Share sheet with the image attached is
  the one-tap path, and the caption is copied first because WhatsApp drops
  text shared with an image to Status.
- **Marketing toolkit: graphics drawn in the browser** (2026-09-16). The share
  kit (`AgentListingShareKit`, tabs Visuel / Texte / Propriétaire) no longer
  asks the server for its image.
  - `getSharePackAction` sends a **share pack**
    (`lib/marketing/sharePackData.js`): the text already formatted, and
    same-origin `/_next/image?…&w=1080&q=75` photo URLs. Going through the
    optimiser means the canvas is never tainted and a phone decodes 1080px,
    not a 4000px original. Only hosts `remotePatterns` covers are sent.
  - `lib/marketing/layout.js` turns a pack into draw operations — pure, no
    DOM, unit-tested position by position.
  - `components/marketing/CanvasRenderer.js` paints them with Canvas 2D (not
    html2canvas, which cannot do `object-fit: cover`) and exports JPEG.
    Square 1080², Story 1080×1920, Landscape 1200×675 — native sizes, not 2×.
  - **The square reproduces the server flyer**: baselines use satori's
    half-leading model with Plus Jakarta Sans's own metrics (ascent 1.038,
    descent 0.222). Checked against the production PNG in the browser:
    vertical offset 0px on every text block, mean pixel difference 2.8/255.
    The one visible difference is the narrow space in "1 000 $", which the
    canvas draws and satori dropped.
  - **Export uses `toDataURL`, not `toBlob`.** In the app's browser pane
    every `toBlob` took ~1,050 ms at any size (540px, 2160px, even PNG) —
    Chromium defers it as an idle task — while `toDataURL` encoded the same
    JPEG in 32 ms. Measured warm, desktop: square 39 ms / 125 KB, story
    102 ms / 133 KB, landscape 33 ms / 90 KB, all under the 150 KB budget.
    No CPU throttling was available to test a phone profile.
  - **Offline**: `lib/sharePack.js` keeps the pack and the image Blobs in
    IndexedDB (`lukka-share-packs`, separate from the drafts database). With
    the server unreachable, the dialog draws from that copy and shows
    "Hors ligne — données du …", with a warning past 24 h, because an offline
    graphic can show an old price. A server answer of "not yours / gone" is
    never replaced by a stored copy. Verified with the dev server stopped:
    story drawn from IndexedDB in 175 ms. The dashboard page itself is not
    cached by the service worker, so this works in a dashboard that is
    already open, not from a cold start offline.
  - The server route `/compte/agent/biens/:id/visuel` stays as the square
    fallback when the browser cannot draw, online only. It now sends a
    mozjpeg q85 JPEG (106 KB) instead of satori's PNG (970 KB).
  - **Tagged links**: captions carry `?utm_source=` per way out
    (`SHARE_SOURCES`: wa_status / wa_message / partage_agent;
    rapport_proprietaire for the report). `lib/analyticsClient.js` now
    forwards the landing URL's `utm_source` — both endpoints accepted it but
    nothing sent it, so every tagged visit was stored as 'direct'. Listing
    pages declare their canonical URL so tagged variants are one page.
  - **Landlord report** (`getMandateReportAction`,
    `lib/marketing/mandateReport.js` + `mandateReportCopy.js`): views,
    WhatsApp taps, saves and visit requests for the last 7 whole UTC days
    against the 7 before, read the way the dashboard reads them
    (`listing_stats_daily` while fresh, raw events otherwise). Visit requests
    come from the engine; when it cannot answer they are `null` and print
    "non disponible", never 0. The card and the caption both say what the
    counts cover (page openings including the agent's own, taps, saves,
    requests via Lukka Place) and what they do not (calls and messages sent
    straight to the agent, people who saw a Status without opening the
    link). Live only — no offline report, since an old one shows the wrong
    week.
- **The agent dashboard on a phone** (reported from real 375px screens,
  2026-09-16). `.u-title-page` and `.u-stat` are 22px below 640px (they were
  28px, which alone pushed the header past the screen); agent pages are
  `px-3 py-4` and cards `p-4` until `sm`. Three layouts were structurally
  wrong rather than merely large, and each is fixed at its source:
  - `AgentPageHeader` puts the search, bell and action on ONE row under the
    title; its action group was `flex-none`, so its content width set the
    page width.
  - `AgentPortfolioBanner`'s two buttons stack full-width; they were a
    `flex-none` row wider than the screen, so "Voir ma page" was cut off.
  - **`.agent-listing-row` (app/globals.css) is the Mes biens row**: named
    grid areas on a phone, the seven-column table row at `lg`, with
    `.alr-main` / `.alr-stats` on `display: contents` so ONE markup serves
    both. It was a single `flex-wrap` line, which squeezed the title to
    nothing and left the price against the photo. GRID_COLS in
    `AgentListingsTable.js` must stay identical to the `lg` columns there.
  - The row menu takes `collisionPadding` with a 88px bottom so Radix keeps it
    clear of the fixed bottom nav, and the bulk bar sits at `bottom-20`.
  - The share dialog is `max-h-[88dvh]` with all four actions above the
    caption: at `92vh` on iOS Safari the last button sat under the browser
    toolbar and could not be reached.
- **Offline drafts** (`lib/offlineDrafts.js`, `CreateListingDialog`): fields
  AND photos in IndexedDB per agent key; a publish while offline (or one that
  dies on the network) is queued and re-sent when Mes biens is open and
  online, once across tabs (Web Locks), flagged `offline_replay` so
  `createListingAction` returns the existing listing
  (`findRecentOwnDuplicate`, same agent + title + price within 24h) instead of
  creating a second copy when only the response was lost. No service worker:
  a page closed offline sends on its next online visit. A server verdict is not
  a network failure — the draft is un-queued and the dialog reopens.
- **Verification tiers** (`lib/verificationLevels.js`, `lib/agentVerification.js`,
  `/admin/verifications`, settings card on `/compte/agent/parametres`):
  `agents.verification_level` standard / verified / agency_partner, derived
  `is_verified`, documents in a PRIVATE bucket opened only through an audited
  5-minute signed-URL route (`agents.manage`). Raising a level requires the
  approved documents it stands for; rejecting evidence lowers the level in the
  same transaction. **The green public check now means this tier, not
  `phone_verified_at`**, on `/agents`, `/agents/[id]`, `EnquiryCard` and
  `PropertyCard`; the profile meta line no longer prints "Agence partenaire ·
  Vérifiée" for every agent. Public reads use `to_jsonb(a) ->>
  'verification_level'` so they keep working before
  `migrations/20260917_agent_verification.sql` runs (a plain column reference
  500'd the homepage in local QA); swap to the column once it is applied
  everywhere. Setup: run that migration, then
  `node web/scripts/setup-verification-bucket.js --write`.
- **Known, not fixed here:** the agent dashboard layout still fails when the
  engine is unreachable (`listLeads` throws; confirmed locally), `/agents`
  (`getPublicAgents`) loads every agent unpaginated, Mes biens filters an
  unbounded listing array in memory, and `createListingAction` takes its
  commune/category allow-lists as arguments from the client.

## Espace Client at scale (`/compte/client/*`)

Built toward 100k customer accounts. Engine half: root CLAUDE.md, "Customer
side of requests and visits".

**Deploy order: run `migrations/20260918_customer_alert_preferences.sql`
(engine repo) before this web deploy.** It adds `alert_frequency`,
`last_alerted_at`, `customers.whatsapp_alerts_opted_out_at` and
`customer_favorites.note`. Every read goes through `to_jsonb(row) ->> '…'`, so
no page 500s without it, but saving a frequency, an opt-out or a note fails
(and says so) until it has run, and "weekly" alerts can arrive on consecutive
days.

- **Sessions are revocable.** `getCurrentCustomerId` →
  `resolveCustomerSession` compares the token's version with
  `customers.token_version`. Nothing compared it before, so logout-everywhere
  and both password resets ended no other session. A 401 from `/api/account/*`
  also clears the `lukka_logged_in` flag (`lib/customerApiResponse.js`).
- **Per-request memoisation** (React `cache()`): `getCurrentCustomerId`,
  `getCustomerById`, `listFavoriteIds`, `listSavedSearches`,
  `getPortalCustomer`, `getCustomerInquiries`. The tab badges use the
  engine's `GET /admin/leads/counts`, not the inquiry history.
- **Every tab has a `loading.js`** (`components/PortalSkeleton.js`); Favoris &
  Alertes streams its sub-tab under a keyed Suspense.
- **Instant removes with undo.** Favourites and alerts hide on tap; the toast
  (`components/Toast.js` now takes an `action`) offers "Annuler" through
  `restoreFavoriteAction` / `restoreSavedSearchAction`.
- **Ceilings** (`lib/accountLimits.js`): 200 favourites, 20 saved searches,
  enforced by a COUNT guard in the INSERT (soft by design). A 409 raises
  `ACCOUNT_LIMIT_EVENT` and `AccountLimitNotice` (site layout) says why.
  Alertes re-runs saved searches four at a time (`mapWithConcurrency`).
- **Multi-commune requests**: the form and edit dialog take up to
  `MAX_REQUEST_COMMUNES` (5, same as the engine); `parseLeadCommunes` reads
  them back.
- **The visit form prefills the account's number** via `GET /api/account/me`.
  Requests are found in the account by phone, so a differently typed number
  used to create a visit the account never showed.
- **Visits** (`messages/ViewingPanel.js`, `lib/viewingTimeline.js`): the real
  timeline from the engine's viewing row, computed server-side with the
  server clock. Cancel, accept a proposed slot, post-visit 👍/👎/agent absent
  and the reason all go through the engine. The WhatsApp "reschedule/cancel"
  links that changed nothing are gone.
- **Alerts** (`lib/searchAlertSweep.js`): chunked, only new approved listings,
  never a widened `getListings` result, verified and not-opted-out numbers
  only, a session message when `SEARCH_ALERT_TEMPLATE` is unset (it no longer
  defaults to an unapproved name). Every message ends with the link to stop it.
  Per-alert frequency and rename on the Alertes tab; the account-wide switch on
  Mon profil.
- **Favourites**: shown in saved order, private notes, "Partager ma sélection"
  (the same `/favoris?ids=` link), and a count of saved listings no longer
  online instead of a silently shorter list.
- **"Trouver pour moi" prefills from the latest saved search**
  (`lib/requestPrefill.js`) and says so; nothing outside the query is guessed.
- **English**: the portal's hardcoded French (dates included) goes through the
  dictionary now; `customer-portal-polish.test.js` lists the phrases that must
  not come back.
- **`/compte/alertes` and `/compte/demandes` are redirects** into the portal;
  they were drifting copies. "Mot de passe oublié" goes to `/mot-de-passe-oublie`.
- **Still open:** alert messages are session messages until a template is
  approved (the 24h window applies); there is no STOP keyword handling — the
  engine does not own `customers`, so opting out is the link in each message;
  customer inquiry history is still capped at the latest 100 leads.

## Deployment

- PM2 process name `lukka-place-web`, port `3002` (the engine owns `3000` on the same VPS). Config: `ecosystem.config.js`.
- **Production data lives outside the repo directory**: the engine reads `DB_PATH=/var/data/lukka_place.db` and `UPLOADS_DIR=/var/data/uploads` from its `.env`. The `lukka_place.db` sitting in the engine's own directory on the VPS is a stale, empty leftover — do not read it and conclude the pipeline is broken.
- **`next build` takes ~2 minutes on this VPS**, measured 2026-09-12 (`✓ Compiled successfully in 110s`, Next 16.3.1 with Turbopack). This note used to say ~23 minutes and was stale — that figure predates the Turbopack build. Still run it detached (`nohup`, writing to a log with a sentinel line) and poll rather than holding an SSH session open, and still only `pm2 restart` *after* the build reports success, so a failed build never takes the site down.
- Traefik routing lives outside this repo, on the VPS at `/docker/n8n/dynamic/lukkaplace.yml` (file-provider dynamic config, same pattern as `engine.lukkaplace.com`'s router — `host.docker.internal:3002`).
- Deploy = tar (excluding `node_modules`, `.next`, `.env.local`) → scp → extract over the existing `/var/www/lukka-place-web` → full `npm install` → `npm run build` → `pm2 restart lukka-place-web --update-env`.
- `.env.local` on the VPS is hand-maintained, not part of the deploy archive — don't overwrite it by including it in the tarball.

@AGENTS.md
