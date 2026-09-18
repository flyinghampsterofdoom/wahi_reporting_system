-- Deliberately excluded from domain repository collections and generic history.
CREATE TABLE wahi_v2.integration_settings (
 environment TEXT NOT NULL,
 name TEXT NOT NULL CHECK (name='toast'),
 config JSONB NOT NULL,
 sealed_secret JSONB,
 version INTEGER NOT NULL CHECK (version>0),
 updated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(environment,name)
);
CREATE TABLE wahi_v2.integration_audit (
 id UUID PRIMARY KEY,
 environment TEXT NOT NULL,
 name TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 event TEXT NOT NULL,
 details JSONB NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL
);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.integration_audit FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
