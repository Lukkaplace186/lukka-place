import { notFound } from 'next/navigation';
import { Star } from 'lucide-react';
import InquiryForm from './InquiryForm';
import AgentProfileView from './AgentProfileView';
import ProjectCard from '@/components/projects/ProjectCard';
import { getPublicProjects } from '@/lib/developments';
import { getAgentPublicRating, formatAverage } from '@/lib/agentReviews';
import { getLocale, getT } from '@/lib/i18n/server';
import { getAgentProfile, getAgentListings, agentContactName, agentPublicName } from '@/lib/agencies';
import { buildWhatsAppLink, getCentralWhatsAppHref } from '@/lib/whatsapp';
import { listingImages, typeLabel, specItems, feedLocationLine } from '@/lib/listingView';
import { placeLabel } from '@/lib/placeLabel';
import { isVerifiedLevel, LEVEL_LABEL_KEYS } from '@/lib/verificationLevels';
import { formatPhoneDisplay, telHref } from '@/lib/phone';
import { SITE_URL, ICON_STROKE_WIDTH } from '@/lib/constants';
import JsonLd from '@/components/seo/JsonLd';
import { DEFAULT_CITY, cityOfCommune, communeLabel } from '@/lib/cities';

const PROFILE_MESSAGE =
  "Bonjour, j'ai vu votre profil sur Lukka Place et j'aimerais en savoir plus sur vos biens.";

// The design's two tabs (no "Tous", no "Parcelles"). `labelKey`, not `label`:
// a module-level constant cannot hold translated text (components/navItems.js).
const TABS = [
  { key: 'location', labelKey: 'agent.portfolio.toRent', emptyKey: 'agent.portfolio.emptyTitleRent', seeking: 'à louer' },
  { key: 'vente', labelKey: 'agent.portfolio.toSell', emptyKey: 'agent.portfolio.emptyTitleSale', seeking: 'à acheter' },
];

// Rows per tab. The list is client-sorted (récents / prix), so it has to hold
// the whole portfolio rather than one page of it; 60 covers every agency today.
const LISTINGS_PER_TAB = 60;

export async function generateMetadata({ params }) {
  const { id } = await params;
  const agent = await getAgentProfile(id);
  if (!agent) return {};

  const name = agentPublicName(agent);
  return { title: `${name} — Lukka Place`, description: agent.bio?.slice(0, 160), alternates: { canonical: `/agents/${agent.id}` } };
}

/**
 * The public agency profile, built from Claude Design's "Agent Profile
 * Mobile" 5a (2026-11-03) — layout and interactions live in
 * AgentProfileView.js; this file decides every fact it shows.
 *
 * It lives in the (portfolio) route group, not (site), so the site header's
 * search chrome does not render here.
 *
 * Restraints, all about not saying more than the data supports:
 *  - The agent's number (call button, contact line, WhatsApp) is published
 *    only under the listing pages' rule — phone verified AND direct routing
 *    not switched off. Otherwise WhatsApp goes to Lukka Place's central
 *    number and there is no call button.
 *  - "Nouveau" is the database's is_fresh, "Réservé" is listing_status
 *    under_offer. No response-time line: nothing measures it.
 *  - A row's WhatsApp message is the storefront's own (lib/leadRouting.js),
 *    so the engine still recognises the enquiry by its listing link.
 */
