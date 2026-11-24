'use client';

import { AnimatePresence, m } from 'motion/react';
import { ArrowDown, Check, CheckCheck } from 'lucide-react';
import AppAvatar from '@/components/app/AppAvatar';
import { Bubble, BubbleContent, BubbleGroup } from '@/components/ui/bubble';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { Message, MessageAvatar, MessageContent, MessageFooter } from '@/components/ui/message';
import { ChatListingRow } from './ChatParts';
import { chatClock } from '@/lib/chatTime';
import { cn } from '@/lib/utils';
import { groupChatRows } from '@/lib/chatGroups';

/**
 * The conversation drawn with the app's chat components (app mode only,
 * loaded by ChatThread through next/dynamic so the website never ships
 * motion): day Markers, grouped Bubbles — the reader's on the right in royal
 * blue, the other person's on the left with their avatar — and, under the
 * reader's last message, Envoyé / Lu; a failed one keeps "Réessayer".
 * `isNew(message)` says whether it arrived while the page was open: only
 * those spring in.
 */
export default function AppChatList({ rows, side, person, name, lastMine, otherLastReadId, isNew, onRetry, locale, t }) {
  const groups = groupChatRows(rows, side);
  return (
    <ol className="flex flex-col gap-3">
      {groups.map((group) => {
        if (group.type !== 'group') {
          return (
            <li key={group.key}>
              <Marker>
                <MarkerContent className={group.type === 'divider' ? 'font-semibold' : ''}>{group.label}</MarkerContent>
              </Marker>
            </li>
          );
        }
        const lastRow = group.rows[group.rows.length - 1].message;
        const holdsLastMine = group.mine && group.rows.some(({ message }) => message === lastMine);
        return (
          <li key={group.key}>
            <Message align={group.mine ? 'end' : 'start'}>
              {group.mine ? null : (
                <MessageAvatar>
                  <AppAvatar name={name} src={person?.image} size="sm" />
                </MessageAvatar>
              )}
              <MessageContent>
                <BubbleGroup className={group.mine ? 'items-end' : 'items-start'}>
                  {group.rows.map(({ message }) => {
                    const failed = message.status === 'failed';
                    const sending = message.status === 'sending';
                    return (
                      <Bubble
                        key={message.clientId || message.id}
                        align={group.mine ? 'end' : 'start'}
                        appear={isNew(message)}
                        className={cn(message.kind === 'listing' && 'w-[min(22rem,88%)] max-w-none')}
                      >
                        {message.kind === 'listing' ? (
                          <BubbleContent className="w-full border border-line bg-surface p-3 text-ink">
                            <p className="mb-2 text-[0.75rem] font-semibold text-ink-45">{t('chat.thread.sharedListing')}</p>
                            <ChatListingRow listing={message.listing} propertyId={message.propertyId} t={t} />
                            {message.body ? <p className="mt-2.5 whitespace-pre-wrap">{message.body}</p> : null}
                          </BubbleContent>
                        ) : (
                          <BubbleContent className={cn('whitespace-pre-wrap', sending && 'opacity-70', failed && 'bg-blue/60')}>
                            {message.body}
                          </BubbleContent>
                        )}
                        {failed ? (
                          <MessageFooter className="mt-1 flex items-center gap-1">
                            <span className="font-semibold text-danger">{t('chat.thread.failed')}</span>
                            <button type="button" onClick={() => onRetry(message)} className="ml-1 font-semibold text-blue underline underline-offset-2">
                              {t('chat.thread.retry')}
                            </button>
                          </MessageFooter>
                        ) : null}
                      </Bubble>
                    );
                  })}
                </BubbleGroup>
                <MessageFooter className="flex items-center gap-1">
                  <span className="u-tabular">{chatClock(lastRow.createdAt, locale)}</span>
                  {holdsLastMine && lastMine.status !== 'failed' ? (
                    <>
                      <span aria-hidden="true">·</span>
                      {lastMine.status === 'sending' ? (
                        <span>{t('chat.thread.sending')}</span>
                      ) : typeof lastMine.id === 'number' && lastMine.id <= otherLastReadId ? (
                        <span className="inline-flex items-center gap-0.5 text-blue">
                          <CheckCheck strokeWidth={2} className="size-3.5" aria-hidden="true" />
                          {t('chat.thread.read')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5">
                          <Check strokeWidth={2} className="size-3.5" aria-hidden="true" />
                          {t('chat.thread.sent')}
                        </span>
                      )}
                    </>
                  ) : null}
                </MessageFooter>
              </MessageContent>
            </Message>
          </li>
        );
      })}
    </ol>
  );
}

/** "Nouveaux messages": slides in when one arrives below the reader, and out once they are back down. */
export function AppNewMessagesPill({ show, onClick, label }) {
  return (
    <AnimatePresence>
      {show ? (
        <m.button
          type="button"
          onClick={onClick}
          initial={{ opacity: 0, y: 12, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.9 }}
          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
          className="u-focus-ring absolute bottom-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-blue px-4 py-2 text-[0.8125rem] font-semibold text-white shadow-lg"
        >
          <ArrowDown strokeWidth={2} className="size-4" aria-hidden="true" />
          {label}
        </m.button>
      ) : null}
    </AnimatePresence>
  );
}
