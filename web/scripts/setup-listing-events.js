#!/usr/bin/env node
/**
 * web/scripts/setup-listing-events.js
 *
 * The storage behind the save-funnel events (`listing_saved` /
 * `listing_unsaved`, written by app/api/track/route.js), plus the `price`
 * dimension on the two tables that already existed.
 *
 * No migration framework exists in this repo — same one-off-script pattern
 * as setup-analytics-dimensions.js and setup-search-alerts.js. Idempotent
 * (CREATE TABLE / ADD COLUMN / CREATE INDEX, all IF NOT EXISTS), so it is
 * safe to re-run, including against a database where it has already run.
 *
 * WHY A THIRD TABLE RATHER THAN A ROW IN whatsapp_clicks
 * A save and an enquiry are different funnel steps. lib/analytics.js's
 * getWhatsAppConversionRate divides whatsapp_clicks by listing page views
 * and reports it as the click-to-WhatsApp rate; folding saves into that
 * table would inflate the one number this dashboard exists to get right.
 *
 * WHY BOTH SAVE AND UNSAVE ARE ROWS
 * The obvious shape — one row per favorite, deleted on unsave — cannot
 * answer "how many people saved this and then changed their mind", which is
 * the more interesting half. Two rows with an `event` discriminator keeps
 * both facts. It also means this table is an append-only event log and
 * never the source of truth for what a customer currently has saved; that
 * is `customer_favorites`, unchanged and untouched by this script.
 *
 * NOTHING IS BACKFILLED. No save event was ever recorded before this ran,
 * and deriving fake ones from `customer_favorites.created_at` would invent
 * a device, a source and a price nobody observed.
 *
 * Usage: node web/scripts/setup-listing-events.js
 * Reads web/.env.local (DB_*).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

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
    // No FK to properties(id): this is an event log, and a listing that is
    // later hard-deleted must not take the record of people having saved it
    // with it. `listing_id` is a bigint matching properties.id for joins.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS listing_events (
        id          bigserial PRIMARY KEY,
        event       text NOT NULL,
        listing_id  bigint NOT NULL,
        commune     text,
        price       numeric,
        device      text,
        source      text,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    console.log('listing_events ensured');

    await pool.query('CREATE INDEX IF NOT EXISTS listing_events_event_idx ON listing_events (event)');
    await pool.query('CREATE INDEX IF NOT EXISTS listing_events_listing_idx ON listing_events (listing_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS listing_events_created_at_idx ON listing_events (created_at)');
    console.log('listing_events indexes ensured');

    // The price at the moment of the event. Nullable and never backfilled:
    // every whatsapp_clicks row written before this has no observed price,
    // and joining today's properties.price onto a click from three weeks ago
    // would assert a figure the visitor never saw.
    await pool.query('ALTER TABLE whatsapp_clicks ADD COLUMN IF NOT EXISTS price numeric');
    console.log('whatsapp_clicks.price ensured');

    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM listing_events) AS events,
         (SELECT count(*)::int FROM whatsapp_clicks) AS clicks,
         (SELECT count(*)::int FROM whatsapp_clicks WHERE price IS NULL) AS clicks_without_price`,
    );
    console.log(
      `listing_events: ${rows[0].events} rows · whatsapp_clicks: ${rows[0].clicks} rows, `
        + `${rows[0].clicks_without_price} predate the price column (they stay NULL)`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
