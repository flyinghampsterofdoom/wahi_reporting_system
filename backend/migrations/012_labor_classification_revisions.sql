-- Preserve every classification as immutable evidence. Sequence resolves same-date corrections.
ALTER TABLE wahi_v2.labor_classifications ADD COLUMN revision BIGSERIAL UNIQUE;
DROP INDEX wahi_v2.labor_classification_resolution;
CREATE INDEX labor_classification_resolution ON wahi_v2.labor_classifications(job_guid,effective_date DESC,revision DESC);
