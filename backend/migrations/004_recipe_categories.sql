-- Administrative organization only; costing identities and recipe revisions unchanged.
CREATE TABLE wahi_v2.recipe_categories (
 id UUID PRIMARY KEY,
 created_at TIMESTAMPTZ NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL,
 name TEXT NOT NULL,
 sort_order INTEGER NOT NULL,
 active BOOLEAN NOT NULL
);
CREATE TABLE wahi_v2.recipe_category_assignments (
 id UUID PRIMARY KEY,
 effective_at TIMESTAMPTZ,
 recorded_at TIMESTAMPTZ NOT NULL,
 actor_id TEXT NOT NULL,
 provenance JSONB NOT NULL,
 note TEXT,
 supersedes_id UUID UNIQUE REFERENCES wahi_v2.recipe_category_assignments(id) ON DELETE RESTRICT,
 active BOOLEAN NOT NULL,
 recipe_id UUID NOT NULL REFERENCES wahi_v2.recipes(id) ON DELETE RESTRICT,
 category_id UUID REFERENCES wahi_v2.recipe_categories(id) ON DELETE RESTRICT
);
CREATE INDEX ON wahi_v2.recipe_category_assignments(recipe_id,effective_at,recorded_at);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.recipe_category_assignments FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER revision_stream BEFORE INSERT ON wahi_v2.recipe_category_assignments FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_revision_stream('recipe_id');
CREATE FUNCTION wahi_v2.guard_category_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Archive categories instead of deleting'; END IF;
 IF NEW.id<>OLD.id OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Category identity is immutable'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER category_identity BEFORE UPDATE OR DELETE ON wahi_v2.recipe_categories FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_category_identity();
