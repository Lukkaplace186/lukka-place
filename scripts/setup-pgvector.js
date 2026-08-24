#!/usr/bin/env node
/**
 * scripts/setup-pgvector.js
 *
 * One-off schema setup for semantic search groundwork: enables the pgvector
 * extension (confirmed available on this Supabase project — v0.8.0, via
 * `pg_available_extensions` — but not installed) and adds the `embedding`
 * column + an HNSW index to `properties`.
 *
 * This is groundwork only — no query path uses `embedding` yet. It exists so
 * `services/postgres.js`'s `syncListingToPostgres` can start writing a real
 * embedding on every new/updated listing from today, well ahead of the
 * volume (100k+ listings, target) where semantic search actually changes
 * results over the existing exact/fuzzy filters.
 *
 * 1536 dimensions: `text-embedding-3-small`, OpenAI's cost-efficient
 * embedding model — ample for property-listing text, and half the
 * storage/index cost of `text-embedding-3-large` (3072-dim) for no
 * real-world benefit at this content length.
 *
 * HNSW, not IVFFlat: HNSW builds incrementally and needs no retraining as
 * the table grows from today's 17 rows toward 100k+; IVFFlat needs a
 * representative sample at `lists`-tuning time, which this table doesn't
 * have yet and wouldn't be able to hold steady while still tiny. `vector_
 * cosine_ops` matches OpenAI's own recommended similarity metric for these
 * embeddings.
 *
 * Every statement is idempotent (IF NOT EXISTS) — safe to re-run.
 *
 * Usage:
 *   node scripts/setup-pgvector.js
 */
require('dotenv').config();

const { Pool } = require('pg');

const STATEMENTS = [
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `ALTER TABLE properties ADD COLUMN IF NOT EXISTS embedding vector(1536)`,
  `CREATE INDEX IF NOT EXISTS properties_embedding_hnsw_idx
     ON properties USING hnsw (embedding vector_cosine_ops)`,
];

async function main() {
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
    for (const statement of STATEMENTS) {
      await pool.query(statement);
      console.log('OK:', statement.trim().split('\n')[0]);
    }
    console.log('\npgvector groundwork complete.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('setup-pgvector failed:', err);
  process.exit(1);
});
