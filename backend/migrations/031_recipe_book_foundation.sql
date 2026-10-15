-- Recipe namespace starts at 031. Preserve reserved 021 and 024–030 unchanged.
-- Service documents never write domain recipe revisions, bases, mappings or inventory.
ALTER TABLE wahi_v2.users DROP CONSTRAINT users_role_check;
ALTER TABLE wahi_v2.users ADD CONSTRAINT users_role_check
 CHECK (role IN ('ADMIN','MANAGER','LEAD','STAFF','BOH','RECIPE_ONLY'));
CREATE FUNCTION wahi_v2.guard_recipe_station() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  IF OLD.username IN ('well.one','well.two') THEN RAISE EXCEPTION 'Station identity is protected'; END IF;
  RETURN OLD;
 END IF;
 IF NEW.username IN ('well.one','well.two') AND NEW.role <> 'RECIPE_ONLY' THEN
  RAISE EXCEPTION 'Station identities require recipe-only access';
 END IF;
 IF TG_OP = 'UPDATE' AND OLD.username IN ('well.one','well.two') AND NEW.username <> OLD.username THEN
  RAISE EXCEPTION 'Station identity cannot be renamed';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recipe_station_guard BEFORE INSERT OR UPDATE OR DELETE ON wahi_v2.users
 FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_recipe_station();
CREATE TABLE wahi_v2.recipe_book_entries (
 id UUID PRIMARY KEY, source_recipe_id UUID REFERENCES wahi_v2.recipes(id) ON DELETE RESTRICT,
 menu_status TEXT NOT NULL CHECK(menu_status IN ('on_menu','off_menu')),
 archived BOOLEAN NOT NULL DEFAULT false, version INTEGER NOT NULL CHECK(version>0),
 published_id UUID, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
 created_by TEXT NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE wahi_v2.recipe_book_drafts (
 entry_id UUID PRIMARY KEY REFERENCES wahi_v2.recipe_book_entries(id) ON DELETE RESTRICT,
 document JSONB NOT NULL CHECK(jsonb_typeof(document)='object'),
 updated_at TIMESTAMPTZ NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE wahi_v2.recipe_book_media (
 id UUID PRIMARY KEY, object_key TEXT NOT NULL UNIQUE, mime_type TEXT NOT NULL,
 sha256 TEXT NOT NULL, width INTEGER NOT NULL CHECK(width>0), height INTEGER NOT NULL CHECK(height>0),
 approved BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL, created_by TEXT NOT NULL
);
CREATE TABLE wahi_v2.recipe_book_versions (
 id UUID PRIMARY KEY, entry_id UUID NOT NULL REFERENCES wahi_v2.recipe_book_entries(id) ON DELETE RESTRICT,
 number INTEGER NOT NULL CHECK(number>0), document JSONB NOT NULL CHECK(jsonb_typeof(document)='object'),
 photo_id UUID REFERENCES wahi_v2.recipe_book_media(id) ON DELETE RESTRICT,
 published_at TIMESTAMPTZ NOT NULL, published_by TEXT NOT NULL,
 UNIQUE(entry_id,number), UNIQUE(entry_id,id)
);
ALTER TABLE wahi_v2.recipe_book_entries ADD CONSTRAINT recipe_book_current_publication
 FOREIGN KEY(id,published_id) REFERENCES wahi_v2.recipe_book_versions(entry_id,id) ON DELETE RESTRICT;
CREATE TABLE wahi_v2.recipe_book_events (
 id UUID PRIMARY KEY, entry_id UUID NOT NULL REFERENCES wahi_v2.recipe_book_entries(id) ON DELETE RESTRICT,
 event TEXT NOT NULL, actor_id TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL,
 details JSONB NOT NULL
);
CREATE INDEX recipe_book_event_history ON wahi_v2.recipe_book_events(entry_id,recorded_at);
CREATE TRIGGER recipe_book_versions_immutable BEFORE UPDATE OR DELETE ON wahi_v2.recipe_book_versions
 FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER recipe_book_events_immutable BEFORE UPDATE OR DELETE ON wahi_v2.recipe_book_events
 FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
