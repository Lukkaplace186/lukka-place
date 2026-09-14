import Link from 'next/link';
import { getConversationDetail, listConversations } from '@/lib/adminApi';
import { CONVERSATION_STATES, CONVERSATION_STATE_LABEL_KEYS } from '@/lib/adminLabels';
import { buildHref, firstParam, parsePage } from '@/lib/adminPagination';
import { getT } from '@/lib/i18n/server';
import { Chip, ErrorNote, formatKinshasa } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import TableToolbar from '../table/TableToolbar';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../table/TableFrame';
import ConversationDrawer from './ConversationDrawer';
import ServerViewTools from '../table/ServerViewTools';
import { NewItemsNotice } from '../LiveQueueCounts';

export const dynamic = 'force-dynamic';

const PATH = '/admin/conversations';
const SENDER_SHORT_KEYS = {
  customer: 'admin.conversations.senderCustomer',
  ai: 'admin.conversations.senderAi',
  agent: 'admin.conversations.senderAgent',
  system: 'admin.conversations.senderSystem',
};

/**
 * WhatsApp threads, one server page at a time, with the selected thread open
 * in a slide-over (`?c=<id>`). Filters: state, who is replying (assistant or a
 * human), and a search over the customer's number, the assigned agent and the
 * internal notes — all matched in the engine's SQLite, indexed.
 */
