-- Explicit Phase 1 migration. Run only through backend/migrate.js.

CREATE TABLE wahi_v2.ingredients (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  tags JSONB NOT NULL,
  active BOOLEAN NOT NULL
);

CREATE TABLE wahi_v2.suppliers (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  name TEXT NOT NULL,
  contact TEXT NOT NULL
);

CREATE TABLE wahi_v2.purchase_options (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  ingredient_id UUID NOT NULL REFERENCES wahi_v2.ingredients(id) ON DELETE RESTRICT,
  supplier_id UUID REFERENCES wahi_v2.suppliers(id) ON DELETE RESTRICT,
  sku TEXT NOT NULL,
  label TEXT NOT NULL,
  content_quantity NUMERIC CHECK (content_quantity > 0) NOT NULL,
  content_unit TEXT NOT NULL
);

CREATE TABLE wahi_v2.recipes (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  name TEXT NOT NULL,
  output_ingredient_id UUID NOT NULL REFERENCES wahi_v2.ingredients(id) ON DELETE RESTRICT UNIQUE
);

CREATE TABLE wahi_v2.menu_items (
  id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL
);

CREATE TABLE wahi_v2.bases (
  id UUID PRIMARY KEY,
  effective_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL,
  provenance JSONB NOT NULL,
  note TEXT,
  supersedes_id UUID UNIQUE,
  active BOOLEAN NOT NULL,
  ingredient_id UUID NOT NULL REFERENCES wahi_v2.ingredients(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('purchase','source','recipe','labor_only')),
  purchase_option_id UUID REFERENCES wahi_v2.purchase_options(id) ON DELETE RESTRICT,
  recipe_id UUID REFERENCES wahi_v2.recipes(id) ON DELETE RESTRICT,
  FOREIGN KEY (supersedes_id) REFERENCES wahi_v2.bases(id) ON DELETE RESTRICT
);
CREATE INDEX ON wahi_v2.bases (ingredient_id, effective_at, recorded_at);
CREATE INDEX ON wahi_v2.bases (purchase_option_id, effective_at, recorded_at);
CREATE INDEX ON wahi_v2.bases (recipe_id, effective_at, recorded_at);

CREATE TABLE wahi_v2.yields (
  id UUID PRIMARY KEY,
  effective_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL,
  provenance JSONB NOT NULL,
  note TEXT,
  supersedes_id UUID UNIQUE,
  active BOOLEAN NOT NULL,
  ingredient_id UUID NOT NULL REFERENCES wahi_v2.ingredients(id) ON DELETE RESTRICT,
  source_ingredient_id UUID NOT NULL REFERENCES wahi_v2.ingredients(id) ON DELETE RESTRICT,
  source_quantity NUMERIC CHECK (source_quantity > 0),
  source_unit TEXT,
  output_quantity NUMERIC CHECK (output_quantity > 0),
  output_unit TEXT,
  FOREIGN KEY (supersedes_id) REFERENCES wahi_v2.yields(id) ON DELETE RESTRICT
);
CREATE INDEX ON wahi_v2.yields (ingredient_id, effective_at, recorded_at);

CREATE TABLE wahi_v2.measurements (
  id UUID PRIMARY KEY,
  effective_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL,
  provenance JSONB NOT NULL,
  note TEXT,
  supersedes_id UUID UNIQUE,
  active BOOLEAN NOT NULL,
  ingredient_id UUID NOT NULL REFERENCES wahi_v2.ingredients(id) ON DELETE RESTRICT,
  measurement_key UUID NOT NULL,
  from_quantity NUMERIC CHECK (from_quantity > 0) NOT NULL,
  from_unit TEXT NOT NULL,
  to_quantity NUMERIC CHECK (to_quantity > 0) NOT NULL,
  to_unit TEXT NOT NULL,
  FOREIGN KEY (supersedes_id) REFERENCES wahi_v2.measurements(id) ON DELETE RESTRICT
);
CREATE INDEX ON wahi_v2.measurements (ingredient_id, effective_at, recorded_at);
CREATE INDEX ON wahi_v2.measurements (measurement_key, effective_at, recorded_at);

CREATE TABLE wahi_v2.recipe_revisions (
  id UUID PRIMARY KEY,
  effective_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL,
  provenance JSONB NOT NULL,
  note TEXT,
  supersedes_id UUID UNIQUE,
  active BOOLEAN NOT NULL,
  recipe_id UUID NOT NULL REFERENCES wahi_v2.recipes(id) ON DELETE RESTRICT,
  output_quantity NUMERIC CHECK (output_quantity > 0),
  output_unit TEXT,
  FOREIGN KEY (supersedes_id) REFERENCES wahi_v2.recipe_revisions(id) ON DELETE RESTRICT
);
CREATE INDEX ON wahi_v2.recipe_revisions (recipe_id, effective_at, recorded_at);

CREATE TABLE wahi_v2.prices (
  id UUID PRIMARY KEY,
  effective_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL,
  provenance JSONB NOT NULL,
  note TEXT,
  supersedes_id UUID UNIQUE,
  active BOOLEAN NOT NULL,
  purchase_option_id UUID NOT NULL REFERENCES wahi_v2.purchase_options(id) ON DELETE RESTRICT,
  amount NUMERIC CHECK (amount >= 0) NOT NULL,
  currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  FOREIGN KEY (supersedes_id) REFERENCES wahi_v2.prices(id) ON DELETE RESTRICT
);
CREATE INDEX ON wahi_v2.prices (purchase_option_id, effective_at, recorded_at);

