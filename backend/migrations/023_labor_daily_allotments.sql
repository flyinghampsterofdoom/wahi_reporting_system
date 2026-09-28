-- Keep existing weekly targets intact. NULL explicitly means not configured.
-- Daily inputs are versioned with their weekly targets; never backfill allocations.
ALTER TABLE wahi_v2.labor_standing_targets
 ADD COLUMN foh_daily JSONB,
 ADD COLUMN boh_daily JSONB;
