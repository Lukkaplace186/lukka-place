import Link from 'next/link';
import { Download, X } from 'lucide-react';
import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { buildHref, firstParam, parsePage } from '@/lib/adminPagination';
import { CONTACT_CHANNELS, CONTACT_WINDOWS, contactWindow, filterContactRows, summariseContactRows } from '@/lib/contactLog';
import { getContactLabels, loadContactLog } from '@/lib/contactLogLoader';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, formatKinshasa } from '../LeadRoutingUI';
import InfoTip from '../market-data/InfoTip';
import Pagination from '../table/Pagination';
import TableToolbar from '../table/TableToolbar';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';

export const metadata = {
  title: 'Contacts — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const PATH = '/admin/contacts';
const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

/** Chip colour per follow-up state: green = the agent acted, red = someone is waiting. */
const STATUS_TONE = {
  replied: 'success', contacted: 'success', customerConfirmed: 'success', visitConfirmed: 'success', visitDone: 'success',
  nothing: 'danger', customerWaiting: 'danger', notContacted: 'warning', failed: 'warning', visitPending: 'warning',
  waiting: 'blue', visitRescheduled: 'blue', earlier: 'neutral', noAlert: 'neutral', tapOnly: 'neutral',
  visitDeclined: 'neutral', visitCancelled: 'neutral', visitOther: 'neutral',
};

/**
 * Contacts — every customer → agent contact, one row each: who (when known),
 * which agent, about what, through which channel, and what happened next.
 * Rules: lib/contactLog.js; reads: lib/contactLogLoader.js. The per-agent
 * totals of the same contacts are /admin/interactions.
 */
export default async function AdminContactsPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const days = contactWindow(firstParam(raw.days));
  const channel = CONTACT_CHANNELS.includes(firstParam(raw.channel)) ? firstParam(raw.channel) : null;
  const known = firstParam(raw.known) === '1';
  const q = firstParam(raw.q) || '';
  const agentId = Number.parseInt(firstParam(raw.agent), 10) || null;
  const paging = parsePage(raw);
  const params = Object.fromEntries(
    ['days', 'channel', 'known', 'q', 'agent', 'page', 'size'].map((key) => [key, firstParam(raw[key]) || undefined]),
  );
  const session = await getAdminSession();
  const canExport = can(session?.role, 'data.export');

  const { rows, errors, capped } = await loadContactLog({ days });
  const filtered = filterContactRows(rows, { channel, agentId, known, q });
  const summary = summariseContactRows(filterContactRows(rows, { agentId, known, q }));
  const pageRows = filtered.slice(paging.offset, paging.offset + paging.limit);
  const { names, listings, projects } = await getContactLabels(agentId ? [...pageRows, { agentId }] : pageRows);
  const agentName = (id) => names.get(id)?.name || t('admin.interactions.agentFallback', { id });
  const exportQuery = new URLSearchParams(Object.entries({ days: String(days), channel, known: known ? '1' : null, q, agent: agentId ? String(agentId) : null }).filter(([, v]) => v)).toString();

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.contacts.title')}</h1>
          <p className="u-micro mt-1 max-w-[52rem] text-ink-45">{t('admin.contacts.subtitle')}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {CONTACT_WINDOWS.map((value) => (
            <Link
              key={value}
              href={buildHref(PATH, params, { days: value === 30 ? '' : value, page: '' })}
              aria-current={value === days ? 'page' : undefined}
              className={`u-press rounded-full px-3.5 py-1.5 text-[0.8125rem] font-bold transition-colors ${value === days ? 'bg-ink text-white' : 'bg-canvas-alt text-ink-70 hover:bg-canvas-deep'}`}
            >
              {t('admin.matching.rangeDays', { days: value })}
            </Link>
          ))}
        </div>
      </div>

      {errors.engine ? <ErrorNote>{t('admin.contacts.engineError', { error: errors.engine })}</ErrorNote> : null}
      {errors.taps ? <ErrorNote>{t('admin.contacts.databaseError', { error: errors.taps })}</ErrorNote> : null}
      {capped ? <ErrorNote>{t('admin.contacts.capped')}</ErrorNote> : null}

      <section className="grid gap-3 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <div className="u-card flex flex-col gap-2 rounded-card bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="u-eyebrow text-ink-45">{t('admin.contacts.total', { days })}</span>
            <InfoTip label={t('admin.contacts.total', { days })}>{t('admin.contacts.totalHelp')}</InfoTip>
          </div>
          <div className="u-stat text-ink">{fmt(summary.total)}</div>
          <p className="u-micro text-ink-70">{t('admin.contacts.known', { known: fmt(summary.known), total: fmt(summary.total) })}</p>
          {summary.repeats ? <p className="u-micro text-ink-45">{t('admin.contacts.repeats', { count: fmt(summary.repeats) })}</p> : null}
        </div>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CONTACT_CHANNELS.map((key) => (
            <li key={key}>
              <Link
                href={buildHref(PATH, params, { channel: channel === key ? '' : key, page: '' })}
                aria-current={channel === key ? 'true' : undefined}
                className={`u-card flex h-full flex-col gap-1 rounded-card p-3.5 transition-colors ${channel === key ? 'bg-blue-tint ring-1 ring-blue' : 'bg-surface hover:bg-canvas-alt'}`}
              >
                <span className="u-eyebrow text-ink-45">{t(`admin.interactions.channels.${key}`)}</span>
                <span className="text-[1.375rem] font-extrabold text-ink">{fmt(summary.byChannel[key])}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <TableToolbar
            params={params}
            search={{ placeholder: t('admin.contacts.searchPlaceholder') }}
            filters={[
              {
                type: 'select',
                param: 'channel',
                label: t('admin.contacts.channel'),
                allLabel: t('admin.contacts.allChannels'),
                options: CONTACT_CHANNELS.map((key) => ({ value: key, label: t(`admin.interactions.channels.${key}`) })),
              },
              {
                type: 'select',
                param: 'known',
                label: t('admin.contacts.customer'),
                allLabel: t('admin.contacts.customerAll'),
                options: [{ value: '1', label: t('admin.contacts.customerKnownOnly') }],
              },
            ]}
            resetKeys={['q', 'channel', 'known', 'agent']}
          />
          {canExport ? (
            <a
              href={`/admin/export/contacts?${exportQuery}`}
              className="u-press inline-flex h-11 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-canvas-alt"
            >
              <Download strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" aria-hidden="true" />
              {t('admin.contacts.export')}
            </a>
          ) : null}
        </div>
        {agentId ? (
          <div>
            <Link
              href={buildHref(PATH, params, { agent: '', page: '' })}
              className="u-press inline-flex items-center gap-1.5 rounded-full bg-blue-tint px-3 py-1.5 text-[0.8125rem] font-semibold text-blue-deep"
            >
              {t('admin.contacts.agentFilter', { name: agentName(agentId) })}
              <X strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" aria-label={t('admin.contacts.clearAgent')} />
            </Link>
          </div>
        ) : null}

        <TableFrame
          minWidth="72rem"
          footer={<Pagination pathname={PATH} params={params} total={filtered.length} page={paging.page} pageSize={paging.pageSize} />}
        >
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.contacts.colDate')}</th>
              <th className={TH_STICKY}>{t('admin.contacts.colCustomer')}</th>
              <th className={TH_STICKY}>{t('admin.contacts.colAgent')}</th>
              <th className={TH_STICKY}>{t('admin.contacts.colWhat')}</th>
              <th className={TH_STICKY}>{t('admin.contacts.colChannel')}</th>
              <th className={TH_STICKY}>
                <span className="inline-flex items-center gap-1">
                  {t('admin.contacts.colStatus')}
                  <InfoTip label={t('admin.contacts.colStatus')}>{t('admin.contacts.statusHelp')}</InfoTip>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <EmptyRow colSpan={6}>{t('admin.contacts.empty', { days })}</EmptyRow>
            ) : pageRows.map((row) => {
              const listing = row.listingId ? listings.get(row.listingId) : null;
              const project = row.projectSlug
                ? projects.get(`slug:${row.projectSlug.toLowerCase()}`)
                : row.developmentId ? projects.get(`id:${row.developmentId}`) : null;
              return (
                <tr key={row.key} className={`${TR_DENSE} ${row.repeat ? 'opacity-60' : ''}`}>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>
                    {formatKinshasa(row.at)}
                    {row.repeat ? <div className="mt-0.5"><Chip tone="neutral">{t('admin.contacts.repeat')}</Chip></div> : null}
                  </td>
                  <td className={TD_DENSE}>
                    <CustomerCell t={t} customer={row.customer} />
                  </td>
                  <td className={TD_DENSE}>
                    {row.agentId ? (
                      <div className="flex flex-col">
                        <Link href={`/admin/agents/${row.agentId}`} className="font-semibold text-blue-deep hover:underline">{agentName(row.agentId)}</Link>
                        {agentId !== row.agentId ? (
                          <Link href={buildHref(PATH, params, { agent: row.agentId, page: '' })} className="text-[0.75rem] text-ink-45 hover:text-ink hover:underline">
                            {t('admin.contacts.filterAgent')}
                          </Link>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-ink-35">{t('admin.contacts.noAgent')}</span>
                    )}
                  </td>
                  <td className={TD_DENSE}>
                    {row.listingId ? (
                      <div className="flex flex-col">
                        <Link href={`/admin/listings/${row.listingId}`} className="font-semibold text-blue-deep hover:underline">
                          #{row.listingId}{listing?.reference ? <span className="font-normal text-ink-70"> · {listing.reference}</span> : null}
                        </Link>
                        {listing?.title ? <span className="max-w-[16rem] truncate text-ink-45">{listing.title}</span> : null}
                      </div>
                    ) : project || row.projectSlug ? (
                      <span className="text-ink">{t('admin.contacts.project', { name: project?.name || row.projectSlug })}</span>
                    ) : null}
                    {row.surface && row.surface !== 'listing' ? (
                      <div className="text-[0.75rem] text-ink-45">{t(`admin.contacts.surface.${row.surface}`)}</div>
                    ) : null}
                    {!row.listingId && !project && !row.projectSlug && (!row.surface || row.surface === 'listing') ? <span className="text-ink-35">—</span> : null}
                  </td>
                  <td className={TD_DENSE}>
                    <Chip tone="neutral">{t(`admin.interactions.short.${row.channel}`)}</Chip>
                  </td>
                  <td className={TD_DENSE}>
                    <div className="flex flex-col items-start gap-0.5">
                      <Chip tone={STATUS_TONE[row.status] || 'neutral'}>{t(`admin.contacts.status.${row.status}`)}</Chip>
                      {row.statusAt ? <span className="text-[0.75rem] text-ink-45">{formatKinshasa(row.statusAt)}</span> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableFrame>
      </section>
    </div>
  );
}

/** The customer: name and number when known (WhatsApp link), else "Anonyme". */
function CustomerCell({ t, customer }) {
  if (!customer || (!customer.phone && !customer.customerId)) {
    return <span className="text-ink-45" title={t('admin.contacts.anonymousHelp')}>{t('admin.contacts.anonymous')}</span>;
  }
  if (!customer.phone) {
    return <span className="text-ink-45">{t('admin.contacts.accountGone', { id: customer.customerId })}</span>;
  }
  return (
    <div className="flex flex-col">
      {customer.name ? <span className="font-semibold text-ink">{customer.name}</span> : null}
      <a href={`https://wa.me/${customer.phone}`} target="_blank" rel="noopener noreferrer" className="text-blue-deep hover:underline">
        +{customer.phone}
      </a>
      {customer.customerId ? (
        <Link href={`/admin/customers?q=${encodeURIComponent(customer.phone)}`} className="text-[0.75rem] text-ink-45 hover:text-ink hover:underline">
          {t('admin.contacts.account')}
        </Link>
      ) : null}
    </div>
  );
}
