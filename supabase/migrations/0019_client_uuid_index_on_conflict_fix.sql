-- Fixes a latent bug in migration 0016's `photos.client_uuid` unique
-- index (and 0011's identically-shaped `inspection_snapshot_items` one):
-- both were declared *partial* (`where client_uuid is not null`), which
-- is fatally incompatible with the plain `ON CONFLICT (client_uuid)`
-- target that PostgREST emits for `.upsert(..., { onConflict:
-- 'client_uuid' })` (see offline-sync.ts's `pushPendingPhoto` and
-- offline-photos.ts's online-capture path). Postgres can only use a
-- partial unique index as an ON CONFLICT inference target when the
-- INSERT's own ON CONFLICT clause repeats the exact same WHERE
-- predicate -- something PostgREST's `on_conflict=` query parameter has
-- no way to express. Every single photo upload (not just retries) has
-- therefore been failing at the `photos` insert step with
-- `42P10: there is no unique or exclusion constraint matching the ON
-- CONFLICT specification`, confirmed both from the Supabase project's
-- Postgres logs (2026-09-09) and reproduced directly against a scratch
-- local table with the identical partial-index shape:
--
--   create unique index t_idx on t(client_uuid) where client_uuid is not null;
--   insert into t (client_uuid) values ('...') on conflict (client_uuid) do nothing;
--   -- ERROR:  there is no unique or exclusion constraint matching the
--   --         ON CONFLICT specification
--
-- The partial predicate was never actually necessary: a plain
-- (non-partial) unique index already allows unlimited NULL rows without
-- conflict -- standard SQL treats NULL as never equal to another NULL
-- for uniqueness purposes -- which was the whole reason the predicate
-- was added in the first place ("every photo captured before this
-- migration, client_uuid null, is unaffected"). Dropping the predicate
-- keeps that guarantee (verified locally: three NULL rows coexist fine)
-- and fixes the ON CONFLICT inference (verified locally: an insert, then
-- a retried identical insert, both go through the exact
-- `on conflict (client_uuid) do nothing` PostgREST generates, with the
-- second one correctly no-op'ing instead of erroring -- and a genuine
-- duplicate, non-retried insert is still correctly rejected as a unique
-- violation).
--
-- `inspection_snapshot_items_client_uuid_idx` isn't actively hit by this
-- bug today (nothing in the app currently upserts against it with an
-- `onConflict` clause -- ad-hoc item creation doesn't go through this
-- path yet), but it's the same landmine waiting for whatever offline
-- ad-hoc-item path eventually does, so it's fixed here too rather than
-- leaving a second copy of it in the schema.

drop index public.photos_client_uuid_idx;
create unique index photos_client_uuid_idx on public.photos(client_uuid);

drop index public.inspection_snapshot_items_client_uuid_idx;
create unique index inspection_snapshot_items_client_uuid_idx
  on public.inspection_snapshot_items(client_uuid);
