-- Phase 4: OpenWA (Baileys NOWEB) as a second WhatsApp transport alongside
-- the existing official Meta Cloud API path.
--
-- Additive and non-destructive by design: no table is dropped, no row is
-- rewritten, no existing column is removed. Every pre-existing row is a
-- Cloud API account and keeps working unchanged - `provider` defaults to
-- 'cloud-api' precisely so back-filling is unnecessary.
--
-- The only structural relaxation is dropping NOT NULL from the two
-- Cloud-API-specific identifiers. An OpenWA session is a paired phone, not
-- a Meta business asset: it has no phone_number_id and no waba_id, and
-- inventing placeholder values for them would make the two providers
-- indistinguishable at the data layer. Dropping NOT NULL never invalidates
-- existing data (every current row still has both values); application-level
-- validation in whatsapp/repository.ts enforces "cloud-api rows must carry
-- both" instead, which a single table-wide constraint cannot express now
-- that two shapes share the table.

ALTER TABLE socialops.whatsapp_accounts
  ADD COLUMN IF NOT EXISTS provider             TEXT NOT NULL DEFAULT 'cloud-api',
  ADD COLUMN IF NOT EXISTS session_id           TEXT,
  ADD COLUMN IF NOT EXISTS connection_status    TEXT NOT NULL DEFAULT 'disconnected',
  ADD COLUMN IF NOT EXISTS connected_number     TEXT,
  ADD COLUMN IF NOT EXISTS last_connected_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_disconnected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error           TEXT;

ALTER TABLE socialops.whatsapp_accounts ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE socialops.whatsapp_accounts ALTER COLUMN waba_id         DROP NOT NULL;

-- CHECK constraints have no IF NOT EXISTS form, so they are added guarded
-- to keep this migration re-runnable against a partially-applied database.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_accounts_provider_check') THEN
    ALTER TABLE socialops.whatsapp_accounts
      ADD CONSTRAINT whatsapp_accounts_provider_check
      CHECK (provider IN ('cloud-api', 'openwa'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_accounts_connection_status_check') THEN
    ALTER TABLE socialops.whatsapp_accounts
      ADD CONSTRAINT whatsapp_accounts_connection_status_check
      CHECK (connection_status IN ('disconnected', 'connecting', 'qr', 'connected', 'error'));
  END IF;
END $$;

-- One OpenWA session per workspace is the intended shape, but the session id
-- is what the gateway routes on, so uniqueness is enforced on it globally
-- rather than per workspace: two workspaces must never be able to claim the
-- same gateway session. Partial, so the many Cloud API rows (session_id NULL)
-- are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_accounts_session_id
  ON socialops.whatsapp_accounts(session_id)
  WHERE session_id IS NOT NULL;

-- Every inbound OpenWA webhook resolves its account by (provider, session_id);
-- without this it is a sequential scan on each delivery.
CREATE INDEX IF NOT EXISTS idx_whatsapp_accounts_provider_session
  ON socialops.whatsapp_accounts(provider, session_id);

INSERT INTO socialops.schema_migrations (version) VALUES ('0012_whatsapp_openwa')
ON CONFLICT (version) DO NOTHING;

COMMIT;
