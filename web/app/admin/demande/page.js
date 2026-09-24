import Link from 'next/link';
import { Printer } from 'lucide-react';
import { getDemandVsSupply } from '@/lib/demandReport';
import { budgetBandText } from '@/lib/demandRules';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { cn } from '@/lib/utils';
import PrintButton from './PrintButton';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('admin.demand.title'), robots: { index: false, follow: false } };
}

const WINDOWS = [30, 90, 180, 365];

/**
 * Demand intelligence — the report the team takes to a developer: what
 * customers asked for (distinct customers, not messages), by commune ×
 * rent/buy × bedrooms × budget, against how many live listings answer it.
 * Printable (the console chrome is print:hidden). Every number is a count of
 * real rows; nothing is projected.
 */
export default async function DemandPage({ searchParams }) {
  const t = await getT();
  const sp = await searchParams;
  const days = WINDOWS.includes(Number(sp.days)) ? Number(sp.days) : 90;

  let report = null;
  let loadError = null;
  try {
    report = await getDemandVsSupply({ days, limit: 60 });
  } catch (err) {
    loadError = err.message;
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.demand.title')}</h1>
          <p className="u-micro mt-1 max-w-3xl text-ink-70">{t('admin.demand.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {WINDOWS.map((w) => (
            <Link
              key={w}
              href={`/admin/demande?days=${w}`}
              className={cn('rounded-full px-3 py-1.5 text-sm font-semibold', w === days ? 'bg-ink text-white' : 'bg-surface text-ink-70 shadow-[inset_0_0_0_1px_var(--color-line)]')}
            >
              {t('admin.demand.days', { count: w })}
            </Link>
          ))}
          <PrintButton label={t('admin.demand.print')} icon={<Printer strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />} />
        </div>
      </div>

      {loadError ? (
        <p className="rounded-lg bg-danger-tint px-4 py-3 text-sm text-danger">{t('admin.demand.loadError', { error: loadError })}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-card border border-line bg-surface p-4">
              <p className="u-micro text-ink-45">{t('admin.demand.customers')}</p>
              <p className="u-stat text-ink">{report.customers}</p>
            </div>
            <div className="rounded-card border border-line bg-surface p-4">
              <p className="u-micro text-ink-45">{t('admin.demand.requests')}</p>
              <p className="u-stat text-ink">{report.requests}</p>
            </div>
            <div className="rounded-card border border-line bg-surface p-4">
              <p className="u-micro text-ink-45">{t('admin.demand.liveListings')}</p>
              <p className="u-stat text-ink">{report.liveListings}</p>
            </div>
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="u-title-section text-ink">{t('admin.demand.byCommune')}</h2>
            {report.communes.length ? (
              <div className="flex flex-wrap gap-2">
                {report.communes.map((c) => (
                  <span key={c.commune} className="u-tag">
                    {c.commune} <span className="font-semibold text-ink">{c.customers}</span>
                  </span>
                ))}
              </div>
            ) : <p className="u-micro text-ink-45">{t('admin.demand.empty')}</p>}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="u-title-section text-ink">{t('admin.demand.cellsTitle')}</h2>
            <p className="u-micro text-ink-70">{t('admin.demand.cellsIntro')}</p>
            {report.cells.length ? (
              <div className="overflow-x-auto rounded-card border border-line bg-surface">
                <table className="w-full min-w-[46rem] text-sm">
                  <thead className="bg-canvas-alt text-left text-[0.75rem] text-ink-45">
                    <tr>
                      <th className="px-4 py-2 font-semibold">{t('admin.demand.cols.commune')}</th>
                      <th className="px-4 py-2 font-semibold">{t('admin.demand.cols.transaction')}</th>
                      <th className="px-4 py-2 font-semibold">{t('admin.demand.cols.bedrooms')}</th>
                      <th className="px-4 py-2 font-semibold">{t('admin.demand.cols.budget')}</th>
                      <th className="px-4 py-2 text-right font-semibold">{t('admin.demand.cols.customers')}</th>
                      <th className="px-4 py-2 text-right font-semibold">{t('admin.demand.cols.supply')}</th>
                      <th className="px-4 py-2 text-right font-semibold">{t('admin.demand.cols.gap')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.cells.map((cell) => (
                      <tr key={`${cell.commune}-${cell.transaction_type}-${cell.bedrooms}-${cell.budget_min}-${cell.budget_max}`} className="border-t border-line">
                        <td className="px-4 py-2.5 font-semibold text-ink">{cell.commune}</td>
                        <td className="px-4 py-2.5 text-ink-70">
                          {cell.transaction_type === 'vente' ? t('admin.demand.buy') : cell.transaction_type === 'location' ? t('admin.demand.rent') : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-ink-70">{cell.bedrooms !== null ? t('admin.demand.bedroomsMin', { count: cell.bedrooms }) : '—'}</td>
                        <td className="px-4 py-2.5 text-ink-70">{budgetBandText(cell, t)}</td>
                        <td className="u-tabular px-4 py-2.5 text-right font-semibold text-ink">{cell.customers}</td>
                        <td className="u-tabular px-4 py-2.5 text-right text-ink-70">{cell.supply}</td>
                        <td className={cn('u-tabular px-4 py-2.5 text-right font-bold', cell.gap > 0 ? 'text-danger' : 'text-success')}>
                          {cell.gap > 0 ? `+${cell.gap}` : cell.gap}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="u-micro text-ink-45">{t('admin.demand.empty')}</p>}
            <p className="text-[0.75rem] text-ink-45">{t('admin.demand.method')}</p>
          </section>
        </>
      )}
    </div>
  );
}
