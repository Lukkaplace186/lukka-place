import {
  getTotalPageViews,
  getTotalWhatsAppClicks,
  getTopCommunesByViews,
  getWhatsAppConversionRate,
} from '@/lib/analytics';

// Plain async Server Component with no searchParams/cookies() call of its
// own doesn't trip Next's automatic dynamic-rendering detection, even though
// it queries live, frequently-changing data — without this it would
// statically prerender at build time and serve a frozen snapshot forever.
export const dynamic = 'force-dynamic';

function StatCard({ label, value }) {
  return (
    <div className="rounded-card border border-line bg-white p-4">
      <p className="u-eyebrow text-ink-45">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-[-0.02em] text-ink">{value}</p>
    </div>
  );
}

export default async function AdminDashboardPage() {
  const [pageViews, whatsappClicks, topCommunes, conversionRate] = await Promise.all([
    getTotalPageViews(),
    getTotalWhatsAppClicks(),
    getTopCommunesByViews(10),
    getWhatsAppConversionRate(),
  ]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">Tableau de bord</h1>
        <p className="mt-1 text-sm text-ink-45">
          Basé sur le trafic réel enregistré depuis la mise en place du suivi — aucune donnée historique n&apos;existait avant.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Vues de pages" value={pageViews.toLocaleString('fr-FR')} />
        <StatCard label="Clics WhatsApp" value={whatsappClicks.toLocaleString('fr-FR')} />
        <StatCard
          label="Taux de conversion (annonces)"
          value={conversionRate === null ? 'Pas encore de données' : `${(conversionRate * 100).toFixed(1)}%`}
        />
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-ink">Communes les plus consultées</h2>
        {topCommunes.length === 0 ? (
          <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">
            Aucune vue enregistrée pour le moment.
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-white">
            <table className="w-full text-left text-sm">
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
                    <td className="u-tabular px-4 py-2.5 text-ink-70">{row.views}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
