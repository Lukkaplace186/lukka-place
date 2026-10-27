import Link from 'next/link';
import { getWhatsAppClickBreakdown } from '@/lib/analytics';
import { frNumber } from '@/lib/format';
import { getT } from '@/lib/i18n/server';
import DashboardPanel from './DashboardPanel';

const TH = 'px-4 py-2.5 font-semibold';
const TD = 'px-4 py-2.5';

function percent(value) {
  return `${frNumber(value * 100, { maximumFractionDigits: 0 })} %`;
}

/**
 * One split as a table: label, clicks with a bar sized against the split's
 * largest row, share of the split's total, distinct people. The bar is the
 * comparison; the number beside it is the value, so nothing depends on
 * reading the bar's length.
 */
function SplitTable({ rows, labelFor, t }) {
  const total = rows.reduce((sum, r) => sum + r.clicks, 0);
  const max = Math.max(1, ...rows.map((r) => r.clicks));
  return (
    <table className="w-full min-w-[300px] text-left text-sm">
      <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
        <tr>
          <th className={TH}>{t('admin.dashboard.clicks.colKey')}</th>
          <th className={TH}>{t('admin.dashboard.clicks.colClicks')}</th>
          <th className={`${TH} text-right`}>{t('admin.dashboard.clicks.colShare')}</th>
          <th className={`${TH} text-right`}>{t('admin.dashboard.clicks.colPeople')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={String(row.key) + (row.purpose || '')} className="border-b border-line last:border-b-0">
            <td className={`${TD} text-ink`}>{labelFor(row)}</td>
            <td className={TD}>
              <div className="flex items-center gap-2">
                <span className="u-tabular w-8 shrink-0 text-ink">{frNumber(row.clicks)}</span>
                <span className="h-2 w-full min-w-[48px] max-w-[140px] rounded-full bg-canvas-alt max-sm:hidden" aria-hidden="true">
                  <span
                    className="block h-2 rounded-full bg-blue"
                    style={{ width: `${Math.max(4, (row.clicks / max) * 100)}%` }}
                  />
                </span>
              </div>
            </td>
            <td className={`${TD} u-tabular whitespace-nowrap text-right text-ink-70`}>
              {total > 0 ? percent(row.clicks / total) : '—'}
            </td>
            <td className={`${TD} u-tabular whitespace-nowrap text-right text-ink-70`}>
              {row.people > 0 ? frNumber(row.people) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 12 weekly columns, current week last. Each bar carries its own number. */
function WeeklyBars({ weeks, locale, t }) {
  const max = Math.max(1, ...weeks.map((w) => w.clicks));
  const dateLabel = (week) =>
    new Date(`${week}T00:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  return (
    <div className="grid grid-cols-12 items-end gap-1 px-3 pb-3 pt-4 sm:gap-2" style={{ minHeight: 180 }}>
      {weeks.map((w, i) => (
        <div
          key={w.week}
          className="flex h-full min-w-0 flex-col items-center justify-end gap-1"
          title={t('admin.dashboard.clicks.weekOf', { date: dateLabel(w.week) })}
        >
          <span className="u-tabular text-[11px] text-ink-70">{frNumber(w.clicks)}</span>
          <span
            className={`block w-full rounded-t ${w.clicks > 0 ? 'bg-blue' : 'bg-line'}`}
            style={{ height: `${Math.max(2, (w.clicks / max) * 110)}px` }}
          />
          {/* A phone fits one date in three; the current week is always one of them. */}
          <span
            className={`whitespace-nowrap text-[11px] text-ink-45 ${(weeks.length - 1 - i) % 3 === 0 ? '' : 'max-sm:invisible'}`}
          >
            {dateLabel(w.week)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** "Clics WhatsApp — détail": every split of the period's taps. */
export default async function ClickBreakdown({ sinceDays }) {
  const t = await getT();
  const locale = t.locale;
  const data = await getWhatsAppClickBreakdown({ sinceDays });
  const k = (key) => `admin.dashboard.clicks.${key}`;
  const labelIn = (group) => (row) => {
    const key = k(`${group}.${row.key}`);
    if (t.has(key)) return t(key);
    return row.key === 'inconnu' ? t(k('unknown')) : row.key;
  };
  const sourceLabel = (row) =>
    row.key === 'direct' ? t('admin.dashboard.direct') : row.key === 'inconnu' ? t(k('unknown')) : row.key;
  const communeLabel = (row) => (row.key === 'inconnu' ? t(k('unknown')) : row.key);
  const typeLabel = (row) => {
    const name = row.key === 'inconnu' ? t(k('unknown')) : row.key;
    const purposeKey = k(`purpose.${row.purpose}`);
    return t.has(purposeKey) ? `${name} ${t(purposeKey)}` : name;
  };

  return (
    <section className="mt-8">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="u-title-section text-ink">{t(k('sectionTitle'))}</h2>
        <Link href="/admin/telemetry" className="text-sm font-medium text-blue hover:underline">
          {t(k('seeEach'))} →
        </Link>
      </div>
      <p className="mb-1 text-sm text-ink-45">{t(k('note'))}</p>
      <p className="mb-4 text-xs text-ink-45">{t(k('peopleNote'))}</p>

      <div className="mb-6">
        <DashboardPanel title={t(k('weeklyTitle'))} note={t(k('weeklyNote'))} isEmpty={data.weekly.length === 0}>
          <WeeklyBars weeks={data.weekly} locale={locale} t={t} />
        </DashboardPanel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DashboardPanel title={t(k('audienceTitle'))} note={t(k('audienceNote'))} isEmpty={data.audience.length === 0}>
          <SplitTable rows={data.audience} labelFor={labelIn('kind')} t={t} />
        </DashboardPanel>
        <DashboardPanel title={t(k('routingTitle'))} isEmpty={data.routing.length === 0}>
          <SplitTable rows={data.routing} labelFor={labelIn('routing')} t={t} />
        </DashboardPanel>
        <DashboardPanel title={t(k('placementTitle'))} note={t(k('placementNote'))} isEmpty={data.placement.length === 0}>
          <SplitTable rows={data.placement} labelFor={labelIn('placement')} t={t} />
        </DashboardPanel>
        <DashboardPanel title={t(k('sourceTitle'))} isEmpty={data.source.length === 0}>
          <SplitTable rows={data.source} labelFor={sourceLabel} t={t} />
        </DashboardPanel>
        <DashboardPanel title={t(k('typeTitle'))} isEmpty={data.propertyType.length === 0}>
          <SplitTable rows={data.propertyType} labelFor={typeLabel} t={t} />
        </DashboardPanel>
        <DashboardPanel title={t(k('priceTitle'))} note={t(k('priceNote'))} isEmpty={data.priceBand.length === 0}>
          <SplitTable rows={data.priceBand} labelFor={labelIn('band')} t={t} />
        </DashboardPanel>
        <DashboardPanel title={t(k('communeTitle'))} isEmpty={data.commune.length === 0}>
          <SplitTable rows={data.commune} labelFor={communeLabel} t={t} />
        </DashboardPanel>
        <DashboardPanel title={t(k('listingsTitle'))} note={t(k('listingsNote'))} isEmpty={data.topListings.length === 0}>
          <table className="w-full min-w-[380px] text-left text-sm">
            <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
              <tr>
                <th className={TH}>{t(k('colListing'))}</th>
                <th className={`${TH} text-right`}>{t(k('colClicks'))}</th>
                <th className={`${TH} text-right`}>{t(k('colViews'))}</th>
                <th className={`${TH} text-right`}>{t(k('colRate'))}</th>
              </tr>
            </thead>
            <tbody>
              {data.topListings.map((row) => (
                <tr key={row.key} className="border-b border-line last:border-b-0">
                  <td className={TD}>
                    <Link href={`/admin/listings/${row.key}`} className="block max-w-[260px] truncate text-ink hover:underline">
                      {row.title || t(k('listingNumber'), { id: row.key })}
                    </Link>
                    {row.commune ? <span className="text-xs text-ink-45">{row.commune}</span> : null}
                  </td>
                  <td className={`${TD} u-tabular text-right text-ink`}>{frNumber(row.clicks)}</td>
                  <td className={`${TD} u-tabular text-right text-ink-70`}>{frNumber(row.views ?? 0)}</td>
                  {/* null, not 0 %: a listing with clicks but no recorded view has no rate. */}
                  <td className={`${TD} u-tabular text-right text-ink-70`}>
                    {row.rate === null ? '—' : percent(row.rate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DashboardPanel>
      </div>
    </section>
  );
}
