import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { listLeads } from '@/lib/adminApi';
import { LEAD_STATUSES, LEAD_STATUS_LABELS_FR } from '@/lib/adminLabels';
import { formatRelativeFr } from '@/lib/format';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentLeadCard from '@/components/AgentLeadCard';
import { updateAgentLeadStatusAction, replyToLeadAction } from '../actions';

const STATUS_OPTIONS = LEAD_STATUSES.map((value) => ({ value, label: LEAD_STATUS_LABELS_FR[value] }));

function budgetText(lead) {
  const min = lead.price_min != null ? Number(lead.price_min).toLocaleString('fr-FR') : null;
  const max = lead.price_max != null ? Number(lead.price_max).toLocaleString('fr-FR') : null;
  if (min && max) return `${min} – ${max} $`;
  if (max) return `Jusqu'à ${max} $`;
  if (min) return `À partir de ${min} $`;
  return null;
}

export default async function AgentInquiriesPage({ searchParams }) {
  const params = await searchParams;
  const statusFilter = typeof params.status === 'string' && LEAD_STATUSES.includes(params.status) ? params.status : '';
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const replySent = params.reply_sent === '1';
  const replyError = typeof params.reply_error === 'string' ? params.reply_error : null;

  const agentId = await getCurrentAgentId();
  const { listingById, leadScope, hasLeadScope, newLeadsCount, listings } = await getAgentDashboardContext(agentId);

  const leadsPage = hasLeadScope
    ? await listLeads({ ...leadScope, status: statusFilter || undefined, limit: 100 })
    : { total: 0, data: [] };

  const needle = q.toLowerCase();
  const leads = needle
    ? leadsPage.data.filter((l) =>
        `${l.name || ''} ${l.wa_id || ''} ${l.requirements_summary || ''}`.toLowerCase().includes(needle),
      )
    : leadsPage.data;

  const unread = leadsPage.data.filter((l) => l.status === 'NEW').length;

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
            const property = lead.property_id ? listingById.get(lead.property_id) : null;
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
      </div>
    </>
  );
}
