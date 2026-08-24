#!/usr/bin/env node
/**
 * scripts/backfill-embeddings.js
 *
 * One-off backfill for rows written before services/postgres.js's
 * syncListingToPostgres started generating embeddings automatically (see
 * scripts/setup-pgvector.js + services/embeddings.js). Every listing synced
 * from here on gets a real embedding as part of its normal publish; this
 * script only exists to catch up the ones that already existed, and to
 * retry any row where the automatic generation failed (network/API error —
 * see the isolated try/catch in syncListingToPostgres).
 *
 * Safe by default, same convention as web/scripts/geocode-listings.js:
 *   node scripts/backfill-embeddings.js            # dry run — logs input text, calls nothing, writes nothing
 *   node scripts/backfill-embeddings.js --write     # real OpenAI calls + real UPDATEs
 */
require('dotenv').config();

const { Pool } = require('pg');
const { generateEmbedding } = require('../services/embeddings');
const pgvector = require('pgvector');

async function main() {
  const write = process.argv.includes('--write');

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
  });

  console.log(`Connected to ${process.env.DB_HOST}/${process.env.DB_NAME}`);

  try {
    // Real fields only — the same shape buildTitle/buildAddress/
    // buildDescription (services/postgres.js) already expect, read directly
    // off the live properties/property_contents rows rather than the
    // pre-sync services/db.js row shape (that row no longer exists once a
    // listing's already in Postgres; these are the same real values,
    // post-sync).
    const { rows } = await pool.query(`
      SELECT p.id, p.price, pc.title, pc.address, pc.description
      FROM properties p
      JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
      WHERE p.embedding IS NULL
      ORDER BY p.id
    `);

    console.log(`\n${rows.length} row(s) missing an embedding.${write ? '' : ' (dry run — no API calls, nothing written)'}\n`);

    for (const row of rows) {
      // Already-synthesized real title/address/description (post-sync) —
      // same three real fields buildEmbeddingInput concatenates, just read
      // back from Postgres instead of rebuilt from the pre-sync row shape.
      const input = [row.title, row.address, row.description].filter(Boolean).join(' ');
      console.log(`--- Property #${row.id} ---`);
      console.log(`Input: ${input.slice(0, 120)}${input.length > 120 ? '…' : ''}`);

      if (!write) {
        console.log('');
        continue;
      }

      try {
        const embedding = await generateEmbedding(input);
        await pool.query('UPDATE properties SET embedding = $1::vector WHERE id = $2', [
          pgvector.toSql(embedding),
          row.id,
        ]);
        console.log(`  -> WRITTEN (${embedding.length} dimensions).`);
      } catch (err) {
        console.error(`  -> FAILED: ${err.message}`);
      }
      console.log('');
    }

    console.log(write ? 'Backfill complete.' : 'Dry run complete. No rows were written.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('backfill-embeddings failed:', err);
  process.exit(1);
});
