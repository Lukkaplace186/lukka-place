import 'server-only';
import { getPool } from './db';
import { sendWhatsAppMessage, sendWhatsAppTemplate } from './adminApi';
import { ensureAgentPartnerCode } from './partners';
import { partnerLinks } from './partnerRules';
import { SITE_URL } from './constants';
import { getReferralCampaign } from './siteSettings';

/**
 * The WhatsApp telling each verified agent about the referral programme
 * (growth plan item 16). Two ways out:
 *
 * - **The console button** (/admin/partenaires/agents, owner). Without a
 *   template it sends a SESSION message, which reaches only an agent who wrote
 *   to the business number in the last 24 hours. With
 *   `REFERRAL_ANNOUNCEMENT_TEMPLATE` set (an approved Meta template, read at
 *   call time, unset by default) it sends the template, which reaches everyone,
 *   and also re-sends ONCE to every agent whose earlier announcement went as a
 *   session message (`resent_at`), since nothing proves those arrived. A
 *   refused template falls back to the session text, like every other
 *   *_TEMPLATE here.
 * - **When the agent writes to us** (engine services/referralAnnounce.js →
 *   POST /api/internal/referral-announce): they are inside the window at that
 *   moment, so the session text lands. Sent to an agent never announced, or
 *   whose session announcement provably could not have arrived (no message
 *   from them in the 23 h before it, per the engine's `whatsapp_last_inbound`).
 *
 * One row per agent in `partner_program_announcements`, written whether the
 * send was accepted or not; `channel` says how it went (session / template /
 * on_write, NULL on rows from before the column = session). The console says
 * "accepted", never "received". French whatever the console language.
 *
 * Both ways out stop while the campaign switch is off (lib/siteSettings.js
 * getReferralCampaign, /admin/partenaires/agents): nothing is sent and nothing
 * is recorded, so turning it back on reaches the same agents as before.
 */

export const ANNOUNCE_BATCH = 100;
/** A Meta variable cannot be empty. */
export const TEMPLATE_NAME_FALLBACK = 'cher partenaire';
const WINDOW_MARGIN_MS = 23 * 60 * 60 * 1000;

export function announcementTemplateName() {
  const name = String(process.env.REFERRAL_ANNOUNCEMENT_TEMPLATE || '').trim();
  return name || null;
}

export function announcementText({ firstName, inviteLink }) {
  return [
    `Bonjour${firstName ? ` ${firstName}` : ''} !`,
    '',
    'Nouveau sur Lukka Place : gagnez *1 $ pour chaque client* qui crée son compte avec votre lien et l’utilise (il enregistre un bien, crée une alerte ou demande une visite dans les 14 jours).',
    'Vos gains sont payés toutes les deux semaines par mobile money.',
    '',
    `Votre lien d’invitation : ${inviteLink}`,
    'Les biens que vous partagez depuis Lukka Place portent déjà votre code.',
    '',
    `Suivez vos parrainages dans votre espace : ${SITE_URL}/compte/agent`,
  ].join('\n');
}

/** Body variables of the template: {{1}} first name, {{2}} the agent's code (the link is https://lukkaplace.com/i/{{2}}). */
export function announcementTemplateParams({ firstName, code }) {
  return [firstName || TEMPLATE_NAME_FALLBACK, code];
}

const AGENT_FILTER = `
  a.status = 1 AND a.deleted_at IS NULL AND a.phone_verified_at IS NOT NULL
  AND COALESCE((to_jsonb(a) ->> 'is_test')::boolean, false) = false`;

const AGENT_COLUMNS = `
  SELECT a.id, a.phone, ai.first_name
    FROM agents a
    LEFT JOIN LATERAL (SELECT first_name FROM agent_infos WHERE agent_id = a.id ORDER BY language_id LIMIT 1) ai ON TRUE`;

/** Never announced, or the send was refused. `$1` = batch size. */
export const ANNOUNCE_TARGETS_SQL = `
  ${AGENT_COLUMNS}
   WHERE ${AGENT_FILTER}
     AND NOT EXISTS (SELECT 1 FROM partner_program_announcements pa WHERE pa.agent_id = a.id AND pa.accepted)
   ORDER BY a.id
   LIMIT $1
`;

/** With a template: the above, plus one re-send to session-message announcements. `$1` = batch size. */
export const ANNOUNCE_TEMPLATE_TARGETS_SQL = `
  ${AGENT_COLUMNS}
   WHERE ${AGENT_FILTER}
     AND NOT EXISTS (
       SELECT 1 FROM partner_program_announcements pa
        WHERE pa.agent_id = a.id AND pa.accepted
          AND (pa.channel IN ('template', 'on_write') OR pa.resent_at IS NOT NULL))
   ORDER BY a.id
   LIMIT $1
`;

export const RECORD_ANNOUNCEMENT_SQL = `
  INSERT INTO partner_program_announcements (agent_id, accepted, error, channel)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (agent_id) DO UPDATE
     SET sent_at = NOW(), accepted = EXCLUDED.accepted, error = EXCLUDED.error, channel = EXCLUDED.channel,
         resent_at = CASE WHEN partner_program_announcements.accepted THEN NOW() ELSE partner_program_announcements.resent_at END
`;

