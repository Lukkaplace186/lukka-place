import 'server-only';
import { getPool } from './db';
import { getFlyerListing, frenchTypeText } from './listingFlyer';
import { agentContactPhone, buildListingSocialCopy, listingPublicUrl, shareBlocker } from './listingShareCopy';
import { recordListingShares } from './listingShares';
import { formatPrice } from './format';
import { SITE_URL } from './constants';

/**
 * The replies to an agent's WhatsApp commands (`!mesbiens`, `!share 310`),
 * built here — the engine (services/agentCommands.js) only identifies the
 * verified sender and relays, through POST /api/internal/agent-command — so
 * there is one caption, the share kit's own (lib/listingShareCopy.js), not a
 * second one in the engine. French always: it goes back to the agent's
 * WhatsApp and on to their customers.
 */

export const COMMAND_SOURCE = 'wa_command';
export const MES_BIENS_MAX = 10;

/** The agent's public listings, newest first — ownership AND the public gate in SQL. */
export const AGENT_LIVE_LISTINGS_SQL = `
  SELECT p.id, pc.title, p.price, p.purpose, p.price_period, p.reference
    FROM properties p
    JOIN property_contents pc ON pc.property_id = p.id AND pc.language_id = 20
   WHERE p.agent_id = $1 AND p.status = 1 AND p.approve_status = 1
     AND COALESCE(p.listing_status, 'active') <> 'closed'
   ORDER BY p.created_at DESC
   LIMIT $2
`;

/** Pure: the "!mesbiens" reply from rows. */
export function mesBiensText(rows, total = rows.length) {
  if (!rows.length) {
    return `Vous n’avez aucune annonce en ligne pour le moment.\nAjoutez-en une : ${SITE_URL}/compte/agent/biens`;
  }
  const lines = rows.map((row) => {
    const price = formatPrice(row.price, row.purpose, row.price_period);
    return `• n° ${row.id} — ${row.title}${price ? ` — ${price}` : ''}\n  ${listingPublicUrl(row.id, { source: COMMAND_SOURCE })}`;
  });
  const more = total > rows.length ? `\n…et d’autres dans Mes biens : ${SITE_URL}/compte/agent/biens` : `\nMes biens : ${SITE_URL}/compte/agent/biens`;
  return [
    `*Vos annonces en ligne* (${rows.length})`,
    ...lines,
    more,
    '',
    'Pour la légende d’une annonce : !share suivi de son numéro (ex. !share ' + rows[0].id + ').',
  ].join('\n');
}

export const HELP_TEXT = [
  '*Commandes Lukka Place*',
  '!mesbiens — vos annonces en ligne, avec leur lien',
  '!share 310 — la légende prête à partager d’une annonce',
  '!aide — cette liste',
].join('\n');

const BLOCKED_TEXT = {
  pending: 'Cette annonce attend encore la validation de notre équipe : elle ne peut pas être partagée.',
  rejected: 'Cette annonce a été refusée par la modération : elle ne peut pas être partagée.',
  archived: 'Cette annonce est archivée : remettez-la en ligne pour la partager.',
  under_offer: 'Cette annonce est sous compromis : elle n’est plus proposée.',
  closed: 'Cette annonce est louée / vendue : elle n’est plus proposée.',
};

/**
 * @returns {Promise<{ok: boolean, text: string, recorded?: boolean}>}
 */
export async function runAgentCommand({ agentId, command, listingId = null }) {
  if (command === 'aide') return { ok: true, text: HELP_TEXT };

  if (command === 'mesbiens') {
    const { rows } = await getPool().query(AGENT_LIVE_LISTINGS_SQL, [agentId, MES_BIENS_MAX + 1]);
    return { ok: true, text: mesBiensText(rows.slice(0, MES_BIENS_MAX), rows.length) };
  }

  if (command === 'share') {
    const id = Number.parseInt(listingId, 10);
    if (!Number.isSafeInteger(id) || id <= 0) {
      return { ok: false, text: 'Indiquez le numéro de l’annonce, par exemple : !share 310. Tapez !mesbiens pour la liste.' };
    }
    // Ownership is getFlyerListing's own SQL (p.agent_id = the sender's id):
    // somebody else's listing is "introuvable", the same answer as a wrong id.
    const listing = await getFlyerListing(agentId, id);
    if (!listing) return { ok: false, text: `Annonce n° ${id} introuvable parmi les vôtres. Tapez !mesbiens pour la liste.` };
    const blocker = shareBlocker(listing);
    if (blocker) return { ok: false, text: BLOCKED_TEXT[blocker] || BLOCKED_TEXT.pending };
    const caption = buildListingSocialCopy(listing, {
      typeText: frenchTypeText(listing),
      contactPhone: agentContactPhone(listing),
      url: listingPublicUrl(listing.id, { source: COMMAND_SOURCE }),
    });
    const recorded = (await recordListingShares(agentId, { ids: [listing.id], channel: 'wa_command', format: 'text' })) > 0;
    return { ok: true, text: caption, recorded };
  }

  return { ok: false, text: HELP_TEXT };
}
