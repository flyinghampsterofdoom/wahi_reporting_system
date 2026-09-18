-- Immutable source evidence, separate from operational facts and costing.
CREATE TABLE wahi_v2.import_records (
 id UUID PRIMARY KEY,
 source_file TEXT NOT NULL,
 source_hash TEXT NOT NULL,
 sheet TEXT NOT NULL,
 source_row INTEGER NOT NULL,
 logical_type TEXT NOT NULL,
 source_values JSONB NOT NULL,
 classification TEXT NOT NULL,
 issues JSONB NOT NULL,
 entity_ids JSONB NOT NULL,
 imported_at TIMESTAMPTZ NOT NULL
);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.import_records FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
ALTER TABLE wahi_v2.recipe_lines ADD COLUMN notes TEXT NOT NULL DEFAULT '';
