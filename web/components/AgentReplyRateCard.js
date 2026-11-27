import { MessageCircleCheck } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getLocale } from '@/lib/i18n/server';
import { getContactTapReplyRates } from '@/lib/adminApi';
import {
  ADMIN_REPLY_RATE_NOTE, ADMIN_REPLY_RATE_TITLE, adminReplyRateLine, agentReplyRateCopy, replyRateSince, replyRateSummary,
} from '@/lib/agentReplyRate';

/**
 * « Vous nous avez confirmé avoir répondu à 4 clients sur 10 ces 30 derniers
 * jours » (2026-11-21, lib/agentReplyRate.js has the rules and why the wording
 * says "confirmé"). On the agent overview it shows only the signed-in agent's
 * own figure, and only from MIN_ALERTS alerts; `audience="admin"` is the same
 * figure on /admin/agents/[id], with the raw counts under the threshold.
 *
 * Renders nothing when the engine cannot answer: a rate we cannot read is
 * never shown as 0.
 */
export default async function AgentReplyRateCard({ agentId, audience = 'agent' }) {
  let row = null;
  try {
    const rates = await getContactTapReplyRates({ since: replyRateSince(), agentIds: [agentId] });
    row = rates.get(Number(agentId)) || null;
  } catch (err) {
    console.error(`[agent-reply-rate] agent #${agentId}: unavailable — ${err.message}`);
    return null;
  }
  const summary = replyRateSummary(row);

  if (audience === 'admin') {
    return (
      <section aria-labelledby="agent-reply-rate-admin" className="u-card flex flex-col gap-1.5 rounded-card bg-surface p-4 sm:p-5">
        <h2 id="agent-reply-rate-admin" className="u-title-card text-ink">{ADMIN_REPLY_RATE_TITLE}</h2>
        <p className="u-micro-strong text-ink">{adminReplyRateLine(summary)}</p>
        <p className="u-micro text-ink-45">{ADMIN_REPLY_RATE_NOTE}</p>
      </section>
    );
  }

  const locale = await getLocale();
  const copy = agentReplyRateCopy(summary, locale);
  if (!copy) return null;
  const low = summary.percent < 50;
  return (
    <section aria-labelledby="agent-reply-rate-title" className="u-card flex flex-col gap-3 rounded-card bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${low ? 'bg-warning-tint text-warning-ink' : 'bg-success-tint text-success'}`}>
          <MessageCircleCheck strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="agent-reply-rate-title" className="u-title-card text-ink">{copy.title}</h2>
          <p className="u-micro-strong mt-0.5 text-ink">{copy.headline}</p>
          {copy.rest ? <p className="u-micro text-ink-70">{copy.rest}</p> : null}
        </div>
        <span className={`u-tabular shrink-0 rounded-full px-3 py-1 text-sm font-extrabold ${low ? 'bg-warning-tint text-warning-ink' : 'bg-success-tint text-success'}`}>
          {summary.percent} %
        </span>
      </div>
      <p className="u-micro text-ink-70">{copy.why}</p>
      <p className="u-micro text-ink-45">{copy.todo}</p>
    </section>
  );
}
