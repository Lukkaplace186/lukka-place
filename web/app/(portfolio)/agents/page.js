import Link from 'next/link';
import { Search, Phone, Star, MapPin, BadgeCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import AgentAvatar from '@/components/AgentAvatar';
import AgentVerificationBadge from '@/components/AgentVerificationBadge';
import { getAgentDirectory } from '@/lib/agentDirectory';
import {
  DIRECTORY_PAGE_SIZE,
  directoryAgentName,
  directoryCityNames,
  directoryHref,
  hasDirectoryFilters,
  parseDirectoryParams,
} from '@/lib/agentDirectoryRules';
import { communeLabel, communesOfCity } from '@/lib/cities';
import { publicRatingSummary, formatAverage } from '@/lib/agentReviews';
import { agencyInitials } from '@/lib/agentIdentity';
import { buildWhatsAppLink } from '@/lib/whatsapp';
import { telHref } from '@/lib/phone';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { getLocale, getT } from '@/lib/i18n/server';
import DirectorySelect from './DirectorySelect';

// French whatever the visitor's language: the agent reads it.
const CONTACT_MESSAGE =
  "Bonjour, j'ai trouvé votre profil dans l'annuaire des agents de Lukka Place et j'aimerais en savoir plus sur vos biens.";

// generateMetadata, not a static object: a static export is evaluated at
// module load, where there is no request and so no translator.
export async function generateMetadata({ searchParams }) {
  const t = await getT();
  const params = parseDirectoryParams(await searchParams);
  return {
    title: t('agent.portfolio.directoryMetaTitle'),
    description: t('agent.portfolio.directoryMetaDescription'),
    alternates: { canonical: '/agents' },
    // One indexable directory; every filtered or paged copy points at it.
    ...(hasDirectoryFilters(params) ? { robots: { index: false, follow: true } } : {}),
  };
}

/**
 * Public agent directory — the "Agents" entry of the site menu.
 *
 * Built for a phone on 3G: one server render per search (a GET form, so it
 * works before or without JavaScript), one SQL page of 24 agents
 * (lib/agentDirectory.js), lazy avatars, no map and no client-side list.
 * Only agents with at least one live listing are listed, so every card
 * leads somewhere.
 *
 * Contact buttons follow the listing page's rule exactly: a verified number
 * whose direct routing is on. Anybody else's card offers their page only.
 */
export default async function AgentsDirectoryPage({ searchParams }) {
  const t = await getT();
  const locale = await getLocale();
  const params = parseDirectoryParams(await searchParams);
  const { agents, total, failed } = await getAgentDirectory(params);
  const pageCount = Math.max(1, Math.ceil(total / DIRECTORY_PAGE_SIZE));

  const cityOptions = [
    { value: '', label: t('agent.directory.allCities') },
    ...directoryCityNames().map((name) => ({ value: name, label: name })),
  ];
  const communeOptions = [
    { value: '', label: params.ville ? t('agent.directory.allCommunes') : t('agent.directory.pickCityFirst') },
    ...(params.ville ? communesOfCity(params.ville).map((key) => ({ value: key, label: communeLabel(key) })) : []),
  ];
  const sortOptions = [
    { value: 'listings', label: t('agent.directory.sortListings') },
    { value: 'rating', label: t('agent.directory.sortRating') },
    { value: 'recent', label: t('agent.directory.sortRecent') },
  ];
  const offerChips = [
    { value: null, label: t('agent.directory.offerAll') },
    { value: 'location', label: t('agent.directory.offerRent') },
    { value: 'vente', label: t('agent.directory.offerSale') },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-4">
        <h1 className="u-title-section text-ink sm:text-3xl">{t('agent.portfolio.directoryTitle')}</h1>
        <p className="mt-1 text-sm text-ink-45">{t('agent.directory.lead')}</p>
      </div>

      <form action="/agents" method="get" role="search" className="rounded-card border border-line bg-white p-3 sm:p-4">
        {params.offre ? <input type="hidden" name="offre" value={params.offre} /> : null}
        {params.verifies ? <input type="hidden" name="verifies" value="1" /> : null}

        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t('agent.directory.searchLabel')}</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-45"
              strokeWidth={ICON_STROKE_WIDTH}
              aria-hidden="true"
            />
            <input
              type="search"
              name="q"
              defaultValue={params.q}
              maxLength={60}
              enterKeyHint="search"
              autoComplete="off"
              placeholder={t('agent.directory.searchPlaceholder')}
              className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-sm text-ink placeholder:text-ink-45"
            />
          </label>
          <button type="submit" className="u-btn-primary u-press h-11 shrink-0 rounded-lg bg-blue px-4 text-sm font-bold text-white hover:bg-blue-deep">
            {t('agent.directory.searchButton')}
          </button>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <DirectorySelect name="ville" label={t('agent.directory.city')} defaultValue={params.ville || ''} options={cityOptions} clears={['commune']} />
          <DirectorySelect
            name="commune"
            label={t('agent.directory.commune')}
            defaultValue={params.commune || ''}
            options={communeOptions}
            disabled={!params.ville}
          />
          <div className="col-span-2 sm:col-span-1">
            <DirectorySelect name="tri" label={t('agent.directory.sort')} defaultValue={params.tri} options={sortOptions} />
          </div>
        </div>

        <div className="-mx-1 mt-3 flex flex-wrap items-center gap-2 px-1">
          {offerChips.map((chip) => (
            <Link
              key={chip.label}
              href={directoryHref(params, { offre: chip.value })}
              aria-current={params.offre === chip.value ? 'true' : undefined}
              className={cn(
                'inline-flex h-9 items-center rounded-full border px-3.5 text-[0.8125rem] font-semibold',
                params.offre === chip.value ? 'border-blue bg-blue text-white' : 'border-line bg-white text-ink-70',
              )}
            >
              {chip.label}
            </Link>
          ))}
          <Link
            href={directoryHref(params, { verifies: !params.verifies })}
            aria-current={params.verifies ? 'true' : undefined}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[0.8125rem] font-semibold',
              params.verifies ? 'border-green bg-green text-white' : 'border-line bg-white text-ink-70',
            )}
          >
            <BadgeCheck className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
            {t('agent.directory.verifiedOnly')}
          </Link>
        </div>
      </form>

      <div className="mb-3 mt-5 flex items-baseline justify-between gap-3">
        <p className="u-tabular text-sm font-semibold text-ink" aria-live="polite">
          {t('agent.directory.count', { count: total })}
        </p>
        {hasDirectoryFilters(params) ? (
          <Link href="/agents" className="text-sm font-semibold text-blue hover:underline">
            {t('agent.directory.clear')}
          </Link>
        ) : null}
      </div>

      {agents.length === 0 ? (
        <div className="rounded-card border border-dashed border-line bg-white p-8 text-center">
          <p className="text-sm text-ink-70">
            {failed ? t('agent.directory.unavailable') : hasDirectoryFilters(params) ? t('agent.directory.noMatch') : t('agent.portfolio.directoryEmpty')}
          </p>
          <p className="mt-2 text-sm text-ink-45">{t('agent.directory.findForMeLead')}</p>
          <Link
            href="/compte/client/demandes"
            className="u-btn-secondary u-press mt-4 inline-flex h-11 items-center rounded-lg px-4 text-sm font-bold text-ink"
          >
            {t('nav.findCta')}
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <DirectoryCard key={agent.id} agent={agent} t={t} locale={locale} />
          ))}
        </ul>
      )}

      {pageCount > 1 ? (
        <nav className="mt-6 flex items-center justify-between gap-3" aria-label={t('agent.directory.pagination')}>
          <PageLink href={params.page > 1 ? directoryHref(params, { page: params.page - 1 }) : null} label={t('agent.directory.previous')}>
            <ChevronLeft className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          </PageLink>
          <span className="u-tabular text-sm text-ink-45">
            {t('agent.directory.pageOf', { page: params.page, pages: pageCount })}
          </span>
          <PageLink
            href={params.page < pageCount ? directoryHref(params, { page: params.page + 1 }) : null}
            label={t('agent.directory.next')}
            trailing
          >
            <ChevronRight className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          </PageLink>
        </nav>
      ) : null}
    </div>
  );
}

