-- Internal notes on a WhatsApp conversation: visible only inside the
-- dashboard, never sent to the customer and never touches the Cloud API.
-- Deliberately a conversation-scoped table (not the shared lead_activities
-- timeline) so this stays contained to the WhatsApp thread UI it was built
-- for, independent of whatever else reads/writes lead_activities.

CREATE TABLE IF NOT EXISTS socialops.whatsapp_conversation_notes (
  id               UUID PRIMARY KEY,
  workspace_id     UUID NOT NULL REFERENCES socialops.workspaces(id) ON DELETE CASCADE,
  conversation_id  UUID NOT NULL REFERENCES socialops.whatsapp_conversations(id) ON DELETE CASCADE,
  author_user_id   UUID REFERENCES socialops.users(id) ON DELETE SET NULL,
  body             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_notes_conversation
  ON socialops.whatsapp_conversation_notes(conversation_id, created_at);

INSERT INTO socialops.schema_migrations (version) VALUES ('0014_conversation_notes')
ON CONFLICT (version) DO NOTHING;

COMMIT;
