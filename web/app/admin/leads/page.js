import Link from 'next/link';
import { listLeads } from '@/lib/adminApi';
import { getAgents } from '@/lib/agents';
import { LEAD_STATUSES, LEAD_STATUS_LABELS_FR } from '@/lib/adminLabels';
import { updateLeadStatusAction, assignLeadAction } from '../actions';

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${value.replace(' ', 'T')}Z`),
  );
}

function agentName(agent) {
  return [agent.first_name, agent.last_name].filter(Boolean).join(' ') || agent.username || `Agent #${agent.id}`;
}

function budgetText(lead) {
  const min = lead.price_min != null ? Number(lead.price_min).toLocaleString('fr-FR') : null;
  const max = lead.price_max != null ? Number(lead.price_max).toLocaleString('fr-FR') : null;
  if (min && max) return `$${min}–$${max}`;
  if (max) return `Jusqu'à $${max}`;
  if (min) return `À partir de $${min}`;
  return null;
}

const TRANSACTION_LABELS_FR = { location: 'Location', vente: 'Vente' };

/**
 * "Limete · Location · 2 ch. · $800–$1,000" — commune first (the field
 * Request Assignment Routing actually matches agents on), then the real
 * structured columns Trouver pour moi now populates. There is no
 * `property_type` column on `leads` at all (only `conversations` has one,
 * for the WhatsApp buyer-assistant flow) — showing one here would be
 * inventing data this table doesn't have, so it's deliberately omitted
 * rather than faked.
 */
function researchLine(lead) {
  const parts = [
    lead.commune,
    TRANSACTION_LABELS_FR[lead.transaction_type] || lead.transaction_type,
    lead.bedrooms ? `${lead.bedrooms} ch.` : null,
    budgetText(lead),
  ].filter(Boolean);
  return parts.join(' · ') || null;
}

export default async function AdminLeadsPage({ searchParams }) {
  const params = await searchParams;
  const status = params.status || '';

  const [{ total, data }, agents] = await Promise.all([
    listLeads({ status: status || undefined, limit: 50 }),
    getAgents(),
  ]);

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">Prospects</h1>
          <p className="mt-1 text-sm text-ink-45">{total} prospect{total !== 1 ? 's' : ''}</p>
        </div>

        <form method="get" className="flex items-center gap-2">
          <select
            name="status"
            defaultValue={status}
            className="rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink"
          >
            <option value="">Tous les statuts</option>
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

      {data.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">
          Aucun prospect.
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Recherche</th>
                <th className="px-4 py-2.5 font-semibold">Agent assigné</th>
                <th className="px-4 py-2.5 font-semibold">Créé le</th>
                <th className="px-4 py-2.5 font-semibold">Statut</th>
                <th className="px-4 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {data.map((lead) => {
                const boundUpdateStatus = updateLeadStatusAction.bind(null, lead.id);
                const boundAssign = assignLeadAction.bind(null, lead.id);
                const research = researchLine(lead);

                // Commune match first (a real signal from primary_communes),
                // then every other active agent as a manual fallback — never
                // hiding an option just because the request has no commune
                // or matches nobody yet.
                const matching = lead.commune
                  ? agents.filter((a) => a.status === 1 && (a.primary_communes || []).includes(lead.commune))
                  : [];
                const matchingIds = new Set(matching.map((a) => a.id));
                const others = agents.filter((a) => a.status === 1 && !matchingIds.has(a.id));

                return (
                  <tr key={lead.id} className="border-b border-line last:border-b-0 hover:bg-canvas-alt align-top">
                    <td className="px-4 py-2.5">
                      {lead.conversation_id ? (
                        <Link href={`/admin/conversations/${lead.conversation_id}`} className="font-medium text-blue-deep hover:underline">
                          {lead.name || lead.wa_id}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink">{lead.name || lead.wa_id}</span>
                      )}
                      <div className="mt-0.5 text-xs text-ink-45">{lead.wa_id}</div>
                    </td>
                    <td className="max-w-[20rem] px-4 py-2.5 text-ink-70">
                      {research ? (
                        <>
                          <div className="font-medium text-ink">{research}</div>
                          {lead.requirements_summary && (
                            <div className="mt-1 line-clamp-2 text-xs text-ink-45">{lead.requirements_summary}</div>
                          )}
                        </>
                      ) : (
                        // Legacy lead with none of the structured columns set
                        // (predates the "Trouver pour moi" fix, or came in
                        // through a path that never populated them) — fall
                        // back to the free-text summary rather than a bare '—'.
                        <div className="line-clamp-2 text-ink-70">
                          {lead.requirements_summary || '—'}
                        </div>
                      )}
                      <div className="mt-1.5 text-xs text-ink-45">
                        Propositions : {lead.pitches_count || 0}/7
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <form action={boundAssign} className="flex items-center gap-1.5">
                        <select
                          name="agent_id"
                          defaultValue={lead.agent_id ?? ''}
                          className="rounded-md border border-line bg-white px-2 py-1 text-xs text-ink"
                        >
                          <option value="">— Non assigné —</option>
                          {matching.length > 0 && (
                            <optgroup label={`Couvre ${lead.commune}`}>
                              {matching.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {agentName(a)}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          <optgroup label="Tous les agents">
                            {others.map((a) => (
                              <option key={a.id} value={a.id}>
                                {agentName(a)}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                        <button type="submit" className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-canvas-alt">
                          Assigner
                        </button>
                      </form>
                      {lead.assigned_agent && (
                        <div className="mt-1 text-xs text-ink-45">Actuel : {lead.assigned_agent}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-45">{formatDate(lead.created_at)}</td>
                    <td className="px-4 py-2.5">
                      <form action={boundUpdateStatus} className="flex items-center gap-1.5">
                        <select
                          name="status"
                          defaultValue={lead.status}
                          className="rounded-full border border-line bg-white px-2 py-1 text-xs font-medium text-ink"
                        >
                          {LEAD_STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {LEAD_STATUS_LABELS_FR[s]}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="rounded-full border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-canvas-alt">
                          OK
                        </button>
                      </form>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Link href={`/admin/leads/${lead.id}`} className="text-xs font-medium text-blue-deep hover:underline">
                        Voir le détail
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
