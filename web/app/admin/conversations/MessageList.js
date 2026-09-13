import Link from 'next/link';
import { Chip, formatKinshasa } from '../LeadRoutingUI';

/**
 * A WhatsApp transcript with its metadata. Server-safe (no hooks) — used by the
 * drawer on /admin/conversations and by /admin/conversations/[id]; the caller
 * passes its own translator.
 *
 * Every chip is a recorded fact or a deterministic read of the text:
 * - sender/intent/tools are written by the engine at the moment it records the
 *   message (services/db.js recordMessage). A message written before those
 *   columns existed shows no intent and, if outbound, "sender not recorded" —
 *   nothing is classified after the fact.
 * - a lukkaplace.com/listings/<id> link is the storefront's WhatsApp CTA
 *   (services/listingEnquiry.js recognises it the same way), and a wa.me link
 *   is a direct WhatsApp hand-off; both are pattern matches, not inference.
 */

const SENDER_LABEL_KEYS = {
  customer: 'admin.conversations.senderCustomer',
  ai: 'admin.conversations.senderAi',
  agent: 'admin.conversations.senderAgent',
  system: 'admin.conversations.senderSystem',
};

const INTENT_LABEL_KEYS = {
  buyer_request: 'admin.conversations.intentBuyerRequest',
  question: 'admin.conversations.intentQuestion',
  greeting: 'admin.conversations.intentGreeting',
  listing: 'admin.conversations.intentListing',
  other: 'admin.conversations.intentOther',
  listing_enquiry: 'admin.conversations.intentListingEnquiry',
};

const TOOL_LABEL_KEYS = {
  search_properties: 'admin.conversations.toolSearch',
  get_property: 'admin.conversations.toolGetProperty',
  get_location: 'admin.conversations.toolLocation',
  create_enquiry: 'admin.conversations.toolEnquiry',
  request_viewing: 'admin.conversations.toolViewing',
  handoff_to_agent: 'admin.conversations.toolHandoff',
};

const LISTING_LINK = /(?:https?:\/\/)?(?:www\.)?lukkaplace\.com\/listings\/(\d+)/gi;
const WA_LINK = /(?:https?:\/\/)?wa\.me\/(\d{7,15})/gi;

function linkTriggers(text) {
  const value = String(text || '');
  const listings = [...new Set([...value.matchAll(LISTING_LINK)].map((m) => m[1]))];
  const whatsapp = [...new Set([...value.matchAll(WA_LINK)].map((m) => m[1]))];
  return { listings, whatsapp };
}

export default function MessageList({ messages, total, t }) {
  if (!messages?.length) {
    return <p className="u-micro py-6 text-center text-ink-45">{t('admin.conversations.noMessages')}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {total > messages.length ? (
        <p className="u-micro text-center text-ink-35">
          {t('admin.conversations.earlierMessages', { count: total - messages.length })}
        </p>
      ) : null}
      {messages.map((message) => {
        const inbound = message.direction === 'inbound';
        const sender = message.sender || (inbound ? 'customer' : null);
        const { listings, whatsapp } = linkTriggers(message.text);
        const tools = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        return (
          <div key={message.id} className={`flex max-w-[88%] flex-col gap-1 ${inbound ? 'self-start' : 'self-end items-end'}`}>
            <div className="u-micro flex flex-wrap items-center gap-1.5 text-ink-45">
              <span className="font-semibold text-ink-70">
                {sender ? t(SENDER_LABEL_KEYS[sender]) : t('admin.conversations.senderUnknown')}
              </span>
              <span className="u-tabular">{formatKinshasa(message.created_at)}</span>
            </div>
            <div
              className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                inbound
                  ? 'rounded-tl-sm bg-canvas-alt text-ink'
                  : sender === 'agent'
                    ? 'rounded-tr-sm bg-ink text-white'
                    : 'rounded-tr-sm bg-blue text-white'
              }`}
            >
              <p className="whitespace-pre-line break-words">{message.text || '—'}</p>
            </div>
            {message.intent || tools.length || listings.length || whatsapp.length ? (
              <div className={`flex flex-wrap gap-1 ${inbound ? '' : 'justify-end'}`}>
                {message.intent ? (
                  <Chip tone="blue">{INTENT_LABEL_KEYS[message.intent] ? t(INTENT_LABEL_KEYS[message.intent]) : message.intent}</Chip>
                ) : null}
                {tools.map((tool) => (
                  <Chip key={tool} tone="neutral">{TOOL_LABEL_KEYS[tool] ? t(TOOL_LABEL_KEYS[tool]) : tool}</Chip>
                ))}
                {listings.map((id) => (
                  <Link key={`l-${id}`} href={`/admin/listings/${id}`} className="hover:underline">
                    <Chip tone="success">{t('admin.conversations.triggerListing', { id })}</Chip>
                  </Link>
                ))}
                {whatsapp.map((number) => (
                  <Chip key={`w-${number}`} tone="success">{t('admin.conversations.triggerWhatsapp', { number: `+${number}` })}</Chip>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
