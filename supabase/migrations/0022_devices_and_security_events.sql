-- Phase 10: device registration & security (PRODUCT_SPEC.md section 3,
-- DATABASE_SCHEMA.md Part A). Unlike Reports/Dashboard, this section of
-- the spec was already fully designed back in Phase 1 (v0.2) and never
-- lost its detail -- this migration is a straightforward implementation
-- of that existing design, not a from-scratch redesign.
--
-- Scope decision made with the user before writing this (see
-- CHANGELOG.md's Phase 10 entry for the full reasoning): real Google
-- Play Integrity verification needs a native Android module Expo Go
-- can't call, plus a Google Cloud project linked to Play Console that
-- doesn't exist yet (PRODUCT_SPEC.md's own decision log deferred that
-- linkage to "Phase 12 lead-up"). So this migration builds the complete,
-- real device/security data model and every transactional guarantee
-- around it, while the Play Integrity verdict itself is computed by the
-- register-device Edge Function in a clearly-marked bypass mode until
-- that linkage exists -- see supabase/functions/register-device's header
-- comment. Nothing here fakes a verdict as "verified"; the bypass is
-- honest about being a bypass, in `play_integrity_verdict`.
--
-- Also deliberately narrower than DATABASE_SCHEMA.md's full
-- `security_events.event_type` list: `login_failed`, `mfa_challenge_failed`,
-- `captcha_failed`, and `rate_limit_triggered` all happen at points
-- Supabase Auth doesn't persist as rows in any table this project can
-- read or trigger on -- capturing them needs Supabase Auth Hooks (a
-- dashboard-configured webhook), which is a separate piece of
-- infrastructure to set up, not a migration. `signup`, `email_verified`,
-- `login_success`, and `mfa_enrolled` are all implemented here (the first
-- two via triggers/functions on tables this project already owns or
-- already has a precedent for touching -- `auth.users`, via
-- `handle_new_user()`'s existing trigger, same as migration 0002; the
-- latter two via a plain `authenticated`-callable function the client
-- calls at the right moment, rather than guessing at the exact shape of
-- `auth.sessions`/`auth.mfa_factors`, which this project has never
-- touched before and isn't confident enough about to trigger on sight
-- unseen against the live project).

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- HMAC-SHA256 of the app-scoped identifier, computed server-side by the
  -- register-device Edge Function using a secret that never reaches the
  -- client. The raw identifier itself is never stored anywhere -- see
  -- DATABASE_SCHEMA.md's "devices" entry.
  fingerprint_hash text not null,
  -- Last verified Play Integrity verdict, or (for now) the bypass record
  -- the Edge Function writes instead -- see this migration's header
  -- comment. Never raw device/hardware data.
  play_integrity_verdict jsonb,
  status text not null default 'active' check (status in ('active', 'revoked')),
  -- Doubles as this row's "created at" -- there's no meaningful
  -- distinction between "registered" and "created" for a device row, so
  -- a separate created_at would just always equal this.
  registered_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  replaced_by_device_id uuid references public.devices(id) on delete set null,
  constraint devices_revoked_fields_consistent
    check (
      (status = 'active' and revoked_at is null and revoked_reason is null)
      or (status = 'revoked' and revoked_at is not null and revoked_reason is not null)
    )
);

create index devices_organization_idx on public.devices(organization_id);
create index devices_user_idx on public.devices(user_id);
-- Enforces "at most one active device per org+fingerprint" -- the same
-- physical device can't be simultaneously "active" under two different
-- rows. (Per-user "at most one active device" is enforced by
-- register_or_replace_device()'s logic below, not by a table constraint,
-- since the replace-then-insert sequence briefly has zero active rows
-- for that user between the revoke and the insert.)
create unique index devices_org_fingerprint_active_idx
  on public.devices(organization_id, fingerprint_hash) where status = 'active';

alter table public.devices enable row level security;

-- A user sees their own device row(s); an org_admin sees every device in
-- the organization (needed for the Devices & Security screen's org-wide
-- view and to know what they're revoking). Written with `(select ...)`
-- around every auth.uid()/helper-function call from the start, per the
-- auth_rls_initplan performance pattern migration 0020 retrofitted onto
-- every earlier policy.
create policy "devices_select_own_or_admin" on public.devices
  for select using (
    organization_id = (select public.current_organization_id())
    and (
      user_id = (select auth.uid())
      or (select public.current_user_is_org_admin())
    )
  );

-- Deliberately no insert/update policy for `authenticated` at all.
-- Writes happen only via register_or_replace_device() (called by the
-- register-device Edge Function using the service role, which bypasses
-- RLS entirely -- that's fine, since the function itself re-derives and
-- re-checks everything from its own arguments rather than trusting the
-- caller) or revoke_device() (SECURITY DEFINER, callable directly by an
-- authenticated org_admin).

create table public.security_events (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: some events happen before an organization/profile exists
  -- yet (a rejected signup, say). Such rows are still written (by the
  -- service role, if ever needed) but are simply never visible to any
  -- authenticated user through the policy below, since there is no
  -- org for a null organization_id to match against -- that's correct,
  -- not an oversight.
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in (
    'signup', 'email_verified', 'login_success', 'login_failed',
    'mfa_enrolled', 'mfa_challenge_failed', 'device_registered',
    'device_replaced', 'device_revoked', 'password_reset_requested',
    'rate_limit_triggered', 'captcha_failed', 'play_integrity_rejected',
    'property_slot_denied', 'device_slot_denied'
  )),
  -- Never raw hardware identifiers or full tokens -- see this table's
  -- entry in DATABASE_SCHEMA.md.
  metadata jsonb not null default '{}'::jsonb,
  -- Not populated by anything in this migration (nothing here has a
  -- request IP to hash) -- reserved for a future Edge Function/Auth Hook
  -- that does.
  ip_hash text,
  created_at timestamptz not null default now()
);

