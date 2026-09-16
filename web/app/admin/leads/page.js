import Link from 'next/link';
import { listLeads } from '@/lib/adminApi';
import { LEAD_STATUSES, LEAD_STATUS_LABEL_KEYS } from '@/lib/adminLabels';
import { getListingLabels } from '@/lib/adminLeadRouting';
import { getAgentContactsByIds } from '@/lib/agents';
import { firstParam, parsePage } from '@/lib/adminPagination';
import { updateLeadStatusAction, assignLeadAction } from '../actions';
import { getT } from '@/lib/i18n/server';
import AgentPicker from '../AgentPicker';
import { AgentContact, WhatsAppLink } from '../ContactCell';
import { Chip, ErrorNote } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import TableToolbar from '../table/TableToolbar';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';

export const dynamic = 'force-dynamic';

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${value.replace(' ', 'T')}Z`),
  );
}

function budgetText(lead) {
  const min = lead.price_min != null ? Number(lead.price_min).toLocaleString('fr-FR') : null;
  const max = lead.price_max != null ? Number(lead.price_max).toLocaleString('fr-FR') : null;
  if (min && max) return `$${min}–$${max}`;
  if (max) return `≤ $${max}`;
  if (min) return `≥ $${min}`;
  return null;
}

/**
 * "Limete · location · 2 ch. · $800–$1,000" — commune first (the field
 * Request Assignment Routing actually matches agents on), then the real
 * structured columns Trouver pour moi populates. There is no `property_type`
 * column on `leads` (only `conversations` has one), so none is shown.
 */
function researchLine(lead) {
  const parts = [
    lead.commune,
    lead.transaction_type,
    lead.bedrooms ? `${lead.bedrooms} ch.` : null,
    budgetText(lead),
  ].filter(Boolean);
  return parts.join(' · ') || null;
}

const ASSIGNMENT_FILTERS = ['unassigned'];

/**
 * Prospects. Each row carries the whole chain an admin needs to act on:
 * the customer (with a WhatsApp link), what they asked for, and the agent —
 * the one assigned by hand, or, for a request about a specific listing that
 * nobody assigned, that listing's own agent, marked as such, with one click
 * to make it the assignment. Search, status and "unassigned" filters are SQL
 * in the engine, one page at a time.
 */
export default async function AdminLeadsPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const status = LEAD_STATUSES.includes(firstParam(raw.status)) ? firstParam(raw.status) : undefined;
  const q = String(firstParam(raw.q) || '').trim().slice(0, 100) || undefined;
  const assignment = ASSIGNMENT_FILTERS.includes(firstParam(raw.assignment)) ? firstParam(raw.assignment) : undefined;
  // `?wa=` scopes the list to one customer — /admin/customers links here.
  const wa = String(firstParam(raw.wa) || '').replace(/\D/g, '') || undefined;
  const { page, pageSize, limit, offset } = parsePage(raw);
  const params = {
    q, status, assignment, wa,
    page: page > 1 ? String(page) : undefined, size: pageSize === 25 ? undefined : String(pageSize),
  };

  let result = { total: 0, data: [] };
  let loadError = null;
  try {
    result = await listLeads({ status, waId: wa, q, unassigned: assignment === 'unassigned', limit, offset });
  } catch (err) {
    loadError = err.message;
  }
  const leads = result.data || [];

  const labels = await getListingLabels(leads.map((lead) => lead.property_id)).catch(() => new Map());
  const listingAgentOf = (lead) => {
    const id = labels.get(Number(lead.property_id))?.agent_id;
    return id ? Number(id) : null;
  };
  const contacts = await getAgentContactsByIds([
    ...leads.map((lead) => lead.agent_id),
    ...leads.map(listingAgentOf),
  ]).catch(() => new Map());

  const filtered = Boolean(q || status || assignment || wa);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.leads.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.leads.subtitle', { count: result.total ?? 0 })}</p>
        {wa ? (
          <p className="u-micro mt-1 text-ink-70">
            {t('admin.leads.scopedToCustomer', { phone: `+${wa}` })}{' '}
            <Link href="/admin/leads" className="font-semibold text-blue-deep hover:underline">{t('admin.leads.clearCustomer')}</Link>
          </p>
        ) : null}
      </div>

      <TableToolbar
        params={params}
        search={{ placeholder: t('admin.leads.searchPlaceholder') }}
        filters={[
          {
            type: 'select',
            param: 'status',
            label: t('admin.leads.status'),
            options: LEAD_STATUSES.map((value) => ({ value, label: t(LEAD_STATUS_LABEL_KEYS[value]) })),
          },
          {
            type: 'select',
            param: 'assignment',
            label: t('admin.leads.assignedAgent'),
            options: [{ value: 'unassigned', label: t('admin.leads.onlyUnassigned') }],
          },
        ]}
      />

      {loadError ? <ErrorNote>{t('admin.leads.loadError', { error: loadError })}</ErrorNote> : null}

      <TableFrame
        minWidth="72rem"
        footer={<Pagination pathname="/admin/leads" params={params} total={result.total ?? 0} page={page} pageSize={pageSize} />}
      >
        <thead>
          <tr>
            <th className={TH_STICKY}>{t('admin.leads.customer')}</th>
            <th className={TH_STICKY}>{t('admin.leads.search')}</th>
            <th className={TH_STICKY}>{t('admin.leads.assignedAgent')}</th>
            <th className={TH_STICKY}>{t('admin.leads.createdAt')}</th>
            <th className={TH_STICKY}>{t('admin.leads.status')}</th>
            <th className={TH_STICKY} aria-label={t('admin.table.moreActions')} />
          </tr>
        </thead>
        <tbody>
          {leads.length === 0 ? (
            <EmptyRow colSpan={6}>{loadError ? '—' : filtered ? t('admin.leads.emptyFiltered') : t('admin.leads.empty')}</EmptyRow>
          ) : leads.map((lead) => {
            const boundUpdateStatus = updateLeadStatusAction.bind(null, lead.id);
            const boundAssign = assignLeadAction.bind(null, lead.id);
            const research = researchLine(lead);
            const assignedId = lead.agent_id ? Number(lead.agent_id) : null;
            const listingAgentId = listingAgentOf(lead);
            const showListingAgent = !assignedId && listingAgentId;
            const agent = contacts.get(assignedId || listingAgentId) || null;
            const listing = labels.get(Number(lead.property_id));
            const listingLabel = listing?.reference ? `Réf. ${listing.reference}` : lead.property_id ? `#${lead.property_id}` : '';

            return (
              <tr key={lead.id} className={`${TR_DENSE} align-top`}>
                <td className={TD_DENSE}>
                  {lead.conversation_id ? (
                    <Link href={`/admin/conversations/${lead.conversation_id}`} className="font-semibold text-blue-deep hover:underline">
                      {lead.name || `+${lead.wa_id}`}
                    </Link>
                  ) : (
                    <span className="font-semibold text-ink">{lead.name || `+${lead.wa_id}`}</span>
                  )}
                  <div className="mt-1">
                    <WhatsAppLink
                      phone={lead.wa_id}
                      label={t('admin.viewings.whatsappCustomer')}
                      text={t('admin.leads.whatsappCustomerText', { name: lead.name || '' })}
                    />
                  </div>
                </td>
                <td className={`${TD_DENSE} max-w-[20rem]`}>
                  {lead.property_id ? (
                    <Link href={`/admin/listings/${lead.property_id}`} className="font-semibold text-blue-deep hover:underline">
                      {listingLabel}
                    </Link>
                  ) : null}
                  {listing?.title ? <div className="max-w-[18rem] truncate text-ink-45">{listing.title}</div> : null}
                  {research ? <div className="text-ink">{research}</div> : null}
                  {lead.requirements_summary ? <div className="line-clamp-2 text-ink-45">{lead.requirements_summary}</div> : null}
                  {!research && !lead.requirements_summary && !lead.property_id ? '—' : null}
                  <div className="mt-1 text-ink-35">{t('admin.leads.proposals', { count: lead.pitches_count || 0 })}</div>
                </td>
                <td className={TD_DENSE}>
                  {agent || assignedId || listingAgentId ? (
                    <AgentContact
                      agent={agent}
                      fallbackId={assignedId || listingAgentId}
                      whatsappLabel={t('admin.viewings.whatsappAgent')}
                      whatsappText={t('admin.leads.whatsappAgentText', { customer: lead.name || '', listing: listingLabel })}
                      unroutableLabel={t('admin.viewings.agentUnroutable')}
                      chips={showListingAgent ? <Chip tone="warning">{t('admin.leads.listingAgentNotAssigned')}</Chip> : null}
                    />
                  ) : (
                    <span className="text-ink-45">{t('admin.leads.unassigned')}</span>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {showListingAgent ? (
                      <form action={boundAssign}>
                        <input type="hidden" name="agent_id" value={listingAgentId} />
                        <button type="submit" className="u-press u-micro-strong rounded-md border border-blue bg-surface px-2 py-1 text-blue-deep hover:bg-blue-tint">
                          {t('admin.leads.assignListingAgent')}
                        </button>
                      </form>
                    ) : null}
                    <form action={boundAssign} className="flex items-center gap-1.5">
                      <AgentPicker
                        name="agent_id"
                        activeOnly
                        allowClear
                        commune={lead.commune || null}
                        defaultAgent={assignedId ? { id: assignedId, name: agent?.name || lead.assigned_agent || `Agent #${assignedId}` } : null}
                        placeholder={assignedId ? t('admin.leads.reassign') : t('admin.leads.assignTo')}
                        className="w-48"
                      />
                      <button type="submit" className="u-press u-micro-strong rounded-md border border-line px-2 py-1 text-ink hover:bg-canvas-alt">
                        {assignedId ? t('admin.leads.reassign') : t('admin.leads.assign')}
                      </button>
                    </form>
                  </div>
                </td>
                <td className={`${TD_DENSE} whitespace-nowrap text-ink-45`}>
                  {formatDate(lead.created_at)}
                  {lead.source ? <div className="text-ink-35">{lead.source}</div> : null}
                </td>
                <td className={TD_DENSE}>
                  <form action={boundUpdateStatus} className="flex items-center gap-1.5">
                    <select
                      name="status"
                      defaultValue={lead.status}
                      aria-label={t('admin.leads.status')}
                      className="u-micro rounded-full border border-line bg-surface px-2 py-1 text-ink"
                    >
                      {LEAD_STATUSES.map((value) => (
                        <option key={value} value={value}>{t(LEAD_STATUS_LABEL_KEYS[value])}</option>
                      ))}
                    </select>
                    <button type="submit" className="u-press u-micro-strong rounded-full border border-line px-2 py-1 text-ink hover:bg-canvas-alt">
                      {t('admin.leads.saveStatus')}
                    </button>
                  </form>
                </td>
                <td className={`${TD_DENSE} whitespace-nowrap`}>
                  <Link href={`/admin/leads/${lead.id}`} className="u-micro-strong text-blue-deep hover:underline">
                    {t('admin.leads.viewDetail')}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </TableFrame>
    </div>
  );
}
