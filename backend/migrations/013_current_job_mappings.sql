-- Classification evidence remains immutable; only the explicit current pointer controls reports.
ALTER TABLE wahi_v2.labor_classifications ADD CONSTRAINT labor_classification_job_id UNIQUE(job_guid,id);
CREATE TABLE wahi_v2.labor_job_mappings (
 job_guid TEXT PRIMARY KEY REFERENCES wahi_v2.labor_jobs(guid),
 classification_id UUID NOT NULL,
 FOREIGN KEY(job_guid,classification_id) REFERENCES wahi_v2.labor_classifications(job_guid,id)
);
-- Preserve exactly the selection visible to the Owner at migration time.
-- Future scheduled evidence is retained, but never automatically activates.
INSERT INTO wahi_v2.labor_job_mappings(job_guid,classification_id)
SELECT DISTINCT ON(c.job_guid) c.job_guid,c.id
FROM wahi_v2.labor_classifications c CROSS JOIN wahi_v2.labor_settings s
WHERE c.effective_date <= ((CURRENT_TIMESTAMP AT TIME ZONE s.timezone)-make_interval(hours=>s.closeout_hour))::date
ORDER BY c.job_guid,c.effective_date DESC,c.revision DESC;
