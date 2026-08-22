import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getConversationDetail } from '@/lib/adminApi';
import { CONVERSATION_STATE_LABELS_FR, LEAD_STATUS_LABELS_FR } from '@/lib/adminLabels';
import {
  assignAgentAction, saveNotesAction, takeOverAction, returnToAiAction, sendReplyAction,
} from '../../actions';

function formatDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(`${value.replace(' ', 'T')}Z`),
  );
}

const REQUIREMENT_LABELS = [
  ['transaction_type', 'Transaction'],
  ['property_type', 'Type de bien'],
  ['commune', 'Commune'],
  ['quartier', 'Quartier'],
  ['price_min', 'Prix min'],
  ['price_max', 'Prix max'],
  ['bedrooms', 'Chambres'],
];

export default async function AdminConversationDetailPage({ params }) {
  const { id: idParam } = await params;
  const id = Number.parseInt(idParam, 10);
  if (!Number.isFinite(id)) notFound();

  let detail;
  try {
    detail = await getConversationDetail(id);
  } catch (err) {
    if (err.message.includes('404') || /not found/i.test(err.message)) notFound();
    throw err;
  }

  const { conversation, messages, leads } = detail;
  const boundAssign = assignAgentAction.bind(null, id);
  const boundNotes = saveNotesAction.bind(null, id);
  const boundTakeOver = takeOverAction.bind(null, id);
  const boundReturnToAi = returnToAiAction.bind(null, id);
  const boundReply = sendReplyAction.bind(null, id);

  return (
    <div>
      <Link href="/admin/conversations" className="text-sm text-blue-deep hover:underline">
        ← Toutes les conversations
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-[-0.02em] text-ink">{conversation.wa_id}</h1>
          <div className="mt-1 flex items-center gap-2">
            <span className="rounded-full bg-blue-tint px-2 py-0.5 text-xs font-medium text-blue-deep">
              {CONVERSATION_STATE_LABELS_FR[conversation.state] || conversation.state}
            </span>
            <span className={`text-xs font-medium ${conversation.ai_active ? 'text-green-deep' : 'text-ink-45'}`}>
              {conversation.ai_active ? 'IA active' : 'IA silencieuse (agent aux commandes)'}
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          {conversation.ai_active ? (
            <form action={boundTakeOver}>
              <button type="submit" className="rounded-full bg-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-deep">
                Prendre en main
              </button>
            </form>
          ) : (
            <form action={boundReturnToAi}>
              <button type="submit" className="rounded-full border border-blue px-4 py-2 text-sm font-semibold text-blue-deep hover:bg-blue-tint">
                Rendre à l&apos;IA
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Transcription</h2>
            {messages.length === 0 ? (
              <p className="text-sm text-ink-45">Aucun message.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      m.direction === 'inbound'
                        ? 'self-start bg-canvas-alt text-ink'
                        : 'self-end bg-blue text-white'
                    }`}
                  >
                    <p className="whitespace-pre-line">{m.text}</p>
                    <p className={`mt-1 text-[10px] ${m.direction === 'inbound' ? 'text-ink-25' : 'text-white/60'}`}>
                      {formatDateTime(m.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            )}

            <form action={boundReply} className="mt-4 flex gap-2 border-t border-line pt-4">
              <input
                type="text"
                name="text"
                placeholder={conversation.ai_active ? 'Écrire un message (bascule automatiquement l\'IA en silence non — pensez à «Prendre en main»)' : 'Écrire une réponse...'}
                className="flex-1 rounded-md border border-line px-3 py-2 text-sm text-ink focus:border-blue focus:outline-none"
              />
              <button type="submit" className="rounded-md bg-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-deep">
                Envoyer
              </button>
            </form>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Critères connus</h2>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {REQUIREMENT_LABELS.map(([field, label]) => (
                <div key={field}>
                  <dt className="text-xs text-ink-45">{label}</dt>
                  <dd className="text-ink">{conversation[field] ?? '—'}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Agent assigné</h2>
            <form action={boundAssign} className="flex gap-2">
              <input
                type="text"
                name="assigned_agent"
                defaultValue={conversation.assigned_agent || ''}
                placeholder="Nom de l'agent"
                className="flex-1 rounded-md border border-line px-3 py-1.5 text-sm text-ink focus:border-blue focus:outline-none"
              />
              <button type="submit" className="rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas-alt">
                Enregistrer
              </button>
            </form>
          </div>

          <div className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Notes internes</h2>
            <form action={boundNotes} className="flex flex-col gap-2">
              <textarea
                name="notes"
                defaultValue={conversation.notes || ''}
                rows={4}
                placeholder="Jamais visible par le client..."
                className="rounded-md border border-line px-3 py-2 text-sm text-ink focus:border-blue focus:outline-none"
              />
              <button type="submit" className="self-start rounded-md border border-line px-3 py-1.5 text-sm font-medium text-ink hover:bg-canvas-alt">
                Enregistrer
              </button>
            </form>
          </div>

          <div className="rounded-lg border border-line bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Prospects liés</h2>
            {leads.length === 0 ? (
              <p className="text-sm text-ink-45">Aucun prospect pour cette conversation.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {leads.map((l) => (
                  <li key={l.id} className="rounded-md border border-line p-2.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink">#{l.id}</span>
                      <span className="rounded-full bg-blue-tint px-2 py-0.5 text-xs font-medium text-blue-deep">
                        {LEAD_STATUS_LABELS_FR[l.status] || l.status}
                      </span>
                    </div>
                    {l.requirements_summary && <p className="mt-1 text-xs text-ink-45">{l.requirements_summary}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