function PageLink({ href, label, trailing = false, children }) {
  const body = trailing ? (
    <>
      {label}
      {children}
    </>
  ) : (
    <>
      {children}
      {label}
    </>
  );
  const className = 'inline-flex h-11 items-center gap-1 rounded-lg border border-line bg-white px-4 text-sm font-semibold';
  if (!href) return <span className={cn(className, 'text-ink-45 opacity-60')} aria-disabled="true">{body}</span>;
  return (
    <Link href={href} className={cn(className, 'u-press text-ink')}>
      {body}
    </Link>
  );
}

function DirectoryCard({ agent, t, locale }) {
  const { name, agency } = directoryAgentName(agent);
  const displayName = name || t('agent.directory.unnamed');
  const initials = agencyInitials(name);
  const rating = publicRatingSummary(agent);
  const communes = [...new Set([...(agent.primary_communes || []), ...(agent.serviced_communes || [])])].map(communeLabel);
  const whatsappHref = agent.contact_phone ? buildWhatsAppLink(String(agent.contact_phone).replace(/\D/g, ''), CONTACT_MESSAGE) : null;
  const callHref = agent.contact_phone ? telHref(agent.contact_phone) : null;
  const profileHref = `/agents/${agent.id}`;

  const counts = [
    agent.rent_count > 0 ? t('agent.directory.rentCount', { count: agent.rent_count }) : null,
    agent.sale_count > 0 ? t('agent.directory.saleCount', { count: agent.sale_count }) : null,
  ].filter(Boolean);

  return (
    <li className="flex flex-col rounded-card border border-line bg-white p-4">
      <div className="flex items-start gap-3">
        <Link href={profileHref} className="h-12 w-12 shrink-0 overflow-hidden rounded-full border border-line bg-canvas-alt" tabIndex={-1} aria-hidden="true">
          {agent.image ? (
            <AgentAvatar src={agent.image} alt="" loading="lazy" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-sm font-bold text-blue">{initials || '·'}</span>
          )}
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link href={profileHref} className="truncate font-bold text-ink hover:underline">
              {displayName}
            </Link>
            <AgentVerificationBadge level={agent.verification_level} t={t} variant="icon" />
          </div>
          {agency ? <p className="truncate text-sm text-ink-70">{agency}</p> : null}
          <p className="u-tabular mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-45">
            {rating ? (
              <span className="inline-flex items-center gap-0.5 font-semibold text-ink">
                <Star className="h-3.5 w-3.5 fill-current text-amber-500" strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
                {formatAverage(rating.average, locale)}
                <span className="font-normal text-ink-45">({rating.count})</span>
              </span>
            ) : null}
            {rating && counts.length ? <span aria-hidden="true">·</span> : null}
            {counts.join(' · ')}
          </p>
        </div>
      </div>

      {communes.length > 0 ? (
        <p className="mt-2 flex items-start gap-1 text-xs text-ink-70">
          <MapPin className="mt-px h-3.5 w-3.5 shrink-0 text-ink-45" strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          <span className="line-clamp-1">
            {communes.slice(0, 3).join(', ')}
            {communes.length > 3 ? ` +${communes.length - 3}` : ''}
          </span>
        </p>
      ) : null}

      <div className="mt-3 flex gap-2 pt-1 sm:mt-auto sm:pt-3">
        <Link
          href={profileHref}
          className="u-btn-secondary u-press inline-flex h-11 flex-1 items-center justify-center rounded-lg px-3 text-sm font-bold text-ink"
        >
          {t('agent.directory.viewListings', { count: agent.live_count })}
        </Link>
        {whatsappHref ? (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('agent.directory.whatsappAria', { name: displayName })}
            className="u-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-green text-white hover:bg-green-deep"
          >
            <WhatsAppGlyph />
          </a>
        ) : null}
        {callHref ? (
          <a
            href={callHref}
            aria-label={t('agent.directory.callAria', { name: displayName })}
            className="u-press inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-ink"
          >
            <Phone className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </li>
  );
}

// lucide ships no brand marks; same path WhatsAppCTA.js draws.
function WhatsAppGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}
