import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getCurrentAgentId } from '@/lib/agentSession';
import { ensureAgentPartnerCode } from '@/lib/partners';
import { partnerLinks } from '@/lib/partnerRules';
import { SITE_URL } from '@/lib/constants';

export const dynamic = 'force-dynamic';

/**
 * The signed-in agent's invite QR code (1024 px PNG) for a window sign, a
 * business card or a WhatsApp Status. It encodes their invite page
 * /i/<code>; the page counts the visit and remembers the agent
 * (app/(site)/i/[code]). The agent comes from the session only.
 */
export async function GET() {
  const agentId = await getCurrentAgentId();
  if (!agentId) return new NextResponse('Unauthorized', { status: 401 });
  const code = await ensureAgentPartnerCode(agentId);
  if (!code) return new NextResponse('Not available', { status: 503 });
  const png = await QRCode.toBuffer(partnerLinks(code, { siteUrl: SITE_URL }).invite, {
    type: 'png', margin: 2, width: 1024, errorCorrectionLevel: 'M',
  });
  return new NextResponse(png, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="lukka-place-${code}.png"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
