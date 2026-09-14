'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { useT } from '@/lib/i18n/client';
import { addAdminNoteAction } from './notesActions';

/** The "add a note" box at the top of an entity timeline. */
export default function NoteForm({ entityType, entityId }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          let result;
          try {
            result = await addAdminNoteAction(entityType, entityId, body);
          } catch (err) {
            result = { ok: false, error: err.message };
          }
          showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error });
          if (result?.ok) {
            setBody('');
            router.refresh();
          }
        });
      }}
    >
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={2}
        maxLength={4000}
        placeholder={t('admin.notes.placeholder')}
        className="u-focus-ring rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink"
      />
      <button
        type="submit"
        disabled={pending || !body.trim()}
        className="u-press u-micro-strong self-start rounded-md border border-line bg-surface px-3 py-1.5 text-ink hover:border-blue disabled:opacity-50"
      >
        {t('admin.notes.add')}
      </button>
    </form>
  );
}
