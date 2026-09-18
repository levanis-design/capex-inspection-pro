-- Phase 3, migration 2 of 5: the sign-up trigger.
--
-- This is what closes the Phase 2 scope gap noted in
-- src/app/(auth)/sign-up.tsx -- from now on, every new Supabase Auth user
-- automatically gets a brand-new Free-plan organization and becomes its
-- org_admin. No app code changes are needed for this.
--
-- IMPORTANT FUTURE NOTE (not a Phase 3 concern, just flagging it so it
-- isn't missed later): once a teammate-invite flow exists (paid plans
-- only, per PRODUCT_SPEC.md), this trigger will need to check for a
-- pending invite first and, if one exists, attach the new user to that
-- existing organization instead of always creating a new one.

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

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
