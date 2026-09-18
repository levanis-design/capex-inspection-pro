-- Phase 5, migration 2 of 2: start_inspection() -- the only way an
-- inspections/inspection_snapshots/inspection_snapshot_locations/
-- inspection_snapshot_items row is ever created (0011 deliberately left
-- every insert policy off those tables). Resolves an inspection type's
-- scope per PRODUCT_SPEC.md section 8, then freezes the current
-- property_check_assignments into an immutable snapshot.
--
-- Supported inspection_type values today: comprehensive, roof,
-- mechanical, common_area, fire_life_safety, apartment_unit, custom.
-- Deliberately unsupported for now (raises inspection_type_not_yet_supported):
--   - preventive_maintenance, follow_up: need due-date tracking /
--     findings-and-corrective-actions data this schema doesn't have yet.
--   - seasonal, exterior_grounds, move_in, move_out, capital_planning:
--     PRODUCT_SPEC.md doesn't yet spell out an unambiguous scope-resolution
--     rule for these, and guessing one into the database would be worse
--     than refusing clearly. Revisit each as its own small addition once
--     the product spec pins down the rule, rather than blocking the rest
--     of Phase 5 on all seven at once.
create or replace function public.start_inspection(
  p_property_id uuid,
  p_inspection_type text,
  p_location_ids uuid[] default null,
  p_assigned_inspector_id uuid default null,
  p_scheduled_date date default null
)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller_role text;
  v_property_org_id uuid;
  v_inspection_id uuid;
  v_snapshot_id uuid;
  v_template_version_id uuid;
  v_location_ids uuid[];
  v_location record;
  v_snapshot_location_id uuid;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null then
    raise exception 'not_authenticated';
  end if;

  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role not in ('org_admin', 'portfolio_manager', 'supervisor') then
    raise exception 'insufficient_permission';
  end if;

  select organization_id into v_property_org_id from public.properties where id = p_property_id;
  if v_property_org_id is null or v_property_org_id != v_org_id then
    -- Same error for "doesn't exist" and "belongs to another org" -- see
    -- the identical pattern (and rationale) in generate_property_checklist().
    raise exception 'property_not_found';
  end if;

  if p_inspection_type in (
    'preventive_maintenance', 'follow_up', 'seasonal',
    'exterior_grounds', 'move_in', 'move_out', 'capital_planning'
  ) then
    raise exception 'inspection_type_not_yet_supported';
  end if;

  if p_inspection_type not in (
    'comprehensive', 'roof', 'mechanical', 'common_area',
    'fire_life_safety', 'apartment_unit', 'custom'
  ) then
    raise exception 'invalid_inspection_type';
  end if;

  -- Scope resolution per PRODUCT_SPEC.md section 8. Each branch resolves
  -- to a plain array of property_locations.id -- everything downstream
  -- (snapshot location/item generation) is identical regardless of which
  -- rule produced the array.
  if p_inspection_type = 'comprehensive' then
    select array_agg(pl.id) into v_location_ids
    from public.property_locations pl
    where pl.property_id = p_property_id and pl.status = 'active';

  elsif p_inspection_type = 'roof' then
    select array_agg(pl.id) into v_location_ids
    from public.property_locations pl
    join public.area_types at2 on at2.id = pl.area_type_id
    where pl.property_id = p_property_id and pl.status = 'active'
      and at2.name = 'Roof';

  elsif p_inspection_type = 'mechanical' then
    select array_agg(pl.id) into v_location_ids
    from public.property_locations pl
    join public.area_types at2 on at2.id = pl.area_type_id
    where pl.property_id = p_property_id and pl.status = 'active'
      and at2.name in ('Boiler Room', 'Mechanical Room');

  elsif p_inspection_type = 'common_area' then
    select array_agg(pl.id) into v_location_ids
    from public.property_locations pl
    join public.area_types at2 on at2.id = pl.area_type_id
    where pl.property_id = p_property_id and pl.status = 'active'
      and at2.name in ('Entrance', 'Lobby', 'Hallway', 'Stairwell');

  elsif p_inspection_type = 'fire_life_safety' then
    -- Every location that has at least one active check assignment
    -- pulled from a critical check, regardless of area type -- fire/life
    -- safety items live across many area types (Hallway exit signs,
    -- Boiler Room controls, Apartment smoke detectors, Stairwell
    -- railings, ...), so this can't be a fixed area_type list like the
    -- branches above.
    select array_agg(distinct pca.property_location_id) into v_location_ids
    from public.property_check_assignments pca
    join public.inspection_check_library icl on icl.id = pca.inspection_check_id
    where pca.property_id = p_property_id
      and pca.status = 'active'
      and icl.critical = true;

  elsif p_inspection_type in ('apartment_unit', 'custom') then
    if p_location_ids is null or array_length(p_location_ids, 1) is null then
      raise exception 'location_selection_required';
    end if;
    select array_agg(pl.id) into v_location_ids
    from public.property_locations pl
    where pl.property_id = p_property_id and pl.status = 'active'
      and pl.id = any(p_location_ids);
  end if;

  if v_location_ids is null or array_length(v_location_ids, 1) is null then
    raise exception 'no_locations_in_scope';
  end if;

  select id into v_template_version_id
  from public.property_template_versions
  where property_id = p_property_id
  order by version_number desc
  limit 1;

  insert into public.inspections (
    organization_id, property_id, inspection_type, assigned_inspector_id,
    scheduled_date, status, scope_selection, created_by
  ) values (
    v_org_id, p_property_id, p_inspection_type, p_assigned_inspector_id,
    p_scheduled_date, 'scheduled',
    jsonb_build_object('location_ids', to_jsonb(v_location_ids)),
    auth.uid()
  )
  returning id into v_inspection_id;

  insert into public.inspection_snapshots (
    inspection_id, property_template_version_id, generated_by
  ) values (
    v_inspection_id, v_template_version_id, auth.uid()
  )
  returning id into v_snapshot_id;

  -- Ordered by route_order/name so the walkthrough UI (Phase 5B) can just
  -- present snapshot locations in the order they were inserted rather
  -- than re-deriving a route every time.
  for v_location in
    select pl.id, pl.name
    from public.property_locations pl
    where pl.id = any(v_location_ids)
    order by pl.route_order, pl.name
  loop
    insert into public.inspection_snapshot_locations (
      inspection_snapshot_id, property_location_id, sequence_order, status
    ) values (
      v_snapshot_id, v_location.id,
      (select count(*) from public.inspection_snapshot_locations where inspection_snapshot_id = v_snapshot_id),
      'pending'
    )
    returning id into v_snapshot_location_id;

    insert into public.inspection_snapshot_items (
      inspection_snapshot_location_id, property_check_assignment_id, inspection_check_id,
      title, instructions, location_component_id, status,
      priority, responsible_department
    )
    select
      v_snapshot_location_id, pca.id, pca.inspection_check_id,
      icl.name, icl.instructions, pca.location_component_id, 'not_inspected',
      coalesce(pca.override_priority, icl.default_priority),
      coalesce(pca.override_department, icl.default_department)
    from public.property_check_assignments pca
    join public.inspection_check_library icl on icl.id = pca.inspection_check_id
    where pca.property_location_id = v_location.id
      and pca.status = 'active'
      -- fire_life_safety scopes to critical checks only -- a location
      -- pulled into scope because of one critical check shouldn't also
      -- drag in every unrelated non-critical item at that same location.
      and (p_inspection_type != 'fire_life_safety' or icl.critical = true);
  end loop;

  perform public.log_audit_event(
    'start_inspection', 'inspection', v_inspection_id, null,
    jsonb_build_object('inspection_type', p_inspection_type, 'location_count', array_length(v_location_ids, 1))
  );

  return v_inspection_id;
end;
$$;

revoke all on function public.start_inspection(uuid, text, uuid[], uuid, date) from public;
grant execute on function public.start_inspection(uuid, text, uuid[], uuid, date) to authenticated;
