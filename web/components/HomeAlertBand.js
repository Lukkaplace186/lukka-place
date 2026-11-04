import Link from 'next/link';
import { ArrowRight, BellRing, Search } from 'lucide-react';
import HomeAlertPicker from './HomeAlertPicker';
import { cachedPopularCommunes } from '@/lib/listingsCached';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { homeAlertCommunes } from '@/lib/homeAlert';
import { getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The homepage's two ways to be told rather than to keep looking, side by
 * side (2026-11-04). Before, nothing on the page said what an account is
 * for, and "Trouver pour moi" was only reachable from an empty search.
 *
 *  1. An alert: commune + budget → WhatsApp when a matching listing is
 *     published (the daily search-alerts sweep). Needs an account, and the
 *     signup keeps the search (QueryAlertButton).
 *  2. "Trouver pour moi": no account — the request goes to the commune's
 *     agencies (/trouver-pour-moi, GuestRequestForm).
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
    <section className="bg-canvas-alt">
      <div className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <h2 className="u-reveal-in-view u-h2 text-ink">{t('home.alertBand.heading')}</h2>
        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-6">
          <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
            <div className="mb-5 flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-tint text-blue-deep">
                <BellRing strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-[1.0625rem] font-semibold leading-snug text-ink">{t('home.alertBand.alertTitle')}</h3>
                <p className="mt-1 text-[0.9375rem] leading-relaxed text-ink-70">{t('home.alertBand.alertLead')}</p>
              </div>
            </div>
            <HomeAlertPicker popular={withListings} others={others} />
          </div>

          <div className="flex flex-col rounded-2xl border border-line bg-surface p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-tint text-green-deep">
                <Search strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-[1.0625rem] font-semibold leading-snug text-ink">{t('home.alertBand.requestTitle')}</h3>
                <p className="mt-1 text-[0.9375rem] leading-relaxed text-ink-70">{t('home.alertBand.requestLead')}</p>
              </div>
            </div>
            <Link
              href="/trouver-pour-moi"
              className="u-press mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-ink-25 bg-surface px-4 text-[0.9375rem] font-semibold text-ink transition-colors hover:border-ink-45 lg:mt-auto"
            >
              {t('home.alertBand.requestButton')}
              <ArrowRight strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
