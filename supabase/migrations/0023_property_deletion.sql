-- Phase 11 (interim): delete_property(), a true hard-delete for a
-- property that has never had an inspection. Archiving a property
-- (status = 'archived') already works today via the existing
-- properties_update_own_org RLS policy -- no new function needed for
-- that, the client just updates the row directly. But archiving
-- deliberately still counts against property_slot_limit (see
-- create_property()'s v_used count in migration 0003, and
-- PRODUCT_SPEC.md section 13), so it doesn't free a Free-plan slot.
-- Some users want the row actually gone. This function is that path.
--
-- Restricted to org_admin (not portfolio_manager) given it's
-- irreversible, and gated on zero inspections ever having been
-- recorded against the property -- once a single inspection exists,
-- deleting the property would either cascade away real inspection/
-- finding history (inspections/property_locations/assets all cascade
-- on delete from properties) or orphan it, neither of which is
-- acceptable. Archiving remains the only option once inspections
-- exist.

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
