import Link from 'next/link';
import { Building2, MessageCircle, SearchX, Wallet } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { countLiveListings, getPopularCommunes } from '@/lib/listings';
import { getWhatsAppClickTotals, trendPercent } from '@/lib/analytics';
import { getDemand } from '@/lib/investorMetrics';
import { frNumber } from '@/lib/format';
import { getT } from '@/lib/i18n/server';

/**
 * The four headline figures above every tab. Each loads on its own: one that
 * fails shows "—" with the reason, never takes the others down.
 *
 * Cost per WhatsApp click is shown as not tracked rather than computed: no ad
 * spend is recorded anywhere in the system, and a CPW without a real spend
 * figure would be invented.
 */

/** "Since the start" has no day count; the unmet-demand query needs one. */
const ALL_TIME_DAYS = 3650;

async function settle(promise) {
  try {
    return { value: await promise };
  } catch (err) {
    return { error: err };
  }
}

function signedPercent(delta) {
  return `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${frNumber(Math.abs(delta))} %`;
}

function KpiCard({ icon: Icon, label, value, hint, tone = 'neutral', href }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="u-eyebrow text-ink-45">{label}</span>
        <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-35" aria-hidden="true" />
      </div>
      <span className="u-stat mt-1 text-ink">{value}</span>
      {hint ? (
        <span className={`u-micro mt-1 ${tone === 'up' ? 'text-success' : tone === 'down' ? 'text-danger' : 'text-ink-45'}`}>{hint}</span>
      ) : null}
    </>
  );
  const cls = 'flex min-w-0 flex-col rounded-card border border-line bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]';
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-blue`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export default async function KpiHeader({ sinceDays, periodLabel }) {
  const t = await getT();
  const k = (key, vars) => t(`admin.dashboard.kpi.${key}`, vars);

  const [live, communes, clicks, demand] = await Promise.all([
    settle(countLiveListings()),
    settle(getPopularCommunes(3)),
    settle(getWhatsAppClickTotals({ sinceDays })),
    settle(getDemand({ days: sinceDays ?? ALL_TIME_DAYS, limit: 1 })),
  ]);

  const communeHint = communes.value?.length
    ? communes.value.map((c) => `${c.commune} ${frNumber(c.count)}`).join(' · ')
    : null;

  const clickTotals = clicks.value;
  const clickDelta = clickTotals && clickTotals.previous !== null ? trendPercent(clickTotals.people, clickTotals.previous) : null;

  // null = the search_events table does not exist yet; not the same as zero.
  const d = demand.value;
  const unmetHint = d
    ? k('unmetHint', {
        searches: frNumber(d.zeroResults),
        share: d.zeroShare === null ? '—' : `${frNumber(d.zeroShare * 100, { maximumFractionDigits: 0 })} %`,
      })
    : demand.error
      ? k('unavailable')
      : k('unmetNotTracked');

  return (
    <section aria-label={k('label')} className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        icon={Building2}
        label={k('activeListings')}
        value={live.error ? '—' : frNumber(live.value)}
        hint={live.error ? k('unavailable') : communeHint}
        href="/admin/listings?status=approved"
      />
      <KpiCard
        icon={MessageCircle}
        label={k('whatsappClicks', { period: periodLabel })}
        value={clickTotals ? frNumber(clickTotals.people) : '—'}
        hint={
          !clickTotals
            ? k('unavailable')
            : clickDelta !== null
              ? t('admin.dashboard.hintDelta', { delta: signedPercent(clickDelta) })
              : null
        }
        tone={clickDelta > 0 ? 'up' : clickDelta < 0 ? 'down' : 'neutral'}
        href="/admin/telemetry"
      />
      <KpiCard icon={Wallet} label={k('cpw')} value="—" hint={k('cpwNotTracked')} />
      <KpiCard
        icon={SearchX}
        label={k('unmetDemand', { period: periodLabel })}
        value={d ? frNumber(d.zeroSearchers) : '—'}
        hint={unmetHint}
        href="/admin/dashboard?tab=demande#recherches-sans-resultat"
      />
    </section>
  );
}
