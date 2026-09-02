import Link from 'next/link';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { listLeads, listOpenLeads, listViewingRequests } from '@/lib/adminApi';
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS_FR,
  VIEWING_REQUEST_STATUSES,
  VIEWING_REQUEST_STATUS_LABELS_FR,
} from '@/lib/adminLabels';
import { formatRelativeFr } from '@/lib/format';
import { hasDemandFeedAccess, isWithinLaunchTrial, launchTrialEndsAtLabel } from '@/lib/demandFeed';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentLeadCard from '@/components/AgentLeadCard';
import AgentOpenLeadCard from '@/components/AgentOpenLeadCard';
import AgentVisitRequestCard from '@/components/AgentVisitRequestCard';
import { updateAgentLeadStatusAction, replyToLeadAction } from '../actions';

const STATUS_OPTIONS = LEAD_STATUSES.map((value) => ({ value, label: LEAD_STATUS_LABELS_FR[value] }));

/**
 * Visites used to be its own sidebar section. It is a sub-tab here now: a
 * viewing request is not a separate inbox, it is one stage of the same
 * client conversation the other two tabs already show — the customer portal
 * made the same merge on its own side (compte/client/visites now redirects
 * into Messages & Visites). `/compte/agent/visites` still resolves; it
 * redirects here so an existing bookmark or notification link keeps working.
 */
const TABS = [
  { value: 'mes-demandes', label: 'Mes demandes' },
  { value: 'ouvertes', label: 'Opportunités communes' },
  { value: 'visites', label: 'Visites' },
];

const VISIT_STATUS_OPTIONS = VIEWING_REQUEST_STATUSES.map((value) => ({
  value,
  label: VIEWING_REQUEST_STATUS_LABELS_FR[value],
}));

function budgetText(lead) {
  const min = lead.price_min != null ? Number(lead.price_min).toLocaleString('fr-FR') : null;
  const max = lead.price_max != null ? Number(lead.price_max).toLocaleString('fr-FR') : null;
  if (min && max) return `${min} – ${max} $`;
  if (max) return `Jusqu'à ${max} $`;
  if (min) return `À partir de ${min} $`;
  return null;
}

/**
 * The former /compte/agent/visites section, as a tab. Same real data and
 * same Accept / Reschedule / Cancel controls it already had
 * (AgentVisitRequestCard -> updateViewingRequestAction) — this only changes
 * where it lives, not what it can do.
 *
 * The status <select> reuses the shared `?status=` param the other two tabs
 * use, with `tab=visites` carried in a hidden field so filtering doesn't
 * bounce back to Mes demandes. The two vocabularies never collide because
 * each tab resolves the param against its own status list.
 */
function VisitsTab({ visitsPage, statusFilter, listingById, hasListings }) {
  const pending = visitsPage.data.filter((v) => v.status === 'PENDING').length;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[1.125rem] font-bold text-ink">
            {visitsPage.total} demande{visitsPage.total === 1 ? '' : 's'} de visite
          </div>
          <div className="mt-0.5 text-[0.8125rem] text-ink-45">
            {pending} en attente · demandées par vos clients potentiels
          </div>
        </div>

        <form method="get" className="flex items-center gap-2">
          <input type="hidden" name="tab" value="visites" />
          <select
            name="status"
            defaultValue={statusFilter}
            aria-label="Filtrer par statut"
            className="u-focus-ring h-10 w-[11.25rem] rounded-lg border border-line bg-surface px-3 text-[0.8125rem] font-medium text-ink"
          >
            <option value="">Toutes les visites</option>
            {VISIT_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="u-btn-secondary u-press h-10 rounded-lg px-3.5 text-[0.8125rem] font-bold text-ink"
          >
            Filtrer
          </button>
        </form>
      </div>

      {visitsPage.data.length === 0 ? (
        <div className="u-card rounded-card bg-surface px-6 py-16 text-center text-sm text-ink-45">
          {statusFilter
            ? 'Aucune visite ne correspond à ce filtre.'
            : hasListings
              ? 'Aucune demande de visite pour le moment.'
              : 'Ajoutez un bien pour commencer à recevoir des demandes de visite.'}
        </div>
      ) : (
        visitsPage.data.map((viewingRequest) => {
          const propertyId = viewingRequest.property_id || viewingRequest.lead_property_id;
          const property = propertyId ? listingById.get(String(propertyId)) : null;
          const target =
            property?.title ||
            [viewingRequest.lead_quartier, viewingRequest.lead_commune].filter(Boolean).join(', ') ||
            null;

          return (
            <AgentVisitRequestCard
              key={viewingRequest.id}
              viewingRequest={viewingRequest}
              statusLabel={VIEWING_REQUEST_STATUS_LABELS_FR[viewingRequest.status] || viewingRequest.status}
              relativeTime={formatRelativeFr(viewingRequest.created_at)}
              target={target}
            />
          );
        })
      )}
    </>
  );
}

