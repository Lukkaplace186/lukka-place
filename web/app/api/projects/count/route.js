import { NextResponse } from 'next/server';
import { countProjectsInBounds } from '@/lib/developments';
import { parseBounds } from '@/lib/mapViewport';

/**
 * How many public projects sit inside a map box — the /listings map's
 * "N projets neufs ici" chip. A count only: off-plan projects never become
 * pins on the listings map (they have their own map at /projets). Reads the
 * public gate through lib/developments.js, cached a minute there.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const { bounds, error } = parseBounds(searchParams);
  if (error || !bounds) return NextResponse.json({ error: error || 'bounds required' }, { status: 400 });
  try {
    return NextResponse.json({ count: await countProjectsInBounds(bounds) });
  } catch (err) {
    console.error(`[api/projects/count] ${err.message}`);
    return NextResponse.json({ count: 0 });
  }
}
