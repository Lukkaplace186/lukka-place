import Link from 'next/link';
import { Phone } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/lib/constants';
import { communeLabel } from '@/lib/cities';
import { budgetRangeText, moveRequestBlocker } from '@/lib/moveProjectRules';
import { getT } from '@/lib/i18n/server';
import { Chip, formatKinshasa } from '../LeadRoutingUI';
import { WhatsAppLink } from '../ContactCell';
import { EmptyRow, TD_DENSE, TH_STICKY, TR_DENSE } from '../table/TableFrame';
import SendProjectButton from './SendProjectButton';

const STATUS_TONE = { active: 'blue', paused: 'neutral', found: 'success' };

/**
 * The rows of "Les projets" on /admin/move-projects (lib/moveProjectList.js):
 * who told us the move, and what they told us. The person is the customer
 * account behind the project — its stored name and number, nothing guessed;
 * no name is said as such. The WhatsApp chip opens a chat from the admin's
 * own WhatsApp (wa.me, like ContactCell) and "Appeler" is a tel: link.
 * "Envoyer aux agences" (2026-11-16) sends a project that never went, after
 * a confirmation (SendProjectButton); nothing else here sends anything.
 */
export default async function MoveProjectRows({ rows }) {
  const t = await getT();
  const reasonLabel = (r) => (r === 'autre' ? t('admin.moveProjects.otherReason') : t(`account.move.steps.reasons.options.${r}`));

  return (
    <>
      <thead>
        <tr>
          <th className={TH_STICKY}>{t('admin.moveProjects.colPerson')}</th>
          <th className={TH_STICKY}>{t('admin.moveProjects.colProject')}</th>
          <th className={TH_STICKY}>{t('admin.moveProjects.colCommunes')}</th>
          <th className={TH_STICKY}>{t('admin.moveProjects.colBudget')}</th>
          <th className={TH_STICKY}>{t('admin.moveProjects.colStatus')}</th>
          <th className={TH_STICKY}>{t('admin.moveProjects.colRequest')}</th>
          <th className={TH_STICKY}>{t('admin.moveProjects.colDates')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={7}>{t('admin.moveProjects.empty')}</EmptyRow>
        ) : rows.map((row) => {
          const budget = budgetRangeText(row.budget_min, row.budget_max, {
            between: (a, b) => t('admin.moveProjects.budgetBetween', { min: a, max: b }),
            from: (a) => t('admin.moveProjects.budgetFrom', { min: a }),
            upTo: (b) => t('admin.moveProjects.budgetUpTo', { max: b }),
          });
          const reasons = row.reasons || [];
          const communes = row.communes || [];
          // Why it cannot go yet, else null (lib/moveProjectRules.js).
          const blocker = moveRequestBlocker({ transactionType: row.transaction_type, communes, city: row.city });
          const canSend = !row.last_lead_id && row.status === 'active' && !blocker && row.phone && row.project_id != null;
          return (
            <tr key={row.project_id || `${row.customer_id}-${row.created_at}`} className={TR_DENSE}>
              <td className={TD_DENSE}>
                <Link href={`/admin/customers/${row.customer_id}`} className="block max-w-[14rem] truncate font-semibold text-ink hover:text-blue-deep hover:underline">
                  {row.full_name || <span className="font-normal italic text-ink-45">{t('admin.moveProjects.noName')}</span>}
                </Link>
                {row.phone ? (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <WhatsAppLink phone={row.phone} label={t('admin.moveProjects.whatsapp')} />
                    <a href={`tel:+${row.phone}`} className="u-micro-strong inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-ink-70 hover:border-blue hover:text-blue-deep" title={t('admin.moveProjects.call')}>
                      <Phone strokeWidth={ICON_STROKE_WIDTH} className="h-3.5 w-3.5" />
                      {t('admin.moveProjects.call')}
                    </a>
                  </div>
                ) : <span className="text-ink-45">{t('admin.moveProjects.noPhone')}</span>}
                <Link href={`/admin/move-projects?customer=${row.customer_id}#projets`} className="text-ink-45 hover:underline">#{row.customer_id}</Link>
              </td>
              <td className={TD_DENSE}>
                {row.title ? <div className="font-semibold text-ink">{row.title}</div> : null}
                <div>{reasons.length ? reasons.map(reasonLabel).join(', ') : <span className="text-ink-45">{t('admin.moveProjects.notSaid')}</span>}</div>
                {row.reason_other ? <div className="text-ink-45">« {row.reason_other} »</div> : null}
                {row.transaction_type ? <div className="text-ink-45">{t(`account.move.steps.transaction.options.${row.transaction_type}`)}</div> : null}
              </td>
              <td className={TD_DENSE}>
                {communes.length ? communes.map(communeLabel).join(', ') : row.city ? (
                  <span>{t('admin.moveProjects.wholeCity', { city: row.city })}</span>
                ) : <span className="text-ink-45">{t('admin.moveProjects.notSaid')}</span>}
              </td>
              <td className={`${TD_DENSE} u-tabular whitespace-nowrap`}>{budget || <span className="text-ink-45">{t('admin.moveProjects.notSaid')}</span>}</td>
              <td className={TD_DENSE}>
                <Chip tone={STATUS_TONE[row.status] || 'neutral'}>{t(`admin.customers.moveStatus.${row.status}`)}</Chip>
                {row.status !== 'found' && row.manual_stage ? (
                  <div className="mt-1 text-ink-45">{t('admin.moveProjects.stageSet', { stage: t(`account.move.stages.${row.manual_stage}`) })}</div>
                ) : null}
                {row.found_at ? <div className="mt-1 text-ink-45">{t('admin.moveProjects.foundOn', { date: formatKinshasa(row.found_at) })}</div> : null}
              </td>
              <td className={TD_DENSE}>
                {row.last_lead_id ? (
                  <>
                    <Link href={`/admin/leads/${row.last_lead_id}`} className="text-blue-deep hover:underline">{t('admin.moveProjects.requestN', { id: row.last_lead_id })}</Link>
                    {row.last_lead_at ? <div className="text-ink-45">{formatKinshasa(row.last_lead_at)}</div> : null}
                  </>
                ) : (
                  <>
                    <span className="text-ink-45">{t('admin.moveProjects.noRequest')}</span>
                    {canSend ? (
                      <div>
                        <SendProjectButton
                          customerId={row.customer_id}
                          projectId={row.project_id}
                          customerLabel={row.full_name || `#${row.customer_id}`}
                        />
                      </div>
                    ) : null}
                    {!row.last_lead_id && row.status === 'active' && blocker ? (
                      <div className="text-ink-45">{t(`admin.moveProjects.sendBlocked.${blocker}`)}</div>
                    ) : null}
                  </>
                )}
                {row.phone ? (
                  <Link href={`/admin/leads?wa=${encodeURIComponent(row.phone)}`} className="block text-blue-deep hover:underline">{t('admin.moveProjects.allRequests')}</Link>
                ) : null}
              </td>
              <td className={`${TD_DENSE} whitespace-nowrap`}>
                <div>{t('admin.moveProjects.created', { date: formatKinshasa(row.created_at) })}</div>
                {row.updated_at ? <div className="text-ink-45">{t('admin.moveProjects.updated', { date: formatKinshasa(row.updated_at) })}</div> : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </>
  );
}
