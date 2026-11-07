-- "Mon déménagement": the stage a customer sets by tapping a pill (2026-11-07).
--
-- Run with:  node scripts/run-sql-migration.js migrations/20261107_move_project_manual_stage.sql --write
--
-- ADDITIVE AND IDEMPOTENT. manual_stage is 'recherche' | 'demande' | 'visites'
-- (web lib/moveProjectRules.js MOVE_MANUAL_STAGES), NULL when never set. It
-- only ever moves the displayed stage forward; real events still count.
-- Web reads it as NULL until this runs.

BEGIN;

ALTER TABLE customer_move_projects ADD COLUMN IF NOT EXISTS manual_stage text;

COMMIT;
