import { notFound } from 'next/navigation';
import InquiryForm from './InquiryForm';
import AgentProfileView from './AgentProfileView';
import ProjectCard from '@/components/projects/ProjectCard';
import { getPublicProjects } from '@/lib/developments';
import { getLocale, getT, localizedAlternates } from '@/lib/i18n/server';
import { getAgentProfile, getAgentListings, getAgentTrackRecord, agentContactName, agentPublicName } from '@/lib/agencies';
import { CONFIRM_AFTER_DAYS } from '@/lib/listingAvailability';
import { buildWhatsAppShareLink } from '@/lib/whatsapp';
import { contactWhatsAppHref } from '@/lib/leadRouting';
import { listingImages, typeLabel, specItems, feedLocationLine, LISTING_TIME_ZONE } from '@/lib/listingView';
import { placeLabel } from '@/lib/placeLabel';
import { isVerifiedLevel, LEVEL_LABEL_KEYS } from '@/lib/verificationLevels';
import { formatPhoneDisplay, telHref } from '@/lib/phone';
import { SITE_URL, ICON_STROKE_WIDTH } from '@/lib/constants';
import JsonLd from '@/components/seo/JsonLd';
import { DEFAULT_CITY, cityOfCommune, communeLabel } from '@/lib/cities';
import { chatStartHref } from '@/lib/chatRules';

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
  return { title: `${name} — Lukka Place`, description: agent.bio?.slice(0, 160), alternates: await localizedAlternates(`/agents/${agent.id}`) };
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
  // switches without a round trip. Projects never take the profile down.
  // No rating on the profile for now (owner decision, 2026-11-04: the
  // ratings feature is not launched) — lib/agentReviews.js is untouched.
  const [rentals, sales, projects, locale, trackRecord] = await Promise.all([
    getAgentListings(agent.id, { transactionType: 'location', limit: LISTINGS_PER_TAB }),
    getAgentListings(agent.id, { transactionType: 'vente', limit: LISTINGS_PER_TAB }),
    getPublicProjects({ agentId: agent.id }).catch((err) => {
      console.error(`[agents/${agent.id}] projects unavailable: ${err.message}`);
      return [];
    }),
    getLocale(),
    // "N biens loués ou vendus" and "Annonces à jour" (web/CLAUDE.md,
    // "Incentives for keeping listings up to date"); never throws.
    getAgentTrackRecord(agent.id),
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
  // Through the Lukka Place number with the profile's link (2026-11-09):
  // services/contactRelay.js records the customer, alerts the agent and
  // hands the customer the agent's WhatsApp (lib/leadRouting.js).
  const whatsappTo = (message) => contactWhatsAppHref({
    agentPhone: routablePhone,
    message,
    link: `${SITE_URL}/agents/${agent.id}`,
  });

  const contactName = agentContactName(agent);
  const subline = [
    contactName ? t('agent.portfolio.contactPerson', { name: contactName }) : null,
    routablePhone && hasRealName ? formatPhoneDisplay(routablePhone) : null,
  ]
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

  // The cover band's photo: the newest public listing that has one. A real
  // photo of a real place this agency lists — never a stock image; no photo
  // anywhere means the plain blue band.
  const coverImage = [...rentals.data, ...sales.data]
    .map((listing) => ({ at: listing.created_at ? new Date(listing.created_at).getTime() : 0, src: listingImages(listing)[0] }))
    .filter((entry) => entry.src)
    .sort((a, b) => b.at - a.at)[0]?.src || null;

  // "Membre depuis mars 2024", from the account's own creation date, on the
  // Kinshasa calendar so the server and every phone print the same month.
  const memberDate = agent.member_since ? new Date(agent.member_since) : null;
  const memberSince = memberDate && !Number.isNaN(memberDate.getTime())
    ? t('agent.portfolio.memberSinceMonth', {
        date: new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { month: 'long', year: 'numeric', timeZone: LISTING_TIME_ZONE }).format(memberDate),
      })
    : null;

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
    memberSince,
    // Shown only when every public live listing is up to date (and there is
    // at least one) — absent otherwise, never "pas à jour".
    upToDateLabel: trackRecord.upToDate ? t('agent.portfolio.upToDate') : null,
    upToDateHint: trackRecord.upToDate ? t('agent.portfolio.upToDateHint', { days: CONFIRM_AFTER_DAYS }) : null,
    coverImage,
    // The contact rail's person: the agent's own name, shown only when it
    // differs from the heading (an agency name), with their initials.
    contactName: contactName && contactName !== headingName ? contactName : null,
    contactInitials: contactName
      ? contactName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('')
      : null,
    communesCount: communes.length,
    telHref: routablePhone ? telHref(routablePhone) : null,
    // Messagerie (web/CLAUDE.md): offered to the same agents whose number is
    // published, which is exactly who lib/chat.js lets a customer write to.
    messageHref: routablePhone ? chatStartHref({ agentId: agent.id }) : null,
    whatsappHref: whatsappTo(PROFILE_MESSAGE),
    // Contact goes to Lukka Place's desk when the agency's number is not
    // published; the button says so instead of promising the agency.
    whatsappIsCentral: !routablePhone,
    // A share to anyone (WhatsApp's contact picker), French — read by the
    // agency's customers whatever language this visitor browses in.
    shareHref: buildWhatsAppShareLink(`${hasRealName ? name : 'Une agence'} sur Lukka Place : ses biens à louer et à vendre.
${profileUrl}`),
    // The alert band: the same pre-written ask as the empty-tab button, for
    // any kind of property. The agency answers it — Lukka Place's own
    // search alerts cannot be limited to one agency.
    alertHref: whatsappTo(
      `Bonjour, je cherche un bien. Pouvez-vous me prévenir quand un bien correspond ? (vu sur ${profileUrl})`,
    ),
    // The header's address line: the office address when one is on file,
    // else the city (or cities) the agent's communes are in.
    locationLine: [agent.address, agent.city || agentCities.join(', ')].filter(Boolean).join(', ') || null,
  };

  const liveCount = agent.live_listing_count ?? rentals.data.length + sales.data.length;
  const labels = {
    liveCount,
    liveCountLabel: t('agent.portfolio.statListings', { count: liveCount }),
    communesCountLabel: t('agent.portfolio.statCommunes', { count: communes.length }),
    // Let / sold listings the agent closed with us: a count, never a price,
    // and no cell at all before the first one.
    closedCount: trackRecord.closedCount,
    closedCountLabel: trackRecord.closedCount >= 1 ? t('agent.portfolio.statClosed', { count: trackRecord.closedCount }) : null,
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
    agencies: t('agent.portfolio.backToAgencies'),
    about: t('agent.portfolio.aboutEyebrow'),
    listingsHeading: t('agent.portfolio.listingsHeading', { name: hasRealName ? name : t('agent.portfolio.thisAgency') }),
    featuredEyebrow: t('agent.portfolio.featuredEyebrow'),
    featuredCta: t('agent.portfolio.featuredCta'),
    whatsappCta: t('agent.portfolio.whatsappCta'),
    messageCta: t('chat.cta.message'),
    messageShort: t('chat.cta.messageShort'),
    whatsappCentralCta: t('agent.portfolio.whatsappCentralCta'),
    centralNote: t('agent.portfolio.centralNote'),
    shareCta: t('agent.portfolio.shareCta'),
    shareShort: t('agent.portfolio.shareShort'),
    contactCardTitle: t('agent.portfolio.contactCardTitle'),
    contactRole: t('agent.portfolio.contactRole'),
    writeToAgency: t('agent.portfolio.writeToAgency'),
    zonesLabel: t('agent.portfolio.zonesLabel'),
    alertTitle: t('agent.portfolio.alertTitle', { name: hasRealName ? name : t('agent.portfolio.thisAgency') }),
    alertBody: t('agent.portfolio.alertBody'),
    alertCta: t('agent.portfolio.emptyCta'),
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
        enquiryOpen={sp.inquiry_sent === '1' || Boolean(sp.inquiry_error)}
        enquiry={
          // The written enquiry creates a tracked lead and alerts the agent
          // (root CLAUDE.md "Profile enquiries"); on a laptop it sits in the
          // contact rail, on a phone it is folded under the listings.
          <InquiryForm agentId={agent.id} agentName={name} sent={sp.inquiry_sent === '1'} error={sp.inquiry_error} />
        }
      >
        {projects.length ? (
          <section className="flex flex-col gap-4">
            <div>
              <span className="u-eyebrow">{t('projects.profile.eyebrow')}</span>
              <h2 className="u-title-section mt-1.5 text-ink">{t('projects.profile.title')}</h2>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              {projects.map((project) => <ProjectCard key={project.id} project={project} />)}
            </div>
          </section>
        ) : null}
      </AgentProfileView>
    </>
  );
}
