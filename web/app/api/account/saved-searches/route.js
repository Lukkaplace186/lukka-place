import { NextResponse } from 'next/server';
import {
  getCurrentCustomerId,
  listSavedSearches,
  addSavedSearch,
  removeSavedSearch,
} from '@/lib/customers';
import { customerUnauthorized } from '@/lib/customerApiResponse';
import { MAX_SAVED_SEARCHES } from '@/lib/accountLimits';

/**
 * Authenticated saved-search CRUD, backing accountFavorites.js. `href` isn't
 * stored — every saved search's page is /listings, so it's synthesized from
 * `query` on the way out, matching the shape localFavorites.js's entries
 * already carry (`{query, label, href, savedAt}`).
 */

export async function GET() {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return customerUnauthorized();

  const rows = await listSavedSearches(customerId);
  const searches = rows.map((r) => ({
    query: r.query,
    label: r.label,
    href: `/listings?${r.query}`,
    savedAt: r.created_at,
  }));
  return NextResponse.json({ searches });
}

export async function POST(request) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return customerUnauthorized();

  const body = await request.json().catch(() => ({}));
  const query = String(body.query || '').trim();
  const label = String(body.label || '').trim();
  if (!query || !label) return NextResponse.json({ error: 'invalid search' }, { status: 400 });

  const status = await addSavedSearch(customerId, { query, label });
  if (status === 'limit') {
    return NextResponse.json({ error: 'limit', max: MAX_SAVED_SEARCHES }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(request) {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return customerUnauthorized();

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');
  if (!query) return NextResponse.json({ error: 'invalid query' }, { status: 400 });

  await removeSavedSearch(customerId, query);
  return NextResponse.json({ ok: true });
}
