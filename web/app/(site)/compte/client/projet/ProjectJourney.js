import { Check, ClipboardCheck } from 'lucide-react';
import { MAX_MOVE_STORY, MOVE_STAGES } from '@/lib/moveProjectRules';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

const CARD = 'rounded-card bg-surface shadow-[var(--hairline),var(--shadow-card)]';

/**
 * Where the move stands, as a strip of its stages (lib/moveProjectRules.js
 * moveStagesReached): each one reached by a real event, the last reached one
 * highlighted, the ones ahead greyed. Server-rendered, no state.
 */
export function ProjectStages({ reached, t }) {
  const current = reached[reached.length - 1];
  return (
    <ol className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0" aria-label={t('account.move.stages.label')}>
      {MOVE_STAGES.map((stage, i) => {
        const done = reached.includes(stage);
        const isCurrent = stage === current;
        return (
          <li
            key={stage}
            aria-current={isCurrent ? 'step' : undefined}
            className={
              isCurrent
                ? 'flex flex-none items-center gap-1.5 rounded-full bg-blue px-3 py-1.5 text-[0.78125rem] font-bold text-white'
                : done
                  ? 'flex flex-none items-center gap-1.5 rounded-full bg-blue-tint px-3 py-1.5 text-[0.78125rem] font-bold text-blue-deep'
                  : 'flex flex-none items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[0.78125rem] font-semibold text-ink-45'
            }
          >
            {done ? <Check strokeWidth={2.5} className="h-3.5 w-3.5" aria-hidden="true" /> : <span aria-hidden="true">{i + 1}</span>}
            {t(`account.move.stages.${stage}`)}
          </li>
        );
      })}
    </ol>
  );
}

const CHECKLIST = ['visit', 'costs', 'contract', 'condition', 'documents', 'receipt'];

/**
 * "Avant de signer" — what to check before paying anything. General advice in
 * the customer's language, never a claim about a particular listing; the
 * entry costs themselves are on each listing page (EntryCostsBreakdown).
 */
export function SigningChecklist({ t }) {
  return (
    <section className={`flex flex-col gap-2 p-4 sm:p-5 ${CARD}`} aria-labelledby="move-checklist">
      <h2 id="move-checklist" className="u-title-card flex items-center gap-2 text-ink">
        <ClipboardCheck strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem] text-blue" aria-hidden="true" />
        {t('account.move.checklist.title')}
      </h2>
      <p className="text-[0.875rem] text-ink-45">{t('account.move.checklist.lead')}</p>
      <ul className="mt-1 flex flex-col gap-2">
        {CHECKLIST.map((key) => (
          <li key={key} className="flex items-start gap-2 text-[0.9375rem] text-ink">
            <span className="mt-1 h-2 w-2 flex-none rounded-full bg-blue" aria-hidden="true" />
            {t(`account.move.checklist.items.${key}`)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * "Bien installés ?" — 30 days after "C'est le bon !". The answer, the
 * customer's story if they want to tell it, and a consent box that is
 * unticked by default: without it the story stays in their account.
 * `action` is settleCheckinAction bound to the project id.
 */
export function CheckinCard({ action, t }) {
  return (
    <section id="checkin" className="flex flex-col gap-3 rounded-card bg-green-tint p-4 sm:p-5" aria-labelledby="move-checkin">
      <h2 id="move-checkin" className="u-title-card text-green-deep">{t('account.move.checkin.title')}</h2>
      <p className="text-[0.9375rem] text-ink-70">{t('account.move.checkin.lead')}</p>
      <form action={action} className="flex flex-col gap-3">
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">{t('account.move.checkin.title')}</legend>
          {['settled', 'not_yet'].map((v) => (
            <label key={v} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-surface px-4 text-[0.9375rem] font-semibold text-ink has-[:checked]:border-blue has-[:checked]:bg-blue has-[:checked]:text-white">
              <input type="radio" name="answer" value={v} required className="sr-only" />
              {t(`account.move.checkin.answers.${v}`)}
            </label>
          ))}
        </fieldset>
        <div>
          <label htmlFor="move-story" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-45">
            {t('account.move.checkin.storyLabel')}
          </label>
          <textarea
            id="move-story"
            name="story"
            rows={4}
            maxLength={MAX_MOVE_STORY}
            placeholder={t('account.move.checkin.storyPlaceholder')}
            className="u-focus-ring w-full rounded-md border border-line bg-white px-3 py-2 text-[0.9375rem] text-ink"
          />
        </div>
        <label className="flex items-start gap-2 text-[0.875rem] text-ink-70">
          <input type="checkbox" name="consent" className="mt-1 h-4 w-4 flex-none" />
          {t('account.move.checkin.consent')}
        </label>
        <button type="submit" className="u-btn-primary min-h-12 rounded-md bg-blue px-4 text-[0.9375rem] font-bold text-white hover:bg-blue-deep">
          {t('account.move.checkin.submit')}
        </button>
      </form>
    </section>
  );
}
