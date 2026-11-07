'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';
import { useToast } from '@/components/Toast';
import { MOVE_MANUAL_STAGES, MOVE_STAGES } from '@/lib/moveProjectRules';

const PILL = 'flex flex-none items-center gap-1.5 rounded-full px-3 text-[0.78125rem] min-h-9';

/**
 * The move's stages as a control (owner, 2026-11-07: "when tapped it just
 * stays there … they can't go back"). Tapping Projet / Recherche / Demande
 * envoyée / Visites sets the stage there, FORWARD OR BACK: the pills update
 * at once, the choice is saved (`stageAction`, setManualStageAction bound to
 * the project), and a toast offers "Annuler". Tapping the current pill does
 * nothing — going back is tapping an earlier one. "Trouvé" opens the
 * "C'est le bon !" confirmation and "Installé" the check-in, because those
 * stop the alert or ask for consent; once found, "Ce n'était pas le bon" is
 * the way back.
 *
 * A reached stage that real events prove gets a solid tick; one only the
 * customer said gets a dotted one. When the tracking sees further than the
 * customer's choice, it is offered as a hint, never forced.
 */
export default function ProjectStepper({ view, projectId, status, stageAction }) {
  const t = useT();
  const router = useRouter();
  const { showToast, dismissToast } = useToast();
  // One stage message at a time (owner, 2026-11-07: two "Étape mise à jour"
  // toasts stacked read as two changes). A new one replaces the last.
  const lastToast = useRef(null);
  const toast = (opts) => {
    if (lastToast.current != null) dismissToast(lastToast.current);
    lastToast.current = showToast(opts);
  };
  const strip = useRef(null);
  const [, startTransition] = useTransition();
  const [local, setLocal] = useState({ current: view.current, manual: view.manual });
  const found = status === 'found';
  const currentIndex = MOVE_STAGES.indexOf(local.current);
  const label = (stage) => t(`account.move.stages.${stage}`);

  // The current step stays in view on a narrow phone (the strip scrolls
  // sideways; "Plan" was cut off at the left edge). Horizontal only.
  useEffect(() => {
    const ol = strip.current;
    const el = ol?.querySelector('[data-current="true"]');
    if (!ol || !el) return;
    ol.scrollTo({ left: Math.max(0, el.offsetLeft - (ol.clientWidth - el.offsetWidth) / 2), behavior: 'smooth' });
  }, [local.current]);

  async function save(stage) {
    try {
      return await stageAction(stage);
    } catch {
      return { ok: false };
    }
  }

  function choose(stage) {
    if (found || stage === local.current || !MOVE_MANUAL_STAGES.includes(stage)) return;
    const previous = local;
    const undoTo = previous.manual ? previous.current : 'auto';
    setLocal({ current: stage, manual: true });
    startTransition(async () => {
      const result = await save(stage);
      if (!result?.ok) {
        setLocal(previous);
        toast({ type: 'error', message: t('account.move.stages.saveError') });
        return;
      }
      router.refresh();
      toast({
        message: t('account.move.stages.updated', { stage: label(stage) }),
        action: {
          label: t('account.move.stages.undo'),
          onClick: () => {
            setLocal(previous);
            startTransition(async () => {
              await save(undoTo);
              router.refresh();
            });
          },
        },
      });
    });
  }

  function backToAuto() {
    const previous = local;
    startTransition(async () => {
      const result = await save('auto');
      if (!result?.ok) {
        toast({ type: 'error', message: t('account.move.stages.saveError') });
        return;
      }
      setLocal({ current: view.proven[view.proven.length - 1] || 'projet', manual: false });
      router.refresh();
      toast({
        message: t('account.move.stages.backToAutoDone'),
        action: {
          label: t('account.move.stages.undo'),
          onClick: () => {
            setLocal(previous);
            startTransition(async () => {
              await save(previous.current);
              router.refresh();
            });
          },
        },
      });
    });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <ol ref={strip} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0" aria-label={t('account.move.stages.label')}>
        {MOVE_STAGES.map((stage, i) => {
          const reached = i <= currentIndex;
          const isCurrent = i === currentIndex;
          const proven = view.proven.includes(stage);
          const tone = isCurrent
            ? 'bg-blue font-bold text-white'
            : reached
              ? 'bg-blue-tint font-bold text-blue-deep'
              : 'border border-dashed border-blue/50 font-semibold text-blue-deep';
          const mark = reached
            ? <Check strokeWidth={2.5} className={cn('h-3.5 w-3.5', !proven && 'rounded-full outline-1 outline-dashed outline-offset-1')} aria-hidden="true" />
            : <span aria-hidden="true" className="h-3.5 w-3.5 rounded-full border-2 border-current opacity-60" />;
          const content = (
            <>
              {mark}
              {label(stage)}
            </>
          );
          const settable = !found && MOVE_MANUAL_STAGES.includes(stage) && !isCurrent;
          if (settable) {
            return (
              <li key={stage} className="flex-none">
                <button type="button" onClick={() => choose(stage)} aria-label={t('account.move.stages.markAs', { stage: label(stage) })} data-current={isCurrent || undefined} className={cn('u-press', PILL, tone)}>
                  {content}
                </button>
              </li>
            );
          }
          if (stage === 'trouve' && !found) {
            return (
              <li key={stage} className="flex-none">
                <Link href={`/compte/client/projet/${projectId}?confirmer=trouve#statut`} data-current={isCurrent || undefined} className={cn('u-press', PILL, tone)}>{content}</Link>
              </li>
            );
          }
          if (stage === 'installe' && found && !reached) {
            return (
              <li key={stage} className="flex-none">
                <Link href={`/compte/client/projet/${projectId}?installe=1#checkin`} data-current={isCurrent || undefined} className={cn('u-press', PILL, tone)}>{content}</Link>
              </li>
            );
          }
          return (
            <li key={stage} aria-current={isCurrent ? 'step' : undefined} data-current={isCurrent || undefined} className={cn(PILL, tone)}>{content}</li>
          );
        })}
      </ol>
      {!found ? (
        <p className="text-[0.75rem] text-ink-45">
          {t('account.move.stages.hint')}
          {local.manual ? (
            <>
              {' '}
              <button type="button" onClick={backToAuto} className="font-semibold text-blue underline-offset-2 hover:underline">
                {t('account.move.stages.backToAuto')}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {view.trackerAhead && local.manual ? (
        <p className="text-[0.75rem] text-ink-70">{t('account.move.stages.trackerAhead', { stage: label(view.trackerAhead) })}</p>
      ) : null}
    </div>
  );
}
