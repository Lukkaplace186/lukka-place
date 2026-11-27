import { BellRing, Check } from 'lucide-react';
import HomeAlertPicker from '@/components/HomeAlertPicker';
import SignupPromptBeacon from '@/components/SignupPromptBeacon';
import { cachedPopularCommunes, cachedWeeklyNewCount } from '@/lib/listingsCached';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { homeAlertCommunes } from '@/lib/homeAlert';
import { getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

export async function generateMetadata() {
  const t = await getT();
  return {
    title: t('listings.alertLanding.metaTitle'),
    description: t('listings.alertLanding.lead'),
    alternates: { canonical: '/alertes-whatsapp' },
    // A one-screen form for ads and shared links, not a page to rank.
    robots: { index: false, follow: true },
  };
}

const PERKS = ['listings.alertLanding.perkFree', 'listings.alertLanding.perkNoPassword', 'listings.alertLanding.perkStop'];

/**
 * "Recevez les nouveaux biens sur WhatsApp" on one screen (2026-11-24): the
 * page an ad can link to when the goal is accounts rather than browsing. Louer
 * ou Acheter, a commune, a budget, then the same QueryAlertButton as the
 * homepage band — "Continuer avec WhatsApp" for a guest, and the alert is
 * saved when they land on its results signed in. Funnel entry 'alert_landing'.
 *
 * Only real figures: the communes' live counts and the week's new listings
 * (nothing shown when that count fails or is zero).
 */
export default async function AlertLandingPage() {
  const t = await getT();
  const [popular, hierarchy, weeklyNew] = await Promise.all([
    cachedPopularCommunes(40).catch(() => []),
    getLocationHierarchyWithFallback().catch(() => ({ communes: [] })),
    cachedWeeklyNewCount().catch(() => 0),
  ]);
  const { popular: withListings, others } = homeAlertCommunes(popular, hierarchy.communes || []);
  const canPick = withListings.length > 0 || others.length > 0;

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-5 u-lift sm:p-8">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-tint text-blue-deep">
          <BellRing strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="u-title-section mt-3 text-ink">{t('listings.alertLanding.title')}</h1>
        <p className="mt-1 text-sm text-ink-70">{t('listings.alertLanding.lead')}</p>
        {weeklyNew > 0 ? (
          <p className="mt-2 text-[0.8125rem] font-semibold text-green-deep">{t('home.hero.weeklyNew', { count: weeklyNew })}</p>
        ) : null}
        <ul className="mt-4 flex flex-col gap-1.5">
          {PERKS.map((key) => (
            <li key={key} className="flex items-start gap-2 text-[0.8125rem] text-ink-70">
              <Check strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-green-deep" aria-hidden="true" />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5">
          {canPick ? (
            <HomeAlertPicker popular={withListings} others={others} entry="alert_landing" />
          ) : (
            <p className="text-sm text-ink-70" role="alert">{t('listings.guestRequest.errors.send')}</p>
          )}
        </div>
      </div>
      <SignupPromptBeacon entry="alert_landing" />
    </div>
  );
}
