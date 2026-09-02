import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BadgeCheck, Phone, Mail, MapPin, Building2 } from 'lucide-react';
import AgentAvatar from '@/components/AgentAvatar';
import PropertyCard from '@/components/PropertyCard';
import ShareOnWhatsAppButton from '@/components/ShareOnWhatsAppButton';
import VCardButton from '@/components/VCardButton';
import CopyLinkButton from '@/components/CopyLinkButton';
import CurrencyToggle from '@/components/CurrencyToggle';
import InquiryForm from './InquiryForm';
import { getAgentProfile, getAgentListings, agentDisplayName } from '@/lib/agencies';
import { buildWhatsAppLink, getCentralWhatsAppHref } from '@/lib/whatsapp';
import { formatPhoneDisplay } from '@/lib/phone';
import { SITE_URL, ICON_STROKE_WIDTH } from '@/lib/constants';

const PROFILE_MESSAGE =
  "Bonjour, j'ai vu votre profil sur Lukka Place et j'aimerais en savoir plus sur vos biens.";

// Only the two transaction tabs — no "Tous" (the tab row itself covers
// everything the portfolio has) and no "Parcelles" (a property-type facet,
// not a transaction type; it doesn't belong beside À louer/À vendre).
const TABS = [
  { key: 'location', label: 'À louer' },
  { key: 'vente', label: 'À vendre' },
];

/** Local to this page — /agents/[id] base, not /listings like lib/urlParams.js's helpers. */
function hrefWithParam(id, params, key, value) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null || v === '' || k === key) continue;
    qs.set(k, Array.isArray(v) ? v[0] : v);
  }
  if (value != null) qs.set(key, value);
  const s = qs.toString();
  return s ? `/agents/${id}?${s}` : `/agents/${id}`;
}

export async function generateMetadata({ params }) {
  const { id } = await params;
  const agent = await getAgentProfile(id);
  if (!agent) return {};

  const name = agentDisplayName(agent);
  return { title: `${name} — Lukka Place`, description: agent.bio?.slice(0, 160) };
}

/**
 * The public agency storefront, in an editorial-luxury register: an ink
 * hero where a serif agency name carries the page, a meta line and a quiet
 * verified chip instead of a shouted phone number, the portfolio in the
 * main column, and a pinned contact rail beside it.
 *
 * It lives in the (portfolio) route group, not (site), specifically so the
 * fixed left icon rail and bottom nav do NOT render here.
 *
 * Two deliberate restraints, both about not saying more than the data
 * supports:
 *  - There is no "response time" stat. Nothing measures it. The hero's
 *    second figure is the real commune count, and it disappears rather
 *    than printing a zero.
 *  - `metaLine` and the verified chip are assembled segment by segment
 *    from real columns; an agent with nothing to put in a slot gets no
 *    slot, not a plausible-sounding placeholder.
 *
 * Exactly two WhatsApp actions exist on the page — the hero's primary and
 * the rail's — and the share controls are icon-only in the hero rather
 * than a separate full-width strip.
 */
