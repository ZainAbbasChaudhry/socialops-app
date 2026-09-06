-- The client's own answers: services, prices, FAQs and policies.
--
-- Without this the qualification bot can only ask questions - it has nothing
-- to answer FROM. A customer asking "what does X cost" got another question
-- back, which is exactly the behaviour that makes a bot feel useless.
--
-- Entries are per workspace and only ever written by that workspace. The bot
-- is instructed to answer from these and to say it will check rather than
-- invent anything that is not here, so an empty knowledge base makes the bot
-- cautious rather than creative.

CREATE TABLE IF NOT EXISTS socialops.knowledge_entries (
  id            UUID PRIMARY KEY,
  workspace_id  UUID NOT NULL,

  -- What kind of thing this is, so the bot can be told "these are your
  -- prices" rather than handed an undifferentiated wall of text.
  kind          TEXT NOT NULL DEFAULT 'faq',

  -- The question or the name of the service. Short.
  title         TEXT NOT NULL,
  -- The answer, the description, the price. This is what the bot says.
  body          TEXT NOT NULL,

  -- Optional, and deliberately free text: "PKR 30,000", "from $50/month",
  -- "depends on scope". A numeric column would force a precision the real
  -- answer often does not have, and a bot quoting a made-up exact figure is
  -- worse than one saying "it depends - let me check".
  price         TEXT,

  -- Extra words a customer might use for the same thing, so a match on
  -- "rate"/"charges"/"fees" finds the pricing entry.
  keywords      TEXT[] NOT NULL DEFAULT '{}',

  -- Off means the bot does not see it. Lets a client retire an old price
  -- without deleting the record of what it used to be.
  active        BOOLEAN NOT NULL DEFAULT TRUE,

  -- Higher first, so a client can put their headline offer at the top.
  sort_order    INTEGER NOT NULL DEFAULT 0,

  updated_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'knowledge_entries_kind_check'
  ) THEN
    ALTER TABLE socialops.knowledge_entries
      ADD CONSTRAINT knowledge_entries_kind_check
      CHECK (kind IN ('service', 'price', 'faq', 'policy'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS knowledge_entries_workspace_idx
  ON socialops.knowledge_entries (workspace_id, active, sort_order DESC);

COMMIT;
