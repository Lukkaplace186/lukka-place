import { getT } from '@/lib/i18n/server';
import { getMarketSeries, getUnmetDemand } from '@/lib/marketSnapshots';
import { MIN_SAMPLE } from '@/lib/marketBenchmarks';
import { ErrorNote, Panel, TD, TD_RIGHT, TH, TH_RIGHT, money } from '../LeadRoutingUI';

const dash = (value, format = (v) => v.toLocaleString('fr-FR')) => (value == null ? '—' : format(value));

/**
 * Month by month for one commune (the page's commune filter) — the recorded
 * market series from services/marketSnapshot.js, newest first. Medians below
 * the minimum sample print "—" beside their count.
 */
export async function MarketEvolution({ commune, purpose }) {
  const t = await getT();
  if (!commune) {
    return (
      <Panel title={t('admin.marketTools.evolutionTitle')} isEmpty emptyText={t('admin.marketTools.pickCommune')}>
        {null}
      </Panel>
    );
  }
  let series;
  try {
    series = await getMarketSeries({ commune, purpose, months: 12 });
  } catch (err) {
    return <ErrorNote>{err.message}</ErrorNote>;
  }
  return (
    <Panel
      title={t('admin.marketTools.evolutionTitleFor', { commune })}
      note={t('admin.marketTools.evolutionNote', { min: MIN_SAMPLE })}
      isEmpty={series.rows.length === 0}
      emptyText={series.available ? t('admin.marketTools.evolutionEmpty') : t('admin.marketTools.notMigrated')}
    >
      <table className="w-full min-w-[56rem] border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th className={TH}>{t('admin.marketTools.colMonth')}</th>
            <th className={TH_RIGHT}>{t('admin.marketTools.colActive')}</th>
            <th className={TH_RIGHT}>{t('admin.marketTools.colNew')}</th>
            <th className={TH_RIGHT}>{t('admin.marketTools.colMedianAsk')}</th>
            <th className={TH_RIGHT}>{t('admin.marketTools.colPerSqm')}</th>
            <th className={TH_RIGHT}>{t('admin.marketTools.colPriceCuts')}</th>
            <th className={TH_RIGHT}>{t('admin.marketTools.colClosed')}</th>
            <th className={TH_RIGHT}>{t('admin.marketTools.colAchieved')}</th>
            <th className={TH_RIGHT}>{t('admin.marketTools.colDays')}</th>
            <th className={TH_RIGHT}>{t('admin.marketTools.colWithdrawn')}</th>
            <th className={TH_RIGHT}>{t('admin.marketTools.colDemand')}</th>
          </tr>
        </thead>
        <tbody>
          {series.rows.map((row) => (
            <tr key={row.month} className="border-b border-line last:border-0">
              <td className={`${TD} font-semibold text-ink`}>{row.month}</td>
              <td className={TD_RIGHT}>{row.active}</td>
              <td className={TD_RIGHT}>{row.added}</td>
              <td className={TD_RIGHT}>{dash(row.medianAsk, money)} <span className="text-ink-35">({row.askSample})</span></td>
              <td className={TD_RIGHT}>{dash(row.medianPerSqm, money)}</td>
              <td className={TD_RIGHT}>{row.priceCuts}</td>
              <td className={TD_RIGHT}>{row.closed}</td>
              <td className={TD_RIGHT}>{dash(row.medianAchieved, money)}{row.medianGapPct != null ? <span className="text-ink-35"> ({row.medianGapPct > 0 ? '+' : ''}{row.medianGapPct} %)</span> : null}</td>
              <td className={TD_RIGHT}>{dash(row.medianDaysToClose)}</td>
              <td className={TD_RIGHT}>{row.withdrawn}</td>
              <td className={TD_RIGHT}>
                {row.leads == null && row.searches == null ? '—' : `${row.leads ?? 0} · ${row.searches ?? 0}`}
                {row.zeroResultSearches ? <span className="text-danger"> ({row.zeroResultSearches} ∅)</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/** The last 30 days of searches that found nothing — demand nobody is supplying. */
export async function UnmetDemand() {
  const t = await getT();
  let demand;
  try {
    demand = await getUnmetDemand({ days: 30, limit: 20 });
  } catch (err) {
    return <ErrorNote>{err.message}</ErrorNote>;
  }
  const purposeLabel = (p) => (p === 'rent' ? t('admin.marketData.rent') : p === 'sale' ? t('admin.marketData.sale') : t('admin.marketTools.anyPurpose'));
  return (
    <Panel
      title={t('admin.marketTools.unmetTitle')}
      note={t('admin.marketTools.unmetNote')}
      isEmpty={demand.rows.length === 0}
      emptyText={demand.available ? t('admin.marketTools.unmetEmpty') : t('admin.marketTools.notMigrated')}
    >
      <table className="w-full min-w-[36rem] border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th className={TH}>{t('admin.marketData.colCommune')}</th>
            <th className={TH}>{t('admin.marketTools.colPurpose')}</th>
            <th className={TH_RIGHT}>{t('admin.marketTools.colBeds')}</th>
            <th className={TH_RIGHT}>{t('admin.marketTools.colBudget')}</th>
            <th className={TH_RIGHT}>{t('admin.marketTools.colPeople')}</th>
            <th className={TH_RIGHT}>{t('admin.marketTools.colSearches')}</th>
          </tr>
        </thead>
        <tbody>
          {demand.rows.map((row, index) => (
            <tr key={`${row.commune}-${row.purpose}-${row.bedsMin}-${row.budgetMax}-${index}`} className="border-b border-line last:border-0">
              <td className={`${TD} font-semibold text-ink`}>{row.commune}</td>
              <td className={TD}>{purposeLabel(row.purpose)}</td>
              <td className={TD_RIGHT}>{row.bedsMin == null ? '—' : `${row.bedsMin}+`}</td>
              <td className={TD_RIGHT}>{row.budgetMax == null ? '—' : `≤ ${money(row.budgetMax)}`}</td>
              <td className={TD_RIGHT}>{row.people}</td>
              <td className={TD_RIGHT}>{row.searches}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
