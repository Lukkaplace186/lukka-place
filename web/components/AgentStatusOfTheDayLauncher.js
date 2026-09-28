'use client';

import { useState } from 'react';
import { ChevronRight, Smartphone } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import AgentStatusOfTheDay from './AgentStatusOfTheDay';

/**
 * "Statut du jour" on Mes biens: one slim line above the list, opening the
 * batch Status tool in a dialog. It moved here from the overview
 * (2026-09-28): sharing listings is a Biens task, and the overview is now
 * figures and to-dos only.
 *
 * Renders nothing when there is nothing to suggest — a line saying "nothing
 * to share" would push the first card down to say nothing.
 */
export default function AgentStatusOfTheDayLauncher({ items, tracked, liveCount, recentDays }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!items?.length) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="u-press flex min-h-12 w-full items-center gap-3 rounded-card bg-surface px-3.5 py-2 text-left ring-1 ring-line transition-colors hover:bg-canvas-deep sm:px-4"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-tint text-blue">
          <Smartphone strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.8125rem] font-bold text-ink">{t('agent.status.title')}</span>
          <span className="u-micro block truncate text-ink-45">{t('agent.status.launcherHint', { count: items.length, days: recentDays })}</span>
        </span>
        <span className="u-micro-strong shrink-0 text-blue-deep">{t('agent.status.launcherCta')}</span>
        <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-blue-deep" aria-hidden="true" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88dvh] gap-3 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('agent.status.title')}</DialogTitle>
            <DialogDescription>{t('agent.status.intro', { days: recentDays })}</DialogDescription>
          </DialogHeader>
          <AgentStatusOfTheDay items={items} tracked={tracked} liveCount={liveCount} recentDays={recentDays} embedded />
        </DialogContent>
      </Dialog>
    </>
  );
}
