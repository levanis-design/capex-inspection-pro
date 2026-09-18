-- Phase 14: compliance document/date tracking, deliberately scoped out of
-- migration 0024 (Phase 13's preventive-maintenance checklist content) as
-- its own feature. Source: the "Compliance & Documentation" section of the
-- checklist the user shared (boiler/elevator/fire-safety certificate
-- expirations, FISP/LL11 status, log/vendor-report review) -- this is
-- property-level document + expiration-date state, not a per-location
-- checkbox item, so it doesn't fit the area/component/check model
-- (check_applicability_rules et al.) that 0024 extended. It gets its own
-- table instead.
--
-- Modeled as a plain CRUD entity, the same shape as `vendors` (0017): no
-- protected/derived column, no entitlement or immutability concern, so a
-- direct RLS policy is enough -- no SECURITY DEFINER function needed just
-- to manage a document list. Read is open to the whole org (any role can
-- see what's expiring); write is restricted to org_admin/portfolio_manager/
-- supervisor, the same role set every other management action in this app
-- (vendors, findings, corrective actions, checklist assignment) already
-- uses.
--
-- `status` is deliberately NOT the sole source of truth for "is this
-- current" -- an admin-set 'valid' would silently go stale the day the
-- certificate expires if nothing recomputed it. Instead the app derives
-- the *displayed* status from `expiration_date` compared to today (valid /
-- expiring soon / expired), and `status` itself only carries the two
-- values that aren't derivable from a date: 'pending_renewal' (a manual
-- note that action is already underway) and 'not_applicable' (this
-- property doesn't have this kind of certificate/permit at all, e.g. no
-- elevator). See src/lib/compliance-document-types.ts's
-- `computeDisplayStatus()` for the actual derivation, kept client-side
-- like isOverdueForEscalation()/isOverdueForCompletion() in
-- corrective-action-types.ts already are for the same reason.
--
-- Scope note: a compliance document here holds at most one photo/scan
-- (`storage_path`) -- unlike inspection photos (0014), which are 1:many
-- against an item and captured through the offline-first encrypted local
-- mirror (offline-photos.ts) because inspectors take them in the field
-- with unreliable signal. Managing compliance records is an office/admin
-- task with a normal connection, so this deliberately stays a simple
-- online-only upload -- no local mirror, no offline queue. If a
-- multi-page certificate ever needs more than one image, add another row
-- for now; true multi-photo-per-document support is a clean future
-- extension of this table, not a redesign.

create table public.compliance_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  document_type text not null default 'other'
    check (document_type in (
      'boiler_certificate', 'elevator_certificate', 'fire_safety_permit', 'fisp_ll11', 'other'
    )),
  title text not null,
  issuing_authority text,
  expiration_date date,
  -- See header comment: only the two non-derivable states live here.
  -- 'valid' is the default/rest state whenever neither applies -- the
  -- app derives the actual displayed valid/expiring-soon/expired label
  -- from expiration_date whenever status = 'valid'.
  status text not null default 'valid'
    check (status in ('valid', 'pending_renewal', 'not_applicable')),
  notes text,
  storage_path text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index compliance_documents_organization_idx on public.compliance_documents(organization_id);
create index compliance_documents_property_idx on public.compliance_documents(property_id);

alter table public.compliance_documents enable row level security;

create policy "compliance_documents_select_own_org" on public.compliance_documents
  for select using (organization_id = public.current_organization_id());

-- Same shape as vendors_insert_own_org/vendors_update_own_org (0017), plus
-- one check vendors doesn't need: vendors has no property_id at all, but
-- compliance_documents does, and a bare `organization_id = current org`
-- check alone would let a caller attach a document (correctly stamped
-- with their own organization_id) to a property_id that actually belongs
-- to a DIFFERENT org -- the FK only guarantees the property exists
-- *somewhere*, not that it's this caller's. The extra `exists` against
-- `properties` closes that, the same way photos_insert_own_org (0014)
-- joins out to confirm the inspection it's attached to is really the
-- caller's org's before allowing the insert.
create policy "compliance_documents_insert_own_org" on public.compliance_documents
  for insert with check (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('org_admin', 'portfolio_manager', 'supervisor')
    )
    and exists (
      select 1 from public.properties p
      where p.id = compliance_documents.property_id and p.organization_id = compliance_documents.organization_id
    )
  );

create policy "compliance_documents_update_own_org" on public.compliance_documents
  for update using (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('org_admin', 'portfolio_manager', 'supervisor')
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.properties p
      where p.id = compliance_documents.property_id and p.organization_id = compliance_documents.organization_id
    )
  );

-- Unlike vendors (which has no delete policy -- inactive status instead),
-- a compliance record has no analogous "inactive" state that means
-- "shouldn't have been created" (that's what 'not_applicable' is for, and
-- it's a real answer, not a soft-delete). Deletion covers the mistaken-
-- entry/duplicate case, gated to the same management roles as every other
-- write here.
create policy "compliance_documents_delete_own_org" on public.compliance_documents
  for delete using (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('org_admin', 'portfolio_manager', 'supervisor')
    )
  );

create trigger set_updated_at_compliance_documents
  before update on public.compliance_documents
  for each row execute function public.set_updated_at();

-- Private Storage bucket, same isolation pattern as inspection-photos
-- (0014): objects live at `{organization_id}/{property_id}/{uuid}.jpg`,
-- and every policy checks that leading folder segment against the
-- caller's own organization. Unlike inspection-photos (where any
-- assigned inspector can capture), write access here is restricted to
-- the same management roles as the table itself -- managing compliance
-- records is an admin/supervisor task, not a field-inspector one.
insert into storage.buckets (id, name, public)
values ('compliance-documents', 'compliance-documents', false)
on conflict (id) do nothing;

create policy "compliance_documents_photos_select_own_org" on storage.objects
  for select using (
    bucket_id = 'compliance-documents'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
  );

create policy "compliance_documents_photos_insert_own_org" on storage.objects
  for insert with check (
    bucket_id = 'compliance-documents'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('org_admin', 'portfolio_manager', 'supervisor')
    )
  );

create policy "compliance_documents_photos_delete_own_org" on storage.objects
  for delete using (
    bucket_id = 'compliance-documents'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('org_admin', 'portfolio_manager', 'supervisor')
    )
  );
