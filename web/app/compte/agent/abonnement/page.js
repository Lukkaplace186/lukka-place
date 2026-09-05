import { CreditCard, ReceiptText } from 'lucide-react';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { getAgentLeadQuota } from '@/lib/leadQuota';
import {
  getPurchasablePackages,
  getAgentBillingHistory,
  getOpenPlanChangeRequests,
} from '@/lib/subscriptions';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentSubscriptionCard from '@/components/AgentSubscriptionCard';
import AgentPlanPicker from '@/components/AgentPlanPicker';

export const metadata = {
  title: 'Abonnement — Espace agent — Lukka Place',
  robots: { index: false, follow: false },
};

const TERM_LABELS_FR = { monthly: 'Mensuel', yearly: 'Annuel', lifetime: 'À vie' };

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  // The 9999 sentinel this schema uses for a lifetime membership (see
  // lib/subscriptions.js's computeExpireDate) is a real stored value, not a
  // bug — rendering it literally as "30 décembre 9999" is what looks like one.
  if (date.getUTCFullYear() >= 9999) return 'Illimité';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function money(value, symbol) {
  if (value == null) return '—';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `${amount.toLocaleString('fr-FR')} ${symbol || '$'}`;
}

/**
 * The full subscription surface for an agent — what the previous version of
 * this page (a single read-only card, four facts) could not answer:
 *
 *   "When does my plan end?"     -> the card's own countdown + échéance
 *   "How do I get more?"         -> the real plan ladder below it, which
 *                                   files a request an admin works through
 *   "What have I been charged?"  -> the real memberships ledger for this
 *                                   agency, including the payment method and
 *                                   transaction reference an admin recorded
 *
 * Every number is a real column. `memberships` doubles as this schema's
 * payment ledger (one row per assignment/renewal — see lib/subscriptions.js),
 * so "historique de facturation" is that same list rather than a second,
 * drifting record. An agency with no vendor row simply has no history yet,
 * and that renders as an honest empty state rather than a fabricated entry.
 */
