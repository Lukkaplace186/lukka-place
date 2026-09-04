import 'server-only';
import { getPool } from './db';

/**
 * Listing-level market data export.
 *
 * This is the foundation of the data product (selling market data to banks
 * and developers), which makes the column set a published contract rather
 * than an ad-hoc dump: consumers will build against these names. Add columns
 * freely; do not rename or repurpose an existing one without a version bump,
 * because a bank's spreadsheet will be keyed on the old name.
 *
 * The commercially interesting figure is `price_delta_pct` — the gap between
 * what a property was listed at and what it actually transacted at. Nothing
 * else in this schema captures negotiation, and no public source has it for
 * Kinshasa at all.
 *
 * Three honesty rules, since the value of this data is entirely its
 * trustworthiness:
 *
 *   - Only real columns. `days_on_market` is computed from real timestamps,
 *     not estimated; where a listing has not closed it is days-so-far and
 *     `closed_on` is empty, never a projected date.
 *   - No imputation. A missing surface area is an empty cell, not a median.
 *     `area` is TEXT and stores '0' for unknown (the schema's own
 *     convention), which is normalised to empty here so a consumer never
 *     reads "0 m²" as a real measurement.
 *   - `closed_on` is `updated_at` on a closed listing, which is the closing
 *     edit's timestamp — a good proxy, not a recorded completion date. The
 *     column comment says so, and a dedicated column would be the right fix
 *     if this data is ever sold on precision of timing.
 *
 * Unapproved listings are excluded: they were never on the market, so
 * including them would misstate both supply and time-on-market.
 */

/** The published contract. Order is the CSV column order. */
export const LISTING_EXPORT_COLUMNS = [
  'property_id',
  'reference',
  'commune',
  'quartier',
  'property_type',
  'parcelle_subtype',
  'purpose',
  'listing_status',
  'asking_price_usd',
  'sold_price_usd',
  'price_delta_usd',
  'price_delta_pct',
  'authored_currency',
  'authored_price',
  'price_period',
  'deposit_months',
  'bedrooms',
  'bathrooms',
  'area_sqm',
  'units_count',
  'listed_on',
  'closed_on',
  'days_on_market',
  'latitude',
  'longitude',
  'agent_id',
  'agent_name',
];

const EXPORT_SQL = `
  SELECT
    p.id                                            AS property_id,
    p.reference,
    (
      SELECT ac.name FROM property_amenities pa
      JOIN amenity_contents ac ON ac.amenity_id = pa.amenity_id AND ac.language_id = 20
      WHERE pa.property_id = p.id AND pa.amenity_id BETWEEN 21 AND 44
      LIMIT 1
    )                                               AS commune,
    p.quartier,
    catc.name                                       AS property_type,
    p.parcelle_subtype,
    p.purpose,
    COALESCE(p.listing_status, 'active')            AS listing_status,
    p.price                                         AS asking_price_usd,
    p.sold_price                                    AS sold_price_usd,
    CASE WHEN p.sold_price IS NOT NULL AND p.price IS NOT NULL
         THEN ROUND(p.sold_price - p.price, 2) END  AS price_delta_usd,
    CASE WHEN p.sold_price IS NOT NULL AND p.price IS NOT NULL AND p.price > 0
         THEN ROUND(((p.sold_price - p.price) / p.price) * 100, 2) END AS price_delta_pct,
    p.currency                                      AS authored_currency,
    p.price_original                                AS authored_price,
    p.price_period,
    p.deposit_months,
    p.beds                                          AS bedrooms,
    p.bath                                          AS bathrooms,
    -- '0' is this column's stored value for "unknown" (it is TEXT, not a
    -- number), so it must not leave the building as a measurement.
    NULLIF(NULLIF(p.area, '0'), '')                 AS area_sqm,
    p.units_count,
    p.created_at                                    AS listed_on,
    CASE WHEN p.listing_status = 'closed' THEN p.updated_at END AS closed_on,
    CASE WHEN p.listing_status = 'closed'
         THEN GREATEST(0, EXTRACT(DAY FROM (p.updated_at - p.created_at))::int)
         ELSE GREATEST(0, EXTRACT(DAY FROM (NOW() - p.created_at))::int)
    END                                             AS days_on_market,
    p.latitude,
    p.longitude,
    p.agent_id,
    a.username                                      AS agent_name
  FROM properties p
  LEFT JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
  LEFT JOIN property_categories cat ON cat.id = p.category_id
  LEFT JOIN property_category_contents catc ON catc.category_id = cat.id AND catc.language_id = 26
  LEFT JOIN agents a ON a.id = p.agent_id
  WHERE p.status = 1 AND p.approve_status = 1
  ORDER BY p.created_at DESC
`;

/** @returns {Promise<Array<Object>>} one row per approved listing, keyed by LISTING_EXPORT_COLUMNS. */
export async function getListingExportRows() {
  const pool = getPool();
  const { rows } = await pool.query(EXPORT_SQL);
  return rows;
}

/**
 * RFC 4180 escaping. Not optional here: this data is French, so descriptions,
 * quartiers and agency names routinely contain commas ("Yolo Sud I, Kalamu")
 * and apostrophes, and a naive join would silently shift every later column
 * on those rows — the kind of corruption a buyer finds before we do.
 */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Rows -> CSV text.
 *
 * Prefixed with a UTF-8 BOM because the intended consumer opens this in
 * Excel, which otherwise reads a UTF-8 file as the local ANSI codepage and
 * renders every accented commune name as mojibake ("Ngiri-Ngiri" survives,
 * "Kinshasa" does, but "Entrepôt" and "Réf" do not). The BOM is what makes
 * Excel switch, and it is ignored by pandas, R and every CSV library.
 */
export function toCsv(rows, columns = LISTING_EXPORT_COLUMNS) {
  const header = columns.join(',');
  const body = rows.map((row) => columns.map((col) => csvCell(row[col])).join(','));
  return `﻿${[header, ...body].join('\r\n')}\r\n`;
}