create index security_events_organization_idx on public.security_events(organization_id);
create index security_events_created_at_idx on public.security_events(created_at desc);

alter table public.security_events enable row level security;

-- org_admin only, per PRODUCT_SPEC.md section 4's permission matrix
-- ("View this org's security_events: Y (org_admin), - (everyone else)").
create policy "security_events_select_admin_only" on public.security_events
  for select using (
    organization_id = (select public.current_organization_id())
    and (select public.current_user_is_org_admin())
  );
-- Deliberately no insert/update/delete policy for `authenticated` --
-- rows are written only by the SECURITY DEFINER functions below (or,
-- for the null-organization_id case, the service role directly).

-- The one and only way `devices` gets a new active row. Runs via the
-- register-device Edge Function's service-role client, which is why it
-- takes p_user_id/p_organization_id as arguments instead of deriving
-- them from auth.uid()/current_organization_id() the way every other
-- SECURITY DEFINER function in this project does -- a service-role
-- Postgres connection has no JWT, so auth.uid() would just be null here.
-- The Edge Function is responsible for having already verified the
-- caller's JWT before ever calling this. Mirrors create_property()'s
-- row-lock-then-check-then-write shape (0003) for the same atomicity
-- guarantee against two concurrent registrations racing past the limit.
create or replace function public.register_or_replace_device(
  p_organization_id uuid,
  p_user_id uuid,
  p_fingerprint_hash text,
  p_play_integrity_verdict jsonb
)
returns public.devices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_active_count integer;
  v_existing_device public.devices;
  v_new_device public.devices;
begin
  if p_organization_id is null or p_user_id is null
     or p_fingerprint_hash is null or length(trim(p_fingerprint_hash)) = 0 then
    raise exception 'invalid_arguments';
  end if;

  -- Row lock: closes the same "two concurrent registrations both see
  -- room under the limit" race create_property() already closes.
  select device_slot_limit into v_limit
    from public.organizations where id = p_organization_id for update;

  if v_limit is null then
    raise exception 'organization_not_found';
  end if;

  select * into v_existing_device
    from public.devices
    where organization_id = p_organization_id and user_id = p_user_id and status = 'active';

  if v_existing_device.id is not null and v_existing_device.fingerprint_hash = p_fingerprint_hash then
    -- Same device re-registering (ordinary app relaunch/sign-in) --
    -- idempotent no-op except refreshing the stored verdict.
    update public.devices
    set play_integrity_verdict = p_play_integrity_verdict
    where id = v_existing_device.id
    returning * into v_new_device;
    return v_new_device;
  end if;

  if v_existing_device.id is not null then
    -- Reinstall or legitimate device swap (PRODUCT_SPEC.md 3.3/5.6/5.7):
    -- revoke the old row, register the new one. Does not consume an
    -- additional slot -- one revoked, one added, net active count
    -- unchanged -- so the limit check below is deliberately skipped on
    -- this path.
    update public.devices
    set status = 'revoked', revoked_at = now(), revoked_reason = 'replaced'
    where id = v_existing_device.id;

    insert into public.devices (
      organization_id, user_id, fingerprint_hash, play_integrity_verdict, status, registered_at
    ) values (
      p_organization_id, p_user_id, p_fingerprint_hash, p_play_integrity_verdict, 'active', now()
    ) returning * into v_new_device;

    update public.devices set replaced_by_device_id = v_new_device.id where id = v_existing_device.id;

    insert into public.security_events (organization_id, user_id, event_type, metadata)
      values (
        p_organization_id, p_user_id, 'device_replaced',
        jsonb_build_object('previous_device_id', v_existing_device.id, 'new_device_id', v_new_device.id)
      );

    -- Direct insert rather than log_audit_event() -- that helper reads
    -- current_organization_id()/auth.uid(), both null under this
    -- service-role call.
    insert into public.audit_log (organization_id, actor_id, action, entity_type, entity_id, before, after)
      values (
        p_organization_id, p_user_id, 'device_replaced', 'device', v_new_device.id,
        to_jsonb(v_existing_device), to_jsonb(v_new_device)
      );

    return v_new_device;
  end if;

  -- Brand-new device for this user -- this is the only path that
  -- actually consumes a slot, so it's the only one checked against the
  -- limit.
  select count(*) into v_active_count
    from public.devices where organization_id = p_organization_id and status = 'active';

  if v_active_count >= v_limit then
    insert into public.security_events (organization_id, user_id, event_type, metadata)
      values (p_organization_id, p_user_id, 'device_slot_denied', '{}'::jsonb);
    raise exception 'device_slot_limit_reached';
  end if;

  insert into public.devices (
    organization_id, user_id, fingerprint_hash, play_integrity_verdict, status, registered_at
  ) values (
    p_organization_id, p_user_id, p_fingerprint_hash, p_play_integrity_verdict, 'active', now()
  ) returning * into v_new_device;

  insert into public.security_events (organization_id, user_id, event_type, metadata)
    values (p_organization_id, p_user_id, 'device_registered', jsonb_build_object('device_id', v_new_device.id));

  return v_new_device;
