-- Management delivery evidence is separate from credential-bearing account emails.
CREATE TABLE wahi_v2.management_reports (
 id TEXT PRIMARY KEY CHECK(id IN ('daily','weekly')),
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 send_time TEXT CHECK(send_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
 weekday INTEGER CHECK(weekday BETWEEN 0 AND 6),
 timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
 sections JSONB NOT NULL DEFAULT '["labor"]',
 version INTEGER NOT NULL DEFAULT 0,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(NOT enabled OR (send_time IS NOT NULL AND (id='daily' OR weekday IS NOT NULL)))
);
INSERT INTO wahi_v2.management_reports(id) VALUES('daily'),('weekly');
CREATE TABLE wahi_v2.management_report_recipients (
 report_id TEXT REFERENCES wahi_v2.management_reports(id),
 user_id TEXT REFERENCES wahi_v2.users(id),
 PRIMARY KEY(report_id,user_id)
);
CREATE TABLE wahi_v2.management_occurrences (
 id UUID PRIMARY KEY,
 report_id TEXT NOT NULL REFERENCES wahi_v2.management_reports(id),
 occurrence_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('scheduled','manual')),
 scheduled_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 actor_id TEXT REFERENCES wahi_v2.users(id),
 config JSONB NOT NULL,
 payload JSONB,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 failure_reason TEXT,
 UNIQUE(report_id,occurrence_key)
);
CREATE TABLE wahi_v2.management_deliveries (
 id UUID PRIMARY KEY,
 occurrence_id UUID NOT NULL REFERENCES wahi_v2.management_occurrences(id),
 user_id TEXT NOT NULL REFERENCES wahi_v2.users(id),
 recipient TEXT,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','failed','unknown','skipped')),
 attempts INTEGER NOT NULL DEFAULT 0,
 first_attempt_at TIMESTAMPTZ,
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 accepted_at TIMESTAMPTZ,
 provider_message_id UUID,
 failure_reason TEXT,
 UNIQUE(occurrence_id,user_id)
);
CREATE INDEX management_delivery_due ON wahi_v2.management_deliveries(next_attempt_at) WHERE state='pending';
CREATE TABLE wahi_v2.management_report_audit (
 id UUID PRIMARY KEY,
 report_id TEXT NOT NULL REFERENCES wahi_v2.management_reports(id),
 actor_id TEXT NOT NULL REFERENCES wahi_v2.users(id),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 event TEXT NOT NULL,
 details JSONB NOT NULL
);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.management_report_audit
 FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
