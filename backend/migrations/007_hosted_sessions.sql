-- Hosted sessions contain token hashes only; no passwords or integration secrets.
CREATE TABLE wahi_v2.web_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, csrf TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX web_sessions_expiry ON wahi_v2.web_sessions(expires_at);
CREATE TABLE wahi_v2.login_limits (
 key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL
);