end;
$$;

revoke all on function public.register_or_replace_device(uuid, uuid, text, jsonb) from public;
grant execute on function public.register_or_replace_device(uuid, uuid, text, jsonb) to service_role;

-- Admin-initiated revoke -- e.g. a lost/stolen device, or cleaning up
-- after someone leaves. Ordinary SECURITY DEFINER function, callable
-- directly by an authenticated org_admin (no Edge Function needed --
-- there's no Play Integrity/HMAC step involved in revoking).
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

-- Called by the client right after a fully-authenticated session is
-- established (password sign-in, plus the MFA challenge if one was
-- required) -- see src/lib/auth-context.tsx. This is bookkeeping for
-- the Devices & Security screen's event log, not the actual security
-- boundary: the real proof of a successful sign-in is the Supabase
-- session/JWT itself, which already exists by the time this is called.
create or replace function public.log_login_success()
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

  insert into public.security_events (organization_id, user_id, event_type, metadata)
    values (v_org_id, auth.uid(), 'login_success', '{}'::jsonb);
end;
$$;

revoke all on function public.log_login_success() from public;
grant execute on function public.log_login_success() to authenticated;

-- Called by the client immediately after supabase.auth.mfa.verify()
-- succeeds during enrollment (src/lib/mfa.ts). Like log_login_success(),
-- this mirrors a fact Supabase Auth already established server-side
-- (the TOTP factor really did verify) into this project's own
-- `profiles.mfa_enrolled` column and audit trail -- it is not itself
-- what makes MFA "real." The actual second-factor guarantee is Supabase
-- Auth's own aal2 JWT claim, which src/lib/mfa.ts's
-- getAuthenticatorAssuranceLevel() check reads directly, never this flag.
-- (Deliberately not attempted via a trigger on auth.mfa_factors -- this
-- project has never touched that table before and isn't confident
-- enough of its exact column shape on the live project to trigger on it
-- sight-unseen; a client-called function needs no such assumption.)
create or replace function public.log_mfa_enrolled()
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

  update public.profiles set mfa_enrolled = true where id = auth.uid();

  insert into public.security_events (organization_id, user_id, event_type, metadata)
    values (v_org_id, auth.uid(), 'mfa_enrolled', '{}'::jsonb);
end;
$$;

revoke all on function public.log_mfa_enrolled() from public;
grant execute on function public.log_mfa_enrolled() to authenticated;

-- Extends the existing signup trigger (0002) to also record a `signup`
-- security event, in the same transaction as the org/profile creation it
-- already does -- same trigger, same safe well-proven attachment point
-- on auth.users, just one more insert in the body.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_org_name text;
begin
  v_org_name := coalesce(
    nullif(new.raw_user_meta_data->>'organization_name', ''),
    split_part(new.email, '@', 1) || '''s organization'
  );

  insert into public.organizations (name, plan_tier, property_slot_limit, device_slot_limit, user_seat_limit, teammate_invites_allowed)
    values (v_org_name, 'free', 1, 1, 1, false)
    returning id into v_org_id;

  insert into public.profiles (id, organization_id, email, role, email_verified_at)
    values (new.id, v_org_id, new.email, 'org_admin', new.email_confirmed_at);

  insert into public.security_events (organization_id, user_id, event_type, metadata)
    values (v_org_id, new.id, 'signup', '{}'::jsonb);

  return new;
end;
$$;

-- Records `email_verified` the moment auth.users.email_confirmed_at is
-- first set. auth.users is already a table this project creates triggers
-- on (0002's on_auth_user_created), so this is the same well-proven
-- attachment point, not a new assumption.
create or replace function public.handle_user_email_verified()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  if new.email_confirmed_at is not null and old.email_confirmed_at is null then
    select organization_id into v_org_id from public.profiles where id = new.id;
    if v_org_id is not null then
      update public.profiles set email_verified_at = new.email_confirmed_at where id = new.id;
      insert into public.security_events (organization_id, user_id, event_type, metadata)
        values (v_org_id, new.id, 'email_verified', '{}'::jsonb);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_verified on auth.users;
create trigger on_auth_user_email_verified
  after update of email_confirmed_at on auth.users
  for each row execute procedure public.handle_user_email_verified();
