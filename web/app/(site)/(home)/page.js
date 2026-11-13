import Hero from '@/components/Hero';
import { getHeroSettings } from '@/lib/cmsSettings';
import FeaturedListings from '@/components/FeaturedListings';
import SavedListings from '@/components/SavedListings';
import ValueProposition from '@/components/ValueProposition';
import RecentlyViewed from '@/components/RecentlyViewed';
import NewProjectsStrip from '@/components/projects/NewProjectsStrip';
import HomeDiscovery from '@/components/HomeDiscovery';
import HomeAlertBand from '@/components/HomeAlertBand';
import HomeMarketBand from '@/components/HomeMarketBand';
import { cachedFeaturedListings, cachedListingsTotal, cachedLiveListingsCount, cachedPopularCommunes, cachedPropertyTypeFacets, cachedWeeklyNewCount } from '@/lib/listingsCached';
import { getSavedHomeSection } from '@/lib/savedHome';
import { HERO_DEFAULT_TAB, HERO_TRANSACTION_BY_TAB } from '@/lib/constants';
import JsonLd from '@/components/seo/JsonLd';
import { organizationSchema, socialProfiles, websiteSchema } from '@/lib/seoSchema';
import { getSeoSettings, getSocialLinks } from '@/lib/siteSettings';
import { getT, localizedAlternates } from '@/lib/i18n/server';
import { mergeSocialLinks, seoMetadata } from '@/lib/siteSettingsRules';
import AppHomeTop from '@/components/AppHomeTop';
import { communeFromSlug, communeSlug } from '@/lib/seoPages';
import { isAppRequest } from '@/lib/appMode';
import { getCurrentCustomerId, listSavedSearches } from '@/lib/customers';

