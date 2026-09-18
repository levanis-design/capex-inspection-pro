-- Optional, one-time backfill -- run this ONLY if you have existing
-- auth.users from Phase 2 testing (created before the sign-up trigger
-- existed) that don't have an organization/profile yet. Safe to run more
-- than once; it skips any user that already has a profile.
--
-- If you'd rather just start clean, skip this file and instead delete
-- your old test user(s) in the Supabase dashboard (Authentication ->
-- Users) and sign up fresh in the app -- the new trigger will handle it
-- automatically.

do $$
declare
  u record;
  v_org_id uuid;
begin
  for u in
    select au.id, au.email, au.email_confirmed_at
    from auth.users au
    left join public.profiles p on p.id = au.id
    where p.id is null
  loop
    insert into public.organizations (name, plan_tier, property_slot_limit, device_slot_limit, user_seat_limit, teammate_invites_allowed)
      values (split_part(u.email, '@', 1) || '''s organization', 'free', 1, 1, 1, false)
      returning id into v_org_id;

    insert into public.profiles (id, organization_id, email, role, email_verified_at)
      values (u.id, v_org_id, u.email, 'org_admin', u.email_confirmed_at);
  end loop;
end $$;
