-- Responds to the Supabase Security Advisor / Performance Advisor scan
-- pasted 2026-09-09 (taken before 0019 was applied -- 0019 only touched
-- the two client_uuid indexes and doesn't affect anything below, so the
-- findings are unchanged either way). Two of that scan's findings are
-- fixed here; the rest are deliberately NOT migrations -- see
-- CHANGELOG.md's entry for this file for the full triage writeup on
-- every finding, including the ones left alone and why.

-- 1. SECURITY: function_search_path_mutable on set_updated_at().
-- Every other function in this schema already sets `search_path = public`
-- (it's required for SECURITY DEFINER correctness, so it was never
-- missed there) -- set_updated_at() is a plain, non-SECURITY-DEFINER
-- trigger function, so it was the one function where this got skipped.
-- A mutable search_path on a function callable via a trigger is a real
-- (if narrow) risk: a malicious search_path could shadow `now()` with a
-- same-named function in a schema earlier in the path. Fixed the same
-- way as every other function.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 2. PERFORMANCE: auth_rls_initplan. Every policy below calls
-- `auth.uid()` and/or `public.current_organization_id()` directly in its
-- USING/WITH CHECK clause. Postgres's planner can't tell these are the
-- same value for every row being checked, so it re-evaluates them once
-- per row instead of once per query. Wrapping each call as
-- `(select auth.uid())` / `(select public.current_organization_id())`
-- gives the planner an InitPlan it can hoist out of the per-row scan --
-- this is Supabase's documented fix for this exact finding. Every
-- rewrite below is a pure mechanical wrap: same expression, same value,
-- computed once instead of per-row -- no policy's actual access rule
-- changes. Included storage.objects' inspection-photos policies too even
-- though the pasted advisor output didn't call out `storage` by name --
-- they have the identical unwrapped-current_organization_id() shape, so
-- left alone they'd hit the same per-row cost as every table policy did.

-- organizations
alter policy "org_select_own" on public.organizations
  using (id = (select public.current_organization_id()));

alter policy "org_update_own_admin" on public.organizations
  using (
    id = (select public.current_organization_id())
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role = 'org_admin'
    )
  );

