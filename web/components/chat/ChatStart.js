'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import ChatComposer from './ChatComposer';
import { ChatAvatar, ChatListingRow } from './ChatParts';
import ChatSafetyNote from './ChatSafetyNote';
import { chatErrorKey, chatRequest, newClientId } from '@/lib/chatClient';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { useT } from '@/lib/i18n/client';

/**
 * The first message to an agent (/messages/nouveau). Sending creates the
 * conversation (POST /api/chat/threads) and opens it. The client id is kept
 * across a retry, so a send that reached the server before the connection
 * dropped is never posted twice.
 */
export default function ChatStart({ target }) {
  const t = useT();
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [errorKey, setErrorKey] = useState(null);
  const [clientId] = useState(() => newClientId());

  const person = { role: 'agent', name: target.name, agency: target.agency, image: target.image, verified: true };
  const suggestions = target.propertyId
    ? [t('chat.start.suggestions.available'), t('chat.start.suggestions.visit'), t('chat.start.suggestions.terms')]
    : [t('chat.start.suggestions.general')];

  async function send(body) {
    if (sending) return false;
    setSending(true);
    setErrorKey(null);
    const result = await chatRequest('/threads', {
      method: 'POST',
      body: { propertyId: target.propertyId, agentId: target.propertyId ? undefined : target.agentId, body, clientId },
    });
    if (result.ok) {
      router.replace(`/messages/${result.data.threadId}`);
      return true;
    }
    if (result.status === 401) {
      router.push(`/compte/connexion?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return false;
    }
    setSending(false);
    setErrorKey(chatErrorKey(result.status === 0 ? 'network' : result.data?.error));
    return false;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5">
        <div className="flex items-center gap-3.5">
          <ChatAvatar person={person} size="lg" t={t} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="u-title-section truncate text-ink">
              {target.name ? t('chat.start.title', { name: target.name }) : t('chat.start.titleNoName')}
            </h1>
            <p className="truncate text-[0.875rem] text-ink-45">
              {[target.agency && target.agency !== target.name ? target.agency : null, t('chat.verified')].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        {target.propertyId ? (
          <div className="rounded-xl bg-canvas-alt p-3">
            <ChatListingRow listing={target.listing} propertyId={target.propertyId} t={t} />
          </div>
        ) : null}
        <p className="text-[0.9375rem] leading-relaxed text-ink-70">{t('chat.start.lead')}</p>
        {errorKey ? (
          <p role="alert" className="flex items-start gap-2 text-[0.875rem] font-semibold text-danger">
            <AlertCircle strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
            {t(errorKey)}
          </p>
        ) : null}
        <ChatComposer onSend={send} disabled={sending} t={t} suggestions={suggestions} autoFocus />
      </div>
      <ChatSafetyNote text={t('chat.safety')} />
    </div>
  );
}
