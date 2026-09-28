import Link from 'next/link';
import { ChevronRight, UserRoundPen } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

/**
 * The overview's one-line reminder that the agent's profile has gaps. The full
 * checklist (AgentCompletenessCard) lives at the top of Réglages; this line
 * only says how many items are missing and goes there. Nothing is rendered
 * for a complete profile.
 */
export default async function AgentProfileGapsBanner({ profileGaps = [] }) {
  if (!profileGaps.length) return null;
  const t = await getT();
  return (
    <Link
      href="/compte/agent/parametres#a-completer"
      className="u-press flex min-h-11 items-center gap-3 rounded-card border border-warning/30 bg-warning-tint px-3.5 py-2 text-ink sm:px-4"
    >
      <UserRoundPen strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <span className="u-micro min-w-0 flex-1">
        <span className="font-bold">{t('agent.completeness.bannerTitle')}</span>{' '}
        <span className="text-ink-70">{t('agent.completeness.bannerCount', { count: profileGaps.length })}</span>
      </span>
      <span className="u-micro-strong shrink-0 text-blue-deep">{t('agent.completeness.fix')}</span>
      <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0 text-blue-deep" aria-hidden="true" />
    </Link>
  );
}
