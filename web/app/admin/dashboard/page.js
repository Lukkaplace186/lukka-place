import {
  getTotalPageViews,
  getTotalWhatsAppClicks,
  getTopCommunesByViews,
  getWhatsAppConversionRate,
  getViewsByDevice,
  getViewsBySource,
  getConversionByDevice,
} from '@/lib/analytics';

// Plain async Server Component with no searchParams/cookies() call of its
// own doesn't trip Next's automatic dynamic-rendering detection, even though
// it queries live, frequently-changing data — without this it would
// statically prerender at build time and serve a frozen snapshot forever.
export const dynamic = 'force-dynamic';

const DEVICE_LABELS_FR = {
  mobile: 'Mobile',
  desktop: 'Ordinateur',
  tablet: 'Tablette',
  bot: 'Robots d’indexation',
  inconnu: 'Inconnu (avant le suivi)',
};

function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-card border border-line bg-white p-4">
      <p className="u-eyebrow text-ink-45">{label}</p>
      <p className="u-stat mt-1 text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-45">{hint}</p> : null}
    </div>
  );
}

function Panel({ title, note, isEmpty, children }) {
  return (
    <div>
      <h2 className="u-title-card mb-2 text-ink">{title}</h2>
      {note ? <p className="mb-2 text-xs text-ink-45">{note}</p> : null}
      {isEmpty ? (
        <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">
          Aucune donnée enregistrée pour le moment.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-white">{children}</div>
      )}
    </div>
  );
}

export default async function AdminDashboardPage() {
  const [pageViews, whatsappClicks, topCommunes, conversionRate, byDevice, bySource, conversionDevice] =
    await Promise.all([
      getTotalPageViews(),
      getTotalWhatsAppClicks(),
      getTopCommunesByViews(10),
      getWhatsAppConversionRate(),
      getViewsByDevice(),
      getViewsBySource({ limit: 10 }),
      getConversionByDevice(),
    ]);

  // Bots are stored as a real bucket so the totals stay honest, but they are
  // not audience — the human share is the number worth reading.
  const humanViews = byDevice
    .filter((r) => r.device !== 'bot' && r.device !== 'inconnu')
    .reduce((sum, r) => sum + r.views, 0);
  const mobileViews = byDevice.find((r) => r.device === 'mobile')?.views ?? 0;
  const mobileShare = humanViews > 0 ? (mobileViews / humanViews) * 100 : null;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">Tableau de bord</h1>
          <p className="mt-1 text-sm text-ink-45">
            Basé sur le trafic réel enregistré depuis la mise en place du suivi — aucune donnée historique
            n&apos;existait avant.
          </p>
        </div>

        {/* A plain link, not a button: this is a GET that streams a file, so
            it needs no client JS and works with right-click → save as. */}
        <a
          href="/admin/export/listings.csv"
          className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-canvas-alt"
        >
          Exporter les annonces (CSV)
        </a>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Vues de pages" value={pageViews.toLocaleString('fr-FR')} />
        <StatCard label="Clics WhatsApp" value={whatsappClicks.toLocaleString('fr-FR')} />
        <StatCard
          label="Taux de conversion (annonces)"
          value={conversionRate === null ? 'Pas encore de données' : `${(conversionRate * 100).toFixed(1)}%`}
        />
        <StatCard
          label="Part mobile"
          value={mobileShare === null ? 'Pas encore de données' : `${mobileShare.toFixed(0)}%`}
          hint={mobileShare === null ? null : 'Hors robots et vues antérieures au suivi'}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel
          title="Appareils"
          note="Déduit de l’en-tête User-Agent, jamais du contenu envoyé par le navigateur."
          isEmpty={byDevice.length === 0}
        >
          <table className="w-full min-w-[380px] text-left text-sm">
            <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Appareil</th>
                <th className="px-4 py-2.5 font-semibold">Vues</th>
                <th className="px-4 py-2.5 font-semibold">Clics WhatsApp</th>
                <th className="px-4 py-2.5 font-semibold">Conversion</th>
              </tr>
            </thead>
            <tbody>
              {conversionDevice.map((row) => (
                <tr key={row.device} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5 text-ink">{DEVICE_LABELS_FR[row.device] || row.device}</td>
                  <td className="u-tabular px-4 py-2.5 text-ink-70">{row.views.toLocaleString('fr-FR')}</td>
                  <td className="u-tabular px-4 py-2.5 text-ink-70">{row.clicks.toLocaleString('fr-FR')}</td>
                  {/* null, not 0%: a device with no views has no rate at all,
                      and "0%" would read as "nobody converts" instead of
                      "nobody visited". */}
                  <td className="u-tabular px-4 py-2.5 text-ink-70">
                    {row.rate === null ? '—' : `${(row.rate * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel
          title="Provenance du trafic"
          note="Domaine référent uniquement (jamais l’URL complète), ou l’étiquette utm_source d’une campagne."
          isEmpty={bySource.length === 0}
        >
          <table className="w-full min-w-[280px] text-left text-sm">
            <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Source</th>
                <th className="px-4 py-2.5 font-semibold">Vues</th>
              </tr>
            </thead>
            <tbody>
              {bySource.map((row) => (
                <tr key={row.source} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5 text-ink">{row.source === 'direct' ? 'Accès direct' : row.source}</td>
                  <td className="u-tabular px-4 py-2.5 text-ink-70">{row.views.toLocaleString('fr-FR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Communes les plus consultées" isEmpty={topCommunes.length === 0}>
          <table className="w-full min-w-[280px] text-left text-sm">
            <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Commune</th>
                <th className="px-4 py-2.5 font-semibold">Vues</th>
              </tr>
            </thead>
            <tbody>
              {topCommunes.map((row) => (
                <tr key={row.commune} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5 text-ink">{row.commune}</td>
                  <td className="u-tabular px-4 py-2.5 text-ink-70">{row.views.toLocaleString('fr-FR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
