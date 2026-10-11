-- Saved WhatsApp reply templates ("canned responses"), shared by the whole
-- workspace rather than per-agent, with a `/shortcut` so an agent can type
-- e.g. `/pricing` in the reply box and insert the full template instead of
-- retyping common answers. Deliberately its own small table (not reusing
-- any CRM table) since these are reply text, not lead or conversation data.

CREATE TABLE IF NOT EXISTS socialops.whatsapp_quick_replies (
  id                UUID PRIMARY KEY,
  workspace_id      UUID NOT NULL REFERENCES socialops.workspaces(id) ON DELETE CASCADE,
  shortcut          TEXT NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT NOT NULL,
  created_by_user_id UUID REFERENCES socialops.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness per workspace so two templates can't collide
-- on the same `/shortcut` an agent would type.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_quick_replies_workspace_shortcut
  ON socialops.whatsapp_quick_replies(workspace_id, lower(shortcut));

INSERT INTO socialops.schema_migrations (version) VALUES ('0016_quick_replies')
ON CONFLICT (version) DO NOTHING;

COMMIT;
