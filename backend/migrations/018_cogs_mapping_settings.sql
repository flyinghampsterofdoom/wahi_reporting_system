-- Preserve existing confirmed portion policies; new mappings explicitly use a
-- whole recipe execution, with no hidden quantity/unit defaults.
ALTER TABLE wahi_v2.cogs_mappings ADD COLUMN mode TEXT NOT NULL DEFAULT 'portion' CHECK(mode IN ('portion','execution'));
ALTER TABLE wahi_v2.cogs_mappings DROP CONSTRAINT cogs_mappings_check;
ALTER TABLE wahi_v2.cogs_mappings ADD CONSTRAINT cogs_mapping_target CHECK(
 state<>'mapped' OR
 (mode='execution' AND recipe_id IS NOT NULL AND menu_item_id IS NULL AND quantity IS NULL AND unit IS NULL) OR
 (mode='portion' AND ((menu_item_id IS NOT NULL AND recipe_id IS NULL) OR (recipe_id IS NOT NULL AND menu_item_id IS NULL AND quantity>0 AND unit IS NOT NULL)))
);
CREATE TABLE wahi_v2.cogs_mapping_settings (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO wahi_v2.cogs_mapping_settings(singleton) VALUES(TRUE);
CREATE TABLE wahi_v2.cogs_eligible_categories (
 category_id UUID PRIMARY KEY REFERENCES wahi_v2.recipe_categories(id) ON DELETE RESTRICT
);
-- One-time Owner-approved initialization; runtime policy uses category IDs only.
INSERT INTO wahi_v2.cogs_eligible_categories(category_id)
 SELECT id FROM wahi_v2.recipe_categories WHERE active AND name IN ('Final','Drink');
CREATE TABLE wahi_v2.cogs_settings_audit (
 id UUID PRIMARY KEY,actor_id TEXT NOT NULL,category_id UUID NOT NULL REFERENCES wahi_v2.recipe_categories(id),
 enabled BOOLEAN NOT NULL,version INTEGER NOT NULL,recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.cogs_settings_audit FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
INSERT INTO wahi_v2.cogs_settings_audit(id,actor_id,category_id,enabled,version)
 SELECT gen_random_uuid(),'owner-approved-migration-018',category_id,TRUE,1 FROM wahi_v2.cogs_eligible_categories;
