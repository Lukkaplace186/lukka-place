'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n/client';
import { EmptyRow, TD_DENSE, TD_DENSE_RIGHT, TH_STICKY, TH_STICKY_RIGHT, TR_DENSE, TableFrame } from '../../table/TableFrame';
import { endAgencyAssignmentsAction } from '../actions';
import UnassignButton from './UnassignButton';

/** The agencies this rep looks after, through their assigned agents, each removable at once. */
export default function RepAgencies({ repId, rows, canUnassign }) {
  const t = useT();
  return (
    <TableFrame minWidth="36rem">
      <thead>
        <tr>
          <th className={TH_STICKY}>{t('admin.agencies.colAgency')}</th>
          <th className={TH_STICKY_RIGHT}>{t('admin.sales.agencies.colAgents')}</th>
          <th className={TH_STICKY_RIGHT}>{t('admin.sales.colLive')}</th>
          {canUnassign ? <th className={TH_STICKY} aria-label={t('admin.table.moreActions')} /> : null}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <EmptyRow colSpan={canUnassign ? 4 : 3}>{t('admin.sales.agencies.empty')}</EmptyRow>
        ) : rows.map((agency) => (
          <tr key={agency.id} className={TR_DENSE}>
            <td className={TD_DENSE}>
              <Link href={`/admin/agencies/${agency.id}`} className="font-semibold text-ink hover:text-blue-deep hover:underline">{agency.name}</Link>
            </td>
            <td className={TD_DENSE_RIGHT}>{agency.agents}</td>
            <td className={TD_DENSE_RIGHT}>{agency.live_listings}</td>
            {canUnassign ? (
              <td className={TD_DENSE}>
                <UnassignButton
                  title={agency.name}
                  body={t('admin.sales.agencies.unassignBody', { count: agency.agents })}
                  action={() => endAgencyAssignmentsAction(repId, agency.id)}
                />
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </TableFrame>
  );
}
