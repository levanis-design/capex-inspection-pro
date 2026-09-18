-- Phase 5B-ext2: edit/void/delete an inspection itself (the header row --
-- distinct from editing/deactivating a checklist item within one, which
-- 0013 already covers). Adds:
--   1. inspections.status_reason -- same status-reason column every other
--      lifecycle-tracked table in this schema already has; inspections
--      was the one exception, because until now nothing ever required a
--      reason for a status change.
--   2. A tightened inspections_update_own_org policy that blocks a direct
--      client update from ever setting status to 'voided' -- voiding must
--      go through set_inspection_status() below so the admin-past-
--      scheduled governance rule can't be bypassed. Everything else
--      (scheduled_date, assigned_inspector_id, and the existing
--      scheduled->in_progress->completed/postponed flow the walkthrough
--      and review screens already drive directly) is untouched.
--   3. set_inspection_status() -- the only supported governed transition
--      today is 'voided' ("delete without losing the record"): reason
--      always required; any assigned inspector or admin/PM/supervisor may
--      void a still-'scheduled' inspection, but once it's in_progress,
--      completed, or postponed, only an org_admin may void it. Mirrors
--      set_property_check_assignment_status()'s critical-check gate.
--   4. delete_inspection() -- a true hard delete (cascades to the
--      snapshot/locations/items via the on delete cascade already set up
--      in 0011). Same permission gate as voiding, reason always required
--      and audited before the row disappears. NOTE: this does not clean
--      up any photos already uploaded to the inspection-photos Storage
--      bucket for this inspection's items -- those become orphaned
--      objects. Acceptable for now (no user-facing impact, nothing reads
--      an orphaned object without its DB row) but worth revisiting if
--      storage cost/hygiene ever matters -- would need a Storage-API call
--      from an edge function, since Storage objects aren't FK-linked to
--      app tables.
alter table public.inspections add column status_reason text;

drop policy "inspections_update_own_org" on public.inspections;

create policy "inspections_update_own_org" on public.inspections
  for update using (
    organization_id = public.current_organization_id()
    and (
      assigned_inspector_id = auth.uid()
      or exists (
        select 1 from public.profiles
        where id = auth.uid() and role in ('org_admin', 'portfolio_manager', 'supervisor')
      )
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and status is distinct from 'voided'
  );

create or replace function public.set_inspection_status(
  p_inspection_id uuid,
  p_new_status text,
  p_reason text default null
)
returns public.inspections
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller_role text;
  v_inspection public.inspections;
  v_before jsonb;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null then
    raise exception 'not_authenticated';
  end if;

  if p_new_status not in ('voided') then
    raise exception 'invalid_status';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'status_reason_required';
  end if;

  select * into v_inspection
  from public.inspections
  where id = p_inspection_id and organization_id = v_org_id;

  if v_inspection.id is null then
    raise exception 'inspection_not_found';
  end if;

  select role into v_caller_role from public.profiles where id = auth.uid();

  if v_inspection.status = 'scheduled' then
    if v_caller_role is null or (
      v_inspection.assigned_inspector_id is distinct from auth.uid()
      and v_caller_role not in ('org_admin', 'portfolio_manager', 'supervisor')
    ) then
      raise exception 'insufficient_permission';
    end if;
  else
    if v_caller_role is null or v_caller_role != 'org_admin' then
      raise exception 'admin_required_past_scheduled';
    end if;
  end if;

  v_before := to_jsonb(v_inspection);

  update public.inspections
  set status = p_new_status, status_reason = p_reason
  where id = p_inspection_id
  returning * into v_inspection;

  perform public.log_audit_event(
    'void_inspection', 'inspection', p_inspection_id, v_before, to_jsonb(v_inspection)
  );

  return v_inspection;
end;
$$;

revoke all on function public.set_inspection_status(uuid, text, text) from public;
grant execute on function public.set_inspection_status(uuid, text, text) to authenticated;

create or replace function public.delete_inspection(
  p_inspection_id uuid,
  p_reason text
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller_role text;
  v_inspection public.inspections;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null then
    raise exception 'not_authenticated';
  end if;

  if p_reason is null or trim(p_reason) = '' then
    raise exception 'status_reason_required';
  end if;

  select * into v_inspection
  from public.inspections
  where id = p_inspection_id and organization_id = v_org_id;

  if v_inspection.id is null then
    raise exception 'inspection_not_found';
  end if;

  select role into v_caller_role from public.profiles where id = auth.uid();

  if v_inspection.status = 'scheduled' then
    if v_caller_role is null or (
      v_inspection.assigned_inspector_id is distinct from auth.uid()
      and v_caller_role not in ('org_admin', 'portfolio_manager', 'supervisor')
    ) then
      raise exception 'insufficient_permission';
    end if;
  else
    if v_caller_role is null or v_caller_role != 'org_admin' then
      raise exception 'admin_required_past_scheduled';
    end if;
  end if;

  perform public.log_audit_event(
    'delete_inspection', 'inspection', p_inspection_id, to_jsonb(v_inspection), null
  );

  delete from public.inspections where id = p_inspection_id;
end;
$$;

revoke all on function public.delete_inspection(uuid, text) from public;
grant execute on function public.delete_inspection(uuid, text) to authenticated;
