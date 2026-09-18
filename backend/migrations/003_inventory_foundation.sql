-- Physical observations only. No inventory-position ledger or authoritative overall count.
CREATE TABLE wahi_v2.inventory_items (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  ingredient_id UUID NOT NULL REFERENCES wahi_v2.ingredients(id) ON DELETE RESTRICT UNIQUE,
  base_unit TEXT NOT NULL
);
CREATE TABLE wahi_v2.inventory_locations (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  area TEXT,
  sort_order INTEGER NOT NULL,
  active BOOLEAN NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0)
);
CREATE TABLE wahi_v2.inventory_assignments (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  ingredient_id UUID NOT NULL REFERENCES wahi_v2.ingredients(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES wahi_v2.inventory_locations(id) ON DELETE RESTRICT,
  count_unit TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  active BOOLEAN NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0)
);
CREATE TABLE wahi_v2.count_sessions (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  location_id UUID NOT NULL REFERENCES wahi_v2.inventory_locations(id) ON DELETE RESTRICT,
  actor_id TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','submitted')),
  submitted_at TIMESTAMPTZ,
  notes TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0)
);
CREATE TABLE wahi_v2.inventory_observations (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES wahi_v2.count_sessions(id) ON DELETE RESTRICT,
  ingredient_id UUID NOT NULL REFERENCES wahi_v2.ingredients(id) ON DELETE RESTRICT,
  quantity NUMERIC NOT NULL CHECK (quantity >= 0 AND quantity::text NOT IN ('NaN','Infinity','-Infinity')),
  unit TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL,
  supersedes_id UUID UNIQUE REFERENCES wahi_v2.inventory_observations(id) ON DELETE RESTRICT,
  reason TEXT,
  conversion JSONB NOT NULL
);
CREATE UNIQUE INDEX inventory_assignment_identity ON wahi_v2.inventory_assignments(location_id,ingredient_id);
CREATE UNIQUE INDEX inventory_observation_root ON wahi_v2.inventory_observations(session_id,ingredient_id) WHERE supersedes_id IS NULL;
CREATE INDEX inventory_observation_lookup ON wahi_v2.inventory_observations(ingredient_id,observed_at,recorded_at);
CREATE INDEX inventory_session_location ON wahi_v2.count_sessions(location_id,observed_at);
ALTER TABLE wahi_v2.count_sessions ADD CONSTRAINT submission_state CHECK (
  (status='draft' AND submitted_at IS NULL) OR (status='submitted' AND submitted_at IS NOT NULL));
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.inventory_items FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.inventory_observations FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();

CREATE FUNCTION wahi_v2.guard_inventory_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Inventory history cannot be deleted'; END IF;
  IF NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'Inventory version conflict';
  END IF;
  IF TG_TABLE_NAME='inventory_assignments' THEN
    IF NEW.ingredient_id<>OLD.ingredient_id OR NEW.location_id<>OLD.location_id THEN
      RAISE EXCEPTION 'Assignment identity is immutable';
    END IF;
  END IF;
  IF TG_TABLE_NAME='count_sessions' THEN
    IF OLD.status<>'draft' OR NEW.status<>'submitted' OR
       (to_jsonb(NEW)-'status'-'submitted_at'-'updated_at'-'version') IS DISTINCT FROM
       (to_jsonb(OLD)-'status'-'submitted_at'-'updated_at'-'version') THEN
      RAISE EXCEPTION 'Only draft submission may update a count session';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_update BEFORE UPDATE OR DELETE ON wahi_v2.inventory_locations FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_inventory_update();
CREATE TRIGGER inventory_update BEFORE UPDATE OR DELETE ON wahi_v2.inventory_assignments FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_inventory_update();
CREATE TRIGGER inventory_update BEFORE UPDATE OR DELETE ON wahi_v2.count_sessions FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_inventory_update();

CREATE FUNCTION wahi_v2.guard_inventory_observation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prior wahi_v2.inventory_observations;
BEGIN
  IF NEW.supersedes_id IS NOT NULL THEN
    SELECT * INTO prior FROM wahi_v2.inventory_observations WHERE id=NEW.supersedes_id;
    IF prior.id IS NULL OR prior.session_id<>NEW.session_id OR prior.ingredient_id<>NEW.ingredient_id
       OR prior.unit<>NEW.unit OR prior.observed_at<>NEW.observed_at THEN
      RAISE EXCEPTION 'Observation correction must retain its identity, unit and observation time';
    END IF;
    IF NEW.conversion IS DISTINCT FROM prior.conversion THEN
      RAISE EXCEPTION 'Observation conversion evidence is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_observation_revision BEFORE INSERT ON wahi_v2.inventory_observations FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_inventory_observation();
