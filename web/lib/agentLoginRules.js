/**
 * Pure rules behind the console's agent sign-in history (lib/agentLoginLog.js
 * reads, this decides). Tests: tests/unit/agent-login-log.test.js.
 */

/** Every value agent_login_attempts.outcome may hold (the migration's CHECK). */
export const LOGIN_OUTCOMES = [
  'success',
  'wrong_password',
  'locked',
  'verify_required',
  'wrong_code',
  'expired_code',
  'code_verified',
  'whatsapp_verified',
  'activated',
];

/** Outcomes that ended with the agent signed in. */
export const SIGNED_IN_OUTCOMES = new Set(['success', 'code_verified', 'whatsapp_verified', 'activated']);

/** Outcomes that are a failed try (counted as "échecs"). */
export const FAILED_OUTCOMES = new Set(['wrong_password', 'locked', 'wrong_code', 'expired_code']);

/**
 * @param {Array<{outcome: string, attempted_at: string|Date}>} rows newest first
 * @param {string|Date|null} lastSignedInAt the newest sign-in on record, any age
 * @returns {null | {lastAttemptAt, lastOutcome, lastSignedInAt, failuresSinceSignIn, lastFailureAt, pendingVerification}}
 */
export function loginSummaryFromRows(rows, lastSignedInAt = null) {
  if (!rows.length && !lastSignedInAt) return null;
  let failures = 0;
  let lastFailureAt = null;
  for (const row of rows) {
    if (SIGNED_IN_OUTCOMES.has(row.outcome)) break;
    if (FAILED_OUTCOMES.has(row.outcome)) {
      failures += 1;
      if (!lastFailureAt) lastFailureAt = row.attempted_at;
    }
  }
  const latest = rows[0] || null;
  return {
    lastAttemptAt: latest ? latest.attempted_at : lastSignedInAt,
    lastOutcome: latest ? latest.outcome : 'success',
    lastSignedInAt,
    failuresSinceSignIn: failures,
    lastFailureAt,
    // The password was right but the number still needs verifying: the
    // agent got as far as the verification page and stopped there.
    pendingVerification: latest?.outcome === 'verify_required',
  };
}

/** A short "Chrome · Android" from a user agent, never the raw string. */
export function deviceLabel(userAgent) {
  const ua = String(userAgent || '');
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
      : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
        : /CriOS|Chrome\//.test(ua) ? 'Chrome'
          : /FxiOS|Firefox\//.test(ua) ? 'Firefox'
            : /Safari\//.test(ua) ? 'Safari'
              : null;
  const os = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iPhone'
      : /Windows/.test(ua) ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
          : /Linux/.test(ua) ? 'Linux'
            : null;
  return [browser, os].filter(Boolean).join(' · ') || null;
}
