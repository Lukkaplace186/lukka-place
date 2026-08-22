import Link from 'next/link';
import { listConversations } from '@/lib/adminApi';
import { CONVERSATION_STATES, CONVERSATION_STATE_LABELS_FR } from '@/lib/adminLabels';

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
    new Date(`${value.replace(' ', 'T')}Z`),
  );
}

export default async function AdminConversationsPage({ searchParams }) {
  const params = await searchParams;
  const state = params.state || '';

  const { total, data } = await listConversations({ state: state || undefined, limit: 50 });

  return (
    <div>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">Conversations WhatsApp</h1>
          <p className="mt-1 text-sm text-ink-45">{total} conversation{total !== 1 ? 's' : ''}</p>
        </div>

        <form method="get" className="flex items-center gap-2">
          <select
            name="state"
            defaultValue={state}
            className="rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink"
          >
            <option value="">Tous les statuts</option>
            {CONVERSATION_STATES.map((s) => (
              <option key={s} value={s}>
                {CONVERSATION_STATE_LABELS_FR[s]}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas-alt">
            Filtrer
          </button>
        </form>
      </div>

      {data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">
          Aucune conversation.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-line bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-canvas-alt text-xs uppercase tracking-wide text-ink-45">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Statut</th>
                <th className="px-4 py-2.5 font-semibold">IA</th>
                <th className="px-4 py-2.5 font-semibold">Agent</th>
                <th className="px-4 py-2.5 font-semibold">Dernier message</th>
                <th className="px-4 py-2.5 font-semibold">Mis à jour</th>
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-b-0 hover:bg-canvas-alt">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/conversations/${c.id}`} className="font-medium text-blue-deep hover:underline">
                      {c.wa_id}
                    </Link>
                    {c.commune && <span className="ml-2 text-xs text-ink-45">{c.commune}</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full bg-blue-tint px-2 py-0.5 text-xs font-medium text-blue-deep">
                      {CONVERSATION_STATE_LABELS_FR[c.state] || c.state}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {c.ai_active ? (
                      <span className="text-xs font-medium text-green-deep">Active</span>
                    ) : (
                      <span className="text-xs font-medium text-ink-45">Silencieuse</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-ink-70">{c.assigned_agent || '—'}</td>
                  <td className="max-w-xs truncate px-4 py-2.5 text-ink-70">
                    {c.last_message ? `${c.last_message_direction === 'inbound' ? '← ' : '→ '}${c.last_message}` : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-45">{formatDate(c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
