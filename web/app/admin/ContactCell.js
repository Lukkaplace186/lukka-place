import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { Chip } from './LeadRoutingUI';

/**
 * One person in a console table — a customer or an agent — with a WhatsApp
 * link that opens a chat with them from the admin's own phone or WhatsApp Web.
 * Server-safe (no hooks): labels are passed in already translated.
 *
 * `waText` pre-types the first line so the admin does not start a customer
 * conversation with a blank message. Only digits reach the wa.me URL.
 */
export function WhatsAppLink({ phone, text = '', label }) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const href = `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="u-micro-strong inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-ink-70 hover:border-success hover:text-success"
      title={label}
    >
      <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
      <span className="u-tabular">+{digits}</span>
    </a>
  );
}

/**
 * An agent: name (linked to their profile), agency, number with a WhatsApp
 * link, and the chips the caller decides on (e.g. "listing's agent — not
 * alerted"). `agent` is a getAgentContactsByIds() entry, or null.
 */
export function AgentContact({ agent, fallbackId = null, chips = null, whatsappLabel, whatsappText = '', unroutableLabel = null }) {
  if (!agent) {
    return fallbackId ? <span className="text-ink-45">#{fallbackId}</span> : <span className="text-ink-35">—</span>;
  }
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <Link href={`/admin/agents/${agent.id}`} className="max-w-[14rem] truncate font-semibold text-ink hover:text-blue-deep hover:underline">
        {agent.name}
      </Link>
      {agent.agencyName ? (
        agent.vendorId ? (
          <Link href={`/admin/agencies/${agent.vendorId}`} className="max-w-[14rem] truncate text-ink-45 hover:text-blue-deep hover:underline">
            {agent.agencyName}
          </Link>
        ) : <span className="max-w-[14rem] truncate text-ink-45">{agent.agencyName}</span>
      ) : null}
      <div className="flex flex-wrap items-center gap-1">
        <WhatsAppLink phone={agent.phone} text={whatsappText} label={whatsappLabel} />
        {unroutableLabel && !agent.routable ? <Chip tone="warning">{unroutableLabel}</Chip> : null}
        {chips}
      </div>
    </div>
  );
}
