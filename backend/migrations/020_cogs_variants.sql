-- Reporting interpretation only; existing policies and source facts are retained.
CREATE TABLE wahi_v2.cogs_variants (
 id UUID PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL,
 definition JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE wahi_v2.cogs_variant_audit (
 id UUID PRIMARY KEY, variant_id UUID NOT NULL REFERENCES wahi_v2.cogs_variants(id),
 actor_id TEXT NOT NULL, previous JSONB, next JSONB NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.cogs_variant_audit FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
ALTER TABLE wahi_v2.cogs_mappings ADD COLUMN variant_id UUID REFERENCES wahi_v2.cogs_variants(id);
CREATE INDEX cogs_variant_parents ON wahi_v2.cogs_mappings(variant_id) WHERE variant_id IS NOT NULL;
ALTER TABLE wahi_v2.cogs_mappings DROP CONSTRAINT cogs_mappings_mode_check;
ALTER TABLE wahi_v2.cogs_mappings ADD CONSTRAINT cogs_mappings_mode_check CHECK(mode IN ('portion','execution','composite','variant'));
ALTER TABLE wahi_v2.cogs_mappings DROP CONSTRAINT cogs_mapping_target;
ALTER TABLE wahi_v2.cogs_mappings ADD CONSTRAINT cogs_mapping_target CHECK(
 (state<>'mapped' AND composite_id IS NULL AND variant_id IS NULL) OR
 (state='mapped' AND (
 (mode='variant' AND variant_id IS NOT NULL AND composite_id IS NULL AND recipe_id IS NULL AND menu_item_id IS NULL AND quantity IS NULL AND unit IS NULL) OR
 (variant_id IS NULL AND (
 (mode='composite' AND composite_id IS NOT NULL AND recipe_id IS NULL AND menu_item_id IS NULL AND quantity IS NULL AND unit IS NULL) OR
 (composite_id IS NULL AND mode='execution' AND recipe_id IS NOT NULL AND menu_item_id IS NULL AND quantity IS NULL AND unit IS NULL) OR
 (composite_id IS NULL AND mode='portion' AND ((menu_item_id IS NOT NULL AND recipe_id IS NULL) OR (recipe_id IS NOT NULL AND menu_item_id IS NULL AND quantity>0 AND unit IS NOT NULL)))
 ))))
);
CREATE TABLE wahi_v2.cogs_choice_labels (
 id UUID PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('group','option')),
 observed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
