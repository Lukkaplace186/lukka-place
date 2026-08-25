import 'server-only';
import { getPool } from './db';
import { DEFAULT_CDF_PER_USD, DEFAULT_RATE_UPDATED_AT } from './currency';

/**
 * Admin-editable, still explicitly non-live — see web/CLAUDE.md: "a static
 * figure that's honestly labeled as an estimate is more truthful than one
 * that looks live but silently goes stale." This only moves *where* the
 * number comes from (an admin-editable `exchange_rates` table instead of a
 * hardcoded constant); the honesty framing everywhere it's displayed — "≈",
 * a dated tooltip, never presented as a live feed — is unchanged.
 *
 * Always reads the single most recent row, same "one current value, admin
 * can change it" shape lib/cms.js's editable content already uses. Never
 * throws — an unreachable DB falls back to the last known-good hardcoded
 * default rather than breaking every price display on the site.
 *
 * @returns {Promise<{cdfPerUsd: number, updatedAt: string}>}
 */
export async function getCdfRate() {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT cdf_per_usd, updated_at FROM exchange_rates ORDER BY updated_at DESC LIMIT 1',
    );
    if (!rows[0]) return { cdfPerUsd: DEFAULT_CDF_PER_USD, updatedAt: DEFAULT_RATE_UPDATED_AT };
    return {
      cdfPerUsd: Number(rows[0].cdf_per_usd),
      updatedAt: new Date(rows[0].updated_at).toISOString().slice(0, 10),
    };
  } catch (error) {
    console.warn('[currencyRate] falling back to the default rate:', error.message);
    return { cdfPerUsd: DEFAULT_CDF_PER_USD, updatedAt: DEFAULT_RATE_UPDATED_AT };
  }
}

/**
 * Admin CMS action's write path (web/app/admin/cms/actions.js). Always
 * inserts a new row rather than updating in place — same append-only
 * "history of what the rate was and when" shape as never overwriting a
 * lead's own status transition; getCdfRate() always reads the latest one.
 */
export async function setCdfRate(cdfPerUsd, updatedBy) {
  const pool = getPool();
  await pool.query('INSERT INTO exchange_rates (cdf_per_usd, updated_by) VALUES ($1, $2)', [
    cdfPerUsd,
    updatedBy || null,
  ]);
}
