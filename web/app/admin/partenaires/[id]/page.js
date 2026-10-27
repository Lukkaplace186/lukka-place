import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getT } from '@/lib/i18n/server';
import { can } from '@/lib/adminRoles';
import { getAdminSession } from '@/lib/adminSession';
import { buildHref, firstParam } from '@/lib/adminPagination';
import { CLICK_PERIODS, parseClickPeriod } from '@/lib/analytics';
import { getPartnerDailyClicks, getPartnerFunnel, listPartnerConversions } from '@/lib/partnersAdmin';
import { partnerLinks } from '@/lib/partnerRules';
import { qrSvg } from '@/lib/marketing/printSheetData';
import { SITE_URL, ICON_STROKE_WIDTH } from '@/lib/constants';
import { frNumber } from '@/lib/format';
import { Chip, ErrorNote, Stat, formatKinshasa } from '../../LeadRoutingUI';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE, TableFrame } from '../../table/TableFrame';
import { BUTTON, BUTTON_PRIMARY, INPUT } from '../../sales/styles';
import { setPartnerStatusAction, updatePartnerAction } from '../actions';
import { FeeFields, flashFor, formatCost } from '../partnerUi';
import PartnerToolkit from './PartnerToolkit';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Partenaire — Admin — Lukka Place',
  robots: { index: false, follow: false },
};

/** Three or more accounts from one connection is shown for review — a fact, never a verdict. */
const SAME_CONNECTION_FLAG = 3;

const KIND_KEYS = {
  creator: 'admin.partners.types.creatorOne',
  campaign: 'admin.partners.types.campaignOne',
  agent: 'admin.partners.types.agentOne',
};

function pct(part, whole) {
  return whole > 0 ? `${Math.round((part / whole) * 100)} %` : null;
}

/**
 * One partner: their links and QR code, the funnel for the period, clicks per
 * day, and the accounts they brought (with a same-connection count for
 * review). An agent partner links to the agent's own console page.
 */
