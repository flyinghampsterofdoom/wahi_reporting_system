-- Named Wahi authentication accounts. Operational and external employees are separate.
CREATE TABLE wahi_v2.users (
 id TEXT PRIMARY KEY,
 display_name TEXT NOT NULL,
 username TEXT NOT NULL UNIQUE CHECK(username=lower(btrim(username))),
 email TEXT UNIQUE CHECK(email IS NULL OR email=lower(btrim(email))),
 email_verified_at TIMESTAMPTZ,
 role TEXT NOT NULL CHECK(role IN ('ADMIN','MANAGER','LEAD','STAFF')),
 status TEXT NOT NULL CHECK(status IN ('active','disabled')),
 password_salt TEXT, password_hash TEXT, password_changed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_by TEXT NOT NULL,
 last_login_at TIMESTAMPTZ,
 version INTEGER NOT NULL DEFAULT 1,
 CHECK ((password_hash IS NULL)=(password_salt IS NULL)),
 CHECK (email IS NOT NULL OR email_verified_at IS NULL)
);
CREATE TABLE wahi_v2.user_directory_state (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
 initialized_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE wahi_v2.user_setup_tokens (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES wahi_v2.users(id),
 purpose TEXT NOT NULL CHECK(purpose IN ('setup','reset')),
 expires_at TIMESTAMPTZ NOT NULL,
 used_at TIMESTAMPTZ,
 invalidated_at TIMESTAMPTZ,
 issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 issued_by TEXT NOT NULL
);
CREATE INDEX user_setup_tokens_user ON wahi_v2.user_setup_tokens(user_id);
CREATE TABLE wahi_v2.user_security_audit (
 id UUID PRIMARY KEY,
 actor_id TEXT NOT NULL,
 user_id TEXT NOT NULL REFERENCES wahi_v2.users(id),
 event TEXT NOT NULL,
 details JSONB NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX user_security_audit_user ON wahi_v2.user_security_audit(user_id,recorded_at);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.user_security_audit
 FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER no_user_deletion BEFORE DELETE ON wahi_v2.users
 FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
