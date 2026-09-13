'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing, CalendarClock, MoreHorizontal, UserRoundCog, XCircle } from 'lucide-react';
import { useToast } from '@/components/Toast';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';
import AgentPicker from '../AgentPicker';
import { cancelViewingAction, nudgeViewingAction, reassignViewingAction, scheduleViewingAction } from './actions';

const ICON_BUTTON =
  'u-press u-micro-strong inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2 text-ink transition-colors hover:border-blue disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY =
  'u-press u-btn-primary inline-flex h-9 items-center justify-center rounded-lg bg-blue px-4 text-sm font-semibold text-white hover:bg-blue-deep disabled:opacity-50';
const SECONDARY =
  'u-press inline-flex h-9 items-center justify-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-canvas-alt';

/**
 * The quick actions on one viewing request: nudge the agent sitting on it,
 * hand it to another agency, pin the appointment time, or call it off.
 *
 * Reassignment searches routable agents server-side (AgentPicker) instead of
 * rendering every agent into a <select> on every row — at 30k agents that
 * select was the page. The engine re-checks the routing gate on every call.
 */
export default function ViewingRowActions({ viewingRequestId, currentAgentId, commune, canNudge, canCancel }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [dialog, setDialog] = useState(null);
  const [agent, setAgent] = useState(null);
  const [when, setWhen] = useState('');

  function run(action, onDone) {
    startTransition(async () => {
      let result;
      try {
        result = await action();
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (!result?.ok) {
        showToast({ type: 'error', message: result?.error || t('admin.viewings.actionFailed') });
        return;
      }
      showToast({ type: 'success', message: result.message });
      onDone?.();
      router.refresh();
    });
  }

  const close = () => {
    setDialog(null);
    setAgent(null);
    setWhen('');
  };

  return (
    <div className="flex items-center gap-1.5">
      {canNudge ? (
        <button
          type="button"
          className={ICON_BUTTON}
          disabled={pending}
          onClick={() => run(() => nudgeViewingAction(viewingRequestId))}
          title={t('admin.viewings.nudge')}
        >
          <BellRing strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">{t('admin.viewings.nudge')}</span>
        </button>
      ) : null}

      <button type="button" className={ICON_BUTTON} disabled={pending} onClick={() => setDialog('reassign')} title={t('admin.viewings.reassign')}>
        <UserRoundCog strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
        <span className="hidden xl:inline">{t('admin.viewings.reassign')}</span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={ICON_BUTTON} disabled={pending} aria-label={t('admin.table.moreActions')}>
            <MoreHorizontal strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => setDialog('time')}>
            <CalendarClock strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            {t('admin.viewings.setTime')}
          </DropdownMenuItem>
          {canCancel ? (
            <DropdownMenuItem onSelect={() => setDialog('cancel')} className="text-danger">
              <XCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('admin.viewings.cancel')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialog === 'reassign'} onOpenChange={(open) => (open ? setDialog('reassign') : close())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('admin.viewings.reassignTitle')}</DialogTitle>
            <DialogDescription>{t('admin.viewings.reassignBody')}</DialogDescription>
          </DialogHeader>
          <AgentPicker
            routableOnly
            commune={commune}
            excludeId={currentAgentId}
            onSelect={setAgent}
            placeholder={t('admin.viewings.reassignTo')}
          />
          <DialogFooter>
            <button type="button" className={SECONDARY} onClick={close}>{t('common.actions.cancel')}</button>
            <button
              type="button"
              className={PRIMARY}
              disabled={pending || !agent}
              onClick={() => run(() => reassignViewingAction(viewingRequestId, agent.id), close)}
            >
              {t('admin.viewings.reassign')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'time'} onOpenChange={(open) => (open ? setDialog('time') : close())}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('admin.viewings.setTimeTitle')}</DialogTitle>
            <DialogDescription>{t('admin.viewings.setTimeBody')}</DialogDescription>
          </DialogHeader>
          <input
            type="datetime-local"
            aria-label={t('admin.viewings.timeLabel')}
            value={when}
            onChange={(event) => setWhen(event.target.value)}
            className="u-focus-ring u-micro h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-ink"
          />
          <DialogFooter>
            <button type="button" className={SECONDARY} onClick={close}>{t('common.actions.cancel')}</button>
            <button
              type="button"
              className={PRIMARY}
              disabled={pending || !when}
              onClick={() => run(() => scheduleViewingAction(viewingRequestId, when), close)}
            >
              {t('admin.viewings.setTime')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'cancel'} onOpenChange={(open) => (open ? setDialog('cancel') : close())}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('admin.viewings.cancelTitle')}</DialogTitle>
            <DialogDescription>{t('admin.viewings.cancelBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className={SECONDARY} onClick={close}>{t('admin.viewings.keep')}</button>
            <button
              type="button"
              className="u-press inline-flex h-9 items-center justify-center rounded-lg bg-danger px-4 text-sm font-semibold text-white disabled:opacity-50"
              disabled={pending}
              onClick={() => run(() => cancelViewingAction(viewingRequestId), close)}
            >
              {t('admin.viewings.confirmCancel')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
