-- ONE-TIME LIVE-DATA CLEANUP, companion to
-- scratch_duplicate_assignment_cleanup.sql. Run this AFTER that script
-- (which fixes the underlying property_check_assignments template) --
-- this one fixes what a person is ACTUALLY SEEING right now: duplicate
-- line items inside an inspection that was already started while the
-- bug's duplicate assignment rows existed. This is the direct fix for
-- the "several photoluminescent items in the inspection" symptom, for
-- whichever inspection(s) show it.
--
-- Why a separate script: scratch_duplicate_assignment_cleanup.sql can
-- only ever collapse property_check_assignments rows that AREN'T
-- referenced by any real inspection snapshot (that's the whole point of
-- its FK guard -- it must never delete real inspection history). When
-- start_inspection() ran while the duplicate rows already existed, it
-- copied every one of them into inspection_snapshot_items 1:1 -- so the
-- duplication is frozen into that inspection's own checklist, completely
-- independent of whatever the assignments table looks like afterward.
-- Fixing that requires touching inspection_snapshot_items directly, on
-- a per-inspection basis, which is what this script does.
--
-- Scope, deliberately conservative:
--   - Only inspections with status 'scheduled' or 'in_progress' --
--     i.e. ones a person might still be actively walking through or
--     about to. 'completed' inspections are a historical record and are
--     NEVER touched by this script, full stop. 'postponed' and 'voided'
--     inspections are also left alone (not the target symptom, and not
--     worth the risk for inspections nobody's actively looking at).
--   - Only duplicate ITEMS whose underlying check assignment came from
--     an area-level rule (component_type_id is null on the rule) --
--     the same scoping rule as the assignment-level cleanup, for the
--     same reason: a location with two confirmed components of the
--     same type legitimately gets two separate component-level line
--     items, and that is correct, not a duplicate.
--
-- Keeper selection per duplicate group (same
-- inspection_snapshot_location_id + inspection_check_id):
--   - If more than one item in the group already has real recorded
--     data (status changed from 'not_inspected', an observation or
--     recommendation written, a photo attached, or a finding attached),
--     the whole group is left untouched and flagged for manual review --
--     an inspector already treated more than one of these as real, and
--     picking one to keep and discarding the other's recorded data is a
--     human judgment call, not an automatable one.
--   - Otherwise, if exactly one item has real recorded data, that one is
--     kept and every other (untouched, still-default) item in the group
--     is deleted.
--   - Otherwise (no item has any recorded data yet -- every one is still
--     a pristine, untouched placeholder), the earliest-created item is
--     kept and the rest are deleted.
-- A delete never proceeds for any item that has an attached photo or
-- finding, regardless of the above (defense in depth on top of the
-- "has real recorded data" check).
--
-- Safe to run more than once.

begin;

create temporary table _item_has_data on commit drop as
select
  isi.id,
  (
    isi.status != 'not_inspected'
    or isi.observation is not null
    or isi.recommendation is not null
    or isi.measurement_value is not null
    or isi.access_status is not null
    or isi.next_action is not null
    or isi.work_order_number is not null
    or isi.inspected_at is not null
    or exists (select 1 from public.photos ph where ph.inspection_snapshot_item_id = isi.id)
    or exists (select 1 from public.findings f where f.inspection_snapshot_item_id = isi.id)
  ) as has_data
from public.inspection_snapshot_items isi;

create temporary table _dup_item_groups on commit drop as
select
  isi.inspection_snapshot_location_id, isi.inspection_check_id,
  count(*) as item_count,
  count(*) filter (where d.has_data) as data_item_count
from public.inspection_snapshot_items isi
join public.property_check_assignments pca on pca.id = isi.property_check_assignment_id
join public.check_applicability_rules r on r.id = pca.source_rule_id
join public.inspection_snapshot_locations l on l.id = isi.inspection_snapshot_location_id
join public.inspection_snapshots s on s.id = l.inspection_snapshot_id
join public.inspections i on i.id = s.inspection_id
join _item_has_data d on d.id = isi.id
where r.component_type_id is null
  and i.status in ('scheduled', 'in_progress')
group by isi.inspection_snapshot_location_id, isi.inspection_check_id
having count(*) > 1;

create temporary table _dup_item_groups_conflict on commit drop as
select * from _dup_item_groups where data_item_count > 1;

create temporary table _dup_item_groups_safe on commit drop as
select * from _dup_item_groups where data_item_count <= 1;

create temporary table _item_keepers on commit drop as
select distinct on (g.inspection_snapshot_location_id, g.inspection_check_id)
  isi.id as keeper_id, g.inspection_snapshot_location_id, g.inspection_check_id
from _dup_item_groups_safe g
join public.inspection_snapshot_items isi
  on isi.inspection_snapshot_location_id = g.inspection_snapshot_location_id
 and isi.inspection_check_id = g.inspection_check_id
join _item_has_data d on d.id = isi.id
order by
  g.inspection_snapshot_location_id, g.inspection_check_id,
  d.has_data desc,
  isi.created_at asc;

delete from public.inspection_snapshot_items isi
using _dup_item_groups_safe g
where isi.inspection_snapshot_location_id = g.inspection_snapshot_location_id
  and isi.inspection_check_id = g.inspection_check_id
  and isi.id not in (select keeper_id from _item_keepers)
  and not exists (select 1 from public.photos ph where ph.inspection_snapshot_item_id = isi.id)
  and not exists (select 1 from public.findings f where f.inspection_snapshot_item_id = isi.id);

-- ---- Report ----
select 'duplicate inspection line items cleaned up automatically' as result, count(*) as group_count
from _dup_item_groups_safe
union all
select 'duplicate line-item groups needing manual review (2+ items already have recorded data)', count(*)
from _dup_item_groups_conflict;

select
  i.id as inspection_id, i.inspection_type, i.status as inspection_status,
  pl.name as location_name, icl.name as check_name,
  g.item_count as duplicate_item_count, g.data_item_count
from _dup_item_groups_conflict g
join public.inspection_snapshot_locations l on l.id = g.inspection_snapshot_location_id
join public.inspection_snapshots s on s.id = l.inspection_snapshot_id
join public.inspections i on i.id = s.inspection_id
join public.property_locations pl on pl.id = l.property_location_id
join public.inspection_check_library icl on icl.id = g.inspection_check_id
order by inspection_id, location_name, check_name;

commit;
