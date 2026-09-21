-- Existing mapped/excluded/unmapped policies remain intact. Human-facing labels
-- are Mapped / Ignored / Needs Mapping; no Owner policy is inferred here.
ALTER TABLE wahi_v2.cogs_mappings ADD COLUMN reason TEXT NOT NULL DEFAULT '';
ALTER TABLE wahi_v2.sales_items ADD COLUMN name_observed_at TIMESTAMPTZ;
ALTER TABLE wahi_v2.sales_items ADD COLUMN name_selection_id UUID;
CREATE INDEX sales_fact_item_name ON wahi_v2.sales_facts(item_id,(source->>'saleAt') DESC,id DESC) WHERE present;
UPDATE wahi_v2.sales_items i SET name=s.name,group_id=s.group_id,name_observed_at=s.at,name_selection_id=s.id
FROM (SELECT DISTINCT ON(item_id) item_id,id,source->>'name' name,(source->>'groupId')::uuid group_id,(source->>'saleAt')::timestamptz at FROM wahi_v2.sales_facts WHERE present ORDER BY item_id,source->>'saleAt' DESC,id DESC) s WHERE i.id=s.item_id;
CREATE TABLE wahi_v2.sales_item_days (
 business_date DATE NOT NULL,item_id TEXT NOT NULL REFERENCES wahi_v2.sales_items(id),
 quantity NUMERIC NOT NULL,net_sales NUMERIC,selection_count INTEGER NOT NULL,
 PRIMARY KEY(business_date,item_id)
);
INSERT INTO wahi_v2.sales_item_days
SELECT business_date,item_id,sum((source->>'quantity')::numeric),CASE WHEN bool_and(source->>'netSales' IS NOT NULL) THEN sum((source->>'netSales')::numeric) END,count(*)
FROM wahi_v2.sales_facts WHERE present AND source->>'reason' IS NULL GROUP BY business_date,item_id;
CREATE INDEX sales_item_days_identity ON wahi_v2.sales_item_days(item_id,business_date);
CREATE TABLE wahi_v2.cogs_candidates (
 item_id TEXT PRIMARY KEY REFERENCES wahi_v2.sales_items(id), fingerprint TEXT NOT NULL,
 payload JSONB NOT NULL, generated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Existing generations remain as provenance. Non-mapped materializations no
-- longer record missing mapping as an unresolved recipe cost.
UPDATE wahi_v2.cogs_knowledge k SET dirty=TRUE WHERE NOT EXISTS(SELECT 1 FROM wahi_v2.cogs_mappings m WHERE m.item_id=k.item_id AND m.state='mapped');
