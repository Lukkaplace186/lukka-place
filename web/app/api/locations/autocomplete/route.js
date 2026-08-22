import { NextResponse } from 'next/server';
import { getPopularCommunes } from '@/lib/listings';
import { searchGazetteer, defaultCommuneOrder } from '@/lib/gazetteer';

const MAX_RESULTS = 8;

/**
 * GET /api/locations/autocomplete?q=...
 *
 * Two data sources, merged:
 *  - lib/gazetteer.js: real commune/quartier/landmark names, searched
 *    in-memory (a few hundred short strings, sub-millisecond).
 *  - lib/listings.js's getPopularCommunes(): real approved-listing counts
 *    per commune, from Postgres.
 *
 * Real counts are attached to commune suggestions only — there is no
 * per-quartier or per-landmark count in the data (quartier is free-text on
 * `properties`, landmarks aren't tracked against listings at all), and
 * inventing one would break the no-fabricated-data rule the rest of this
 * app follows. A quartier/landmark suggestion is still a real place; it can
 * legitimately route to zero results, and /listings' own empty state
 * already handles that honestly (real popular-commune fallbacks, not a
 * dead end).
 *
 * The commune-count query is cached for 60s in module scope — this runs on
 * every keystroke from every visitor, and commune listing counts change on
 * the order of "a new listing got approved", not per second.
 */
let communeCountsCache = null;
let communeCountsCachedAt = 0;
const COMMUNE_COUNTS_TTL_MS = 60_000;

async function getCommuneCountMap() {
  const now = Date.now();
  if (communeCountsCache && now - communeCountsCachedAt < COMMUNE_COUNTS_TTL_MS) {
    return communeCountsCache;
  }
  const rows = await getPopularCommunes(24);
  communeCountsCache = new Map(rows.map((r) => [r.commune, r.count]));
  communeCountsCachedAt = now;
  return communeCountsCache;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') || '').trim();

  const counts = await getCommuneCountMap();

  if (!q) {
    // Empty/focused state: real communes, ranked by real listing count when
    // any commune has one, falling back to the curated default order when
    // none do (true today — see the known gap in web/CLAUDE.md: no approved
    // listing currently carries a commune tag).
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([commune]) => commune);
    const order = ranked.length > 0 ? ranked : defaultCommuneOrder();
    const results = order.slice(0, MAX_RESULTS).map((commune) => ({
      type: 'commune',
      label: commune,
      commune,
      count: counts.get(commune) ?? null,
    }));
    return NextResponse.json({ results });
  }

  const matches = searchGazetteer(q, MAX_RESULTS);
  const results = matches.map((m) => ({
    type: m.type,
    label: m.label,
    commune: m.commune,
    count: m.type === 'commune' ? (counts.get(m.commune) ?? null) : null,
  }));

  return NextResponse.json({ results });
}
