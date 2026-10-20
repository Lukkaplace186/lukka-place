'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import DeleteAgentDialog from '../DeleteAgentDialog';

/**
 * "Supprimer l'agent" on the agent's own page. Same dialog as the agents
 * table's row menu (impact first, listings archived or deleted, the id typed
 * to confirm); afterwards it returns to the list, since this page is gone.
 */
export default function AgentDeleteButton({ agentId, agentName }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-danger/40 bg-surface px-3 text-danger hover:bg-danger/5"
      >
        <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
        {t('admin.agentPanel.deleteAgent')}
      </button>
      <DeleteAgentDialog
        agent={open ? { id: agentId, name: agentName } : null}
        onClose={() => setOpen(false)}
        onDeleted={() => router.push('/admin/agents')}
      />
    </>
  );
}
