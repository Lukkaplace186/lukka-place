import Link from 'next/link';
import { BadgeCheck } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { TAB_QUEUES } from '@/lib/adminDashboardTabs';
import { listModerationQueue } from '@/lib/moderationQueue';
import { listAgentsForAdmin } from '@/lib/agents';
import { getSalesScope } from '@/lib/salesScope';
import { frNumber, formatPrice } from '@/lib/format';
import { getT } from '@/lib/i18n/server';
import WorkQueues from '../WorkQueues';
import ClickBreakdown from '../ClickBreakdown';
import DashboardPanel from '../DashboardPanel';
import TabSection, { TD, TH, THEAD, TR } from './TabSection';

const PREVIEW_ROWS = 5;
const ROSTER_ROWS = 10;

async function settle(promise) {
  try {
    return { value: await promise };
  } catch (err) {
    return { error: err };
  }
}

function waitingLabel(iso, t) {
  if (!iso) return '—';
  const hours = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3600000));
  return hours < 48
    ? t('admin.dashboard.supply.waitingHours', { count: hours })
    : t('admin.dashboard.supply.waitingDays', { count: Math.round(hours / 24) });
}

/** "Is the stock real and clean?" — the approval queue, the agents behind the listings, what gets clicked. */
export default async function SupplyVerificationTab({ role, sinceDays }) {
  const t = await getT();
  const k = (key, vars) => t(`admin.dashboard.supply.${key}`, vars);
  // A sales rep sees only the agents they brought in, as on /admin/agents.
  const scope = await getSalesScope();

  const [queue, roster] = await Promise.all([
    settle(listModerationQueue({ status: 'pending', sort: 'oldest', limit: PREVIEW_ROWS })),
    settle(listAgentsForAdmin({ sort: 'live', limit: ROSTER_ROWS, status: '1', repId: scope?.repId ?? null })),
  ]);

  return (
    <div>
      <WorkQueues role={role} only={TAB_QUEUES.offre} />

      <TabSection
        title={k('moderationTitle')}
        note={k('moderationNote')}
        href="/admin/listings"
        linkLabel={queue.value ? k('seeQueue', { count: frNumber(queue.value.total) }) : k('seeAll')}
      >
        {queue.error ? (
          <p className="rounded-lg bg-danger-tint px-4 py-3 text-sm text-danger">{k('loadError')}</p>
        ) : (
          <DashboardPanel title={k('oldestPending')} isEmpty={queue.value.rows.length === 0}>
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>{k('colListing')}</th>
                  <th className={TH}>{k('colAgent')}</th>
                  <th className={`${TH} text-right`}>{k('colPrice')}</th>
                  <th className={TH}>{k('colFlags')}</th>
                  <th className={`${TH} text-right`}>{k('colWaiting')}</th>
                </tr>
              </thead>
              <tbody>
                {queue.value.rows.map((row) => (
                  <tr key={row.id} className={TR}>
                    <td className={TD}>
                      <Link href={`/admin/listings/${row.id}`} className="block max-w-[240px] truncate text-ink hover:underline">
                        {row.title || k('listingNumber', { id: row.id })}
                      </Link>
                      {row.commune ? <span className="text-xs text-ink-45">{row.commune}</span> : null}
                    </td>
                    <td className={`${TD} text-ink-70`}>{row.agentName || '—'}</td>
                    <td className={`${TD} u-tabular whitespace-nowrap text-right text-ink-70`}>
                      {formatPrice(row.price, row.purpose, row.pricePeriod)}
                    </td>
                    <td className={TD}>
                      {row.flags.length === 0 ? (
                        <span className="text-xs text-ink-45">{k('noFlags')}</span>
                      ) : (
                        <span className={`text-xs font-semibold ${row.blocking ? 'text-danger' : 'text-ink-70'}`}>
                          {k('flagCount', { count: row.flags.length })}
                        </span>
                      )}
                    </td>
                    <td className={`${TD} u-tabular whitespace-nowrap text-right text-ink-70`}>{waitingLabel(row.createdAt, t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DashboardPanel>
        )}
      </TabSection>

      <TabSection title={k('rosterTitle')} note={k('rosterNote')} href="/admin/agents?sort=live" linkLabel={k('seeAgents')}>
        {roster.error ? (
          <p className="rounded-lg bg-danger-tint px-4 py-3 text-sm text-danger">{k('loadError')}</p>
        ) : (
          <DashboardPanel
            title={k('rosterTable')}
            note={k('rosterSummary', {
              total: frNumber(roster.value.summary.total),
              verified: frNumber(roster.value.summary.verified),
            })}
            isEmpty={roster.value.rows.length === 0}
          >
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className={THEAD}>
                <tr>
                  <th className={TH}>{k('colAgent')}</th>
                  <th className={TH}>{k('colPhone')}</th>
                  <th className={`${TH} text-right`}>{k('colLive')}</th>
                  <th className={`${TH} text-right`}>{k('colTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {roster.value.rows.map((row) => {
                  const tier = row.verification_level === 'verified' || row.verification_level === 'agency_partner';
                  return (
                    <tr key={row.id} className={TR}>
                      <td className={TD}>
                        <Link href={`/admin/agents/${row.id}`} className="inline-flex items-center gap-1.5 text-ink hover:underline">
                          {row.display_name}
                          {tier ? (
                            <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-success" aria-label={k('tierVerified')} />
                          ) : null}
                        </Link>
                      </td>
                      <td className={`${TD} text-xs`}>
                        {row.phone_verified_at ? (
                          <span className="text-success">{k('phoneVerified')}</span>
                        ) : (
                          <span className="text-danger">{k('phoneUnverified')}</span>
                        )}
                      </td>
                      <td className={`${TD} u-tabular text-right text-ink`}>{frNumber(row.live_listing_count ?? 0)}</td>
                      <td className={`${TD} u-tabular text-right text-ink-70`}>{frNumber(row.listing_count ?? 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DashboardPanel>
        )}
      </TabSection>

      <ClickBreakdown sinceDays={sinceDays} parts={['listings']} title={k('clickedTitle')} showIntro={false} />
    </div>
  );
}
