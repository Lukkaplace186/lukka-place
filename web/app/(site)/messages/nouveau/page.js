import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MessageCircleOff } from 'lucide-react';
import ChatStart from '@/components/chat/ChatStart';
import { findCustomerThreadId, getChatTarget, getChatViewer } from '@/lib/chat';
import { parseId } from '@/lib/chatRules';
import { getCentralWhatsAppHref } from '@/lib/whatsapp';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('chat.metaTitle'), robots: { index: false, follow: false } };
}

export const dynamic = 'force-dynamic';

/**
 * /messages/nouveau?listing=<id> (from a listing) or ?agent=<id> (from an
 * agent's profile): the first message. Signed out → login, then back here
 * with the same query. A conversation that already exists opens instead, so
 * "Envoyer un message" never starts a second thread about the same listing.
 * An agent who cannot receive messages (number not verified, routing off)
 * gets an honest page, never a composer the server would then refuse.
 */
export default async function NewConversationPage({ searchParams }) {
  const params = await searchParams;
  const listingId = parseId(params?.listing);
  const agentId = listingId ? null : parseId(params?.agent);
  const self = listingId ? `/messages/nouveau?listing=${listingId}` : agentId ? `/messages/nouveau?agent=${agentId}` : '/messages';
  if (!listingId && !agentId) redirect('/messages');

  const viewer = await getChatViewer('customer');
  if (!viewer) redirect(`/compte/connexion?next=${encodeURIComponent(self)}`);

  const t = await getT();
  const target = await getChatTarget({ propertyId: listingId, agentId });

  if (!target) {
    const whatsappHref = getCentralWhatsAppHref('Bonjour, je vous contacte depuis lukkaplace.com.');
    return (
      <div className="mx-auto w-full max-w-[40rem] px-4 py-12 sm:px-6">
        <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface px-6 py-10 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-canvas-alt text-ink-45">
            <MessageCircleOff strokeWidth={ICON_STROKE_WIDTH} className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="u-title-section text-ink">{t('chat.start.unavailableTitle')}</h1>
          <p className="max-w-[28rem] text-[0.9375rem] leading-relaxed text-ink-70">{t('chat.start.unavailableBody')}</p>
          <div className="mt-2 flex flex-col gap-2.5 sm:flex-row">
            {listingId ? (
              <Link href={`/listings/${listingId}`} className="u-press u-btn-secondary rounded-lg px-5 py-3 text-sm font-semibold text-ink no-underline">
                {t('chat.start.backToListing')}
              </Link>
            ) : null}
            {whatsappHref ? (
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="u-press rounded-lg bg-green px-5 py-3 text-sm font-semibold text-white no-underline hover:bg-green-deep">
                {t('chat.guest.whatsapp')}
              </a>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  const existing = await findCustomerThreadId(viewer.id, target.agentId, target.propertyId);
  if (existing) redirect(`/messages/${existing}`);

  return (
    <div className="mx-auto w-full max-w-[40rem] px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
      <ChatStart target={target} />
    </div>
  );
}
