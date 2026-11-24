import { notFound } from 'next/navigation';
import Link from '@/components/LocaleLink';
import SafeImage from '@/components/SafeImage';
import QueryAlertButton from '@/components/QueryAlertButton';
import AppGuideHeader from '@/components/app/AppGuideHeader';
import AppRailCard from '@/components/app/AppRailCard';
import { getT } from '@/lib/i18n/server';
import { isAppRequest } from '@/lib/appMode';
import { communeFromSlug } from '@/lib/seoPages';
import { getListings, getListingStats } from '@/lib/listings';
import { getPriceGuides } from '@/lib/browseFeatures';
import { listPublicArticles } from '@/lib/blog';
import { listingImages } from '@/lib/listingView';
import { communeGuideMedians, communeGuideQuery } from '@/lib/communeGuideRules';
import { frNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const commune = communeFromSlug(slug);
  // The commune's page for search engines is /location/<commune>; this one is
  // the app's guide to the same place and is not indexed.
  return { title: commune ? `${commune} — Lukka Place` : 'Lukka Place', robots: { index: false, follow: true } };
}

const SECTION_TITLE = 'text-[1.25rem] font-bold leading-tight text-ink';

/**
 * The commune guide (the owner's app design, 2026-11-13): one of Kinshasa's
 * 24 communes at a glance — how many homes are online, the median rents, the
 * quartiers that have homes, what is online now, and what to read before
 * signing.
 *
 * Every figure is real and each part renders nothing when its data is
 * missing:
 * - the commune is one of the official 24 (lib/seoPages.js communeFromSlug);
 *   anything else is a 404, never a guessed place;
 * - the photograph is the first photo of a live listing in this commune, as
 *   ExploreCommunes does, and there is none when no listing has one;
 * - the medians are the price guide's own (getPriceGuides: at least its
 *   minimum sample per commune and room count), each linking to its page;
 * - the quartiers are those of live listings here, with their counts.
 */
