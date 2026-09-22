import Link from 'next/link';
import { Circle, ArrowRight } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { gapHintKey, gapLabelKey, profileGapHref } from '@/lib/completenessRules';
import { getT } from '@/lib/i18n/server';

/**
 * The overview's "À compléter" card: each real profile gap with one line of
 * why it matters and a "Compléter" link to the exact settings field, plus a
 * pointer to Mes biens when listings have gaps of their own. Renders nothing
 * when there is nothing to do — a card saying "all done" would push the stats
 * down for no information.
 */
export default async function AgentCompletenessCard({ profileGaps = [], incompleteListingsCount = 0 }) {
  const t = await getT();
  if (profileGaps.length === 0 && incompleteListingsCount === 0) return null;

  return (
    <div className="u-card flex flex-col gap-3 rounded-card bg-surface p-4 sm:p-6">
      <div>
        <h2 className="u-title-card text-ink">{t('agent.completeness.cardTitle')}</h2>
        <p className="u-micro mt-0.5 text-ink-45">{t('agent.completeness.cardHint')}</p>
      </div>

      {profileGaps.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {profileGaps.map((code) => (
            <li key={code} className="flex items-center gap-3 py-2.5">
              <Circle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-ink-25" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="u-micro-strong text-ink">{t(gapLabelKey(code))}</div>
                <div className="text-xs text-ink-45">{t(gapHintKey(code))}</div>
              </div>
              <Link
                href={profileGapHref(code)}
                className="u-press inline-flex h-10 shrink-0 items-center rounded-lg px-3 text-[0.8125rem] font-bold text-blue-deep hover:bg-blue-tint"
              >
                {t('agent.completeness.fix')}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {incompleteListingsCount > 0 && (
        <Link
          href="/compte/agent/biens#a-completer"
          className="u-press inline-flex min-h-10 items-center justify-between gap-2 rounded-lg bg-canvas-alt px-3 py-2 text-[0.8125rem] font-semibold text-ink hover:bg-canvas-deep"
        >
          {t('agent.completeness.listingsToFix', { count: incompleteListingsCount })}
          <ArrowRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" />
        </Link>
      )}
    </div>
  );
}
