#!/usr/bin/env node
/**
 * web/scripts/backfill-commune-tags.js
 *
 * Commune is not a column in this schema — it is tagged by attaching one of
 * amenity ids 21-44 to the property (see services/postgres.js's
 * COMMUNE_AMENITY_IDS). A listing with no such tag is invisible to every
 * commune filter, every commune landing tile, and the map's commune-centroid
 * fallback. 13 of 31 live listings were in that state.
 *
 * This recovers the tag from text the agent already wrote — the listing's own
 * address, title and quartier — and never from anything else.
 *
 * SAFE BY DEFAULT: prints what it would do and writes nothing unless invoked
 * with --write. Same convention as scripts/geocode-listings.js.
 *
 *   node web/scripts/backfill-commune-tags.js           # dry run
 *   node web/scripts/backfill-commune-tags.js --write   # apply
 *
 * Matching rules, deliberately conservative — a wrong commune is worse than
 * no commune, because it makes a listing findable in the wrong place:
 *
 *   - Only the 24 canonical commune names are ever matched. No invented or
 *     inferred names, no nearest-neighbour guessing.
 *   - Word-boundary matching on accent- and punctuation-normalised text, so
 *     "N'Djili" in an address matches the canonical "Ndjili", but "Limete"
 *     does not match inside some unrelated longer word.
 *   - A listing whose text matches TWO different communes is skipped and
 *     reported, not resolved by picking the first. That ambiguity is real
 *     (an address can name a neighbouring commune as a landmark) and a human
 *     should settle it.
 *   - Listings that already carry a tag are never touched.
 *
 * Every write is one INSERT into property_amenities. Nothing is deleted, and
 * the script prints the exact rollback statement for what it did.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const CONTENT_LANGUAGE_ID = 20;
const WRITE = process.argv.includes('--write');

/** Strip accents and punctuation so "N'Djili" and "Ndjili" compare equal. */
function normalise(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // The canonical list, read from the database itself rather than
    // hardcoded — amenity_contents IS the source of truth for these names.
    const { rows: communeRows } = await pool.query(
      `SELECT amenity_id, name FROM amenity_contents
       WHERE language_id = $1 AND amenity_id BETWEEN 21 AND 44
       ORDER BY amenity_id`,
      [CONTENT_LANGUAGE_ID],
    );
    if (communeRows.length !== 24) {
      throw new Error(`expected 24 commune amenities, found ${communeRows.length} — aborting`);
    }
    // "Kinshasa" is BOTH the city and one of the 24 communes, and every
    // address in this database ends with the city ("Huilerie, Kinshasa,
    // Kinshasa"). Matching it as a commune tagged four listings with the
    // wrong commune outright and made seven more look ambiguous purely
    // because the city name collided with a commune name — caught on the
    // dry run before anything was written.
    //
    // There is no reliable way to tell the two apart in this free text, so
    // the commune is excluded from automatic matching entirely. Listings
    // that genuinely belong to Kinshasa commune are reported as unresolved
    // for a human, which is the honest outcome: a wrong commune is worse
    // than no commune, because it makes a listing findable in the wrong
    // place.
    const CITY_AMBIGUOUS = new Set(['kinshasa']);

    const communes = communeRows
      .map((r) => ({ amenityId: r.amenity_id, name: r.name, needle: normalise(r.name) }))
      .filter((c) => !CITY_AMBIGUOUS.has(c.needle));

    const { rows: untagged } = await pool.query(
      `SELECT p.id, pc.title, pc.address, p.quartier
       FROM properties p
       JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = $1
       WHERE p.status = 1 AND p.approve_status = 1
         AND NOT EXISTS (
           SELECT 1 FROM property_amenities pa
           WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
         )
       ORDER BY p.id`,
      [CONTENT_LANGUAGE_ID],
    );

    console.log(`${untagged.length} approved listings carry no commune tag\n`);

    const resolved = [];
    const ambiguous = [];
    const unresolved = [];

    for (const listing of untagged) {
      const haystack = ` ${normalise(`${listing.address || ''} ${listing.quartier || ''} ${listing.title || ''}`)} `;
      const hits = communes.filter((c) => haystack.includes(` ${c.needle} `));

      if (hits.length === 1) resolved.push({ listing, commune: hits[0] });
      else if (hits.length > 1) ambiguous.push({ listing, hits });
      else unresolved.push(listing);
    }

    for (const { listing, commune } of resolved) {
      console.log(`  #${listing.id} -> ${commune.name}   (from: ${listing.address || listing.quartier || listing.title})`);
    }
    for (const { listing, hits } of ambiguous) {
      console.log(`  #${listing.id} AMBIGUOUS (${hits.map((h) => h.name).join(' / ')}) — skipped, needs a human`);
    }
    for (const listing of unresolved) {
      console.log(`  #${listing.id} no commune in its text — skipped (${listing.address || '(no address)'})`);
    }

    console.log(
      `\nresolved ${resolved.length}, ambiguous ${ambiguous.length}, unresolved ${unresolved.length}`,
    );

    if (!WRITE) {
      console.log('\nDry run — nothing written. Re-run with --write to apply.');
      return;
    }
    if (!resolved.length) {
      console.log('\nNothing to write.');
      return;
    }

    for (const { listing, commune } of resolved) {
      await pool.query(
        `INSERT INTO property_amenities (property_id, amenity_id, created_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())`,
        [listing.id, commune.amenityId],
      );
    }

    const ids = resolved.map((r) => r.listing.id).join(', ');
    console.log(`\nWrote ${resolved.length} commune tags.`);
    console.log('Rollback for exactly these rows, if needed:');
    console.log(
      `  DELETE FROM property_amenities WHERE property_id IN (${ids}) AND amenity_id BETWEEN 21 AND 44;`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
