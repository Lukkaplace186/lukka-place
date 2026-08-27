import { ArrowUpRight } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import CopyLinkButton from './CopyLinkButton';

/**
 * Royal hero banner — the real single public link an agent already has
 * (their own /agents/[id] storefront page, same URL the dashboard's
 * previous "Voir mon profil public" link already pointed at), not the
 * source design's fabricated "portfolio" concept. `listingsCount` is the
 * real count already fetched for the dashboard's own stats.
 */
export default function AgentPortfolioBanner({ listingsCount, profileUrl, profilePath }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-6 rounded-card bg-blue-deep px-6 py-6 sm:px-7">
      <div className="min-w-0">
        <div className="u-eyebrow text-white/60">Votre profil public</div>
        <div className="font-display mt-1.5 text-[1.5rem] leading-tight text-white">
          Partagez vos {listingsCount} bien{listingsCount === 1 ? '' : 's'} en un lien
        </div>
        <div className="mt-1 truncate text-sm text-white/70">{profileUrl}</div>
      </div>
      <div className="flex flex-none flex-wrap gap-2.5">
        <CopyLinkButton
          url={profileUrl}
          label="Copier mon lien"
          className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-bold text-blue-deep transition-transform hover:-translate-y-0.5"
        />
        <a
          href={profilePath}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-bold text-white ring-1 ring-inset ring-white/40 transition-colors hover:bg-white/10"
        >
          Voir ma page
          <ArrowUpRight strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}
