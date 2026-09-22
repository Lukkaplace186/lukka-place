import SavedListingsRail from './SavedListingsRail';
import SectionHeading from './SectionHeading';
import { getT } from '@/lib/i18n/server';

/**
 * "Mes biens enregistrés" — the homepage's signed-in variant of
 * FeaturedListings, and the reason HomePage branches at all.
 *
 * Purely presentational: whether this section should exist at all is
 * decided upstream by lib/savedHome.js's getSavedHomeSection(), which is
 * also what the page uses to fall back to FeaturedListings. See that
 * module's doc comment for why the decision is data rather than a nullable
 * render.
 *
 * The empty shelf deliberately does NOT reach here. Hiding "Sélection de la
 * semaine" for someone who has saved nothing would trade a full section of
 * real listings for an empty shelf and a prompt — strictly less useful on
 * the one page whose job is to get a visitor into the inventory. The
 * personalised section appears the moment there is something personal to
 * put in it.
 *
 * Same band rhythm as FeaturedListings (`pt-8 pb-5` mobile, `sm:` restoring
 * the desktop values) so swapping one for the other never moves the sections
 * above or below it. The two must be changed together: this component
 * replaces that one for a signed-in visitor, so a padding set on only one
 * of them moves the section below depending on who is looking.
 *
 * "Voir tout" points at /compte/client, the Espace Client's "Favoris &
 * Alertes" tab — the real, working home of a signed-in visitor's saved
 * properties in this app. /compte/client/favoris is a redirect into it and
 * would just add a hop.
 */
export default async function SavedListings({ listings, firstName }) {
  const t = await getT();

  return (
    /* Carries the same ground as FeaturedListings, and must: this component
       REPLACES that one for a signed-in visitor with saved properties, so a
       fill set on only one of the two gives the homepage two different
       grounds depending on who is looking at it. Band rhythm note above
       applies to the fill too. */
    <section className="bg-canvas">
      <div className="mx-auto max-w-[1600px] px-4 pt-8 pb-5 sm:px-6 sm:pt-14 sm:pb-10 lg:px-8">
        <SectionHeading
          eyebrow={firstName ? t('home.saved.eyebrow', { name: firstName }) : t('home.saved.eyebrowAnonymous')}
          title={t('home.saved.title')}
          lead={t('home.saved.lead', { count: listings.length })}
          href="/compte/client"
          linkLabel={t('home.saved.viewAll')}
          className="mb-6 sm:mb-10"
          eyebrowClassName="u-eyebrow-ink"
        />
        <SavedListingsRail listings={listings} />
      </div>
    </section>
  );
}
