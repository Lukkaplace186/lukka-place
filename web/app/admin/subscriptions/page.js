import {
  getMemberships,
  getFeaturedPricings,
  getFeaturedPropertyIds,
  getPackages,
  listPlanChangeRequests,
  PACKAGE_TERMS,
} from '@/lib/subscriptions';
import { getListingsForModeration } from '@/lib/listings';
import { getVendors, getAgents } from '@/lib/agents';
import {
  setFeaturedAction,
  unsetFeaturedAction,
  createPackageAction,
  updatePackageAction,
  assignPackageAction,
  resolvePlanRequestAction,
  updateMembershipAction,
  updatePackageQuotasAction,
} from './actions';

// See web/app/admin/dashboard/page.js's identical comment — this page has
// no searchParams/cookies() of its own, so without this it would statically
// prerender at build time despite querying live membership/featured data.
export const dynamic = 'force-dynamic';

const TERM_LABELS_FR = { monthly: 'Mensuel', yearly: 'Annuel', lifetime: 'À vie' };

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() > 9000) return 'Illimité';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function agentName(agent) {
  return [agent.first_name, agent.last_name].filter(Boolean).join(' ') || agent.username || `Agent #${agent.id}`;
}

const FIELD = 'rounded-md border border-line bg-white px-2 py-1.5 text-sm text-ink';

