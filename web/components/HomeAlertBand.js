import Link from '@/components/LocaleLink';
import { ArrowRight, BellRing } from 'lucide-react';
import HomeAlertPicker from './HomeAlertPicker';
import HomeAlertReveal from './HomeAlertReveal';
import { cachedPopularCommunes } from '@/lib/listingsCached';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { homeAlertCommunes } from '@/lib/homeAlert';
import { getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The homepage's two ways to be told rather than to keep looking
 * (2026-11-04):
 *
 *  1. An alert: commune + budget → WhatsApp when a matching listing is
 *     published (the daily search-alerts sweep). Needs an account, and the
 *     signup keeps the search (QueryAlertButton).
 *  2. "Trouver pour moi": no account — the request goes to the commune's
 *     agencies (/trouver-pour-moi, GuestRequestForm).
 *
 * Landing pass (same day, from the approved mockup): one slim royal band
 * with two buttons instead of two bordered cards holding a full form — the
 * form was a second search panel in the middle of the page. "Créer une
 * alerte" opens the same picker (HomeAlertReveal), on a white panel inside
 * the band; "Décrire ma recherche" goes straight to the request form.
 *
 * Both promises are what those features already do; nothing new is claimed.
 * Kinshasa communes only (the request form's own list).
 */
export default async function HomeAlertBand() {
  const t = await getT();
  const [popular, hierarchy] = await Promise.all([
    cachedPopularCommunes(40).catch(() => []),
    getLocationHierarchyWithFallback().catch(() => ({ communes: [] })),
  ]);
  const { popular: withListings, others } = homeAlertCommunes(popular, hierarchy.communes || []);
  if (withListings.length === 0 && others.length === 0) return null;

  return (
    <section className="bg-blue-deep text-white">
      <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <HomeAlertReveal
          openLabel={t('home.alertBand.open')}
          closeLabel={t('home.alertBand.close')}
          intro={(
            <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4 sm:items-center">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/12 sm:h-11 sm:w-11">
                <BellRing strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[1.0625rem] font-bold leading-snug sm:text-[1.125rem]">{t('home.alertBand.heading')}</h2>
                <p className="mt-1 max-w-2xl text-[0.875rem] leading-normal text-white/80 sm:text-[0.9375rem]">{t('home.alertBand.lead')}</p>
              </div>
            </div>
          )}
          secondary={(
            <Link
              href="/trouver-pour-moi"
              className="u-press inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border-[1.5px] border-white/50 px-5 text-[0.9375rem] font-semibold text-white transition-colors hover:border-white hover:bg-white/10"
            >
              {t('home.alertBand.requestButton')}
              <ArrowRight strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-4 w-4" />
            </Link>
          )}
        >
          <HomeAlertPicker popular={withListings} others={others} />
        </HomeAlertReveal>
      </div>
    </section>
  );
}
