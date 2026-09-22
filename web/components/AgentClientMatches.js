'use client';

import { useState } from 'react';
import { Users, MessageCircle, Check } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { LISTING_TIME_ZONE } from '@/lib/listingView';
import { recordClientContactAction } from '@/app/compte/agent/clientActions';
import { useLocale, useT } from '@/lib/i18n/client';

/**
 * "3 de vos clients cherchent ce bien" on one of the agent's listings, and
 * the rows behind it: one tap per client, opening the agent's OWN WhatsApp
 * with the listing's tracked link typed in (lib/clientMatching.js builds the
 * link server-side). The entries come from the agent's private client book;
 * nothing here is visible to anyone but that agent.
 *
 * The marker says WhatsApp was OPENED on a date, not that a message was sent —
 * sending happens on the agent's phone, where we cannot see it.
 */
export default function AgentClientMatchesChip({ entries, align = 'start' }) {
  const t = useT();
  if (!entries?.length) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="u-press inline-flex min-h-8 items-center gap-1.5 rounded-full bg-blue-tint px-2.5 py-1 text-[0.75rem] font-bold text-blue-deep"
        >
          <Users strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
          {t('agent.clients.listingMatches', { count: entries.length })}
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[min(20rem,calc(100vw-1.5rem))]">
        <p className="u-micro text-ink-45">{t('agent.clients.listingMatchesHint')}</p>
        <ClientMatchList entries={entries} labelOf={(e) => e.name} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * One row per entry: a label, the WhatsApp tap and its marker. Used by the
 * chip above (one row per client) and by the client card (one row per
 * listing).
 *
 * @param {{entries: Array<{clientId, listingId, href, contactedAt}>, labelOf: (e) => string, detailOf?: (e) => string|null}} props
 */
export function ClientMatchList({ entries, labelOf, detailOf = null }) {
  const t = useT();
  const locale = useLocale();
  const [opened, setOpened] = useState({});

  function markOpened(entry) {
    const key = `${entry.clientId}:${entry.listingId}`;
    setOpened((prev) => ({ ...prev, [key]: new Date().toISOString() }));
    recordClientContactAction(entry.clientId, entry.listingId).catch((err) =>
      console.error('[ClientMatchList] contact marker failed', err),
    );
  }

  const dateFormat = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: 'numeric',
    month: 'short',
    timeZone: LISTING_TIME_ZONE,
  });

  return (
    <ul className="flex flex-col divide-y divide-line">
      {entries.map((entry) => {
        const key = `${entry.clientId}:${entry.listingId}`;
        const at = opened[key] || entry.contactedAt;
        const detail = detailOf ? detailOf(entry) : null;
        return (
          <li key={key} className="flex items-center gap-2.5 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-ink">{labelOf(entry)}</div>
              {detail && <div className="u-micro truncate text-ink-45">{detail}</div>}
              {at && (
                <div className="mt-0.5 inline-flex items-center gap-1 text-[0.75rem] font-semibold text-success">
                  <Check strokeWidth={ICON_STROKE_WIDTH} className="h-3 w-3" />
                  {t('agent.clients.openedOn', { date: dateFormat.format(new Date(at)) })}
                </div>
              )}
            </div>
            {entry.href ? (
              <a
                href={entry.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => markOpened(entry)}
                aria-label={t('agent.clients.whatsappTo', { name: labelOf(entry) })}
                className={`u-press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[0.8125rem] font-bold ${
                  at ? 'u-btn-secondary text-ink' : 'u-btn-primary bg-blue text-white'
                }`}
              >
                <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                {at ? t('agent.clients.whatsappAgain') : t('agent.clients.whatsapp')}
              </a>
            ) : (
              <span className="u-micro text-ink-35">{t('agent.clients.noPhone')}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