/**
 * The homepage, section for section as web/Design/Landing's "Lukka Place —
 * Landing refondue" screen defines it: hero photograph, the floating search
 * panel (which now carries the commune row, with real per-commune counts,
 * as its own bottom tier),
 * "Nouveautés vérifiées à Kinshasa" as two rows of four, and the "Notre
 * approche" band — which is where the page ends, into the footer and its
 * agency band.
 *
 * The refonte's three-item proof row ("Chaque annonce contrôlée par un
 * humain avant publication" / "Une seule ligne WhatsApp..." / "Prix
 * affichés tels quels...") is deliberately NOT built: it was cut on the
 * client's own instruction. The mockup puts it directly under the search
 * panel, in the gap left by the royal seller strip that moved down to the
 * footer band; nothing replaces it, the commune row simply follows the
 * panel. All three claims are still made — at length, and in the section
 * that exists to make them — by ValueProposition below.
 *
 * Four sections were removed earlier, because the design carries none of
 * them: ExploreCommunes ("Explorez par commune" / Quartiers),
 * TransactionTypesGrid, CurrencyBridge, and TrustSection ("Qui est
 * derrière" / "Une seule équipe, un seul numéro"). The components still
 * exist and nothing else imports them — they are simply off the homepage.
 *
 * Three real, DB-derived values are threaded into the hero, none of them
 * decorative:
 *   - getPropertyTypeFacets() feeds the "Type de bien" select — options
 *     with real counts, the same source FilterBar.js's own pill on
 *     /listings uses, so the hero never offers a type with zero results.
 *   - getPopularCommunes() feeds the panel's own commune quick-pills.
 *   - getListings().total is the real approved-listing total behind the
 *     "Rechercher (N biens)" CTA on first paint, scoped to the transaction
 *     type the panel OPENS on (Louer -> location) rather than left
 *     unfiltered. Unscoped it reported 31 (30 rentals + 1 sale) under an
 *     active Louer tab whose real count is 30 — the button over-reported
 *     until the visitor touched a control and the client refetch corrected
 *     it. The tab and the mapping both come from lib/constants.js so the
 *     server count and the client's default tab cannot drift. `limit: 1`
 *     keeps the row payload minimal; the COUNT query getListings() runs
 *     internally is unaffected by limit. From there the panel refetches
 *     /api/listings/count as filters change — same endpoint, same query.
 * The location field sources its own suggestions from
 * /api/locations/autocomplete, so nothing needs threading through for it.
 *
 * **Mobile density pass.** The three sections below are unchanged in
 * composition but not in rhythm: FeaturedListings and ValueProposition each
 * carry a tighter mobile band (`sm:` restores the previous desktop values
 * verbatim, so only narrow viewports move), and FeaturedListings lost its
 * `lead` line, which restated its own title and eyebrow. The one duplicate
 * deliberately left standing is the hero's subhead — "Annonces relues par notre équipe, prix
 * affichés & contact direct sur WhatsApp." — against ValueProposition's
 * three numbered props, which are the same three claims. That is a promise
 * made once above the fold and then evidenced at length in the section that
 * exists to evidence it, not a section repeating itself; cutting either one
 * would leave the page either opening with no promise or closing with no
 * argument. The rest of the reclaimed height comes from PropertyCard, which
 * dropped its reserved two-line description block (see PropertyCard.js).
 *
 * **The second section is now personal when it can be.** For a signed-in
 * visitor who has saved at least one property, "Sélection de la Semaine"
 * (FeaturedListings) is replaced outright by their own "Biens Enregistrés"
 * shelf — not stacked above it, since two eight-card listing
 * sections back to back is the same page twice. The swap is decided by
 * lib/savedHome.js's getSavedHomeSection(), which returns null for a
 * signed-out visitor and for a signed-in one with an empty shelf — this
 * page renders FeaturedListings in exactly those two cases. The decision is
 * data rather than a nullable section so the choice can be made before the
 * markup exists; there is no path where both appear or both vanish. See
 * components/SavedListings.js for why the empty shelf falls back rather
 * than rendering an empty personalised section.
 *
 * It joins the existing Promise.all rather than awaiting after it: the
 * hero's three values and the visitor's shelf are independent reads, and
 * serialising them would add a whole round trip to the signed-in homepage
 * for nothing. Reading the session cookie costs no static rendering here —
 * this route was already dynamic for the locale cookie alone (see
 * lib/i18n/config.js).
 *
 * **Landing pass (2026-11-04).** On a phone the search card folds Ville,
 * Type and Budget behind "Plus de critères" (SearchBar.js), so "Voir N
 * biens" and the first listing photos come up the screen; the hero carries
 * "N nouveaux biens en 7 jours" (a real count, nothing at 0); and
 * HomeAlertBand, after the listings, says what an account is for (a WhatsApp
 * alert on commune + budget, signup keeping the search) beside the
 * no-account "Trouver pour moi". web/CLAUDE.md, "Landing pass".
 *
 * **Below the search, decluttered (later the same day, from the approved
 * mockup).** One section style (HomeSectionHeader: title + link, no eyebrow,
 * no borders around sections); "Récemment consultés" is a slim strip from
 * two listings up; the alert band is one royal band whose form opens on tap;
 * collections, property types and videos are one "Explorer" section
 * (PropertyTypeTiles is gone); the price guides are shown as figures
 * (HomeMarketBand — the Lukka Index panel beside them was removed the same
 * day, owner: not needed for now); "Notre approche" is three unboxed points.
 * web/CLAUDE.md, "Homepage below the search".
 *
 * CommuneShortcuts is no longer rendered here. It was a row of commune
 * pills sitting immediately under the search panel; the panel now carries
 * that row itself, where a tap FILLS the search field instead of navigating
 * straight to /listings — which is the more useful of the two, since it
 * composes with the transaction/type/budget already staged above it rather
 * than discarding them. Two visually identical commune rows stacked on top
 * of each other was the alternative. The component still exists and nothing
 * else imports it, same as the four other sections listed above.
 */
/*
 * The homepage's own title and description name what people search for
 * ("maison à louer à Kinshasa"); the site-wide default ("L'immobilier partout
 * en RDC") stays the fallback for pages without their own (2026-11-10, SEO
 * pass: the homepage ranked for "luka place" and little else). A title or
 * description saved on /admin/cms ("Optimisation SEO & Meta") still wins.
 */
