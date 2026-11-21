import { cache } from 'react';
import { ShieldCheck } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { getAgentTrackRecord } from '@/lib/agencies';
import { agentTrustFacts } from '@/lib/agentTrustRules';

// The phone row and the desktop rail both render this line on one page:
// one query per request.
const trackRecordFor = cache((agentId) => getAgentTrackRecord(agentId));

/**
 * "Numéro vérifié · 23 biens en ligne · 4 biens loués ou vendus" beside the
 * agent on a listing page (lib/agentTrustRules.js has the rules). Renders
 * nothing for a listing without a named agent, or when no fact holds.
 * getAgentTrackRecord never throws: a failed read shows fewer facts.
 */
export default async function AgentTrustLine({ listing, className = '' }) {
  if (!listing?.agent_id) return null;
  const recordPromise = trackRecordFor(listing.agent_id);
  const t = await getT();
  const record = await recordPromise;
  const facts = agentTrustFacts({
    agentPhone: listing.agent_phone,
    liveCount: record.liveCount,
    closedCount: record.closedCount,
  });
  if (facts.length === 0) return null;
  return (
    <p className={`flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.8125rem] text-ink-70 ${className}`}>
      <ShieldCheck strokeWidth={2.25} className="h-4 w-4 shrink-0 text-green-deep" aria-hidden="true" />
      {facts.map((fact, i) => (
        <span key={fact.key}>
          {i > 0 ? <span aria-hidden="true" className="mr-1.5 text-ink-25">·</span> : null}
          {t(`listings.detail.agentTrust.${fact.key}`, fact.count === undefined ? undefined : { count: fact.count })}
        </span>
      ))}
    </p>
  );
}
