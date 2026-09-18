-- Preserve immutable business facts while supporting audited soft archival.
ALTER TABLE wahi_v2.suppliers ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE wahi_v2.purchase_options ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE wahi_v2.recipes ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;
CREATE FUNCTION wahi_v2.identity_lifecycle_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Identity deletion is forbidden'; END IF;
  IF (to_jsonb(OLD) - 'active' - 'updated_at') IS DISTINCT FROM
     (to_jsonb(NEW) - 'active' - 'updated_at') THEN
    RAISE EXCEPTION 'Identity facts are append-only; only archival may change';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER append_only ON wahi_v2.purchase_options;
DROP TRIGGER append_only ON wahi_v2.recipes;
CREATE TRIGGER immutable_identity BEFORE UPDATE OR DELETE ON wahi_v2.purchase_options FOR EACH ROW EXECUTE FUNCTION wahi_v2.identity_lifecycle_only();
CREATE TRIGGER immutable_identity BEFORE UPDATE OR DELETE ON wahi_v2.recipes FOR EACH ROW EXECUTE FUNCTION wahi_v2.identity_lifecycle_only();
-- PostgreSQL NUMERIC considers NaN greater than finite numbers: positivity alone
-- is insufficient. Apply a finite guard to every numeric domain column.
DO $$ DECLARE c RECORD; BEGIN
  FOR c IN SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='wahi_v2' AND data_type='numeric'
  LOOP
    EXECUTE format('ALTER TABLE wahi_v2.%I ADD CONSTRAINT %I CHECK (%I::text NOT IN (''NaN'',''Infinity'',''-Infinity''))',
      c.table_name,c.column_name||'_finite',c.column_name);
  END LOOP;
END $$;

-- Enforce deterministic revision streams even if an internal SQL caller forgets
-- the service collision check. Supersession must retain scope and effective time.
CREATE FUNCTION wahi_v2.guard_revision_stream() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_row JSONB; collision BOOLEAN; scope_value JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(781902641);
  scope_value := to_jsonb(NEW)->TG_ARGV[0];
  IF NEW.supersedes_id IS NOT NULL THEN
    EXECUTE format('SELECT to_jsonb(t) FROM wahi_v2.%I t WHERE id=$1',TG_TABLE_NAME)
      INTO old_row USING NEW.supersedes_id;
    IF old_row IS NULL OR old_row->TG_ARGV[0] IS DISTINCT FROM scope_value
       OR (old_row->>'effective_at')::timestamptz IS DISTINCT FROM NEW.effective_at THEN
      RAISE EXCEPTION 'Supersession requires the same scope and effective time';
    END IF;
  ELSIF NEW.effective_at IS NOT NULL THEN
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM wahi_v2.%I t WHERE to_jsonb(t)->%L=$1 AND effective_at=$2)',TG_TABLE_NAME,TG_ARGV[0])
      INTO collision USING scope_value,NEW.effective_at;
    IF collision THEN RAISE EXCEPTION 'Effective-time collision requires explicit supersedes_id'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER revision_stream BEFORE INSERT ON wahi_v2.bases FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_revision_stream('ingredient_id');
CREATE TRIGGER revision_stream BEFORE INSERT ON wahi_v2.yields FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_revision_stream('ingredient_id');
CREATE TRIGGER revision_stream BEFORE INSERT ON wahi_v2.measurements FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_revision_stream('measurement_key');
CREATE TRIGGER revision_stream BEFORE INSERT ON wahi_v2.recipe_revisions FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_revision_stream('recipe_id');
CREATE TRIGGER revision_stream BEFORE INSERT ON wahi_v2.prices FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_revision_stream('purchase_option_id');
CREATE TRIGGER revision_stream BEFORE INSERT ON wahi_v2.labor FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_revision_stream('component_key');
CREATE TRIGGER revision_stream BEFORE INSERT ON wahi_v2.labor_rates FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_revision_stream('department');
CREATE TRIGGER revision_stream BEFORE INSERT ON wahi_v2.selling_prices FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_revision_stream('menu_item_id');
CREATE TRIGGER revision_stream BEFORE INSERT ON wahi_v2.menu_mappings FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_revision_stream('menu_item_id');
