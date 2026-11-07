-- "Mon déménagement": the budget becomes a range (owner, 2026-11-07).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261107_move_project_budget_min.sql --write
--
-- ADDITIVE AND IDEMPOTENT. budget_max already exists
-- (20261107_customer_move_projects.sql); this adds the lower end. NULL = not
-- said. web's lib/moveProjects.js saves without it (42703) until this runs.

BEGIN;

ALTER TABLE customer_move_projects ADD COLUMN IF NOT EXISTS budget_min integer;

COMMIT;
