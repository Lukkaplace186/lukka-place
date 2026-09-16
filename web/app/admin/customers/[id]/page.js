import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CalendarClock, Heart, Mail, MessageCircle, Search } from 'lucide-react';
import { adminGetCustomerProfile, listSavedSearches } from '@/lib/customers';
import { listConversations, listLeads, listViewingFeed } from '@/lib/adminApi';
import { getListingLabels } from '@/lib/adminLeadRouting';
import { listEntityAudit } from '@/lib/adminAudit';
import { listNotes } from '@/lib/adminNotes';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { CONVERSATION_STATE_LABEL_KEYS, LEAD_STATUS_LABEL_KEYS, VIEWING_REQUEST_STATUS_LABEL_KEYS } from '@/lib/adminLabels';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, STATUS_TONE, formatKinshasa } from '../../LeadRoutingUI';
import EntityTimeline from '../../EntityTimeline';
import CustomerRowActions from '../CustomerRowActions';
import ImpersonateButton from '../../ImpersonateButton';
import { adminSetCustomerPasswordAction, adminUnlockCustomerAction } from '../actions';

export const dynamic = 'force-dynamic';

function toDate(value) {
  if (!value) return null;
  const text = String(value);
  const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(text) || text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * One customer's whole story on one screen: their account, what they saved,
 * every request and viewing they made, their WhatsApp threads — merged into one
 * chronological activity feed — and the team's notes. Engine data is matched on
 * the customer's own number exactly.
 */
export default async function AdminCustomerDetailPage({ params }) {
  const t = await getT();
  const { id } = await params;
  const customer = await adminGetCustomerProfile(id);
  if (!customer) notFound();
  const session = await getAdminSession();
  const phone = customer.phone;

  const [savedResult, leadsResult, viewingsResult, conversationsResult, notesResult, historyResult] = await Promise.allSettled([
    listSavedSearches(customer.id),
    listLeads({ waId: phone, limit: 100 }),
    listViewingFeed({ q: phone, limit: 100 }),
    listConversations({ q: phone, limit: 50 }),
    listNotes('customer', customer.id),
    listEntityAudit('customer', customer.id, 50),
  ]);
  const saved = savedResult.status === 'fulfilled' ? savedResult.value : [];
  const leads = leadsResult.status === 'fulfilled' ? leadsResult.value.data : [];
  const viewings = viewingsResult.status === 'fulfilled' ? viewingsResult.value.data.filter((row) => row.lead_wa_id === phone) : [];
  const conversations = conversationsResult.status === 'fulfilled' ? conversationsResult.value.data.filter((row) => row.wa_id === phone) : [];
  const engineError = [leadsResult, viewingsResult, conversationsResult].some((r) => r.status === 'rejected');
  const favoriteLabels = await getListingLabels(customer.favorite_ids.slice(0, 30)).catch(() => new Map());

  const activity = [
    ...leads.map((lead) => ({
      key: `lead-${lead.id}`, at: toDate(lead.created_at), icon: Mail, href: `/admin/leads/${lead.id}`,
      title: t('admin.customerProfile.leadItem', { id: lead.id, source: lead.source }),
      chip: <Chip tone="blue">{LEAD_STATUS_LABEL_KEYS[lead.status] ? t(LEAD_STATUS_LABEL_KEYS[lead.status]) : lead.status}</Chip>,
      detail: [lead.commune, lead.requirements_summary].filter(Boolean).join(' · '),
    })),
    ...viewings.map((row) => ({
      key: `viewing-${row.id}`, at: toDate(row.created_at), icon: CalendarClock, href: row.property_id ? `/admin/listings/${row.property_id}` : null,
      title: t('admin.customerProfile.viewingItem', { id: row.id, listing: row.property_id || '—' }),
      chip: <Chip tone={STATUS_TONE[row.status]}>{VIEWING_REQUEST_STATUS_LABEL_KEYS[row.status] ? t(VIEWING_REQUEST_STATUS_LABEL_KEYS[row.status]) : row.status}</Chip>,
      detail: row.scheduled_at ? formatKinshasa(row.scheduled_at) : row.requested_time,
    })),
    ...conversations.map((row) => ({
      key: `conversation-${row.id}`, at: toDate(row.last_message_at || row.updated_at), icon: MessageCircle, href: `/admin/conversations?c=${row.id}`,
      title: t('admin.customerProfile.conversationItem', { id: row.id, count: row.message_count }),
      chip: <Chip>{CONVERSATION_STATE_LABEL_KEYS[row.state] ? t(CONVERSATION_STATE_LABEL_KEYS[row.state]) : row.state}</Chip>,
      detail: row.last_message,
    })),
  ].sort((a, b) => (b.at?.getTime() || 0) - (a.at?.getTime() || 0));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/admin/customers" className="u-micro-strong inline-flex items-center gap-1.5 text-ink-45 hover:text-ink">
          <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.customerProfile.back')}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="u-title-page text-ink">{customer.full_name || `+${phone}`}</h1>
          {customer.is_locked ? <Chip tone="danger">{t('admin.customers.statusLocked')}</Chip> : <Chip tone="success">{t('admin.customers.statusActive')}</Chip>}
          {!customer.phone_verified_at ? <Chip tone="warning">{t('admin.customers.statusUnverified')}</Chip> : null}
        </div>
        <div className="u-micro mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-45">
          <span className="u-tabular">+{phone} · #{customer.id}</span>
          <span>{t('admin.customerProfile.joined', { date: formatKinshasa(customer.created_at) })}</span>
          <span>{t('admin.customerProfile.lastLogin', { date: formatKinshasa(customer.last_login_at) })}</span>
        </div>
        {can(session?.role, 'accounts.impersonate') ? (
          <div className="mt-3">
            <ImpersonateButton
              targetType="customer"
              targetId={customer.id}
              targetLabel={customer.full_name || `+${phone}`}
              sharedSession={Boolean(session?.shared)}
            />
          </div>
        ) : null}
        {can(session?.role, 'customers.manage') ? (
          <div className="mt-3">
            <CustomerRowActions
              phone={phone}
              isLocked={customer.is_locked}
              resetAction={adminSetCustomerPasswordAction.bind(null, customer.id)}
              unlockAction={adminUnlockCustomerAction.bind(null, customer.id)}
              leadsHref={`/admin/leads?wa=${encodeURIComponent(phone)}`}
            />
          </div>
        ) : null}
      </div>

      {engineError ? <ErrorNote>{t('admin.agentProfile.engineError')}</ErrorNote> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-5">
          <section className="u-card flex flex-col gap-3 rounded-card bg-surface p-5">
            <h2 className="u-title-card text-ink">{t('admin.customerProfile.activityTitle')}</h2>
            {activity.length === 0 ? (
              <p className="u-micro text-ink-45">{t('admin.customerProfile.noActivity')}</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {activity.map(({ key, at, icon: Icon, href, title, chip, detail }) => (
                  <li key={key} className="flex gap-3">
                    <Icon strokeWidth={ICON_STROKE_WIDTH} className="mt-0.5 h-4 w-4 shrink-0 text-ink-35" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {href ? <Link href={href} className="u-micro-strong text-blue-deep hover:underline">{title}</Link> : <span className="u-micro-strong text-ink">{title}</span>}
                        {chip}
                        <span className="u-micro text-ink-45">{at ? formatKinshasa(at) : '—'}</span>
                      </div>
                      {detail ? <p className="u-micro mt-0.5 line-clamp-2 text-ink-70">{detail}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="u-card flex flex-col gap-2 rounded-card bg-surface p-5">
              <h2 className="u-title-card flex items-center gap-2 text-ink">
                <Search strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-35" />
                {t('admin.customerProfile.savedSearchesTitle')}
              </h2>
              {saved.length === 0 ? <p className="u-micro text-ink-45">{t('admin.customerProfile.none')}</p> : (
                <ul className="flex flex-col gap-1.5">
                  {saved.map((row) => (
                    <li key={row.id} className="u-micro">
                      <Link href={`/listings?${row.query}`} target="_blank" className="font-semibold text-blue-deep hover:underline">{row.label || row.query}</Link>
                      <span className="text-ink-45"> · {formatKinshasa(row.created_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="u-card flex flex-col gap-2 rounded-card bg-surface p-5">
              <h2 className="u-title-card flex items-center gap-2 text-ink">
                <Heart strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4 text-ink-35" />
                {t('admin.customerProfile.favoritesTitle', { count: customer.favorite_ids.length })}
              </h2>
              {customer.favorite_ids.length === 0 ? <p className="u-micro text-ink-45">{t('admin.customerProfile.none')}</p> : (
                <ul className="flex flex-col gap-1.5">
                  {customer.favorite_ids.slice(0, 30).map((propertyId) => {
                    const label = favoriteLabels.get(propertyId);
                    return (
                      <li key={propertyId} className="u-micro">
                        <Link href={`/admin/listings/${propertyId}`} className="font-semibold text-blue-deep hover:underline">#{propertyId}</Link>
                        {label?.title ? <span className="text-ink-70"> · {label.title}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>

        <EntityTimeline
          entityType="customer"
          entityId={customer.id}
          notes={notesResult.status === 'fulfilled' ? notesResult.value : []}
          history={historyResult.status === 'fulfilled' ? historyResult.value : []}
          canWrite={can(session?.role, 'notes.write')}
        />
      </div>
    </div>
  );
}
