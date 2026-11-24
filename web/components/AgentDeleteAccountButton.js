'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/**
 * "Supprimer mon compte" for agents (Réglages). Irreversible, and an agent
 * usually has live listings, so the dialog says what goes offline and asks
 * for the word SUPPRIMER typed out; the server action checks it again
 * (app/compte/agent/actions.js deleteOwnAgentAccountAction).
 */
export default function AgentDeleteAccountButton({ action, liveListings = 0 }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const confirmed = typed.trim().toUpperCase() === 'SUPPRIMER';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTyped('');
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="u-press inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-danger text-sm font-bold text-danger transition-colors hover:bg-danger-tint"
      >
        <Trash2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {t('agent.deleteAccount.button')}
      </button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('agent.deleteAccount.confirmTitle')}</DialogTitle>
          <DialogDescription>
            {liveListings > 0
              ? t('agent.deleteAccount.confirmBodyListings', { count: liveListings })
              : t('agent.deleteAccount.confirmBody')}
          </DialogDescription>
        </DialogHeader>
        <form action={action} className="flex flex-col gap-3">
          <label htmlFor="agent-delete-confirm" className="text-[0.8125rem] font-semibold text-ink-70">
            {t('agent.deleteAccount.typeToConfirm')}
          </label>
          <input
            id="agent-delete-confirm"
            name="confirm"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="SUPPRIMER"
            className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-35"
          />
          <DialogFooter>
            <DialogClose asChild>
              <button type="button" className="rounded-full border border-line px-4 py-2 text-sm font-medium text-ink-70 hover:bg-canvas-alt">
                {t('common.actions.cancel')}
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={!confirmed}
              className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('common.shared.deletePermanently')}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
