import { Award, Check } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { getAgentPriority } from '@/lib/adminApi';
import { frNumber } from '@/lib/format';

/**
 * "Votre priorité pour les demandes clients" (2026-11-10, owner decision):
 * the agency's level — Or / Argent / Bronze — from the engine
 * (services/agentPriority.js), the four parts it is made of, and what to do
 * to move up. Requests go first to the best-placed agencies, so this is the
 * visible reward for keeping listings up to date and answering. Shown to the
 * agency only, never on a public page.
 *
 * Renders nothing when the engine cannot answer: a level we cannot read is
 * not shown as Bronze.
 */
const LEVEL_STYLE = {
  or: 'bg-warning-tint text-warning-ink',
  argent: 'bg-canvas-deep text-ink',
  bronze: 'bg-canvas-alt text-ink-70',
};
const PARTS = ['up_to_date', 'new_listing', 'requests', 'visits'];

/**
 * `audience="admin"` (2026-11-10, owner decision: the team sees every
 * agency's level too) is the same card on /admin/agents/[id], worded about
 * the agency rather than to it.
 */
export default async function AgentPriorityCard({ agentId, audience = 'agent' }) {
  let priority = null;
  try {
    ({ priority } = await getAgentPriority(agentId));
  } catch (err) {
    console.error(`[agent/overview] priority level unavailable: ${err.message}`);
    return null;
  }
  if (!priority) return null;
  const t = await getT();
  const admin = audience === 'admin';
  const levelName = (level) => t(`agent.priority.levels.${level}`);
  const parts = PARTS.map((key) => priority.parts.find((p) => p.key === key)).filter(Boolean);

  return (
    <section aria-labelledby="agent-priority-title" className="u-card flex flex-col gap-4 rounded-card bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-tint text-blue-deep">
          <Award strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="agent-priority-title" className="u-title-card text-ink">{admin ? t('admin.agentProfile.priorityTitle') : t('agent.priority.title')}</h2>
          <p className="u-micro mt-0.5 text-ink-70">{admin ? t('admin.agentProfile.priorityLead') : t('agent.priority.lead')}</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-extrabold ${LEVEL_STYLE[priority.level] || LEVEL_STYLE.bronze}`}>
          {levelName(priority.level)}
        </span>
      </div>

      <div>
        <p className="u-micro-strong text-ink">
          {t('agent.priority.points', { points: frNumber(priority.points) })}
        </p>
        <p className="u-micro text-ink-70">
          {priority.next
            ? t('agent.priority.toNext', { points: frNumber(priority.pointsToNext), level: levelName(priority.next) })
            : t('agent.priority.top')}
        </p>
      </div>

      <ul className="flex flex-col gap-2.5">
        {parts.map((part) => {
          const done = !part.unknown && part.points >= part.max;
          return (
            <li key={part.key} className="flex items-start gap-3">
              <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${done ? 'bg-success-tint text-success' : 'bg-canvas-alt text-ink-45'}`}>
                {done && <Check strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3" aria-hidden="true" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="u-micro-strong text-ink">{t(`agent.priority.parts.${part.key}.label`)}</span>
                  <span className="u-micro u-tabular shrink-0 text-ink-70">
                    {part.unknown ? t('agent.priority.unknown') : `${frNumber(part.points)} / ${part.max}`}
                  </span>
                </p>
                {!done && (
                  <p className="u-micro text-ink-45">
                    {part.neutral ? t('agent.priority.neutral') : t(`agent.priority.parts.${part.key}.hint`)}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="u-micro text-ink-45">{admin ? t('admin.agentProfile.priorityFoot') : t('agent.priority.private')}</p>
    </section>
  );
}
