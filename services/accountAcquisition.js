/**
 * Where an agent account created by THIS engine came from — WhatsApp
 * onboarding, or the team creating it from the console — written to Postgres
 * `account_acquisitions` (migrations/20261027_growth_attribution.sql) inside
 * the transaction that creates the account. Web writes the same table for
 * web signups (web/lib/accountAcquisition.js), with the visitor's campaign;
 * a WhatsApp account has no browser behind it, so only the channel and the
 * sales rep's code (when one was sent) are known, and nothing else is
 * invented.
 *
 * In a SAVEPOINT, like the sales attribution beside it: a missing table
 * (before the migration) or any failure never costs the agent their account.
 */

const CHANNEL_BY_SOURCE = { whatsapp: 'whatsapp', admin: 'admin' };

/** `upsertAgentFromWhatsApp`'s `source` → the stored channel. */
function channelFor(source) {
  return CHANNEL_BY_SOURCE[source] || 'whatsapp';
}

const RECORD_SQL = `
  INSERT INTO account_acquisitions (account_type, account_id, channel, ref_code)
  VALUES ('agent', $1, $2, $3)
  ON CONFLICT (account_type, account_id) DO NOTHING
`;

/** @returns {Promise<boolean>} whether a row was written */
async function recordAgentAcquisitionInTransaction(client, { agentId, source = 'whatsapp', refCode = null }) {
  try {
    await client.query('SAVEPOINT account_acquisition');
    const result = await client.query(RECORD_SQL, [agentId, channelFor(source), refCode || null]);
    await client.query('RELEASE SAVEPOINT account_acquisition');
    return result.rowCount > 0;
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT account_acquisition').catch(() => {});
    if (err?.code !== '42P01') console.error(`[acquisition] agent #${agentId} not recorded: ${err.message}`);
    return false;
  }
}

module.exports = { channelFor, recordAgentAcquisitionInTransaction, RECORD_SQL };
