/**
 * International phone number normalization for customer/agent accounts.
 *
 * Pure, no `server-only` — used both server-side (login/signup lookups) and
 * client-side (display formatting on /compte). Returns the digits-only
 * `wa_id` form this system already uses everywhere else (see
 * routes/admin.js's `/^\d{9,15}$/` gate on `POST /admin/send-whatsapp`) —
 * never a `+`-prefixed string, and never the 32-bit-`integer` mistake
 * `CLAUDE.md`'s Known Gaps documents for the original `agents.phone` column.
 *
 * Most of this user base is in Kinshasa and types a DRC number without a
 * country code — the three shapes below (with '243', with the local trunk
 * '0', or bare) are preserved exactly as before so that UX doesn't regress.
 * A visitor from anywhere else is expected to type a real E.164 number with
 * its leading '+' (e.g. '+33612345678', '+15551234567'): that's the one
 * unambiguous signal that the digits that follow already include a real
 * country code, so this only accepts an international number when '+' is
 * present — a bare non-DRC-shaped digit string is otherwise indistinguishable
 * from a mistyped DRC number, so it's rejected rather than guessed at.
 *
 * @param {string} input
 * @returns {string|null} Digits-only, or null when the input doesn't
 *   confidently match a real DRC shorthand or a real E.164 number.
 */
export function normalizePhone(input) {
  const raw = String(input || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (raw.startsWith('+')) {
    return /^\d{9,15}$/.test(digits) ? digits : null;
  }

  if (digits.startsWith('243') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `243${digits.slice(1)}`;
  if (!digits.startsWith('0') && digits.length === 9) return `243${digits}`;

  return null;
}

/**
 * '243997123456' -> '+243 99 712 3456' for the DRC shape this app's own
 * users are overwhelmingly in; any other real E.164 number is shown as
 * '+<digits>' rather than the old behaviour of returning the bare
 * unformatted digit string (which read as a stray number with no country
 * marker at all once non-DRC signups became possible).
 */
export function formatPhoneDisplay(normalized) {
  const digits = String(normalized || '');
  if (!digits) return '';
  if (!/^243\d{9}$/.test(digits)) return `+${digits}`;
  const rest = digits.slice(3);
  return `+243 ${rest.slice(0, 2)} ${rest.slice(2, 5)} ${rest.slice(5)}`;
}
