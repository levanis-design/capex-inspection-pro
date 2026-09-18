-- Phase 3, migration 1 of 5: organizations and profiles.
--
-- Run this in the Supabase dashboard: SQL Editor -> New query -> paste
-- this whole file -> Run. Apply migrations 0001-0005 in order, each as
-- its own run, before moving to the next one.

-- Organizations: one per tenant. Free-plan entitlement limits are plain
-- integer columns (not buried in jsonb) so create_property() and future
-- device-registration functions can read/lock them directly and cheaply.
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan_tier text not null default 'free'
    check (plan_tier in ('free','individual','professional','team','enterprise')),
  property_slot_limit integer not null default 1,
  device_slot_limit integer not null default 1,
  user_seat_limit integer not null default 1,
  teammate_invites_allowed boolean not null default false,
  plan_limits_extra jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is
  'One row per tenant. Free-plan limits are enforced by create_property() '
  '(and, later, device-registration functions) under a row lock -- never '
  'by the client alone.';

-- Profiles: one per Supabase auth user, extending it with org + role.
-- Note: profiles.id is NOT auto-generated -- it is always set to the
-- matching auth.users.id (see the handle_new_user() trigger in the next
-- migration), which is what lets auth.uid() = profiles.id work everywhere.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text,
  email text not null,
  email_verified_at timestamptz,
  role text not null default 'inspector'
    check (role in ('org_admin','portfolio_manager','supervisor','inspector','viewer')),
  mfa_enrolled boolean not null default false,
  status text not null default 'active' check (status in ('active','invited','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_organization_id_idx on public.profiles(organization_id);

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;

-- Helper used by every RLS policy in this project. SECURITY DEFINER lets
-- it read `profiles` without recursing into the RLS policy it's used by
-- (the standard Supabase-documented pattern for this exact situation).
create or replace function public.current_organization_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select organization_id from public.profiles where id = auth.uid();
$$;

revoke all on function public.current_organization_id() from public;
grant execute on function public.current_organization_id() to authenticated;

create policy "org_select_own" on public.organizations
  for select using (id = public.current_organization_id());

create policy "org_update_own_admin" on public.organizations
  for update using (
    id = public.current_organization_id()
    and exists (select 1 from public.profiles where id = auth.uid() and role = 'org_admin')
  );

-- Deliberately no insert policy: organizations are only ever created by
-- the handle_new_user() trigger in the next migration.

create policy "profiles_select_own_org" on public.profiles
  for select using (organization_id = public.current_organization_id());

create policy "profiles_update_self" on public.profiles
  for update using (id = auth.uid());

create policy "profiles_update_by_admin" on public.profiles
  for update using (
    organization_id = public.current_organization_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'org_admin')
  );

-- Deliberately no insert policy: profile rows are only ever created by
-- the handle_new_user() trigger in the next migration.
