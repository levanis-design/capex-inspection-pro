-- Phase 3, migration 4 of 5: buildings, the area/component library
-- tables, property locations, location components, and systems/assets.
-- This is the data backbone for PRODUCT_SPEC.md section 7's hierarchy:
-- Organization -> Property -> Building -> Area/Location -> Component/Asset.
--
-- Scope note: this migration creates the tables and standard (global)
-- area/component library. The guided setup wizard UI, the inspection
-- check library, and automatic checklist generation are Phase 4, not
-- this migration.

create table public.buildings (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  street_address text,
  notes text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now()
);

-- organization_id null = platform standard library, visible to everyone.
-- A non-null organization_id is that org's own custom area/component.
create table public.area_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  is_custom boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

create table public.component_types (
  id uuid primary key default gen_random_uuid(),
  area_type_id uuid not null references public.area_types(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  is_custom boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

-- A property may contain multiple instances of the same area type (e.g.
-- two stairwells, two roofs) -- each is its own row with its own name.
create table public.property_locations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  building_id uuid references public.buildings(id) on delete set null,
  area_type_id uuid not null references public.area_types(id),
  parent_location_id uuid references public.property_locations(id) on delete set null,
  name text not null,
  floor text,
  route_order integer not null default 0,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now()
);

create index property_locations_property_id_idx on public.property_locations(property_id);

create table public.systems_assets (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  location_id uuid references public.property_locations(id) on delete set null,
  category text,
  name text not null,
  manufacturer text,
  model text,
  serial_number text,
  install_date date,
  expected_service_life_years integer,
  warranty_expiration date,
  responsible_department text,
  pm_frequency text,
  last_service_date date,
  next_service_date date,
  certificate_expiration date,
  notes text,
  status text not null default 'active' check (status in ('active','inactive','replaced')),
  created_at timestamptz not null default now()
);

-- Confirmed components at a specific location instance. Some components
-- are just structural/architectural features (e.g. "Flooring") with no
-- asset_id; others correspond to a trackable piece of equipment (e.g.
-- "Boilers") and link to a systems_assets row.
create table public.location_components (
  id uuid primary key default gen_random_uuid(),
  property_location_id uuid not null references public.property_locations(id) on delete cascade,
  component_type_id uuid not null references public.component_types(id),
  asset_id uuid references public.systems_assets(id) on delete set null,
  confirmed boolean not null default false,
  status text not null default 'active' check (status in ('active','inactive','replaced','not_applicable')),
  notes text,
  created_at timestamptz not null default now()
);

create index location_components_location_idx on public.location_components(property_location_id);

alter table public.buildings enable row level security;
alter table public.area_types enable row level security;
alter table public.component_types enable row level security;
alter table public.property_locations enable row level security;
alter table public.systems_assets enable row level security;
alter table public.location_components enable row level security;

create policy "buildings_org_access" on public.buildings
  for all using (
    exists (select 1 from public.properties p where p.id = buildings.property_id and p.organization_id = public.current_organization_id())
  )
  with check (
    exists (select 1 from public.properties p where p.id = buildings.property_id and p.organization_id = public.current_organization_id())
  );

-- Area/component types: everyone can read the platform standard library
-- (organization_id is null) plus their own org's custom entries. Writes
-- are only allowed into your own org's rows -- nobody can edit the
-- shared platform standard library.
create policy "area_types_select" on public.area_types
  for select using (organization_id is null or organization_id = public.current_organization_id());
create policy "area_types_write_own_org" on public.area_types
  for insert with check (organization_id = public.current_organization_id());
create policy "area_types_update_own_org" on public.area_types
  for update using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

create policy "component_types_select" on public.component_types
  for select using (organization_id is null or organization_id = public.current_organization_id());
create policy "component_types_write_own_org" on public.component_types
  for insert with check (organization_id = public.current_organization_id());
create policy "component_types_update_own_org" on public.component_types
  for update using (organization_id = public.current_organization_id())
  with check (organization_id = public.current_organization_id());

create policy "property_locations_org_access" on public.property_locations
  for all using (
    exists (select 1 from public.properties p where p.id = property_locations.property_id and p.organization_id = public.current_organization_id())
  )
  with check (
    exists (select 1 from public.properties p where p.id = property_locations.property_id and p.organization_id = public.current_organization_id())
  );

create policy "systems_assets_org_access" on public.systems_assets
  for all using (
    exists (select 1 from public.properties p where p.id = systems_assets.property_id and p.organization_id = public.current_organization_id())
  )
  with check (
    exists (select 1 from public.properties p where p.id = systems_assets.property_id and p.organization_id = public.current_organization_id())
  );

create policy "location_components_org_access" on public.location_components
  for all using (
    exists (
      select 1 from public.property_locations pl
      join public.properties p on p.id = pl.property_id
      where pl.id = location_components.property_location_id
        and p.organization_id = public.current_organization_id()
    )
  )
  with check (
    exists (
      select 1 from public.property_locations pl
      join public.properties p on p.id = pl.property_id
      where pl.id = location_components.property_location_id
        and p.organization_id = public.current_organization_id()
    )
  );
