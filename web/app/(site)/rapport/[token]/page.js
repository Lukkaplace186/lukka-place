import Link from 'next/link';
import { notFound } from 'next/navigation';
import SafeImage from '@/components/SafeImage';
import AgentMonogram from '@/components/AgentMonogram';
import ListingFunnel from '@/components/listings/ListingFunnel';
import { resolveReportToken, recordReportView } from '@/lib/reportLinks';
import {
  TRACKING_STARTED_AT,
  daysOnMarket,
  getListingFunnel,
  getMarketPosition,
  getPerformanceListing,
  lifetimeWindow,
  performanceWindow,
} from '@/lib/listingPerformance';
import { FUNNEL_LABELS_FR, funnelRows } from '@/lib/listingFunnel';
import { statusText } from '@/lib/marketing/mandateReportCopy';
import {
  WHAT_IS_COUNTED, WHAT_IS_NOT_COUNTED, daysText, frenchDate, marketPositionText, sinceNote,
} from '@/lib/marketing/liveReportCopy';
import { agentBrandFields, getFlyerListing } from '@/lib/listingFlyer';
import { listingPublicUrl, shareBlocker } from '@/lib/listingShareCopy';
import { formatPrice } from '@/lib/format';
import { getCurrentAgentId } from '@/lib/agentSession';

/**
 * The owner's live report — the link an agent forwards once
 * (lib/reportLinks.js) and the landlord opens whenever they want to know how
 * the property is doing. Always current: every figure is read at request time
 * from lib/listingPerformance.js, the same reads the agent's own listing page
 * uses.
 *
 * - French always (the market's language, like every forwarded text).
 * - Never indexed, never cached, and a bad, revoked or unknown link is a 404
 *   that says nothing about why.
 * - Listing facts and counts only — no customer names, numbers or messages.
 * - Shown whatever the listing's status: "Loué en 23 jours" is exactly what an
 *   owner wants to read after the fact.
 * - An opening by the listing's own agent is not counted as the owner's.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return {
    title: 'Rapport de performance — Lukka Place',
    robots: { index: false, follow: false, nocache: true },
  };
}

export default async function LiveReportPage({ params }) {
  const { token } = await params;
  const link = await resolveReportToken(token);
  if (!link) notFound();

  const listing = await getPerformanceListing(link.propertyId);
  if (!listing) notFound();

  const now = new Date();
  const week = performanceWindow(7, now);
  const [weekCounts, lifetimeCounts, position, flyer, viewerAgentId] = await Promise.all([
    getListingFunnel(listing.id, week),
    getListingFunnel(listing.id, lifetimeWindow(listing.created_at, now)),
    getMarketPosition(listing).catch((err) => {
      console.error(`[rapport] market position for #${listing.id}: ${err.message}`);
      return null;
    }),
    listing.agent_id ? getFlyerListing(listing.agent_id, listing.id) : null,
    getCurrentAgentId(),
  ]);

  if (Number(viewerAgentId) !== Number(listing.agent_id)) await recordReportView(link.id);

  const brand = flyer ? agentBrandFields(flyer) : { name: null, phone: null };
  const blocker = shareBlocker(listing);
  const status = statusText(listing);
  const days = daysOnMarket(listing, now);
  const published = frenchDate(listing.created_at);
  const confirmed = listing.availability_confirmed_at && !blocker ? frenchDate(listing.availability_confirmed_at) : null;
  const marketLine = marketPositionText(position, listing);
  const since = sinceNote(TRACKING_STARTED_AT);
  const photo = listing.featured_image && !String(listing.featured_image).includes('noimage') ? listing.featured_image : null;
  const place = [listing.commune].filter(Boolean).join(', ');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <header className="u-card flex flex-col gap-4 rounded-card bg-surface p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <AgentMonogram logoUrl={flyer?.agent_image} name={brand.name} className="h-11 w-11" textClassName="text-[1rem]" />
          <div className="min-w-0">
            <p className="u-eyebrow text-ink-45">Rapport de performance</p>
            <p className="truncate text-[0.9375rem] font-bold text-ink">{brand.name || 'Lukka Place'}</p>
            {brand.phone ? <a href={`tel:${brand.phone.replace(/\s+/g, '')}`} className="text-[0.8125rem] text-blue">{brand.phone}</a> : null}
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          {photo ? (
            <div className="relative h-44 w-full shrink-0 overflow-hidden rounded-lg bg-canvas-alt sm:h-32 sm:w-44">
              <SafeImage src={photo} alt={listing.title || ''} fill sizes="(min-width: 640px) 176px, 100vw" className="object-cover" />
            </div>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1.5">
            <h1 className="u-title-card text-ink">{listing.title || `Annonce n° ${listing.id}`}</h1>
            <p className="text-[0.9375rem] font-semibold text-ink">
              {formatPrice(listing.price, listing.purpose, listing.price_period)}
              {place ? <span className="font-normal text-ink-70"> · {place}</span> : null}
            </p>
            <p className="flex flex-wrap items-center gap-2 text-[0.8125rem] text-ink-70">
              <span className={`rounded-full px-2.5 py-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] ${blocker ? 'bg-warning-tint text-warning' : 'bg-success-tint text-success'}`}>
                {status}
              </span>
              {published ? <span>Publiée le {published}{days != null && !blocker ? ` · en ligne ${daysText(days)}` : ''}</span> : null}
            </p>
            {confirmed ? <p className="text-[0.8125rem] text-success">✓ Disponibilité confirmée par l’agent le {confirmed}</p> : null}
          </div>
        </div>
      </header>

      <section className="u-card flex flex-col gap-4 rounded-card bg-surface p-4 sm:p-6">
        <div>
          <h2 className="u-title-card text-ink">Ces 7 derniers jours</h2>
          <p className="u-micro text-ink-45">À droite : les 7 jours précédents</p>
        </div>
        <ListingFunnel
          rows={funnelRows(weekCounts, FUNNEL_LABELS_FR)}
          previousLabel="7 jours précédents"
          unknownText="non disponible"
          sinceMark="*"
        />
      </section>

      <section className="u-card flex flex-col gap-4 rounded-card bg-surface p-4 sm:p-6">
        <div>
          <h2 className="u-title-card text-ink">Depuis la mise en ligne</h2>
          {published ? <p className="u-micro text-ink-45">Depuis le {published}</p> : null}
        </div>
        <ListingFunnel rows={funnelRows(lifetimeCounts, FUNNEL_LABELS_FR)} unknownText="non disponible" sinceMark="*" />
      </section>

      {marketLine ? (
        <section className="u-card flex flex-col gap-2 rounded-card bg-surface p-4 sm:p-6">
          <h2 className="u-title-card text-ink">Le marché</h2>
          <p className="text-[0.875rem] leading-relaxed text-ink-70">{marketLine}</p>
          <p className="u-micro text-ink-45">Prix demandés sur les annonces en ligne sur Lukka Place, pas des prix de transaction.</p>
        </section>
      ) : null}

      <footer className="flex flex-col gap-2 px-1 text-[0.75rem] leading-relaxed text-ink-45">
        {since ? <p>{since}</p> : null}
        <p>{WHAT_IS_COUNTED}</p>
        <p>{WHAT_IS_NOT_COUNTED}</p>
        <p>Chiffres mis à jour en continu — ce lien affiche toujours les derniers.</p>
        {!blocker ? (
          <p>
            <Link href={listingPublicUrl(listing.id, { source: 'rapport_proprietaire' })} className="font-semibold text-blue">
              Voir l’annonce sur lukkaplace.com
            </Link>
          </p>
        ) : null}
      </footer>
    </div>
  );
}
