-- Owner-approved interpretation metadata; original source, results and releases stay intact.
CREATE TABLE wahi_v2.review_interpretations (
 id UUID PRIMARY KEY,
 location_id UUID NOT NULL REFERENCES wahi_v2.review_locations(id),
 review_id UUID NOT NULL REFERENCES wahi_v2.review_records(id),
 version_id UUID NOT NULL REFERENCES wahi_v2.review_source_versions(id),
 result_id UUID REFERENCES wahi_v2.review_results(id),
 original_output_hash TEXT,
 batch_ref TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 audit_ref TEXT NOT NULL,
 verdict TEXT NOT NULL,
 assessment TEXT,
 priority BOOLEAN NOT NULL DEFAULT FALSE,
 changes JSONB NOT NULL CHECK(jsonb_typeof(changes)='array'),
 approved_by TEXT NOT NULL,
 approved_at TIMESTAMPTZ NOT NULL,
 UNIQUE(location_id,batch_ref,review_id)
);
CREATE INDEX review_interpretation_result ON wahi_v2.review_interpretations(result_id,approved_at DESC);
CREATE INDEX review_interpretation_version ON wahi_v2.review_interpretations(version_id);
CREATE FUNCTION wahi_v2.guard_review_interpretation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.assessment IS NULL AND OLD.assessment IS NOT NULL
 AND (to_jsonb(NEW)-'assessment')=(to_jsonb(OLD)-'assessment') THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Review interpretation history is immutable';
END $$;
CREATE TRIGGER immutable_interpretation BEFORE UPDATE OR DELETE ON wahi_v2.review_interpretations
 FOR EACH ROW EXECUTE FUNCTION wahi_v2.guard_review_interpretation();
-- A read projection, never an UPDATE of the analytical record. A different source
-- version or changed result hash cannot inherit an earlier approval silently.
CREATE VIEW wahi_v2.review_effective_results AS
SELECT x.id,x.review_id,x.config_id,x.text_hash,x.model,x.created_at,x.expires_at,
 x.output AS original_output,a.id AS interpretation_id,
 CASE WHEN a.id IS NULL OR x.output IS NULL THEN x.output ELSE
 jsonb_set(x.output,'{observations}',COALESCE((
  SELECT jsonb_agg(CASE WHEN patch.change->>'action'='sentiment'
   THEN jsonb_set(o.value,'{sentiment}',patch.change->'value') ELSE o.value END ORDER BY o.ordinality)
  FROM jsonb_array_elements(x.output->'observations') WITH ORDINALITY o(value,ordinality)
  LEFT JOIN LATERAL (SELECT value AS change FROM jsonb_array_elements(a.changes)
   WHERE (value->>'index')::int=o.ordinality-1 LIMIT 1) patch ON TRUE
  WHERE COALESCE(patch.change->>'action','')<>'remove'
 ),'[]'::jsonb)) END AS output
FROM wahi_v2.review_results x
LEFT JOIN LATERAL (
 SELECT i.id,i.changes FROM wahi_v2.review_interpretations i
 JOIN wahi_v2.review_records r ON r.id=i.review_id AND r.head_id=i.version_id
 JOIN wahi_v2.review_source_versions v ON v.id=i.version_id AND v.review_id=x.review_id AND v.text_hash=x.text_hash
 WHERE i.result_id=x.id AND i.review_id=x.review_id AND i.original_output_hash=md5(x.output::text)
 ORDER BY i.approved_at DESC,i.id DESC LIMIT 1
) a ON TRUE;
