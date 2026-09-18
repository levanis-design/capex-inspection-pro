-- Phase 5B-ext: lets an admin/portfolio manager actually manage a
-- property's resolved checklist (view, deactivate with a reason,
-- override priority/department) instead of only ever being able to add
-- to it via generate_property_checklist(). Two changes:
--
-- 1. generate_property_checklist() is redefined so a manual deactivation
--    made through this migration's new function sticks across future
--    regenerations -- see the added NOT EXISTS clause below.
-- 2. set_property_check_assignment_status(): the only way to change a
--    property_check_assignment's status or overrides (property_check_
--    assignments still has no insert/update policy for authenticated --
--    see 0007 -- so a direct client write was never possible; this
--    function is the missing write path). Same governance shape as
--    0009's set_inspection_check_status(): any non-active transition
--    requires a reason, a critical check additionally requires an
--    org_admin, every change is audit-logged, and it's scoped so it can
--    only ever touch an assignment belonging to the caller's own org.

-- Redefinition note: before this change, generate_property_checklist()'s
-- ON CONFLICT target was the partial unique index from 0007
-- (`... where status = 'active'`), which only prevents inserting a
-- second ACTIVE row for the same (location, component, check) combo --
-- it does nothing to stop a fresh row being inserted next to an
-- INACTIVE one. That meant deactivating an assignment here (e.g. "we
-- don't need this specific check at this specific location") would have
-- been silently undone the next time someone tapped "Generate
-- checklist" and it happened to re-walk that same combo. The fix: skip
-- insertion whenever ANY row already exists for that combo, active or
-- not -- a manual deactivation is a deliberate, sticky decision, not
-- something regeneration should be able to reverse. (Un-confirming the
-- underlying component is unaffected by this and still works exactly as
-- before -- that path never creates a competing row in the first place.)
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
    raise exception 'property_not_found';
  end if;

  insert into public.property_check_assignments (
    property_id, property_location_id, location_component_id, inspection_check_id, source_rule_id, created_by
  )
  select distinct on (pl.id, coalesce(lc.id, '00000000-0000-0000-0000-000000000000'::uuid), r.inspection_check_id)
    p_property_id, pl.id, lc.id, r.inspection_check_id, r.id, auth.uid()
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
    -- New: skip if a property_check_assignment already exists for this
    -- exact combo regardless of status -- see the comment above.
    and not exists (
      select 1 from public.property_check_assignments existing
      where existing.property_id = p_property_id
        and existing.property_location_id = pl.id
        and coalesce(existing.location_component_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(lc.id, '00000000-0000-0000-0000-000000000000'::uuid)
        and existing.inspection_check_id = r.inspection_check_id
    )
  order by pl.id, coalesce(lc.id, '00000000-0000-0000-0000-000000000000'::uuid), r.inspection_check_id
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

-- set_property_check_assignment_status(): the "edit/deactivate a
-- checklist item" write path for the setup wizard's new checklist
-- management screen. p_new_status left null means "don't touch status,
-- I'm only changing the priority/department override." Passing
-- p_clear_override_priority/p_clear_override_department true resets that
-- override back to the check's own default rather than setting an
-- explicit value.
create or replace function public.set_property_check_assignment_status(
  p_assignment_id uuid,
  p_new_status text default null,
  p_reason text default null,
  p_override_priority text default null,
  p_override_department text default null,
  p_clear_override_priority boolean default false,
  p_clear_override_department boolean default false
)
returns public.property_check_assignments
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller_role text;
  v_assignment public.property_check_assignments;
  v_critical boolean;
  v_before jsonb;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null then
    raise exception 'not_authenticated';
  end if;

  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role not in ('org_admin','portfolio_manager') then
    raise exception 'insufficient_permission';
  end if;

  if p_override_priority is not null and p_override_priority not in ('P1','P2','P3','P4') then
    raise exception 'invalid_priority';
  end if;

  -- Scoped through the assignment's own property's organization -- an
  -- assignment belonging to another org looks identical to one that
  -- doesn't exist. Same pattern as generate_property_checklist() and
  -- 0009's set_inspection_check_status().
  select pca.* into v_assignment
  from public.property_check_assignments pca
  join public.properties p on p.id = pca.property_id
  where pca.id = p_assignment_id and p.organization_id = v_org_id;

  if v_assignment.id is null then
    raise exception 'assignment_not_found';
  end if;

  select critical into v_critical
  from public.inspection_check_library
  where id = v_assignment.inspection_check_id;

  if p_new_status is not null and p_new_status != v_assignment.status then
    if p_new_status not in ('active','inactive','not_applicable','superseded') then
      raise exception 'invalid_status';
    end if;
    if p_new_status != 'active' and (p_reason is null or trim(p_reason) = '') then
      raise exception 'status_reason_required';
    end if;
    if coalesce(v_critical, false) and p_new_status != 'active' and v_caller_role != 'org_admin' then
      raise exception 'critical_check_requires_admin';
    end if;
  end if;

  v_before := to_jsonb(v_assignment);

  update public.property_check_assignments
  set
    status = coalesce(p_new_status, status),
    status_reason = case
      when p_new_status is null then status_reason
      when p_new_status = 'active' then null
      else p_reason
    end,
    override_priority = case
      when p_clear_override_priority then null
      when p_override_priority is not null then p_override_priority
      else override_priority
    end,
    override_department = case
      when p_clear_override_department then null
      when p_override_department is not null then p_override_department
      else override_department
    end
  where id = p_assignment_id
  returning * into v_assignment;

  perform public.log_audit_event(
    'update_check_assignment', 'property_check_assignment', p_assignment_id, v_before, to_jsonb(v_assignment)
  );

  return v_assignment;
end;
$$;

revoke all on function public.set_property_check_assignment_status(uuid, text, text, text, text, boolean, boolean) from public;
grant execute on function public.set_property_check_assignment_status(uuid, text, text, text, text, boolean, boolean) to authenticated;
