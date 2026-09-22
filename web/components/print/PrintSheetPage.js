import { notFound } from 'next/navigation';
import { getCurrentAgentId } from '@/lib/agentSession';
import { getPrintSheetData } from '@/lib/marketing/printSheetLoader';
import { getT } from '@/lib/i18n/server';
import PrintStyles from './PrintStyles';
import PrintToolbar from './PrintToolbar';
import ListingPoster from './ListingPoster';
import ListingTechSheet from './ListingTechSheet';

// labelKey, not label: resolved at render (see components/navItems.js).
const BLOCKER_KEYS = {
  pending: 'agent.share.blocked.pending',
  rejected: 'agent.share.blocked.rejected',
  archived: 'agent.share.blocked.archived',
  under_offer: 'agent.share.blocked.underOffer',
  closed: 'agent.share.blocked.closed',
};

/**
 * Shared body of /compte/agent/biens/[id]/affiche and …/fiche. The agent
 * layout already requires a session; ownership is the SQL in
 * getPrintSheetData, so another agency's id is a 404, never a sheet.
 */
export default async function PrintSheetPage({ params, medium }) {
  const t = await getT();
  const { id } = await params;
  const listingId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(listingId) || listingId <= 0) notFound();

  const agentId = await getCurrentAgentId();
  const data = agentId ? await getPrintSheetData(agentId, listingId, medium) : null;
  if (!data) notFound();

  const note = data.phoneHidden ? t('agent.print.phoneHidden') : null;

  return (
    <div>
      <PrintStyles />
      <PrintToolbar listingId={listingId} medium={medium} canPrint={Boolean(data.sheet)} note={note} />
      {data.sheet ? (
        <div className="lp-print">
          {medium === 'poster' ? (
            <ListingPoster sheet={data.sheet} qr={data.qr} />
          ) : (
            <ListingTechSheet sheet={data.sheet} qr={data.qr} />
          )}
        </div>
      ) : (
        <div className="px-3 py-6 sm:px-8">
          <p className="mx-auto max-w-xl rounded-lg bg-surface p-4 text-sm text-ink-70" role="status">
            {t(BLOCKER_KEYS[data.blocker] || 'agent.share.blocked.pending')}
          </p>
        </div>
      )}
    </div>
  );
}
