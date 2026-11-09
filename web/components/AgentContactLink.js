'use client';

import { trackAgentContact } from '@/lib/analyticsClient';

/**
 * A wa.me or tel: link from the agent's dashboard to a customer that records
 * the tap (POST /api/agent/contact-attempt) before WhatsApp or the dialer
 * opens. The reply itself happens on the agent's own phone, where we cannot
 * see it; the tap is the one thing we can record (2026-11-09, owner decision
 * "record taps only").
 *
 * Exactly one of `leadId` / `viewingRequestId`. `channel` is 'whatsapp' or
 * 'phone'; `source` names the dashboard surface. Every other prop goes to <a>.
 */
export default function AgentContactLink({
  leadId = null, viewingRequestId = null, channel, source, onClick, children, ...rest
}) {
  return (
    <a
      {...rest}
      onClick={(event) => {
        trackAgentContact({ leadId, viewingRequestId, channel, source });
        onClick?.(event);
      }}
    >
      {children}
    </a>
  );
}
