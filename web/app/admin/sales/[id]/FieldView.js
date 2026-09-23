import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * The rep's day on one phone screen: signups today / this week, and the
 * agents to call back, each with a one-tap WhatsApp nudge from the rep's OWN
 * phone (wa.me — we send nothing, so nothing here can reach an agent who
 * did not want the rep's call). French always: the agent reads it.
 */
function nudgeHref(phone, name) {
  if (!phone) return null;
  const first = String(name || '').split(' ')[0];
  const text = `Bonjour${first && !/^Agent #/.test(name) ? ` ${first}` : ''}, c'est votre contact Lukka Place. `
    + "Avez-vous de nouveaux biens à publier ? Envoyez-les simplement en message ou en vocal au numéro Lukka Place, "
    + 'avec 3 photos, et ils seront en ligne.';
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export default function FieldView({ view, t, locale }) {
  const date = (value) => (value
    ? new Date(value).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', timeZone: 'Africa/Kinshasa' })
    : null);
  return (
    <section className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <h2 className="u-title-card text-ink">{t('admin.sales.field.title')}</h2>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-md bg-canvas px-3 py-2.5">
          <p className="u-stat text-ink">{view.today}</p>
          <p className="u-micro text-ink-45">{t('admin.sales.field.signupsToday')}</p>
        </div>
        <div className="rounded-md bg-canvas px-3 py-2.5">
          <p className="u-stat text-ink">{view.week}</p>
          <p className="u-micro text-ink-45">{t('admin.sales.field.signupsWeek')}</p>
        </div>
      </div>

      <h3 className="u-title-sub mt-5 text-ink">{t('admin.sales.field.quietTitle')}</h3>
      {view.quiet.length === 0 ? (
        <p className="u-micro mt-1 text-ink-45">{t('admin.sales.field.quietNone')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {view.quiet.map((agent) => {
            const href = nudgeHref(agent.phone, agent.name);
            return (
              <li key={agent.agentId} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/agents/${agent.agentId}`} className="u-micro-strong block truncate text-ink hover:underline">
                    {agent.name}
                  </Link>
                  <p className="u-micro text-ink-45">
                    {agent.lastListingAt
                      ? t('admin.sales.field.lastListing', { date: date(agent.lastListingAt), count: agent.live })
                      : t('admin.sales.field.noListingYet')}
                  </p>
                </div>
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-[#25D366] px-3.5 text-[0.8125rem] font-semibold text-white"
                  >
                    <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
                    {t('admin.sales.field.nudge')}
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
