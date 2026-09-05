-- Platform-admin control over which WhatsApp capabilities each workspace has.
--
-- One row per workspace holding the enabled feature keys (see
-- src/lib/integrations/whatsapp/feature-catalog.ts). Absence of a row means
-- "never configured" and the application falls back to the catalogue's
-- defaults - so this migration needs no back-fill and changes no behaviour
-- for an existing workspace until an admin actually saves a choice.
--
-- Keys are stored as TEXT[] rather than a join table on purpose: the
-- catalogue is code, not data (a feature that no longer exists in code must
-- stop working immediately, not linger as an orphan row), and the whole set
-- is always read and written together.

CREATE TABLE IF NOT EXISTS socialops.workspace_whatsapp_features (
  workspace_id   UUID PRIMARY KEY REFERENCES socialops.workspaces(id) ON DELETE CASCADE,
  -- Enabled capability keys. Validated against the catalogue on write; an
  -- unknown key is rejected there rather than silently stored.
  enabled_keys   TEXT[] NOT NULL DEFAULT '{}',
  -- Which engine this workspace's gateway session runs, so engine-specific
  -- capabilities can be refused rather than failing at the gateway.
  engine         TEXT NOT NULL DEFAULT 'baileys'
                   CHECK (engine IN ('baileys', 'whatsapp-web')),
  -- Audit: who last changed the client's entitlements, and when.
  updated_by     UUID REFERENCES socialops.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO socialops.schema_migrations (version) VALUES ('0014_whatsapp_features')
ON CONFLICT (version) DO NOTHING;

COMMIT;
