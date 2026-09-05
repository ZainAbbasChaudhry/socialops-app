-- The automation_runs status CHECK never included two of the five statuses
-- the engine actually writes.
--
-- src/lib/automations/engine.ts records a run as 'skipped' when an
-- automation's condition doesn't match, and as 'pending-approval' when its
-- runMode is manual-approval (which is the automation builder's DEFAULT).
-- Neither value was permitted, so those inserts raised a check_violation
-- that propagated out of dispatchAutomationEvent, through the WhatsApp
-- pipeline, and aborted the inbound message BEFORE the customer's reply was
-- generated - while the webhook still answered 200, so the provider never
-- retried and the failure was invisible.
--
-- Widening a CHECK is not destructive: every existing row already satisfies
-- the narrower set, so no data can be invalidated by allowing more values.
-- The constraint is dropped and re-added because Postgres has no
-- ALTER CONSTRAINT for a CHECK expression; IF EXISTS keeps it re-runnable.

ALTER TABLE socialops.automation_runs
  DROP CONSTRAINT IF EXISTS automation_runs_status_check;

ALTER TABLE socialops.automation_runs
  ADD CONSTRAINT automation_runs_status_check
  CHECK (status IN ('running', 'completed', 'blocked', 'failed', 'skipped', 'pending-approval'));

INSERT INTO socialops.schema_migrations (version) VALUES ('0013_automation_runs_status')
ON CONFLICT (version) DO NOTHING;

COMMIT;
