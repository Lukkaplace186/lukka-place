import Link from 'next/link';
import { listLeads } from '@/lib/adminApi';
import { LEAD_STATUSES, LEAD_STATUS_LABELS_FR } from '@/lib/adminLabels';
import { updateLeadStatusAction } from '../actions';

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${value.replace(' ', 'T')}Z`),
  );
}

export default async function AdminLeadsPage({ searchParams }) {
  const params = await searchParams;
  const status = params.status || '';

  const { total, data } = await listLeads({ status: status || undefined, limit: 50 });

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">Prospects</h1>
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
                <th className="px-4 py-2.5 font-semibold">Agent</th>
                <th className="px-4 py-2.5 font-semibold">Créé le</th>
                <th className="px-4 py-2.5 font-semibold">Statut</th>
              </tr>
            </thead>
            <tbody>
              {data.map((lead) => {
                const boundUpdateStatus = updateLeadStatusAction.bind(null, lead.id);
                return (
                  <tr key={lead.id} className="border-b border-line last:border-b-0 hover:bg-canvas-alt">
                    <td className="px-4 py-2.5">
                      {lead.conversation_id ? (
                        <Link href={`/admin/conversations/${lead.conversation_id}`} className="font-medium text-blue-deep hover:underline">
                          {lead.wa_id}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink">{lead.wa_id}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ink-70">
                      {[lead.transaction_type, lead.commune, lead.bedrooms ? `${lead.bedrooms} ch.` : null]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-ink-70">{lead.assigned_agent || '—'}</td>
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
