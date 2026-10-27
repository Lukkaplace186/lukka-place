import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { firstParam } from '@/lib/adminPagination';
import { frNumber } from '@/lib/format';
import { CHANNELS, PAID_CHANNELS } from '@/lib/growthRules';
import { getGrowthDashboard } from '@/lib/growthDashboard';
import { getListingOfTheDay } from '@/lib/browseFeatures';
import { ErrorNote, Stat } from '../LeadRoutingUI';
import { TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';
import { BUTTON, BUTTON_PRIMARY, INPUT } from '../sales/styles';
import { pickListingOfTheDayAction, saveAdSpendAction } from './actions';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Croissance — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

const PERIODS = [7, 30, 90];
const SPEND_CHANNELS = ['meta_ads', 'tiktok_ads', 'google_ads', 'other_paid'];
const FLASH = {
  spend_saved: 'success', picked: 'success', spend_invalid: 'danger', pick_invalid: 'danger', failed: 'danger',
};

function money(amount, currency) {
  return amount == null ? '—' : `${frNumber(amount)} ${currency === 'CDF' ? 'FC' : '$'}`;
}

/**
 * The launch dashboard (growth plan item 21): customer accounts per day and
 * by channel (lib/growthRules.js), new agents, visitors and listings viewed
 * per visitor, cost per account for the paid channels from the spend typed
 * in here, and today's "Bien du jour". No target (owner decision): it counts.
 */
export default async function AdminGrowthPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const days = PERIODS.includes(Number(firstParam(raw.jours))) ? Number(firstParam(raw.jours)) : 30;
  const session = await getAdminSession();
  const canSpend = can(session?.role, 'partners.stats');
  const canPick = can(session?.role, 'listings.edit');

  let data = null;
  let daily = null;
  let loadError = null;
  try {
    [data, daily] = await Promise.all([getGrowthDashboard({ days }), getListingOfTheDay()]);
  } catch (err) {
    loadError = err.message;
  }
  const flashKey = firstParam(raw.flash);
  const maxDay = data ? Math.max(1, ...data.days.map((d) => d.accounts)) : 1;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.growth.title')}</h1>
          <p className="u-micro mt-1 max-w-[75ch] text-ink-45">{t('admin.growth.lead')}</p>
        </div>
        <nav className="flex gap-1.5" aria-label={t('admin.partners.period')}>
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={p === 30 ? '/admin/croissance' : `/admin/croissance?jours=${p}`}
              aria-current={p === days ? 'page' : undefined}
              className={`u-micro-strong rounded-full px-3 py-1 ${p === days ? 'bg-ink text-white' : 'text-ink-70 hover:bg-canvas-alt'}`}
            >
              {t('admin.partners.days', { n: p })}
            </Link>
          ))}
        </nav>
      </div>

      {FLASH[flashKey] ? (
        <p className={`u-micro-strong rounded-lg px-3.5 py-2.5 ${FLASH[flashKey] === 'success' ? 'bg-success-tint text-success' : 'bg-danger-tint text-danger'}`} role="status">
          {t(`admin.growth.flash.${flashKey}`)}
        </p>
      ) : null}
      {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label={t('admin.growth.accounts')} value={frNumber(data.totals.accounts)} />
            <Stat label={t('admin.growth.verified')} value={frNumber(data.totals.verified)} />
            <Stat label={t('admin.growth.agents')} value={frNumber(data.totals.agents)} />
            <Stat label={t('admin.growth.visitorDays')} value={frNumber(data.totals.visitorDays)} hint={t('admin.growth.visitorDaysHint')} />
            <Stat label={t('admin.growth.viewsPerVisitor')} value={data.totals.viewsPerVisitor == null ? '—' : frNumber(data.totals.viewsPerVisitor)} />
          </div>

          <section className="flex flex-col gap-2">
            <h2 className="u-title-card text-ink">{t('admin.growth.perDay')}</h2>
            <ol className="flex h-32 items-end gap-0.5 rounded-card border border-line bg-surface p-3" aria-label={t('admin.growth.perDay')}>
              {data.days.map((d) => (
                <li key={d.day} className="flex flex-1 flex-col items-center justify-end" title={`${d.day} : ${d.accounts} · ${d.visitors}`}>
                  <span className="w-full rounded-t bg-blue" style={{ height: `${Math.max(2, (d.accounts / maxDay) * 100)}px` }} />
                </li>
              ))}
            </ol>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="u-title-card text-ink">{t('admin.growth.byChannel')}</h2>
            <TableFrame minWidth="36rem">
              <thead>
                <tr>
                  <th className={TH_STICKY}>{t('admin.growth.channel')}</th>
                  <th className={`${TH_STICKY} text-right`}>{t('admin.growth.accounts')}</th>
                  <th className={`${TH_STICKY} text-right`}>{t('admin.growth.verified')}</th>
                  <th className={`${TH_STICKY} text-right`}>{t('admin.growth.costPerAccount')}</th>
                </tr>
              </thead>
              <tbody>
                {CHANNELS.filter((channel) => data.byChannel[channel].accounts > 0 || PAID_CHANNELS[channel]).map((channel) => {
                  const cost = data.costs[channel];
                  let costText = '—';
                  if (cost) {
                    costText = Object.keys(cost.spend).length
                      ? Object.entries(cost.perAccount).map(([currency, amount]) => money(amount, currency)).join(' · ')
                      : t('admin.growth.noSpend');
                  }
                  return (
                    <tr key={channel} className={TR_DENSE}>
                      <td className={TD_DENSE}>{t(`admin.growth.channels.${channel}`)}</td>
                      <td className={`${TD_DENSE} u-tabular text-right font-bold text-ink`}>{frNumber(data.byChannel[channel].accounts)}</td>
                      <td className={`${TD_DENSE} u-tabular text-right`}>{frNumber(data.byChannel[channel].verified)}</td>
                      <td className={`${TD_DENSE} u-tabular text-right`}>{costText}</td>
                    </tr>
                  );
                })}
              </tbody>
            </TableFrame>
            <p className="u-micro text-ink-45">{t('admin.growth.channelsHint')}</p>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="u-card flex flex-col gap-3 rounded-card bg-surface p-4">
              <h2 className="u-title-card text-ink">{t('admin.growth.spendTitle')}</h2>
              {canSpend ? (
                <form action={saveAdSpendAction} className="grid grid-cols-2 gap-2">
                  <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
                    {t('admin.growth.week')}
                    <input type="date" name="week" required className={INPUT} />
                  </label>
                  <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
                    {t('admin.growth.channel')}
                    <select name="channel" className={INPUT}>
                      {SPEND_CHANNELS.map((channel) => (
                        <option key={channel} value={channel}>{t(`admin.growth.spendChannels.${channel}`)}</option>
                      ))}
                    </select>
                  </label>
                  <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
                    {t('admin.growth.amount')}
                    <input name="amount" inputMode="decimal" required className={INPUT} />
                  </label>
                  <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
                    {t('admin.partners.form.currency')}
                    <select name="currency" className={INPUT}>
                      <option value="USD">USD</option>
                      <option value="CDF">CDF</option>
                    </select>
                  </label>
                  <div className="col-span-2"><button type="submit" className={BUTTON_PRIMARY}>{t('common.actions.save')}</button></div>
                </form>
              ) : null}
              {data.spend.length ? (
                <ul className="u-micro flex flex-col gap-1 text-ink-70">
                  {data.spend.slice(0, 12).map((row) => (
                    <li key={`${row.week_start}-${row.channel}-${row.currency}`}>
                      {row.week_start} · {t(`admin.growth.spendChannels.${row.channel}`)} · <strong className="u-tabular text-ink">{money(row.amount, row.currency)}</strong>
                    </li>
                  ))}
                </ul>
              ) : <p className="u-micro text-ink-45">{t('admin.growth.noSpendYet')}</p>}
            </div>

            <div className="u-card flex flex-col gap-3 rounded-card bg-surface p-4">
              <h2 className="u-title-card text-ink">{t('admin.growth.dailyTitle')}</h2>
              {daily ? (
                <p className="u-micro text-ink-70">
                  <Link href={`/admin/listings/${daily.listing.id}`} className="font-semibold text-blue-deep hover:underline">
                    n° {daily.listing.id} — {daily.listing.title}
                  </Link>{' '}
                  {daily.picked ? t('admin.growth.dailyPicked') : t('admin.growth.dailyAuto')}
                </p>
              ) : <p className="u-micro text-ink-45">{t('admin.growth.dailyNone')}</p>}
              <p className="u-micro text-ink-45">{t('admin.growth.dailyHint')}</p>
              {canPick ? (
                <form action={pickListingOfTheDayAction} className="flex gap-2">
                  <input name="property_id" inputMode="numeric" required placeholder={t('admin.partners.toolkit.listingPlaceholder')} className={`${INPUT} w-40`} />
                  <button type="submit" className={BUTTON}>{t('admin.growth.dailyPick')}</button>
                </form>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
