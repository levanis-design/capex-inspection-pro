-- Phase 7: reports. PRODUCT_SPEC.md section 11 only says "generated
-- client-side, immutable once approved, stored in history" -- the actual
-- data model was never spelled out (v0.1's detail was never carried
-- forward into v0.2), so this migration defines it from scratch,
-- following the same immutable-snapshot + SECURITY DEFINER governance
-- pattern already established by inspection_snapshots (0011) and
-- set_inspection_status()/delete_inspection() (0015):
--
--   - `reports` is append-only. There is no update/delete policy at all
--     -- once a report exists for an inspection, it is permanent, same
--     as an inspection_snapshot. The PDF itself is rendered on-device
--     (per spec) from the inspection's already-frozen snapshot data, so
--     what's "immutable" is the rendered artifact -- the underlying
--     corrective_actions/findings rows keep evolving after approval
--     (that's the whole point of the corrective-actions board), the
--     approved PDF just doesn't change to reflect it.
--   - Exactly one report per inspection (`inspection_id` is `unique`).
--     PRODUCT_SPEC.md never describes re-issuing/superseding a report,
--     and treating it the same as an inspection_snapshot (one-shot,
--     frozen at a specific moment) is the simplest reading of
--     "immutable once approved." If a correction is ever needed, that's
--     a future decision (e.g. a follow_up inspection type already
--     exists for exactly this kind of "re-do" scenario), not something
--     to guess a versioning scheme for now.
--   - The only way a row is inserted is `approve_report()` below -- same
--     shape as `create_property()`/`generate_property_checklist()`: the
--     client renders the PDF, uploads the file to Storage itself (using
--     the same client_uuid-as-path-segment idempotency approach as
--     photos, so a retried upload after an interrupted approval doesn't
--     collide), then calls this function to atomically record the
--     report row -- only once the row exists is the report "approved."
--     A successful Storage upload with no matching `reports` row (e.g.
--     the app was killed between the two steps) is an orphaned object,
--     same acceptable-for-now class of orphan `delete_inspection()`'s
--     comment (0015) already notes for photos.
--   - Only org_admin/portfolio_manager/supervisor may approve (matches
--     PRODUCT_SPEC.md section 4's role table: "Review & approve
--     reports" is Y for those three roles, not inspector/viewer).
--     Everyone in the org can still read an approved report once it
--     exists (same as photos/inspections -- this is a read, not an
--     approval action).
--   - Only a 'completed' inspection can get a report -- approving a
--     report for one that's still in progress, or one that's been
--     voided, doesn't make sense ("immutable snapshot of a finished
--     inspection").

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null unique references public.inspections(id) on delete cascade,
  storage_path text not null,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index reports_organization_idx on public.reports(organization_id);

alter table public.reports enable row level security;

create policy "reports_select_own_org" on public.reports
  for select using (organization_id = (select public.current_organization_id()));

-- Deliberately no insert/update/delete policy -- approve_report() below
-- is the only write path, same pattern as inspection_snapshots.

-- Private bucket, same `{organization_id}/{inspection_id}/{report_id}.pdf`
-- path-prefix-checked RLS shape as the inspection-photos bucket (0014),
-- select/insert only -- a report PDF is never updated or deleted once
-- uploaded.
insert into storage.buckets (id, name, public)
values ('inspection-reports', 'inspection-reports', false)
on conflict (id) do nothing;

create policy "inspection_reports_select_own_org" on storage.objects
  for select using (
    bucket_id = 'inspection-reports'
    and (storage.foldername(name))[1] = (select public.current_organization_id())::text
  );

create policy "inspection_reports_insert_own_org" on storage.objects
  for insert with check (
    bucket_id = 'inspection-reports'
    and (storage.foldername(name))[1] = (select public.current_organization_id())::text
    and exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and role in ('org_admin', 'portfolio_manager', 'supervisor')
    )
  );

create or replace function public.approve_report(
  p_inspection_id uuid,
  p_storage_path text
)
returns public.reports
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller_role text;
  v_inspection public.inspections;
  v_report public.reports;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null then
    raise exception 'not_authenticated';
  end if;

  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role not in ('org_admin', 'portfolio_manager', 'supervisor') then
    raise exception 'insufficient_permission';
  end if;

  select * into v_inspection
  from public.inspections
  where id = p_inspection_id and organization_id = v_org_id;

  if v_inspection.id is null then
    raise exception 'inspection_not_found';
  end if;

  if v_inspection.status != 'completed' then
    raise exception 'inspection_not_completed';
  end if;

  if exists (select 1 from public.reports where inspection_id = p_inspection_id) then
    raise exception 'report_already_approved';
  end if;

  if p_storage_path is null or trim(p_storage_path) = '' then
    raise exception 'storage_path_required';
  end if;

  -- Defends against a forged path pointing at another org's folder --
  -- the Storage insert policy above already enforces this for the
  -- upload itself, this just makes sure the row we record matches.
  if p_storage_path not like (v_org_id::text || '/%') then
    raise exception 'storage_path_invalid';
  end if;

  insert into public.reports (organization_id, inspection_id, storage_path, approved_by)
  values (v_org_id, p_inspection_id, p_storage_path, auth.uid())
  returning * into v_report;

  perform public.log_audit_event(
    'approve_report', 'inspection', p_inspection_id, null, to_jsonb(v_report)
  );

  return v_report;
end;
$$;

revoke all on function public.approve_report(uuid, text) from public;
grant execute on function public.approve_report(uuid, text) to authenticated;
