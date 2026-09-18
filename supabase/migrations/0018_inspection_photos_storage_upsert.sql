-- Follow-on fix to the photo-sync retry-loop bug (see CHANGELOG.md,
-- 2026-09-09 entry): adding `{ upsert: true }` to both Storage `.upload()`
-- call sites (offline-sync.ts's pushPendingPhoto(), offline-photos.ts's
-- online-capture path) correctly stopped a *brand-new* retry from being
-- rejected outright with "the resource already exists" -- but it exposed
-- a second, previously-unreachable bug for the two photos that had
-- *already* gotten far enough to land in Storage once already, on the
-- upload attempt before the interruption: a Supabase Storage upload with
-- `upsert: true` against a path that already exists takes an UPDATE path
-- internally (not a plain INSERT), and 0014 only ever granted `select`/
-- `insert`/`delete` policies on `storage.objects` for this bucket -- there
-- was no `update` policy at all, so that UPDATE was rejected by RLS's
-- default-deny with "new row violates row-level security policy."
--
-- Confirmed from the field: after the upsert fix shipped and the app was
-- rebuilt, the exact same two photo ids that hit the original
-- "already exists" error immediately hit this new error instead -- exactly
-- what "the object landed in Storage already, now the retry needs UPDATE
-- rights it doesn't have" predicts.
--
-- Fix: add the missing update policy, scoped identically to the existing
-- insert/select/delete policies (same `{organization_id}/...` path-prefix
-- check as every other policy on this bucket).
create policy "inspection_photos_update_own_org" on storage.objects
  for update using (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  )
  with check (
    bucket_id = 'inspection-photos'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );
