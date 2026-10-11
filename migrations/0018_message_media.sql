-- Lets a WhatsApp message carry a stored attachment (image/video/audio/
-- document) alongside its text. Nullable: a plain text message simply
-- never sets these. storage_key is this app's own filesystem-adapter key
-- (see src/lib/storage/local-adapter.ts), not Meta's media id - Meta's
-- download URLs expire in minutes, so inbound media is downloaded once and
-- kept locally; outbound media is the same file the agent uploaded here.

ALTER TABLE socialops.whatsapp_messages
  ADD COLUMN IF NOT EXISTS media_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS media_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS media_filename TEXT,
  ADD COLUMN IF NOT EXISTS media_size_bytes INTEGER;

INSERT INTO socialops.schema_migrations (version) VALUES ('0018_message_media')
ON CONFLICT (version) DO NOTHING;

COMMIT;
