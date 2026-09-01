import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getLead, getLeadProposals } from '@/lib/adminApi';
import { getAgents } from '@/lib/agents';
import { getListingsByIds } from '@/lib/listings';
import { LEAD_STATUSES, LEAD_STATUS_LABELS_FR } from '@/lib/adminLabels';
import { updateLeadStatusAction, assignLeadAction } from '../../actions';

function formatDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(`${value.replace(' ', 'T')}Z`),
  );
}

function agentName(agent) {
  return [agent.first_name, agent.last_name].filter(Boolean).join(' ') || agent.username || `Agent #${agent.id}`;
}

const REQUEST_LABELS = [
  ['transaction_type', 'Transaction'],
  ['commune', 'Commune'],
  ['quartier', 'Quartier'],
  ['price_min', 'Budget min'],
  ['price_max', 'Budget max'],
  ['bedrooms', 'Chambres'],
];

/**
 * Admin Prospects detail — the same "click through to a real page" pattern
 * /admin/conversations/[id] already established, rather than a modal/drawer:
 * this dashboard has no client components anywhere yet, and a real URL a
 * teammate can bookmark/share beats a bit of extra polish here.
 */
export default async function AdminLeadDetailPage({ params }) {
  const { id: idParam } = await params;
  const id = Number.parseInt(idParam, 10);
  if (!Number.isFinite(id)) notFound();

  let lead;
  try {
    ({ lead } = await getLead(id));
  } catch (err) {
    if (/not found/i.test(err.message) || err.message.includes('404')) notFound();
    throw err;
  }
  if (!lead) notFound();

  const [{ proposals }, agents] = await Promise.all([
    getLeadProposals([id]),
    getAgents(),
  ]);

  const propertyIds = proposals.map((p) => p.property_id);
  const listings = propertyIds.length > 0 ? await getListingsByIds(propertyIds) : [];
  const listingById = new Map(listings.map((l) => [String(l.id), l]));
  const agentById = new Map(agents.map((a) => [String(a.id), a]));

  const enrichedProposals = proposals.map((p) => ({
    ...p,
    agent: agentById.get(String(p.agent_id)) || null,
    property: listingById.get(String(p.property_id)) || null,
  }));

  const matching = lead.commune
    ? agents.filter((a) => a.status === 1 && (a.primary_communes || []).includes(lead.commune))
    : [];
  const matchingIds = new Set(matching.map((a) => a.id));
  const others = agents.filter((a) => a.status === 1 && !matchingIds.has(a.id));

  const boundAssign = assignLeadAction.bind(null, lead.id);
  const boundUpdateStatus = updateLeadStatusAction.bind(null, lead.id);

  return (
    <div>
      <Link href="/admin/leads" className="text-sm text-blue-deep hover:underline">
        ← Tous les prospects
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">{lead.name || lead.wa_id}</h1>
          <p className="mt-1 text-sm text-ink-45">
            {lead.wa_id} · Demande #{lead.id} · Créée le {formatDateTime(lead.created_at)}
          </p>
        </div>
        <span className="rounded-full bg-blue-tint px-2.5 py-1 text-xs font-medium text-blue-deep">
          {LEAD_STATUS_LABELS_FR[lead.status] || lead.status}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4">
          <div className="rounded-card border border-line bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Critères de recherche</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {REQUEST_LABELS.map(([field, label]) => (
                <div key={field}>
                  <dt className="text-xs text-ink-45">{label}</dt>
                  <dd className="text-ink">{lead[field] ?? '—'}</dd>
                </div>
              ))}
            </dl>

            {lead.requirements_summary && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="mb-1.5 text-xs font-semibold text-ink-45">Texte complet de la demande</p>
                <p className="whitespace-pre-line text-sm text-ink-70">{lead.requirements_summary}</p>
              </div>
            )}
          </div>

          <div className="rounded-card border border-line bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">
              Propositions des agents ({proposals.length}/7)
            </h2>
            {enrichedProposals.length === 0 ? (
              <p className="text-sm text-ink-45">Aucune proposition pour le moment.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {enrichedProposals.map((p) => (
                  <li key={p.id} className="rounded-md border border-line p-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink">
                        {p.agent ? agentName(p.agent) : `Agent #${p.agent_id}`}
                      </span>
                      <span className="text-xs text-ink-45">{formatDateTime(p.created_at)}</span>
                    </div>
                    <p className="mt-0.5 text-ink-70">
                      {p.property ? p.property.title : `Bien #${p.property_id} (introuvable)`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-card border border-line bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Client</h2>
            <dl className="flex flex-col gap-2 text-sm">
              <div>
                <dt className="text-xs text-ink-45">Nom</dt>
                <dd className="text-ink">{lead.name || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-45">WhatsApp</dt>
                <dd className="text-ink">{lead.wa_id}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-45">Source</dt>
                <dd className="text-ink">{lead.source}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-card border border-line bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Agent assigné</h2>
            <form action={boundAssign} className="flex flex-col gap-2">
              <select
                name="agent_id"
                defaultValue={lead.agent_id ?? ''}
                className="rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink"
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
              <button type="submit" className="self-start rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas-alt">
                Assigner
              </button>
            </form>
            {lead.assigned_agent && (
              <p className="mt-2 text-xs text-ink-45">Actuel : {lead.assigned_agent}</p>
            )}
          </div>

          <div className="rounded-card border border-line bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Statut</h2>
            <form action={boundUpdateStatus} className="flex flex-col gap-2">
              <select
                name="status"
                defaultValue={lead.status}
                className="rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink"
              >
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {LEAD_STATUS_LABELS_FR[s]}
                  </option>
                ))}
              </select>
              <button type="submit" className="self-start rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas-alt">
                Mettre à jour
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
