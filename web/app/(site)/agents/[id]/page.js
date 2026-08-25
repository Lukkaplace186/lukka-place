import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BadgeCheck } from 'lucide-react';
import AgentAvatar from '@/components/AgentAvatar';
import ListingCardVertical from '@/components/ListingCardVertical';
import ShareOnWhatsAppButton from '@/components/ShareOnWhatsAppButton';
import VCardButton from '@/components/VCardButton';
import InquiryForm from './InquiryForm';
import { getAgentProfile, getAgentListings } from '@/lib/agencies';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { SITE_URL, ICON_STROKE_WIDTH } from '@/lib/constants';

const PROFILE_MESSAGE =
  "Bonjour, j'ai vu votre profil sur Lukka Place et j'aimerais en savoir plus sur vos biens.";

const NEW_LISTING_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/** Plain helper, not inline in the page component — Date.now() called directly
 *  in a component's render body trips React's purity lint rule. */
function isWithinNewListingWindow(createdAt) {
  if (!createdAt) return false;
  return Date.now() - new Date(createdAt).getTime() <= NEW_LISTING_WINDOW_MS;
}

const TABS = [
  { key: 'all', label: 'Tous' },
  { key: 'location', label: 'À louer' },
  { key: 'vente', label: 'À vendre' },
  { key: 'new', label: 'Nouveautés' },
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

  const name = [agent.first_name, agent.last_name].filter(Boolean).join(' ') || agent.username;
  return { title: `${name} — Lukka Place`, description: agent.bio?.slice(0, 160) };
}

