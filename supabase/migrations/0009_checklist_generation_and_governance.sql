-- Phase 4, migration 3 of 3: the checklist generator and critical-check
-- governance function -- the only two ways property_check_assignments and
-- inspection_check_library.status ever change, per the "SECURITY DEFINER
-- function is the only write path" pattern established by
-- create_property() in 0003.

-- generate_property_checklist(): evaluates check_applicability_rules
-- against a property's confirmed locations/components and inserts any
-- missing property_check_assignments rows, then freezes a
-- property_template_versions snapshot. Safe to call repeatedly (e.g. after
-- confirming more components in the guided wizard) -- the partial unique
-- index from 0007 plus ON CONFLICT DO NOTHING means it only ever adds
-- what's missing, never duplicates.
--
-- Matching logic per (location, confirmed component):
--   - a component-level rule (component_type_id set) applies when the
--     location has a confirmed, active component of that exact type
--   - a location-level rule (component_type_id null, area_type_id set)
--     applies to the location itself regardless of which components it has
--   - a matching 'exclude' rule (same scoping) suppresses the check
-- Rules with property_id set apply only to that one property (a future
-- override mechanism); property_id null rules are the seeded platform
-- standard from 0008 and apply everywhere.
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

-- set_inspection_check_status(): the only supported way to change a
-- check's status. Enforces PRODUCT_SPEC.md section 7's critical-check
-- governance: any move away from 'active' requires a reason, and a
-- critical check additionally requires an org_admin (not just a
-- portfolio_manager) -- every change is written to audit_log regardless.
--
-- IMPORTANT SCOPE NOTE: this only operates on checks where
-- organization_id = the caller's own org -- never on the shared
-- platform-standard library (organization_id is null, seeded in 0008).
-- There is no "add a custom org check" UI yet (a later phase), so in
-- practice no caller can use this function successfully today -- it
-- exists now so the governance path is in place before that feature
-- ships, without ever risking one tenant's admin silently deactivating a
-- check for every other tenant on the platform.
create or replace function public.set_inspection_check_status(
  p_check_id uuid,
  p_new_status text,
  p_reason text
)
returns public.inspection_check_library
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller_role text;
  v_check public.inspection_check_library;
  v_before jsonb;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null then
    raise exception 'not_authenticated';
  end if;

  if p_new_status not in ('active','inactive','not_applicable','superseded') then
    raise exception 'invalid_status';
  end if;

  if p_new_status != 'active' and (p_reason is null or trim(p_reason) = '') then
    raise exception 'status_reason_required';
  end if;

  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role not in ('org_admin','portfolio_manager') then
    raise exception 'insufficient_permission';
  end if;

  -- Scoped to organization_id = v_org_id, never null -- see the function
  -- comment above. A check that exists but belongs to the platform
  -- library or another org looks identical to "doesn't exist" here.
  select * into v_check from public.inspection_check_library
    where id = p_check_id and organization_id = v_org_id;
  if v_check is null then
    raise exception 'check_not_found';
  end if;

  if v_check.critical and p_new_status != 'active' and v_caller_role != 'org_admin' then
    raise exception 'critical_check_requires_admin';
  end if;

  v_before := to_jsonb(v_check);

  update public.inspection_check_library
  set status = p_new_status,
      status_reason = case when p_new_status = 'active' then null else p_reason end,
      status_changed_by = auth.uid(),
      status_changed_at = now()
  where id = p_check_id
  returning * into v_check;

  perform public.log_audit_event(
    'set_check_status', 'inspection_check_library', p_check_id, v_before, to_jsonb(v_check)
  );

  return v_check;
end;
$$;

revoke all on function public.set_inspection_check_status(uuid, text, text) from public;
grant execute on function public.set_inspection_check_status(uuid, text, text) to authenticated;
