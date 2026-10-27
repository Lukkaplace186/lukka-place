# English pages for search engines (`/en/…`) — plan

Status: proposed 2026-10-24, not built. Owner decision needed before work starts.

## Why

Today the language is a cookie (`NEXT_LOCALE`, `lib/i18n/config.js`). Every URL
has one canonical version, and Googlebot sends no cookie, so **Google has only
ever seen the French site**. Someone searching in English — "apartment for rent
Kinshasa", "house for sale Gombe" — has no English page of ours to match. That
audience is the diaspora and the expat / NGO / embassy market: high budgets, and
currently served by expat.com and Expedia.

## What we build

### 1. English URLs, French ones unchanged

French stays at the root with no prefix, so every link already shared and
every page already indexed keeps working.

| French (unchanged) | English (new) |
| --- | --- |
| `/` | `/en` |
| `/location` | `/en/rent` |
| `/vente` | `/en/buy` |
| `/location/appartements/gombe` | `/en/rent/apartments/gombe` |
| `/vente/terrains/lubumbashi` | `/en/buy/land/lubumbashi` |
| `/listings/428` | `/en/listings/428` |
| `/guides/<slug>` | `/en/guides/<english-slug>` |
| `/agents/37` | `/en/agents/37` |
| `/a-propos`, `/contact` | `/en/about`, `/en/contact` |

Type slugs in English: apartments, houses, land, plots, villas, compounds,
studios, rooms, farms, duplexes, penthouses, shops, buildings, warehouses,
offices, commercial-property. Commune and city slugs are the same in both
languages (they are place names). All of it is one table in
`lib/seoPages.js`, next to the French one, with the same collision test.

Accounts, the agent portal, `/admin`, `/favoris` and `/listings` search stay
cookie-based with no `/en` copy: nobody searches Google for them.

### 2. One set of pages, two languages — no copied routes

- `middleware.js` gains `/en/:path*` in its matcher. For those paths it
  **rewrites** to the French route (`/en/rent/apartments/gombe` →
  `/location/appartements/gombe`) and sets a request header
  `x-lukka-locale: en`.
- `lib/i18n/server.js` `getI18n` reads that header **before** the cookie. So
  the same page component renders in English, and the address bar keeps the
  `/en` URL.
- No route files are duplicated, so no page drifts out of step with its
  English twin.

### 3. Tell Google the two versions belong together (hreflang)

Every indexable page's `generateMetadata` returns:

```js
alternates: {
  canonical: <this language's URL>,
  languages: { fr: <French URL>, en: <English URL>, 'x-default': <French URL> },
}
```

A helper `localeAlternates(frPath)` in `lib/seoPages.js` builds this, so every
page does it the same way. The sitemap lists both URLs per page with the same
`alternates.languages` (Next's sitemap supports it).

### 4. Links stay in the reader's language

On an English page, every internal link must point at its `/en` twin, or
Google crawls the English site once and lands back in French. A
`localizedHref(href, locale)` helper (French path → English path through the
slug table, unchanged when there is no English page) is applied to:

- **Site chrome:** Header, Footer and Breadcrumb.
- **Search pages and listing pages:** the landing page link lists and listing
  cards (`PropertyCard` and the three card designs).
- **Content:** guide links.

The FR | EN toggle on a public page navigates to the other language's URL
(instead of only setting the cookie). It still sets the cookie, so accounts
follow.

### 5. Content

- **Interface text:** already translated (`en.json`).
- **Listing titles, descriptions, quartiers and agency names:** stay as the
  agent wrote them, in French. This is the existing rule ("real data is not
  translated"). The English `<title>` and description are built from
  structured facts by `listingMetaTitle` with the English translator: "2-bedroom
  apartment for rent in Kalamu — $550 / month".
- **Guides:** the five French guides need English versions written and
  reviewed by a person. This is the only new copy. Add 2–3 English-first guides
  for the expat audience: renting as an expat in Kinshasa, safe neighbourhoods,
  and paying a deposit from abroad.

### 6. Phases

1. Slug table, middleware rewrite, header-based locale, hreflang on landing
   pages, listing pages and the home page. Sitemap with both languages. Tests:
   the slug round trip, no collisions, and each page's hreflang pair pointing
   at each other.
2. Link localisation across the chrome, cards and landing pages. Language
   toggle navigation.
3. English guides (copy work, owner review).

Phases 1 and 2 ship together: English pages whose links fall back into
French are worse than no English pages. Estimate: about 2–3 days of build and
test, plus the guide copy.

### 7. How we'll know it worked

In Google Search Console (which must be set up first: see the SEO audit),
filter Performance by page `/en/`. Expect impressions within 2–4 weeks of
indexing, for queries like "apartment for rent kinshasa".

## Risks

- **Thin English pages:** the listing text is French. Mitigation: the
  structured English title, description and facts carry the page, and hreflang
  marks it as a translation, not a duplicate.
- **The locale header must never leak to the French URL.** The middleware sets
  it only on `/en` paths and strips an incoming one on every other request.
- **The rewrite makes `/en` pages dynamic**, as every cookie-reading page
  already is. No change in caching.
