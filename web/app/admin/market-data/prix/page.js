import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { firstParam } from '@/lib/adminPagination';
import { getLocationHierarchySafe } from '@/lib/locations';
import { getPopularCommunes } from '@/lib/listings';
import { getCategoriesForAdmin } from '@/lib/adminListings';
import { runPriceCheck } from '@/lib/priceCheck';
import { MIN_SAMPLE } from '@/lib/marketBenchmarks';
import { ErrorNote, Stat, money } from '../../LeadRoutingUI';

export const metadata = {
  title: 'Vérification de prix — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const FIELD = 'h-10 rounded-lg border border-line bg-surface px-3 text-[0.8125rem] text-ink';

function positiveNumber(value) {
  const n = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * "Is this price right for the area?" — for a developer's unit, a bank's
 * valuation question, or an agent's new listing. A GET form (bookmarkable,
 * nothing written); every figure comes from lib/priceCheck.js with its
 * sample size, and "pas assez de données" below the minimum.
 */
export default async function PriceCheckPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const commune = firstParam(raw.commune) || '';
  const purpose = firstParam(raw.purpose) === 'sale' ? 'sale' : 'rent';
  const categoryId = Number.parseInt(firstParam(raw.category), 10);
  const beds = Number.parseInt(firstParam(raw.beds), 10);
  const area = positiveNumber(firstParam(raw.area));
  const price = positiveNumber(firstParam(raw.price));

  const [locations, categories] = await Promise.all([
    getLocationHierarchySafe(),
    getCategoriesForAdmin().catch(() => []),
  ]);
  let communes = locations.communes || [];
  if (!communes.length) communes = (await getPopularCommunes(24).catch(() => [])).map((c) => c.commune);

  let result = null;
  let error = null;
  if (commune && price) {
    try {
      result = await runPriceCheck({
        commune,
        purpose,
        categoryId: Number.isFinite(categoryId) ? categoryId : null,
        beds: Number.isFinite(beds) ? beds : null,
        area,
        price,
      });
    } catch (err) {
      error = err.message;
    }
  }
  const period = purpose === 'rent' ? t('admin.marketTools.perMonth') : '';

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/market-data" className="u-micro text-ink-45 hover:text-ink">← {t('admin.marketData.title')}</Link>
        <h1 className="u-title-page mt-1 text-ink">{t('admin.marketTools.priceCheckTitle')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.marketTools.priceCheckSubtitle', { min: MIN_SAMPLE })}</p>
      </div>

      <form method="get" className="u-card grid grid-cols-2 gap-3 rounded-card bg-surface p-4 sm:grid-cols-3 lg:grid-cols-6">
        <label className="flex flex-col gap-1 text-[0.75rem] font-semibold text-ink-70">
          {t('admin.marketData.colCommune')}
          <select name="commune" defaultValue={commune} required className={FIELD}>
            <option value="">—</option>
            {communes.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[0.75rem] font-semibold text-ink-70">
          {t('admin.marketTools.colPurpose')}
          <select name="purpose" defaultValue={purpose} className={FIELD}>
            <option value="rent">{t('admin.marketData.rent')}</option>
            <option value="sale">{t('admin.marketData.sale')}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[0.75rem] font-semibold text-ink-70">
          {t('admin.marketTools.type')}
          <select name="category" defaultValue={Number.isFinite(categoryId) ? String(categoryId) : ''} className={FIELD}>
            <option value="">{t('admin.marketTools.anyType')}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[0.75rem] font-semibold text-ink-70">
          {t('admin.marketTools.colBeds')}
          <input name="beds" type="number" min="0" max="20" defaultValue={Number.isFinite(beds) ? beds : ''} className={FIELD} />
        </label>
        <label className="flex flex-col gap-1 text-[0.75rem] font-semibold text-ink-70">
          {t('admin.marketTools.area')}
          <input name="area" type="number" min="0" step="any" defaultValue={area ?? ''} className={FIELD} />
        </label>
        <label className="flex flex-col gap-1 text-[0.75rem] font-semibold text-ink-70">
          {t('admin.marketTools.price', { period })}
          <input name="price" type="number" min="1" step="any" required defaultValue={price ?? ''} className={FIELD} />
        </label>
        <button type="submit" className="u-btn-primary u-press col-span-2 h-10 rounded-lg bg-blue px-4 text-sm font-bold text-white sm:col-span-3 lg:col-span-6">
          {t('admin.marketTools.check')}
        </button>
      </form>

      {error ? <ErrorNote>{error}</ErrorNote> : null}

      {result ? (
        <div className="flex flex-col gap-4">
          <p className={`rounded-card px-4 py-3 text-[0.9375rem] font-semibold ${
            result.verdict === 'above' ? 'bg-warning-tint text-warning' : result.verdict === 'below' ? 'bg-blue-tint text-blue-deep' : result.verdict === 'inline' ? 'bg-success-tint text-success' : 'bg-canvas-alt text-ink-70'
          }`}>
            {result.verdict === 'thin'
              ? t('admin.marketTools.verdictThin', { n: result.n, min: MIN_SAMPLE, commune })
              : t(`admin.marketTools.verdict.${result.verdict}`, {
                  pct: `${Math.abs(result.differencePct)} %`,
                  median: `${money(result.median)}${period}`,
                  n: result.n,
                  scope: t(`agent.hub.scope.${result.scope}`),
                })}
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t('admin.marketTools.medianAsk')} value={result.median == null ? '—' : `${money(result.median)}${period}`} hint={t('admin.marketTools.sample', { n: result.n })} />
            <Stat label={t('admin.marketTools.percentile')} value={result.percentile == null ? '—' : `${result.percentile} %`} hint={t('admin.marketTools.percentileHint')} />
            <Stat
              label={t('admin.marketTools.colPerSqm')}
              value={result.perSqm == null ? '—' : money(result.perSqm)}
              hint={result.medianPerSqm == null ? t('admin.marketTools.noSqmMedian') : t('admin.marketTools.sqmMedian', { median: money(result.medianPerSqm) })}
            />
            <Stat
              label={t('admin.marketTools.closedTitle')}
              value={result.closes.medianAchieved == null ? '—' : money(result.closes.medianAchieved)}
              hint={result.closes.medianDays == null
                ? t('admin.marketTools.closesThin', { n: result.closes.n })
                : t('admin.marketTools.closesDays', { n: result.closes.n, days: result.closes.medianDays })}
            />
          </div>
          <p className="u-micro text-ink-70">
            {result.demand == null
              ? t('admin.marketTools.demandUnavailable')
              : t('admin.marketTools.demandLine', { people: result.demand.people, unserved: result.demand.unserved, commune })}
          </p>
        </div>
      ) : null}
    </div>
  );
}
