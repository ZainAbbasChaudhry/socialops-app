-- WhatsApp Cloud API's 24-hour customer service window is measured from
-- the customer's last INBOUND message, not from any message in either
-- direction - `last_message_at` already gets touched by outbound agent/bot
-- replies too (see repository.ts/pipeline.ts), so it can't answer "is the
-- free-text window still open?" on its own. This tracks the inbound-only
-- timestamp the window actually depends on.

ALTER TABLE socialops.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS last_inbound_message_at TIMESTAMPTZ;

-- Backfill: best-effort initial value so existing conversations don't all
-- read as "window open" on a message that's actually old. Exact to the
-- extent inbound messages were recorded; a conversation with only outbound
-- messages logged stays NULL (treated as "window closed" by the app).
UPDATE socialops.whatsapp_conversations c
SET last_inbound_message_at = sub.max_created_at
FROM (
  SELECT conversation_id, MAX(created_at) AS max_created_at
  FROM socialops.whatsapp_messages
  WHERE direction = 'inbound'
  GROUP BY conversation_id
) sub
WHERE sub.conversation_id = c.id
  AND c.last_inbound_message_at IS NULL;

INSERT INTO socialops.schema_migrations (version) VALUES ('0013_conversation_session_window')
ON CONFLICT (version) DO NOTHING;

COMMIT;