export default async function AdminPartnerPage({ params, searchParams }) {
  const t = await getT();
  const { id } = await params;
  const raw = (await searchParams) || {};
  const period = parseClickPeriod(raw.periode);
  const path = `/admin/partenaires/${id}`;

  const partner = await getPartnerFunnel(id, { days: period.days });
  if (!partner) notFound();

  const session = await getAdminSession();
  const canManage = can(session?.role, 'partners.manage');
  const [conversions, daily, qr] = await Promise.all([
    listPartnerConversions(partner.id, { limit: 100 }).catch((err) => ({ error: err.message, rows: [], total: 0 })),
    getPartnerDailyClicks(partner.id, { days: 30 }).catch(() => []),
    qrSvg(partnerLinks(partner.code, { siteUrl: SITE_URL }).qr).catch(() => null),
  ]);
  const flash = flashFor(firstParam(raw.flash));
  const maxDaily = Math.max(1, ...daily.map((d) => d.clicks));
  const title = partner.kind === 'agent' ? partner.agencyName || partner.name : partner.name;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/admin/partenaires" className="u-micro-strong inline-flex items-center gap-1 text-ink-70 hover:text-ink">
        <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
        {t('admin.partners.title')}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="u-title-page text-ink">{title}</h1>
          <div className="u-micro mt-1 flex flex-wrap items-center gap-2 text-ink-45">
            <Chip tone="blue">{t(KIND_KEYS[partner.kind])}</Chip>
            {partner.handle ? <span>{partner.handle}</span> : null}
            {partner.status !== 'active' ? <Chip tone="neutral">{t('admin.partners.inactive')}</Chip> : null}
            {partner.agentId ? (
              <Link href={`/admin/agents/${partner.agentId}`} className="font-semibold text-blue-deep hover:underline">
                {t('admin.partners.agentProfile')}
              </Link>
            ) : null}
          </div>
        </div>
        {canManage ? (
          <form action={setPartnerStatusAction}>
            <input type="hidden" name="id" value={partner.id} />
            <input type="hidden" name="status" value={partner.status === 'active' ? 'inactive' : 'active'} />
            <button type="submit" className={BUTTON}>
              {partner.status === 'active' ? t('admin.partners.deactivate') : t('admin.partners.activate')}
            </button>
          </form>
        ) : null}
      </div>

      {flash ? (
        <p className={`u-micro-strong rounded-lg px-3.5 py-2.5 ${flash.tone === 'success' ? 'bg-success-tint text-success' : 'bg-danger-tint text-danger'}`} role={flash.tone === 'success' ? 'status' : 'alert'}>
          {t(flash.key)}
        </p>
      ) : null}

      <PartnerToolkit partnerId={partner.id} code={partner.code} siteUrl={SITE_URL} qrSvg={qr} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="u-title-section text-ink">{t('admin.partners.funnel')}</h2>
        <nav className="flex flex-wrap gap-1.5" aria-label={t('admin.partners.period')}>
          {CLICK_PERIODS.map((p) => (
            <Link
              key={p.key}
              href={buildHref(path, {}, { periode: p.key === '30' ? '' : p.key })}
              aria-current={p.key === period.key ? 'page' : undefined}
              className={`u-micro-strong rounded-full px-3 py-1 ${p.key === period.key ? 'bg-ink text-white' : 'text-ink-70 hover:bg-canvas-alt'}`}
            >
              {p.days ? t('admin.partners.days', { n: p.days }) : t('admin.partners.allTime')}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-[repeat(7,minmax(0,1fr))]">
        <Stat label={t('admin.partners.col.clicks')} value={frNumber(partner.clicks)} />
        <Stat label={t('admin.partners.col.visitors')} value={frNumber(partner.visitors)} />
        <Stat label={t('admin.partners.col.viewers')} value={frNumber(partner.viewers)} hint={pct(partner.viewers, partner.visitors)} />
        <Stat label={t('admin.partners.col.whatsapp')} value={frNumber(partner.whatsappTaps)} />
        <Stat label={t('admin.partners.col.accounts')} value={frNumber(partner.accounts)} hint={pct(partner.accounts, partner.visitors)} />
        <Stat label={t('admin.partners.col.verified')} value={frNumber(partner.verified)} hint={pct(partner.verified, partner.accounts)} />
        <Stat
          label={t('admin.partners.col.cost')}
          value={formatCost(partner.costPerAccount) || '—'}
          hint={partner.fee ? null : t('admin.partners.noFee')}
        />
      </div>
      <p className="u-micro max-w-[80ch] text-ink-45">{t('admin.partners.definitions')}</p>

      <section className="flex flex-col gap-2">
        <h2 className="u-title-card text-ink">{t('admin.partners.daily')}</h2>
        {daily.length === 0 ? (
          <p className="u-micro text-ink-45">{t('admin.partners.noClicks')}</p>
        ) : (
          <ol className="flex h-28 items-end gap-1 rounded-card border border-line bg-surface p-3" aria-label={t('admin.partners.daily')}>
            {daily.map((d) => (
              <li key={d.day} className="flex flex-1 flex-col items-center justify-end" title={`${d.day} : ${d.clicks}`}>
                <span className="w-full rounded-t bg-blue" style={{ height: `${Math.max(4, (d.clicks / maxDaily) * 80)}px` }} />
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="u-title-card text-ink">
          {t('admin.partners.accounts')} <span className="u-tabular text-ink-45">({frNumber(conversions.total)})</span>
        </h2>
        {conversions.error ? <ErrorNote>{conversions.error}</ErrorNote> : null}
        <TableFrame minWidth="44rem">
          <thead>
            <tr>
              <th className={TH_STICKY}>{t('admin.partners.acc.account')}</th>
              <th className={TH_STICKY}>{t('admin.partners.acc.type')}</th>
              <th className={TH_STICKY}>{t('admin.partners.acc.verified')}</th>
              <th className={TH_STICKY}>{t('admin.partners.acc.via')}</th>
              <th className={TH_STICKY}>{t('admin.partners.acc.date')}</th>
            </tr>
          </thead>
          <tbody>
            {conversions.rows.length === 0 ? <EmptyRow colSpan={5}>{t('admin.partners.acc.empty')}</EmptyRow> : null}
            {conversions.rows.map((row) => (
              <tr key={row.id} className={TR_DENSE}>
                <td className={TD_DENSE}>
                  <Link
                    href={row.accountType === 'agent' ? `/admin/agents/${row.accountId}` : `/admin/customers/${row.accountId}`}
                    className="font-semibold text-blue-deep hover:underline"
                  >
                    {row.name || `#${row.accountId}`}
                  </Link>
                  {row.sameConnection >= SAME_CONNECTION_FLAG ? (
                    <div className="mt-0.5"><Chip tone="warning">{t('admin.partners.acc.sameConnection', { n: row.sameConnection })}</Chip></div>
                  ) : null}
                </td>
                <td className={TD_DENSE}>{row.accountType === 'agent' ? t('admin.partners.acc.agent') : t('admin.partners.acc.customer')}</td>
                <td className={TD_DENSE}>{row.verified ? <Chip tone="success">{t('admin.partners.acc.yes')}</Chip> : <Chip tone="neutral">{t('admin.partners.acc.no')}</Chip>}</td>
                <td className={TD_DENSE}>{row.via ? t(`admin.partners.via.${row.via}`) : '—'}</td>
                <td className={`${TD_DENSE} whitespace-nowrap`}>{formatKinshasa(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      </section>

      {canManage && partner.kind !== 'agent' ? (
        <form action={updatePartnerAction} className="u-card grid gap-3 rounded-card bg-surface p-4 sm:grid-cols-2">
          <h2 className="u-title-card text-ink sm:col-span-2">{t('admin.partners.edit')}</h2>
          <input type="hidden" name="id" value={partner.id} />
          <input type="hidden" name="status" value={partner.status} />
          <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
            {t('admin.partners.form.name')}
            <input name="name" required maxLength={160} defaultValue={partner.name} className={INPUT} />
          </label>
          <label className="u-micro-strong flex flex-col gap-1 text-ink-70">
            {t('admin.partners.form.handle')}
            <input name="handle" maxLength={120} defaultValue={partner.handle || ''} className={INPUT} />
          </label>
          <FeeFields t={t} fee={partner.fee} />
          <label className="u-micro-strong flex flex-col gap-1 text-ink-70 sm:col-span-2">
            {t('admin.partners.form.notes')}
            <textarea name="notes" maxLength={2000} rows={2} defaultValue={partner.notes || ''} className={`${INPUT} h-auto py-2`} />
          </label>
          <p className="u-micro text-ink-45 sm:col-span-2">{t('admin.partners.form.codeLocked', { code: partner.code })}</p>
          <div className="sm:col-span-2">
            <button type="submit" className={BUTTON_PRIMARY}>{t('common.actions.save')}</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
