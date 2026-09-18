-- Phase 17: Phase 10 security-roadmap follow-up (see TEST_PLAN.md's
-- "Device registration and security" section for the two specific gaps
-- this closes -- both were explicitly called out there as "not built
-- this phase" back when Phase 10 shipped).
--
-- 1. Per-action aal2 enforcement at the RLS/function layer. Phase 10
-- already requires org_admin to complete MFA (reach aal2) before the
-- client ever routes them into the rest of the app (see
-- mfa-setup.tsx/mfa-challenge.tsx) -- but that is a client-side routing
-- gate, not a database-level one. A valid aal1 JWT for an org_admin
-- account (e.g. a session captured before MFA was completed, or a direct
-- API call that skips the app's own routing entirely) could previously
-- still pass every RLS policy and SECURITY DEFINER function that only
-- checks `role = 'org_admin'`, since none of them looked at the session's
-- authenticator assurance level at all. This migration adds that check
-- to every place in the schema that is *exclusively* gated to org_admin
-- (as opposed to the broader org_admin/portfolio_manager/supervisor
-- "management" set used elsewhere) -- because org_admin is the only role
-- Phase 10 actually requires MFA for. Requiring aal2 on the broader
-- management set would lock out portfolio_manager/supervisor accounts,
-- which are never prompted to enroll MFA today; that would be a product
-- change, not a hardening fix, and is deliberately out of scope here.
--
-- Every one of the actions below already has a real, tested access
-- boundary (role = 'org_admin'); this migration only narrows an already-
-- correct check, so nothing here should change what a properly-MFA'd
-- org_admin can do in the real app -- see this migration's own
-- verification notes in CHANGELOG.md for the full before/after test
-- matrix.
--
-- 2. `devices.status` is now actually checked somewhere. TEST_PLAN.md's
-- own note: "nothing in the app currently checks devices.status before
-- allowing API calls, so a revoked device's existing session keeps
-- working." A true RLS-level tie between *every* table's access and the
-- calling device's row would require a device-id claim inside the JWT,
-- which needs a Supabase Auth Hook (dashboard-configured infrastructure,
-- same category of thing this project has deferred before for
-- login_failed/rate_limit_triggered security events -- see migration
-- 0022's header comment). Short of that, this migration doesn't add a
-- new table or column -- `fetchThisDeviceStatus()` (src/lib/
-- device-registration.ts) just reads the caller's own already-existing
-- `devices` row (already selectable per `devices_select_own_or_admin`)
-- and the app acts on it: a periodic foreground check
-- ((app)/_layout.tsx) and a check at the top of every sync attempt
-- (offline-sync.ts) both sign the device out the moment they see
-- `status = 'revoked'`. Real enforcement (a rejected write can't
-- silently succeed) still comes entirely from the role/RLS boundary
-- above; this is a client-side "stop offering the season ticket" check
-- layered on top, not a new server-side wall -- said plainly here rather
-- than implied.

-- Reads the current request's JWT claims -- the standard Supabase
-- Postgres helper every hosted project provides (this project already
-- relies on its sibling auth.uid() throughout; auth.jwt() is the same
-- kind of platform-provided function, not something this migration
-- creates). `aal` is `'aal1'` for a password-only session and `'aal2'`
-- once a second factor has been verified in this session -- see
-- src/lib/mfa.ts's own getAuthenticatorAssuranceLevel() for the client
-- side of this exact claim.
-- security definer for the same reason current_organization_id() and
-- current_user_is_org_admin() already are (see their comments in 0001/
-- 0020): calling auth.jwt() as plain `authenticated` needs schema-level
-- USAGE on `auth`, which this project has never granted directly to
-- authenticated (every other auth.* call in this schema has always gone
-- through a security definer wrapper too) -- running as this function's
-- owner instead sidesteps that entirely, the same way it already does
-- for auth.uid().
create or replace function public.current_user_has_aal2()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select auth.jwt() ->> 'aal') = 'aal2', false);
$$;

revoke all on function public.current_user_has_aal2() from public;
grant execute on function public.current_user_has_aal2() to authenticated;

-- organizations: org_update_own_admin is entirely org_admin-gated (no
-- "update your own row" branch the way profiles has) -- safe to require
-- aal2 across the whole policy.
alter policy "org_update_own_admin" on public.organizations
  using (
    id = (select public.current_organization_id())
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role = 'org_admin'
    )
    and (select public.current_user_has_aal2())
  );

-- profiles: profiles_update_self_or_admin has TWO branches -- "update
-- your own row" (any role, no MFA requirement at all) and "an org_admin
-- updating someone else's row." Only the second branch gets the aal2
-- check; gating the first would lock every ordinary user out of editing
-- their own name.
alter policy "profiles_update_self_or_admin" on public.profiles
  using (
    id = (select auth.uid())
    or (
      organization_id = (select public.current_organization_id())
      and (select public.current_user_is_org_admin())
      and (select public.current_user_has_aal2())
    )
  );