function firstNameOf(agent) {
  return agent.first_name ? String(agent.first_name).trim().split(/\s+/)[0] : null;
}

/**
 * Send to one agent and record it. `useTemplate`: the template name, or null
 * for the session text.
 * @returns {Promise<{accepted: boolean, channel: string}|null>} null when the agent has no code or number
 */
async function sendTo(agent, { template, onWrite = false }) {
  const pool = getPool();
  const code = await ensureAgentPartnerCode(agent.id);
  const digits = String(agent.phone || '').replace(/\D/g, '');
  if (!code || !digits) return null;
  const firstName = firstNameOf(agent);
  let channel = onWrite ? 'on_write' : 'session';
  let ok = false;
  let error = null;
  if (template) {
    try {
      await sendWhatsAppTemplate(digits, {
        template,
        languageCode: 'fr',
        bodyParams: announcementTemplateParams({ firstName, code }),
      });
      ok = true;
      channel = 'template';
    } catch (err) {
      error = `template: ${String(err.message || err).slice(0, 250)}`;
    }
  }
  if (!ok) {
    try {
      await sendWhatsAppMessage(digits, announcementText({
        firstName,
        inviteLink: partnerLinks(code, { siteUrl: SITE_URL }).invite,
      }));
      ok = true;
      error = null;
    } catch (err) {
      error = String(err.message || err).slice(0, 300);
    }
  }
  await pool.query(RECORD_ANNOUNCEMENT_SQL, [agent.id, ok, error, channel]);
  return { accepted: ok, channel };
}

/** The console button. @returns {Promise<{available: boolean, paused?: boolean, template: string|null, accepted: number, refused: number, remaining: number}>} */
export async function announceReferralProgram() {
  const pool = getPool();
  const template = announcementTemplateName();
  if (!(await getReferralCampaign()).active) return { available: true, paused: true, template, accepted: 0, refused: 0, remaining: 0 };
  const targetsSql = template ? ANNOUNCE_TEMPLATE_TARGETS_SQL : ANNOUNCE_TARGETS_SQL;
  let targets;
  try {
    ({ rows: targets } = await pool.query(targetsSql, [ANNOUNCE_BATCH]));
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') return { available: false, template, accepted: 0, refused: 0, remaining: 0 };
    throw err;
  }
  let accepted = 0;
  let refused = 0;
  for (const agent of targets) {
    const result = await sendTo(agent, { template });
    if (!result) continue;
    if (result.accepted) accepted += 1;
    else refused += 1;
  }
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM (${targetsSql}) t`, [100000]);
  return { available: true, template, accepted, refused, remaining: Number(rows[0]?.n || 0) };
}

/**
 * Whether the agent who just wrote should get the announcement now.
 * `row`: their partner_program_announcements row or null; `previousInboundAt`:
 * their message before this one (ISO) or null when the engine never saw one.
 */
export function shouldAnnounceOnWrite(row, previousInboundAt) {
  if (!row || !row.accepted) return true;
  if (row.resent_at) return false;
  const channel = row.channel || 'session';
  if (channel !== 'session') return false;
  const sentAt = new Date(row.sent_at).getTime();
  if (!Number.isFinite(sentAt)) return false;
  if (!previousInboundAt) return true;
  const previous = new Date(previousInboundAt).getTime();
  if (!Number.isFinite(previous)) return false;
  // They wrote after the announcement: whether it had landed is unknown, so no duplicate.
  if (previous >= sentAt) return false;
  return sentAt - previous > WINDOW_MARGIN_MS;
}

export const ON_WRITE_AGENT_SQL = `
  ${AGENT_COLUMNS}
   WHERE a.id = $1 AND ${AGENT_FILTER}
`;

/**
 * The engine's call when a verified agent writes in.
 * @returns {Promise<{status: 'sent'|'refused'|'already'|'not-eligible'|'unavailable'|'paused'}>}
 */
export async function announceOnWrite({ agentId, previousInboundAt = null }) {
  if (!(await getReferralCampaign()).active) return { status: 'paused' };
  const pool = getPool();
  let agent;
  let row;
  try {
    ({ rows: [agent] } = await pool.query(ON_WRITE_AGENT_SQL, [agentId]));
    if (!agent) return { status: 'not-eligible' };
    ({ rows: [row] } = await pool.query(
      'SELECT accepted, channel, sent_at, resent_at FROM partner_program_announcements WHERE agent_id = $1',
      [agentId],
    ));
  } catch (err) {
    if (err?.code === '42P01' || err?.code === '42703') return { status: 'unavailable' };
    throw err;
  }
  if (!shouldAnnounceOnWrite(row || null, previousInboundAt)) return { status: 'already' };
  const result = await sendTo(agent, { template: null, onWrite: true });
  if (!result) return { status: 'not-eligible' };
  return { status: result.accepted ? 'sent' : 'refused' };
}
