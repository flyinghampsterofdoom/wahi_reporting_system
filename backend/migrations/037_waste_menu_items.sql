-- Reuse existing menu identities, including entries whose costing is not yet mapped.
ALTER TABLE wahi_v2.waste_events ADD COLUMN menu_item_id UUID REFERENCES wahi_v2.menu_items(id) ON DELETE RESTRICT;
ALTER TABLE wahi_v2.waste_events ALTER COLUMN ingredient_id DROP NOT NULL;
ALTER TABLE wahi_v2.waste_events DROP CONSTRAINT waste_events_kind_check;
ALTER TABLE wahi_v2.waste_events DROP CONSTRAINT waste_events_check;
ALTER TABLE wahi_v2.waste_events ADD CONSTRAINT waste_events_kind_check CHECK(kind IN ('ingredient','recipe','menu'));
ALTER TABLE wahi_v2.waste_events ADD CONSTRAINT waste_identity CHECK(
 (kind='ingredient' AND ingredient_id IS NOT NULL AND recipe_id IS NULL AND menu_item_id IS NULL)
 OR (kind='recipe' AND ingredient_id IS NOT NULL AND recipe_id IS NOT NULL AND menu_item_id IS NULL)
 OR (kind='menu' AND menu_item_id IS NOT NULL)
);
CREATE INDEX waste_menu_date ON wahi_v2.waste_events(menu_item_id,recorded_at) WHERE menu_item_id IS NOT NULL;
