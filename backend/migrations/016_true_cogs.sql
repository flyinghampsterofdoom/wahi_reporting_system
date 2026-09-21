CREATE TABLE wahi_v2.sales_items (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, group_id UUID, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE wahi_v2.sales_facts (
 id UUID PRIMARY KEY, order_id UUID NOT NULL, item_id TEXT NOT NULL REFERENCES wahi_v2.sales_items(id),
 business_date DATE NOT NULL, source JSONB NOT NULL, source_hash TEXT NOT NULL, present BOOLEAN NOT NULL DEFAULT TRUE,
 synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sales_facts_period ON wahi_v2.sales_facts(business_date,item_id) WHERE present;
CREATE TABLE wahi_v2.sales_fact_versions (
 selection_id UUID NOT NULL, source_hash TEXT NOT NULL, source JSONB NOT NULL,
 observed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(selection_id,source_hash)
);
CREATE TABLE wahi_v2.sales_sync_days (
 business_date DATE PRIMARY KEY, synced_at TIMESTAMPTZ NOT NULL, orders INTEGER NOT NULL, selections INTEGER NOT NULL, api_calls INTEGER NOT NULL
);
CREATE TABLE wahi_v2.sales_sync_state (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton), attempted_at TIMESTAMPTZ, failure_code TEXT
);
INSERT INTO wahi_v2.sales_sync_state(singleton) VALUES(TRUE);
CREATE TABLE wahi_v2.cogs_mappings (
 item_id TEXT PRIMARY KEY REFERENCES wahi_v2.sales_items(id), state TEXT NOT NULL CHECK(state IN ('mapped','excluded','unmapped')),
 recipe_id UUID REFERENCES wahi_v2.recipes(id), menu_item_id UUID REFERENCES wahi_v2.menu_items(id), quantity NUMERIC, unit TEXT,
 version INTEGER NOT NULL DEFAULT 1, provenance TEXT NOT NULL CHECK(provenance IN ('admin','stable_identity')),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(state<>'mapped' OR ((menu_item_id IS NOT NULL AND recipe_id IS NULL) OR (recipe_id IS NOT NULL AND menu_item_id IS NULL AND quantity>0 AND unit IS NOT NULL)))
);
CREATE TABLE wahi_v2.cogs_mapping_audit (
 id UUID PRIMARY KEY, item_id TEXT NOT NULL REFERENCES wahi_v2.sales_items(id), actor_id TEXT NOT NULL,
 previous JSONB, next JSONB NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.cogs_mapping_audit FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TABLE wahi_v2.cogs_knowledge (
 business_date DATE NOT NULL,item_id TEXT NOT NULL REFERENCES wahi_v2.sales_items(id),
 dirty BOOLEAN NOT NULL DEFAULT TRUE, dependencies UUID[] NOT NULL DEFAULT '{}',menu_item_id UUID,
 payload JSONB, generation INTEGER NOT NULL DEFAULT 0, generated_at TIMESTAMPTZ, valid_until TIMESTAMPTZ,
 PRIMARY KEY(business_date,item_id)
);
CREATE INDEX cogs_dependency_lookup ON wahi_v2.cogs_knowledge USING GIN(dependencies);
CREATE TABLE wahi_v2.cogs_knowledge_history (
 business_date DATE NOT NULL,item_id TEXT NOT NULL,generation INTEGER NOT NULL,payload JSONB NOT NULL,generated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(business_date,item_id,generation)
);
-- Invalidate only materializations whose recorded dependency closure contains
-- the changed item. Recipe/yield corrections expand that closure on rebuild.
CREATE FUNCTION wahi_v2.invalidate_cogs() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject UUID;
BEGIN
 IF TG_TABLE_NAME='labor_rates' THEN
  UPDATE wahi_v2.cogs_knowledge SET dirty=TRUE WHERE cardinality(dependencies)>0;
  RETURN NEW;
 ELSIF TG_TABLE_NAME='menu_mappings' THEN
  UPDATE wahi_v2.cogs_knowledge SET dirty=TRUE WHERE menu_item_id=NEW.menu_item_id;
  RETURN NEW;
 ELSIF TG_TABLE_NAME='prices' THEN SELECT ingredient_id INTO subject FROM wahi_v2.purchase_options WHERE id=NEW.purchase_option_id;
 ELSIF TG_TABLE_NAME='recipe_revisions' THEN SELECT output_ingredient_id INTO subject FROM wahi_v2.recipes WHERE id=NEW.recipe_id;
 ELSIF TG_TABLE_NAME='recipes' THEN subject:=NEW.output_ingredient_id;
 ELSIF TG_TABLE_NAME='ingredients' THEN subject:=NEW.id;
 ELSE subject:=NEW.ingredient_id;
 END IF;
 UPDATE wahi_v2.cogs_knowledge SET dirty=TRUE WHERE dependencies @> ARRAY[subject];
 RETURN NEW;
END; $$;
DO $$ DECLARE t TEXT; BEGIN
 FOREACH t IN ARRAY ARRAY['ingredients','recipes','recipe_revisions','bases','yields','measurements','prices','purchase_options','labor','labor_rates','menu_mappings'] LOOP
 EXECUTE format('CREATE TRIGGER cogs_invalidate AFTER INSERT OR UPDATE ON wahi_v2.%I FOR EACH ROW EXECUTE FUNCTION wahi_v2.invalidate_cogs()',t);
 END LOOP;
END; $$;
