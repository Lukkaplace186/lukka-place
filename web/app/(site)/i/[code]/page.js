import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Bell, CalendarCheck, Heart } from 'lucide-react';
import AgentAvatar from '@/components/AgentAvatar';
import PropertyCard from '@/components/PropertyCard';
import { getT } from '@/lib/i18n/server';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { normalisePartnerCode } from '@/lib/partnerRules';
import { resolveCode } from '@/lib/partners';
import { agentPublicName, getAgentListings, getAgentProfile } from '@/lib/agencies';
import RememberInvite from './RememberInvite';
import { whatsappSignupLink } from '@/lib/whatsappSignup';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const t = await getT();
  return { title: t('auth.invite.metaTitle'), robots: { index: false, follow: false } };
}

const BENEFITS = [
  { icon: Bell, titleKey: 'auth.invite.benefitAlertsTitle', textKey: 'auth.invite.benefitAlertsText' },
  { icon: Heart, titleKey: 'auth.invite.benefitFavoritesTitle', textKey: 'auth.invite.benefitFavoritesText' },
  { icon: CalendarCheck, titleKey: 'auth.invite.benefitVisitsTitle', textKey: 'auth.invite.benefitVisitsText' },
];

/** Through /go, so the landing is tagged with the partner's campaign. */
function viaGo(code, to) {
  return `/go/${encodeURIComponent(code)}?to=${encodeURIComponent(to)}`;
}

/**
 * "Créez votre compte gratuit — invité par Marie" (growth plan item 11). The
 * page an agent or a creator shares to bring customers: who invites them
 * (an agent's real name and photo, and up to three of their live listings),
 * what an account gives, and one button.
 *
 * Opening the page remembers the partner and counts the click
 * (RememberInvite → ./actions.js, from the browser: a Server Component cannot
 * set cookies, and WhatsApp's link-preview fetcher runs no JavaScript), so a
 * visitor who browses the listings instead of tapping the button is still
 * credited when they sign up. The button goes through /go as well, which
 * tags the landing and repeats nothing (first valid referral wins, one click
 * per connection per hour).
 *
 * A sales rep's code goes to their own /r/ page; an unknown or switched-off
 * code is a 404. No `loading.js` here, so that 404 is a real one.
 */
export default async function InvitePage({ params }) {
  const t = await getT();
  const { code: raw } = await params;
  const code = normalisePartnerCode(raw);
  if (!code) notFound();

  const resolved = await resolveCode(code).catch(() => null);
  if (resolved?.type === 'rep') redirect(`/r/${encodeURIComponent(resolved.code)}`);
  if (resolved?.type !== 'partner') notFound();
  const { partner } = resolved;

  let agent = null;
  let listings = [];
  if (partner.kind === 'agent' && partner.agentId) {
    agent = await getAgentProfile(partner.agentId).catch(() => null);
    if (agent) {
      const result = await getAgentListings(agent.id, { limit: 3 }).catch(() => null);
      listings = result?.data || [];
    }
  }
  const inviterName = agent ? agentPublicName(agent) || partner.name : partner.name;
  const image = agent && typeof agent.image === 'string' && /^https:\/\//.test(agent.image) ? agent.image : null;

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <RememberInvite code={code} />
      <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-4 text-center">
        {agent ? (
          <div className="h-20 w-20 overflow-hidden rounded-full border border-line bg-surface">
            <AgentAvatar src={image} alt={inviterName} />
          </div>
        ) : null}
        <p className="u-eyebrow text-blue-deep">{t('auth.invite.invitedBy', { name: inviterName })}</p>
        <h1 className="u-title-hero text-ink">{t('auth.invite.title')}</h1>
        <p className="u-body text-ink-70">{t('auth.invite.lead')}</p>
        <a href={viaGo(code, '/compte/inscription')} className="u-btn-primary u-press inline-flex h-12 items-center justify-center rounded-lg bg-blue px-6 text-base font-bold text-white hover:bg-blue-deep">
          {t('auth.invite.cta')}
        </a>
        {whatsappSignupLink(code) ? (
          <a href={whatsappSignupLink(code)} target="_blank" rel="noopener noreferrer" className="u-micro-strong text-green-ink underline">
            {t('auth.whatsappSignup.cta')}
          </a>
        ) : null}
        <p className="u-micro text-ink-45">{t('auth.invite.free')}</p>
      </section>

      <ul className="mx-auto grid w-full max-w-3xl gap-3 sm:grid-cols-3">
        {BENEFITS.map(({ icon: Icon, titleKey, textKey }) => (
          <li key={titleKey} className="u-card rounded-card bg-surface p-4">
            <Icon strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 text-blue-deep" aria-hidden />
            <h2 className="u-title-sub mt-2 text-ink">{t(titleKey)}</h2>
            <p className="u-micro mt-1 text-ink-70">{t(textKey)}</p>
          </li>
        ))}
      </ul>

      {listings.length ? (
        <section className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <h2 className="u-title-storefront text-ink">{t('auth.invite.listingsTitle')}</h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <PropertyCard key={listing.id} listing={listing} />
            ))}
          </div>
        </section>
      ) : null}

      <p className="text-center">
        <Link href={viaGo(code, '/listings')} className="u-micro-strong text-blue-deep hover:underline">
          {t('auth.invite.browse')}
        </Link>
      </p>
    </div>
  );
}
