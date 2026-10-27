import 'server-only';
import { getPool } from './db';
import { sendWhatsAppMessage } from './adminApi';
import { ensureAgentPartnerCode } from './partners';
import { partnerLinks } from './partnerRules';
import { SITE_URL } from './constants';

/**
 * The one-time WhatsApp telling each verified agent about the referral
 * programme (growth plan item 16). Pressed from /admin/partenaires/agents by
 * the owner; each agent is told once (`partner_program_announcements`,
 * written whether the send was accepted or not, so a refused number is not
 * retried on every press — the console lists the refusals).
 *
 * A SESSION message: it reaches an agent who wrote to the business number in
 * the last 24 hours, and is accepted-but-never-delivered for the others. The
 * console says "accepted", never "received". French whatever the console
 * language: agents read it.
 */

export const ANNOUNCE_BATCH = 100;

export function announcementText({ firstName, inviteLink }) {
  return [
    `Bonjour${firstName ? ` ${firstName}` : ''} !`,
    '',
    'Nouveau sur Lukka Place : gagnez *1 $ pour chaque client* qui crée son compte avec votre lien et l’utilise (il enregistre un bien, crée une alerte ou demande une visite dans les 14 jours).',
    '',
    `Votre lien d’invitation : ${inviteLink}`,
    'Les biens que vous partagez depuis Lukka Place portent déjà votre code.',
    '',
    `Suivez vos parrainages dans votre espace : ${SITE_URL}/compte/agent`,
  ].join('\n');
}

export const ANNOUNCE_TARGETS_SQL = `
  SELECT a.id, a.phone, ai.first_name
    FROM agents a
    LEFT JOIN LATERAL (SELECT first_name FROM agent_infos WHERE agent_id = a.id ORDER BY language_id LIMIT 1) ai ON TRUE
   WHERE a.status = 1 AND a.deleted_at IS NULL AND a.phone_verified_at IS NOT NULL
     AND COALESCE((to_jsonb(a) ->> 'is_test')::boolean, false) = false
     AND NOT EXISTS (SELECT 1 FROM partner_program_announcements pa WHERE pa.agent_id = a.id)
   ORDER BY a.id
   LIMIT $1
`;

/** @returns {Promise<{available: boolean, accepted: number, refused: number, remaining: number}>} */
export async function announceReferralProgram() {
  const pool = getPool();
  let targets;
  try {
    ({ rows: targets } = await pool.query(ANNOUNCE_TARGETS_SQL, [ANNOUNCE_BATCH]));
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') return { available: false, accepted: 0, refused: 0, remaining: 0 };
    throw err;
  }
  let accepted = 0;
  let refused = 0;
  for (const agent of targets) {
    const code = await ensureAgentPartnerCode(agent.id);
    const digits = String(agent.phone || '').replace(/\D/g, '');
    if (!code || !digits) continue;
    let ok = false;
    let error = null;
    try {
      await sendWhatsAppMessage(digits, announcementText({
        firstName: agent.first_name ? String(agent.first_name).trim().split(/\s+/)[0] : null,
        inviteLink: partnerLinks(code, { siteUrl: SITE_URL }).invite,
      }));
      ok = true;
    } catch (err) {
      error = String(err.message || err).slice(0, 300);
    }
    await pool.query(
      `INSERT INTO partner_program_announcements (agent_id, accepted, error) VALUES ($1, $2, $3)
       ON CONFLICT (agent_id) DO NOTHING`,
      [agent.id, ok, error],
    );
    if (ok) accepted += 1;
    else refused += 1;
  }
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM (${ANNOUNCE_TARGETS_SQL}) t`, [100000]);
  return { available: true, accepted, refused, remaining: Number(rows[0]?.n || 0) };
}
