-- Tracks when this conversation last received a SUCCESSFULLY SENT outbound
-- message (bot or agent), separate from last_inbound_message_at. Comparing
-- the two is how the dashboard knows a conversation is "waiting on a
-- reply" (customer's last message is newer than any reply) without having
-- to re-fetch and inspect the full message thread for every row in the
-- conversation list - see src/lib/integrations/whatsapp/sla.ts.

ALTER TABLE socialops.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS last_outbound_message_at TIMESTAMPTZ;

INSERT INTO socialops.schema_migrations (version) VALUES ('0019_conversation_last_outbound')
ON CONFLICT (version) DO NOTHING;

COMMIT;
