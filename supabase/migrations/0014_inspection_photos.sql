-- Phase 5B-ext: photo capture during the inspection walkthrough. Per
-- PRODUCT_SPEC.md section 8 ("Item fields: ... photo(s) with before/after
-- designation and caption") and the `photo_required` flag already seeded
-- per check in 0008 (e.g. Roof Drains, Boiler Boilers -- but not every
-- check; Entrance Doors and Elevator Equipment aren't flagged) -- this
-- migration adds the `photos` table and a private Storage bucket, and
-- the app enforces (see the walkthrough screen) that a Satisfactory or
-- Deficiency status can't be set on an item whose check has
-- `photo_required = true` until at least one photo is attached.
--
-- Scope note: this is the "capture and attach a photo while online"
-- piece only. Local caching, offline queuing while a photo is taken with
-- no signal, and encryption-at-rest for a pending local copy remain
-- Phase 5C as originally scoped -- a photo taken here uploads immediately
-- and the item can't be marked satisfactory/deficiency until that upload
-- finishes successfully.

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inspection_snapshot_item_id uuid not null references public.inspection_snapshot_items(id) on delete cascade,
  storage_path text not null unique,
  designation text not null default 'general' check (designation in ('before', 'after', 'general')),
  caption text,
  taken_by uuid references public.profiles(id) on delete set null,
  taken_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index photos_item_idx on public.photos(inspection_snapshot_item_id);
create index photos_organization_idx on public.photos(organization_id);

alter table public.photos enable row level security;

create policy "photos_select_own_org" on public.photos
  for select using (organization_id = public.current_organization_id());

-- Insert/delete follow the exact same "assigned inspector or an
-- admin/portfolio_manager/supervisor" shape as
-- inspection_snapshot_items_update_own_org in 0011 -- taking or removing
-- a photo is part of recording an item, not a separate permission tier.
-- Unlike the snapshot tables, this one DOES get a direct client insert
-- policy: a photo isn't part of the frozen, generated checklist itself
-- (it's evidence attached to a mutable item), so there's no
-- immutability/entitlement reason to route it through a SECURITY
-- DEFINER function the way inspections/snapshots are.
create policy "photos_insert_own_org" on public.photos
  for insert with check (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.inspection_snapshot_items i
      join public.inspection_snapshot_locations l on l.id = i.inspection_snapshot_location_id
      join public.inspection_snapshots s on s.id = l.inspection_snapshot_id
      join public.inspections ins on ins.id = s.inspection_id
      where i.id = photos.inspection_snapshot_item_id
        and ins.organization_id = public.current_organization_id()
        and (
          ins.assigned_inspector_id = auth.uid()
          or exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('org_admin', 'portfolio_manager', 'supervisor')
          )
        )
    )
  );

create policy "photos_delete_own_org" on public.photos
  for delete using (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.inspection_snapshot_items i
      join public.inspection_snapshot_locations l on l.id = i.inspection_snapshot_location_id
      join public.inspection_snapshots s on s.id = l.inspection_snapshot_id
      join public.inspections ins on ins.id = s.inspection_id
      where i.id = photos.inspection_snapshot_item_id
        and ins.organization_id = public.current_organization_id()
        and (
          ins.assigned_inspector_id = auth.uid()
          or exists (
            select 1 from public.profiles
            where id = auth.uid() and role in ('org_admin', 'portfolio_manager', 'supervisor')
          )
        )
    )
  );

-- Private Storage bucket. Objects are uploaded to
-- `{organization_id}/{inspection_snapshot_item_id}/{uuid}.jpg` -- the
-- leading organization_id folder segment is what the policies below
-- check, exactly the same isolation guarantee as every table's RLS.
insert into storage.buckets (id, name, public)
values ('inspection-photos', 'inspection-photos', false)
on conflict (id) do nothing;

create policy "inspection_photos_select_own_org" on storage.objects
  for select using (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "inspection_photos_insert_own_org" on storage.objects
  for insert with check (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "inspection_photos_delete_own_org" on storage.objects
  for delete using (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );
