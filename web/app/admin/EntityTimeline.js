import { History, StickyNote } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { formatKinshasa } from './LeadRoutingUI';
import NoteForm from './NoteForm';

function compactDetails(details) {
  if (!details || typeof details !== 'object') return null;
  const text = JSON.stringify(details);
  return text === '{}' ? null : text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

/**
 * One entity's history: the team's internal notes and every audited console
 * action taken on it, merged newest first. Who did what, and what the team
 * knows, in one column — instead of scattered across WhatsApp threads.
 */
export default async function EntityTimeline({ entityType, entityId, history = [], notes = [], canWrite = false }) {
  const t = await getT();
  const items = [
    ...notes.map((note) => ({ kind: 'note', id: `n${note.id}`, at: note.created_at, who: note.admin_name || note.actor_label, body: note.body })),
    ...history.map((row) => ({ kind: 'audit', id: `a${row.id}`, at: row.created_at, who: row.admin_name || row.actor_label, action: row.action, details: compactDetails(row.details) })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  return (
    <section className="u-card flex flex-col gap-3 rounded-card bg-surface p-5">
      <h2 className="u-title-card text-ink">{t('admin.notes.timelineTitle')}</h2>
      {canWrite ? <NoteForm entityType={entityType} entityId={entityId} /> : null}
      {items.length === 0 ? (
        <p className="u-micro text-ink-45">{t('admin.notes.timelineEmpty')}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="flex gap-2.5">
              {item.kind === 'note' ? (
                <StickyNote strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              ) : (
                <History strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-ink-35" />
              )}
              <div className="min-w-0">
                <div className="u-micro text-ink-45">
                  <span className="font-semibold text-ink-70">{item.who === 'shared-password' ? t('admin.chrome.sharedSession') : item.who}</span>
                  {' · '}
                  {formatKinshasa(item.at)}
                </div>
                {item.kind === 'note' ? (
                  <p className="whitespace-pre-line break-words text-sm text-ink">{item.body}</p>
                ) : (
                  <p className="u-micro text-ink-70">
                    <code className="rounded bg-canvas-alt px-1">{item.action}</code>
                    {item.details ? <span className="ml-1.5 break-all text-ink-45">{item.details}</span> : null}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
