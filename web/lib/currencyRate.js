import 'server-only';
import { getPool } from './db';
import { getDailyRate } from './exchangeRate';
import { DEFAULT_CDF_PER_USD, DEFAULT_RATE_UPDATED_AT } from './currency';

/**
 * The single entry point every pricing surface reads the USD->CDF rate
 * through. Two sources feed it, in this precedence:
 *
 *   1. An admin's manual entry (`exchange_rates`, set from /admin/cms) —
 *      but only if it is at least as recent as the live feed's own publish
 *      date. A human deliberately correcting today's number outranks the
 *      feed; a figure someone typed three weeks ago does not.
 *   2. The live daily feed (lib/exchangeRate.js), day-cached in memory.
 *   3. The dated hardcoded constant, if both are unavailable.
 *
 * This is the change from the previous "admin-editable, explicitly non-live"
 * arrangement: the number is now genuinely live by default, so the copy that
 * described it as manually maintained had to change with it (see
 * components/CurrencyBridge.js — web/CLAUDE.md required exactly that if this
 * ever moved to a real feed). What has NOT changed is the honesty framing:
 * it is still marked "≈" with its real date, still never presented as a
 * dealing rate, and the date shown is always the date the displayed figure
 * actually comes from.
 *
 * Never throws — an unreachable DB or a dead FX API falls back rather than
 * breaking every price on the site.
 *
 * @returns {Promise<{cdfPerUsd: number, updatedAt: string}>}
 */
export async function getCdfRate() {
  const [manual, live] = await Promise.all([readManualRate(), getDailyRate()]);

  if (manual && (!live || manual.updatedAt >= live.date)) return manual;
  if (live) return { cdfPerUsd: live.rate, updatedAt: live.date };
  return { cdfPerUsd: DEFAULT_CDF_PER_USD, updatedAt: DEFAULT_RATE_UPDATED_AT };
}

/**
 * Latest admin-entered rate, or null if there isn't one / the DB is
 * unreachable. Null rather than the hardcoded default on purpose: the
 * caller has a better source to try before giving up on both.
 */
async function readManualRate() {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT cdf_per_usd, updated_at FROM exchange_rates ORDER BY updated_at DESC LIMIT 1',
    );
    if (!rows[0]) return null;
    return {
      cdfPerUsd: Number(rows[0].cdf_per_usd),
      updatedAt: new Date(rows[0].updated_at).toISOString().slice(0, 10),
    };
  } catch (error) {
    console.warn('[currencyRate] manual rate unavailable:', error.message);
    return null;
  }
}

/**
 * Admin CMS action's write path (web/app/admin/cms/actions.js). Always
 * inserts a new row rather than updating in place — same append-only
 * "history of what the rate was and when" shape as never overwriting a
 * lead's own status transition; getCdfRate() always reads the latest one.
 *
 * Note the consequence of the precedence rule above: an entry made here
 * outranks the live feed only for the rest of that UTC day, then the feed
 * takes over again. That is the intended behaviour — a manual entry is a
 * correction, not a permanent pin.
 */
export async function setCdfRate(cdfPerUsd, updatedBy) {
  const pool = getPool();
  await pool.query('INSERT INTO exchange_rates (cdf_per_usd, updated_by) VALUES ($1, $2)', [
    cdfPerUsd,
    updatedBy || null,
  ]);
}