export async function generateMetadata() {
  const t = await getT();
  const seo = seoMetadata(await getSeoSettings(), t.locale, {
    title: t('home.seoTitle'),
    description: t('home.seoDescription'),
  });
  return {
    title: seo.title,
    description: seo.description,
    alternates: await localizedAlternates('/'),
  };
}

/** The signed-in customer's latest saved search, for "pick up where you left off"; null otherwise. */
async function latestSavedSearch() {
  try {
    const id = await getCurrentCustomerId();
    if (!id) return null;
    return (await listSavedSearches(id))[0] || null;
  } catch {
    return null;
  }
}

/**
 * Inside the store app (lib/appModeRules.js) the home page is the app
 * design's "Search home" (components/AppHomeTop.js): the live listing count,
 * the search card, the customer's latest saved search and the newest
 * listings. The website's marketing sections and the SEO markup are left
 * out; the tab bar replaces the footer.
 */
async function AppHomePage({ propertyTypes, communes, total, heroImage }) {
  const [liveCount, savedSearch, featured] = await Promise.all([
    cachedLiveListingsCount().catch(() => 0),
    latestSavedSearch(),
    // The same newest-first 60-second copy "Sélection de la semaine" reads.
    cachedFeaturedListings().catch(() => ({ data: [] })),
  ]);
  return (
    <AppHomeTop
      liveCount={liveCount}
      propertyTypes={propertyTypes}
      // Each of Kinshasa's 24 communes carries the slug of its guide (/commune/<slug>).
      communes={communes.map((c) => ({ ...c, guideSlug: communeFromSlug(communeSlug(c.commune)) === c.commune ? communeSlug(c.commune) : null }))}
      initialCount={total}
      savedSearch={savedSearch ? { query: savedSearch.query, label: savedSearch.label } : null}
      listings={featured.data || []}
      heroImage={heroImage}
    />
  );
}

export default async function HomePage() {
  const [propertyTypes, communes, { total }, saved, heroImage, weeklyNew, app] = await Promise.all([
    // 60-second copies (lib/listingsCached.js): counts and facets, not results.
    cachedPropertyTypeFacets(),
    cachedPopularCommunes(8),
    cachedListingsTotal(HERO_TRANSACTION_BY_TAB[HERO_DEFAULT_TAB]),
    getSavedHomeSection(),
    getHeroSettings(),
    // "N nouveaux biens cette semaine" on the hero; a failed count shows nothing.
    cachedWeeklyNewCount().catch(() => 0),
    isAppRequest(),
  ]);
  if (app) return <AppHomePage propertyTypes={propertyTypes} communes={communes} total={total} heroImage={heroImage} />;
  // The profiles the footer shows, so Google ties them to the site (sameAs).
  const profiles = mergeSocialLinks(await getSocialLinks(), socialProfiles());

  return (
    <>
      {/* Who Lukka Place is and the sitelinks search box — lib/seoSchema.js. */}
      <JsonLd data={{ '@context': 'https://schema.org', '@graph': [organizationSchema({ profiles }), websiteSchema()] }} />
      <Hero propertyTypes={propertyTypes} communes={communes} initialCount={total} image={heroImage} weeklyNew={weeklyNew} />
      {/* One slim line of the listings this browser opened, from two up; nothing on a first visit. */}
      <RecentlyViewed variant="strip" minItems={2} />
      {saved ? <SavedListings listings={saved.listings} /> : <FeaturedListings />}
      {/* Why an account is worth having (an alert) and the no-account request: one royal band. */}
      <HomeAlertBand />
      <NewProjectsStrip />
      {/* Explorer: collections as photo tiles, then one row of type chips (same facets as the hero dropdown). */}
      <HomeDiscovery propertyTypes={propertyTypes} />
      {/* The price guides as figures. */}
      <HomeMarketBand />
      <ValueProposition />
    </>
  );
}
