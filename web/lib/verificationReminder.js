/**
 * The "Rappeler de vérifier" WhatsApp text (console, 2026-10-21). Wording as
 * the owner wrote it; the offer it names (listings, the verified status) is
 * theirs to keep true. The bonus it used to promise was dropped on 2026-11-03
 * (bonuses are no longer running). A missing or phone-shaped first name is
 * left out rather than printed.
 */
export const SUPPORT_NUMBER = '+243 846 962 654';

export function verificationReminderText(firstName) {
  const name = String(firstName || '').trim();
  const usable = name && !/^[+\d\s-]{6,}$/.test(name) ? name : '';
  return `Bonjour${usable ? ` ${usable}` : ''} ! 🚀 Votre compte Lukka Place est presque vérifié. `
    + 'Soumettez vos informations ou annonces pour débloquer votre statut « Agent Vérifié » ! '
    + `Assistance : ${SUPPORT_NUMBER}`;
}