export default async function AdminSubscriptionsPage() {
  const [memberships, featuredPricings, featuredIds, approvedListings, vendors, packages, agents, planRequests] =
    await Promise.all([
      getMemberships(),
      getFeaturedPricings(),
      getFeaturedPropertyIds(),
      getListingsForModeration('approved', { limit: 50 }),
      getVendors(),
      getPackages(),
      getAgents(),
      listPlanChangeRequests({ status: 'pending' }),
    ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="u-title-page text-ink">Abonnements</h1>
        <p className="mt-1 text-sm text-ink-45">Forfaits, attribution aux agents et suivi des paiements.</p>
      </div>

      {/* Agent-initiated plan requests. This queue is the other half of
          /compte/agent/abonnement's "Demander ce forfait" — without it an
          agent's request would exist nowhere an admin ever looks, which is
          exactly why a WhatsApp-only version of that button was not enough. */}
      <div>
        <h2 className="u-title-card mb-1 text-ink">Demandes de forfait</h2>
        <p className="mb-3 text-xs text-ink-45">
          Demandes envoyées par les agents depuis leur espace. Approuver attribue le forfait et
          enregistre le paiement dans le journal ci-dessous, en une seule action.
        </p>

        {planRequests.length === 0 ? (
          <div className="rounded-card border border-dashed border-line bg-white p-8 text-center text-sm text-ink-45">
            Aucune demande en attente.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {planRequests.map((req) => (
              <div key={req.id} className="rounded-card border border-line bg-white p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-bold text-ink">
                    {req.agency_name || req.agent_username || `Agent #${req.agent_id}`}
                  </span>
                  <span className="u-tabular text-xs text-ink-45">{req.agent_phone || '—'}</span>
                  <span className="rounded-full bg-blue-tint px-2 py-0.5 text-[0.6875rem] font-bold text-blue-deep">
                    {req.package_title || `Forfait #${req.package_id}`}
                    {req.package_price != null ? ` · ${Number(req.package_price).toLocaleString('fr-FR')} $` : ''}
                    {req.package_term ? ` · ${TERM_LABELS_FR[req.package_term] || req.package_term}` : ''}
                  </span>
                  <span className="text-xs text-ink-35">{formatDate(req.created_at) || ''}</span>
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <form
                    action={resolvePlanRequestAction.bind(null, req.id, 'approved')}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="agent_id" value={req.agent_id} />
                    <input type="hidden" name="package_id" value={req.package_id ?? ''} />
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink-45">Montant encaissé</label>
                      <input name="price" type="number" step="0.01" min="0" className={`${FIELD} w-28`} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink-45">Devise</label>
                      <input name="currency" placeholder="USD" className={`${FIELD} w-20`} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink-45">Mode</label>
                      <input name="payment_method" placeholder="Mobile Money…" className={FIELD} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink-45">Réf.</label>
                      <input name="transaction_id" className={`${FIELD} w-28`} />
                    </div>
                    <button
                      type="submit"
                      className="rounded-md border border-blue-deep bg-blue-tint px-3 py-1.5 text-xs font-bold text-blue-deep hover:bg-blue-deep hover:text-white"
                    >
                      Approuver et attribuer
                    </button>
                  </form>

                  <form action={resolvePlanRequestAction.bind(null, req.id, 'declined')}>
                    <button
                      type="submit"
                      className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-45 hover:bg-canvas-alt hover:text-ink"
                    >
                      Refuser
                    </button>
                  </form>
                </div>
                <p className="mt-2 text-xs text-ink-35">
                  Laissez le montant vide pour provisionner sans encaissement enregistré — mieux qu&apos;un
                  chiffre inventé dans le journal des paiements.
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Package CRUD */}
      <div>
        <h2 className="u-title-card mb-3 text-ink">Forfaits</h2>

        <div className="overflow-hidden rounded-card border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Nom</th>
                <th className="px-4 py-2.5 font-semibold">Prix ($)</th>
                <th className="px-4 py-2.5 font-semibold">Durée</th>
                <th className="px-4 py-2.5 font-semibold">Biens max</th>
                <th className="px-4 py-2.5 font-semibold">Essai (jours)</th>
                <th className="px-4 py-2.5 font-semibold">Statut</th>
                <th className="px-4 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {packages.map((pkg) => {
                const boundUpdate = updatePackageAction.bind(null, pkg.id);
                return (
                  <tr key={pkg.id} className="border-b border-line last:border-b-0">
                    <td colSpan={7} className="px-0 py-0">
                      <form action={boundUpdate} className="grid grid-cols-7 items-center gap-2 px-4 py-2">
                        <input name="title" defaultValue={pkg.title} required className={FIELD} />
                        <input name="price" type="number" step="0.01" min="0" defaultValue={pkg.price} required className={FIELD} />
                        <select name="term" defaultValue={pkg.term} className={FIELD}>
                          {PACKAGE_TERMS.map((t) => (
                            <option key={t} value={t}>{TERM_LABELS_FR[t]}</option>
                          ))}
                        </select>
                        <input name="number_of_property" type="number" min="0" defaultValue={pkg.number_of_property ?? ''} className={FIELD} />
                        <div className="flex items-center gap-1.5">
                          <input type="checkbox" name="is_trial" defaultChecked={pkg.is_trial === 1} />
                          <input name="trial_days" type="number" min="0" defaultValue={pkg.trial_days ?? 0} className={`${FIELD} w-16`} />
                        </div>
                        <select name="status" defaultValue={pkg.status} className={FIELD}>
                          <option value={1}>Actif</option>
                          <option value={0}>Inactif</option>
                        </select>
                        <button type="submit" className="justify-self-start rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-canvas-alt">
                          Enregistrer
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <form action={createPackageAction} className="mt-3 grid grid-cols-7 items-center gap-2 rounded-card border border-dashed border-line bg-white px-4 py-3">
          <input name="title" placeholder="Nom du forfait" required className={FIELD} />
          <input name="price" type="number" step="0.01" min="0" placeholder="Prix" required className={FIELD} />
          <select name="term" defaultValue="monthly" className={FIELD}>
            {PACKAGE_TERMS.map((t) => (
              <option key={t} value={t}>{TERM_LABELS_FR[t]}</option>
            ))}
          </select>
          <input name="number_of_property" type="number" min="0" placeholder="Biens max" className={FIELD} />
          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-1 text-xs text-ink-45">
              <input type="checkbox" name="is_trial" /> Essai
            </label>
            <input name="trial_days" type="number" min="0" placeholder="Jours" className={`${FIELD} w-16`} />
          </div>
          <div />
          <button type="submit" className="justify-self-start rounded-md border border-blue-deep bg-blue-tint px-2.5 py-1.5 text-xs font-medium text-blue-deep hover:bg-blue-deep hover:text-white">
            + Ajouter un forfait
          </button>
        </form>
      </div>

      {/* Quotas per tier. Deliberately per-PACKAGE, not per-agent: this schema
          has no per-agent quota column, and adding a UI that implies one would
          promise an override nothing enforces. */}
      <div>
        <h2 className="u-title-card mb-1 text-ink">Quotas et priorité par forfait</h2>
        <p className="mb-3 text-xs text-ink-45">
          Ces trois valeurs sont appliquées en temps réel : le plafond de biens publiés, le nombre de
          demandes clients traitables par mois, et le poids du forfait dans l&apos;attribution automatique
          des nouvelles demandes.
        </p>
        <div className="overflow-hidden rounded-card border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Forfait</th>
                <th className="px-4 py-2.5 font-semibold">Biens max</th>
                <th className="px-4 py-2.5 font-semibold">Demandes / mois</th>
                <th className="px-4 py-2.5 font-semibold">Priorité (×)</th>
                <th className="px-4 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {packages.map((pkg) => (
                <tr key={`quota-${pkg.id}`} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5 font-medium text-ink">{pkg.title}</td>
                  <td className="px-4 py-2.5" colSpan={4}>
                    <form
                      action={updatePackageQuotasAction.bind(null, pkg.id)}
                      className="flex flex-wrap items-center gap-2"
                    >
                      <input
                        name="number_of_property"
                        type="number"
                        min="0"
                        defaultValue={pkg.number_of_property ?? ''}
                        placeholder="illimité"
                        className={`${FIELD} w-24`}
                      />
                      <input
                        name="monthly_pitch_limit"
                        type="number"
                        min="0"
                        defaultValue={pkg.monthly_pitch_limit ?? 10}
                        className={`${FIELD} w-24`}
                      />
                      <input
                        name="priority_multiplier"
                        type="number"
                        min="0.1"
                        step="0.1"
                        defaultValue={pkg.priority_multiplier ?? 1}
                        className={`${FIELD} w-24`}
                      />
                      <button
                        type="submit"
                        className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-canvas-alt"
                      >
                        Enregistrer
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Assign a package to an agent */}
      <div>
        <h2 className="u-title-card mb-3 text-ink">Attribuer un forfait</h2>
        <form action={assignPackageAction} className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-white p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-45">Agent</label>
            <select name="agent_id" required className={FIELD}>
              <option value="">Choisir…</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{agentName(a)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-45">Forfait</label>
            <select name="package_id" required className={FIELD}>
              <option value="">Choisir…</option>
              {packages.filter((p) => p.status === 1).map((p) => (
                <option key={p.id} value={p.id}>{p.title} ({TERM_LABELS_FR[p.term]})</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-ink-45">
            <input type="checkbox" name="is_trial" /> Essai
          </label>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-45">Prix payé</label>
            <input name="price" type="number" step="0.01" min="0" className={`${FIELD} w-24`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-45">Devise</label>
            <input name="currency" placeholder="USD" className={`${FIELD} w-20`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-45">Symbole</label>
            <input name="currency_symbol" placeholder="$" className={`${FIELD} w-16`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-45">Mode de paiement</label>
            <input name="payment_method" placeholder="Virement, Mobile Money…" className={FIELD} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-45">Réf. transaction</label>
            <input name="transaction_id" className={FIELD} />
          </div>
          <button type="submit" className="rounded-md border border-blue-deep bg-blue-tint px-3 py-1.5 text-xs font-medium text-blue-deep hover:bg-blue-deep hover:text-white">
            Attribuer
          </button>
        </form>
      </div>

      {/* Payment ledger */}
      <div>
        <h2 className="u-title-card mb-1 text-ink">Paiements &amp; abonnements</h2>
        <p className="mb-3 text-xs text-ink-45">
          {memberships.length} entrée{memberships.length !== 1 ? 's' : ''} — chaque attribution crée une nouvelle ligne, donc cette liste est aussi l&apos;historique des paiements.
        </p>

        {memberships.length === 0 ? (
          <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">
            Aucun abonnement.
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border border-line bg-white">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Agence</th>
                  <th className="px-4 py-2.5 font-semibold">Forfait</th>
                  <th className="px-4 py-2.5 font-semibold">Prix payé</th>
                  <th className="px-4 py-2.5 font-semibold">Paiement</th>
                  <th className="px-4 py-2.5 font-semibold">Expire le</th>
                  <th className="px-4 py-2.5 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {memberships.map((m) => (
                  <tr key={m.id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-2.5 text-ink">{m.vendor_username || '—'}</td>
                    <td className="px-4 py-2.5 text-ink-70">
                      {m.package_title || '—'}
                      {m.is_trial === 1 && (
                        <span className="ml-1.5 rounded-full bg-warning-tint px-1.5 py-0.5 text-[0.65rem] font-bold uppercase text-warning">Essai</span>
                      )}
                    </td>
                    <td className="u-tabular px-4 py-2.5 text-ink-70">
                      {m.price != null ? `${m.price} ${m.currency_symbol || m.currency || ''}` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-ink-45">
                      {[m.payment_method, m.transaction_id].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-ink-70">
                      {formatDate(m.expire_date) || '—'}
                      {m.status !== 1 && (
                        <span className="ml-1.5 rounded-full bg-canvas-deep px-1.5 py-0.5 text-[0.65rem] font-bold uppercase text-ink-45">
                          Annulé
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {/* Extending is a separate verb from assigning on purpose:
                          `memberships` IS the payment ledger, so adding a
                          goodwill week must not create a row that reads as a
                          payment and inflates the revenue an admin reconciles
                          against cash. */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <form
                          action={updateMembershipAction.bind(null, m.id)}
                          className="flex items-center gap-1"
                        >
                          <input type="hidden" name="action" value="extend" />
                          <input
                            name="days"
                            type="number"
                            defaultValue={30}
                            className={`${FIELD} w-16 !py-1 !text-xs`}
                            aria-label="Jours à ajouter"
                          />
                          <button
                            type="submit"
                            className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-canvas-alt"
                          >
                            + jours
                          </button>
                        </form>
                        <form action={updateMembershipAction.bind(null, m.id)}>
                          <input
                            type="hidden"
                            name="action"
                            value={m.status === 1 ? 'cancel' : 'reactivate'}
                          />
                          <button
                            type="submit"
                            className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-45 hover:bg-canvas-alt hover:text-ink"
                          >
                            {m.status === 1 ? 'Annuler' : 'Réactiver'}
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="u-title-card mb-1 text-ink">Annonces Vedette</h2>
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