export default async function CommuneGuidePage({ params }) {
  const { slug } = await params;
  const commune = communeFromSlug(slug);
  if (!commune) notFound();

  // Its own line, not destructured: the translator-binding test reads it that way.
  const t = await getT();
  const [app, stats, found, guides, articles] = await Promise.all([
    isAppRequest(),
    getListingStats({ commune }).catch(() => null),
    getListings({ commune, limit: 8 }).catch(() => ({ data: [] })),
    getPriceGuides(),
    listPublicArticles().catch(() => []),
  ]);
  const listings = found.data || [];
  const total = stats?.total ?? listings.length;
  const quartiers = stats?.quartiers || [];
  const medians = communeGuideMedians(guides, commune);
  const photo = listings.map((listing) => listingImages(listing)[0]).find(Boolean) || null;
  const resultsHref = `/listings?commune=${encodeURIComponent(commune)}`;
  const online = t('appShell.commune.online', { count: total });
  const reads = articles.slice(0, 2);

  return (
    <div className="bg-canvas-alt pb-28">
      {app ? <AppGuideHeader title={commune} subtitle={online} upHref="/" solid={!photo} /> : null}

      {photo ? (
        <section className={`relative h-[20rem] overflow-hidden bg-blue-900${app ? ' max-lg:-mt-16' : ''}`}>
          <SafeImage src={photo} alt="" fill priority sizes="100vw" className="object-cover" />
          {/* The name sits on the lower edge of the photo: a royal tint there
              only, so the home itself stays untouched. */}
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-blue-900/80 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 px-5 pb-5 text-white">
            <h1 className="text-[2.25rem] font-bold leading-none tracking-[-0.02em]">{commune}</h1>
            <p className="mt-2 text-[0.9375rem] font-medium text-white">
              {online} · {t('appShell.commune.city')}
            </p>
          </div>
        </section>
      ) : (
        <section className="px-5 pt-6">
          <h1 className="u-title-hero text-ink">{commune}</h1>
          <p className="mt-1.5 text-[0.9375rem] text-ink-70">
            {total > 0 ? `${online} · ${t('appShell.commune.city')}` : t('appShell.commune.empty', { commune })}
          </p>
        </section>
      )}

      <div className="mx-auto flex max-w-2xl flex-col gap-9 px-5 pt-7">
        {medians.length ? (
          <section>
            <h2 className={SECTION_TITLE}>{t('appShell.commune.mediansTitle')}</h2>
            <div className="mt-3 grid auto-cols-fr grid-flow-col divide-x divide-line overflow-hidden rounded-card bg-surface shadow-[var(--shadow-card)]">
              {medians.map((m) => (
                <Link key={m.slug} href={`/combien-coute/${m.slug}`} className="block px-3.5 py-3 active:bg-canvas-alt">
                  <span className="block text-[0.8125rem] text-ink-70">{t('appShell.commune.beds', { count: m.beds })}</span>
                  <span className="u-tabular mt-1 block text-[1.25rem] font-bold leading-tight text-ink">{frNumber(m.median)} $</span>
                  <span className="u-tabular mt-1 block text-[0.75rem] text-ink-45">{t('appShell.commune.sample', { count: m.listings })}</span>
                </Link>
              ))}
            </div>
            <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-ink-70">
              {t('appShell.commune.mediansNote')}{' '}
              <Link href="/combien-coute" className="font-semibold text-blue-deep">
                {t('appShell.commune.mediansLink')}
              </Link>
            </p>
          </section>
        ) : null}

        {quartiers.length ? (
          <section>
            <h2 className={SECTION_TITLE}>{t('appShell.commune.quartiersTitle')}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {quartiers.map((q) => (
                <Link
                  key={q.name}
                  href={`${resultsHref}&quartier=${encodeURIComponent(q.name)}`}
                  className="u-press inline-flex min-h-11 items-center gap-1.5 rounded-full bg-surface px-4 text-[0.9375rem] font-medium text-ink shadow-[var(--shadow-card)]"
                >
                  {q.name}
                  <span className="u-tabular text-[0.8125rem] text-ink-45">{q.count}</span>
                </Link>
              ))}
              <Link href={resultsHref} className="u-press inline-flex min-h-11 items-center rounded-full px-4 text-[0.9375rem] font-semibold text-blue-deep">
                {t('appShell.commune.allQuartiers')}
              </Link>
            </div>
            <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-ink-70">{t('appShell.commune.quartiersNote')}</p>
          </section>
        ) : null}
      </div>

      {listings.length ? (
        <section className="pt-9">
          <div className="mx-auto flex max-w-2xl items-baseline justify-between px-5">
            <h2 className={SECTION_TITLE}>{t('appShell.commune.nowTitle')}</h2>
            <Link href={resultsHref} className="text-[0.875rem] font-semibold text-blue-deep">
              {t('appShell.commune.seeAll', { count: total })}
            </Link>
          </div>
          <div className="no-scrollbar mt-3 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-1">
            {listings.map((listing, index) => (
              <AppRailCard key={listing.id} listing={listing} priority={index === 0 && !photo} />
            ))}
          </div>
        </section>
      ) : null}

      {reads.length ? (
        <section className="mx-auto max-w-2xl px-5 pt-9">
          <h2 className={SECTION_TITLE}>{t('appShell.commune.readTitle')}</h2>
          <div className="mt-3 flex flex-col gap-3">
            {reads.map((article) => (
              <Link
                key={article.slug}
                href={`/guides/${article.slug}`}
                className="block rounded-card bg-surface p-4 shadow-[var(--shadow-card)] active:bg-canvas-alt"
              >
                <span className="block text-[0.8125rem] text-ink-45">{t('appShell.commune.readKind')}</span>
                <span className="mt-1 block text-[1rem] font-semibold leading-snug text-ink">{article.title}</span>
                <span className="mt-1.5 block text-[0.875rem] font-semibold text-blue-deep">{t('appShell.commune.readLink')}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* One action for the screen: be told when a home appears here. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto max-w-2xl">
          <QueryAlertButton query={communeGuideQuery(commune)} label={t('appShell.commune.alertCta', { commune })} fullWidth />
        </div>
      </div>
    </div>
  );
}

