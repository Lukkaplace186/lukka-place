import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { buildHref, firstParam, parsePage } from '@/lib/adminPagination';
import { listAgentLedger, listCredits } from '@/lib/referralCredits';
import { ACTIVATION_WINDOW_DAYS, HOLD_DAYS, REFERRAL_CREDIT } from '@/lib/referralRules';
import { frNumber } from '@/lib/format';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { Chip, ErrorNote, formatKinshasa } from '../../LeadRoutingUI';
import Pagination from '../../table/Pagination';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../../table/TableFrame';
import { BUTTON, BUTTON_PRIMARY, INPUT } from '../../sales/styles';
import {
  announceProgramAction, approveCreditsAction, payCreditsAction, syncCreditsAction, voidCreditAction,
} from './actions';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Parrainages agents — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

const PATH = '/admin/partenaires/agents';

const CREDIT_TABS = [
  { key: 'approvable', labelKey: 'admin.referrals.tabs.approvable' },
  { key: 'holding', labelKey: 'admin.referrals.tabs.holding' },
  { key: 'approved', labelKey: 'admin.referrals.tabs.approved' },
  { key: 'paid', labelKey: 'admin.referrals.tabs.paid' },
  { key: 'void', labelKey: 'admin.referrals.tabs.void' },
  { key: 'clawback', labelKey: 'admin.referrals.tabs.clawback' },
];

const STATUS_TONE = { pending: 'warning', approved: 'blue', paid: 'success', void: 'neutral' };

const FLASH = {
  synced: 'success', approved: 'success', paid: 'success', voided: 'success', clawback_flagged: 'success',
  announced: 'success', failed: 'danger', reason: 'danger', pick: 'danger', unavailable: 'danger',
};

const TH_NUM = `${TH_STICKY} text-right`;
const TD_NUM = `${TD_DENSE} u-tabular text-right`;
const usd = (value) => `${frNumber(value)} $`;

/**
 * Who brought whom, and the agents' $1 credits (growth plan items 13–17).
 * Reading is partners.view; running, approving, paying and voiding are
 * partners.payout (owner, finance); announcing the programme is the owner's.
 * Flags are facts for a person — none of them voids anything.
 */
