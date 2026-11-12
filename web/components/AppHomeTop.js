'use client';

import Link from '@/components/IntentLink';
import { m } from 'motion/react';
import { Bell, ChevronRight, CircleDollarSign, History, Sparkles } from 'lucide-react';
import SearchBar from './SearchBar';
import AppHomeHero from './app/AppHomeHero';
import AppListingCard from './app/AppListingCard';
import AppRailCard from './app/AppRailCard';
import { ChartBars, ChartContainer } from './ui/chart';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/client';
import { localizeHref } from '@/lib/localePaths';

// The screen's one entrance: the title and its line (AppHomeHero), then the
// search card settling onto the photo, then the rail's cards sliding in from
// the right, one after the other. Transform only, never opacity (the same
// rule as the website hero's .u-hero-settle): the server HTML is what a phone
// on 3G shows until the JavaScript arrives, and opacity 0 there would be a
// blank search screen.
const rise = {
  hidden: { y: 18 },
  shown: (i = 0) => ({ y: 0, transition: { delay: 0.06 * i, type: 'spring', stiffness: 260, damping: 30 } }),
};
const slide = {
  hidden: { x: 36 },
  shown: (i = 0) => ({ x: 0, transition: { delay: 0.16 + 0.05 * i, type: 'spring', stiffness: 220, damping: 28 } }),
};
// Further down, a section settles as it comes into view, once. It answers the
// scroll, and it is only a short move: the content is in the HTML either way.
const settle = {
  initial: { y: 28 },
  whileInView: { y: 0 },
  viewport: { once: true, margin: '0px 0px -12% 0px' },
  transition: { type: 'spring', stiffness: 200, damping: 28 },
};

const RAIL_SIZE = 5;
const SECTION_TITLE = 'text-[1.0625rem] font-bold text-ink';

/**
 * The app's home screen (app mode, app/(site)/(home)/page.js), rebuilt
 * 2026-11-12 from the owner's reference layouts so homes carry it: the
 * website's hero photograph with the title and the real number of live
 * listings (AppHomeHero), the compact search card on its lower edge, the
 * newest listings as a rail of large photos, three small shortcut tiles
 * (alerts, "Trouver pour moi", the price guide), the popular communes as a
 * quiet row, more recent listings, then "Où chercher".
 *
 * Every figure is real: `liveCount` is the public listing count, the saved
 * search is the customer's own, the cards are live listings with their own
 * photos, the communes come from the database. Each part renders nothing
 * when its data is missing.
 */
export default function AppHomeTop({
  liveCount = 0,
  propertyTypes = [],
  communes = [],
  initialCount = null,
  savedSearch = null,
  listings = [],
  heroImage = null,
}) {
  const t = useT();
  const locale = useLocale();
  const rail = listings.slice(0, RAIL_SIZE);
  const more = listings.slice(RAIL_SIZE);
  const shortcuts = [
    { href: '/favoris?onglet=recherches', Icon: Bell, label: t('appShell.home.shortcuts.searches') },
    { href: '/trouver-pour-moi', Icon: Sparkles, label: t('appShell.home.shortcuts.find') },
    { href: '/combien-coute', Icon: CircleDollarSign, label: t('appShell.home.shortcuts.prices') },
  ];

  return (
    <>
      <AppHomeHero image={heroImage} liveCount={liveCount} />

      <m.div variants={rise} initial="hidden" animate="shown" custom={2} className="relative z-20 -mt-14 px-4">
        <SearchBar propertyTypes={propertyTypes} communes={communes} initialCount={initialCount} compact />
      </m.div>

      {/* Back to the customer's latest saved search: one quiet line, theirs only. */}
      {savedSearch ? (
        <Link
          href={localizeHref(`/listings?${savedSearch.query || ''}`, locale)}
          className="mx-4 mt-2 flex min-h-11 items-center gap-2 px-1 text-[0.8125rem] text-ink-70 active:text-ink"
        >
          <History strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-4 w-4 flex-none text-ink-45" />
          <span className="min-w-0 flex-1 truncate">
            {t('appShell.home.resume')}{' '}
            <span className="font-semibold text-ink">{savedSearch.label || t('appShell.home.continueFallback')}</span>
          </span>
          <ChevronRight strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-4 w-4 flex-none text-ink-35" />
        </Link>
      ) : null}

      {rail.length ? (
        <section className={savedSearch ? 'pt-3' : 'pt-7'}>
          <div className="mb-3 flex items-baseline justify-between px-4">
            <h2 className={SECTION_TITLE}>{t('appShell.home.latest')}</h2>
            <Link href={localizeHref('/listings', locale)} className="u-hit relative text-[0.875rem] font-semibold text-blue-deep">
              {t('appShell.home.seeAll')}
            </Link>
          </div>
          {/* Swiped sideways; each card stops on the left gutter. The last
              one leaves a gutter too, so it can come fully into view. */}
          <div className="no-scrollbar flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1">
            {rail.map((listing, index) => (
              <m.div key={listing.id} variants={slide} initial="hidden" animate="shown" custom={index} className="flex-none snap-start">
                <AppRailCard listing={listing} priority={index === 0} />
              </m.div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="space-y-8 px-4 pb-6 pt-7">
        {/* Shortcuts, always there: three small tiles. */}
        <nav aria-label={t('appShell.home.shortcuts.label')} className="grid grid-cols-3 gap-2.5">
          {shortcuts.map(({ href, Icon, label }) => (
            <Link
              key={href}
              href={localizeHref(href, locale)}
              className="u-press flex min-h-[5.25rem] flex-col justify-between rounded-card bg-surface p-3 shadow-[var(--shadow-card)] active:bg-canvas-alt"
            >
              <Icon strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" className="h-5 w-5 text-ink" />
              <span className="text-[0.8125rem] font-semibold leading-tight text-ink">{label}</span>
            </Link>
          ))}
        </nav>

        {/* The popular communes: real names with listings behind them
            (cachedPopularCommunes), one tap opens that commune's results. */}
        {communes.length > 0 ? (
          <nav aria-label={t('home.search.popularCommunes')} className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {communes.map(({ commune }) => (
              <Link
                key={commune}
                href={localizeHref(`/listings?commune=${encodeURIComponent(commune)}`, locale)}
                className="u-hit relative flex h-9 shrink-0 items-center rounded-full bg-canvas-deep px-3.5 text-[0.8125rem] font-medium text-ink-70 active:text-ink"
              >
                {commune}
              </Link>
            ))}
          </nav>
        ) : null}

        {more.length ? (
          <section>
            <h2 className={`mb-3 ${SECTION_TITLE}`}>{t('appShell.home.more')}</h2>
            <div className="space-y-4">
              {more.map((listing) => (
                <AppListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          </section>
        ) : null}

        {/* Où chercher: the live listing count per commune (the search card's own
            popular communes), each row opening that commune's results. */}
        {communes.length >= 3 ? (
          <m.section {...settle}>
            <h2 className={`mb-3 ${SECTION_TITLE}`}>{t('appShell.home.whereTitle')}</h2>
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
          </m.section>
        ) : null}
      </div>
    </>
  );
}
