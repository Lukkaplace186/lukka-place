/**
 * Listings that never enter a market figure: those of test and demo accounts
 * (`agents.is_test`, migrations/20260929_market_history.sql). "Agence Test"
 * listings are real rows in production; a price someone typed to try the
 * product must never reach a median, a benchmark, an export or a bank.
 *
 * Read through to_jsonb so every query keeps working before the migration
 * adds the column (then nobody is a test account). Expects the listing
 * aliased `p`.
 */
export const NOT_TEST_LISTING_SQL = `NOT EXISTS (
  SELECT 1 FROM agents test_agent
   WHERE test_agent.id = p.agent_id
     AND COALESCE((to_jsonb(test_agent) ->> 'is_test')::boolean, false)
)`;
