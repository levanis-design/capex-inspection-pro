-- Phase 3, migration 3 of 5: properties, and the transactional
-- create_property() function that enforces the Free-plan property limit.

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  street_address text,
  city text,
  state text,
  zip text,
  region text,
  property_type text,
  year_built integer,
  num_buildings integer,
  num_floors integer,
  num_units integer,
  construction_type text,
  occupancy_type text,
  portfolio_group text,
  property_manager_name text,
  facility_lead_name text,
  emergency_contact text,
  notes text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index properties_organization_id_idx on public.properties(organization_id);

alter table public.properties enable row level security;

create policy "properties_select_own_org" on public.properties
  for select using (organization_id = public.current_organization_id());

create policy "properties_update_own_org" on public.properties
  for update using (
    organization_id = public.current_organization_id()
    and exists (select 1 from public.profiles where id = auth.uid() and role in ('org_admin','portfolio_manager'))
  )
  with check (organization_id = public.current_organization_id());

-- Deliberately NO insert policy for the authenticated role. The only way
-- to create a property is create_property() below, which locks the
-- organization row and re-checks property_slot_limit inside the same
-- transaction as the insert -- this is what makes the Free-plan "1
-- property" limit unbypassable by a fast client or two concurrent
-- requests. See DATABASE_SCHEMA.md "Entitlement enforcement".

create or replace function public.create_property(p_payload jsonb)
returns public.properties
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller_role text;
  v_limit integer;
  v_used integer;
  v_row public.properties;
  v_name text;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null then
    raise exception 'not_authenticated';
  end if;

  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role not in ('org_admin','portfolio_manager') then
    raise exception 'insufficient_permission';
  end if;

  v_name := trim(p_payload->>'name');
  if v_name is null or v_name = '' then
    raise exception 'name_required';
  end if;

  -- Row lock: closes the race condition where two concurrent calls both
  -- read "under limit" before either has inserted.
  select property_slot_limit into v_limit
    from public.organizations where id = v_org_id for update;

  select count(*) into v_used from public.properties
    where organization_id = v_org_id and status in ('active','archived');

  if v_used >= v_limit then
    raise exception 'property_slot_limit_reached';
  end if;

  insert into public.properties (
    organization_id, name, street_address, city, state, zip, region,
    property_type, year_built, num_buildings, num_floors, num_units,
    construction_type, occupancy_type, portfolio_group,
    property_manager_name, facility_lead_name, emergency_contact, notes
  ) values (
    v_org_id,
    v_name,
    p_payload->>'street_address',
    p_payload->>'city',
    p_payload->>'state',
    p_payload->>'zip',
    p_payload->>'region',
    p_payload->>'property_type',
    nullif(p_payload->>'year_built','')::integer,
    nullif(p_payload->>'num_buildings','')::integer,
    nullif(p_payload->>'num_floors','')::integer,
    nullif(p_payload->>'num_units','')::integer,
    p_payload->>'construction_type',
    p_payload->>'occupancy_type',
    p_payload->>'portfolio_group',
    p_payload->>'property_manager_name',
    p_payload->>'facility_lead_name',
    p_payload->>'emergency_contact',
    p_payload->>'notes'
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_property(jsonb) from public;
grant execute on function public.create_property(jsonb) to authenticated;
