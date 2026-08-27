import { Phone, Calculator, MapPin, Send } from 'lucide-react';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentProfile, getOwnListingsForDashboard, agentDisplayName } from '@/lib/agencies';
import { listLeads } from '@/lib/adminApi';
import { LEAD_STATUSES, LEAD_STATUS_LABELS_FR } from '@/lib/adminLabels';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import AgentPageHeader from '@/components/AgentPageHeader';
import { updateAgentLeadStatusAction } from '../actions';

const STATUS_TAG = {
  NEW: 'bg-blue-tint text-blue-deep',
  CONTACTED: 'bg-brass-tint text-brass-deep',
  QUALIFIED: 'bg-green-tint text-green-deep',
  VIEWING_REQUESTED: 'bg-brass-tint text-brass-deep',
  VIEWING_COMPLETED: 'bg-blue-tint text-blue-deep',
  CONVERTED: 'bg-green-tint text-green-deep',
  LOST: 'bg-canvas-deep text-ink-45',
};

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
    new Date(`${value.replace(' ', 'T')}Z`),
  );
}

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
  const statusFilter = typeof params.status === 'string' ? params.status : '';

  const agentId = await getCurrentAgentId();
  const agent = await getAgentProfile(agentId);
  const listings = await getOwnListingsForDashboard(agentId);
  const propertyIds = listings.map((l) => l.id);
  const listingById = new Map(listings.map((l) => [l.id, l]));
  const displayName = agentDisplayName(agent);

  const leadsPage =
    propertyIds.length || displayName
      ? await listLeads({ propertyIds, assignedAgent: displayName || undefined, status: statusFilter || undefined, limit: 100 })
      : { total: 0, data: [] };

  return (
    <>
      <AgentPageHeader
        title="Demandes"
        subtitle={`${leadsPage.total} demande${leadsPage.total === 1 ? '' : 's'} · envoyées depuis votre page publique`}
      />

      <div className="flex flex-col gap-4 px-5 py-6 sm:px-8">
        <div className="flex justify-end">
          <form method="get" className="flex items-center gap-2">
            <select
              name="status"
              defaultValue={statusFilter}
              className="rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink"
            >
              <option value="">Toutes les demandes</option>
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_LABELS_FR[s]}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas-alt">
              Filtrer
            </button>
          </form>
        </div>

        {leadsPage.data.length === 0 ? (
          <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">
            {listings.length === 0 && leadsPage.total === 0
              ? 'Ajoutez un bien pour recevoir des demandes.'
              : 'Aucune demande pour ce filtre.'}
          </div>
        ) : (
          leadsPage.data.map((lead) => {
            const property = lead.property_id ? listingById.get(lead.property_id) : null;
            const budget = budgetText(lead);
            const location = [lead.quartier, lead.commune].filter(Boolean).join(', ');
            const boundStatus = updateAgentLeadStatusAction.bind(null, lead.id);

            return (
              <div key={lead.id} className="rounded-card border border-line bg-white p-5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-base font-bold text-ink">{lead.name || lead.wa_id}</span>
                  <span className={`rounded-full px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-wide ${STATUS_TAG[lead.status] || STATUS_TAG.NEW}`}>
                    {LEAD_STATUS_LABELS_FR[lead.status] || lead.status}
                  </span>
                  <span className="text-xs text-ink-35">{formatDate(lead.created_at)}</span>
                </div>

                {lead.requirements_summary && (
                  <p className="mt-2 text-sm leading-relaxed text-ink-70">{lead.requirements_summary}</p>
                )}

                <div className="mt-3.5 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-3.5 text-sm text-ink-70">
                  <span className="inline-flex items-center gap-1.5">
                    <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-35" />
                    {lead.wa_id}
                  </span>
                  {budget && (
                    <span className="inline-flex items-center gap-1.5">
                      <Calculator strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-35" />
                      {budget}
                    </span>
                  )}
                  {(property || location) && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-35" />
                      {property ? property.title : location}
                    </span>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <a
                    href={buildWhatsAppLink(
                      lead.wa_id,
                      `Bonjour ${lead.name || ''}, merci pour votre intérêt${property ? ` pour « ${property.title} »` : ''} sur Lukka Place.`,
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-green bg-green-tint px-4 py-2 text-sm font-bold text-green-deep hover:bg-green hover:text-white"
                  >
                    <Send strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                    Répondre sur WhatsApp
                  </a>

                  <form action={boundStatus} className="flex items-center gap-1.5">
                    <select name="status" defaultValue={lead.status} className="rounded-full border border-line bg-white px-2.5 py-1.5 text-xs font-medium text-ink">
                      {LEAD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {LEAD_STATUS_LABELS_FR[s]}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="rounded-full border border-line px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-canvas-alt">
                      OK
                    </button>
                  </form>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
