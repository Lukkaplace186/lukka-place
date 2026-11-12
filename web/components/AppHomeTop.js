'use client';

import Link from '@/components/IntentLink';
import { m } from 'motion/react';
import { Bookmark, ChevronRight, Sparkles } from 'lucide-react';
import SearchBar from './SearchBar';
import AppListingCard from './app/AppListingCard';
import { ChartBars, ChartContainer } from './ui/chart';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/client';
import { localizeHref } from '@/lib/localePaths';

// One orchestrated entrance, the screen's only unprompted motion: the title,
// then the line under it, then the search card settling onto the band.
// Transform only, never opacity (the same rule as the website hero's
// .u-hero-settle): the server HTML is what a phone on 3G shows until the
// JavaScript arrives, and opacity 0 there would be a blank search screen.
const rise = {
  hidden: { y: 18 },
  shown: (i = 0) => ({ y: 0, transition: { delay: 0.06 * i, type: 'spring', stiffness: 260, damping: 30 } }),
};

/**
 * The app's home screen (app mode, app/(site)/(home)/page.js), from the app
 * design's "Search home": a royal band with the serif title and the real
 * number of live listings, the site's search card on it, "pick up where you
 * left off" (the customer's latest saved search), then the newest listings.
 *
 * Every figure is real: `liveCount` is the public listing count, the saved
 * search is the customer's own, the cards are live listings. Each part
 * renders nothing when its data is missing.
 */
export default function AppHomeTop({
  liveCount = 0,
  propertyTypes = [],
  communes = [],
  initialCount = null,
  savedSearch = null,
  listings = [],
}) {
  const t = useT();
  const locale = useLocale();

  return (
    <>
      <section className="bg-blue px-5 pb-24 pt-5 text-white">
        <m.h1 variants={rise} initial="hidden" animate="shown" custom={0} className="u-app-serif text-[2.25rem] leading-[1.05]">
          {t('appShell.home.title')}
        </m.h1>
        {liveCount > 0 ? (
          <m.p variants={rise} initial="hidden" animate="shown" custom={1} className="mt-2 text-[0.9375rem] text-white/80">
            {t('appShell.home.count', { count: liveCount })}
          </m.p>
        ) : null}
      </section>

      <m.div variants={rise} initial="hidden" animate="shown" custom={2} className="relative z-20 -mt-20 px-4">
        <SearchBar propertyTypes={propertyTypes} communes={communes} initialCount={initialCount} />
      </m.div>

      <div className="space-y-7 px-4 pb-6 pt-7">
        {savedSearch ? (
          <section>
            <h2 className="mb-2.5 text-[1.0625rem] font-bold text-ink">{t('appShell.home.continue')}</h2>
            <Link
              href={localizeHref(`/listings?${savedSearch.query || ''}`, locale)}
              className="u-press flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 active:bg-canvas-alt"
            >
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-blue-tint text-blue">
                <Bookmark strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold text-ink">
                {savedSearch.label || t('appShell.home.continueFallback')}
              </span>
              <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 flex-none text-ink-45" />
            </Link>
          </section>
        ) : null}

        {listings.length ? (
          <section>
            <div className="mb-2.5 flex items-baseline justify-between">
              <h2 className="text-[1.0625rem] font-bold text-ink">{t('appShell.home.latest')}</h2>
              <Link href={localizeHref('/listings', locale)} className="text-[0.875rem] font-semibold text-blue">
                {t('appShell.home.seeAll')}
              </Link>
            </div>
            <div className="space-y-4">
              {listings.map((listing, index) => (
                <AppListingCard key={listing.id} listing={listing} priority={index === 0} />
              ))}
            </div>
          </section>
        ) : null}

        {/* Où chercher: the live listing count per commune (the search card's own
            popular communes), each row opening that commune's results. */}
        {communes.length >= 3 ? (
          <section>
            <h2 className="mb-2.5 text-[1.0625rem] font-bold text-ink">{t('appShell.home.whereTitle')}</h2>
            <ChartContainer caption={t('appShell.home.whereCaption')}>
              <ChartBars
                data={communes.slice(0, 6).map((c) => ({
                  label: c.commune,
                  value: c.count,
                  href: localizeHref(`/listings?commune=${encodeURIComponent(c.commune)}`, locale),
                }))}
                highlight={communes[0]?.commune}
              />
            </ChartContainer>
          </section>
        ) : null}

        <Link
          href={localizeHref('/trouver-pour-moi', locale)}
          className="u-press flex items-center gap-3 rounded-2xl bg-blue-tint p-4 active:bg-canvas-alt"
        >
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-blue text-white">
            <Sparkles strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9375rem] font-bold text-ink">{t('appShell.home.findTitle')}</span>
            <span className="block text-[0.8125rem] text-ink-70">{t('appShell.home.findText')}</span>
          </span>
          <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 flex-none text-blue" />
        </Link>
      </div>
    </>
  );
}
