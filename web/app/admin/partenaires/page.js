import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { buildHref, firstParam, parsePage } from '@/lib/adminPagination';
import { CLICK_PERIODS, parseClickPeriod } from '@/lib/analytics';
import { listPartnerFunnels } from '@/lib/partnersAdmin';
import { frNumber } from '@/lib/format';
import { Chip, ErrorNote } from '../LeadRoutingUI';
import Pagination from '../table/Pagination';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../table/TableFrame';
import { BUTTON, BUTTON_PRIMARY, INPUT } from '../sales/styles';
import { createPartnerAction } from './actions';
import { FeeFields, flashFor, formatCost } from './partnerUi';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Partenaires — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

const PATH = '/admin/partenaires';

/** `?type=` → partner kind. Creators first: that is the campaign being judged. */
const TYPES = [
  { key: 'createurs', kind: 'creator', labelKey: 'admin.partners.types.creator' },
  { key: 'campagnes', kind: 'campaign', labelKey: 'admin.partners.types.campaign' },
  { key: 'agents', kind: 'agent', labelKey: 'admin.partners.types.agent' },
];

const TH_NUM = `${TH_STICKY} text-right`;
const TD_NUM = `${TD_DENSE} u-tabular text-right`;

/**
 * Everyone who brings people with a code of their own — TikTok creators,
 * campaigns, agents — side by side, with their funnel for the period:
 * clicks → visitors → listings viewed → WhatsApp taps → accounts → verified
 * → cost per verified account. lib/partnersAdmin.js has the definitions.
 * Reading is partners.view; creating a code and editing a fee is the owner's.
 */
