-- ONE-TIME LIVE-DATA CLEANUP. Run this in the Supabase Dashboard SQL
-- Editor AFTER migration 0029_fix_area_level_check_duplication.sql has
-- been applied. This is NOT a migration and does not belong in
-- supabase/migrations/ -- it operates on already-accumulated data, not
-- schema, and is meant to run exactly once.
--
-- RECOMMENDED ORDER: run scratch_duplicate_snapshot_item_cleanup.sql
-- FIRST, then this script. Verified locally: a duplicate assignment row
-- referenced only because its duplicate ITEM sat untouched in a
-- still-open inspection becomes eligible for automatic cleanup here
-- once that duplicate item has already been removed -- running the item
-- cleanup first measurably reduces how many groups this script has to
-- leave flagged for manual review. Running this script first isn't
-- wrong, it's just less thorough (running it again afterward will pick
-- up anything newly eligible).
--
-- What this fixes: before 0029, generate_property_checklist() could
-- insert the SAME area-level check more than once for a single location
-- (once per confirmed component at that location), instead of the one
-- row an area-level check should ever get. 0029 stops this from
-- happening going forward, but does not touch rows the bug already
-- created. This script finds and collapses those pre-existing
-- duplicate groups.
--
-- Scope: only rows created from an AREA-LEVEL rule (the rule's
-- component_type_id is null) are ever touched. A location that
-- legitimately has multiple active rows for the same check because it
-- has multiple confirmed components of the SAME component type (e.g.
-- two "Fire Extinguisher" components, each correctly getting its own
-- component-level check) is a different, correct situation and is never
-- part of this script's scope.
--
-- Keeper selection per duplicate group (same property_id,
-- property_location_id, inspection_check_id):
--   1. If exactly one row in the group is already referenced by a real
--      inspection's frozen snapshot (inspection_snapshot_items), that
--      row is kept -- it's already part of real inspection history and
--      cannot be deleted anyway (see FK note below). Its shape is
--      corrected (location_component_id set to null) if needed.
--   2. Otherwise, prefer a row that's already correctly shaped
--      (location_component_id is null) -- this can happen if
--      generate_property_checklist() was already re-run once after 0029
--      was deployed (verified locally: doing so adds ONE new, correctly-
--      shaped row alongside the old duplicates, rather than fixing them
--      in place).
--   3. Otherwise, the earliest-created row.
-- Every other active row in the group is deleted, guarded by a check
-- that it is NOT referenced by any inspection_snapshot_items row (the
-- only FK against property_check_assignments -- no ON DELETE clause, so
-- it defaults to RESTRICT/NO ACTION -- deleting a referenced row would
-- fail loudly rather than silently corrupt real inspection data; this
-- script does not rely on that failure, it avoids it by construction).
--
-- IMPORTANT LIMITATION, worth reading before running this: if a
-- location's duplicate rows were ALREADY frozen into a real inspection's
-- snapshot BEFORE this cleanup runs (i.e. more than one duplicate row in
-- the same group is already referenced by inspection_snapshot_items --
-- which happens whenever start_inspection() was called on that location
-- while the duplicates already existed, since it snapshots every active
-- assignment at a location together), this script CANNOT safely resolve
-- that group -- there is no way to tell which of several already-
-- inspected line items is "the real one" without human judgment, and
-- deleting any of them is blocked by the FK regardless. Those groups are
-- deliberately left completely untouched and are listed in the final
-- report as "needs manual review". Run
-- scratch_duplicate_snapshot_item_cleanup.sql (before this script, per
-- the recommended order above) to fix the actual visible symptom in a
-- still-open inspection -- it collapses duplicate line items directly
-- inside inspection_snapshot_items wherever it safely can, and doing so
-- first also shrinks how many groups end up flagged here. Whatever
-- BOTH scripts still leave flagged genuinely needs a human decision
-- (e.g. two different real inspections each already reference one of
-- the duplicate rows) -- there's no further automation for that.
--
-- Safe to run more than once (a second run will simply find zero
-- duplicate groups left, other than any still flagged for manual
-- review).

begin;

create temporary table _dup_groups on commit drop as
select
  pca.property_id, pca.property_location_id, pca.inspection_check_id,
  count(*) as row_count,
  count(*) filter (
    where exists (
      select 1 from public.inspection_snapshot_items isi
      where isi.property_check_assignment_id = pca.id
    )
  ) as snapshotted_count
from public.property_check_assignments pca
join public.check_applicability_rules r on r.id = pca.source_rule_id
where pca.status = 'active'
  and r.component_type_id is null
group by pca.property_id, pca.property_location_id, pca.inspection_check_id
having count(*) > 1;

create temporary table _dup_groups_conflict on commit drop as
select * from _dup_groups where snapshotted_count > 1;

create temporary table _dup_groups_safe on commit drop as
select * from _dup_groups where snapshotted_count <= 1;

create temporary table _keepers on commit drop as
select distinct on (g.property_id, g.property_location_id, g.inspection_check_id)
  pca.id as keeper_id, g.property_id, g.property_location_id, g.inspection_check_id
from _dup_groups_safe g
join public.property_check_assignments pca
  on pca.property_id = g.property_id
 and pca.property_location_id = g.property_location_id
 and pca.inspection_check_id = g.inspection_check_id
 and pca.status = 'active'
order by
  g.property_id, g.property_location_id, g.inspection_check_id,
  (exists (
    select 1 from public.inspection_snapshot_items isi
    where isi.property_check_assignment_id = pca.id
  )) desc,
  (pca.location_component_id is null) desc,
  pca.created_at asc;

-- Correct the keeper's shape to match what an area-level check should
-- look like, if it wasn't already.
update public.property_check_assignments pca
set location_component_id = null
from _keepers k
where pca.id = k.keeper_id
  and pca.location_component_id is not null;

-- Delete every other active row in a safe group. The NOT EXISTS guard
-- is defense in depth on top of the group-level snapshotted_count <= 1
-- filter and the keeper-selection priority above (which together
-- already ensure no non-keeper row here is snapshotted) -- if that
-- reasoning is ever wrong for some row, this guard makes the delete
-- fail loudly (blocked by the real FK) rather than silently remove
-- inspection history.
delete from public.property_check_assignments pca
using _dup_groups_safe g
where pca.property_id = g.property_id
  and pca.property_location_id = g.property_location_id
  and pca.inspection_check_id = g.inspection_check_id
  and pca.status = 'active'
  and pca.id not in (select keeper_id from _keepers)
  and not exists (
    select 1 from public.inspection_snapshot_items isi
    where isi.property_check_assignment_id = pca.id
  );

-- ---- Report ----
select 'duplicate groups cleaned up automatically' as result, count(*) as group_count
from _dup_groups_safe
union all
select 'duplicate groups needing manual review (2+ rows already in a real inspection snapshot)', count(*)
from _dup_groups_conflict;

select
  p.name as property_name,
  pl.name as location_name,
  icl.name as check_name,
  g.row_count as duplicate_row_count,
  g.snapshotted_count
from _dup_groups_conflict g
join public.properties p on p.id = g.property_id
join public.property_locations pl on pl.id = g.property_location_id
join public.inspection_check_library icl on icl.id = g.inspection_check_id
order by property_name, location_name, check_name;

commit;
