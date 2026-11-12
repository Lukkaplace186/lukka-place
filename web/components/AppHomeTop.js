'use client';

import Link from '@/components/IntentLink';
import { m } from 'motion/react';
import { Bell, ChevronRight, CircleDollarSign, Sparkles } from 'lucide-react';
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
 * design's "Search home", tightened 2026-11-12 from the owner's references:
 * a short royal band with the title and the real number of live listings,
 * the compact search card on it, the popular communes as one row, three
 * shortcut rows (saved searches and alerts, "Trouver pour moi", the price
 * guide), then the newest listings. The title is the site's sans (DESIGN.md:
 * no serif).
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
      <section className="bg-blue px-5 pb-16 pt-1 text-white">
        <m.h1 variants={rise} initial="hidden" animate="shown" custom={0} className="u-title-page">
          {t('appShell.home.title')}
        </m.h1>
        {liveCount > 0 ? (
          <m.p variants={rise} initial="hidden" animate="shown" custom={1} className="mt-1 text-[0.875rem] text-white/80">
            {t('appShell.home.count', { count: liveCount })}
          </m.p>
        ) : null}
      </section>

      <m.div variants={rise} initial="hidden" animate="shown" custom={2} className="relative z-20 -mt-12 px-4">
        <SearchBar propertyTypes={propertyTypes} communes={communes} initialCount={initialCount} compact />
      </m.div>

      {/* The popular communes, out of the card: one tap opens that commune's
          results. Real names with listings behind them (cachedPopularCommunes). */}
      {communes.length > 0 ? (
        <nav aria-label={t('home.search.popularCommunes')} className="no-scrollbar mt-4 flex gap-2 overflow-x-auto px-4">
          {communes.map(({ commune }) => (
            <Link
              key={commune}
              href={localizeHref(`/listings?commune=${encodeURIComponent(commune)}`, locale)}
              className="u-press flex min-h-11 shrink-0 items-center rounded-full border border-line bg-surface px-4 text-[0.875rem] font-medium text-ink active:bg-canvas-deep"
            >
              {commune}
            </Link>
          ))}
        </nav>
      ) : null}

      <div className="space-y-7 px-4 pb-6 pt-5">
        {/* Shortcuts, always there: one grouped list, hairlines between rows. */}
        <nav aria-label={t('appShell.home.shortcuts.label')} className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {[
            {
              href: '/favoris?onglet=recherches',
              Icon: Bell,
              title: t('appShell.home.shortcuts.searches'),
              text: savedSearch ? (savedSearch.label || t('appShell.home.continueFallback')) : t('appShell.home.shortcuts.searchesText'),
            },
            { href: '/trouver-pour-moi', Icon: Sparkles, title: t('appShell.home.shortcuts.find'), text: t('appShell.home.shortcuts.findText') },
            { href: '/combien-coute', Icon: CircleDollarSign, title: t('appShell.home.shortcuts.prices'), text: t('appShell.home.shortcuts.pricesText') },
          ].map(({ href, Icon, title, text }) => (
            <Link key={href} href={localizeHref(href, locale)} className="flex min-h-[3.75rem] items-center gap-3 px-4 py-2.5 active:bg-canvas-alt">
              <Icon strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-5 w-5 flex-none text-ink-70" />
              <span className="min-w-0 flex-1">
                <span className="block text-[0.9375rem] font-semibold text-ink">{title}</span>
                <span className="block truncate text-[0.8125rem] text-ink-45">{text}</span>
              </span>
              <ChevronRight strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-5 w-5 flex-none text-ink-35" />
            </Link>
          ))}
        </nav>

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
      </div>
    </>
  );
}
