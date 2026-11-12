import { Droplets, Route, Ticket, Zap } from 'lucide-react';
import { getLocale, getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { answeredDateLabel, hasPracticalFacts, practicalFactsOf, practicalRows } from '@/lib/practicalFacts';

const ICONS = { zap: Zap, droplets: Droplets, route: Route, ticket: Ticket };

/**
 * "Fiche pratique": what the agent answered on WhatsApp about power, water,
 * access in the rainy season and the visit fee (engine services/practicalFacts.js).
 * Renders nothing when the agent answered none of the four; a question left
 * unanswered reads "Non indiqué", never a default. A flooded road and a paid
 * visit are tinted so a visitor sees them before booking.
 */
export default async function PracticalFacts({ listing }) {
  const facts = practicalFactsOf(listing?.practical_facts);
  if (!hasPracticalFacts(facts)) return null;
  const t = await getT();
  const locale = await getLocale();
  const date = answeredDateLabel(facts.answeredAt, locale);
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="practical-title">
      <h2 id="practical-title" className="u-title-card mb-4 text-ink">{t('listings.practical.title')}</h2>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {practicalRows(facts).map((row) => {
          const Icon = ICONS[row.icon] || Zap;
          const warning = row.tone === 'warning';
          return (
            <div key={row.id} className="flex items-start gap-3 rounded-xl border border-line p-3.5">
              <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg ${warning ? 'bg-warning-tint text-warning-ink' : 'bg-blue-tint text-blue-deep'}`}>
                <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <dt className="text-[0.8125rem] text-ink-70">{t(row.labelKey)}</dt>
                <dd className={`font-semibold ${row.valueKey ? 'text-ink' : 'text-ink-45'}`}>
                  {row.valueKey ? t(row.valueKey) : t('listings.practical.notStated')}
                </dd>
              </div>
            </div>
          );
        })}
      </dl>
      <p className="mt-3 text-[0.8125rem] text-ink-70">
        {date ? t('listings.practical.sourceDated', { date }) : t('listings.practical.source')}
      </p>
    </section>
  );
}
