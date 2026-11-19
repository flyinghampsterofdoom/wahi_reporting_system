-- Ingredient allergen declarations are independent of existing descriptive tags.
-- Existing records start with no identified allergens; histories are preserved.
CREATE FUNCTION wahi_v2.valid_ingredient_allergens(value JSONB) RETURNS BOOLEAN
 LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
 SELECT CASE WHEN jsonb_typeof(value) <> 'array' THEN false ELSE
  jsonb_array_length(value) <= 8
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value) AS tags(tag)
   WHERE jsonb_typeof(tag) <> 'string' OR tag #>> '{}' NOT IN
    ('Milk','Eggs','Fish','Shellfish','Tree Nuts','Peanuts','Wheat','Soy'))
  AND jsonb_array_length(value) = (SELECT count(DISTINCT tag) FROM jsonb_array_elements(value) AS tags(tag))
 END
$$;
ALTER TABLE wahi_v2.ingredients ADD COLUMN allergens JSONB NOT NULL DEFAULT '[]'::jsonb
 CHECK(wahi_v2.valid_ingredient_allergens(allergens));