-- profiles
--
-- IMPORTANT -- this uncovered a real, currently-live bug, unrelated to
-- the pasted advisor output: profiles_update_by_admin's `exists (select 1
-- from public.profiles p where p.id = auth.uid() and p.role =
-- 'org_admin')` is a self-referencing subquery against the SAME table
-- the policy protects. The moment Postgres evaluates ANY UPDATE against
-- `profiles` -- including a user updating their own row, which only
-- needs the OTHER (profiles_update_self) policy to pass -- it still has
-- to evaluate every permissive policy's qual to OR them together, which
-- means re-entering profiles' own row-security machinery for the inner
-- subquery's read of `profiles p`. Postgres detects that self-reentrancy
-- and raises "infinite recursion detected in policy for relation
-- profiles" rather than looping forever. Verified locally (see
-- TEST_PLAN.md): this reproduces with the ORIGINAL, unwrapped
-- `auth.uid()` too -- it is not something the initplan rewrite below
-- introduced, it just happened to be caught while writing this
-- migration's regression tests, because nothing in the app has ever
-- actually issued an UPDATE against `profiles` yet (every current
-- profiles read is a plain `.select()` -- see findings.ts,
-- use-current-organization.ts, manage.tsx). It's a live landmine for the
-- first feature that lets a user edit their own name, or an admin change
-- someone's role, directly against this table.
--
-- Fixed the same way current_organization_id() already avoids this exact
-- trap for every OTHER policy in this schema (see its comment in 0001):
-- move the self-referencing check into its own SECURITY DEFINER helper.
-- A SECURITY DEFINER function runs as its owner, which owns `profiles`
-- and therefore bypasses RLS on it entirely when it reads -- so the
-- inner read no longer re-enters `profiles`' own policy evaluation at
-- all, and the recursion is structurally impossible rather than merely
-- avoided by evaluation order.
--
-- Also resolves the separate multiple_permissive_policies finding on
-- profiles UPDATE: profiles_update_self and profiles_update_by_admin
-- were two separate permissive policies for the same role/action, so
-- Postgres had to evaluate and OR both for every UPDATE. Same combined
-- rule, one policy.
create or replace function public.current_user_is_org_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'org_admin'
  );
$$;

revoke all on function public.current_user_is_org_admin() from public;
grant execute on function public.current_user_is_org_admin() to authenticated;

alter policy "profiles_select_own_org" on public.profiles
  using (organization_id = (select public.current_organization_id()));

drop policy "profiles_update_self" on public.profiles;
drop policy "profiles_update_by_admin" on public.profiles;

create policy "profiles_update_self_or_admin" on public.profiles
  for update using (
    id = (select auth.uid())
    or (
      organization_id = (select public.current_organization_id())
      and (select public.current_user_is_org_admin())
    )
  );

-- properties
alter policy "properties_select_own_org" on public.properties
  using (organization_id = (select public.current_organization_id()));

alter policy "properties_update_own_org" on public.properties
  using (
    organization_id = (select public.current_organization_id())
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role in ('org_admin', 'portfolio_manager')
    )
  )
  with check (organization_id = (select public.current_organization_id()));

-- inspections
alter policy "inspections_select_own_org" on public.inspections
  using (organization_id = (select public.current_organization_id()));

alter policy "inspections_update_own_org" on public.inspections
  using (
    organization_id = (select public.current_organization_id())
    and (
      assigned_inspector_id = (select auth.uid())
      or exists (
        select 1 from public.profiles
        where id = (select auth.uid()) and role in ('org_admin', 'portfolio_manager', 'supervisor')
      )
    )
  )
  with check (
    organization_id = (select public.current_organization_id())
    and status is distinct from 'voided'
  );

-- inspection_snapshot_locations
alter policy "inspection_snapshot_locations_select_own_org" on public.inspection_snapshot_locations
  using (
    exists (
      select 1 from public.inspection_snapshots s
      join public.inspections i on i.id = s.inspection_id
      where s.id = inspection_snapshot_locations.inspection_snapshot_id
        and i.organization_id = (select public.current_organization_id())
    )
  );

alter policy "inspection_snapshot_locations_update_own_org" on public.inspection_snapshot_locations
  using (
    exists (
      select 1 from public.inspection_snapshots s
      join public.inspections i on i.id = s.inspection_id
      where s.id = inspection_snapshot_locations.inspection_snapshot_id
        and i.organization_id = (select public.current_organization_id())
        and (
          i.assigned_inspector_id = (select auth.uid())
          or exists (
            select 1 from public.profiles
            where id = (select auth.uid()) and role in ('org_admin', 'portfolio_manager', 'supervisor')
          )
        )
    )
  );

-- inspection_snapshot_items
alter policy "inspection_snapshot_items_select_own_org" on public.inspection_snapshot_items
  using (
    exists (
      select 1 from public.inspection_snapshot_locations l
      join public.inspection_snapshots s on s.id = l.inspection_snapshot_id
      join public.inspections i on i.id = s.inspection_id
      where l.id = inspection_snapshot_items.inspection_snapshot_location_id
        and i.organization_id = (select public.current_organization_id())
    )
  );

alter policy "inspection_snapshot_items_update_own_org" on public.inspection_snapshot_items
  using (
    exists (
      select 1 from public.inspection_snapshot_locations l
      join public.inspection_snapshots s on s.id = l.inspection_snapshot_id
      join public.inspections i on i.id = s.inspection_id
      where l.id = inspection_snapshot_items.inspection_snapshot_location_id
        and i.organization_id = (select public.current_organization_id())
        and (
          i.assigned_inspector_id = (select auth.uid())
          or exists (
            select 1 from public.profiles
            where id = (select auth.uid()) and role in ('org_admin', 'portfolio_manager', 'supervisor')
          )
        )
    )
  );

-- photos
alter policy "photos_select_own_org" on public.photos
  using (organization_id = (select public.current_organization_id()));

alter policy "photos_insert_own_org" on public.photos
  with check (
    organization_id = (select public.current_organization_id())
    and exists (
      select 1 from public.inspection_snapshot_items i
      join public.inspection_snapshot_locations l on l.id = i.inspection_snapshot_location_id
      join public.inspection_snapshots s on s.id = l.inspection_snapshot_id
      join public.inspections ins on ins.id = s.inspection_id
      where i.id = photos.inspection_snapshot_item_id
        and ins.organization_id = (select public.current_organization_id())
        and (
          ins.assigned_inspector_id = (select auth.uid())
          or exists (
            select 1 from public.profiles
            where id = (select auth.uid()) and role in ('org_admin', 'portfolio_manager', 'supervisor')
          )
        )
    )
  );

alter policy "photos_delete_own_org" on public.photos
  using (
    organization_id = (select public.current_organization_id())
    and exists (
      select 1 from public.inspection_snapshot_items i
      join public.inspection_snapshot_locations l on l.id = i.inspection_snapshot_location_id
      join public.inspection_snapshots s on s.id = l.inspection_snapshot_id
      join public.inspections ins on ins.id = s.inspection_id
      where i.id = photos.inspection_snapshot_item_id
        and ins.organization_id = (select public.current_organization_id())
        and (
          ins.assigned_inspector_id = (select auth.uid())
          or exists (
            select 1 from public.profiles
            where id = (select auth.uid()) and role in ('org_admin', 'portfolio_manager', 'supervisor')
          )
        )
    )
  );

-- vendors
alter policy "vendors_select_own_org" on public.vendors
  using (organization_id = (select public.current_organization_id()));

alter policy "vendors_insert_own_org" on public.vendors
  with check (
    organization_id = (select public.current_organization_id())
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role in ('org_admin', 'portfolio_manager', 'supervisor')
    )
  );

alter policy "vendors_update_own_org" on public.vendors
  using (
    organization_id = (select public.current_organization_id())
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role in ('org_admin', 'portfolio_manager', 'supervisor')
    )
  )
  with check (organization_id = (select public.current_organization_id()));

-- storage.objects (inspection-photos bucket) -- same fix, bonus scope,
-- see comment above.
alter policy "inspection_photos_select_own_org" on storage.objects
  using (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = (select public.current_organization_id())::text
  );

alter policy "inspection_photos_insert_own_org" on storage.objects
  with check (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = (select public.current_organization_id())::text
  );

alter policy "inspection_photos_delete_own_org" on storage.objects
  using (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = (select public.current_organization_id())::text
  );

alter policy "inspection_photos_update_own_org" on storage.objects
  using (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = (select public.current_organization_id())::text
  )
  with check (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = (select public.current_organization_id())::text
  );
