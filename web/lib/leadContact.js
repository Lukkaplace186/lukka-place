import { buildWhatsAppLink } from './whatsapp';
import { listingPublicUrl, shareBlocker } from './listingShareCopy';
import { clientFirstName } from './clientMatching';

// "Répondre sur WhatsApp" on the agent's lead card (components/AgentLeadCard.js).
// Pure and client-safe.

/**
 * wa.me to the customer from the agent's own WhatsApp. ALWAYS FRENCH (the
 * customer reads it, same rule as listingShareCopy). Names and links the
 * listing only when it is one of the agent's own and publicly live — a link
 * that 404s is worse than none. Null when the number is unusable.
 */
export function leadWhatsAppLink(lead, myListings = []) {
  const digits = String(lead?.wa_id || '').replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  const listing =
    lead?.property_id != null ? myListings.find((l) => String(l.id) === String(lead.property_id)) : null;
  const live = listing && shareBlocker(listing) === null ? listing : null;
  const first = clientFirstName(lead?.name);
  const lines = [first ? `Bonjour ${first},` : 'Bonjour,', ''];
  lines.push(
    live?.title
      ? `Je vous contacte suite à votre demande sur Lukka Place au sujet de : ${live.title}.`
      : 'Je vous contacte suite à votre demande sur Lukka Place.',
  );
  if (live) lines.push(listingPublicUrl(live.id));
  return buildWhatsAppLink(digits, lines.join('\n'));
}
