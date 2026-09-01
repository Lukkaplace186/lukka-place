'use client';

import { useTransition } from 'react';
import { useToast } from '@/components/Toast';
import { updateAgentCommunesAction } from './actions';

/**
 * Communes desservies "Enregistrer" form — a client component (rather than
 * a plain `<form action>`) specifically so the Save click gets a pending
 * state and a success/error toast, per web/app/admin/agents/page.js's other
 * rows which give no feedback at all beyond the page silently re-rendering.
 */
export default function AgentCommunesForm({ agentId, communes, selectedCommunes }) {
  const [pending, startTransition] = useTransition();
  const { showToast } = useToast();
  const selected = new Set(selectedCommunes);

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await updateAgentCommunesAction(agentId, communes, formData);
      if (!result.ok) {
        showToast({ type: 'error', message: result.error });
        return;
      }
      showToast({ type: 'success', message: 'Communes desservies mises à jour.' });
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
      <div className="flex max-h-24 flex-wrap gap-x-3 gap-y-1 overflow-y-auto text-xs text-ink-70">
        {communes.map((commune) => (
          <label key={commune} className="flex items-center gap-1">
            <input type="checkbox" name="communes" value={commune} defaultChecked={selected.has(commune)} />
            {commune}
          </label>
        ))}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-canvas-alt disabled:opacity-60"
      >
        {pending ? 'Enregistrement…' : 'Enregistrer'}
      </button>
    </form>
  );
}