export default async function AdminConversationsPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const filters = {
    q: firstParam(raw.q) || undefined,
    state: CONVERSATION_STATES.includes(firstParam(raw.state)) ? firstParam(raw.state) : undefined,
    ai: ['0', '1'].includes(firstParam(raw.ai)) ? firstParam(raw.ai) : undefined,
  };
  const { page, pageSize, limit, offset } = parsePage(raw);
  const params = { ...filters, page: page > 1 ? String(page) : undefined, size: pageSize === 25 ? undefined : String(pageSize) };
  const openId = Number.parseInt(firstParam(raw.c), 10);

  const [listResult, detailResult] = await Promise.allSettled([
    listConversations({ state: filters.state, q: filters.q, aiActive: filters.ai, limit, offset }),
    Number.isFinite(openId) ? getConversationDetail(openId) : Promise.resolve(null),
  ]);
  const list = listResult.status === 'fulfilled' ? listResult.value : null;
  const listError = listResult.status === 'rejected' ? listResult.reason?.message : null;
  const detail = detailResult.status === 'fulfilled' ? detailResult.value : null;
  const detailError = detailResult.status === 'rejected' ? detailResult.reason?.message : null;
  const rows = list?.data || [];
  const byState = list?.summary?.byState || {};

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="u-title-page text-ink">{t('admin.conversations.title')}</h1>
        <p className="u-micro mt-1 text-ink-45">{t('admin.conversations.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href={buildHref(PATH, params, { state: '', ai: '' })}
          scroll={false}
          className={`u-micro-strong inline-flex items-center gap-1.5 rounded-full border px-3 py-1 ${!filters.state && !filters.ai ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70 hover:border-blue'}`}
        >
          {t('admin.table.all')}
          <span className="u-tabular text-ink-45">{Object.values(byState).reduce((sum, n) => sum + n, 0)}</span>
        </Link>
        <Link
          href={buildHref(PATH, params, { ai: filters.ai === '0' ? '' : '0' })}
          scroll={false}
          className={`u-micro-strong inline-flex items-center gap-1.5 rounded-full border px-3 py-1 ${filters.ai === '0' ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70 hover:border-blue'}`}
        >
          {t('admin.conversations.humanInControl')}
          <span className={`u-tabular ${list?.summary?.humanHandled ? 'text-warning' : 'text-ink-45'}`}>{list?.summary?.humanHandled ?? 0}</span>
        </Link>
        {CONVERSATION_STATES.filter((state) => byState[state]).map((state) => (
          <Link
            key={state}
            href={buildHref(PATH, params, { state: filters.state === state ? '' : state })}
            scroll={false}
            className={`u-micro-strong inline-flex items-center gap-1.5 rounded-full border px-3 py-1 ${filters.state === state ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line bg-surface text-ink-70 hover:border-blue'}`}
          >
            {t(CONVERSATION_STATE_LABEL_KEYS[state])}
            <span className="u-tabular text-ink-45">{byState[state]}</span>
          </Link>
        ))}
      </div>

      <TableToolbar
        params={params}
        search={{ placeholder: t('admin.conversations.searchPlaceholder') }}
        filters={[
          {
            type: 'select',
            param: 'state',
            label: t('admin.conversations.status'),
            options: CONVERSATION_STATES.map((value) => ({ value, label: t(CONVERSATION_STATE_LABEL_KEYS[value]) })),
          },
          {
            type: 'select',
            param: 'ai',
            label: t('admin.conversations.ai'),
            options: [
              { value: '1', label: t('admin.conversations.aiActive') },
              { value: '0', label: t('admin.conversations.humanInControl') },
            ],
          },
        ]}
      >
        <ServerViewTools path="/admin/conversations" params={params} exportDataset="conversations" />
      </TableToolbar>

      {listError ? <ErrorNote>{t('admin.conversations.loadError', { error: listError })}</ErrorNote> : null}

      <TableFrame
        minWidth="62rem"
        footer={list ? <Pagination pathname={PATH} params={params} total={list.total} page={page} pageSize={pageSize} /> : null}
      >
        <thead>
          <tr>
            <th className={TH_STICKY}>{t('admin.conversations.customer')}</th>
            <th className={TH_STICKY}>{t('admin.conversations.status')}</th>
            <th className={TH_STICKY}>{t('admin.conversations.ai')}</th>
            <th className={TH_STICKY}>{t('admin.conversations.agent')}</th>
            <th className={TH_STICKY}>{t('admin.conversations.lastMessage')}</th>
            <th className={TH_STICKY_RIGHT}>{t('admin.conversations.colMessages')}</th>
            <th className={TH_STICKY}>{t('admin.conversations.updatedAt')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={7}>{t('admin.conversations.empty')}</EmptyRow>
          ) : (
            rows.map((c) => {
              const openHref = buildHref(PATH, { ...params, c: String(c.id) });
              const selected = c.id === openId;
              return (
                <tr key={c.id} className={`${TR_DENSE} ${selected ? 'bg-blue-tint/40' : ''}`}>
                  <td className={TD_DENSE}>
                    <Link href={openHref} scroll={false} className="u-tabular font-semibold text-blue-deep hover:underline">
                      +{c.wa_id}
                    </Link>
                    <div className="text-ink-45">{c.commune || '—'} · #{c.id}</div>
                  </td>
                  <td className={TD_DENSE}>
                    <Chip tone={c.state === 'CLOSED' ? 'neutral' : c.state === 'HUMAN_HANDOFF' ? 'warning' : 'blue'}>
                      {CONVERSATION_STATE_LABEL_KEYS[c.state] ? t(CONVERSATION_STATE_LABEL_KEYS[c.state]) : c.state}
                    </Chip>
                  </td>
                  <td className={TD_DENSE}>
                    {c.ai_active ? (
                      <span className="font-semibold text-success">{t('admin.conversations.aiActive')}</span>
                    ) : (
                      <span className="font-semibold text-warning">{t('admin.conversations.humanInControl')}</span>
                    )}
                  </td>
                  <td className={TD_DENSE}>{c.assigned_agent || '—'}</td>
                  <td className={`${TD_DENSE} max-w-[22rem]`}>
                    {c.last_message ? (
                      <Link href={openHref} scroll={false} className="block hover:text-ink">
                        <span className="text-ink-45">
                          {c.last_message_direction === 'inbound' ? '← ' : '→ '}
                          {c.last_message_sender && SENDER_SHORT_KEYS[c.last_message_sender] ? `${t(SENDER_SHORT_KEYS[c.last_message_sender])} · ` : ''}
                        </span>
                        <span className="line-clamp-1">{c.last_message}</span>
                      </Link>
                    ) : '—'}
                  </td>
                  <td className={TD_DENSE_RIGHT}>{c.message_count}</td>
                  <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(c.last_message_at || c.updated_at)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </TableFrame>

      <NewItemsNotice keys={['humanConversations']} />

      {Number.isFinite(openId) ? (
        <ConversationDrawer
          key={openId}
          conversation={detail?.conversation || null}
          messages={detail?.messages || []}
          messagesTotal={detail?.messages_total ?? detail?.messages?.length ?? 0}
          leads={detail?.leads || []}
          loadError={detailError}
          closeHref={buildHref(PATH, params)}
          fullHref={`${PATH}/${openId}`}
        />
      ) : null}
    </div>
  );
}
