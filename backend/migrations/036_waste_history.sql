-- Preserve immutable existing events; corrections and employee Undo append revisions.
CREATE TABLE wahi_v2.waste_revisions (
 id UUID PRIMARY KEY,
 event_id UUID NOT NULL REFERENCES wahi_v2.waste_events(id) ON DELETE RESTRICT,
 previous_id UUID NOT NULL UNIQUE,
 request_id UUID NOT NULL,
 actor_id TEXT NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('correct','void','undo')),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 300),
 snapshot JSONB NOT NULL,
 UNIQUE(actor_id,request_id)
);
CREATE INDEX waste_revision_event ON wahi_v2.waste_revisions(event_id);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.waste_revisions
 FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE INDEX waste_employee_date ON wahi_v2.waste_events(actor_id,recorded_at);