export default async function AgentStorefrontPage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;

  const agent = await getAgentProfile(id);
  if (!agent) notFound();

  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab : TABS[0].key;
  const q = typeof sp.q === 'string' ? sp.q : '';

  const listings = await getAgentListings(agent.id, {
    transactionType: tab,
    commune: sp.commune,
    search: q || undefined,
  });

  const filteredListings = listings.data;

  const name = agentDisplayName(agent) || '—';
  // An agent who signed up through this app and hasn't set a name yet has
  // `username` = their own phone digits (see createAgent), which renders as a
  // raw 12-digit string in the hero's 52px serif. Format it as a phone number
  // for display only — agentDisplayName itself stays untouched because it is
  // also the `assigned_agent` matching key on leads, and reformatting that
  // would orphan every lead already filed under the old string.
  const headingName = /^\d{9,15}$/.test(name) ? formatPhoneDisplay(name) : name;

  // True only when the agent has actually set a name. When they haven't, the
  // heading falls back to their phone number — and in that case the phone
  // must NOT also be repeated in the verified chip below it, which would put
  // the same 12 digits on screen twice.
  const hasRealName = name !== '—' && !/^\d{9,15}$/.test(name);

  // Monogram for the avatar when there is no uploaded logo. Only a real
  // letter is used — the first character of a phone-number fallback is a
  // digit, which reads as a stray number rather than a mark.
  const initialChar = hasRealName ? headingName.trim().charAt(0).toUpperCase() : null;
  const initial = /[A-ZÀ-Þ]/.test(initialChar || '') ? initialChar : null;

  const communes = agent.primary_communes || [];

  // "Agence partenaire · Vérifiée · Kinshasa" — every segment is a real fact
  // about this agent, and any segment without backing data is simply not
  // emitted rather than being padded with a plausible-looking default.
  const metaLine = [
    'Agence partenaire',
    agent.phone_verified_at ? 'Vérifiée' : null,
    agent.city || (communes.length === 1 ? communes[0] : communes.length > 1 ? 'Kinshasa' : null),
  ]
    .filter(Boolean)
    .join(' · ');

  const profileUrl = `${SITE_URL}/agents/${agent.id}`;
  const shareMessage = `Bonjour, voici mes annonces sur Lukka Place : ${profileUrl}`;

  // A real per-agent number when one exists, otherwise Lukka Place's own
  // central number — same precedence WhatsAppCTA/EnquiryCard already use.
  const whatsappHref = agent.phone
    ? buildWhatsAppLink(agent.phone, PROFILE_MESSAGE)
    : getCentralWhatsAppHref(PROFILE_MESSAGE);

  return (
    <div>
      {/*
        Editorial hero on the site's royal ground (`bg-blue-deep`, royal-700)
        — the same field the rest of Lukka Place uses, so this page reads as
        part of the site rather than a separate dark microsite. The editorial
        treatment is carried by the serif name, the quiet meta line and the
        demoted phone chip, not by the background colour.

        Muted text sits a step brighter here than it would on a near-black
        ground: royal-700 is a lighter field, so the same white/45 that was
        legible on ink washes out on royal.
      */}
      <section className="bg-blue-deep text-white">
        <div className="mx-auto max-w-[77.5rem] px-4 py-9 sm:px-6 sm:py-11">
          {/* Minimal share bar, folded into the hero — this replaces the
              full-width chalk "Partagez ce portfolio" strip that used to sit
              between the hero and the portfolio. Bigger, higher-contrast
              controls than a purely decorative icon pair — these are real,
              frequently-used actions. */}
          <div className="mb-8 flex items-center justify-between gap-4">
            <span className="truncate text-[0.8125rem] font-medium text-white/80">{profileUrl}</span>
            <div className="flex flex-none items-center gap-2">
              <CopyLinkButton
                url={profileUrl}
                label=""
                ariaLabel="Copier le lien du portfolio"
                iconClassName="h-5 w-5"
                className="u-press grid h-11 w-11 place-items-center rounded-full bg-white/[0.08] text-white ring-1 ring-inset ring-white/25 transition-colors hover:bg-white/[0.16]"
              />
              <ShareOnWhatsAppButton
                url={profileUrl}
                title={name}
                message={shareMessage}
                iconOnly
                label="Partager ce portfolio"
                iconClassName="h-5 w-5"
                className="u-press grid h-11 w-11 place-items-center rounded-full bg-white/[0.08] text-white ring-1 ring-inset ring-white/25 transition-colors hover:bg-white/[0.16]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 items-end gap-10 lg:grid-cols-[minmax(0,1fr)_17rem]">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
              {/* Refined circular avatar with a hairline ring, replacing the
                  square logo tile — sized down from the original hero so the
                  banner reads less like a full-bleed cover photo. */}
              <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full bg-white/[0.08] p-1 text-center ring-1 ring-white/25 sm:h-[4.5rem] sm:w-[4.5rem]">
                {agent.image ? (
                  <div className="h-full w-full overflow-hidden rounded-full">
                    <AgentAvatar src={agent.image} alt={name} />
                  </div>
                ) : initial ? (
                  <span className="font-display text-[1.375rem] leading-none text-white/85">{initial}</span>
                ) : (
                  <Building2 strokeWidth={1.5} className="h-6 w-6 text-white/65" />
                )}
              </div>

              <div className="flex min-w-0 flex-col gap-3.5">
                {/* Meta line, assembled only from parts that are actually
                    true for this agent — no segment is printed as filler. */}
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-white/85">
                  {metaLine}
                </span>

                <h1 className="font-display text-[2rem] font-normal leading-[1.06] tracking-tight text-white sm:text-[2.75rem]">
                  {headingName}
                </h1>

                {/* The phone is a quiet verified chip now, not the headline. */}
                {agent.phone && hasRealName && (
                  <span className="inline-flex w-fit items-center gap-2 rounded-full bg-white/[0.1] py-1.5 pl-3 pr-3.5 text-[0.8125rem] ring-1 ring-inset ring-white/25">
                    {agent.phone_verified_at && (
                      <BadgeCheck strokeWidth={2.25} className="h-4 w-4 shrink-0 text-white/90" />
                    )}
                    <span className="u-tabular font-semibold text-white">{formatPhoneDisplay(agent.phone)}</span>
                    {agent.phone_verified_at && <span className="text-white/70">Vérifié</span>}
                  </span>
                )}

                {agent.bio && (
                  <p className="max-w-[52ch] text-[0.9375rem] leading-[1.7] text-white/85">{agent.bio}</p>
                )}

                {communes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {communes.map((commune) => (
                      <Link
                        key={commune}
                        href={hrefWithParam(agent.id, sp, 'commune', sp.commune === commune ? null : commune)}
                        className={`inline-flex items-center rounded-full px-3 py-1.5 text-[0.8125rem] font-medium transition-colors ${
                          sp.commune === commune
                            ? 'bg-white text-blue-deep'
                            : 'text-white/85 ring-1 ring-inset ring-white/25 hover:bg-white/15 hover:text-white'
                        }`}
                      >
                        {commune}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {/* The single primary action in the hero. The sticky rail
                  carries the other one; there is no third. */}
              {whatsappHref ? (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="u-press flex h-12 items-center justify-center gap-2.5 rounded-lg bg-white text-[0.9375rem] font-bold text-blue-deep transition-transform hover:-translate-y-0.5"
                >
                  <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
                  Contacter l&apos;agence
                </a>
              ) : (
                <span className="flex h-12 items-center justify-center rounded-lg px-4 text-center text-[0.8125rem] text-white/80 ring-1 ring-inset ring-white/25">
                  Coordonnées non disponibles
                </span>
              )}

              <div className="flex gap-8 border-t border-white/15 pt-4">
                <div>
                  <div className="u-tabular text-[1.625rem] font-extrabold leading-none tracking-[-0.02em] text-white">
                    {agent.listing_count}
                  </div>
                  <div className="mt-1.5 text-[0.8125rem] font-medium text-white/80">
                    bien{agent.listing_count === 1 ? '' : 's'} actif{agent.listing_count === 1 ? '' : 's'}
                  </div>
                </div>
                {communes.length > 0 && (
                  <div>
                    <div className="u-tabular text-[1.625rem] font-extrabold leading-none tracking-[-0.02em] text-white">
                      {communes.length}
                    </div>
                    <div className="mt-1.5 text-[0.8125rem] font-medium text-white/80">
                      commune{communes.length === 1 ? '' : 's'} couverte{communes.length === 1 ? '' : 's'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Rightmove-style split: the portfolio scrolls in the main column
          while the contact rail stays pinned beside it. `lg:items-start` is
          what makes the sticky child work at all — the grid's default
          `stretch` would make the aside full-height, leaving it nothing to
          stick within. */}
      <div className="mx-auto max-w-[77.5rem] px-4 py-14 sm:px-6 sm:py-16">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-12">
          <section>
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <span className="u-eyebrow">Portfolio</span>
                <h2 className="font-display mt-1.5 text-[2rem] font-normal tracking-[-0.01em] text-ink sm:text-[2.375rem]">
                  Biens disponibles aujourd&apos;hui
                </h2>
              </div>

              {/* The design puts exactly one control on this row: "Devise USD / FC".
                  No search field — the tabs are the filter. */}
              <div className="flex items-center gap-3">
                <span className="text-[0.8125rem] text-ink-45">Devise</span>
                <CurrencyToggle longLabels />
              </div>
            </div>

            <div className="no-scrollbar mt-6 flex gap-7 overflow-x-auto border-b border-line/60">
              {TABS.map(({ key, label }) => (
                <Link
                  key={key}
                  href={hrefWithParam(agent.id, sp, 'tab', key)}
                  aria-current={tab === key ? 'page' : undefined}
                  className={`-mb-px whitespace-nowrap border-b-[1.5px] px-1 pb-3 pt-2 text-sm transition-colors ${
                    tab === key
                      ? 'border-ink font-semibold text-ink'
                      : 'border-transparent font-medium text-ink-45 hover:border-line hover:text-ink-70'
                  }`}
                >
                  {label}
                </Link>
              ))}
            </div>

            {filteredListings.length === 0 ? (
              <div className="mt-8 rounded-card border border-dashed border-line bg-surface p-12 text-center text-sm text-ink-45">
                {agent.listing_count === 0
                  ? "Cet agent n'a pas encore de bien en ligne. Envoyez-lui votre recherche ci-contre."
                  : 'Aucune annonce ne correspond à ces filtres.'}
              </div>
            ) : (
              <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
                {filteredListings.map((listing) => (
                  <PropertyCard key={listing.id} listing={listing} />
                ))}
              </div>
            )}
          </section>

          {/* Pinned contact rail. `top` clears the 76px sticky header plus a
              gutter. Deliberately NO internal `overflow-y-auto` / `max-h`
              here: that combination gives the rail its own independent
              scroll position, so scrolling the page back up does not bring
              the WhatsApp button back into view — it stays scrolled out of
              sight inside its own clipped box until the rail's internal
              scroll is separately reset. A plain sticky block has no such
              state to get stuck in. */}
          <aside className="flex flex-col gap-3 lg:sticky lg:top-[6.5rem]">
            <div className="flex flex-col gap-2.5 rounded-card border border-line/60 bg-surface p-4">
              {whatsappHref ? (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="u-btn-primary u-press inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-blue text-sm font-bold text-white"
                >
                  <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-[1.125rem] w-[1.125rem]" />
                  Contacter sur WhatsApp
                </a>
              ) : (
                <span className="inline-flex h-12 items-center justify-center rounded-lg border border-dashed border-line px-4 text-center text-[0.8125rem] text-ink-45">
                  Coordonnées non disponibles
                </span>
              )}

              {agent.phone && (
                <a
                  href={`tel:${agent.phone}`}
                  className="u-btn-secondary u-press inline-flex h-12 items-center justify-center gap-2 rounded-lg text-sm font-bold text-ink"
                >
                  Appeler l&apos;agent
                </a>
              )}

              <div className="flex flex-col gap-3 border-t border-line/60 pt-3">
                {agent.phone && (
                  <div className="flex items-start gap-2.5">
                    <Phone strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-blue" />
                    <div className="min-w-0">
                      <div className="u-tabular text-[0.875rem] font-bold text-ink">
                        {formatPhoneDisplay(agent.phone)}
                      </div>
                      <div className="text-xs text-ink-45">
                        {agent.phone_verified_at ? 'Numéro vérifié par Lukka Place' : 'WhatsApp'}
                      </div>
                    </div>
                  </div>
                )}

                {agent.email && (
                  <div className="flex items-start gap-2.5">
                    <Mail strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-blue" />
                    <div className="min-w-0">
                      <a
                        href={`mailto:${agent.email}`}
                        className="block truncate text-[0.875rem] font-bold text-ink hover:underline"
                      >
                        {agent.email}
                      </a>
                      <div className="text-xs text-ink-45">Par e-mail</div>
                    </div>
                  </div>
                )}

                {(agent.address || communes.length > 0) && (
                  <div className="flex items-start gap-2.5">
                    <MapPin strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-blue" />
                    <div className="min-w-0">
                      <div className="text-[0.875rem] font-bold text-ink">
                        {agent.address ? [agent.address, agent.city].filter(Boolean).join(', ') : communes.join(', ')}
                      </div>
                      <div className="text-xs text-ink-45">{agent.address ? 'Bureau' : 'Communes couvertes'}</div>
                    </div>
                  </div>
                )}
              </div>

              {agent.phone && (
                <div className="border-t border-line/60 pt-3">
                  <VCardButton name={name} phone={agent.phone} email={agent.email} />
                </div>
              )}
            </div>

            <InquiryForm
              agentId={agent.id}
              agentName={name}
              sent={sp.inquiry_sent === '1'}
              error={sp.inquiry_error}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
