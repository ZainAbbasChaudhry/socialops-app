-- Per-conversation AI reply mode, mirroring WhatsApp Business's own
-- My reply / Suggestions / AI agent switcher:
--   'auto'    - bot qualifies AND sends automatically (today's only behavior)
--   'suggest' - bot drafts a reply but an agent must review and send it
--   'off'     - bot never touches this conversation; human only
-- Independent of `status` (who's currently driving) and `resolution_status`
-- (whether the issue is done) - this is the agent's standing configuration
-- for how AI should behave going forward on this specific conversation.

ALTER TABLE socialops.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS ai_mode TEXT NOT NULL DEFAULT 'auto'
    CHECK (ai_mode IN ('auto', 'suggest', 'off'));

-- Holds the bot's drafted-but-unsent reply while ai_mode = 'suggest'. Single
-- slot per conversation (the latest draft supersedes any earlier one that
-- wasn't acted on) - cleared the moment an agent sends anything.
ALTER TABLE socialops.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS pending_ai_reply TEXT;

INSERT INTO socialops.schema_migrations (version) VALUES ('0015_conversation_ai_mode')
ON CONFLICT (version) DO NOTHING;

COMMIT;
