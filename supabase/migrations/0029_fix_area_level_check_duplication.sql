-- Phase 19: fixes a real bug in generate_property_checklist() (0009,
-- Phase 4) that has existed since that migration -- reported by the user
-- after noticing several identical "photoluminescent egress path
-- markings" checklist items on one property (a Phase 18 check), and
-- confirmed to affect every area-level check ever added (0024's pest/
-- storage-fire-hazard checks and 0028's utility-room-storage/egress-
-- corridor checks alike), not anything specific to this phase's content.
--
-- The bug: the function's FROM clause does
--   from public.property_locations pl
--   left join public.location_components lc
--     on lc.property_location_id = pl.id and lc.confirmed = true and lc.status = 'active'
--   join public.check_applicability_rules r on ... (
--     (lc.id is not null and r.component_type_id = lc.component_type_id)
--     or (r.component_type_id is null and r.area_type_id = pl.area_type_id)
--   )
-- The left join to location_components fans out one row per confirmed
-- component at a location. For a component-level rule that's correct
-- (one candidate row per matching component). But the area-level branch
-- of the OR condition (`r.component_type_id is null and r.area_type_id =
-- pl.area_type_id`) doesn't depend on `lc` at all -- it matches EVERY
-- fanned-out row for that location, not just one. The SELECT then
-- inserted `lc.id` verbatim as `location_component_id` regardless of
-- which branch actually matched, and `DISTINCT ON` included that same
-- `lc.id` in its dedup key -- so for an area-level check, a location
-- with N confirmed components produced N distinct
-- (location_component_id, check_id) pairs instead of the one row an
-- area-level check should ever get (location_component_id = null,
-- exactly like an area-level check_applicability_rules row itself has
-- component_type_id = null). Reproduced locally against a disposable
-- Postgres 16 database: a Stairwell location with 3 confirmed components
-- (Treads, Railings, Pull Station) generated 3 duplicate rows apiece for
-- both of 0028's Stairwell area-level checks, while every component-level
-- check on the same location correctly generated exactly 1 row each --
-- isolating the bug precisely to the area-level branch, as expected.
--
-- This was never caught earlier because no prior test fixture happened
-- to confirm 2+ components at one location before checking an area-level
-- check's assignment count -- worth being explicit about that gap rather
-- than glossing over it.
--
-- The fix: only use the fanned-out `lc.id` as `location_component_id`
-- when the match was actually a component-level one (`r.component_type_id
-- is not null`); otherwise it must be null, matching the area-level
-- rule's own shape. Applied identically in the SELECT list, the DISTINCT
-- ON key, and the ORDER BY (which DISTINCT ON requires to match).
-- Nothing else about the function changes -- same signature, same
-- exclude-rule handling, same ON CONFLICT target, same snapshot/audit
-- logic.
--
-- This migration only fixes the function going forward -- it does NOT
-- retroactively repair or remove any already-generated duplicate
-- property_check_assignments rows. Existing duplicate rows created by
-- the old, buggy version (on whichever properties already ran
-- generate_property_checklist() before this was applied) need a
-- separate, one-time cleanup pass against your live database --
-- delivered as its own script, not bundled into this migration, because
-- it operates on already-accumulated live data rather than being
-- something a fresh migration replay can exercise the same way. Run
-- this migration first, then the cleanup script.
--
-- Important, verified-by-testing wrinkle: re-running
-- generate_property_checklist() on an already-corrupted property (which
-- will happen automatically the next time that property's setup wizard
-- is reopened, or a new location/component is confirmed on it) is NOT a
-- no-op with respect to the old duplicate rows. The old buggy rows carry
-- a non-null location_component_id (the fanned-out component id), which
-- the partial unique index treats as a distinct key from the *correct*
-- (location_component_id = null) row an area-level check should have.
-- So the fixed function will insert ONE additional, correctly-shaped
-- (location_component_id = null) row alongside the pre-existing buggy
-- ones the first time it runs post-fix -- observed directly: a location
-- with 3 pre-existing duplicate rows went to 4 (3 old + 1 new-correct)
-- after one re-run of generate_property_checklist(), not 3. It then
-- stabilizes there (the new row's own key blocks further re-insertion).
-- The cleanup script below must therefore not assume every duplicate
-- group is made up entirely of "old-shaped" rows -- a group may already
-- contain one correctly-shaped (location_component_id = null) row by
-- the time cleanup runs, and that row should be preferred as the keeper.
create or replace function public.generate_property_checklist(p_property_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_property_org_id uuid;
  v_caller_role text;
  v_created_count integer;
  v_total_active_count integer;
  v_version_number integer;
  v_snapshot jsonb;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null then
    raise exception 'not_authenticated';
  end if;

  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role not in ('org_admin','portfolio_manager') then
    raise exception 'insufficient_permission';
  end if;

  select organization_id into v_property_org_id from public.properties where id = p_property_id;
  if v_property_org_id is null or v_property_org_id != v_org_id then
    -- Same error for "doesn't exist" and "belongs to another org" --
    -- never confirm cross-tenant existence to the caller.
    raise exception 'property_not_found';
  end if;

  insert into public.property_check_assignments (
    property_id, property_location_id, location_component_id, inspection_check_id, source_rule_id, created_by
  )
  select distinct on (
    pl.id,
    coalesce(
      case when r.component_type_id is not null then lc.id else null end,
      '00000000-0000-0000-0000-000000000000'::uuid
    ),
    r.inspection_check_id
  )
    p_property_id, pl.id,
    case when r.component_type_id is not null then lc.id else null end,
    r.inspection_check_id, r.id, auth.uid()
  from public.property_locations pl
  left join public.location_components lc
    on lc.property_location_id = pl.id and lc.confirmed = true and lc.status = 'active'
  join public.check_applicability_rules r
    on r.rule_type = 'include'
    and (r.property_id is null or r.property_id = p_property_id)
    and (
      (lc.id is not null and r.component_type_id = lc.component_type_id)
      or (r.component_type_id is null and r.area_type_id = pl.area_type_id)
    )
  join public.inspection_check_library icl
    on icl.id = r.inspection_check_id and icl.status = 'active'
  where pl.property_id = p_property_id
    and pl.status = 'active'
    and not exists (
      select 1 from public.check_applicability_rules ex
      where ex.rule_type = 'exclude'
        and ex.inspection_check_id = r.inspection_check_id
        and (ex.property_id is null or ex.property_id = p_property_id)
        and (
          (lc.id is not null and ex.component_type_id = lc.component_type_id)
          or (ex.component_type_id is null and ex.area_type_id = pl.area_type_id)
        )
    )
  order by
    pl.id,
    coalesce(
      case when r.component_type_id is not null then lc.id else null end,
      '00000000-0000-0000-0000-000000000000'::uuid
    ),
    r.inspection_check_id
  on conflict (
    property_id, property_location_id,
    coalesce(location_component_id, '00000000-0000-0000-0000-000000000000'::uuid),
    inspection_check_id
  )
  where status = 'active'
  do nothing;

  get diagnostics v_created_count = row_count;

  select count(*) into v_total_active_count
  from public.property_check_assignments
  where property_id = p_property_id and status = 'active';

  select max(version_number) into v_version_number
  from public.property_template_versions
  where property_id = p_property_id;

  -- Only freeze a new version when something actually changed (or this is
  -- the very first generation for this property). Calling this function
  -- again with nothing new to add -- e.g. the wizard retries after a
  -- network hiccup, or the user reopens setup without changing anything
  -- -- should be a safe no-op, not spam an identical version every time.
  if v_created_count > 0 or v_version_number is null then
    v_version_number := coalesce(v_version_number, 0) + 1;

    select jsonb_agg(to_jsonb(pca)) into v_snapshot
    from public.property_check_assignments pca
    where pca.property_id = p_property_id and pca.status = 'active';

    insert into public.property_template_versions (
      property_id, version_number, assignments_snapshot, created_by, change_summary, status
    ) values (
      p_property_id, v_version_number, coalesce(v_snapshot, '[]'::jsonb), auth.uid(),
      'Generated from guided property setup', 'active'
    );
  end if;

  perform public.log_audit_event(
    'generate_checklist', 'property', p_property_id, null,
    jsonb_build_object(
      'version_number', v_version_number,
      'created_count', v_created_count,
      'total_active_count', v_total_active_count
    )
  );

  return jsonb_build_object(
    'created_count', v_created_count,
    'total_active_count', v_total_active_count,
    'version_number', v_version_number
  );
end;
$$;

revoke all on function public.generate_property_checklist(uuid) from public;
grant execute on function public.generate_property_checklist(uuid) to authenticated;
