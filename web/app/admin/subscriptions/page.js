import { getMemberships, getFeaturedPricings, getFeaturedPropertyIds } from '@/lib/subscriptions';
import { getListingsForModeration } from '@/lib/listings';
import { getVendors } from '@/lib/agents';
import { setFeaturedAction, unsetFeaturedAction } from './actions';

// See web/app/admin/dashboard/page.js's identical comment — this page has
// no searchParams/cookies() of its own, so without this it would statically
// prerender at build time despite querying live membership/featured data.
export const dynamic = 'force-dynamic';

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() > 9000) return 'Illimité';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export default async function AdminSubscriptionsPage() {
  const [memberships, featuredPricings, featuredIds, approvedListings, vendors] = await Promise.all([
    getMemberships(),
    getFeaturedPricings(),
    getFeaturedPropertyIds(),
    getListingsForModeration('approved', { limit: 50 }),
    getVendors(),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">Abonnements</h1>
        <p className="mt-1 text-sm text-ink-45">
          {memberships.length} abonnement{memberships.length !== 1 ? 's' : ''}
        </p>

        {memberships.length === 0 ? (
          <div className="mt-4 rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">
            Aucun abonnement.
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-card border border-line bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Agence</th>
                  <th className="px-4 py-2.5 font-semibold">Forfait</th>
                  <th className="px-4 py-2.5 font-semibold">Prix</th>
                  <th className="px-4 py-2.5 font-semibold">Expire le</th>
                </tr>
              </thead>
              <tbody>
                {memberships.map((m) => (
                  <tr key={m.id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2.5 text-ink">{m.vendor_username || '—'}</td>
                    <td className="px-4 py-2.5 text-ink-70">{m.package_title || '—'}</td>
                    <td className="u-tabular px-4 py-2.5 text-ink-70">
                      {m.price != null ? `${m.price} ${m.currency_symbol || ''}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-ink-70">{formatDate(m.expire_date) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-1 text-sm font-semibold text-ink">Annonces Vedette</h2>
        <p className="mb-3 text-xs text-ink-45">
          Annonces réellement approuvées et publiques uniquement — {approvedListings.length} disponible
          {approvedListings.length !== 1 ? 's' : ''}.
        </p>

        {approvedListings.length === 0 ? (
          <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">
            Aucune annonce approuvée.
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Annonce</th>
                  <th className="px-4 py-2.5 font-semibold">Vedette</th>
                </tr>
              </thead>
              <tbody>
                {approvedListings.map((listing) => {
                  const isFeatured = featuredIds.has(Number(listing.id));
                  const boundUnset = unsetFeaturedAction.bind(null, listing.id);
                  const boundSet = setFeaturedAction.bind(null, listing.id);

                  return (
                    <tr key={listing.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5 text-ink">{listing.title}</td>
                      <td className="px-4 py-2.5">
                        {isFeatured ? (
                          <form action={boundUnset}>
                            <button
                              type="submit"
                              className="rounded-full border border-blue-deep bg-blue-tint px-2.5 py-1 text-xs font-medium text-blue-deep hover:bg-blue-deep hover:text-white"
                            >
                              Retirer de Vedette
                            </button>
                          </form>
                        ) : (
                          <form action={boundSet} className="flex items-center gap-1.5">
                            <select
                              name="vendor_id"
                              className="rounded-md border border-line bg-white px-2 py-1 text-xs text-ink"
                              title="Agence à attribuer — featured_properties.vendor_id est obligatoire en base, et aucun agent n'est encore lié à cette annonce"
                            >
                              {vendors.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.username}
                                </option>
                              ))}
                            </select>
                            <select
                              name="featured_pricing_id"
                              className="rounded-md border border-line bg-white px-2 py-1 text-xs text-ink"
                            >
                              {featuredPricings.map((fp) => (
                                <option key={fp.id} value={fp.id}>
                                  {fp.number_of_days}j — {fp.price}$
                                </option>
                              ))}
                            </select>
                            <button
                              type="submit"
                              disabled={featuredPricings.length === 0 || vendors.length === 0}
                              className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-canvas-alt disabled:opacity-50"
                            >
                              Mettre en Vedette
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