export default async function AgentStorefrontPage({ params, searchParams }) {
  const { id } = await params;
  const sp = await searchParams;

  const agent = await getAgentProfile(id);
  if (!agent) notFound();

  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab : 'all';
  const q = typeof sp.q === 'string' ? sp.q : '';

  const listings = await getAgentListings(agent.id, {
    transactionType: tab === 'location' || tab === 'vente' ? tab : undefined,
    commune: sp.commune,
    search: q || undefined,
    // 'new' is a client-side-of-the-query-window filter (created_at), not a
    // buildFilters() option — fetch this agent's own listings (a small set)
    // and filter in JS rather than adding a one-off SQL date-window param
    // for a single tab.
    limit: tab === 'new' ? 100 : undefined,
  });

  const filteredListings = tab === 'new' ? listings.data.filter((l) => isWithinNewListingWindow(l.created_at)) : listings.data;

  const name = [agent.first_name, agent.last_name].filter(Boolean).join(' ') || agent.username || '—';
  const communes = agent.primary_communes || [];
  const profileUrl = `${SITE_URL}/agents/${agent.id}`;
  const shareMessage = `Bonjour, voici mes annonces sur Lukka Place : ${profileUrl}`;

  return (
    <div className="pb-16">
      {/* No banner/cover image exists anywhere in the schema for this
          entity — a typographic gradient treatment, same fallback
          ExploreCommunes.js already uses when no real photo backs a
          commune tile, rather than a fabricated stock image. */}
      <div className="relative flex h-40 items-end bg-gradient-to-br from-ink to-[#1E3A8A] sm:h-56">
        <div className="mx-auto flex w-full max-w-5xl items-end gap-4 px-4 pb-6 sm:px-6">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full border-4 border-white bg-white shadow-sm sm:h-28 sm:w-28">
            <AgentAvatar src={agent.image} alt={name} />
          </div>
          <div className="pb-1">
            <h1 className="font-display text-2xl font-normal leading-tight text-white sm:text-3xl">{name}</h1>
            {agent.vendor_username ? <p className="mt-0.5 text-sm text-white/80">{agent.vendor_username}</p> : null}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        {/* Trust bar — every figure here is real and provable. "Numéro
            vérifié" is not an admin judgment call: agents.phone_verified_at
            is set only when this agent actually completed the real
            WhatsApp-OTP signup flow (lib/agentAuth.js), so the badge is
            never shown without a real verification event behind it. */}
        <div className="-mt-px flex flex-wrap items-center gap-6 border-b border-line py-4 text-sm">
          <div>
            <span className="u-tabular font-bold text-ink">{agent.listing_count}</span>{' '}
            <span className="text-ink-45">annonce{agent.listing_count !== 1 ? 's' : ''} active{agent.listing_count !== 1 ? 's' : ''}</span>
          </div>
          <div>
            <span className="u-tabular font-bold text-ink">{communes.length}</span>{' '}
            <span className="text-ink-45">commune{communes.length !== 1 ? 's' : ''} desservie{communes.length !== 1 ? 's' : ''}</span>
          </div>
          {agent.phone_verified_at ? (
            <span className="inline-flex items-center gap-1.5 text-green-deep">
              <BadgeCheck strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
              <span className="font-medium">Numéro vérifié</span>
            </span>
          ) : null}
        </div>

        <div className="grid gap-8 py-6 lg:grid-cols-[1fr_20rem]">
          <div className="min-w-0 space-y-8">
            {agent.bio ? (
              <p className="text-[0.9375rem] leading-relaxed text-ink-70">{agent.bio}</p>
            ) : null}

            <div>
              <h2 className="u-eyebrow mb-2 text-ink-45">Communes desservies</h2>
              {communes.length === 0 ? (
                <p className="text-sm text-ink-45">Aucune commune renseignée.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {communes.map((commune) => (
                    <Link
                      key={commune}
                      href={hrefWithParam(agent.id, sp, 'commune', sp.commune === commune ? null : commune)}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                        sp.commune === commune
                          ? 'border-blue-deep bg-blue-deep text-white'
                          : 'border-line bg-white text-ink hover:bg-canvas-alt'
                      }`}
                    >
                      {commune}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h2 className="u-eyebrow text-ink-45">Annonces</h2>
                <div className="flex flex-wrap gap-1.5">
                  {TABS.map(({ key, label }) => (
                    <Link
                      key={key}
                      href={hrefWithParam(agent.id, sp, 'tab', key === 'all' ? null : key)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                        tab === key
                          ? 'border-blue-deep bg-blue-tint text-blue-deep'
                          : 'border-line bg-white text-ink-70 hover:bg-canvas-alt'
                      }`}
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              </div>

              <form method="get" className="mb-3 flex items-center gap-2">
                {tab !== 'all' ? <input type="hidden" name="tab" value={tab} /> : null}
                {sp.commune ? <input type="hidden" name="commune" value={sp.commune} /> : null}
                <input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Rechercher dans ces annonces"
                  className="w-full rounded-md border border-line bg-white px-3 py-1.5 text-sm text-ink focus:border-blue focus:outline-none"
                />
              </form>

              {agent.listing_count === 0 ? (
                <InquiryForm agentId={agent.id} sent={sp.inquiry_sent === '1'} error={sp.inquiry_error} />
              ) : filteredListings.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line bg-white p-10 text-center text-sm text-ink-45">
                  Aucune annonce ne correspond à ces filtres.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {filteredListings.map((listing) => (
                    <ListingCardVertical key={listing.id} listing={listing} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="h-fit space-y-3 rounded-lg border border-line bg-white p-5 lg:sticky lg:top-20">
            {agent.phone ? (
              <>
                <a
                  href={buildWhatsAppLink(agent.phone, PROFILE_MESSAGE)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="u-press flex h-11 items-center justify-center gap-2 rounded-xl bg-green text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-deep"
                >
                  Discuter sur WhatsApp
                </a>
                <a
                  href={`tel:${agent.phone}`}
                  className="u-press flex h-11 items-center justify-center gap-2 rounded-xl border border-line text-sm font-semibold text-ink transition-colors hover:bg-canvas-alt"
                >
                  Appeler l&apos;agent
                </a>
                <VCardButton name={name} phone={agent.phone} email={agent.email} />
              </>
            ) : (
              // No fabricated wa.me/tel: link for a null number — same
              // honest-absence rule WhatsAppCTA.js already follows.
              <p className="rounded-xl border border-dashed border-line px-3 py-2.5 text-center text-sm text-ink-45">
                Coordonnées non disponibles pour le moment.
              </p>
            )}
            {agent.email ? (
              <a href={`mailto:${agent.email}`} className="block text-center text-sm text-ink-45 hover:text-ink">
                {agent.email}
              </a>
            ) : null}

            <div className="pt-2">
              <ShareOnWhatsAppButton url={profileUrl} title={name} message={shareMessage} />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
