import { getSliders, getAdvertisements, languageLabel } from '@/lib/cms';
import { getCdfRate } from '@/lib/currencyRate';
import { updateSliderAction, updateAdvertisementAction, updateExchangeRateAction } from './actions';

// See web/app/admin/dashboard/page.js's identical comment — this page has
// no searchParams/cookies() of its own, so without this it would statically
// prerender at build time despite querying live-editable CMS rows.
export const dynamic = 'force-dynamic';

export default async function AdminCmsPage() {
  const [sliders, advertisements, exchangeRate] = await Promise.all([
    getSliders(),
    getAdvertisements(),
    getCdfRate(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="u-title-page text-ink">CMS</h1>
        <p className="mt-1 text-sm text-ink-45">
          Contenu réel du CMS — certaines lignes datent de la maquette d&apos;origine et n&apos;ont jamais été
          personnalisées ; elles restent affichées telles quelles plutôt que masquées.
        </p>
      </div>

      <div>
        <h2 className="u-title-card mb-3 text-ink">Taux de change (USD → CDF)</h2>
        <p className="mb-3 max-w-2xl text-xs text-ink-45">
          Taux manuel affiché sur le site public, jamais un flux de change en direct — voir web/CLAUDE.md. Modifier
          cette valeur change immédiatement toutes les conversions &laquo;&nbsp;≈&nbsp;&raquo; affichées sur le site.
        </p>
        <form action={updateExchangeRateAction} className="flex items-end gap-2.5 rounded-card border border-line bg-white p-4">
          <div>
            <label htmlFor="cdf_per_usd" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
              1 USD = ? CDF
            </label>
            <input
              id="cdf_per_usd"
              name="cdf_per_usd"
              type="number"
              step="1"
              min="1"
              defaultValue={exchangeRate.cdfPerUsd}
              className="w-40 rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink"
            />
          </div>
          <button
            type="submit"
            className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas-alt"
          >
            Enregistrer
          </button>
          <p className="pb-2 text-xs text-ink-45">Dernière mise à jour : {exchangeRate.updatedAt}</p>
        </form>
      </div>

      <div>
        <h2 className="u-title-card mb-3 text-ink">Bannières d&apos;accueil (sliders)</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sliders.map((slider) => {
            const bound = updateSliderAction.bind(null, slider.id);
            return (
              <form
                key={slider.id}
                action={bound}
                className="space-y-2 rounded-card border border-line bg-white p-4"
              >
                <div className="flex items-center justify-between">
                  <span className="u-eyebrow text-ink-45">Langue: {languageLabel(slider.language_id)}</span>
                </div>
                <input
                  name="title"
                  defaultValue={slider.title || ''}
                  placeholder="Titre"
                  className="w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink"
                />
                <textarea
                  name="text"
                  defaultValue={slider.text || ''}
                  placeholder="Texte"
                  rows={2}
                  className="w-full rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink"
                />
                <button
                  type="submit"
                  className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas-alt"
                >
                  Enregistrer
                </button>
              </form>
            );
          })}
        </div>
      </div>

      <div>
        <h2 className="u-title-card mb-3 text-ink">Bannières publicitaires (advertisements)</h2>
        <div className="overflow-hidden rounded-card border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Emplacement</th>
                <th className="px-4 py-2.5 font-semibold">Vues</th>
                <th className="px-4 py-2.5 font-semibold">URL</th>
              </tr>
            </thead>
            <tbody>
              {advertisements.map((ad) => {
                const bound = updateAdvertisementAction.bind(null, ad.id);
                return (
                  <tr key={ad.id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2.5 text-ink-70">{ad.slot || '—'}</td>
                    <td className="u-tabular px-4 py-2.5 text-ink-70">{ad.views ?? 0}</td>
                    <td className="px-4 py-2.5">
                      <form action={bound} className="flex items-center gap-1.5">
                        <input
                          name="url"
                          defaultValue={ad.url || ''}
                          className="w-64 rounded-md border border-line bg-white px-2 py-1 text-xs text-ink"
                        />
                        <button
                          type="submit"
                          className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-canvas-alt"
                        >
                          OK
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
