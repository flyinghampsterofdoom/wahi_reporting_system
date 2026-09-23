ALTER TABLE wahi_v2.users DROP CONSTRAINT users_role_check;
ALTER TABLE wahi_v2.users ADD CONSTRAINT users_role_check CHECK(role IN ('ADMIN','MANAGER','LEAD','STAFF','BOH'));
CREATE TABLE wahi_v2.waste_events (
 id UUID PRIMARY KEY, request_id UUID NOT NULL, actor_id TEXT NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL, scope TEXT NOT NULL, location_id TEXT,
 department TEXT NOT NULL CHECK(department IN ('BOH','FOH')),
 ingredient_id UUID NOT NULL REFERENCES wahi_v2.ingredients(id) ON DELETE RESTRICT,
 recipe_id UUID REFERENCES wahi_v2.recipes(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('ingredient','recipe')),
 quantity TEXT NOT NULL CHECK(quantity ~ '^[0-9]+(\.[0-9]+)?$' AND length(quantity)<=100 AND quantity::numeric>0),
 unit TEXT NOT NULL, reason TEXT NOT NULL, note TEXT NOT NULL,
 base_unit TEXT NOT NULL, base_quantity NUMERIC,
 snapshot JSONB NOT NULL, UNIQUE(actor_id,request_id),
 CHECK((kind='recipe')=(recipe_id IS NOT NULL))
);
CREATE INDEX waste_date ON wahi_v2.waste_events(recorded_at);
CREATE INDEX waste_frequency ON wahi_v2.waste_events(scope,recorded_at,ingredient_id);
CREATE INDEX waste_item ON wahi_v2.waste_events(ingredient_id,recorded_at);
CREATE INDEX waste_reason ON wahi_v2.waste_events(reason,recorded_at);
CREATE INDEX waste_location_department ON wahi_v2.waste_events(location_id,department,recorded_at);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.waste_events FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TABLE wahi_v2.waste_common_sets (
 id UUID PRIMARY KEY, scope TEXT NOT NULL, week TIMESTAMPTZ NOT NULL,
 snapshot JSONB NOT NULL, recorded_at TIMESTAMPTZ NOT NULL, UNIQUE(scope,week)
);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.waste_common_sets FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
