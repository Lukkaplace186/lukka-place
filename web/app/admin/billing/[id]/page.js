import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getMembershipReceipt, receiptNumber } from '@/lib/adminBilling';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { getT } from '@/lib/i18n/server';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';

function day(value) {
  return value ? new Date(value).toLocaleDateString('fr-FR', { timeZone: 'UTC' }) : '—';
}

/**
 * A printable payment receipt for one ledger row.
 *
 * Built only from what the team recorded when the plan was assigned: the
 * amount, currency, method and reference on `memberships`. It is a receipt for
 * a recorded payment, and says so — not a tax invoice (no tax registration,
 * VAT or legal address is held anywhere to print one), and not proof that money
 * reached a bank, since there is no gateway to confirm it. A trial, or a row
 * with no amount, gets no receipt at all rather than a receipt for nothing.
 */
export default async function MembershipReceiptPage({ params }) {
  const t = await getT();
  const { id } = await params;
  const membership = await getMembershipReceipt(id);
  if (!membership) notFound();

  const amount = Number(membership.price);
  const payable = !membership.is_trial && Number.isFinite(amount) && amount > 0;
  const currency = membership.currency || membership.currency_symbol || '';
  const formattedAmount = `${amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`.trim();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/admin/billing" className="u-micro-strong inline-flex items-center gap-1.5 text-ink-45 hover:text-ink">
          <ArrowLeft strokeWidth={ICON_STROKE_WIDTH} className="h-4 w-4" />
          {t('admin.receipt.back')}
        </Link>
        {payable ? <PrintButton label={t('admin.receipt.print')} /> : null}
      </div>

      {!payable ? (
        <div className="u-card rounded-card bg-surface p-6">
          <h1 className="u-title-section text-ink">{t('admin.receipt.unavailableTitle')}</h1>
          <p className="u-micro mt-2 text-ink-70">{membership.is_trial ? t('admin.receipt.trial') : t('admin.receipt.noAmount')}</p>
        </div>
      ) : (
        <article className="u-card flex flex-col rounded-card bg-surface p-8 print:rounded-none print:p-0 print:shadow-none">
          <header className="flex flex-wrap items-start justify-between gap-6 border-b border-line pb-6">
            <div>
              <div className="text-[1.3125rem] font-bold tracking-[-0.008em] text-ink">
                Lukka <span className="text-blue-deep">{t('admin.chrome.brandSuffix')}</span>
              </div>
              <div className="u-micro text-ink-45">lukkaplace.com</div>
            </div>
            <div className="text-right">
              <h1 className="u-title-section text-ink">{t('admin.receipt.title')}</h1>
              <div className="u-micro u-tabular mt-1 text-ink-70">{t('admin.receipt.number', { number: receiptNumber(membership) })}</div>
              <div className="u-micro text-ink-45">{t('admin.receipt.recordedOn', { date: day(membership.created_at) })}</div>
            </div>
          </header>

          <section className="grid gap-6 border-b border-line py-6 sm:grid-cols-2">
            <div>
              <div className="u-eyebrow text-ink-45">{t('admin.receipt.receivedFrom')}</div>
              <div className="u-micro-strong mt-1 text-ink">{membership.agency_name || `#${membership.vendor_id}`}</div>
              {membership.agency_email ? <div className="u-micro text-ink-70">{membership.agency_email}</div> : null}
              {membership.agency_phone ? <div className="u-micro u-tabular text-ink-70">+{membership.agency_phone}</div> : null}
            </div>
            <dl className="u-micro grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 self-start text-ink-70">
              <dt className="text-ink-45">{t('admin.receipt.method')}</dt>
              <dd>{membership.payment_method || '—'}</dd>
              <dt className="text-ink-45">{t('admin.receipt.reference')}</dt>
              <dd className="u-tabular break-all">{membership.transaction_id || '—'}</dd>
              <dt className="text-ink-45">{t('admin.receipt.planStatus')}</dt>
              <dd>{membership.status === 1 ? t('admin.receipt.statusActive') : t('admin.receipt.statusCancelled')}</dd>
            </dl>
          </section>

          <div className="overflow-x-auto">
            <table className="u-micro w-full border-collapse">
              <thead>
                <tr className="border-b border-line text-left text-ink-45">
                  <th className="py-3 pr-4 font-semibold">{t('admin.receipt.description')}</th>
                  <th className="py-3 pr-4 font-semibold">{t('admin.receipt.period')}</th>
                  <th className="py-3 text-right font-semibold">{t('admin.receipt.amount')}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line text-ink">
                  <td className="py-3 pr-4">
                    {membership.package_title || '—'}
                    {membership.package_term ? <span className="text-ink-45"> · {membership.package_term}</span> : null}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-4">{day(membership.start_date)} → {day(membership.expire_date)}</td>
                  <td className="u-tabular whitespace-nowrap py-3 text-right">{formattedAmount}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} className="u-micro-strong py-3 pr-4 text-right text-ink">{t('admin.receipt.total')}</td>
                  <td className="u-tabular whitespace-nowrap py-3 text-right text-[1.0625rem] font-bold text-ink">{formattedAmount}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="u-micro mt-6 border-t border-line pt-4 text-ink-45">{t('admin.receipt.note')}</p>
        </article>
      )}
    </div>
  );
}
