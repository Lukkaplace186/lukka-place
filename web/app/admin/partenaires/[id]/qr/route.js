import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getAdminSession } from '@/lib/adminSession';
import { can } from '@/lib/adminRoles';
import { getPool } from '@/lib/db';
import { partnerLinks } from '@/lib/partnerRules';
import { SITE_URL } from '@/lib/constants';

export const dynamic = 'force-dynamic';

/**
 * A partner's QR code as a file: `?format=svg` (default) or `png` (1024 px).
 * It encodes /go/<code>?src=qr, so scans are counted apart from link taps.
 * Same access as the partner page (partners.view).
 */
export async function GET(request, { params }) {
  const session = await getAdminSession();
  if (!session || !can(session.role, 'partners.view')) return new NextResponse('Forbidden', { status: 403 });
  const { id } = await params;
  const partnerId = Number.parseInt(id, 10);
  if (!Number.isSafeInteger(partnerId) || partnerId <= 0) return new NextResponse('Not found', { status: 404 });

  let code = null;
  try {
    const { rows } = await getPool().query('SELECT code FROM partners WHERE id = $1', [partnerId]);
    code = rows[0]?.code ?? null;
  } catch {
    code = null;
  }
  if (!code) return new NextResponse('Not found', { status: 404 });

  const link = partnerLinks(code, { siteUrl: SITE_URL }).qr;
  const format = new URL(request.url).searchParams.get('format') === 'png' ? 'png' : 'svg';
  const headers = {
    'Content-Disposition': `attachment; filename="lukka-place-${code}.${format}"`,
    'Cache-Control': 'private, no-store',
  };
  if (format === 'png') {
    const png = await QRCode.toBuffer(link, { type: 'png', margin: 2, width: 1024, errorCorrectionLevel: 'M' });
    return new NextResponse(png, { status: 200, headers: { ...headers, 'Content-Type': 'image/png' } });
  }
  const svg = await QRCode.toString(link, { type: 'svg', margin: 2, errorCorrectionLevel: 'M', width: 1024 });
  return new NextResponse(svg, { status: 200, headers: { ...headers, 'Content-Type': 'image/svg+xml; charset=utf-8' } });
}
