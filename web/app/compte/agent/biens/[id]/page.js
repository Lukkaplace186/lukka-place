import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExternalLink, FileText, Pencil, Printer } from 'lucide-react';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getAgentDashboardContext } from '@/lib/agentDashboard';
import { getAgentListingViewsSeries, VIEW_RANGES } from '@/lib/analytics';
import {
  PERFORMANCE_RANGES, TRACKING_STARTED_AT, daysOnMarket, getListingFunnel, getMarketPosition,
  getPerformanceListing, performanceWindow,
} from '@/lib/listingPerformance';
import { FUNNEL_STEPS, funnelRows } from '@/lib/listingFunnel';
import { getActiveReportLink, reportLinksEnabled } from '@/lib/reportLinks';
import { getAvailabilityPrompts } from '@/lib/listingAvailability';
import { formatPrice } from '@/lib/format';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import AgentPageHeader from '@/components/AgentPageHeader';
import AgentViewsChart from '@/components/AgentViewsChart';
import AgentAvailabilityPrompt from '@/components/AgentAvailabilityPrompt';
import ListingFunnel from '@/components/listings/ListingFunnel';
import ReportLinkCard from '@/components/ReportLinkCard';

/**
 * One listing's home for its agent: what it produced (the full funnel, the
 * same reads as the owner's live report), its trend, where its price sits in
 * its commune, and the owner's report link. Ownership: the listing's agent_id
 * must be the session's, otherwise a 404 that says nothing.
 */

export async function generateMetadata() {
  const t = await getT();
  return { title: t('agent.hub.metaTitle'), robots: { index: false, follow: false } };
}

const RANGE_OPTIONS = Object.entries(VIEW_RANGES).map(([value, { label }]) => ({ value, label }));

function stateKey(listing) {
  if (listing.listing_status === 'closed') return listing.purpose === 'rent' ? 'agent.listings.let' : 'agent.listings.state.sold';
  if (Number(listing.status) === 0) return 'agent.listings.state.archived';
  if (Number(listing.approve_status) === 2) return 'agent.listings.state.rejected';
  if (Number(listing.approve_status) !== 1) return 'agent.listings.state.pending';
  if (listing.listing_status === 'under_offer') return 'agent.listings.state.underOffer';
  return 'agent.listings.state.live';
}

