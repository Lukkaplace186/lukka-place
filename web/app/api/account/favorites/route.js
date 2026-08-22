import { NextResponse } from 'next/server';
import { getCurrentCustomerId, listFavoriteIds, addFavorite, removeFavorite } from '@/lib/customers';

/**
 * Authenticated favorites CRUD, backing accountFavorites.js. Every method
 * re-verifies the real httpOnly session server-side via getCurrentCustomerId
 * — the client-side `lukka_logged_in` flag cookie that decides whether the
 * browser even calls this route is never trusted for authorization here.
 */

export async function GET() {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const ids = await listFavoriteIds(customerId);
  return NextResponse.json({ ids });
}

export async function POST(request) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const propertyId = Number.parseInt(body.propertyId, 10);
  if (!Number.isFinite(propertyId)) {
    return NextResponse.json({ error: 'invalid propertyId' }, { status: 400 });
  }

  await addFavorite(customerId, propertyId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const propertyId = Number.parseInt(searchParams.get('propertyId'), 10);
  if (!Number.isFinite(propertyId)) {
    return NextResponse.json({ error: 'invalid propertyId' }, { status: 400 });
  }

  await removeFavorite(customerId, propertyId);
  return NextResponse.json({ ok: true });
}
