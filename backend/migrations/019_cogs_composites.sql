-- Interpretation only: no source sales, recipe facts or Owner mappings changed.
CREATE TABLE wahi_v2.cogs_composites (
 id UUID PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL,
 definition JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE wahi_v2.cogs_composite_audit (
 id UUID PRIMARY KEY, composite_id UUID NOT NULL REFERENCES wahi_v2.cogs_composites(id),
 actor_id TEXT NOT NULL, previous JSONB, next JSONB NOT NULL,
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.cogs_composite_audit FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
ALTER TABLE wahi_v2.cogs_mappings ADD COLUMN composite_id UUID REFERENCES wahi_v2.cogs_composites(id);
CREATE INDEX cogs_composite_parents ON wahi_v2.cogs_mappings(composite_id) WHERE composite_id IS NOT NULL;
ALTER TABLE wahi_v2.cogs_mappings DROP CONSTRAINT cogs_mappings_mode_check;
ALTER TABLE wahi_v2.cogs_mappings ADD CONSTRAINT cogs_mappings_mode_check CHECK(mode IN ('portion','execution','composite'));
ALTER TABLE wahi_v2.cogs_mappings DROP CONSTRAINT cogs_mapping_target;
ALTER TABLE wahi_v2.cogs_mappings ADD CONSTRAINT cogs_mapping_target CHECK(
 (state<>'mapped' AND composite_id IS NULL) OR
 (state='mapped' AND (
 (mode='composite' AND composite_id IS NOT NULL AND recipe_id IS NULL AND menu_item_id IS NULL AND quantity IS NULL AND unit IS NULL) OR
 (composite_id IS NULL AND mode='execution' AND recipe_id IS NOT NULL AND menu_item_id IS NULL AND quantity IS NULL AND unit IS NULL) OR
 (composite_id IS NULL AND mode='portion' AND ((menu_item_id IS NOT NULL AND recipe_id IS NULL) OR (recipe_id IS NOT NULL AND menu_item_id IS NULL AND quantity>0 AND unit IS NOT NULL)))
 ))
);
