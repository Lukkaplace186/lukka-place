import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { recordAudit } from '@/lib/adminAudit';
import { listCredits } from '@/lib/referralCredits';

export const dynamic = 'force-dynamic';

const COLUMNS = ['credit_id', 'agent_code', 'agent_id', 'customer_id', 'customer_first_name', 'activation', 'status',
  'amount', 'currency', 'qualified_at', 'approvable_at', 'approved_at', 'paid_at', 'void_reason', 'clawback_flagged_at'];

/** A formula-safe CSV cell (same rule as /admin/export). */
function cell(value) {
  if (value == null) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Every agent referral credit as CSV (up to 10,000 rows), for the payout run
 * and the books. partners.payout: it is money. Audited. Customers appear by id
 * and first name only.
 */
export async function GET() {
  const session = await getAdminSession();
  if (!session || !can(session.role, 'partners.payout')) return new NextResponse('Forbidden', { status: 403 });
  const credits = await listCredits({ status: null, limit: 10000 });
  const lines = [COLUMNS.join(',')];
  for (const c of credits) {
    lines.push([
      c.id, c.code, c.agentId, c.accountId, c.firstName, c.activation, c.status, c.amount, c.currency,
      c.qualifiedAt, c.approvableAt, c.approvedAt, c.paidAt, c.voidReason, c.clawbackFlaggedAt,
    ].map(cell).join(','));
  }
  await recordAudit(session, { action: 'referrals.export', details: { rows: credits.length } });
  return new NextResponse(`﻿${lines.join('\n')}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="parrainages-agents.csv"',
      'Cache-Control': 'private, no-store',
    },
  });
}
