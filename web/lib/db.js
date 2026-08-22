import 'server-only';
import { Pool } from 'pg';

/**
 * Server-only Supabase Postgres connection.
 *
 * The `server-only` import above makes any accidental import of this module
 * from a 'use client' component a build error, not just a code-review miss —
 * these credentials must never reach the browser (see CLAUDE.md's Security
 * section: this app currently relies on query-time filtering, not Row Level
 * Security, to keep pending/unapproved listings private).
 *
 * Same TLS posture as lukka-place-engine/services/postgres.js: Supabase's
 * pooler terminates TLS with a cert chain Node doesn't always have locally
 * trusted, so the connection is encrypted but not chain-verified.
 */
let pool = null;

export function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.DB_HOST,
      port: Number.parseInt(process.env.DB_PORT, 10) || 5432,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}
