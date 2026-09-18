-- Phase 5C, sync engine: what the client-side sync engine
-- (src/lib/offline-sync.ts) needs from the database to push local
-- SQLite mirror changes safely once a device comes back online:
--
--   1. `inspection_snapshot_locations.updated_at` -- this table never had
--      one (unlike `inspection_snapshot_items`, which got one in 0011),
--      so there was no server-side signal the sync engine could compare
--      against to tell "nobody else touched this row since we last saw
--      it" apart from "someone else changed it while we were offline
--      too" -- exactly the conflict PRODUCT_SPEC.md section 9 requires
--      flagging rather than silently overwriting.
--   2. A `set_updated_at()` trigger on both `inspection_snapshot_locations`
--      and `inspection_snapshot_items`, so `updated_at` is bumped by the
--      database itself on every update, unconditionally -- never trusted
--      from whatever the client happened to send. Without this, a client
--      could (accidentally or not) push a stale `updated_at` and defeat
--      the whole conflict check. `inspection_snapshot_items.updated_at`
--      already existed but was never actually bumped by anything -- it
--      only ever held its insert-time value -- so this also fixes that
--      silently-never-worked case as a side effect.
--   3. `photos.client_uuid` -- the same offline idempotent sync key
--      `inspection_snapshot_items` already got in 0011, for exactly the
--      same reason: a photo captured offline and retried after a dropped
--      connection (or a retried sync run) must never create a duplicate
--      row. Generated client-side once at capture time
--      (src/lib/offline-photos.ts), never reused.

alter table public.inspection_snapshot_locations
  add column updated_at timestamptz not null default now();

alter table public.photos
  add column client_uuid uuid;

-- Mirrors inspection_snapshot_items_client_uuid_idx from 0011 exactly --
-- unique only where set, so every photo captured before this migration
-- (client_uuid null) is unaffected.
create unique index photos_client_uuid_idx
  on public.photos(client_uuid) where client_uuid is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at_inspection_snapshot_locations
  before update on public.inspection_snapshot_locations
  for each row execute function public.set_updated_at();

create trigger set_updated_at_inspection_snapshot_items
  before update on public.inspection_snapshot_items
  for each row execute function public.set_updated_at();
