-- READ-ONLY verification. Run this in the Supabase Dashboard SQL Editor
-- AFTER migration 0029 and both cleanup scripts
-- (scratch_duplicate_snapshot_item_cleanup.sql, then
-- scratch_duplicate_assignment_cleanup.sql) have been run. Confirms
-- whether any area-level check is still duplicated anywhere -- not just
-- the photoluminescent one, every area-level check across the whole
-- organization.

-- 1. Any area-level check still assigned more than once at the same
--    property_location_id, in the live checklist template. Should be
--    EMPTY after both cleanup scripts have run, except for whichever
--    groups their own reports told you needed manual review.
select
  p.name as property_name,
  pca.property_location_id,
  pl.name as location_name,
  icl.name as check_name,
  count(*) as duplicate_row_count
from public.property_check_assignments pca
join public.check_applicability_rules r on r.id = pca.source_rule_id
join public.property_locations pl on pl.id = pca.property_location_id
join public.properties p on p.id = pl.property_id
join public.inspection_check_library icl on icl.id = pca.inspection_check_id
where pca.status = 'active'
  and r.component_type_id is null
group by p.name, pca.property_location_id, pl.name, icl.name
having count(*) > 1
order by property_name, location_name, check_name;

-- 2. Same question, but inside a still-open (not yet completed)
--    inspection's actual line items -- this is what a person walking
--    through the app would see right now. Should also be EMPTY except
--    for manual-review groups.
select
  i.id as inspection_id,
  i.status as inspection_status,
  p.name as property_name,
  pl.name as location_name,
  icl.name as check_name,
  count(*) as duplicate_item_count
from public.inspection_snapshot_items isi
join public.property_check_assignments pca on pca.id = isi.property_check_assignment_id
join public.check_applicability_rules r on r.id = pca.source_rule_id
join public.inspection_snapshot_locations l on l.id = isi.inspection_snapshot_location_id
join public.inspection_snapshots s on s.id = l.inspection_snapshot_id
join public.inspections i on i.id = s.inspection_id
join public.property_locations pl on pl.id = l.property_location_id
join public.properties p on p.id = pl.property_id
join public.inspection_check_library icl on icl.id = isi.inspection_check_id
where r.component_type_id is null
  and i.status in ('scheduled', 'in_progress')
group by i.id, i.status, p.name, pl.name, icl.name
having count(*) > 1
order by property_name, location_name, check_name;

-- If both queries return zero rows, there is nothing left duplicated
-- anywhere (live template and every open inspection). If either returns
-- rows, cross-check them against the "needs manual review" list the two
-- cleanup scripts printed when you ran them -- anything NOT on that list
-- that still shows up here is worth pasting back for a closer look.
