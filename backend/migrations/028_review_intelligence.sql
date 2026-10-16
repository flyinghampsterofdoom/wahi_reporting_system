-- Google-only review intelligence. No triggers/writes into existing domains.
CREATE TABLE wahi_v2.review_locations (
 id UUID PRIMARY KEY, resource TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles', synthetic BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE wahi_v2.review_rights_policies (
 id UUID PRIMARY KEY, location_id UUID NOT NULL REFERENCES wahi_v2.review_locations,
 version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('unknown','synthetic_only')),
 raw_days INTEGER NOT NULL DEFAULT 30 CHECK(raw_days BETWEEN 1 AND 3650),
 derived_days INTEGER NOT NULL DEFAULT 30 CHECK(derived_days BETWEEN 1 AND 3650),
 aggregate_survival BOOLEAN NOT NULL DEFAULT FALSE, purge_missing BOOLEAN NOT NULL DEFAULT TRUE,
 actor_id TEXT NOT NULL, reason TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL,
 erase_identity BOOLEAN NOT NULL DEFAULT TRUE,
 UNIQUE(location_id,version)
);
CREATE TABLE wahi_v2.review_taxonomies (
 id UUID PRIMARY KEY, version INTEGER NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL, actor_id TEXT NOT NULL
);
CREATE TABLE wahi_v2.review_categories (
 taxonomy_id UUID NOT NULL REFERENCES wahi_v2.review_taxonomies, id TEXT NOT NULL,
 parent_id TEXT, label TEXT NOT NULL, definition TEXT NOT NULL,
 PRIMARY KEY(taxonomy_id,id), FOREIGN KEY(taxonomy_id,parent_id) REFERENCES wahi_v2.review_categories(taxonomy_id,id),
 CHECK(parent_id IS DISTINCT FROM id)
);
CREATE TABLE wahi_v2.review_configs (
 id UUID PRIMARY KEY, taxonomy_id UUID NOT NULL REFERENCES wahi_v2.review_taxonomies,
 model TEXT NOT NULL, prompt_version TEXT NOT NULL, schema_version INTEGER NOT NULL,
 configuration JSONB NOT NULL, fingerprint TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE wahi_v2.review_sync_runs (
 id UUID PRIMARY KEY, sequence BIGSERIAL UNIQUE, location_id UUID NOT NULL REFERENCES wahi_v2.review_locations,
 fixture_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','running','failed','incomplete','complete')),
 next_cursor TEXT, next_page INTEGER NOT NULL DEFAULT 0, traversal_done BOOLEAN NOT NULL DEFAULT FALSE,
 expected_count INTEGER, distinct_count INTEGER, error_code TEXT, attempts INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ
);
CREATE TABLE wahi_v2.review_sync_pages (
 run_id UUID NOT NULL REFERENCES wahi_v2.review_sync_runs, ordinal INTEGER NOT NULL,
 cursor TEXT NOT NULL, next_cursor TEXT, payload JSONB, expires_at TIMESTAMPTZ NOT NULL,
 source_count INTEGER NOT NULL, recorded_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(run_id,ordinal), UNIQUE(run_id,cursor)
);
CREATE TABLE wahi_v2.review_records (
 id UUID PRIMARY KEY, location_id UUID NOT NULL REFERENCES wahi_v2.review_locations,
 source_id TEXT NOT NULL, head_id UUID, availability TEXT NOT NULL DEFAULT 'present' CHECK(availability IN ('present','missing_pending','missing','expired')),
 missing_count INTEGER NOT NULL DEFAULT 0, first_seen TIMESTAMPTZ NOT NULL,last_seen TIMESTAMPTZ NOT NULL,
 UNIQUE(location_id,source_id)
);
CREATE TABLE wahi_v2.review_source_versions (
 id UUID PRIMARY KEY, review_id UUID NOT NULL REFERENCES wahi_v2.review_records,
 content_hash TEXT NOT NULL, text_hash TEXT NOT NULL, payload JSONB,
 rating INTEGER CHECK(rating BETWEEN 1 AND 5), source_created_at TIMESTAMPTZ, source_updated_at TIMESTAMPTZ,
 recorded_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL, purged_at TIMESTAMPTZ,
 UNIQUE(review_id,content_hash)
);
ALTER TABLE wahi_v2.review_records ADD CONSTRAINT review_head_fk FOREIGN KEY(head_id) REFERENCES wahi_v2.review_source_versions;
CREATE TABLE wahi_v2.review_changes (
 id BIGSERIAL PRIMARY KEY, review_id UUID NOT NULL REFERENCES wahi_v2.review_records,
 run_id UUID REFERENCES wahi_v2.review_sync_runs, previous_id UUID REFERENCES wahi_v2.review_source_versions,
 next_id UUID REFERENCES wahi_v2.review_source_versions, kind TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE wahi_v2.review_results (
 id UUID PRIMARY KEY, review_id UUID NOT NULL REFERENCES wahi_v2.review_records,
 config_id UUID NOT NULL REFERENCES wahi_v2.review_configs, text_hash TEXT NOT NULL,
 model TEXT NOT NULL, output JSONB, created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
 UNIQUE(review_id,config_id,text_hash)
);
CREATE TABLE wahi_v2.review_classification_jobs (
 id UUID PRIMARY KEY, version_id UUID NOT NULL REFERENCES wahi_v2.review_source_versions,
 config_id UUID NOT NULL REFERENCES wahi_v2.review_configs, result_id UUID REFERENCES wahi_v2.review_results,
 state TEXT NOT NULL CHECK(state IN ('pending','leased','retry_wait','succeeded','no_text','no_analyzable_text','refused','failed','expired','blocked_policy')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL, lease_until TIMESTAMPTZ,
 error_code TEXT, created_at TIMESTAMPTZ NOT NULL, UNIQUE(version_id,config_id)
);
CREATE TABLE wahi_v2.review_processing_attempts (
 id UUID PRIMARY KEY, job_id UUID NOT NULL REFERENCES wahi_v2.review_classification_jobs,
 state TEXT NOT NULL, error_code TEXT, model TEXT NOT NULL,
 input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
 estimated_cost NUMERIC NOT NULL DEFAULT 0 CHECK(estimated_cost>=0), recorded_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE wahi_v2.review_category_proposals (
 id UUID PRIMARY KEY, location_id UUID NOT NULL REFERENCES wahi_v2.review_locations,
 theme TEXT NOT NULL, proposed_id TEXT NOT NULL, parent_id TEXT NOT NULL, definition TEXT NOT NULL,
 evidence JSONB, support_count INTEGER NOT NULL, assessed_count INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 taxonomy_id UUID REFERENCES wahi_v2.review_taxonomies, decision_actor TEXT, decision_reason TEXT, decided_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX review_pending_theme ON wahi_v2.review_category_proposals(location_id,lower(theme)) WHERE status='pending';
CREATE TABLE wahi_v2.review_reprocess_runs (
 id UUID PRIMARY KEY, location_id UUID NOT NULL REFERENCES wahi_v2.review_locations,
 config_id UUID NOT NULL REFERENCES wahi_v2.review_configs, actor_id TEXT NOT NULL, reason TEXT NOT NULL,
 eligible_count INTEGER NOT NULL, unavailable_count INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE wahi_v2.review_releases (
 id UUID PRIMARY KEY, location_id UUID NOT NULL REFERENCES wahi_v2.review_locations,
 config_id UUID NOT NULL REFERENCES wahi_v2.review_configs, sync_id UUID NOT NULL REFERENCES wahi_v2.review_sync_runs,
 status TEXT NOT NULL CHECK(status IN ('published','withdrawn')), current BOOLEAN NOT NULL DEFAULT FALSE,
 evidence_erased BOOLEAN NOT NULL DEFAULT FALSE,
 policy_id UUID NOT NULL REFERENCES wahi_v2.review_rights_policies, aggregate_survival BOOLEAN NOT NULL DEFAULT FALSE,
 metric_version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
 manifest JSONB NOT NULL
);
CREATE UNIQUE INDEX review_current_release ON wahi_v2.review_releases(location_id) WHERE current;
CREATE TABLE wahi_v2.review_release_members (
 release_id UUID NOT NULL REFERENCES wahi_v2.review_releases, review_id UUID NOT NULL REFERENCES wahi_v2.review_records,
 version_id UUID NOT NULL REFERENCES wahi_v2.review_source_versions, result_id UUID REFERENCES wahi_v2.review_results,
 PRIMARY KEY(release_id,review_id)
);
CREATE TABLE wahi_v2.review_daily_metrics (
 release_id UUID NOT NULL REFERENCES wahi_v2.review_releases, day DATE NOT NULL, category_id TEXT NOT NULL,
 reviews INTEGER NOT NULL, rating_sum INTEGER NOT NULL, text_eligible INTEGER NOT NULL, analyzed INTEGER NOT NULL,
 mentions INTEGER NOT NULL, positive INTEGER NOT NULL, negative INTEGER NOT NULL, neutral INTEGER NOT NULL, mixed INTEGER NOT NULL,
 score_sum NUMERIC NOT NULL, PRIMARY KEY(release_id,day,category_id),
 CHECK(mentions=positive+negative+neutral+mixed)
);
CREATE TABLE wahi_v2.review_audit (
 id BIGSERIAL PRIMARY KEY, location_id UUID REFERENCES wahi_v2.review_locations,
 actor_id TEXT NOT NULL, event TEXT NOT NULL, details JSONB NOT NULL, recorded_at TIMESTAMPTZ NOT NULL
);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.review_audit FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.review_rights_policies FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE INDEX review_versions_expiry ON wahi_v2.review_source_versions(expires_at) WHERE payload IS NOT NULL;
CREATE INDEX review_versions_date ON wahi_v2.review_source_versions(source_created_at);
CREATE INDEX review_jobs_ready ON wahi_v2.review_classification_jobs(state,next_attempt_at);
CREATE INDEX review_changes_identity ON wahi_v2.review_changes(review_id,id DESC);
CREATE INDEX review_metrics_category ON wahi_v2.review_daily_metrics(release_id,category_id,day);
