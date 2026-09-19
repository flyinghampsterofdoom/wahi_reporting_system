-- Toast identities are separate from Wahi authentication identities.
CREATE TABLE wahi_v2.labor_settings (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
 restaurant_guid TEXT, timezone TEXT, closeout_hour INTEGER CHECK(closeout_hour BETWEEN 0 AND 12)
);
INSERT INTO wahi_v2.labor_settings(singleton) VALUES(TRUE);
CREATE TABLE wahi_v2.labor_week_rules (
 id UUID PRIMARY KEY, effective_date DATE NOT NULL, week_start INTEGER NOT NULL CHECK(week_start BETWEEN 0 AND 6),
 actor_id TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE wahi_v2.labor_jobs (
 guid TEXT PRIMARY KEY, name TEXT NOT NULL, active BOOLEAN NOT NULL, modified_at TIMESTAMPTZ, synced_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE wahi_v2.labor_employees (
 guid TEXT PRIMARY KEY, active BOOLEAN NOT NULL, job_guids JSONB NOT NULL, modified_at TIMESTAMPTZ, synced_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE wahi_v2.labor_classifications (
 id UUID PRIMARY KEY, job_guid TEXT NOT NULL REFERENCES wahi_v2.labor_jobs(guid),
 effective_date DATE NOT NULL, area TEXT NOT NULL CHECK(area IN ('FOH','BOH','Excluded','Unassigned')),
 actor_id TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX labor_classification_resolution ON wahi_v2.labor_classifications(job_guid,effective_date DESC,recorded_at DESC);
CREATE TABLE wahi_v2.labor_targets (
 id UUID PRIMARY KEY, week_date DATE NOT NULL, foh NUMERIC NOT NULL CHECK(foh>=0), boh NUMERIC NOT NULL CHECK(boh>=0),
 actor_id TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX labor_target_week ON wahi_v2.labor_targets(week_date,recorded_at DESC);
CREATE TABLE wahi_v2.labor_entries (
 guid TEXT PRIMARY KEY, restaurant_guid TEXT NOT NULL, business_date DATE NOT NULL,
 job_guid TEXT, employee_guid TEXT, in_date TIMESTAMPTZ NOT NULL, out_date TIMESTAMPTZ,
 regular_hours TEXT, overtime_hours TEXT, breaks JSONB NOT NULL, deleted BOOLEAN NOT NULL,
 modified_at TIMESTAMPTZ, synced_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX labor_entries_week ON wahi_v2.labor_entries(business_date) WHERE NOT deleted;
CREATE TABLE wahi_v2.labor_sync_days (
 business_date DATE PRIMARY KEY, synced_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE wahi_v2.labor_sync_state (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton), attempted_at TIMESTAMPTZ, synced_at TIMESTAMPTZ,
 error_code TEXT, metadata_at TIMESTAMPTZ
);
INSERT INTO wahi_v2.labor_sync_state(singleton) VALUES(TRUE);
CREATE TABLE wahi_v2.labor_audit (
 id UUID PRIMARY KEY, actor_id TEXT NOT NULL, event TEXT NOT NULL, details JSONB NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.labor_week_rules FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.labor_classifications FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.labor_targets FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.labor_audit FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
