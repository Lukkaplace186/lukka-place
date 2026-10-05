import { ExternalLink } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { buildWhatsAppShareLink } from '@/lib/whatsapp';
import CopyLinkButton from './CopyLinkButton';
import { WhatsAppIcon } from './WhatsAppCTA';
import { getT } from '@/lib/i18n/server';

/**
 * The overview's share card (2026-10-05 redesign): the first thing on the
 * page after today's visit reminder, because sending this link is the daily
 * action that brings an agent customers.
 *
 * "Copier le lien" confirms in place ("Copié !"); "WhatsApp" opens the share
 * sheet with the message already written. The message is French whatever the
 * dashboard language: the agent's customers read it (same rule as
 * lib/listingShareCopy.js). The URL chip opens the public page itself.
 *
 * `liveCount` is the number of public listings — the same rule as the "En
 * ligne" chip on Mes biens, so the card and the list say the same number.
 */
const SHARE_MESSAGE = 'Découvrez mes biens à Kinshasa sur Lukka Place : ';

export default async function AgentPortfolioBanner({ liveCount, profileUrl, profilePath }) {
  const t = await getT();
  const displayUrl = profileUrl.replace(/^https?:\/\//, '');
  return (
    <section
      aria-label={t('agent.portfolio.yourPublicPortfolio')}
      className="relative overflow-hidden rounded-panel bg-blue-deep p-4 text-white sm:p-6"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-[radial-gradient(closest-side,rgba(185,198,251,0.28),rgba(185,198,251,0))]"
      />
      <div className="relative flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div className="min-w-0">
          <div className="text-[0.6875rem] font-bold uppercase tracking-[0.14em] text-white/70">
            {t('agent.portfolio.yourPublicPortfolio')}
          </div>
          <p className="font-display mt-1.5 text-[1.5rem] leading-[1.15] sm:text-[1.75rem]">
            {liveCount === 0 ? t('agent.portfolio.pageReady') : t('agent.portfolio.shareHeadline', { count: liveCount })}
          </p>
          <a
            href={profilePath}
            target="_blank"
            rel="noopener noreferrer"
            className="u-press mt-3 inline-flex min-h-10 max-w-full items-center gap-2 rounded-lg bg-white/10 px-3 text-[0.8125rem] font-semibold text-white/90 hover:bg-white/15"
          >
            <span className="truncate">{displayUrl}</span>
            <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 shrink-0" aria-hidden="true" />
          </a>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-none">
          <CopyLinkButton
            url={profileUrl}
            label={t('agent.portfolio.copyLink')}
            className="u-press inline-flex h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold text-white ring-[1.5px] ring-inset ring-white/60 transition-colors hover:bg-white/10 sm:px-5"
          />
          <a
            href={buildWhatsAppShareLink(SHARE_MESSAGE + profileUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="u-press inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-white px-3 text-sm font-bold text-blue-deep transition-shadow hover:shadow-md sm:px-5"
          >
            <WhatsAppIcon className="h-[1.125rem] w-[1.125rem] text-green-ink" />
            {t('agent.portfolio.shareWhatsApp')}
          </a>
        </div>
      </div>
    </section>
  );
}
