import Link from '@/components/LocaleLink';
import { getT, getLocale } from '@/lib/i18n/server';
import { frNumber } from '@/lib/format';
import { MIN_PRICE_SAMPLE, getLukkaIndex } from '@/lib/browseFeatures';
import { INDEX_COMPARABLE_FROM, INDEX_METHOD_SINCE, firstChangeDay } from '@/lib/lukkaIndex';
import {
  COLLECTED_SOURCES,
  MANUAL_SOURCES,
  MARKET_WINDOW_DAYS,
  RECENT_DAYS,
  RECENT_WEIGHT,
  RENT_BOUNDS,
  SOURCE_URLS,
  STILL_LISTED_DAYS,
} from '@/lib/marketObservationRules';
import { dayLabel, sourceName } from '../sources';

export const dynamic = 'force-dynamic';

function Section({ title, children }) {
  return (
    <section className="mt-8">
      <h2 className="u-title-section text-ink">{title}</h2>
      <div className="u-body mt-2 space-y-3 text-ink-70">{children}</div>
    </section>
  );
}

export async function generateMetadata() {
  const t = await getT();
  return {
    title: `${t('home.index.methodology.title')} — Lukka Place`,
    description: t('home.index.methodology.lead'),
    alternates: { canonical: '/indice-lukka/methodologie' },
  };
}

/**
 * The Lukka Index's public method. Every number in the text is read from the
 * constants the calculation itself uses (lib/marketObservationRules.js,
 * lib/lukkaIndex.js, MIN_PRICE_SAMPLE), so the page cannot drift from the
 * figures. The source list is the real one, with each source's count in
 * today's reading when the index can be computed.
 */
export default async function LukkaIndexMethodPage() {
  const t = await getT();
  const locale = await getLocale();
  const index = await getLukkaIndex();
  const day = (value) => dayLabel(value, locale);
  const start = day(INDEX_COMPARABLE_FROM);
  const m = (key, vars) => t(`home.index.methodology.${key}`, vars);
  const sources = [
    { key: 'lukka', name: m('sourceLukka'), how: null, n: index?.lukkaListings },
    ...COLLECTED_SOURCES.map((source) => ({ key: source, how: m('sourceCollected') })),
    ...MANUAL_SOURCES.filter((source) => source !== 'other').map((source) => ({ key: source, how: m('sourceManual') })),
  ].map((row) => ({
    ...row,
    name: row.name || (row.key === 'whatsapp_group' ? m('sourceWhatsapp') : sourceName(t, row.key)),
    url: SOURCE_URLS[row.key] || null,
    n: row.key === 'lukka' ? row.n : index?.sources?.[row.key],
  }));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <Link href="/indice-lukka" className="u-micro-strong text-ink-70 hover:text-ink">{m('back')}</Link>
      <h1 className="u-title-hero mt-2 text-ink">{m('title')}</h1>
      <p className="u-body mt-2 text-ink-70">{m('lead')}</p>
      <p className="u-micro mt-2 text-ink-45">{m('updated', { date: day(INDEX_METHOD_SINCE) })}</p>

      <Section title={m('whatTitle')}>
        <p>{m('what')}</p>
        <p>{m('scope')}</p>
      </Section>

      <Section title={m('sourcesTitle')}>
        <p>{m('sourcesLukka')}</p>
        <p>{m('sourcesMarket', { start })}</p>
        <ul className="divide-y divide-line rounded-card bg-surface shadow-[var(--hairline)]">
          {sources.map((row) => (
            <li key={row.key} className="flex flex-col px-4 py-3">
              <span className="font-semibold text-ink">
                {row.url ? (
                  <a href={row.url} rel="nofollow noopener" target="_blank" className="underline underline-offset-2">{row.name}</a>
                ) : row.name}
              </span>
              <span className="u-micro text-ink-45">
                {[row.how, row.n > 0 ? m('sourceCount', { n: frNumber(row.n) }) : null].filter(Boolean).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
        {index ? <p className="u-micro text-ink-45">{m('sourceCountNote')}</p> : null}
        <p>{m('sourcesFacts')}</p>
      </Section>

      <Section title={m('cleaningTitle')}>
        <p>{m('cleaningWindow', { windowDays: MARKET_WINDOW_DAYS, listedDays: STILL_LISTED_DAYS })}</p>
        <p>{m('cleaningBounds', { min: frNumber(RENT_BOUNDS.min), max: frNumber(RENT_BOUNDS.max) })}</p>
        <p>{m('cleaningPlace')}</p>
      </Section>

      <Section title={m('duplicatesTitle')}>
        <p>{m('duplicatesSites')}</p>
        <p>{m('duplicatesLukka')}</p>
      </Section>

      <Section title={m('weightTitle')}>
        <p>{m('weight', { recentDays: RECENT_DAYS, weight: RECENT_WEIGHT })}</p>
      </Section>

      <Section title={m('thresholdTitle')}>
        <p>{m('threshold', { n: MIN_PRICE_SAMPLE })}</p>
      </Section>

      <Section title={m('changeTitle')}>
        <p>{m('changeHow', { listedDays: STILL_LISTED_DAYS })}</p>
        <p>{m('changeWhen', { n: MIN_PRICE_SAMPLE, start, first: day(firstChangeDay()) })}</p>
      </Section>

      <Section title={m('limitsTitle')}>
        <p>{m('limitsUnit')}</p>
        <p>{m('limitsMarket')}</p>
      </Section>

      <Section title={m('citeTitle')}>
        <p>{m('cite')}</p>
        <p className="rounded-card bg-surface px-4 py-3 text-ink shadow-[var(--hairline)]">
          {m('citeExample', { date: day(index?.asOf || INDEX_METHOD_SINCE) })}
        </p>
      </Section>
    </div>
  );
}
