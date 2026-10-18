import { getPool } from '@/lib/db';

/**
 * Customer ratings of agents ("Notez l'agent", 1–5 stars after a visit).
 *
 * Written only by the engine (services/agentReviews.js), from a customer whose
 * visit really happened — one rating per viewing request, never an open form.
 * This module only reads, for the public profile and the moderation console.
 *
 * A rating is about the AGENT, never the property: it is shown on the agent's
 * own page, not on a listing.
 *
 * Shared with the engine — change one, change the other (verify-pipeline §51
 * reads this line).
 */
export const MIN_PUBLIC_REVIEWS = 5;

/** How many approved comments the public profile shows. */
export const PUBLIC_COMMENTS_LIMIT = 6;

/**
 * Average and count, rounded for display. Null below MIN_PUBLIC_REVIEWS: an
 * average of two ratings is one customer's mood, and a page that prints it
 * invites the agent's friends to fill the rest.
 */
export function publicRatingSummary(row) {
  const count = Number(row?.review_count) || 0;
  const average = Number(row?.average_stars);
  if (count < MIN_PUBLIC_REVIEWS || !Number.isFinite(average)) return null;
  return { count, average: Math.round(average * 10) / 10 };
}

/** "4,7" in French, "4.7" in English. */
export function formatAverage(average, locale = 'fr') {
  return new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(average);
}

export const AGENT_RATING_SQL = `
  SELECT COUNT(*)::int AS review_count, AVG(stars)::float AS average_stars
    FROM agent_reviews
   WHERE agent_id = $1`;

export const AGENT_COMMENTS_SQL = `
  SELECT id, stars, comment, created_at
    FROM agent_reviews
   WHERE agent_id = $1 AND comment_status = 'APPROVED' AND comment IS NOT NULL
   ORDER BY created_at DESC
   LIMIT $2`;

/**
 * The agent's public rating, or null (too few reviews, or the table does not
 * exist yet). Never throws: a profile page must not fail over its stars.
 */
export async function getAgentPublicRating(agentId) {
  const id = Number.parseInt(agentId, 10);
  if (!Number.isFinite(id)) return null;
  try {
    const pool = getPool();
    const { rows } = await pool.query(AGENT_RATING_SQL, [id]);
    const summary = publicRatingSummary(rows[0]);
    if (!summary) return null;
    const { rows: comments } = await pool.query(AGENT_COMMENTS_SQL, [id, PUBLIC_COMMENTS_LIMIT]);
    return { ...summary, comments };
  } catch (err) {
    if (err?.code !== '42P01') console.error(`[agentReviews] rating for agent ${id} unavailable: ${err.message}`);
    return null;
  }
}
