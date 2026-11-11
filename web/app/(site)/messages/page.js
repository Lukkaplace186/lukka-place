import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import ChatInbox from '@/components/chat/ChatInbox';
import ChatSafetyNote from '@/components/chat/ChatSafetyNote';
import { getChatViewer, listThreads } from '@/lib/chat';
import { normaliseInboxFilter } from '@/lib/chatRules';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('chat.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

/**
 * The customer's inbox (Messagerie — web/CLAUDE.md). It replaced a page that
 * only linked to WhatsApp; WhatsApp stays offered to a visitor who is not
 * signed in, since chatting needs an account (the agent must know who wrote
 * and the reply must have somewhere to arrive).
 */
export default async function MessagesPage({ searchParams }) {
  const t = await getT();
  const viewer = await getChatViewer('customer');

  if (!viewer) {
    const whatsappHref = getCentralWhatsAppHref('Bonjour, je vous contacte depuis lukkaplace.com.');
    return (
      <div className="mx-auto w-full max-w-[40rem] px-4 py-12 sm:px-6 sm:py-16">
        <div className="flex flex-col items-center gap-4 rounded-card border border-line bg-surface px-6 py-10 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-blue-tint text-blue">
            <MessageCircle strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="u-title-section text-ink">{t('chat.guest.title')}</h1>
          <p className="max-w-[28rem] text-[0.9375rem] leading-relaxed text-ink-70">{t('chat.guest.body')}</p>
          <div className="mt-2 flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
            <Link
              href="/compte/connexion?next=%2Fmessages"
              className="u-press inline-flex items-center justify-center rounded-lg bg-blue px-5 py-3 text-sm font-semibold text-white no-underline transition-colors hover:bg-blue-deep"
            >
              {t('chat.guest.login')}
            </Link>
            <Link
              href="/compte/inscription?next=%2Fmessages&entree=messages"
              className="u-press u-btn-secondary inline-flex items-center justify-center rounded-lg px-5 py-3 text-sm font-semibold text-ink no-underline"
            >
              {t('chat.guest.signup')}
            </Link>
          </div>
          {whatsappHref ? (
            <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="mt-1 text-[0.875rem] font-semibold text-blue-deep">
              {t('chat.guest.whatsapp')}
            </a>
          ) : null}
        </div>
        <ChatSafetyNote text={t('chat.safety')} className="mt-5" />
      </div>
    );
  }

  const params = await searchParams;
  const filter = normaliseInboxFilter(params?.filter);
  const { threads, nextCursor } = await listThreads(viewer, { filter });

  return (
    <div className="mx-auto w-full max-w-[48rem] px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
      <header className="mb-6 flex flex-col gap-1.5">
        <h1 className="u-title-hero text-ink">{t('chat.title')}</h1>
        <p className="text-[0.9375rem] text-ink-45">{t('chat.lead')}</p>
      </header>
      <ChatInbox
        side="customer"
        basePath="/messages"
        initialThreads={threads}
        initialCursor={nextCursor}
        initialFilter={filter}
        serverNow={new Date().toISOString()}
      />
    </div>
  );
}