export default async function AdminAgentReferralsPage({ searchParams }) {
  const t = await getT();
  const raw = (await searchParams) || {};
  const q = String(firstParam(raw.q) || '').trim().slice(0, 80);
  const tab = CREDIT_TABS.find((entry) => entry.key === firstParam(raw.credits)) || CREDIT_TABS[0];
  const partnerFilter = Number.parseInt(firstParam(raw.agent), 10);
  const { page, pageSize, limit, offset } = parsePage(raw);
  const params = {
    q: q || undefined,
    credits: tab.key === 'approvable' ? undefined : tab.key,
    agent: Number.isSafeInteger(partnerFilter) ? String(partnerFilter) : undefined,
    page: page > 1 ? String(page) : undefined,
    size: pageSize === 25 ? undefined : String(pageSize),
  };
  const returnTo = buildHref(PATH, params);
  const session = await getAdminSession();
  const canPay = can(session?.role, 'partners.payout');
  const canAnnounce = can(session?.role, 'partners.manage');

  let ledger = null;
  let credits = [];
  let loadError = null;
  try {
    [ledger, credits] = await Promise.all([
      listAgentLedger({ q: q || null, limit, offset }),
      listCredits({ partnerId: Number.isSafeInteger(partnerFilter) ? partnerFilter : null, status: tab.key, limit: 100 }),
    ]);
  } catch (err) {
    loadError = err.message;
  }
  const flashKey = firstParam(raw.flash);
  const flashTone = FLASH[flashKey];
  const flashVars = { n: frNumber(Number(firstParam(raw.n) || 0)), refused: frNumber(Number(firstParam(raw.refused) || 0)), left: frNumber(Number(firstParam(raw.left) || 0)) };

  return (
    <div className="flex flex-col gap-5">
      <Link href="/admin/partenaires?type=agents" className="u-micro-strong inline-flex items-center gap-1 text-ink-70 hover:text-ink">
        <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {t('admin.partners.title')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{t('admin.referrals.title')}</h1>
          <p className="u-micro mt-1 max-w-[80ch] text-ink-45">
            {t('admin.referrals.lead', { amount: usd(REFERRAL_CREDIT.amount), days: ACTIVATION_WINDOW_DAYS, hold: HOLD_DAYS })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`${PATH}/export`} className={BUTTON}>{t('admin.referrals.export')}</a>
          {canPay ? (
            <form action={syncCreditsAction}>
              <input type="hidden" name="return_to" value={returnTo} />
              <button type="submit" className={BUTTON}>{t('admin.referrals.sync')}</button>
            </form>
          ) : null}
          {canAnnounce ? (
            <form action={announceProgramAction}>
              <input type="hidden" name="return_to" value={returnTo} />
              <button type="submit" className={BUTTON}>{t('admin.referrals.announce')}</button>
            </form>
          ) : null}
        </div>
      </div>

      {flashTone ? (
        <p className={`u-micro-strong rounded-lg px-3.5 py-2.5 ${flashTone === 'success' ? 'bg-success-tint text-success' : 'bg-danger-tint text-danger'}`} role={flashTone === 'success' ? 'status' : 'alert'}>
          {t(`admin.referrals.flash.${flashKey}`, flashVars)}
        </p>
      ) : null}
      {loadError ? <ErrorNote>{loadError}</ErrorNote> : null}
      {ledger && !ledger.available ? <ErrorNote>{t('admin.referrals.unavailable')}</ErrorNote> : null}

      <form action={PATH} className="flex max-w-md gap-2">
        <input name="q" defaultValue={q} placeholder={t('admin.referrals.search')} className={INPUT} />
        <button type="submit" className={BUTTON}>{t('admin.partners.searchButton')}</button>
      </form>

      {ledger?.available ? (
        <form action={payCreditsAction} className="flex flex-col gap-3">
          <input type="hidden" name="return_to" value={returnTo} />
          <TableFrame
            minWidth="70rem"
            footer={<Pagination pathname={PATH} params={params} total={ledger.total} page={page} pageSize={pageSize} />}
          >
            <thead>
              <tr>
                {canPay ? <th className={TH_STICKY}><span className="sr-only">{t('admin.referrals.select')}</span></th> : null}
                <th className={TH_STICKY}>{t('admin.referrals.col.agent')}</th>
                <th className={TH_NUM}>{t('admin.referrals.col.accounts')}</th>
                <th className={TH_NUM}>{t('admin.referrals.col.activated')}</th>
                <th className={TH_NUM}>{t('admin.referrals.col.holding')}</th>
                <th className={TH_NUM}>{t('admin.referrals.col.approvable')}</th>
                <th className={TH_NUM}>{t('admin.referrals.col.approved')}</th>
                <th className={TH_NUM}>{t('admin.referrals.col.paid')}</th>
                <th className={TH_STICKY}>{t('admin.referrals.col.flags')}</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.length === 0 ? <EmptyRow colSpan={canPay ? 9 : 8}>{t('admin.referrals.empty')}</EmptyRow> : null}
              {ledger.rows.map((row) => (
                <tr key={row.partnerId} className={TR_DENSE}>
                  {canPay ? (
                    <td className={TD_DENSE}>
                      <input type="checkbox" name="partner_id" value={row.partnerId} aria-label={row.name} className="h-4 w-4" />
                    </td>
                  ) : null}
                  <td className={TD_DENSE}>
                    <Link href={`/admin/partenaires/${row.partnerId}`} className="font-semibold text-blue-deep hover:underline">{row.name}</Link>
                    <div className="flex items-center gap-2 text-ink-45">
                      <span className="u-ref">{row.code}</span>
                      <Link href={buildHref(PATH, params, { agent: String(row.partnerId) })} className="hover:underline">
                        {t('admin.referrals.seeCredits')}
                      </Link>
                    </div>
                  </td>
                  <td className={TD_NUM}>{frNumber(row.accounts)}</td>
                  <td className={TD_NUM}>{frNumber(row.activated)}</td>
                  <td className={TD_NUM}>{frNumber(row.holding)}</td>
                  <td className={`${TD_NUM} font-bold text-ink`}>{frNumber(row.approvable)}</td>
                  <td className={TD_NUM}>{usd(row.amounts.approved)}</td>
                  <td className={TD_NUM}>{usd(row.amounts.paid)}</td>
                  <td className={TD_DENSE}>
                    <div className="flex flex-wrap gap-1">
                      {row.flags.map((flag) => <Chip key={flag} tone="warning">{t(`admin.referrals.flags.${flag}`)}</Chip>)}
                      {row.clawback ? <Chip tone="danger">{t('admin.referrals.flags.clawback', { n: row.clawback })}</Chip> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>

          {canPay ? (
            <div className="u-card flex flex-wrap items-end gap-2 rounded-card bg-surface p-3">
              <button type="submit" formAction={approveCreditsAction} className={BUTTON}>{t('admin.referrals.approve')}</button>
              <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
                {t('admin.referrals.method')}
                <select name="method" defaultValue="mobile_money" className={INPUT}>
                  <option value="mobile_money">{t('admin.referrals.methods.mobile_money')}</option>
                  <option value="cash">{t('admin.referrals.methods.cash')}</option>
                  <option value="bank">{t('admin.referrals.methods.bank')}</option>
                </select>
              </label>
              <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
                {t('admin.referrals.reference')}
                <input name="reference" maxLength={120} placeholder="M-Pesa …" className={INPUT} />
              </label>
              <button type="submit" className={BUTTON_PRIMARY}>{t('admin.referrals.pay')}</button>
              <p className="u-micro w-full text-ink-45">{t('admin.referrals.bulkHint', { hold: HOLD_DAYS })}</p>
            </div>
          ) : null}
        </form>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="u-title-section text-ink">{t('admin.referrals.creditsTitle')}</h2>
        <nav className="flex flex-wrap gap-2" aria-label={t('admin.referrals.creditsTitle')}>
          {CREDIT_TABS.map((entry) => (
            <Link
              key={entry.key}
              href={buildHref(PATH, params, { credits: entry.key === 'approvable' ? '' : entry.key })}
              aria-current={entry.key === tab.key ? 'page' : undefined}
              className={`u-micro-strong rounded-full border px-3.5 py-1.5 ${entry.key === tab.key ? 'border-blue bg-blue-tint text-blue-deep' : 'border-line text-ink-70 hover:bg-canvas-alt'}`}
            >
              {t(entry.labelKey)}
            </Link>
          ))}
          {params.agent ? (
            <Link href={buildHref(PATH, params, { agent: '' })} className="u-micro-strong rounded-full border border-line px-3.5 py-1.5 text-ink-70">
              {t('admin.referrals.allAgents')}
            </Link>
          ) : null}
        </nav>
        <TableFrame minWidth="60rem">
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.referrals.cr.customer')}</th>
              <th className={TH_STICKY}>{t('admin.referrals.cr.agent')}</th>
              <th className={TH_STICKY}>{t('admin.referrals.cr.activation')}</th>
              <th className={TH_STICKY}>{t('admin.referrals.cr.status')}</th>
              <th className={TH_STICKY}>{t('admin.referrals.cr.dates')}</th>
              {canPay ? <th className={TH_STICKY} /> : null}
            </tr>
          </thead>
          <tbody>
            {credits.length === 0 ? <EmptyRow colSpan={canPay ? 6 : 5}>{t('admin.referrals.noCredits')}</EmptyRow> : null}
            {credits.map((credit) => (
              <tr key={credit.id} className={TR_DENSE}>
                <td className={TD_DENSE}>
                  <Link href={`/admin/customers/${credit.accountId}`} className="font-semibold text-blue-deep hover:underline">
                    {credit.firstName || `#${credit.accountId}`}
                  </Link>
                </td>
                <td className={TD_DENSE}><span className="u-ref">{credit.code}</span></td>
                <td className={TD_DENSE}>{credit.activation ? t(`admin.referrals.activation.${credit.activation}`) : '—'}</td>
                <td className={TD_DENSE}>
                  <Chip tone={STATUS_TONE[credit.status] || 'neutral'}>{t(`admin.referrals.status.${credit.status}`)}</Chip>
                  {credit.voidReason ? <div className="mt-0.5 text-ink-45">{credit.voidReason.startsWith('auto:') ? t(`admin.referrals.auto.${credit.voidReason.slice(5)}`) : credit.voidReason}</div> : null}
                  {credit.clawbackFlaggedAt ? <div className="mt-0.5"><Chip tone="danger">{t('admin.referrals.flags.clawbackOne')}</Chip></div> : null}
                </td>
                <td className={`${TD_DENSE} whitespace-nowrap`}>
                  <div>{t('admin.referrals.cr.qualified', { date: formatKinshasa(credit.qualifiedAt) })}</div>
                  {credit.status === 'pending' ? <div className="text-ink-45">{t('admin.referrals.cr.approvableAt', { date: formatKinshasa(credit.approvableAt) })}</div> : null}
                  {credit.paidAt ? <div className="text-ink-45">{t('admin.referrals.cr.paidAt', { date: formatKinshasa(credit.paidAt) })}</div> : null}
                </td>
                {canPay ? (
                  <td className={TD_DENSE}>
                    {credit.status !== 'void' ? (
                      <form action={voidCreditAction} className="flex gap-1.5">
                        <input type="hidden" name="return_to" value={returnTo} />
                        <input type="hidden" name="credit_id" value={credit.id} />
                        <input name="reason" required minLength={5} maxLength={300} placeholder={t('admin.referrals.voidReason')} className={`${INPUT} w-40`} />
                        <button type="submit" className={BUTTON}>{credit.status === 'paid' ? t('admin.referrals.flagClawback') : t('admin.referrals.void')}</button>
                      </form>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </TableFrame>
      </section>
    </div>
  );
}
