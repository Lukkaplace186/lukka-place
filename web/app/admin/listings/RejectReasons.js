'use client';

import { REJECTION_REASON_LABEL_KEYS } from '@/lib/moderation';
import { useT } from '@/lib/i18n/client';

/**
 * The rejection reasons as one-tap chips, most common first, numbered for the
 * keyboard (1–7 in review mode). Same codes as the engine's
 * MODERATION_REJECTION_REASONS: the agent is sent the chosen one.
 */
export const REVIEW_REASON_ORDER = [
  'BAD_PHOTOS', 'WRONG_PRICE', 'DUPLICATE', 'MISSING_INFO', 'NOT_REAL_ESTATE', 'SUSPECTED_FRAUD', 'OTHER',
];

export default function RejectReasons({ value, onChange, note, onNoteChange, noteId = 'reject-note', showNumbers = false }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label={t('admin.moderation.reasonLabel')} className="flex flex-wrap gap-2">
        {REVIEW_REASON_ORDER.map((code, index) => {
          const active = value === code;
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(code)}
              className={`u-press inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue ${
                active ? 'border-danger bg-danger-tint text-danger' : 'border-line bg-surface text-ink hover:border-ink-35'
              }`}
            >
              {showNumbers ? (
                <span
                  aria-hidden="true"
                  className={`u-tabular grid h-5 min-w-5 place-items-center rounded px-1 text-[0.6875rem] font-extrabold ${active ? 'bg-danger text-white' : 'bg-canvas-deep text-ink-45'}`}
                >
                  {index + 1}
                </span>
              ) : null}
              {t(REJECTION_REASON_LABEL_KEYS[code])}
            </button>
          );
        })}
      </div>
      <label htmlFor={noteId} className="flex flex-col gap-1">
        <span className="u-micro-strong text-ink">{t('admin.moderation.noteLabel')}</span>
        <input
          id={noteId}
          type="text"
          value={note}
          maxLength={500}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder={t('admin.moderation.notePlaceholder')}
          className="u-focus-ring h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
        />
      </label>
    </div>
  );
}
