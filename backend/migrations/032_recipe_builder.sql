-- Recipe Book namespace: 031 foundation, 032 builder. Reserved 021,024–030 unchanged.
CREATE TABLE wahi_v2.recipe_book_common_items (
 id UUID PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 500),
 component JSONB NOT NULL CHECK(jsonb_typeof(component)='object'),
 created_at TIMESTAMPTZ NOT NULL, created_by TEXT NOT NULL
);
ALTER TABLE wahi_v2.recipe_book_media ADD COLUMN entry_id UUID
 REFERENCES wahi_v2.recipe_book_entries(id) ON DELETE RESTRICT;
-- Immutable media identity/content; approval may be revoked for security.
CREATE FUNCTION wahi_v2.guard_recipe_media() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Media history is retained'; END IF;
 IF (to_jsonb(NEW) - 'approved') IS DISTINCT FROM (to_jsonb(OLD) - 'approved') THEN
  RAISE EXCEPTION 'Media content is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_book_media_immutable BEFORE UPDATE OR DELETE ON wahi_v2.recipe_book_media
 FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_recipe_media();
