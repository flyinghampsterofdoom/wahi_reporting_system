-- Additive changes confined to wahi_v2. Existing manual credentials remain valid.
ALTER TABLE wahi_v2.integration_settings DROP CONSTRAINT integration_settings_name_check;
ALTER TABLE wahi_v2.integration_settings ADD CHECK (name IN ('toast','resend'));
ALTER TABLE wahi_v2.user_setup_tokens ADD COLUMN email_address TEXT;
CREATE TABLE wahi_v2.email_verification_tokens (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES wahi_v2.users(id),
 email_address TEXT NOT NULL,
 issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at TIMESTAMPTZ NOT NULL,
 used_at TIMESTAMPTZ,
 invalidated_at TIMESTAMPTZ
);
CREATE INDEX email_verification_user ON wahi_v2.email_verification_tokens(user_id);
CREATE TABLE wahi_v2.email_deliveries (
 id UUID PRIMARY KEY,
 user_id TEXT REFERENCES wahi_v2.users(id),
 purpose TEXT NOT NULL CHECK(purpose IN ('setup','verification','reset','test')),
 recipient TEXT NOT NULL,
 requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TIMESTAMPTZ,
 state TEXT NOT NULL DEFAULT 'requested' CHECK(state IN ('requested','accepted','failed','unknown')),
 provider_message_id UUID,
 failure_reason TEXT CHECK(failure_reason IN ('not_configured','provider_rejected','delivery_uncertain'))
);
CREATE INDEX email_deliveries_user ON wahi_v2.email_deliveries(user_id,requested_at);
CREATE TABLE wahi_v2.email_rate_limits (
 key TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL
);