CREATE TABLE wahi_v2.labor (
  id UUID PRIMARY KEY,
  effective_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL,
  provenance JSONB NOT NULL,
  note TEXT,
  supersedes_id UUID UNIQUE,
  active BOOLEAN NOT NULL,
  ingredient_id UUID NOT NULL REFERENCES wahi_v2.ingredients(id) ON DELETE RESTRICT,
  component_key UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fixed','time')),
  output_quantity NUMERIC CHECK (output_quantity > 0),
  output_unit TEXT,
  amount NUMERIC CHECK (amount >= 0),
  currency TEXT,
  minutes NUMERIC CHECK (minutes >= 0),
  department TEXT CHECK (department IN ('FOH','BOH')),
  FOREIGN KEY (supersedes_id) REFERENCES wahi_v2.labor(id) ON DELETE RESTRICT
);
CREATE INDEX ON wahi_v2.labor (ingredient_id, effective_at, recorded_at);
CREATE INDEX ON wahi_v2.labor (component_key, effective_at, recorded_at);
CREATE INDEX ON wahi_v2.labor (department, effective_at, recorded_at);

CREATE TABLE wahi_v2.labor_rates (
  id UUID PRIMARY KEY,
  effective_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL,
  provenance JSONB NOT NULL,
  note TEXT,
  supersedes_id UUID UNIQUE,
  active BOOLEAN NOT NULL,
  department TEXT NOT NULL CHECK (department IN ('FOH','BOH')),
  amount NUMERIC CHECK (amount >= 0) NOT NULL,
  currency TEXT NOT NULL,
  FOREIGN KEY (supersedes_id) REFERENCES wahi_v2.labor_rates(id) ON DELETE RESTRICT
);
CREATE INDEX ON wahi_v2.labor_rates (department, effective_at, recorded_at);

CREATE TABLE wahi_v2.selling_prices (
  id UUID PRIMARY KEY,
  effective_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL,
  provenance JSONB NOT NULL,
  note TEXT,
  supersedes_id UUID UNIQUE,
  active BOOLEAN NOT NULL,
  menu_item_id UUID NOT NULL REFERENCES wahi_v2.menu_items(id) ON DELETE RESTRICT,
  amount NUMERIC CHECK (amount >= 0) NOT NULL,
  currency TEXT NOT NULL,
  FOREIGN KEY (supersedes_id) REFERENCES wahi_v2.selling_prices(id) ON DELETE RESTRICT
);
CREATE INDEX ON wahi_v2.selling_prices (menu_item_id, effective_at, recorded_at);

CREATE TABLE wahi_v2.menu_mappings (
  id UUID PRIMARY KEY,
  effective_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL,
  actor_id TEXT NOT NULL,
  provenance JSONB NOT NULL,
  note TEXT,
  supersedes_id UUID UNIQUE,
  active BOOLEAN NOT NULL,
  menu_item_id UUID NOT NULL REFERENCES wahi_v2.menu_items(id) ON DELETE RESTRICT,
  recipe_id UUID NOT NULL REFERENCES wahi_v2.recipes(id) ON DELETE RESTRICT,
  quantity NUMERIC CHECK (quantity > 0) NOT NULL,
  unit TEXT NOT NULL,
  FOREIGN KEY (supersedes_id) REFERENCES wahi_v2.menu_mappings(id) ON DELETE RESTRICT
);
CREATE INDEX ON wahi_v2.menu_mappings (menu_item_id, effective_at, recorded_at);
CREATE INDEX ON wahi_v2.menu_mappings (recipe_id, effective_at, recorded_at);

CREATE TABLE wahi_v2.audit (
  id UUID PRIMARY KEY,
  actor_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  previous JSONB,
  next JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  effective_at TIMESTAMPTZ,
  provenance JSONB NOT NULL,
  note TEXT,
  change_id UUID NOT NULL
);

CREATE TABLE wahi_v2.recipe_lines (
 id UUID PRIMARY KEY, recipe_revision_id UUID NOT NULL REFERENCES wahi_v2.recipe_revisions(id) ON DELETE RESTRICT,
 position INTEGER NOT NULL CHECK(position >= 0), ingredient_id UUID NOT NULL REFERENCES wahi_v2.ingredients(id) ON DELETE RESTRICT,
 quantity NUMERIC CHECK(quantity >= 0), unit TEXT, UNIQUE(recipe_revision_id,position)
);
CREATE INDEX ON wahi_v2.recipe_lines(ingredient_id);
CREATE TABLE wahi_v2.recipe_steps (
 id UUID PRIMARY KEY, recipe_revision_id UUID NOT NULL REFERENCES wahi_v2.recipe_revisions(id) ON DELETE RESTRICT,
 position INTEGER NOT NULL CHECK(position >= 0), instruction TEXT NOT NULL, UNIQUE(recipe_revision_id,position)
);
CREATE INDEX ON wahi_v2.audit(entity_id,recorded_at);
CREATE INDEX ON wahi_v2.audit(change_id);
CREATE FUNCTION wahi_v2.reject_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'History is append-only; create a revision instead'; END;
$$;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.bases FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.yields FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.measurements FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.recipe_revisions FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.prices FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.labor FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.labor_rates FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.selling_prices FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.menu_mappings FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.audit FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.recipe_lines FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.recipe_steps FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.purchase_options FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.recipes FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
