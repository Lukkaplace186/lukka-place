import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Printer } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { firstParam } from '@/lib/adminPagination';
import { getCommuneReport } from '@/lib/communeReport';
import { REPORT_COPY, bedsBucket, demandLine, usd } from '@/lib/communeReportRules';
import { KINSHASA_COMMUNE_CENTROIDS } from '@/lib/geocoding';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import PrintButton from '../../../demande/PrintButton';

export const metadata = {
  title: 'Rapport de marché — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const TH = 'border-b border-line px-2 py-1.5 text-left text-[0.75rem] font-semibold text-ink-70';
const TH_R = `${TH} text-right`;
const TD = 'border-b border-line px-2 py-1.5 text-[0.8125rem] text-ink';
const TD_R = `${TD} text-right u-tabular`;

const dateFr = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Kinshasa' });

function Section({ title, children }) {
  return (
    <section className="flex flex-col gap-2 break-inside-avoid">
      <h2 className="u-title-sub text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Figure({ label, value, note }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-[0.75rem] text-ink-45">{label}</p>
      <p className="u-tabular text-[1.25rem] font-bold text-ink">{value}</p>
      {note ? <p className="text-[0.75rem] text-ink-45">{note}</p> : null}
    </div>
  );
}

/**
 * The printable commune market report — lib/communeReport.js for the reads
 * and the rules. Content is French whatever the console language (it is
 * handed to banks and developers); only the toolbar follows the console.
 * The console chrome is print:hidden, so the report prints alone.
 */
export default async function CommuneReportPage({ params, searchParams }) {
  const t = await getT();
  const commune = decodeURIComponent((await params).commune || '');
  // A commune is one of the 24 verified names — never free text from the URL.
  if (!Object.hasOwn(KINSHASA_COMMUNE_CENTROIDS, commune)) notFound();
  const raw = (await searchParams) || {};
  const purpose = firstParam(raw.purpose) === 'sale' ? 'sale' : 'rent';

  const report = await getCommuneReport({ commune, purpose });
  const { supply, series, closes, demand } = report;
  const total = supply.total;
  const period = purpose === 'rent' ? ' / mois' : '';
  const money = (v) => (v == null ? '—' : `${usd(v)}${period}`);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 bg-surface p-4 print:max-w-none print:p-0 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/admin/market-data?pc=${encodeURIComponent(commune)}${purpose === 'sale' ? '&purpose=sale' : ''}`} className="u-micro text-ink-45 hover:text-ink">
          ← {t('admin.marketTools.back')}
        </Link>
        <div className="flex items-center gap-2">
          {['rent', 'sale'].map((p) => (
            <Link
              key={p}
              href={`/admin/market-data/rapport/${encodeURIComponent(commune)}${p === 'sale' ? '?purpose=sale' : ''}`}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${p === purpose ? 'bg-ink text-white' : 'bg-surface text-ink-70 shadow-[inset_0_0_0_1px_var(--color-line)]'}`}
            >
              {REPORT_COPY.purpose(p)}
            </Link>
          ))}
          <PrintButton label={t('admin.marketTools.print')} icon={<Printer strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />} />
        </div>
      </div>

      <header className="flex flex-col gap-1 border-b border-line pb-4">
        <p className="u-eyebrow text-ink-45">Lukka Place · {dateFr.format(report.generatedAt)}</p>
        <h1 className="u-title-page text-ink">{REPORT_COPY.title(commune)}</h1>
        <p className="u-micro-strong text-ink-70">{REPORT_COPY.purpose(purpose)}</p>
        <p className="u-micro text-ink-70">{REPORT_COPY.source}</p>
        <p className="u-micro text-ink-70">{REPORT_COPY.rule}</p>
      </header>

      <Section title={REPORT_COPY.supplyTitle}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="Annonces en ligne" value={total?.listings ?? 0} note={total ? `${total.priced} avec un prix` : null} />
          <Figure label={purpose === 'rent' ? 'Loyer médian demandé' : 'Prix médian demandé'} value={money(total?.median)} note={total?.p25 != null ? `50 % entre ${usd(total.p25)} et ${usd(total.p75)}` : null} />
          <Figure label="Médiane au m²" value={total?.medianPerSqm == null ? '—' : usd(total.medianPerSqm)} note={`${total?.sqmSample ?? 0} annonces avec surface`} />
          <Figure label="Ancienneté médiane" value={total?.medianAgeDays == null ? '—' : `${total.medianAgeDays} j`} note="depuis la publication" />
        </div>
        {supply.byTypeBeds.length ? (
          <>
            <p className="u-micro-strong mt-2 text-ink-70">{REPORT_COPY.supplyByType}</p>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className={TH}>Type</th>
                  <th className={TH}>Chambres</th>
                  <th className={TH_R}>Annonces</th>
                  <th className={TH_R}>Médiane</th>
                  <th className={TH_R}>1er – 3e quartile</th>
                  <th className={TH_R}>Médiane / m²</th>
                </tr>
              </thead>
              <tbody>
                {supply.byTypeBeds
                  .slice()
                  .sort((a, b) => a.type.localeCompare(b.type, 'fr') || bedsBucket.order(a.beds) - bedsBucket.order(b.beds))
                  .map((row) => (
                    <tr key={`${row.type}-${row.beds}`}>
                      <td className={TD}>{row.type}</td>
                      <td className={TD}>{bedsBucket.label(row.beds)}</td>
                      <td className={TD_R}>{row.listings}</td>
                      <td className={TD_R}>{usd(row.median)}</td>
                      <td className={TD_R}>{row.p25 == null ? '—' : `${usd(row.p25)} – ${usd(row.p75)}`}</td>
                      <td className={TD_R}>{usd(row.medianPerSqm)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </>
        ) : null}
      </Section>

      <Section title={REPORT_COPY.seriesTitle}>
        {series.rows.length ? (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={TH}>Mois</th>
                <th className={TH_R}>En ligne</th>
                <th className={TH_R}>Nouvelles</th>
                <th className={TH_R}>Médiane demandée</th>
                <th className={TH_R}>Baisses de prix</th>
                <th className={TH_R}>Conclues</th>
                <th className={TH_R}>Médiane obtenue</th>
                <th className={TH_R}>Retirées</th>
              </tr>
            </thead>
            <tbody>
              {series.rows.map((row) => (
                <tr key={row.month}>
                  <td className={TD}>{row.month}</td>
                  <td className={TD_R}>{row.active}</td>
                  <td className={TD_R}>{row.added}</td>
                  <td className={TD_R}>{usd(row.medianAsk)} ({row.askSample})</td>
                  <td className={TD_R}>{row.priceCuts}</td>
                  <td className={TD_R}>{row.closed}</td>
                  <td className={TD_R}>{usd(row.medianAchieved)}</td>
                  <td className={TD_R}>{row.withdrawn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="u-micro text-ink-70">{REPORT_COPY.seriesEmpty}</p>
        )}
      </Section>

      <Section title={REPORT_COPY.closesTitle}>
        {closes.closed === 0 ? (
          <p className="u-micro text-ink-70">{REPORT_COPY.closesNone}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Transactions déclarées" value={closes.closed} />
            <Figure label="Médiane obtenue" value={money(closes.medianAchieved)} />
            <Figure label="Écart médian au prix demandé" value={closes.medianGapPct == null ? '—' : `${closes.medianGapPct > 0 ? '+' : ''}${closes.medianGapPct} %`} />
            <Figure label="Délai médian de conclusion" value={closes.medianDays == null ? '—' : `${closes.medianDays} j`} />
          </div>
        )}
      </Section>

      <Section title={REPORT_COPY.demandTitle}>
        {demand.searchesAvailable ? (
          <>
            <p className="u-micro text-ink">Recherches sur lukkaplace.com : {demandLine(demand.searches)}.{' '}
              {demand.searches.medianBudget != null ? `Budget maximum médian : ${money(demand.searches.medianBudget)}.` : null}
            </p>
            {demand.searchesByBeds.length ? (
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className={TH}>Chambres recherchées (minimum)</th>
                    <th className={TH_R}>Personnes</th>
                    <th className={TH_R}>Sans résultat</th>
                    <th className={TH_R}>Budget max. médian</th>
                  </tr>
                </thead>
                <tbody>
                  {demand.searchesByBeds.map((row) => (
                    <tr key={row.beds}>
                      <td className={TD}>{bedsBucket.label(row.beds)}</td>
                      <td className={TD_R}>{row.people}</td>
                      <td className={TD_R}>{row.unserved}</td>
                      <td className={TD_R}>{money(row.medianBudget)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        ) : (
          <p className="u-micro text-ink-70">{REPORT_COPY.searchesUnavailable}</p>
        )}
        <p className="u-micro text-ink">
          {demand.requestsAvailable
            ? `Demandes de clients (« Trouver pour moi », WhatsApp) nommant ${commune} : ${demand.requestCustomers} client${demand.requestCustomers > 1 ? 's' : ''}, location et achat confondus ; ${demand.requestCount ?? 0} demande${(demand.requestCount ?? 0) > 1 ? 's' : ''} pour ce type de transaction.`
            : REPORT_COPY.requestsUnavailable}
        </p>
      </Section>

      <footer className="border-t border-line pt-3">
        <p className="u-micro text-ink-45">{REPORT_COPY.limits}</p>
      </footer>
    </div>
  );
}
