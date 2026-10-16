-- Additive provider preparation. Migration 028 and its contracts are preserved.
CREATE TABLE wahi_v2.review_provider_settings (
 location_id UUID NOT NULL REFERENCES wahi_v2.review_locations,
 provider TEXT NOT NULL CHECK(provider IN ('google','openai')),
 environment TEXT NOT NULL CHECK(environment IN ('local-review','staging','production')),
 version INTEGER NOT NULL DEFAULT 1, enabled BOOLEAN NOT NULL DEFAULT FALSE,
 config JSONB NOT NULL DEFAULT '{}', sealed_secret JSONB,
 rights_status TEXT NOT NULL DEFAULT 'unknown' CHECK(rights_status IN ('unknown','test_only','approved')),
 rights_reference TEXT, rights_expires_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(location_id,provider,environment)
);
CREATE TABLE wahi_v2.review_oauth_states (
 state_hash TEXT PRIMARY KEY, location_id UUID NOT NULL REFERENCES wahi_v2.review_locations,
 environment TEXT NOT NULL, actor_id TEXT NOT NULL, session_hash TEXT NOT NULL,
 settings_version INTEGER NOT NULL, redirect_uri TEXT NOT NULL, sealed_verifier JSONB NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ
);
CREATE INDEX review_oauth_expiry ON wahi_v2.review_oauth_states(expires_at);
CREATE TABLE wahi_v2.review_budget_reservations (
 id UUID PRIMARY KEY, location_id UUID NOT NULL REFERENCES wahi_v2.review_locations,
 environment TEXT NOT NULL, month TEXT NOT NULL,
 attempt_id UUID REFERENCES wahi_v2.review_processing_attempts,
 settings_version INTEGER NOT NULL, model TEXT NOT NULL, price_version TEXT NOT NULL,
 reserved_micros BIGINT NOT NULL CHECK(reserved_micros>=0), charged_micros BIGINT,
 state TEXT NOT NULL CHECK(state IN ('reserved','settled','uncertain')),
 provider_request_id TEXT, usage JSONB, created_at TIMESTAMPTZ NOT NULL,
 CHECK(charged_micros IS NULL OR charged_micros>=0)
);
CREATE INDEX review_budget_month ON wahi_v2.review_budget_reservations(location_id,environment,month);
ALTER TABLE wahi_v2.review_processing_attempts ADD COLUMN provider_request_id TEXT;
ALTER TABLE wahi_v2.review_processing_attempts ADD COLUMN resolved_model TEXT;
ALTER TABLE wahi_v2.review_processing_attempts ADD COLUMN cost_micros BIGINT NOT NULL DEFAULT 0;
ALTER TABLE wahi_v2.review_processing_attempts ADD COLUMN cost_state TEXT NOT NULL DEFAULT 'mock';
ALTER TABLE wahi_v2.review_configs ADD COLUMN location_id UUID REFERENCES wahi_v2.review_locations;
ALTER TABLE wahi_v2.review_locations ADD COLUMN active_config_id UUID REFERENCES wahi_v2.review_configs;
ALTER TABLE wahi_v2.review_rights_policies ADD COLUMN approval_reference TEXT;
ALTER TABLE wahi_v2.review_rights_policies ADD COLUMN valid_until TIMESTAMPTZ;
ALTER TABLE wahi_v2.review_rights_policies DROP CONSTRAINT review_rights_policies_status_check;
ALTER TABLE wahi_v2.review_rights_policies ADD CONSTRAINT review_rights_policies_status_check CHECK(status IN ('unknown','synthetic_only','approved'));
