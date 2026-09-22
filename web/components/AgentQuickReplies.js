'use client';

import { createContext, useContext, useMemo, useState } from 'react';
import Link from 'next/link';
import { MessageCircle, ArrowUpRight, Settings2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { quickReplyFacts, renderQuickReply, whatsappDigits } from '@/lib/quickReplyRules';
import { useT } from '@/lib/i18n/client';

/**
 * "Réponses rapides" on a lead or visit card: pick one of the agent's saved
 * messages and WhatsApp opens to the CLIENT's own number (the lead's wa_id)
 * with the text filled in from the real listing. The agent's WhatsApp sends
 * it, not Lukka Place's number — unlike the card's "Répondre" composer, which
 * goes through the engine — and the agent can still edit it before sending.
 *
 * The templates and the agent's listings come once per page through
 * QuickRepliesProvider (app/compte/agent/demandes/page.js), so each card only
 * adds one element. Without a provider the button renders nothing: a card
 * shown somewhere that did not load templates simply has no quick replies.
 *
 * Placeholders are filled line by line (lib/quickReplyRules.js): a line whose
 * fact the listing does not have is dropped, and the sheet names what was
 * left out, so an agent never sends "{price}" or a guess.
 */

const QuickRepliesContext = createContext(null);

export function QuickRepliesProvider({ templates = [], listings = [], children }) {
  const value = useMemo(
    () => ({ templates, listings, listingById: new Map(listings.map((l) => [String(l.id), l])) }),
    [templates, listings],
  );
  return <QuickRepliesContext.Provider value={value}>{children}</QuickRepliesContext.Provider>;
}

export default function AgentQuickReplies({ waId, clientName = null, propertyId = null }) {
  const t = useT();
  const context = useContext(QuickRepliesContext);
  const [open, setOpen] = useState(false);
  const initialListingId = propertyId != null && context?.listingById.has(String(propertyId)) ? String(propertyId) : '';
  const [listingId, setListingId] = useState(initialListingId);

  if (!context) return null;
  const { templates, listings, listingById } = context;
  const digits = whatsappDigits(waId);
  const listing = listingId ? listingById.get(listingId) || null : null;
  const facts = quickReplyFacts(listing, { name: clientName });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="u-btn-secondary u-press inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg text-[0.8125rem] font-bold text-ink"
      >
        <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {t('agent.quickReplies.open')}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] gap-0 overflow-y-auto rounded-t-card p-0 sm:mx-auto sm:max-w-xl"
        >
          <div className="flex flex-col gap-1 border-b border-line px-4 py-4 sm:px-6">
            <SheetTitle className="u-title-card text-ink">{t('agent.quickReplies.sheetTitle')}</SheetTitle>
            <SheetDescription className="u-micro text-ink-45">
              {digits
                ? t('agent.quickReplies.sheetHint', { number: `+${digits}` })
                : t('agent.quickReplies.noNumber')}
            </SheetDescription>
          </div>

          <div className="flex flex-col gap-4 px-4 py-4 sm:px-6">
            {listings.length > 0 && (
              <div>
                <label htmlFor={`qr-listing-${waId}-${propertyId ?? 'none'}`} className="u-micro-strong mb-1.5 block text-ink-70">
                  {t('agent.quickReplies.listingLabel')}
                </label>
                <select
                  id={`qr-listing-${waId}-${propertyId ?? 'none'}`}
                  value={listingId}
                  onChange={(e) => setListingId(e.target.value)}
                  className="u-focus-ring h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
                >
                  <option value="">{t('agent.quickReplies.noListing')}</option>
                  {listings.map((l) => (
                    <option key={l.id} value={String(l.id)}>
                      {l.title || `#${l.id}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {templates.length === 0 ? (
              <p className="u-micro rounded-lg bg-canvas-alt px-4 py-3 text-ink-70">{t('agent.quickReplies.emptySheet')}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {templates.map((template) => {
                  const { text, dropped } = renderQuickReply(template.body, facts);
                  const href = digits && text ? buildWhatsAppLink(digits, text) : null;
                  return (
                    <li key={template.id} className="rounded-lg border border-line p-3">
                      <div className="u-micro-strong text-ink">{template.title}</div>
                      {text ? (
                        <p className="u-micro mt-1 whitespace-pre-line text-ink-70">{text}</p>
                      ) : (
                        <p className="u-micro mt-1 text-ink-45">{t('agent.quickReplies.nothingToSend')}</p>
                      )}
                      {dropped.length > 0 && text && (
                        <p className="mt-1.5 text-xs text-ink-45">
                          {t('agent.quickReplies.droppedLines', {
                            fields: dropped.map((name) => t(`agent.quickReplies.placeholders.${name}`)).join(', '),
                          })}
                        </p>
                      )}
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setOpen(false)}
                          className="u-btn-primary u-press mt-2.5 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-blue text-[0.8125rem] font-bold text-white"
                        >
                          {t('agent.quickReplies.openWhatsApp')}
                          <ArrowUpRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                        </a>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            <Link
              href="/compte/agent/parametres?section=quick-replies#quick-replies"
              className="u-press inline-flex h-10 items-center justify-center gap-1.5 self-center rounded-lg px-3 text-[0.8125rem] font-semibold text-ink-45 hover:bg-canvas-alt hover:text-ink"
            >
              <Settings2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              {t('agent.quickReplies.manage')}
            </Link>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
