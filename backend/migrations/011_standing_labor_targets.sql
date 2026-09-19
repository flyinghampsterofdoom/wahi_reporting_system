CREATE TABLE wahi_v2.labor_standing_targets (
 id UUID PRIMARY KEY, revision BIGSERIAL UNIQUE,
 effective_week DATE NOT NULL CHECK(EXTRACT(DOW FROM effective_week)=0),
 foh NUMERIC NOT NULL CHECK(foh>=0), boh NUMERIC NOT NULL CHECK(boh>=0),
 actor_id TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL,
 source_target_id UUID REFERENCES wahi_v2.labor_targets(id)
);
CREATE INDEX labor_standing_target_resolution ON wahi_v2.labor_standing_targets(effective_week DESC,revision DESC);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON wahi_v2.labor_standing_targets FOR EACH ROW EXECUTE FUNCTION wahi_v2.reject_history_mutation();
-- Preserve original per-week records and audit verbatim. If any exist, carry the
-- latest applicable target forward from the migration's current business week.
-- Never create numeric values when no target was established.
DO $$ DECLARE s RECORD; day DATE; sunday DATE; old RECORD; BEGIN
 SELECT * INTO s FROM wahi_v2.labor_settings;
 IF EXISTS(SELECT 1 FROM wahi_v2.labor_targets) THEN
  IF s.timezone IS NULL THEN RAISE EXCEPTION 'Existing targets require timezone review'; END IF;
  day:=((CURRENT_TIMESTAMP AT TIME ZONE s.timezone)-make_interval(hours=>s.closeout_hour))::date;
  sunday:=day-EXTRACT(DOW FROM day)::integer;
  SELECT * INTO old FROM wahi_v2.labor_targets WHERE week_date<=sunday ORDER BY week_date DESC,recorded_at DESC LIMIT 1;
  IF FOUND THEN
   INSERT INTO wahi_v2.labor_standing_targets(id,effective_week,foh,boh,actor_id,recorded_at,source_target_id)
   VALUES(old.id,sunday,old.foh,old.boh,'standing-target-migration',CURRENT_TIMESTAMP,old.id);
  END IF;
 END IF;
END $$;
