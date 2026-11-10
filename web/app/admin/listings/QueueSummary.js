import Link from 'next/link';
import { Play } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

function ageLabel(minutes, t) {
  if (minutes < 60) return t('admin.moderation.waitMinutes', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t('admin.moderation.waitHours', { count: hours });
  return t('admin.moderation.waitDays', { count: Math.round(hours / 24) });
}

/**
 * "5 en attente · la plus ancienne il y a 3 h · 2 à vérifier" and the button
 * into review mode. From lib/moderationRow.js queueSummary over the whole
 * pending queue (up to 100: past that, the "à vérifier" count is left out
 * rather than shown wrong).
 */
export default async function QueueSummary({ summary, canModerate }) {
  const t = await getT();
  const late = summary.oldestMinutes != null && summary.oldestMinutes > 24 * 60;
  return (
    <section
      aria-label={t('admin.moderation.queue.summaryLabel')}
      className="u-card flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface px-5 py-4"
    >
      <p className="text-[0.9375rem] leading-6 text-ink">
        <strong>{t('admin.moderation.queue.pendingCount', { count: summary.total })}</strong>
        {summary.oldestMinutes != null ? (
          <>
            <span className="text-ink-45"> · </span>
            {t('admin.moderation.queue.oldest')}{' '}
            <strong className={late ? 'text-danger' : ''}>{ageLabel(summary.oldestMinutes, t)}</strong>
          </>
        ) : null}
        {summary.complete ? (
          <>
            <span className="text-ink-45"> · </span>
            <strong>{t('admin.moderation.queue.toCheckCount', { count: summary.toCheck })}</strong>
          </>
        ) : null}
      </p>
      {canModerate ? (
        <Link
          href="/admin/listings/review"
          className="u-press inline-flex h-11 items-center gap-2 rounded-lg bg-blue px-4 text-sm font-bold text-white hover:bg-blue-deep"
        >
          <Play strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
          {t('admin.moderation.queue.startReview')}
        </Link>
      ) : null}
    </section>
  );
}
