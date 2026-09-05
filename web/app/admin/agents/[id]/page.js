import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { getAgentForAdmin, getAgents } from '@/lib/agents';
import { getLocationHierarchyWithFallback } from '@/lib/locations';
import { getAgentBillingHistory } from '@/lib/subscriptions';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import AgentAdminPanel from './AgentAdminPanel';

export const metadata = {
  title: 'Agent — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  if (date.getUTCFullYear() >= 9999) return 'Illimité';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-lg bg-canvas-alt px-4 py-3">
      <div className="u-eyebrow text-ink-45">{label}</div>
      <div className={`mt-1 text-[1.0625rem] font-bold ${tone || 'text-ink'}`}>{value}</div>
    </div>
  );
}

/**
 * Full identity control for one agency — the "edit agent profiles, agency
 * affiliations, territory boundaries and verification badges" the console
 * previously scattered across three inline table widgets and, for territory
 * coverage and the verification badge, did not offer at all.
 *
 * Everything on this page is a real column. Notably absent, deliberately: any
 * notion of a per-agent role or permission set. This schema has one
 * `role_permissions` table belonging to the Laravel back-office, not to these
 * self-service agent accounts, and inventing a second permission model here
 * would be a UI that claims an authority nothing enforces.
 */
export default async function AdminAgentDetailPage({ params }) {
  const { id } = await params;
  const agent = await getAgentForAdmin(id);
  if (!agent) notFound();

  const [{ communes }, allAgents, billing] = await Promise.all([
    getLocationHierarchyWithFallback(),
    getAgents(),
    getAgentBillingHistory(agent.vendor_id),
  ]);

  const otherAgents = allAgents
    .filter((a) => Number(a.id) !== agent.id)
    .map((a) => ({
      id: Number(a.id),
      label:
        [a.first_name, a.last_name].filter(Boolean).join(' ') ||
        a.agency_name ||
        a.username ||
        `Agent #${a.id}`,
    }));

  const displayName =
    [agent.first_name, agent.last_name].filter(Boolean).join(' ') || agent.username || `Agent #${agent.id}`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/admin/agents"
          className="u-micro-strong inline-flex items-center gap-1.5 text-ink-45 hover:text-ink"
        >
          <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          Retour aux agents
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="u-title-page text-ink">{displayName}</h1>
          {agent.phone_verified_at ? (
            <span className="rounded-full bg-success-tint px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-success">
              Vérifié
            </span>
          ) : (
            <span className="rounded-full bg-warning-tint px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-warning">
              Non vérifié
            </span>
          )}
          {agent.status === 0 && (
            <span className="rounded-full bg-danger-tint px-2.5 py-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.1em] text-danger">
              Suspendu
            </span>
          )}
        </div>

        <div className="u-micro mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-45">
          <span className="u-tabular">{agent.phone || '—'}</span>
          <span>{agent.agency_name || agent.vendor_username || 'Agence non renseignée'}</span>
          <span>Inscrit le {formatDate(agent.created_at)}</span>
          <Link
            href={`/agents/${agent.id}`}
            target="_blank"
            className="inline-flex items-center gap-1 font-semibold text-blue-deep hover:underline"
          >
            Page publique
            <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Biens (total / quota)"
          value={`${agent.listing_count}${agent.listing_limit != null ? ` / ${agent.listing_limit}` : ''}`}
          tone={
            agent.listing_limit != null && agent.listing_count >= agent.listing_limit ? 'text-danger' : undefined
          }
        />
        <Stat label="En ligne" value={agent.live_listing_count} />
        <Stat label="Forfait" value={agent.package_title || 'Aucun'} />
        <Stat
          label="Échéance"
          value={formatDate(agent.expire_date)}
          tone={
            agent.expire_date && new Date(agent.expire_date) < new Date() ? 'text-danger' : undefined
          }
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:items-start">
        <AgentAdminPanel
          agent={agent}
          communes={communes}
          otherAgents={otherAgents}
          listingCount={agent.listing_count}
        />

        <div className="u-card flex flex-col gap-3 rounded-card bg-surface p-6">
          <h2 className="u-title-card text-ink">Historique d’abonnement</h2>
          {billing.length === 0 ? (
            <p className="u-micro text-ink-45">
              Aucun paiement enregistré. Attribuez un forfait depuis{' '}
              <Link href="/admin/subscriptions" className="font-semibold text-blue-deep hover:underline">
                Abonnements
              </Link>
              .
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {billing.map((row) => (
                <li key={row.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="u-micro-strong truncate text-ink">{row.package_title || '—'}</div>
                    <div className="u-micro text-ink-45">
                      {formatDate(row.start_date)} → {formatDate(row.expire_date)}
                      {row.payment_method ? ` · ${row.payment_method}` : ''}
                    </div>
                  </div>
                  <div className="u-micro u-tabular shrink-0 text-ink-70">
                    {row.price != null ? `${Number(row.price).toLocaleString('fr-FR')} ${row.currency_symbol || '$'}` : '—'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
