-- Phase 15: compliance tasks -- the other half of the source checklist's
-- "Compliance & Documentation" section that Phase 14 (migration 0025)
-- deliberately left out. 0025 covers a single document with an
-- expiration date (a certificate, a permit); this migration covers the
-- two items that are recurring REVIEW workflows instead, with no
-- expiration date of their own: "Review incident logs and maintenance
-- logs for patterns" and "Ensure contractor and vendor reports are up to
-- date." Neither fits compliance_documents' shape -- there's no
-- document, no expiration date, just "did someone review this on
-- schedule, and what did they find."
--
-- Two tables: `compliance_tasks` (the recurring task itself -- what it
-- is, how often it repeats) and `compliance_task_completions` (an
-- append-only log of every time someone actually did the review, with
-- their own findings note). This mirrors `findings`/`corrective_actions`
-- in spirit (a stable thing plus its own history of events against it),
-- though simpler -- no lifecycle state machine, since "reviewed on
-- <date>, here's what I found" is the whole event.
--
-- Deliberately NOT auto-seeded per property (unlike component_types/
-- inspection_check_library, which are platform-standard). A log-review
-- task applies generically to any property, but a vendor-report-review
-- task only makes sense for a vendor actually used at that property, and
-- `vendors` has no property_id to auto-associate from -- so, like
-- `vendors` itself, these are something an admin adds deliberately for
-- the properties/vendors that actually need one, not something the
-- platform can safely guess at creation time.

create table public.compliance_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  task_type text not null default 'other'
    check (task_type in ('log_review', 'vendor_report_review', 'other')),
  title text not null,
  description text,
  -- Only meaningful (and only allowed) for a vendor_report_review task --
  -- see the check constraint below. `on delete set null` rather than
  -- cascade: if a vendor record is ever removed, the review task and its
  -- completion history shouldn't vanish with it, just lose the linkage.
  vendor_id uuid references public.vendors(id) on delete set null,
  frequency text not null default 'monthly'
    check (frequency in ('weekly', 'monthly', 'quarterly', 'annual')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compliance_tasks_vendor_id_requires_type
    check (task_type = 'vendor_report_review' or vendor_id is null),
  constraint compliance_tasks_vendor_report_requires_vendor_id
    check (task_type != 'vendor_report_review' or vendor_id is not null)
);

create index compliance_tasks_organization_idx on public.compliance_tasks(organization_id);
create index compliance_tasks_property_idx on public.compliance_tasks(property_id);

alter table public.compliance_tasks enable row level security;

create policy "compliance_tasks_select_own_org" on public.compliance_tasks
  for select using (organization_id = public.current_organization_id());

-- Same shape as compliance_documents_insert_own_org (0025): a plain CRUD
-- entity, direct RLS, with the same property-id-belongs-to-this-org
-- check closing the same gap a bare organization_id match would leave
-- open. Also verifies vendor_id (when set) belongs to this org, for the
-- identical reason.
create policy "compliance_tasks_insert_own_org" on public.compliance_tasks
  for insert with check (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('org_admin', 'portfolio_manager', 'supervisor')
    )
    and exists (
      select 1 from public.properties p
      where p.id = compliance_tasks.property_id and p.organization_id = compliance_tasks.organization_id
    )
    and (
      vendor_id is null
      or exists (
        select 1 from public.vendors v
        where v.id = compliance_tasks.vendor_id and v.organization_id = compliance_tasks.organization_id
      )
    )
  );

create policy "compliance_tasks_update_own_org" on public.compliance_tasks
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
      where p.id = compliance_tasks.property_id and p.organization_id = compliance_tasks.organization_id
    )
    and (
      vendor_id is null
      or exists (
        select 1 from public.vendors v
        where v.id = compliance_tasks.vendor_id and v.organization_id = compliance_tasks.organization_id
      )
    )
  );

-- Deleting the TASK (not a completion -- see below) cascades its
-- completion history via the FK on compliance_task_completions. That's
-- intentional: deleting a task means "we don't track this review at
-- all," not "keep the log but drop what it was for."
create policy "compliance_tasks_delete_own_org" on public.compliance_tasks
  for delete using (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('org_admin', 'portfolio_manager', 'supervisor')
    )
  );

create trigger set_updated_at_compliance_tasks
  before update on public.compliance_tasks
  for each row execute function public.set_updated_at();

create table public.compliance_task_completions (
  id uuid primary key default gen_random_uuid(),
  compliance_task_id uuid not null references public.compliance_tasks(id) on delete cascade,
  -- Denormalized from compliance_tasks.organization_id, same reasoning
  -- as photos.organization_id (0014) / corrective_actions.organization_id
  -- (0017): every RLS check here reads this column directly instead of
  -- joining out to compliance_tasks first.
  organization_id uuid not null references public.organizations(id) on delete cascade,
  completed_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now()
);

create index compliance_task_completions_task_idx
  on public.compliance_task_completions(compliance_task_id);
create index compliance_task_completions_organization_idx
  on public.compliance_task_completions(organization_id);

alter table public.compliance_task_completions enable row level security;

create policy "compliance_task_completions_select_own_org" on public.compliance_task_completions
  for select using (organization_id = public.current_organization_id());

-- Recording a completion is itself a management action (same roles as
-- everything else here), and -- same pattern as compliance_documents --
-- verifies the completion's compliance_task_id actually belongs to the
-- organization_id being stamped on the row, not just any task that
-- happens to exist.
create policy "compliance_task_completions_insert_own_org" on public.compliance_task_completions
  for insert with check (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('org_admin', 'portfolio_manager', 'supervisor')
    )
    and exists (
      select 1 from public.compliance_tasks t
      where t.id = compliance_task_completions.compliance_task_id
        and t.organization_id = compliance_task_completions.organization_id
    )
  );

-- No update policy -- a completion is a log entry ("this review
-- happened, here's what was found"), immutable once recorded, the same
-- editorial stance audit_log takes. A mistaken entry is covered by
-- delete (below), not by editing history in place.
create policy "compliance_task_completions_delete_own_org" on public.compliance_task_completions
  for delete using (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('org_admin', 'portfolio_manager', 'supervisor')
    )
  );