export default async function AgentStorefrontPage({ params, searchParams }) {
  const t = await getT();
  const { id } = await params;
  const sp = await searchParams;

  const agent = await getAgentProfile(id);
  if (!agent) notFound();

  // Both tabs at once: the segmented control shows each tab's count and
  // switches without a round trip. Projects and ratings never take the
  // profile down.
  const [rentals, sales, projects, rating, locale] = await Promise.all([
    getAgentListings(agent.id, { transactionType: 'location', limit: LISTINGS_PER_TAB }),
    getAgentListings(agent.id, { transactionType: 'vente', limit: LISTINGS_PER_TAB }),
    getPublicProjects({ agentId: agent.id }).catch((err) => {
      console.error(`[agents/${agent.id}] projects unavailable: ${err.message}`);
      return [];
    }),
    getAgentPublicRating(agent.id),
    getLocale(),
  ]);

  // A shared ?tab= wins; otherwise open on À louer unless it is empty and
  // À vendre is not, so a sales-only agency does not greet with an empty list.
  const initialTab = TABS.some((entry) => entry.key === sp.tab)
    ? sp.tab
    : rentals.data.length === 0 && sales.data.length > 0 ? 'vente' : TABS[0].key;

  // The agency / trade name when the agent gave one, else their own name. An
  // agent with no name yet has `username` = their phone digits (createAgent):
  // shown formatted, and then the phone is not repeated in the contact line.
  const name = agentPublicName(agent) || '—';
  const hasRealName = name !== '—' && !/^\d{9,15}$/.test(name);
  const headingName = hasRealName ? name : /^\d{9,15}$/.test(name) ? formatPhoneDisplay(name) : name;
  const initialChar = hasRealName ? headingName.trim().charAt(0).toUpperCase() : null;
  const initial = /[A-ZÀ-Þ]/.test(initialChar || '') ? initialChar : null;

  const communes = agent.primary_communes || [];
  const agentCities = [...new Set(communes.map((c) => cityOfCommune(c) || DEFAULT_CITY))];
  const profileUrl = `${SITE_URL}/agents/${agent.id}`;

  // Same three conditions as lib/listings.js's agent_phone.
  const routablePhone = agent.phone && agent.phone_verified_at && agent.direct_routing_enabled !== false
    ? String(agent.phone).replace(/\D/g, '')
    : null;
  const whatsappTo = (message) => (routablePhone ? buildWhatsAppLink(routablePhone, message) : getCentralWhatsAppHref(message));

  const contactName = agentContactName(agent);
  const subline = [contactName, routablePhone && hasRealName ? formatPhoneDisplay(routablePhone) : null]
    .filter(Boolean)
    .join(' · ');

  // A card is a link to the listing page (AgentProfileView), so only what the
  // card shows is sent; contact and booking live on that page.
  function toItem(listing) {
    const type = typeLabel(listing, t) || listing.title || '';
    return {
      id: listing.id,
      href: `/listings/${listing.id}`,
      title: listing.title || type,
      type,
      place: placeLabel(listing) || feedLocationLine(listing),
      commune: listing.commune || null,
      price: listing.price,
      purpose: listing.purpose,
      pricePeriod: listing.price_period,
      currency: listing.currency || 'USD',
      priceOriginal: listing.price_original ?? null,
      specList: specItems(listing, t).map(({ key, value, label }) => ({ key, value, label })),
      photos: listingImages(listing),
      isNew: Boolean(listing.is_fresh) && listing.listing_status !== 'under_offer',
      reserved: listing.listing_status === 'under_offer',
      createdAt: listing.created_at ? new Date(listing.created_at).toISOString() : null,
    };
  }

  const tabs = TABS.map((entry, index) => {
    const items = (index === 0 ? rentals : sales).data.map(toItem);
    return {
      key: entry.key,
      label: t(entry.labelKey),
      countLabel: t('agent.portfolio.listingCount', { count: items.length }),
      items,
      emptyTitle: t(entry.emptyKey),
      alertHref: whatsappTo(
        `Bonjour, je cherche un bien ${entry.seeking}. Pouvez-vous me prévenir quand un bien correspond ? (vu sur ${profileUrl})`,
      ),
    };
  });

  const view = {
    name: headingName,
    initial,
    image: agent.image || null,
    bio: agent.bio || null,
    subline: subline || null,
    communes: communes.map((c) => communeLabel(c)),
    verifiedLabel: isVerifiedLevel(agent.verification_level) ? t(LEVEL_LABEL_KEYS[agent.verification_level]) : null,
    rating: rating ? `${formatAverage(rating.average, locale)} (${t('agent.portfolio.reviewsCount', { count: rating.count })})` : null,
    telHref: routablePhone ? telHref(routablePhone) : null,
    whatsappHref: whatsappTo(PROFILE_MESSAGE),
    // The header's address line: the office address when one is on file,
    // else the city (or cities) the agent's communes are in.
    locationLine: [agent.address, agent.city || agentCities.join(', ')].filter(Boolean).join(', ') || null,
  };

  const labels = {
    activeCount: t('agent.portfolio.activeCount', { count: agent.live_listing_count ?? rentals.data.length + sales.data.length }),
    sorts: {
      recent: t('agent.portfolio.sortRecent'),
      priceAsc: t('agent.portfolio.sortPriceAsc'),
      priceDesc: t('agent.portfolio.sortPriceDesc'),
    },
    newBadge: t('agent.portfolio.newBadge'),
    reservedBadge: t('agent.portfolio.reservedBadge'),
    emptyBody: t('agent.portfolio.emptyBody'),
    emptyCta: t('agent.portfolio.emptyCta'),
    call: t('agent.portfolio.call'),
    readMore: t('agent.portfolio.readMore'),
    readLess: t('agent.portfolio.readLess'),
    communesLabel: t('agent.portfolio.communesLabel'),
    linkCopied: t('agent.portfolio.linkCopied'),
    copyLink: t('agent.portfolio.copyLink'),
    logo: t('agent.portfolio.logo'),
    contactUnavailable: t('agent.portfolio.contactUnavailable'),
  };

  // RealEstateAgent structured data — only facts the page itself shows; no
  // phone (it has its own verification rule) and no name when the agent has
  // only a phone number for one.
  const agentJsonLd = hasRealName
    ? {
        '@context': 'https://schema.org',
        '@type': 'RealEstateAgent',
        name,
        url: profileUrl,
        ...(typeof agent.image === 'string' && /^https:\/\//.test(agent.image) ? { image: agent.image } : {}),
        ...(agent.bio ? { description: String(agent.bio).slice(0, 300) } : {}),
        areaServed: communes.length
          ? communes.map((c) => ({ '@type': 'Place', name: `${communeLabel(c)}, ${cityOfCommune(c) || DEFAULT_CITY}` }))
          : { '@type': 'Country', name: 'République démocratique du Congo' },
        address: { '@type': 'PostalAddress', addressLocality: agent.city || agentCities[0] || DEFAULT_CITY, addressCountry: 'CD' },
        parentOrganization: { '@id': `${SITE_URL.replace(/\/+$/, '')}/#organization`, '@type': 'Organization', name: 'Lukka Place' },
      }
    : null;

  return (
    <>
      <JsonLd data={agentJsonLd} />
      <AgentProfileView
        agent={view}
        tabs={tabs}
        initialTab={initialTab}
        labels={labels}
        profileUrl={profileUrl}
      >
        {projects.length ? (
          <section className="flex flex-col gap-4 border-t border-line/60 px-5 pt-8">
            <div>
              <span className="u-eyebrow">{t('projects.profile.eyebrow')}</span>
              <h2 className="u-title-section mt-1.5 text-ink">{t('projects.profile.title')}</h2>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => <ProjectCard key={project.id} project={project} />)}
            </div>
          </section>
        ) : null}

        {rating ? (
          <section id="avis" className="mt-8 flex scroll-mt-24 flex-col gap-4 border-t border-line/60 px-5 pt-8">
            <div>
              <span className="u-eyebrow">{t('agent.portfolio.reviewsEyebrow')}</span>
              <h2 className="u-title-section mt-1.5 text-ink">{t('agent.portfolio.reviewsTitle')}</h2>
              <p className="u-tabular mt-2 flex items-center gap-1.5 text-base font-bold text-ink">
                <Star strokeWidth={ICON_STROKE_WIDTH} className="h-5 w-5 fill-warning text-warning" aria-hidden="true" />
                {formatAverage(rating.average, locale)} {t('agent.portfolio.outOfFive')} · {t('agent.portfolio.reviewsCount', { count: rating.count })}
              </p>
              <p className="mt-1 text-[0.8125rem] text-ink-45">{t('agent.portfolio.reviewsNote')}</p>
            </div>
            {rating.comments.length ? (
              <ul className="grid gap-3 lg:grid-cols-2">
                {rating.comments.map((review) => (
                  <li key={review.id} className="rounded-card border border-line/60 bg-surface p-4">
                    <p className="flex gap-0.5" aria-label={`${review.stars}/5`}>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <Star
                          key={value}
                          strokeWidth={ICON_STROKE_WIDTH}
                          className={value <= review.stars ? 'h-4 w-4 fill-warning text-warning' : 'h-4 w-4 text-ink-25'}
                          aria-hidden="true"
                        />
                      ))}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-ink">{review.comment}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {/* The written enquiry stays (it creates a tracked lead and alerts
            the agent — root CLAUDE.md "Profile enquiries"), folded away so
            WhatsApp remains the one-gesture contact the design asks for. */}
        <details
          className="mx-5 mt-8 rounded-card border border-line/60 bg-surface p-4 lg:mx-4 lg:max-w-2xl"
          open={sp.inquiry_sent === '1' || Boolean(sp.inquiry_error)}
        >
          <summary className="cursor-pointer text-sm font-semibold text-ink">{t('agent.portfolio.writtenEnquiry')}</summary>
          <div className="mt-3">
            <InquiryForm agentId={agent.id} agentName={name} sent={sp.inquiry_sent === '1'} error={sp.inquiry_error} />
          </div>
        </details>
      </AgentProfileView>
    </>
  );
}
