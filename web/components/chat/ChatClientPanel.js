'use client';

import Link from 'next/link';
import { BadgeCheck, CalendarDays, PencilLine } from 'lucide-react';
import { ChatAvatar, ChatListingRow } from './ChatParts';
import { chatLongDate, chatMonthYear } from '@/lib/chatTime';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useLocale, useT } from '@/lib/i18n/client';

/**
 * The agent's right-hand panel beside a conversation: who the customer is
 * (as far as the agent needs to know — first name and initial, since when,
 * whether their number is verified; never their phone), the listing it is
 * about with a link to edit it, and when the conversation opened. Only facts
 * the database holds.
 */
export default function ChatClientPanel({ thread }) {
  const t = useT();
  const locale = useLocale();
  const person = thread.counterpart;
  const name = person.name || t('chat.customer');

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-5 py-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <ChatAvatar person={person} size="lg" t={t} />
        <h2 className="u-title-card text-ink">{name}</h2>
        <p className="text-[0.8125rem] text-ink-45">
          {person.since ? t('chat.agent.clientSince', { date: chatMonthYear(person.since, locale) }) : t('chat.customer')}
        </p>
        {person.verified ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success-tint px-2.5 py-1 text-[0.75rem] font-semibold text-success">
            <BadgeCheck strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true" />
            {t('chat.agent.verifiedPhone')}
          </span>
        ) : null}
      </div>

      {thread.propertyId ? (
        <section className="flex flex-col gap-2.5">
          <h3 className="u-eyebrow text-ink-45">{t('chat.agent.aboutListing')}</h3>
          <ChatListingRow listing={thread.listing} propertyId={thread.propertyId} t={t} />
          <Link
            href={`/compte/agent/biens/${thread.propertyId}`}
            className="inline-flex items-center gap-1.5 self-start text-[0.8125rem] font-semibold text-blue-deep"
          >
            <PencilLine strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
            {t('chat.agent.editListing')}
          </Link>
        </section>
      ) : (
        <p className="rounded-lg bg-canvas-alt px-3.5 py-3 text-[0.8125rem] text-ink-70">{t('chat.agent.fromProfile')}</p>
      )}

      {thread.createdAt ? (
        <p className="flex items-center gap-2 border-t border-line pt-4 text-[0.8125rem] text-ink-45">
          <CalendarDays strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 flex-none" aria-hidden="true" />
          {t('chat.agent.openedOn', { date: chatLongDate(thread.createdAt, locale) })}
        </p>
      ) : null}
    </div>
  );
}
