/**
 * Shared conventions for anything that writes to the LIVE production
 * database. Per the agreed QA constraint: writes are tagged, enumerable, and
 * removed by the user — this module never deletes anything itself, it only
 * prints the SQL that would.
 */

/** e.g. ZZQA-20260904-1132. Sorts to the end of any alphabetical listing. */
export const QA_TAG = `ZZQA-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2')}`;

/**
 * Reserved numbers in a real Congolese prefix that normalizePhone() accepts
 * (lib/phone.js) but that nobody holds — 2439000000xx is not an allocated
 * subscriber range. Never send a real WhatsApp message to these.
 */
export const QA_CUSTOMER_PHONE = '243900000001';
export const QA_AGENT_PHONE = '243900000002';

/**
 * Fail loudly rather than skip. A silently-skipped prod test reads as a pass
 * in CI output, which is the worst of both worlds.
 */
export function requireProdOptIn(what) {
  if (process.env.QA_ALLOW_PROD !== '1') {
    throw new Error(
      `${what} touches the LIVE database and needs QA_ALLOW_PROD=1. ` +
      'Refusing to run rather than skipping silently.',
    );
  }
}

/** Collected cleanup statements, printed at the end of a run. */
const cleanup = [];

export function addCleanup(sql) {
  cleanup.push(sql);
}

export function printCleanup() {
  if (!cleanup.length) return;
  console.log(`\n${'='.repeat(64)}\nQA records created — run these to remove them (${QA_TAG}):\n${'='.repeat(64)}`);
  for (const sql of cleanup) console.log(sql.endsWith(';') ? sql : `${sql};`);
  console.log('='.repeat(64));
}