export default async function AgentSubscriptionPage() {
  const agentId = await getCurrentAgentId();
  const { agent, listings, newLeadsCount } = await getAgentDashboardContext(agentId);

  const [leadQuota, packages, history, openRequests] = await Promise.all([
    getAgentLeadQuota(agentId, agent),
    getPurchasablePackages(),
    getAgentBillingHistory(agent.vendor_id),
    getOpenPlanChangeRequests(agentId),
  ]);

  // The agent's current package, matched against the purchasable list.
  // AGENT_FIELDS surfaces `package_title`/`package_term` but not the package
  // id (its LATERAL join selects the membership, then joins the package for
  // its display fields), and adding an id there would ripple through every
  // consumer of that field list for one screen.
  //
  // Title ALONE is not enough, despite what an earlier version of this
  // comment claimed: production carries two packages called "Gold" (monthly
  // $25 and yearly $275) and two called "Diamond". Matching on title only
  // returned whichever sorted first, so an agency on yearly Gold saw the
  // MONTHLY Gold card badged "Actuel" — a plan they are not on, priced
  // differently, on the one screen where that has to be right. The term
  // disambiguates every real pair.
  const currentPackage = agent.package_title
    ? packages.find((p) => p.title === agent.package_title && p.term === agent.package_term)
      ?? packages.find((p) => p.title === agent.package_title)
    : null;

  return (
    <>
      <AgentPageHeader title="Abonnement" newLeadsCount={newLeadsCount} />

      <div className="flex flex-col gap-8 px-5 py-7 sm:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start">
          <AgentSubscriptionCard
            packageTitle={agent.package_title}
            packageTerm={agent.package_term}
            isTrial={agent.subscription_is_trial}
            expireDate={agent.expire_date}
            listingCount={listings.length}
            listingLimit={agent.listing_limit}
            leadQuota={leadQuota}
            compact
          />

          <div className="u-card flex flex-col gap-3 rounded-card bg-surface p-6">
            <h2 className="u-title-card flex items-center gap-2 text-ink">
              <CreditCard strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem] text-blue" />
              Comment fonctionne le paiement
            </h2>
            <p className="u-micro leading-relaxed text-ink-70">
              Les abonnements Lukka Place sont réglés directement auprès de l’équipe — espèces, virement
              bancaire ou Mobile Money. Choisissez votre forfait ci-dessous : votre demande est enregistrée et
              un conseiller vous contacte sur WhatsApp pour l’activation.
            </p>
            <p className="u-micro leading-relaxed text-ink-45">
              Votre forfait détermine trois choses : le nombre de biens que vous pouvez publier, le nombre de
              demandes clients que vous pouvez traiter chaque mois, et votre priorité dans l’attribution
              automatique des nouvelles demandes de vos communes.
            </p>
            {openRequests.length > 0 && (
              <div className="u-micro mt-1 rounded-lg bg-warning-tint px-3.5 py-3 text-warning">
                {openRequests.length} demande{openRequests.length === 1 ? '' : 's'} de changement de forfait en
                cours de traitement.
              </div>
            )}
          </div>
        </div>

        <section className="flex flex-col gap-4">
          <div>
            <h2 className="u-title-section text-ink">Forfaits disponibles</h2>
            <p className="u-micro mt-1 text-ink-45">
              Les quotas affichés sont ceux réellement appliqués à votre compte.
            </p>
          </div>
          <AgentPlanPicker
            packages={packages}
            currentPackageId={currentPackage?.id ?? null}
            openRequestPackageIds={openRequests.map((r) => r.package_id).filter((id) => id != null)}
          />
        </section>

        <section className="flex flex-col gap-4">
          <div>
            <h2 className="u-title-section text-ink">Historique de facturation</h2>
            <p className="u-micro mt-1 text-ink-45">
              Chaque activation et chaque renouvellement enregistrés par l’équipe Lukka Place.
            </p>
          </div>

          {history.length === 0 ? (
            <div className="u-card rounded-card bg-surface px-6 py-12 text-center">
              <ReceiptText
                strokeWidth={ICON_STROKE_WIDTH}
                className="mx-auto mb-3 h-6 w-6 text-ink-25"
                aria-hidden="true"
              />
              <p className="u-micro text-ink-45">
                Aucun paiement enregistré pour le moment. L’historique apparaîtra ici dès votre première
                activation.
              </p>
            </div>
          ) : (
            <div className="u-card overflow-x-auto rounded-card bg-surface">
              <table className="w-full min-w-[46rem] border-collapse">
                <thead>
                  <tr className="bg-canvas-alt text-left text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-ink-35">
                    <th className="px-5 py-3">Forfait</th>
                    <th className="px-5 py-3">Montant</th>
                    <th className="px-5 py-3">Méthode</th>
                    <th className="px-5 py-3">Référence</th>
                    <th className="px-5 py-3">Début</th>
                    <th className="px-5 py-3">Échéance</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id} className="border-t border-line">
                      <td className="px-5 py-3.5">
                        <div className="u-micro-strong text-ink">{row.package_title || '—'}</div>
                        <div className="u-micro text-ink-45">
                          {TERM_LABELS_FR[row.package_term] || row.package_term || '—'}
                          {row.is_trial ? ' · Essai' : ''}
                        </div>
                      </td>
                      <td className="u-micro u-tabular px-5 py-3.5 text-ink-70">
                        {money(row.price, row.currency_symbol)}
                      </td>
                      <td className="u-micro px-5 py-3.5 text-ink-70">{row.payment_method || '—'}</td>
                      <td className="u-micro u-ref px-5 py-3.5 text-ink-45">{row.transaction_id || '—'}</td>
                      <td className="u-micro u-tabular px-5 py-3.5 text-ink-70">{formatDate(row.start_date)}</td>
                      <td className="u-micro u-tabular px-5 py-3.5 text-ink-70">{formatDate(row.expire_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
