-- "Retirer du team" on /admin/sales (web/lib/sales.js removeSalesRep).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261021_sales_rep_removal.sql --write
--
-- ADDITIVE AND IDEMPOTENT. A rep with no history at all is deleted outright;
-- a rep who earned, was paid or brought anyone in keeps their row (the FKs
-- from sales_commissions, sales_payouts and sales_agent_attributions are
-- NO ACTION, and that history is the money record), set inactive, unlinked
-- from their console account and stamped `removed_at`, which takes them off
-- the team list. Nothing is backfilled.
--
-- DEPLOY ORDER: run this BEFORE the web deploy — the team list names the column.

ALTER TABLE sales_reps ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ;
ALTER TABLE sales_reps ADD COLUMN IF NOT EXISTS removed_by BIGINT REFERENCES console_admin_users (id) ON DELETE SET NULL;
