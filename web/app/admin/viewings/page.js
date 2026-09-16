import Link from 'next/link';
import { listViewingFeed } from '@/lib/adminApi';
import { getListingLabels } from '@/lib/adminLeadRouting';
import { getAgentContactsByIds, searchAgentIds } from '@/lib/agents';
import {
  DECLINE_REASON_LABEL_KEYS,
  ROUTING_TYPES,
  ROUTING_TYPE_LABEL_KEYS,
  VIEWING_REQUEST_STATUSES,
  VIEWING_REQUEST_STATUS_LABEL_KEYS,
} from '@/lib/adminLabels';
import { buildHref, firstParam, kinshasaDayEnd, kinshasaDayStart, parsePage } from '@/lib/adminPagination';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, ROUTING_TONE, STATUS_TONE, formatKinshasa } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import TableToolbar from '../table/TableToolbar';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';
import ViewingRowActions from './ViewingRowActions';
import { AgentContact, WhatsAppLink } from '../ContactCell';
import ServerViewTools from '../table/ServerViewTools';
import { NewItemsNotice } from '../LiveQueueCounts';

export const metadata = {
  title: 'Visites — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/** A filter value, not a status: the SLA-alerted PENDING slice (engine VIEWING_FEED_VIEWS.escalated). */
const ESCALATED = 'ESCALATED';
const CANCELLABLE = ['PENDING', 'CONFIRMED', 'RESCHEDULED'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Live viewing feed — every request across both routing paths, one server
 * page at a time.
 *
 * Search takes an agency OR a customer: the agency half is resolved to
 * agents.id here in Postgres (agency names do not live in the engine's
 * SQLite), the customer half is matched by the engine, and the two are OR'd.
 * "Escalated" filters on the 15-minute SLA alert without inventing a status
 * for it. Commune uses the listing's own commune, recorded at notify time.
 *
 * `routing_type` is what actually happened when the request was created
 * (services/viewingNotifications.js); a request that predates routing being
 * recorded shows as "not routed" rather than being guessed into a bucket.
 */
export default async function AdminViewingsPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const statusParam = firstParam(raw.status);
  const filters = {
    q: firstParam(raw.q) || undefined,
    status: VIEWING_REQUEST_STATUSES.includes(statusParam) || statusParam === ESCALATED ? statusParam : undefined,
    routing: ROUTING_TYPES.includes(firstParam(raw.routing)) ? firstParam(raw.routing) : undefined,
    commune: firstParam(raw.commune) || undefined,
    from: DATE_PATTERN.test(firstParam(raw.from) || '') ? firstParam(raw.from) : undefined,
    to: DATE_PATTERN.test(firstParam(raw.to) || '') ? firstParam(raw.to) : undefined,
  };
  const { page, pageSize, limit, offset } = parsePage(raw);
  const params = { ...filters, page: page > 1 ? String(page) : undefined, size: pageSize === 25 ? undefined : String(pageSize) };

  let feed = null;
  let loadError = null;
  try {
    const agentIds = filters.q ? await searchAgentIds(filters.q).catch(() => []) : undefined;
    feed = await listViewingFeed({
      status: filters.status === ESCALATED ? undefined : filters.status,
      view: filters.status === ESCALATED ? 'escalated' : undefined,
      routingType: filters.routing,
      q: filters.q,
      agentIds,
      commune: filters.commune,
      from: kinshasaDayStart(filters.from),
      to: kinshasaDayEnd(filters.to),
      limit,
      offset,
    });
  } catch (err) {
    loadError = err.message;
  }

  const rows = feed?.data || [];
  // A request with no agent_id was never routed to anyone (it predates
  // routing, or fell back to the central number). The listing still names its
  // agent, so that agent is shown — marked "not alerted" — with a one-click
  // alert, instead of a bare dash that breaks the customer → agent chain.
  const labels = await getListingLabels(rows.map((row) => row.property_id)).catch(() => new Map());
  const listingAgentOf = (row) => {
    const id = labels.get(Number(row.property_id))?.agent_id;
    return id ? Number(id) : null;
  };
  const contacts = await getAgentContactsByIds([
    ...rows.map((row) => row.agent_id),
    ...rows.map(listingAgentOf),
  ]).catch(() => new Map());
  const byStatus = feed?.summary?.byStatus || {};
  const byRouting = feed?.summary?.byRouting || {};
  const escalated = feed?.summary?.byView?.escalated || 0;
  const allCount = Object.values(byStatus).reduce((sum, n) => sum + n, 0);

  const quick = [
    { key: 'all', label: t('admin.viewings.all'), count: allCount, href: buildHref('/admin/viewings', params, { status: '', routing: '' }), active: !filters.status && !filters.routing },
    { key: 'PENDING', label: t(VIEWING_REQUEST_STATUS_LABEL_KEYS.PENDING), count: byStatus.PENDING || 0, href: buildHref('/admin/viewings', params, { status: 'PENDING' }), active: filters.status === 'PENDING' },
    { key: ESCALATED, label: t('admin.viewings.escalated'), count: escalated, href: buildHref('/admin/viewings', params, { status: ESCALATED }), active: filters.status === ESCALATED, tone: escalated ? 'danger' : undefined },
    { key: 'CONFIRMED', label: t(VIEWING_REQUEST_STATUS_LABEL_KEYS.CONFIRMED), count: byStatus.CONFIRMED || 0, href: buildHref('/admin/viewings', params, { status: 'CONFIRMED' }), active: filters.status === 'CONFIRMED' },
    ...ROUTING_TYPES.map((value) => ({
      key: value, label: t(ROUTING_TYPE_LABEL_KEYS[value]), count: byRouting[value] || 0,
      href: buildHref('/admin/viewings', params, { routing: filters.routing === value ? '' : value }), active: filters.routing === value,
    })),
  ];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.viewings.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.viewings.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {quick.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            scroll={false}
            className={`u-micro-strong inline-flex items-center gap-1.5 rounded-full border px-3 py-1 transition-colors ${
              item.active ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70 hover:border-blue'
            }`}
          >
            {item.label}
            <span className={`u-tabular ${item.tone === 'danger' ? 'text-danger' : 'text-ink-45'}`}>{item.count}</span>
          </Link>
        ))}
      </div>

      <TableToolbar
        params={params}
        search={{ placeholder: t('admin.viewings.searchPlaceholder') }}
        filters={[
          {
            type: 'select',
            param: 'status',
            label: t('admin.viewings.colStatus'),
            options: [
              ...VIEWING_REQUEST_STATUSES.map((value) => ({ value, label: t(VIEWING_REQUEST_STATUS_LABEL_KEYS[value]) })),
              { value: ESCALATED, label: t('admin.viewings.escalated') },
            ],
          },
          {
            type: 'select',
            param: 'routing',
            label: t('admin.viewings.colRouting'),
            options: ROUTING_TYPES.map((value) => ({ value, label: t(ROUTING_TYPE_LABEL_KEYS[value]) })),
          },
          {
            type: 'select',
            param: 'commune',
            label: t('admin.viewings.colCommune'),
            options: (feed?.summary?.communes || []).map((row) => ({ value: row.commune, label: `${row.commune} (${row.n})` })),
          },
          { type: 'date', param: 'from', label: t('admin.table.from') },
          { type: 'date', param: 'to', label: t('admin.table.to') },
        ]}
      >
        <ServerViewTools path="/admin/viewings" params={params} exportDataset="viewings" />
      </TableToolbar>

      {loadError ? <ErrorNote>{t('admin.viewings.loadError', { error: loadError })}</ErrorNote> : null}

      <TableFrame
        minWidth="72rem"
        footer={feed ? <Pagination pathname="/admin/viewings" params={params} total={feed.total} page={page} pageSize={pageSize} /> : null}
      >
        <thead>
          <tr>
            <th className={TH_STICKY}>{t('admin.viewings.colListing')}</th>
            <th className={TH_STICKY}>{t('admin.viewings.colClient')}</th>
            <th className={TH_STICKY}>{t('admin.viewings.colReceived')}</th>
            <th className={TH_STICKY}>{t('admin.viewings.colAgent')}</th>
            <th className={TH_STICKY}>{t('admin.viewings.colStatus')}</th>
            <th className={TH_STICKY}>{t('admin.viewings.colSlot')}</th>
            <th className={TH_STICKY}>{t('admin.viewings.colReason')}</th>
            <th className={TH_STICKY}>{t('admin.viewings.colActions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={8}>{loadError ? '—' : t('admin.viewings.empty')}</EmptyRow>
          ) : (
            rows.map((row) => {
              const listing = labels.get(Number(row.property_id));
              const agentId = row.agent_id ? Number(row.agent_id) : null;
              const listingAgentId = agentId ? null : listingAgentOf(row);
              const shownAgent = contacts.get(agentId || listingAgentId) || null;
              const listingLabel = listing?.reference ? `Réf. ${listing.reference}` : row.property_id ? `#${row.property_id}` : '';
              const isEscalated = row.status === 'PENDING' && row.sla_alerted_at;
              return (
                <tr key={row.id} className={TR_DENSE}>
                  <td className={TD_DENSE}>
                    {row.property_id ? (
                      <Link href={`/admin/listings/${row.property_id}`} className="font-semibold text-blue-deep hover:underline">
                        {listing?.reference ? `Réf: ${listing.reference}` : `#${row.property_id}`}
                      </Link>
                    ) : '—'}
                    {listing?.title ? <div className="max-w-[15rem] truncate text-ink-45">{listing.title}</div> : null}
                    <div className="u-tabular text-ink-35">
                      #{row.id}{row.resolved_commune ? ` · ${row.resolved_commune}` : ''}
                    </div>
                  </td>
                  <td className={TD_DENSE}>
                    <div className="max-w-[10rem] truncate text-ink">{row.lead_name || '—'}</div>
                    <div className="mt-1">
                      <WhatsAppLink
                        phone={row.lead_wa_id}
                        label={t('admin.viewings.whatsappCustomer')}
                        text={t('admin.viewings.whatsappCustomerText', { name: row.lead_name || '', listing: listingLabel })}
                      />
                    </div>
                  </td>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(row.created_at)}</td>
                  <td className={TD_DENSE}>
                    {agentId || listingAgentId ? (
                      <AgentContact
                        agent={shownAgent}
                        fallbackId={agentId || listingAgentId}
                        whatsappLabel={t('admin.viewings.whatsappAgent')}
                        whatsappText={t('admin.viewings.whatsappAgentText', { listing: listingLabel, customer: row.lead_name || '' })}
                        unroutableLabel={t('admin.viewings.agentUnroutable')}
                        chips={listingAgentId ? <Chip tone="warning">{t('admin.viewings.listingAgentNotAlerted')}</Chip> : null}
                      />
                    ) : (
                      <span className="text-ink-45">{row.property_id ? t('admin.viewings.listingHasNoAgent') : '—'}</span>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1">
                      {row.routing_type ? (
                        <Chip tone={ROUTING_TONE[row.routing_type]}>{t(ROUTING_TYPE_LABEL_KEYS[row.routing_type])}</Chip>
                      ) : (
                        <span className="text-ink-35">{t('admin.viewings.notRouted')}</span>
                      )}
                      {row.reassigned_at ? <Chip>{t('admin.viewings.reassignedChip')}</Chip> : null}
                    </div>
                  </td>
                  <td className={TD_DENSE}>
                    <div className="flex flex-col items-start gap-1">
                      <Chip tone={STATUS_TONE[row.status]}>
                        {VIEWING_REQUEST_STATUS_LABEL_KEYS[row.status] ? t(VIEWING_REQUEST_STATUS_LABEL_KEYS[row.status]) : row.status}
                      </Chip>
                      {isEscalated ? <Chip tone="danger">{t('admin.viewings.escalated')}</Chip> : null}
                      {/* The agent's answer, wherever it was given. Before the
                          dashboard went through the engine's response path, an
                          answer given there changed the status and left
                          nothing else — no channel, no response time, no sign
                          anyone had told the customer. `customer_notified_at`
                          is Chakra ACCEPTING the message, not delivery. */}
                      {row.agent_response_via ? (
                        <div className="text-ink-45">
                          {row.agent_response_via === 'DASHBOARD'
                            ? t('admin.viewings.viaDashboard')
                            : t('admin.viewings.viaWhatsapp')}
                          {row.first_response_at ? ` · ${formatKinshasa(row.first_response_at)}` : ''}
                        </div>
                      ) : null}
                      {row.agent_response_via || row.customer_notified_at ? (
                        <Chip tone={row.customer_notified_at ? 'success' : 'danger'}>
                          {row.customer_notified_at
                            ? t('admin.viewings.clientNotified')
                            : t('admin.viewings.clientNotNotified')}
                        </Chip>
                      ) : null}
                    </div>
                  </td>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>
                    {row.scheduled_at ? formatKinshasa(row.scheduled_at) : (row.requested_time || '—')}
                  </td>
                  <td className={TD_DENSE}>
                    {row.decline_reason_code ? (
                      <>
                        <div className="text-ink">{t(DECLINE_REASON_LABEL_KEYS[row.decline_reason_code])}</div>
                        <div className="text-ink-45">
                          {row.decline_reason_by === 'CUSTOMER' ? t('admin.viewings.byCustomer') : t('admin.viewings.byAgent')}
                        </div>
                      </>
                    ) : '—'}
                  </td>
                  <td className={TD_DENSE}>
                    <ViewingRowActions
                      viewingRequestId={row.id}
                      currentAgentId={agentId}
                      listingAgent={listingAgentId && shownAgent?.routable ? { id: listingAgentId, name: shownAgent.name } : null}
                      commune={row.resolved_commune || null}
                      canNudge={row.routing_type === 'DIRECT_WA' && ['PENDING', 'RESCHEDULED'].includes(row.status)}
                      canCancel={CANCELLABLE.includes(row.status)}
                    />
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </TableFrame>

      <NewItemsNotice keys={['pendingViewings', 'escalatedViewings']} />
    </div>
  );
}
