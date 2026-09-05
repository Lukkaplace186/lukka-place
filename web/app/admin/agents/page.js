import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { getAgents, getVendors, findDuplicateAgents } from '@/lib/agents';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getLocationHierarchySafe } from '@/lib/locations';
import { AGENT_STATUS_LABELS_FR } from '@/lib/adminLabels';
import { updateAgentStatusAction, reassignAgentVendorAction } from './actions';
import AgentCommunesForm from './AgentCommunesForm';

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export default async function AdminAgentsPage({ searchParams }) {
  const params = await searchParams;
  const q = params.q || '';

  const [agents, vendors, { communes, degraded }, duplicates] = await Promise.all([
    getAgents({ q: q || undefined }),
    getVendors(),
    getLocationHierarchySafe(),
    findDuplicateAgents(),
  ]);

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">Agents</h1>
          <p className="mt-1 text-sm text-ink-45">
            {agents.length} agent{agents.length !== 1 ? 's' : ''}
          </p>
        </div>

        <form method="get" className="flex items-center gap-2">
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Nom, email ou téléphone"
            className="rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink"
          />
          <button
            type="submit"
            className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas-alt"
          >
            Rechercher
          </button>
        </form>
      </div>

      {/* Duplicate detection. Two real signals only — the same number written
          three different ways, and the same email — never name similarity,
          which would group unrelated agencies sharing a common Kinshasa name
          and present a guess as a finding. This flags for REVIEW; nothing is
          merged automatically. */}
      {duplicates.length > 0 && (
        <div className="mb-4 rounded-card border border-warning/40 bg-warning-tint p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-warning" />
            <h2 className="u-title-card text-warning">
              {duplicates.length} doublon{duplicates.length === 1 ? '' : 's'} potentiel
              {duplicates.length === 1 ? '' : 's'}
            </h2>
          </div>
          <ul className="mt-2.5 flex flex-col gap-2">
            {duplicates.map((group) => (
              <li key={`${group.kind}-${group.key}`} className="u-micro text-ink-70">
                <span className="font-bold text-ink">
                  {group.kind === 'phone' ? 'Même numéro' : 'Même email'} : {group.key}
                </span>
                {' — '}
                {group.accounts.map((a, i) => (
                  <span key={a.id}>
                    {i > 0 ? ', ' : ''}
                    <Link href={`/admin/agents/${a.id}`} className="font-semibold text-blue-deep hover:underline">
                      #{a.id} {a.username || ''}
                    </Link>
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <p className="u-micro mt-2 text-ink-45">
            Vérifiez chaque groupe avant d&apos;agir : transférez le portefeuille vers le compte à
            conserver, puis suspendez l&apos;autre.
          </p>
        </div>
      )}

      {agents.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">
          Aucun agent.
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Nom</th>
                <th className="px-4 py-2.5 font-semibold">Téléphone / WhatsApp</th>
                <th className="px-4 py-2.5 font-semibold">Tél. vérifié</th>
                <th className="px-4 py-2.5 font-semibold">Agence</th>
                <th className="px-4 py-2.5 font-semibold">Communes desservies</th>
                <th className="px-4 py-2.5 font-semibold">Annonces</th>
                <th className="px-4 py-2.5 font-semibold">Statut</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const boundUpdateStatus = updateAgentStatusAction.bind(null, agent.id);
                const boundReassign = reassignAgentVendorAction.bind(null, agent.id);
                const fullName = [agent.first_name, agent.last_name].filter(Boolean).join(' ') || agent.username || '—';
                const expireLabel = formatDate(agent.expire_date);

                return (
                  <tr key={agent.id} className="border-b border-line last:border-b-0 hover:bg-canvas-alt">
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/admin/agents/${agent.id}`}
                        className="font-medium text-ink hover:text-blue-deep hover:underline"
                      >
                        {fullName}
                      </Link>
                      <div className="text-xs text-ink-45">{agent.email || '—'}</div>
                    </td>
                    <td className="px-4 py-2.5 text-ink-70">{agent.phone || '—'}</td>
                    <td className="px-4 py-2.5">
                      {/* Read-only here. It IS revocable/grantable, but only on
                          the agent detail page, behind an explanation of what
                          the badge asserts — a one-click toggle in a table row
                          is too easy to hit by accident for a claim that
                          governs public attribution and lead routing. */}
                      {agent.phone_verified_at ? (
                        <span className="rounded-full bg-green-tint px-2 py-0.5 text-xs font-medium text-green-deep">Oui</span>
                      ) : (
                        <span className="text-xs text-ink-45">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <form action={boundReassign} className="flex items-center gap-1.5">
                        <select
                          name="vendor_id"
                          defaultValue={agent.vendor_id ?? ''}
                          className="rounded-md border border-line bg-white px-2 py-1 text-xs text-ink"
                        >
                          <option value="">— Aucune agence —</option>
                          {vendors.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.username}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-canvas-alt">
                          OK
                        </button>
                      </form>
                    </td>
                    <td className="px-4 py-2.5">
                      {degraded ? (
                        <span className="text-xs text-ink-45">Liste des communes indisponible (moteur injoignable)</span>
                      ) : (
                        <AgentCommunesForm
                          agentId={agent.id}
                          communes={communes}
                          selectedCommunes={agent.primary_communes || []}
                        />
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ink-70">
                      {/* Total against the package cap — packages.number_of_property
                          limits how many listings an agency may hold, not how many
                          are live, so the quota figure is the total. The live count
                          is spelled out beside it because the bare number reads as
                          "listings on the site" and is not that. */}
                      {agent.listing_count} {agent.listing_limit != null ? `/ ${agent.listing_limit}` : ''}
                      {agent.live_listing_count !== agent.listing_count ? (
                        <div className="text-xs text-ink-45">{agent.live_listing_count} en ligne</div>
                      ) : null}
                      {agent.package_title ? (
                        <div className="text-xs text-ink-45">
                          {agent.package_title}
                          {expireLabel ? ` · jusqu'au ${expireLabel}` : ''}
                        </div>
                      ) : (
                        <div className="text-xs text-ink-45">Aucun abonnement actif</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <form action={boundUpdateStatus} className="flex items-center gap-1.5">
                        <select
                          name="status"
                          defaultValue={agent.status}
                          className="rounded-full border border-line bg-white px-2 py-1 text-xs font-medium text-ink"
                        >
                          {Object.entries(AGENT_STATUS_LABELS_FR).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <button type="submit" className="rounded-full border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-canvas-alt">
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
      )}
    </div>
  );
}
