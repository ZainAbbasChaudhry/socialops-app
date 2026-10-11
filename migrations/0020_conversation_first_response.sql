-- Powers the WhatsApp reporting tab's "time to first response" metric.
-- Both are set once (going forward from this migration) and never
-- overwritten afterward:
--   first_inbound_message_at - when the customer's first-ever message in
--     this conversation arrived.
--   first_response_at - when this conversation first got a successfully
--     sent reply (bot or agent) after that.
-- Comparing the two gives a clean per-conversation response-time sample
-- without re-scanning the full message thread for every conversation on
-- every report load. See src/lib/integrations/whatsapp/analytics.ts.

ALTER TABLE socialops.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS first_inbound_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;

INSERT INTO socialops.schema_migrations (version) VALUES ('0020_conversation_first_response')
ON CONFLICT (version) DO NOTHING;

COMMIT;
