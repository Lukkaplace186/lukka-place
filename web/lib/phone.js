/**
 * DRC/Congo phone number normalization for customer accounts.
 *
 * Pure, no `server-only` — used both server-side (login/signup lookups) and
 * client-side (display formatting on /compte). Not a general E.164 parser:
 * scoped to the three real ways a Kinshasa visitor types their own number
 * (with the country code, with the local trunk `0`, or bare), matching the
 * digits-only convention this system already uses for `wa_id` — never the
 * 32-bit-`integer` mistake `CLAUDE.md`'s Known Gaps documents for the
 * original `agents.phone` column. Returns `null` rather than guessing when
 * the input doesn't confidently match one of those three shapes.
 */
export function normalizeCongoPhone(input) {
  const digits = String(input || '').replace(/\D/g, '');

  if (digits.startsWith('243') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `243${digits.slice(1)}`;
  if (!digits.startsWith('0') && !digits.startsWith('243') && digits.length === 9) return `243${digits}`;

  return null;
}

/** '243997123456' -> '+243 99 712 3456'. Returns the raw input if it isn't a normalized 12-digit form. */
export function formatPhoneDisplay(normalized) {
  const digits = String(normalized || '');
  if (!/^243\d{9}$/.test(digits)) return normalized || '';
  const rest = digits.slice(3);
  return `+243 ${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5)}`;
}
