-- Phase 4, migration 1 of 3: the audit log, and the checklist-hierarchy
-- tables from PRODUCT_SPEC.md section 7 / DATABASE_SCHEMA.md Part B --
-- inspection_check_library, check_applicability_rules,
-- property_check_assignments, property_template_versions.
--
-- Scope note: this migration creates tables, indexes, and RLS only.
-- Seeding the standard check library is 0008; the checklist generator
-- and the critical-check governance function are 0009.

-- audit_log: general business-data change trail (DATABASE_SCHEMA.md
-- Part A). Writes only ever happen through log_audit_event() below --
-- never a direct client insert -- so the trail can't be skipped or
-- tampered with by a buggy screen.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_organization_id_idx on public.audit_log(organization_id, created_at desc);

-- Inspection check library: organization_id null = platform standard
-- library (same pattern as area_types/component_types). Any transition
-- away from 'active' must carry a reason -- enforced here at the
-- database level, not just in whatever function writes it -- and
-- critical-check governance (admin approval, audit logging) is enforced
-- in set_inspection_check_status() in 0009, the only supported way to
-- change a check's status.
create table public.inspection_check_library (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  instructions text,
  standard_status_options jsonb not null default
    '["satisfactory","deficiency","not_applicable","not_inspected","pending_verification"]'::jsonb,
  photo_required boolean not null default false,
  comment_required boolean not null default false,
  measurement_required boolean not null default false,
  measurement_unit text,
  acceptable_range_min numeric,
  acceptable_range_max numeric,
  default_priority text check (default_priority in ('P1','P2','P3','P4')),
  default_department text,
  frequency text,
  critical boolean not null default false,
  regional_tag text,
  seasonal boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive','not_applicable','superseded')),
  status_reason text,
  status_changed_by uuid references public.profiles(id) on delete set null,
  status_changed_at timestamptz,
  superseded_by_check_id uuid references public.inspection_check_library(id),
  version_number integer not null default 1,
  created_at timestamptz not null default now(),
  constraint inspection_check_status_reason_required
    check (status = 'active' or status_reason is not null)
);

-- Applicability rules: what the generator evaluates to decide which
-- checks apply where. Deliberately has no organization_id column -- a
-- platform-standard rule (property_id null) is visible to everyone, and
-- a property-specific override (property_id set) is scoped through that
-- property's own organization via the RLS policy below.
create table public.check_applicability_rules (
  id uuid primary key default gen_random_uuid(),
  inspection_check_id uuid not null references public.inspection_check_library(id) on delete cascade,
  area_type_id uuid references public.area_types(id),
  component_type_id uuid references public.component_types(id),
  asset_category text,
  inspection_type text,
  region_tag text,
  season text,
  frequency text,
  property_id uuid references public.properties(id) on delete cascade,
  rule_type text not null default 'include' check (rule_type in ('include','exclude')),
  notes text,
  created_at timestamptz not null default now()
);

create index check_applicability_rules_check_idx on public.check_applicability_rules(inspection_check_id);
create index check_applicability_rules_area_type_idx on public.check_applicability_rules(area_type_id);
create index check_applicability_rules_component_type_idx on public.check_applicability_rules(component_type_id);

-- The resolved, editable property checklist. This is deliberately
-- insert/update-restricted for the authenticated role -- the only way to
-- populate it is generate_property_checklist() in 0009, the same
-- "SECURITY DEFINER function is the only write path" pattern as
-- create_property() -- which is what makes the duplicate-prevention
-- unique index below actually reliable rather than advisory.
create table public.property_check_assignments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  property_location_id uuid not null references public.property_locations(id) on delete cascade,
  location_component_id uuid references public.location_components(id) on delete cascade,
  inspection_check_id uuid not null references public.inspection_check_library(id),
  source_rule_id uuid references public.check_applicability_rules(id) on delete set null,
  override_priority text check (override_priority in ('P1','P2','P3','P4')),
  override_department text,
  status text not null default 'active' check (status in ('active','inactive','not_applicable','superseded')),
  status_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint property_check_assignment_status_reason_required
    check (status = 'active' or status_reason is not null)
);

