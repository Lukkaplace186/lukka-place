import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { listViewingRequests } from '@/lib/adminApi';
import { VIEWING_REQUEST_STATUSES, VIEWING_REQUEST_STATUS_LABELS_FR } from '@/lib/adminLabels';
import { formatRelativeFr } from '@/lib/format';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentVisitRequestCard from '@/components/AgentVisitRequestCard';

const STATUS_OPTIONS = VIEWING_REQUEST_STATUSES.map((value) => ({ value, label: VIEWING_REQUEST_STATUS_LABELS_FR[value] }));

export default async function AgentVisitsPage({ searchParams }) {
  const params = await searchParams;
  const statusFilter = typeof params.status === 'string' && VIEWING_REQUEST_STATUSES.includes(params.status) ? params.status : '';

  const agentId = await getCurrentAgentId();
  const { listingById, leadScope, hasLeadScope, newLeadsCount, listings } = await getAgentDashboardContext(agentId);

  const visitsPage = hasLeadScope
    ? await listViewingRequests({ ...leadScope, status: statusFilter || undefined, limit: 100 })
    : { total: 0, data: [] };

  const pending = visitsPage.data.filter((v) => v.status === 'PENDING').length;

  return (
    <>
      <AgentPageHeader title="Visites" newLeadsCount={newLeadsCount} />

      <div className="flex flex-col gap-4 px-5 py-7 sm:px-8">
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
            <select
              name="status"
              defaultValue={statusFilter}
              aria-label="Filtrer par statut"
              className="u-focus-ring h-10 w-[11.25rem] rounded-lg border border-line bg-surface px-3 text-[0.8125rem] font-medium text-ink"
            >
              <option value="">Toutes les visites</option>
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

        {visitsPage.data.length === 0 ? (
          <div className="u-card rounded-card bg-surface px-6 py-16 text-center text-sm text-ink-45">
            {statusFilter
              ? 'Aucune visite ne correspond à ce filtre.'
              : listings.length === 0
                ? 'Ajoutez un bien pour commencer à recevoir des demandes de visite.'
                : 'Aucune demande de visite pour le moment.'}
          </div>
        ) : (
          visitsPage.data.map((viewingRequest) => {
            const propertyId = viewingRequest.property_id || viewingRequest.lead_property_id;
            const property = propertyId ? listingById.get(String(propertyId)) : null;
            const target =
              property?.title || [viewingRequest.lead_quartier, viewingRequest.lead_commune].filter(Boolean).join(', ') || null;

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
      </div>
    </>
  );
}