const shortDate = (value) => (value ? new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Kinshasa' }) : null);

export default async function ListingPerformancePage({ params, searchParams }) {
  const t = await getT();
  const { id } = await params;
  const query = (await searchParams) || {};
  const range = typeof query.range === 'string' && PERFORMANCE_RANGES[query.range] ? query.range : '7d';
  const agentId = await getCurrentAgentId();

  const listing = await getPerformanceListing(id);
  if (!listing || !agentId || Number(listing.agent_id) !== Number(agentId)) notFound();

  const window = performanceWindow(PERFORMANCE_RANGES[range]);
  const [{ newLeadsCount }, counts, series, position, link, prompts] = await Promise.all([
    getAgentDashboardContext(agentId),
    getListingFunnel(listing.id, window),
    getAgentListingViewsSeries([Number(listing.id)], range),
    getMarketPosition(listing).catch(() => null),
    getActiveReportLink(agentId, listing.id).catch(() => null),
    getAvailabilityPrompts(agentId, { propertyId: listing.id, limit: 1 }).catch(() => []),
  ]);

  const labels = Object.fromEntries(FUNNEL_STEPS.map(({ key }) => [key, t(`agent.hub.steps.${key}`)]));
  const live = stateKey(listing) === 'agent.listings.state.live' || stateKey(listing) === 'agent.listings.state.underOffer';
  const days = daysOnMarket(listing);
  const since = shortDate(`${TRACKING_STARTED_AT}T12:00:00Z`);

  let marketText = null;
  if (position?.median != null) {
    marketText = t('agent.hub.marketMedian', {
      n: position.n,
      scope: t(`agent.hub.scope.${position.scope}`),
      median: formatPrice(position.median, listing.purpose, listing.purpose === 'rent' ? 'mois' : null),
    });
  } else if (position && position.n > 0) {
    marketText = t('agent.hub.marketThin', { commune: listing.commune, n: position.n });
  }
  let marketVerdict = null;
  if (position?.differencePct != null) {
    const pct = `${Math.abs(position.differencePct)} %`;
    marketVerdict = Math.abs(position.differencePct) < 3
      ? t('agent.hub.marketLevel')
      : t(position.differencePct > 0 ? 'agent.hub.marketAbove' : 'agent.hub.marketBelow', { pct });
  }

  return (
    <>
      <AgentPageHeader
        title={t('agent.hub.title')}
        subtitle={listing.title}
        newLeadsCount={newLeadsCount}
        action={live ? (
          <Link href={`/listings/${listing.id}`} target="_blank" className="u-btn-secondary u-press inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-sm font-bold text-ink">
            <ExternalLink strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
            <span className="max-sm:hidden">{t('common.shared.viewOnline')}</span>
          </Link>
        ) : null}
      />

      <div className="flex flex-col gap-5 px-3 py-4 sm:px-8 sm:py-7">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.8125rem] text-ink-70">
          <span className="rounded-full bg-blue-tint px-2.5 py-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-blue-deep">{t(stateKey(listing))}</span>
          <span className="font-semibold text-ink">{formatPrice(listing.price, listing.purpose, listing.price_period)}</span>
          {listing.commune ? <span>{listing.commune}</span> : null}
          {listing.created_at ? <span>{t('agent.hub.publishedOn', { date: shortDate(listing.created_at) })}</span> : null}
          {days != null && live ? <span>{t('agent.hub.onlineFor', { days })}</span> : null}
          {listing.availability_confirmed_at ? <span className="text-success">✓ {t('agent.hub.confirmedOn', { date: shortDate(listing.availability_confirmed_at) })}</span> : null}
        </div>

        <AgentAvailabilityPrompt items={prompts} single />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="u-card flex flex-col gap-4 rounded-card bg-surface p-4 sm:p-6">
            <div>
              <h2 className="u-title-card text-ink">{t('agent.hub.funnelTitle')}</h2>
              <p className="mt-0.5 text-[0.8125rem] text-ink-45">{VIEW_RANGES[range].label} · {t('agent.hub.previousPeriod')}</p>
            </div>
            <ListingFunnel rows={funnelRows(counts, labels)} previousLabel={t('agent.hub.previousPeriod')} unknownText={t('agent.hub.unknown')} sinceMark="*" />
            <p className="u-micro text-ink-45">{t('agent.hub.sinceNote', { date: since })}</p>
          </section>

          <div className="flex flex-col gap-5">
            <ReportLinkCard propertyId={Number(listing.id)} initialLink={link} available={reportLinksEnabled()} />
            <section className="u-card flex flex-col gap-2 rounded-card bg-surface p-4 sm:p-6">
              <h2 className="u-title-card text-ink">{t('agent.hub.marketTitle')}</h2>
              <p className="text-[0.875rem] text-ink-70">{marketText || t('agent.hub.marketNone')}</p>
              {marketVerdict ? <p className="text-[0.875rem] font-semibold text-ink">{marketVerdict}</p> : null}
            </section>
          </div>
        </div>

        <AgentViewsChart series={series} rangeOptions={RANGE_OPTIONS} range={range} rangeLabel={VIEW_RANGES[range].caption} />

        <div className="flex flex-wrap gap-2">
          <Link href={`/compte/agent/biens/${listing.id}/edit`} className="u-btn-secondary u-press inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-[0.8125rem] font-semibold text-ink">
            <Pencil strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />{t('agent.listings.edit')}
          </Link>
          {live ? (
            <>
              <Link href={`/compte/agent/biens/${listing.id}/affiche`} className="u-btn-secondary u-press inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-[0.8125rem] font-semibold text-ink">
                <Printer strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />{t('agent.print.posterLink')}
              </Link>
              <Link href={`/compte/agent/biens/${listing.id}/fiche`} className="u-btn-secondary u-press inline-flex h-10 items-center gap-1.5 rounded-lg px-3.5 text-[0.8125rem] font-semibold text-ink">
                <FileText strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />{t('agent.print.sheetLink')}
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
