-- Additive, disabled-by-default review scheduling and safe OpenAI diagnostics.
ALTER TABLE wahi_v2.review_provider_settings
 ADD COLUMN diagnostic_status TEXT NOT NULL DEFAULT 'untested' CHECK(diagnostic_status IN ('untested','connected','failed')),
 ADD COLUMN diagnostic_at TIMESTAMPTZ,
 ADD COLUMN diagnostic_error TEXT;
CREATE TABLE wahi_v2.review_automation_settings (
 location_id UUID PRIMARY KEY REFERENCES wahi_v2.review_locations,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 analysis_enabled BOOLEAN NOT NULL DEFAULT FALSE,
 interval_minutes INTEGER NOT NULL DEFAULT 360 CHECK(interval_minutes BETWEEN 15 AND 10080),
 next_due_at TIMESTAMPTZ,
 last_attempt_at TIMESTAMPTZ,
 last_success_at TIMESTAMPTZ,
 error_code TEXT,
 updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX review_versions_posted ON wahi_v2.review_source_versions(source_created_at,review_id);
CREATE INDEX review_records_head ON wahi_v2.review_records(location_id,head_id);
CREATE TABLE wahi_v2.review_work_requests (
 id UUID PRIMARY KEY,
 location_id UUID NOT NULL REFERENCES wahi_v2.review_locations,
 actor_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('sync','analyze')),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','complete','failed')),
 config_id UUID REFERENCES wahi_v2.review_configs,
 sync_id UUID REFERENCES wahi_v2.review_sync_runs,
 error_code TEXT,
 result JSONB,
 created_at TIMESTAMPTZ NOT NULL,
 started_at TIMESTAMPTZ,
 completed_at TIMESTAMPTZ
);
CREATE INDEX review_work_pending ON wahi_v2.review_work_requests(location_id,created_at) WHERE state IN ('pending','running');
ALTER TABLE wahi_v2.review_sync_runs ADD COLUMN source_average_rating NUMERIC(4,3) CHECK(source_average_rating BETWEEN 0 AND 5);
