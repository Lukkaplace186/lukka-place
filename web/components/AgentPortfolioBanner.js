import { ArrowUpRight } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import CopyLinkButton from './CopyLinkButton';

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
export default function AgentPortfolioBanner({ listingsCount, profileUrl, profilePath }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-5 rounded-panel bg-blue-deep px-7 py-6">
      <div className="min-w-0">
        <div className="text-[0.6875rem] font-bold uppercase tracking-[0.16em] text-white/65">
          Votre portfolio public
        </div>
        <div className="font-display mt-1.5 text-[1.625rem] leading-tight text-white">
          {listingsCount === 0
            ? 'Votre page est prête à recevoir vos biens'
            : `Partagez vos ${listingsCount} bien${listingsCount === 1 ? '' : 's'} en un lien`}
        </div>
        <div className="mt-1 truncate text-[0.8125rem] text-white/70">{profileUrl}</div>
      </div>

      <div className="flex flex-none flex-wrap gap-2.5">
        <CopyLinkButton
          url={profileUrl}
          label="Copier mon lien portfolio"
          className="u-press inline-flex h-12 items-center gap-2 rounded-lg bg-white px-5 text-[0.9375rem] font-bold text-blue-deep transition-shadow hover:shadow-md"
        />
        <a
          href={profilePath}
          target="_blank"
          rel="noopener noreferrer"
          className="u-press inline-flex h-12 items-center gap-2 rounded-lg px-5 text-[0.9375rem] font-bold text-white ring-1 ring-inset ring-white/45 transition-colors hover:bg-white/10"
        >
          Voir ma page
          <ArrowUpRight strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
        </a>
      </div>
    </div>
  );
}
