'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bot, CheckCircle2, ExternalLink, Hand, Maximize2, Send } from 'lucide-react';
import { useToast } from '@/components/Toast';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { CONVERSATION_STATE_LABEL_KEYS, LEAD_STATUS_LABEL_KEYS } from '@/lib/adminLabels';
import { useT } from '@/lib/i18n/client';
import { Chip, ErrorNote, money } from '../LeadRoutingUI';
import AgentPicker from '../AgentPicker';
import MessageList from './MessageList';
import {
  assignConversationAgentAction,
  resolveConversationAction,
  returnConversationToAiAction,
  sendConversationReplyAction,
  takeOverConversationAction,
} from './actions';

const ACTION =
  'u-press u-micro-strong inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-ink transition-colors hover:border-blue disabled:opacity-50';

/**
 * Slide-over transcript for one WhatsApp thread.
 *
 * The open thread is the URL (`?c=<id>`), rendered by the server like every
 * other admin view: the page fetches the conversation, this component only
 * presents it. So a drawer can be linked, survives a refresh, and closing it is
 * a navigation back to the same filtered page.
 */
export default function ConversationDrawer({ conversation, messages, messagesTotal, leads, closeHref, fullHref, loadError }) {
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [reply, setReply] = useState('');
  const scroller = useRef(null);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages?.length]);

  function run(action, onDone) {
    startTransition(async () => {
      let result;
      try {
        result = await action();
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      showToast({ type: result?.ok ? 'success' : 'error', message: result?.ok ? result.message : result?.error });
      if (result?.ok) {
        onDone?.();
        router.refresh();
      }
    });
  }

  const close = () => router.replace(closeHref, { scroll: false });
  const id = conversation?.id;
  const closed = conversation?.state === 'CLOSED';
  const budget = conversation && (conversation.price_min != null || conversation.price_max != null)
    ? [conversation.price_min, conversation.price_max].map((v) => (v == null ? '…' : money(v))).join(' – ')
    : null;

  return (
    <Sheet open onOpenChange={(open) => { if (!open) close(); }}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:sm:max-w-2xl">
        {loadError || !conversation ? (
          <div className="p-6">
            <SheetTitle className="u-title-card text-ink">{t('admin.conversations.drawerError')}</SheetTitle>
            <SheetDescription className="sr-only">{t('admin.conversations.drawerError')}</SheetDescription>
            <div className="mt-3"><ErrorNote>{loadError || t('admin.conversations.notFound')}</ErrorNote></div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 border-b border-line px-5 pb-4 pt-5">
              <div className="flex items-start justify-between gap-3 pr-8">
                <div className="min-w-0">
                  <SheetTitle className="u-title-card u-tabular text-ink">+{conversation.wa_id}</SheetTitle>
                  <SheetDescription asChild>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Chip tone="blue">
                        {CONVERSATION_STATE_LABEL_KEYS[conversation.state] ? t(CONVERSATION_STATE_LABEL_KEYS[conversation.state]) : conversation.state}
                      </Chip>
                      <Chip tone={conversation.ai_active ? 'success' : 'warning'}>
                        {conversation.ai_active ? t('admin.conversations.aiActive') : t('admin.conversations.humanInControl')}
                      </Chip>
                      <span className="u-micro text-ink-45">{t('admin.conversations.messageCount', { count: messagesTotal })}</span>
                    </div>
                  </SheetDescription>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!closed && conversation.ai_active ? (
                  <button type="button" className={ACTION} disabled={pending} onClick={() => run(() => takeOverConversationAction(id))}>
                    <Hand strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                    {t('admin.conversations.takeOver')}
                  </button>
                ) : null}
                {!closed && !conversation.ai_active ? (
                  <button type="button" className={ACTION} disabled={pending} onClick={() => run(() => returnConversationToAiAction(id))}>
                    <Bot strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                    {t('admin.conversations.returnToAi')}
                  </button>
                ) : null}
                {!closed ? (
                  <button type="button" className={ACTION} disabled={pending} onClick={() => run(() => resolveConversationAction(id))}>
                    <CheckCircle2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                    {t('admin.conversations.markResolved')}
                  </button>
                ) : null}
                <a
                  href={`https://wa.me/${conversation.wa_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={ACTION}
                  title={t('admin.conversations.openWhatsappHint')}
                >
                  <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                  {t('admin.conversations.openWhatsapp')}
                </a>
                <Link href={fullHref} className={ACTION} title={t('admin.conversations.openFull')}>
                  <Maximize2 strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                </Link>
              </div>

              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <label className="flex flex-col gap-1">
                  <span className="u-eyebrow text-ink-45">{t('admin.conversations.assignedAgent')}</span>
                  <AgentPicker
                    allowClear
                    activeOnly
                    commune={conversation.commune || null}
                    defaultAgent={conversation.assigned_agent ? { id: -1, name: conversation.assigned_agent } : null}
                    onSelect={(agent) => run(() => assignConversationAgentAction(id, agent ? agent.id : null))}
                    disabled={pending}
                  />
                </label>
                <dl className="u-micro grid grid-cols-2 gap-x-3 gap-y-1 self-end text-ink-70">
                  <dt className="text-ink-45">{t('admin.conversations.commune')}</dt>
                  <dd className="truncate">{conversation.commune || '—'}</dd>
                  <dt className="text-ink-45">{t('admin.conversations.budget')}</dt>
                  <dd className="u-tabular truncate">{budget || '—'}</dd>
                  <dt className="text-ink-45">{t('admin.conversations.bedrooms')}</dt>
                  <dd>{conversation.bedrooms ?? '—'}</dd>
                </dl>
              </div>
            </div>

            <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto bg-surface px-5 py-4">
              <MessageList messages={messages} total={messagesTotal} t={t} />
            </div>

            {leads?.length ? (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-5 py-2">
                <span className="u-eyebrow text-ink-45">{t('admin.conversations.linkedLeads')}</span>
                {leads.map((lead) => (
                  <Link key={lead.id} href={`/admin/leads/${lead.id}`} className="hover:underline">
                    <Chip tone="blue">
                      #{lead.id} · {LEAD_STATUS_LABEL_KEYS[lead.status] ? t(LEAD_STATUS_LABEL_KEYS[lead.status]) : lead.status}
                    </Chip>
                  </Link>
                ))}
              </div>
            ) : null}

            <form
              className="flex items-end gap-2 border-t border-line px-5 py-3"
              onSubmit={(event) => {
                event.preventDefault();
                run(() => sendConversationReplyAction(id, reply), () => setReply(''));
              }}
            >
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    if (reply.trim()) run(() => sendConversationReplyAction(id, reply), () => setReply(''));
                  }
                }}
                rows={2}
                placeholder={conversation.ai_active ? t('admin.conversations.composerHintPlain') : t('admin.conversations.composerPlaceholder')}
                className="u-focus-ring min-h-[2.5rem] flex-1 resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
              <button
                type="submit"
                disabled={pending || !reply.trim()}
                className="u-press u-btn-primary inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue px-4 text-sm font-semibold text-white hover:bg-blue-deep disabled:opacity-50"
              >
                <Send strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
                {t('admin.conversations.send')}
              </button>
            </form>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
