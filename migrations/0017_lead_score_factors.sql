-- Persists the per-factor breakdown behind a lead's score (buying intent,
-- budget, urgency, etc. - see LeadScoreFactors in src/types/index.ts) at
-- the moment it was computed, so the dashboard can show WHY a lead scored
-- the way it did instead of just the final number. Nullable: older leads
-- scored before this existed simply have no breakdown to show.

ALTER TABLE socialops.leads
  ADD COLUMN IF NOT EXISTS score_factors JSONB;

INSERT INTO socialops.schema_migrations (version) VALUES ('0017_lead_score_factors')
ON CONFLICT (version) DO NOTHING;

COMMIT;
