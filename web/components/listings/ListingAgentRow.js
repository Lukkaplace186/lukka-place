import Link from '@/components/LocaleLink';
import { ChevronRight } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import AgentMonogram from '@/components/AgentMonogram';
import AgentVerificationBadge from '@/components/AgentVerificationBadge';
import AgentTrustLine from '@/components/listings/AgentTrustLine';
import { displayableAgencyName } from '@/lib/agentIdentity';
import { ICON_STROKE_WIDTH } from '@/lib/constants';

/**
 * Who offers the listing, as one row near the top of the phone page
 * (2026-11-18, owner: a smoother page — Airbnb's "Hosted by" row). The same
 * identity EnquiryCard's header shows: the agent's real name or Lukka Place,
 * never a phone number (displayableAgencyName), the verification badge only
 * for a verified tier, and a link to the public profile only for a real,
 * named agent. The contact buttons stay at the end of the page and in
 * MobileListingBar.
 */
export default async function ListingAgentRow({ listing }) {
  const t = await getT();
  const agentName = displayableAgencyName(listing.agency_name);
  const displayName = agentName || 'Lukka Place';
  const qualifier = agentName ? 'Agent partenaire' : 'Équipe Lukka Place';
  const profileHref = agentName && listing.agent_id ? `/agents/${listing.agent_id}` : null;

  const body = (
    <>
      <AgentMonogram logoUrl={listing.agency_logo_url} name={agentName} className="h-11 w-11" textClassName="text-[0.9375rem]" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[0.9375rem] font-bold text-ink">{displayName}</span>
        <span className="text-[0.8125rem] text-ink-45">{qualifier}</span>
        {agentName ? <AgentVerificationBadge level={listing.agent_verification_level} t={t} className="mt-0.5" /> : null}
        {agentName ? <AgentTrustLine listing={listing} className="mt-0.5" /> : null}
      </div>
    </>
  );

  return profileHref ? (
    <Link
      href={profileHref}
      aria-label={`${displayName} — ${t('listings.detail.viewAgentProfile')}`}
      className="u-press group flex items-center gap-3.5 py-1"
    >
      {body}
      <ChevronRight strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 flex-none text-ink-45" aria-hidden="true" />
    </Link>
  ) : (
    <div className="flex items-center gap-3.5 py-1">{body}</div>
  );
}
