-- Daily Pacific wall-clock schedule; activation flags remain disabled by default.
ALTER TABLE wahi_v2.review_automation_settings
 ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles' CHECK(timezone='America/Los_Angeles'),
 ADD COLUMN daily_time TIME NOT NULL DEFAULT '10:00' CHECK(daily_time='10:00'::time),
 ADD COLUMN last_occurrence TEXT;
UPDATE wahi_v2.review_automation_settings SET interval_minutes=1440;
ALTER TABLE wahi_v2.review_work_requests
 ADD COLUMN analyze_after_sync BOOLEAN NOT NULL DEFAULT FALSE,
 ADD COLUMN parent_id UUID REFERENCES wahi_v2.review_work_requests,
 ADD COLUMN occurrence_key TEXT,
 ADD COLUMN target_version_ids UUID[],
 ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN next_attempt_at TIMESTAMPTZ,
 ADD COLUMN pause_requested BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE wahi_v2.review_work_requests DROP CONSTRAINT review_work_requests_state_check;
ALTER TABLE wahi_v2.review_work_requests ADD CONSTRAINT review_work_requests_state_check CHECK(state IN ('pending','running','complete','failed','paused'));
CREATE UNIQUE INDEX review_work_occurrence ON wahi_v2.review_work_requests(location_id,occurrence_key) WHERE occurrence_key IS NOT NULL;
CREATE INDEX review_changes_sync ON wahi_v2.review_changes(run_id,kind);
