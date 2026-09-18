-- Phase 5, migration 1 of 2: the inspection tables from
-- DATABASE_SCHEMA.md Part B -- inspections (the header/scheduling
-- record), and the immutable inspection_snapshots /
-- inspection_snapshot_locations / inspection_snapshot_items that freeze
-- a copy of the checklist at the moment an inspection starts, so a later
-- edit to the property's template never alters an in-progress or
-- completed inspection.
--
-- Scope note: this migration creates tables and RLS only.
-- start_inspection() -- the function that resolves an inspection's scope
-- and generates its snapshot -- is 0012.

create table public.inspections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  inspection_type text not null check (inspection_type in (
    'comprehensive', 'preventive_maintenance', 'roof', 'seasonal', 'fire_life_safety',
    'mechanical', 'exterior_grounds', 'common_area', 'apartment_unit',
    'move_in', 'move_out', 'capital_planning', 'follow_up', 'custom'
  )),
  assigned_inspector_id uuid references public.profiles(id) on delete set null,
  scheduled_date date,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'completed', 'postponed', 'voided')),
  scope_selection jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index inspections_property_idx on public.inspections(property_id);
create index inspections_organization_idx on public.inspections(organization_id);

-- Immutable freeze -- generated once by start_inspection() and never
-- edited afterward. 1:1 with inspections.
create table public.inspection_snapshots (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null unique references public.inspections(id) on delete cascade,
  property_template_version_id uuid references public.property_template_versions(id),
  generated_at timestamptz not null default now(),
  generated_by uuid references public.profiles(id) on delete set null
);

create table public.inspection_snapshot_locations (
  id uuid primary key default gen_random_uuid(),
  inspection_snapshot_id uuid not null references public.inspection_snapshots(id) on delete cascade,
  property_location_id uuid not null references public.property_locations(id),
  sequence_order integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'complete', 'skipped', 'inaccessible', 'not_applicable')),
  status_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  constraint inspection_snapshot_location_reason_required
    check (status in ('pending', 'in_progress', 'complete') or status_reason is not null)
);

create index inspection_snapshot_locations_snapshot_idx
  on public.inspection_snapshot_locations(inspection_snapshot_id);

-- Note: the spec's fuller rule -- a location also needs a reason if any
-- item under it ends up not_inspected at submission time -- is a
-- cross-table condition a CHECK constraint can't express, and per
-- PRODUCT_SPEC.md section 8 it's explicitly a UI-level gate ("the final
-- review screen surfaces all of them before submission"), not a database
-- one. That review screen is Phase 5B/5D, not this migration.
create table public.inspection_snapshot_items (
  id uuid primary key default gen_random_uuid(),
  inspection_snapshot_location_id uuid not null
    references public.inspection_snapshot_locations(id) on delete cascade,
  property_check_assignment_id uuid references public.property_check_assignments(id),
  inspection_check_id uuid not null references public.inspection_check_library(id),
  title text not null,
  instructions text,
  location_component_id uuid references public.location_components(id) on delete set null,
  status text not null default 'not_inspected'
    check (status in ('satisfactory', 'deficiency', 'not_applicable', 'not_inspected', 'pending_verification')),
  observation text,
  recommendation text,
  measurement_value numeric,
  measurement_unit text,
  code_reference text,
  priority text check (priority in ('P1', 'P2', 'P3', 'P4')),
  responsible_department text,
  responsible_person_id uuid references public.profiles(id) on delete set null,
  vendor_id uuid,
  access_status text,
  access_plan text,
  target_completion_date date,
  next_action text,
  follow_up_date date,
  work_order_number text,
  estimated_cost numeric,
  actual_cost numeric,
  labor_hours numeric,
  material_cost numeric,
  inspected_at timestamptz,
  is_ad_hoc boolean not null default false,
  ad_hoc_approval_status text check (ad_hoc_approval_status in ('pending', 'approved', 'rejected')),
  client_uuid uuid,
  sync_status text not null default 'synced' check (sync_status in ('synced', 'pending', 'conflict')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index inspection_snapshot_items_location_idx
  on public.inspection_snapshot_items(inspection_snapshot_location_id);
-- client_uuid is the offline idempotent sync key (PRODUCT_SPEC.md
-- section 9) -- unique so a retried/duplicated sync of the same
-- offline-created item can never insert it twice.
create unique index inspection_snapshot_items_client_uuid_idx
  on public.inspection_snapshot_items(client_uuid) where client_uuid is not null;

alter table public.inspections enable row level security;
alter table public.inspection_snapshots enable row level security;
alter table public.inspection_snapshot_locations enable row level security;
alter table public.inspection_snapshot_items enable row level security;

create policy "inspections_select_own_org" on public.inspections
  for select using (organization_id = public.current_organization_id());

-- Status/scheduling can move without a full round-trip through a
-- SECURITY DEFINER function -- there's no entitlement limit or
-- generated-content invariant to protect here, unlike create_property()
-- or generate_property_checklist(). Restricted to admins/managers or the
-- inspector this inspection is actually assigned to.
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
  with check (organization_id = public.current_organization_id());

-- Deliberately no insert policy -- see start_inspection() in 0012.

create policy "inspection_snapshots_select_own_org" on public.inspection_snapshots
  for select using (
    exists (
      select 1 from public.inspections i
      where i.id = inspection_snapshots.inspection_id
        and i.organization_id = public.current_organization_id()
    )
  );
-- Deliberately no insert/update policy -- written only by start_inspection(),
-- and never edited afterward (that's the whole point of a snapshot).

create policy "inspection_snapshot_locations_select_own_org" on public.inspection_snapshot_locations
  for select using (
    exists (
      select 1 from public.inspection_snapshots s
      join public.inspections i on i.id = s.inspection_id
      where s.id = inspection_snapshot_locations.inspection_snapshot_id
        and i.organization_id = public.current_organization_id()
    )
  );

create policy "inspection_snapshot_locations_update_own_org" on public.inspection_snapshot_locations
  for update using (
    exists (
      select 1 from public.inspection_snapshots s
      join public.inspections i on i.id = s.inspection_id
      where s.id = inspection_snapshot_locations.inspection_snapshot_id
        and i.organization_id = public.current_organization_id()
        and (
          i.assigned_inspector_id = auth.uid()
          or exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('org_admin', 'portfolio_manager', 'supervisor')
          )
        )
    )
  );
-- Deliberately no insert policy -- rows are only ever created by
-- start_inspection().

create policy "inspection_snapshot_items_select_own_org" on public.inspection_snapshot_items
  for select using (
    exists (
      select 1 from public.inspection_snapshot_locations l
      join public.inspection_snapshots s on s.id = l.inspection_snapshot_id
      join public.inspections i on i.id = s.inspection_id
      where l.id = inspection_snapshot_items.inspection_snapshot_location_id
        and i.organization_id = public.current_organization_id()
    )
  );

create policy "inspection_snapshot_items_update_own_org" on public.inspection_snapshot_items
  for update using (
    exists (
      select 1 from public.inspection_snapshot_locations l
      join public.inspection_snapshots s on s.id = l.inspection_snapshot_id
      join public.inspections i on i.id = s.inspection_id
      where l.id = inspection_snapshot_items.inspection_snapshot_location_id
        and i.organization_id = public.current_organization_id()
        and (
          i.assigned_inspector_id = auth.uid()
          or exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('org_admin', 'portfolio_manager', 'supervisor')
          )
        )
    )
  );
-- Deliberately no insert policy -- rows are only ever created by
-- start_inspection() (or, later, an offline sync path -- not built yet).
