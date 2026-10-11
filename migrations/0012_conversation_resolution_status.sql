-- Adds a resolution-workflow status to WhatsApp conversations, separate
-- from the existing `status` column (which tracks bot/escalated/human/closed
-- handling state - who's driving the conversation, not whether the
-- customer's issue is actually done). Agents need both: a conversation can
-- be "human" handling AND still "open" (unresolved) for days.
--
-- Values: open | pending | resolved | snoozed. Defaults to 'open' so every
-- existing and newly-created conversation starts in the same state a brand
-- new inbound message would imply.

ALTER TABLE socialops.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS resolution_status TEXT NOT NULL DEFAULT 'open';

ALTER TABLE socialops.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;

-- The Live Conversations screen filters by workspace + resolution_status
-- (e.g. "show only Open"), same access pattern as the existing lastmsg
-- index from 0011 but on the new column.
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_resolution
  ON socialops.whatsapp_conversations(workspace_id, resolution_status);

INSERT INTO socialops.schema_migrations (version) VALUES ('0012_conversation_resolution_status')
ON CONFLICT (version) DO NOTHING;

COMMIT;
