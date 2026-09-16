import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { getPool } from '@/lib/db';
import { referralLink } from '@/lib/salesReferral';

export const dynamic = 'force-dynamic';

/**
 * A rep's referral QR code as a file: `?format=svg` (default, sharp at any
 * print size) or `png` (1024 px, for WhatsApp and phones). It encodes
 * /r/<code>?src=qr, so scans are counted apart from link taps.
 *
 * Same access as the rep page: `sales.view`, and a `sales` user only for the
 * rep linked to their own console account (a 404 otherwise, like the page).
 */
export async function GET(request, { params }) {
  const session = await getAdminSession();
  if (!session || !can(session.role, 'sales.view')) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const { id } = await params;
  const repId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(repId) || repId <= 0) return new NextResponse('Not found', { status: 404 });

  const { rows } = await getPool().query('SELECT id, referral_code, admin_user_id FROM sales_reps WHERE id = $1', [repId]);
  const rep = rows[0];
  if (!rep?.referral_code) return new NextResponse('Not found', { status: 404 });
  if (session.role === 'sales' && Number(rep.admin_user_id) !== Number(session.id)) {
    return new NextResponse('Not found', { status: 404 });
  }

  const link = referralLink(rep.referral_code, { qr: true });
  const format = new URL(request.url).searchParams.get('format') === 'png' ? 'png' : 'svg';
  const filename = `lukka-place-${rep.referral_code}.${format}`;
  const headers = {
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
  };

  if (format === 'png') {
    const png = await QRCode.toBuffer(link, { type: 'png', margin: 2, width: 1024, errorCorrectionLevel: 'M' });
    return new NextResponse(png, { status: 200, headers: { ...headers, 'Content-Type': 'image/png' } });
  }
  const svg = await QRCode.toString(link, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', width: 1024 });
  return new NextResponse(svg, { status: 200, headers: { ...headers, 'Content-Type': 'image/svg+xml; charset=utf-8' } });
}
