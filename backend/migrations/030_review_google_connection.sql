-- Connection/discovery authorization is independent of review-content permissions.
ALTER TABLE wahi_v2.review_provider_settings ADD COLUMN connection_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE wahi_v2.review_provider_settings ADD COLUMN connection_reference TEXT;
ALTER TABLE wahi_v2.review_provider_settings ADD COLUMN connection_expires_at TIMESTAMPTZ;
ALTER TABLE wahi_v2.review_provider_settings ADD COLUMN connection_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE wahi_v2.review_provider_settings ADD COLUMN connection_status TEXT NOT NULL DEFAULT 'not_configured';
ALTER TABLE wahi_v2.review_provider_settings ADD COLUMN connection_error TEXT;
ALTER TABLE wahi_v2.review_oauth_states ADD COLUMN connection_generation INTEGER NOT NULL DEFAULT 0;
CREATE TABLE wahi_v2.review_discovery_pages (
 id UUID PRIMARY KEY, location_id UUID NOT NULL REFERENCES wahi_v2.review_locations,
 environment TEXT NOT NULL, connection_generation INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('accounts','locations')), account_id TEXT,
 payload JSONB NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX review_discovery_location ON wahi_v2.review_discovery_pages(location_id,environment,expires_at);
