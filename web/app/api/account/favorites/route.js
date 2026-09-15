import { NextResponse } from 'next/server';
import { getCurrentCustomerId, listFavoriteIds, addFavorite, removeFavorite } from '@/lib/customers';
import { customerUnauthorized } from '@/lib/customerApiResponse';
import { MAX_FAVORITES } from '@/lib/accountLimits';

/**
 * Authenticated favorites CRUD, backing accountFavorites.js. Every method
 * re-verifies the real httpOnly session server-side via getCurrentCustomerId
 * — the client-side `lukka_logged_in` flag cookie that decides whether the
 * browser even calls this route is never trusted for authorization here.
 */

export async function GET() {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return customerUnauthorized();

  const ids = await listFavoriteIds(customerId);
  return NextResponse.json({ ids });
}

export async function POST(request) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return customerUnauthorized();

  const body = await request.json().catch(() => ({}));
  const propertyId = Number.parseInt(body.propertyId, 10);
  if (!Number.isFinite(propertyId)) {
    return NextResponse.json({ error: 'invalid propertyId' }, { status: 400 });
  }

  const status = await addFavorite(customerId, propertyId);
  if (status === 'limit') {
    return NextResponse.json({ error: 'limit', max: MAX_FAVORITES }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return customerUnauthorized();

  const { searchParams } = new URL(request.url);
  const propertyId = Number.parseInt(searchParams.get('propertyId'), 10);
  if (!Number.isFinite(propertyId)) {
    return NextResponse.json({ error: 'invalid propertyId' }, { status: 400 });
  }

  await removeFavorite(customerId, propertyId);
  return NextResponse.json({ ok: true });
}