export default async function AgentInquiriesPage({ searchParams }) {
  const params = await searchParams;
  const tab = ['ouvertes', 'visites'].includes(params.tab) ? params.tab : 'mes-demandes';
  const statusFilter = typeof params.status === 'string' && LEAD_STATUSES.includes(params.status) ? params.status : '';
  const visitStatusFilter =
    typeof params.status === 'string' && VIEWING_REQUEST_STATUSES.includes(params.status) ? params.status : '';
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const replySent = params.reply_sent === '1';
  const replyError = typeof params.reply_error === 'string' ? params.reply_error : null;

  const agentId = await getCurrentAgentId();
  const { agent, listingById, leadScope, hasLeadScope, newLeadsCount, pendingVisitsCount, listings } =
    await getAgentDashboardContext(agentId);

  const leadsPage = hasLeadScope
    ? await listLeads({ ...leadScope, status: statusFilter || undefined, limit: 100 })
    : { total: 0, data: [] };

  const visitsPage =
    tab === 'visites' && hasLeadScope
      ? await listViewingRequests({ ...leadScope, status: visitStatusFilter || undefined, limit: 100 })
      : { total: 0, data: [] };

  const needle = q.toLowerCase();
  const leads = needle
    ? leadsPage.data.filter((l) =>
        `${l.name || ''} ${l.wa_id || ''} ${l.requirements_summary || ''}`.toLowerCase().includes(needle),
      )
    : leadsPage.data;

  const unread = leadsPage.data.filter((l) => l.status === 'NEW').length;

  const feedAccess = hasDemandFeedAccess(agent);
  const inTrial = isWithinLaunchTrial();
  const trialEndsLabel = launchTrialEndsAtLabel();
  const communes = agent.primary_communes || [];
  const openLeadsPage = tab === 'ouvertes' || feedAccess
    ? await listOpenLeads({ communes, limit: 50 })
    : { total: 0, data: [] };
  const myActiveListings = listings.filter((l) => l.approve_status === 1 && l.listing_status === 'active');

  return (
    <>
      <AgentPageHeader
        title="Demandes"
        newLeadsCount={newLeadsCount}
        searchAction="/compte/agent/demandes"
        searchDefaultValue={q}
        searchPlaceholder="Rechercher un client"
        hiddenSearchFields={{ status: statusFilter }}
      />

      <div className="flex flex-col gap-4 px-5 py-7 sm:px-8">
        <div className="flex items-center gap-1 border-b border-line">
          {TABS.map((t) => (
            <Link
              key={t.value}
              href={`/compte/agent/demandes?tab=${t.value}`}
              className={`-mb-px border-b-2 px-3.5 py-2.5 text-[0.8125rem] font-semibold transition-colors ${
                tab === t.value ? 'border-blue text-blue-deep' : 'border-transparent text-ink-45 hover:text-ink'
              }`}
            >
              {t.label}
              {t.value === 'ouvertes' && openLeadsPage.total > 0 ? ` (${openLeadsPage.total})` : ''}
              {t.value === 'visites' && pendingVisitsCount > 0 ? ` (${pendingVisitsCount})` : ''}
            </Link>
          ))}
        </div>

        {tab === 'visites' ? (
          <VisitsTab
            visitsPage={visitsPage}
            statusFilter={visitStatusFilter}
            listingById={listingById}
            hasListings={listings.length > 0}
          />
        ) : tab === 'ouvertes' ? (
          <>
            {inTrial && !agent.package_title && (
              <p className="rounded-lg bg-blue-tint px-4 py-3 text-sm font-semibold text-blue-deep" role="status">
                Accès gratuit pendant la période de lancement
                {trialEndsLabel ? ` — jusqu'au ${trialEndsLabel}` : ''}.
              </p>
            )}

            {!feedAccess ? (
              <div className="u-card flex flex-col items-center gap-3 rounded-card bg-surface px-6 py-16 text-center">
                <p className="text-sm font-semibold text-ink">
                  {openLeadsPage.total} demande{openLeadsPage.total === 1 ? '' : 's'} ouverte
                  {openLeadsPage.total === 1 ? '' : 's'} dans vos communes
                </p>
                <p className="max-w-md text-sm text-ink-45">
                  Renouvelez votre abonnement pour voir le détail de ces demandes et proposer vos biens.
                </p>
                {(() => {
                  const href = getCentralWhatsAppHref('Bonjour, je souhaite renouveler mon abonnement Lukka Place.');
                  return href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="u-btn-primary u-press mt-1 inline-flex h-10 items-center rounded-lg bg-blue px-4 text-[0.8125rem] font-bold text-white"
                    >
                      Renouveler mon abonnement
                    </a>
                  ) : null;
                })()}
              </div>
            ) : openLeadsPage.data.length === 0 ? (
              <div className="u-card rounded-card bg-surface px-6 py-16 text-center text-sm text-ink-45">
                {communes.length === 0
                  ? 'Ajoutez vos communes couvertes dans vos paramètres pour voir les demandes ouvertes.'
                  : 'Aucune demande ouverte dans vos communes pour le moment.'}
              </div>
            ) : (
              openLeadsPage.data.map((lead) => (
                <AgentOpenLeadCard
                  key={lead.id}
                  lead={lead}
                  relativeTime={formatRelativeFr(lead.created_at)}
                  myListings={myActiveListings}
                />
              ))
            )}
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-[1.125rem] font-bold text-ink">
                  {leadsPage.total} demande{leadsPage.total === 1 ? '' : 's'}
                </div>
                <div className="mt-0.5 text-[0.8125rem] text-ink-45">
                  {unread} non lue{unread === 1 ? '' : 's'} · envoyées depuis votre page publique
                </div>
              </div>

              <form method="get" className="flex items-center gap-2">
                {q && <input type="hidden" name="q" value={q} />}
                <select
                  name="status"
                  defaultValue={statusFilter}
                  aria-label="Filtrer par statut"
                  className="u-focus-ring h-10 w-[11.25rem] rounded-lg border border-line bg-surface px-3 text-[0.8125rem] font-medium text-ink"
                >
                  <option value="">Toutes les demandes</option>
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="u-btn-secondary u-press h-10 rounded-lg px-3.5 text-[0.8125rem] font-bold text-ink"
                >
                  Filtrer
                </button>
              </form>
            </div>

            {replySent && (
              <p className="rounded-lg bg-success-tint px-4 py-3 text-sm font-semibold text-success" role="status">
                Réponse envoyée sur WhatsApp.
              </p>
            )}
            {replyError && (
              <p className="rounded-lg bg-danger-tint px-4 py-3 text-sm font-semibold text-danger" role="alert">
                {replyError === 'empty'
                  ? 'Votre message était vide — rien n’a été envoyé.'
                  : "L'envoi WhatsApp a échoué. Réessayez dans un instant."}
              </p>
            )}

            {leads.length === 0 ? (
              /* Three genuinely different empty states. Collapsing them told an
                 agent with 8 live listings and no filter set that "aucune
                 demande ne correspond à ces filtres" — blaming a filter they
                 never applied for an inbox that is simply still empty. */
              <div className="u-card rounded-card bg-surface px-6 py-16 text-center text-sm text-ink-45">
                {statusFilter || q
                  ? 'Aucune demande ne correspond à ces filtres.'
                  : listings.length === 0
                    ? 'Ajoutez un bien pour commencer à recevoir des demandes.'
                    : 'Aucune demande pour le moment. Partagez votre page publique pour en recevoir.'}
              </div>
            ) : (
              leads.map((lead) => {
                const property = lead.property_id ? listingById.get(String(lead.property_id)) : null;
                return (
                  <AgentLeadCard
                    key={lead.id}
                    lead={lead}
                    statusLabel={LEAD_STATUS_LABELS_FR[lead.status] || lead.status}
                    statusOptions={STATUS_OPTIONS}
                    relativeTime={formatRelativeFr(lead.created_at)}
                    budget={budgetText(lead)}
                    target={property?.title || [lead.quartier, lead.commune].filter(Boolean).join(', ') || null}
                    replyAction={replyToLeadAction.bind(null, lead.id)}
                    statusAction={updateAgentLeadStatusAction.bind(null, lead.id)}
                  />
                );
              })
            )}
          </>
        )}
      </div>
    </>
  );
}