-- devices: devices_select_own_or_admin also has two branches -- "see
-- your own device row(s)" (no MFA requirement) and "an org_admin seeing
-- every device in the org." Same split as profiles above.
alter policy "devices_select_own_or_admin" on public.devices
  using (
    organization_id = (select public.current_organization_id())
    and (
      user_id = (select auth.uid())
      or (
        (select public.current_user_is_org_admin())
        and (select public.current_user_has_aal2())
      )
    )
  );

-- security_events: entirely org_admin-only, no self-row branch at all --
-- safe to require aal2 across the whole policy.
alter policy "security_events_select_admin_only" on public.security_events
  using (
    organization_id = (select public.current_organization_id())
    and (select public.current_user_is_org_admin())
    and (select public.current_user_has_aal2())
  );

-- revoke_device(): entirely org_admin-gated already (see migration
-- 0022) -- add the aal2 check alongside the existing role check.
create or replace function public.revoke_device(
  p_device_id uuid,
  p_reason text default 'admin_revoked'
)
returns public.devices
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_device public.devices;
  v_reason text;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null then
    raise exception 'not_authenticated';
  end if;

  if not public.current_user_is_org_admin() then
    raise exception 'insufficient_permission';
  end if;

  if not public.current_user_has_aal2() then
    raise exception 'aal2_required';
  end if;

  v_reason := coalesce(nullif(trim(p_reason), ''), 'admin_revoked');

  select * into v_device from public.devices
    where id = p_device_id and organization_id = v_org_id and status = 'active';

  if v_device.id is null then
    raise exception 'device_not_found';
  end if;

  update public.devices
  set status = 'revoked', revoked_at = now(), revoked_reason = v_reason
  where id = p_device_id
  returning * into v_device;

  insert into public.security_events (organization_id, user_id, event_type, metadata)
    values (v_org_id, v_device.user_id, 'device_revoked',
      jsonb_build_object('device_id', v_device.id, 'reason', v_reason));

  perform public.log_audit_event('device_revoked', 'device', p_device_id, null, to_jsonb(v_device));

  return v_device;
end;
$$;

revoke all on function public.revoke_device(uuid, text) from public;
grant execute on function public.revoke_device(uuid, text) to authenticated;

-- set_inspection_check_status() (migration 0009): the org_admin-only
-- branch is specifically "deactivate/supersede/mark-not-applicable a
-- *critical* check" -- every other status change on a non-critical check
-- stays open to org_admin/portfolio_manager, unaffected.
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

  select * into v_check from public.inspection_check_library
    where id = p_check_id and organization_id = v_org_id;
  if v_check is null then
    raise exception 'check_not_found';
  end if;

  if v_check.critical and p_new_status != 'active'
     and (v_caller_role != 'org_admin' or not public.current_user_has_aal2()) then
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

-- set_property_check_assignment_status() (migration 0013): identical
-- critical-check-deactivation-requires-admin branch, same treatment.
-- Signature/body otherwise reproduced exactly as 0013 defined it --
-- `create or replace function` only actually replaces (rather than
-- creating an overload) when the argument list matches exactly.
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
    if coalesce(v_critical, false) and p_new_status != 'active'
       and (v_caller_role != 'org_admin' or not public.current_user_has_aal2()) then
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

-- set_inspection_status() (migration 0015): the org_admin-only branch is
-- specifically "change the status of an inspection that has moved past
-- 'scheduled'" -- the assigned inspector/management branch for a
-- still-scheduled inspection is unaffected.
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
    if v_caller_role is null or v_caller_role != 'org_admin' or not public.current_user_has_aal2() then
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

-- delete_inspection() (migration 0015): identical past-scheduled
-- org_admin-only branch, same treatment.
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
    if v_caller_role is null or v_caller_role != 'org_admin' or not public.current_user_has_aal2() then
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

-- delete_property() (migration 0023): entirely org_admin-gated already,
-- no other branch -- add the aal2 check alongside the existing role
-- check.
create or replace function public.delete_property(p_property_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller_role text;
  v_property public.properties;
  v_inspection_count integer;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null then
    raise exception 'not_authenticated';
  end if;

  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role != 'org_admin' then
    raise exception 'insufficient_permission';
  end if;

  if not public.current_user_has_aal2() then
    raise exception 'aal2_required';
  end if;

  select * into v_property
  from public.properties
  where id = p_property_id and organization_id = v_org_id;

  if v_property.id is null then
    raise exception 'property_not_found';
  end if;

  select count(*) into v_inspection_count
  from public.inspections
  where property_id = p_property_id;

  if v_inspection_count > 0 then
    raise exception 'property_has_inspections';
  end if;

  perform public.log_audit_event(
    'delete_property', 'property', p_property_id, to_jsonb(v_property), null
  );

  delete from public.properties where id = p_property_id;
end;
$$;

revoke all on function public.delete_property(uuid) from public;
grant execute on function public.delete_property(uuid) to authenticated;
