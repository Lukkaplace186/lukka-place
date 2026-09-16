import { ArrowUpRight } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import CopyLinkButton from './CopyLinkButton';
import { getT } from '@/lib/i18n/server';

/**
 * The design's royal "Votre portfolio public" banner — royal-700 fill,
 * 16px panel radius, an eyebrow over a DM Serif line, the real URL beneath
 * it, and a white primary button paired with an outline-on-royal one.
 *
 * The design calls this a "portfolio" at its own vanity URL
 * (lukkaplacer.com/agents/espace-kin-immobilier). The real equivalent that
 * already exists is the agent's own public storefront at /agents/[id] —
 * same thing, real route, no slug column on this schema to build a vanity
 * URL from. That is the link this copies and opens.
 */
export default async function AgentPortfolioBanner({ listingsCount, profileUrl, profilePath }) {
  const t = await getT();
  return (
    // Phone: the two buttons stack full-width under the text. They used to sit
    // in a `flex-none` row whose content width ("Copier mon lien portfolio" +
    // "Voir ma page") was wider than the screen, cutting the second one off.
    <div className="flex flex-col gap-4 rounded-panel bg-blue-deep px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-8 sm:gap-y-5 sm:px-7 sm:py-6">
      <div className="min-w-0">
        <div className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-white/65 sm:text-[0.6875rem]">
          {t('agent.portfolio.yourPublicPortfolio')}
        </div>
        <div className="font-display mt-1 text-[1.25rem] leading-tight text-white sm:mt-1.5 sm:text-[1.625rem]">
          {listingsCount === 0
            ? t('agent.portfolio.pageReady')
            : `Partagez vos ${listingsCount} bien${listingsCount === 1 ? '' : 's'} en un lien`}
        </div>
        <div className="mt-1 truncate text-xs text-white/70 sm:text-[0.8125rem]">{profileUrl}</div>
      </div>

      <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2 sm:flex sm:flex-none sm:flex-wrap sm:gap-2.5">
        <CopyLinkButton
          url={profileUrl}
          label={t('agent.overview.copyPortfolioLink')}
          className="u-press inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-3 text-center text-[0.8125rem] font-bold leading-tight text-blue-deep transition-shadow hover:shadow-md sm:h-12 sm:px-5 sm:text-[0.9375rem]"
        />
        <a
          href={profilePath}
          target="_blank"
          rel="noopener noreferrer"
          className="u-press inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-[0.8125rem] font-bold text-white ring-1 ring-inset ring-white/45 transition-colors hover:bg-white/10 sm:h-12 sm:px-5 sm:text-[0.9375rem]"
        >
          {t('agent.settings.viewMyPage')}
          <ArrowUpRight strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
        </a>
      </div>
    </div>
  );
}