create index property_check_assignments_property_idx on public.property_check_assignments(property_id);
create index property_check_assignments_location_idx on public.property_check_assignments(property_location_id);

-- Duplicate prevention (PRODUCT_SPEC.md section 7 / DATABASE_SCHEMA.md
-- "Duplicate prevention"): the generator relies on this to never insert
-- the same (location, component, check) combination twice while active.
-- This has to be a partial unique INDEX rather than a table CHECK/UNIQUE
-- constraint for two reasons: Postgres can't express "unique among active
-- rows only" as a plain constraint, and location_component_id is
-- nullable -- without coalescing it to a sentinel value, two rows that
-- both have a null location_component_id would NOT collide (NULL is
-- never equal to NULL in a unique index), which would silently defeat
-- the whole point of this index for location-level (no-component) checks.
create unique index property_check_assignments_unique_active
  on public.property_check_assignments (
    property_id,
    property_location_id,
    coalesce(location_component_id, '00000000-0000-0000-0000-000000000000'::uuid),
    inspection_check_id
  )
  where status = 'active';

-- Frozen snapshot of the resolved checklist at the moment it was
-- generated/saved -- history and diffing, and (later) what an inspection
-- snapshot points at instead of the live property_check_assignments, so
-- editing the property template never alters an in-progress or
-- completed inspection.
create table public.property_template_versions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  version_number integer not null,
  assignments_snapshot jsonb not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  change_summary text,
  status text not null default 'active' check (status in ('draft','active'))
);

create unique index property_template_versions_property_version_idx
  on public.property_template_versions(property_id, version_number);

alter table public.audit_log enable row level security;
alter table public.inspection_check_library enable row level security;
alter table public.check_applicability_rules enable row level security;
alter table public.property_check_assignments enable row level security;
alter table public.property_template_versions enable row level security;

create policy "audit_log_select_own_org" on public.audit_log
  for select using (organization_id = public.current_organization_id());
-- Deliberately no insert/update/delete policy -- see log_audit_event().

create policy "inspection_check_library_select" on public.inspection_check_library
  for select using (organization_id is null or organization_id = public.current_organization_id());
-- Deliberately no insert/update policy -- see set_inspection_check_status()
-- in 0009. Org-specific custom checks are not yet creatable from the app
-- (a later phase); today the library is the seeded platform standard only.

create policy "check_applicability_rules_select" on public.check_applicability_rules
  for select using (
    property_id is null
    or exists (select 1 from public.properties p where p.id = check_applicability_rules.property_id and p.organization_id = public.current_organization_id())
  );
-- Deliberately no insert policy -- property-specific applicability
-- overrides are not yet creatable from the app (a later phase); today
-- the generator only evaluates the seeded platform-standard rules.

create policy "property_check_assignments_select" on public.property_check_assignments
  for select using (
    exists (select 1 from public.properties p where p.id = property_check_assignments.property_id and p.organization_id = public.current_organization_id())
  );
-- Deliberately no insert/update policy -- see generate_property_checklist()
-- in 0009.

create policy "property_template_versions_select" on public.property_template_versions
  for select using (
    exists (select 1 from public.properties p where p.id = property_template_versions.property_id and p.organization_id = public.current_organization_id())
  );
-- Deliberately no insert policy -- written only by generate_property_checklist().

-- log_audit_event(): the only supported way to write to audit_log. Any
-- other SECURITY DEFINER function (create_property(),
-- set_inspection_check_status(), generate_property_checklist(), ...) calls
-- this rather than inserting into audit_log directly, so every audit
-- entry is guaranteed to carry a real organization_id/actor_id pair
-- resolved the same way everywhere.
create or replace function public.log_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb default null,
  p_after jsonb default null
)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before, after)
    values (v_org_id, auth.uid(), p_action, p_entity_type, p_entity_id, p_before, p_after);
end;
$$;

revoke all on function public.log_audit_event(text, text, uuid, jsonb, jsonb) from public;
grant execute on function public.log_audit_event(text, text, uuid, jsonb, jsonb) to authenticated;
