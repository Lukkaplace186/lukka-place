import Link from 'next/link';
import { CheckCircle2, CircleSlash } from 'lucide-react';
import { getLeadAnalytics, listViewingFeed } from '@/lib/adminApi';
import { getLeadClickTotals, getLeadClicksByCommune, getLeadClicksPage } from '@/lib/adminLeadRouting';
import { ROUTING_TYPE_LABEL_KEYS } from '@/lib/adminLabels';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { buildHref, firstParam, parsePage } from '@/lib/adminPagination';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, ROUTING_TONE, Stat, formatKinshasa } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';
import InfoTip from '../market-data/InfoTip';
import NudgeButton from './NudgeButton';

export const metadata = {
  title: 'Lead Analytics — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const PATH = '/admin/telemetry';
const WINDOWS = [7, 30, 90];
/** Mirrors the engine's services/viewingSweeps.js CHECKIN_AFTER_MS. */
const CHECKIN_AFTER_MS = 2 * 60 * 60 * 1000;
const CHECKIN_ANSWER_KEYS = {
  GOOD: 'admin.telemetry.answerGood',
  BAD: 'admin.telemetry.answerBad',
  AGENT_ABSENT: 'admin.telemetry.answerAbsent',
};

function pct(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function settled(result) {
  return result.status === 'fulfilled' ? { value: result.value, error: null } : { value: null, error: result.reason?.message };
}

/**
 * Lead Analytics (formerly "Telemetry"; the URL is unchanged so bookmarks and
 * the revalidatePath calls keep working).
 *
 * The three performance cards are built only from what the system can prove:
 * - **Taps → inquiries** divides WhatsApp enquiries the engine actually
 *   received from the storefront CTA by taps that went to the CENTRAL number.
 *   A tap routed to an agent's own WhatsApp is invisible to us by design
 *   (CLAUDE.md, "Dual contact policy"), so it is reported beside the rate,
 *   never inside it.
 * - **Top communes** ranks recorded taps, with the viewing requests from the
 *   same commune beside them.
 * - **WhatsApp delivery health** shows sends the API accepted or refused, and
 *   the one real proof of delivery we have: an agent who answered. Chakra does
 *   not forward delivery receipts, so no "delivered" figure is shown.
 */
export default async function AdminLeadAnalyticsPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const days = WINDOWS.includes(Number(firstParam(raw.days))) ? Number(firstParam(raw.days)) : 30;
  const taps = parsePage(raw, { pageParam: 'tp', sizeParam: 'ts' });
  const nudges = parsePage(raw, { pageParam: 'np', sizeParam: 'ns' });
  const checkins = parsePage(raw, { pageParam: 'cp', sizeParam: 'cs' });
  const params = Object.fromEntries(
    ['days', 'tp', 'ts', 'np', 'ns', 'cp', 'cs'].map((key) => [key, firstParam(raw[key]) || undefined]),
  );

  const [totalsR, communesR, analyticsR, clicksR, awaitingR, checkinsR] = await Promise.allSettled([
    getLeadClickTotals({ days }),
    getLeadClicksByCommune({ days }),
    getLeadAnalytics({ days }),
    getLeadClicksPage({ limit: taps.limit, offset: taps.offset }),
    listViewingFeed({ view: 'awaiting_agent', limit: nudges.limit, offset: nudges.offset }),
    listViewingFeed({ view: 'checkins', limit: checkins.limit, offset: checkins.offset }),
  ]);
  const totals = settled(totalsR);
  const communes = settled(communesR);
  const analytics = settled(analyticsR);
  const clicks = settled(clicksR);
  const awaiting = settled(awaitingR);
  const followUps = settled(checkinsR);

  const a = analytics.value;
  const enquiries = a?.leadsBySource?.['listing-whatsapp-enquiry'] || 0;
  const visitRequests = a?.leadsBySource?.['listing-visit-request'] || 0;
  const trackedLeads = a ? Object.values(a.leadsBySource).reduce((sum, n) => sum + n, 0) : 0;
  const centralTaps = totals.value?.CENTRAL_FALLBACK || 0;
  const directTaps = totals.value?.DIRECT_WA || 0;
  const conversion = pct(enquiries, centralTaps);
  const pushesSent = (a?.pushes?.notified || 0) + (a?.pushes?.failed || 0);
  const acceptedRate = pct(a?.pushes?.notified || 0, pushesSent);
  const answeredRate = pct(a?.viewings?.answered || 0, a?.viewings?.direct || 0);
  const viewingsByCommune = new Map((a?.viewingsByCommune || []).map((row) => [row.commune, row.n]));
  const communeRows = communes.value?.rows || [];
  const topTaps = Math.max(1, ...communeRows.map((row) => row.taps));
  const engineError = analytics.error || awaiting.error || followUps.error;

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.telemetry.title')}</h1>
          <p className="u-micro mt-1 text-ink-45">{t('admin.telemetry.subtitle')}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {WINDOWS.map((value) => (
            <Link
              key={value}
              href={buildHref(PATH, params, { days: value === 30 ? '' : value })}
              aria-current={value === days ? 'page' : undefined}
              className={`u-press rounded-full px-3.5 py-1.5 text-[0.8125rem] font-bold transition-colors ${value === days ? 'bg-ink text-white' : 'bg-canvas-alt text-ink-70 hover:bg-canvas-deep'}`}
            >
              {t('admin.matching.rangeDays', { days: value })}
            </Link>
          ))}
        </div>
      </div>

      {engineError ? <ErrorNote>{t('admin.telemetry.engineError', { error: engineError })}</ErrorNote> : null}
      {totals.error || communes.error || clicks.error ? (
        <ErrorNote>{t('admin.telemetry.databaseError', { error: totals.error || communes.error || clicks.error })}</ErrorNote>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="u-card flex flex-col gap-2 rounded-card bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="u-eyebrow text-ink-45">{t('admin.telemetry.conversionTitle')}</span>
            <InfoTip label={t('admin.telemetry.conversionTitle')}>{t('admin.telemetry.conversionHelp')}</InfoTip>
          </div>
          <div className="u-stat text-ink">{conversion == null ? '—' : `${conversion.toLocaleString('fr-FR')} %`}</div>
          <p className="u-micro text-ink-70">{t('admin.telemetry.conversionDetail', { enquiries, taps: centralTaps })}</p>
          <p className="u-micro text-ink-45">{t('admin.telemetry.conversionDirect', { count: directTaps })}</p>
          <p className="u-micro border-t border-line pt-2 text-ink-45">
            {t('admin.telemetry.trackedLeads', { count: trackedLeads, visits: visitRequests })}
          </p>
        </div>

        <div className="u-card flex flex-col gap-2 rounded-card bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="u-eyebrow text-ink-45">{t('admin.telemetry.topCommunesTitle')}</span>
            <InfoTip label={t('admin.telemetry.topCommunesTitle')}>{t('admin.telemetry.topCommunesHelp')}</InfoTip>
          </div>
          {communeRows.length === 0 ? (
            <p className="u-micro py-4 text-ink-45">{t('admin.telemetry.topCommunesEmpty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {communeRows.slice(0, 5).map((row) => (
                <li
                  key={row.commune}
                  className="grid grid-cols-[minmax(5rem,7rem)_minmax(0,1fr)_auto] items-center gap-2"
                  title={t('admin.telemetry.communeTooltip', { commune: row.commune, taps: row.taps, viewings: viewingsByCommune.get(row.commune) || 0 })}
                >
                  <span className="u-micro truncate text-ink">{row.commune}</span>
                  <span className="h-2.5 rounded-r bg-canvas-deep">
                    <span className="block h-2.5 rounded-r bg-blue" style={{ width: `${(row.taps / topTaps) * 100}%` }} />
                  </span>
                  <span className="u-micro u-tabular whitespace-nowrap text-ink-70">
                    <span className="font-semibold text-ink">{row.taps}</span> · {t('admin.telemetry.viewingsShort', { count: viewingsByCommune.get(row.commune) || 0 })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {communes.value?.untagged ? (
            <p className="u-micro border-t border-line pt-2 text-ink-45">{t('admin.telemetry.untaggedTaps', { count: communes.value.untagged })}</p>
          ) : null}
        </div>

        <div className="u-card flex flex-col gap-2 rounded-card bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="u-eyebrow text-ink-45">{t('admin.telemetry.deliveryTitle')}</span>
            <InfoTip label={t('admin.telemetry.deliveryTitle')}>{t('admin.telemetry.deliveryHelp')}</InfoTip>
          </div>
          <div className="u-stat text-ink">{acceptedRate == null ? '—' : `${acceptedRate.toLocaleString('fr-FR')} %`}</div>
          <p className="u-micro text-ink-70">
            {t('admin.telemetry.deliveryAccepted', { accepted: a?.pushes?.notified || 0, failed: a?.pushes?.failed || 0 })}
          </p>
          <p className="u-micro text-ink-70">
            {t('admin.telemetry.deliveryAnswered', {
              answered: a?.viewings?.answered || 0,
              direct: a?.viewings?.direct || 0,
              rate: answeredRate == null ? '—' : `${answeredRate.toLocaleString('fr-FR')} %`,
            })}
          </p>
          <p className="u-micro text-ink-70">{t('admin.telemetry.deliveryEscalated', { count: a?.viewings?.escalated || 0 })}</p>
          {a?.config ? (
            <ul className="u-micro flex flex-col gap-1 border-t border-line pt-2">
              {[
                ['opsNumber', a.config.opsNumberConfigured],
                ['templateLeadMatch', a.config.templates.leadMatch],
                ['templateViewing', a.config.templates.viewingRequest],
                ['templateOtp', a.config.templates.otp],
              ].map(([key, ok]) => (
                <li key={key} className={`flex items-center gap-1.5 ${ok ? 'text-success' : 'text-warning'}`}>
                  {ok ? (
                    <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                  ) : (
                    <CircleSlash strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                  )}
                  <span className="text-ink-70">{t(`admin.telemetry.config.${key}`)}</span>
                  <span className="font-semibold">{ok ? t('admin.telemetry.configured') : t('admin.telemetry.notConfigured')}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t('admin.telemetry.clicks', { days })} value={totals.value?.total ?? '—'} />
        <Stat label={t('admin.telemetry.direct')} value={totals.value?.DIRECT_WA ?? '—'} />
        <Stat label={t('admin.telemetry.central')} value={totals.value?.CENTRAL_FALLBACK ?? '—'} />
        <Stat label={t('admin.telemetry.unknown')} value={totals.value?.UNKNOWN ?? '—'} />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="u-title-card text-ink">{t('admin.telemetry.clicksTitle')}</h2>
        <TableFrame
          minWidth="48rem"
          footer={clicks.value ? (
            <Pagination pathname={PATH} params={params} total={clicks.value.total} page={taps.page} pageSize={taps.pageSize} pageParam="tp" sizeParam="ts" />
          ) : null}
        >
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.telemetry.colTime')}</th>
              <th className={TH_STICKY}>{t('admin.telemetry.colListing')}</th>
              <th className={TH_STICKY}>{t('admin.telemetry.colRouting')}</th>
              <th className={TH_STICKY}>{t('admin.telemetry.colCommune')}</th>
              <th className={TH_STICKY}>{t('admin.telemetry.colDevice')}</th>
              <th className={TH_STICKY}>{t('admin.telemetry.colSource')}</th>
            </tr>
          </thead>
          <tbody>
            {(clicks.value?.rows || []).length === 0 ? (
              <EmptyRow colSpan={6}>{t('admin.telemetry.clicksEmpty')}</EmptyRow>
            ) : (
              clicks.value.rows.map((click) => (
                <tr key={click.id} className={TR_DENSE}>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(click.created_at)}</td>
                  <td className={TD_DENSE}>
                    {click.listing_id ? (
                      <Link href={`/admin/listings/${click.listing_id}`} className="font-semibold text-blue-deep hover:underline">
                        {click.reference ? `Réf: ${click.reference}` : `#${click.listing_id}`}
                      </Link>
                    ) : '—'}
                    {click.title ? <div className="max-w-[18rem] truncate text-ink-45">{click.title}</div> : null}
                  </td>
                  <td className={TD_DENSE}>
                    {click.routing_type ? (
                      <Chip tone={ROUTING_TONE[click.routing_type]}>{t(ROUTING_TYPE_LABEL_KEYS[click.routing_type])}</Chip>
                    ) : (
                      <span className="text-ink-35">{t('admin.telemetry.unknown')}</span>
                    )}
                  </td>
                  <td className={TD_DENSE}>{click.commune || '—'}</td>
                  <td className={TD_DENSE}>{click.device || '—'}</td>
                  <td className={TD_DENSE}>{click.source || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </TableFrame>
      </section>

      <section className="flex flex-col gap-2">
        <div>
          <h2 className="u-title-card text-ink">{t('admin.telemetry.nudgeTitle')}</h2>
          <p className="u-micro mt-0.5 text-ink-45">{t('admin.telemetry.nudgeNote')}</p>
        </div>
        <TableFrame
          minWidth="40rem"
          footer={awaiting.value ? (
            <Pagination pathname={PATH} params={params} total={awaiting.value.total} page={nudges.page} pageSize={nudges.pageSize} pageParam="np" sizeParam="ns" />
          ) : null}
        >
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.telemetry.colRequest')}</th>
              <th className={TH_STICKY}>{t('admin.telemetry.colReceived')}</th>
              <th className={TH_STICKY}>{t('admin.telemetry.colSla')}</th>
              <th className={TH_STICKY}>{t('admin.viewings.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {(awaiting.value?.data || []).length === 0 ? (
              <EmptyRow colSpan={4}>{t('admin.telemetry.nudgeEmpty')}</EmptyRow>
            ) : (
              awaiting.value.data.map((row) => (
                <tr key={row.id} className={TR_DENSE}>
                  <td className={TD_DENSE}>
                    <Link href={`/admin/viewings?q=${encodeURIComponent(row.lead_wa_id || '')}`} className="font-semibold text-blue-deep hover:underline">
                      #{row.id}
                    </Link>
                    <div className="text-ink-45">{row.lead_name || (row.lead_wa_id ? `+${row.lead_wa_id}` : '')}</div>
                  </td>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(row.created_at)}</td>
                  <td className={TD_DENSE}>
                    {row.sla_alerted_at ? (
                      <Chip tone="danger">{t('admin.telemetry.slaSent', { time: formatKinshasa(row.sla_alerted_at) })}</Chip>
                    ) : (
                      <Chip tone="warning">{t('admin.telemetry.slaPending')}</Chip>
                    )}
                  </td>
                  <td className={TD_DENSE}><NudgeButton viewingRequestId={row.id} /></td>
                </tr>
              ))
            )}
          </tbody>
        </TableFrame>
      </section>

      <section className="flex flex-col gap-2">
        <div>
          <h2 className="u-title-card text-ink">{t('admin.telemetry.checkinTitle')}</h2>
          <p className="u-micro mt-0.5 text-ink-45">{t('admin.telemetry.checkinNote')}</p>
        </div>
        <TableFrame
          minWidth="40rem"
          footer={followUps.value ? (
            <Pagination pathname={PATH} params={params} total={followUps.value.total} page={checkins.page} pageSize={checkins.pageSize} pageParam="cp" sizeParam="cs" />
          ) : null}
        >
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.telemetry.colRequest')}</th>
              <th className={TH_STICKY}>{t('admin.telemetry.colSlot')}</th>
              <th className={TH_STICKY}>{t('admin.telemetry.colCheckin')}</th>
              <th className={TH_STICKY}>{t('admin.telemetry.colAnswer')}</th>
            </tr>
          </thead>
          <tbody>
            {(followUps.value?.data || []).length === 0 ? (
              <EmptyRow colSpan={4}>{t('admin.telemetry.checkinEmpty')}</EmptyRow>
            ) : (
              followUps.value.data.map((row) => (
                <tr key={row.id} className={TR_DENSE}>
                  <td className={TD_DENSE}>#{row.id}</td>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(row.scheduled_at)}</td>
                  <td className={TD_DENSE}>
                    {row.checkin_sent_at ? (
                      <Chip tone="success">{t('admin.telemetry.checkinSent')} · {formatKinshasa(row.checkin_sent_at)}</Chip>
                    ) : (
                      <Chip tone="warning">
                        {t('admin.telemetry.checkinDue')} · {formatKinshasa(new Date(new Date(row.scheduled_at).getTime() + CHECKIN_AFTER_MS))}
                      </Chip>
                    )}
                  </td>
                  <td className={TD_DENSE}>{row.checkin_response ? t(CHECKIN_ANSWER_KEYS[row.checkin_response]) : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </TableFrame>
      </section>
    </div>
  );
}