export default async function AdminPartnersPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const type = TYPES.find((entry) => entry.key === firstParam(raw.type)) || TYPES[0];
  const period = parseClickPeriod(raw.periode);
  const q = String(firstParam(raw.q) || '').trim().slice(0, 80);
  const { page, pageSize, limit, offset } = parsePage(raw);
  const params = {
    type: type.key === 'createurs' ? undefined : type.key,
    periode: period.key === '30' ? undefined : period.key,
    q: q || undefined,
    page: page > 1 ? String(page) : undefined,
    size: pageSize === 25 ? undefined : String(pageSize),
  };
  const session = await getAdminSession();
  const canManage = can(session?.role, 'partners.manage');
  const showForm = canManage && firstParam(raw.new) === '1';

  let result = null;
  let loadError = null;
  try {
    result = await listPartnerFunnels({ kind: type.kind, q: q || null, days: period.days, limit, offset });
  } catch (err) {
    loadError = err.message;
  }
  const rows = result?.rows || [];
  const flash = flashFor(firstParam(raw.flash));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.partners.title')}</h1>
          <p className="u-micro mt-1 max-w-[75ch] text-ink-45">{t('admin.partners.lead')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/partenaires/agents" className={BUTTON}>{t('admin.partners.agentReferrals')}</Link>
          <Link href="/admin/liens" className={BUTTON}>{t('admin.partners.linkBuilder')}</Link>
          {canManage && !showForm ? (
            <Link href={buildHref(PATH, params, { new: '1' })} className={BUTTON_PRIMARY}>
              {t('admin.partners.new')}
            </Link>
          ) : null}
        </div>
      </div>

      {flash ? (
        <p className={`u-micro-strong rounded-lg px-3.5 py-2.5 ${flash.tone === 'success' ? 'bg-success-tint text-success' : 'bg-danger-tint text-danger'}`} role={flash.tone === 'success' ? 'status' : 'alert'}>
          {t(flash.key)}
        </p>
      ) : null}

      {showForm ? (
        <form action={createPartnerAction} className="u-card grid gap-3 rounded-card bg-surface p-4 sm:grid-cols-2">
          <h2 className="u-title-card text-ink sm:col-span-2">{t('admin.partners.new')}</h2>
          <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
            {t('admin.partners.form.kind')}
            <select name="kind" defaultValue="creator" className={INPUT}>
              <option value="creator">{t('admin.partners.types.creatorOne')}</option>
              <option value="campaign">{t('admin.partners.types.campaignOne')}</option>
            </select>
          </label>
          <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
            {t('admin.partners.form.name')}
            <input name="name" required maxLength={160} className={INPUT} placeholder="Nadia" />
          </label>
          <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
            {t('admin.partners.form.handle')}
            <input name="handle" maxLength={120} className={INPUT} placeholder="@nadia.kin" />
          </label>
          <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
            {t('admin.partners.form.code')}
            <input name="code" maxLength={14} className={`${INPUT} uppercase`} placeholder="NADIA01" />
            <span className="u-micro font-normal text-ink-45">{t('admin.partners.form.codeHint')}</span>
          </label>
          <FeeFields t={t} />
          <label className="u-micro-strong flex flex-col gap-1 text-ink-70 sm:col-span-2">
            {t('admin.partners.form.notes')}
            <textarea name="notes" maxLength={2000} rows={2} className={`${INPUT} h-auto py-2`} />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className={BUTTON_PRIMARY}>{t('admin.partners.form.create')}</button>
            <Link href={buildHref(PATH, params)} className={BUTTON}>{t('common.actions.cancel')}</Link>
          </div>
        </form>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-2" aria-label={t('admin.partners.title')}>
          {TYPES.map((entry) => (
            <Link
              key={entry.key}
              href={buildHref(PATH, params, { type: entry.key === 'createurs' ? '' : entry.key, page: '' })}
              aria-current={entry.key === type.key ? 'page' : undefined}
              className={`u-micro-strong rounded-full border px-3.5 py-1.5 ${entry.key === type.key ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line text-ink-70 hover:bg-canvas-alt'}`}
            >
              {t(entry.labelKey)}
            </Link>
          ))}
        </nav>
        <nav className="flex flex-wrap gap-1.5" aria-label={t('admin.partners.period')}>
          {CLICK_PERIODS.map((p) => (
            <Link
              key={p.key}
              href={buildHref(PATH, params, { periode: p.key === '30' ? '' : p.key, page: '' })}
              aria-current={p.key === period.key ? 'page' : undefined}
              className={`u-micro-strong rounded-full px-3 py-1 ${p.key === period.key ? 'bg-ink text-white' : 'text-ink-70 hover:bg-canvas-alt'}`}
            >
              {p.days ? t('admin.partners.days', { n: p.days }) : t('admin.partners.allTime')}
            </Link>
          ))}
        </nav>
      </div>

      <form action={PATH} className="flex max-w-md gap-2">
        {params.type ? <input type="hidden" name="type" value={params.type} /> : null}
        {params.periode ? <input type="hidden" name="periode" value={params.periode} /> : null}
        <input name="q" defaultValue={q} placeholder={t('admin.partners.search')} className={INPUT} />
        <button type="submit" className={BUTTON}>{t('admin.partners.searchButton')}</button>
      </form>

      {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}
      {result && !result.available ? <ErrorNote>{t('admin.partners.unavailable')}</ErrorNote> : null}

      {result?.available ? (
        <TableFrame
          minWidth="68rem"
          footer={<Pagination pathname={PATH} params={params} total={result.total} page={page} pageSize={pageSize} />}
        >
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.partners.col.partner')}</th>
              <th className={TH_NUM}>{t('admin.partners.col.clicks')}</th>
              <th className={TH_NUM}>{t('admin.partners.col.visitors')}</th>
              <th className={TH_NUM}>{t('admin.partners.col.viewers')}</th>
              <th className={TH_NUM}>{t('admin.partners.col.listingViews')}</th>
              <th className={TH_NUM}>{t('admin.partners.col.whatsapp')}</th>
              <th className={TH_NUM}>{t('admin.partners.col.accounts')}</th>
              <th className={TH_NUM}>{t('admin.partners.col.verified')}</th>
              <th className={TH_NUM}>{t('admin.partners.col.cost')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={9}>{type.kind === 'agent' ? t('admin.partners.emptyAgents') : t('admin.partners.empty')}</EmptyRow>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id} className={TR_DENSE}>
                <td className={TD_DENSE}>
                  <Link href={`${PATH}/${row.id}`} className="font-semibold text-blue-deep hover:underline">
                    {row.kind === 'agent' ? row.agencyName || row.name : row.name}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1.5 text-ink-45">
                    <span className="u-ref">{row.code}</span>
                    {row.handle ? <span>{row.handle}</span> : null}
                    {row.status !== 'active' ? <Chip tone="neutral">{t('admin.partners.inactive')}</Chip> : null}
                  </div>
                </td>
                <td className={TD_NUM}>{frNumber(row.clicks)}</td>
                <td className={TD_NUM}>{frNumber(row.visitors)}</td>
                <td className={TD_NUM}>{frNumber(row.viewers)}</td>
                <td className={TD_NUM}>{frNumber(row.listingViews)}</td>
                <td className={TD_NUM}>{frNumber(row.whatsappTaps)}</td>
                <td className={`${TD_NUM} font-bold text-ink`}>{frNumber(row.accounts)}</td>
                <td className={TD_NUM}>{frNumber(row.verified)}</td>
                <td className={TD_NUM}>{formatCost(row.costPerAccount) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      ) : null}

      <p className="u-micro max-w-[80ch] text-ink-45">{t('admin.partners.definitions')}</p>
    </div>
  );
}
