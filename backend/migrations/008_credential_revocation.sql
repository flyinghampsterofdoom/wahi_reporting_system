-- Active credential generations gate sessions across rolling deployments.
-- Fingerprints stay internal; audit events contain no credential material.
CREATE TABLE wahi_v2.auth_credentials (
 user_id TEXT PRIMARY KEY,
 fingerprint TEXT NOT NULL,
 generation UUID NOT NULL
);
ALTER TABLE wahi_v2.web_sessions ADD COLUMN credential_generation UUID;
CREATE INDEX web_sessions_user ON wahi_v2.web_sessions(user_id);
CREATE TABLE wahi_v2.auth_security_events (
 id UUID PRIMARY KEY,
 user_id TEXT NOT NULL,
 event TEXT NOT NULL CHECK(event IN ('password_changed','account_removed')),
 mechanism TEXT NOT NULL CHECK(mechanism='configuration_activation'),
 revoked_sessions INTEGER NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.auth_security_events
 FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
