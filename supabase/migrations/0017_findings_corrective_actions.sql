-- Phase 5D: deficiencies & corrective actions (PRODUCT_SPEC.md section 10).
--
-- inspection_snapshot_items already carries every deficiency FIELD
-- captured at inspection time (priority, department, vendor_id,
-- work_order_number, costs, etc. -- see 0011) -- that part of the spec
-- was already done. What's missing is the part that outlives a single
-- inspection: a corrective action's own lifecycle (open -> assigned ->
-- ... -> verified/closed/voided), which has to persist and be tracked
-- long after the inspection that raised it is long finished, survive
-- that inspection later being hard-deleted (0015's delete_inspection()),
-- and support "repeat condition" linkage across separate inspections
-- (PRODUCT_SPEC.md section 8's Follow-up inspection type, not yet wired
-- up server-side -- see inspection-types.ts).
--
-- Two new tables, matching the ERD already sketched in
-- DATABASE_SCHEMA.md's entity-relationship diagram
-- (INSPECTION_SNAPSHOT_ITEMS ||--o{ FINDINGS, FINDINGS ||--o{
-- CORRECTIVE_ACTIONS):
--
--   `findings` -- the stable identity of a deficiency: what/where/
--   priority/escalation state/repeat-linkage. Deliberately denormalizes
--   title/description/location_name/component_name at creation time
--   (copied from the item, not read live from it) and uses `on delete
--   set null` (not cascade) on inspection_id/inspection_snapshot_item_id/
--   property_id, so a finding -- and the compliance history it
--   represents -- survives even if the inspection that raised it is
--   later hard-deleted. `current_status` is a denormalized mirror of its
--   most recent corrective_actions row's status (kept in sync by
--   sync_finding_status_from_corrective_action() below), so a list/board
--   screen never needs to join out to corrective_actions just to filter
--   or sort by status.
--
--   `corrective_actions` -- the actual remediation work: one row per
--   attempt (usually just one; a new row lets a failed/voided attempt be
--   superseded by a fresh one without losing the history of the first).
--   Carries the full 12-state lifecycle from the spec, plus assignment,
--   vendor, scheduling, cost, and completion/verification fields.
--
-- Write-path shape mirrors property_check_assignments/
-- inspection_snapshot_items elsewhere in this schema: both tables get a
-- `select` policy only. A `finding` (and its first `corrective_action`)
-- is created automatically -- see handle_item_deficiency() below -- the
-- moment an inspector marks an item `deficiency`, regardless of the
-- inspector's own (deliberately limited) permissions, because the
-- trigger function is SECURITY DEFINER. Every other write
-- (status transitions, assignment/vendor/scheduling/cost edits,
-- escalation) goes through one of the SECURITY DEFINER functions below,
-- restricted to org_admin/portfolio_manager/supervisor per
-- PRODUCT_SPEC.md section 4's "Assign corrective actions" row --
-- inspectors can raise a deficiency by doing their job, but never manage
-- its remediation. This sidesteps the awkward "block only one column via
-- RLS's WITH CHECK" problem entirely (there's no direct update policy at
-- all to carve a hole in), and gives every status transition a
-- log_audit_event() entry for free, matching set_inspection_status()'s
-- shape in 0015.
--
-- Deliberately out of scope for this migration (called out here so it
-- isn't mistaken for an oversight):
--   - Automatic time-based escalation (P1 within 2 hours / P2 within 24
--     per PRODUCT_SPEC.md section 8's priority table) -- there's no
--     scheduled-job infrastructure in this project yet. `escalated`/
--     `escalated_at` support a manual "Escalate" action from the board;
--     an "overdue for escalation" indicator based on priority + age is a
--     UI-only computation (see corrective-action-types.ts).
--   - Completion-evidence photos reusing the `photos` table -- corrective
--     action completion is recorded as text (`completion_notes`) for now.
--     The photos already attached to the original deficiency item remain
--     visible on the deficiency detail screen. Extending `photos` with a
--     nullable `corrective_action_id` (and a two-parent CHECK) is
--     straightforward follow-up if a real "after" photo turns out to be
--     needed for close-out, but isn't required to make this phase
--     feature-complete against section 10.
--   - Follow-up inspections resolving their scope from open
--     findings/corrective_actions (section 8) -- `follow_up` is already a
--     deferred inspection_type (see 0012/inspection-types.ts); wiring its
--     scope generator to query this table is future work once that type
--     is picked back up.

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  trade text,
  contact_name text,
  phone text,
  email text,
  notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index vendors_organization_idx on public.vendors(organization_id);

alter table public.vendors enable row level security;

create policy "vendors_select_own_org" on public.vendors
  for select using (organization_id = public.current_organization_id());

-- Unlike findings/corrective_actions below, vendors is a plain CRUD
-- entity with no protected/derived column, so a direct RLS policy (same
-- shape as photos_insert_own_org/photos_delete_own_org in 0014) is fine
-- here -- no SECURITY DEFINER function needed just to manage a contact
-- list.
create policy "vendors_insert_own_org" on public.vendors
  for insert with check (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('org_admin', 'portfolio_manager', 'supervisor')
    )
  );

create policy "vendors_update_own_org" on public.vendors
  for update using (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('org_admin', 'portfolio_manager', 'supervisor')
    )
  )
  with check (organization_id = public.current_organization_id());

-- Now that vendors exists, the vendor_id an inspector can already flag on
-- an item at inspection time (0011) gets real referential integrity.
alter table public.inspection_snapshot_items
  add constraint inspection_snapshot_items_vendor_id_fkey
  foreign key (vendor_id) references public.vendors(id) on delete set null;

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  inspection_id uuid references public.inspections(id) on delete set null,
  inspection_snapshot_item_id uuid references public.inspection_snapshot_items(id) on delete set null,
  title text not null,
  description text,
  recommendation text,
  location_name text not null,
  component_name text,
  priority text check (priority in ('P1', 'P2', 'P3', 'P4')),
  repeat_of_finding_id uuid references public.findings(id) on delete set null,
  resident_access_required boolean not null default false,
  current_status text not null default 'open'
    check (current_status in (
      'open', 'assigned', 'access_required', 'vendor_required', 'scheduled', 'in_progress',
      'pending_parts', 'pending_approval', 'completed', 'verified', 'closed', 'voided'
    )),
  escalated boolean not null default false,
  escalated_at timestamptz,
  escalated_by uuid references public.profiles(id) on delete set null,
  escalation_note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index findings_organization_idx on public.findings(organization_id);
create index findings_property_idx on public.findings(property_id);
-- One finding per source item -- handle_item_deficiency() relies on this
-- (via ON CONFLICT DO NOTHING) to stay idempotent if an item toggles into
-- 'deficiency' more than once (e.g. an inspector corrects a mis-tap).
-- Partial (not a plain UNIQUE column) because ad hoc findings created
-- directly against a property (no source item) are conceivable future
-- work and shouldn't collide on a shared NULL.
create unique index findings_item_idx
  on public.findings(inspection_snapshot_item_id) where inspection_snapshot_item_id is not null;

alter table public.findings enable row level security;

create policy "findings_select_own_org" on public.findings
  for select using (organization_id = public.current_organization_id());
-- Deliberately no insert/update policy -- rows are only ever created by
-- handle_item_deficiency() below and edited afterward only through
-- update_finding_details()/set_finding_escalation() -- see this
-- migration's header comment for why.

create trigger set_updated_at_findings
  before update on public.findings
  for each row execute function public.set_updated_at();

create table public.corrective_actions (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings(id) on delete cascade,
  -- Denormalized from findings.organization_id, same rationale as
  -- photos.organization_id in 0014: every RLS check here reads this
  -- column directly instead of joining out to findings first.
  organization_id uuid not null references public.organizations(id) on delete cascade,
  status text not null default 'open'
    check (status in (
      'open', 'assigned', 'access_required', 'vendor_required', 'scheduled', 'in_progress',
      'pending_parts', 'pending_approval', 'completed', 'verified', 'closed', 'voided'
    )),
  status_reason text,
  assigned_to uuid references public.profiles(id) on delete set null,
  vendor_id uuid references public.vendors(id) on delete set null,
  access_notes text,
  scheduled_date date,
  target_completion_date date,
  completed_at timestamptz,
  completion_notes text,
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  estimated_cost numeric,
  actual_cost numeric,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint corrective_action_status_reason_required
    check (status <> 'voided' or status_reason is not null)
);

create index corrective_actions_finding_idx on public.corrective_actions(finding_id);
create index corrective_actions_organization_idx on public.corrective_actions(organization_id);

alter table public.corrective_actions enable row level security;

create policy "corrective_actions_select_own_org" on public.corrective_actions
  for select using (organization_id = public.current_organization_id());
-- Deliberately no insert/update policy -- rows are only ever created by
-- handle_item_deficiency() and written afterward only through
-- set_corrective_action_status()/update_corrective_action_details().

create trigger set_updated_at_corrective_actions
  before update on public.corrective_actions
  for each row execute function public.set_updated_at();

-- Keeps findings.current_status as a live mirror of its corrective
-- action's status, so every list/filter screen can query `findings`
-- alone. SECURITY DEFINER because the caller updating corrective_actions
-- (via set_corrective_action_status(), itself already SECURITY DEFINER,
-- or the handle_item_deficiency() trigger) has no update grant on
-- findings otherwise -- see this migration's header comment.
create or replace function public.sync_finding_status_from_corrective_action()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update public.findings
  set current_status = new.status
  where id = new.finding_id;
  return new;
end;
$$;

create trigger corrective_actions_sync_finding_status
  after insert or update of status on public.corrective_actions
  for each row execute function public.sync_finding_status_from_corrective_action();

-- Auto-opens a finding (and its first corrective_action) the moment an
-- item is marked 'deficiency' -- during start_inspection() this can only
-- be an INSERT with status already 'deficiency' if a future ad hoc-item
-- path ever sets one at creation time (today items are always inserted
-- 'not_inspected' -- see 0012 -- so in practice this fires on UPDATE),
-- but both are handled the same way. Runs regardless of the caller's own
-- permissions (an inspector marking a deficiency has no insert grant on
-- findings/corrective_actions) because this is SECURITY DEFINER.
--
-- Deliberately does NOT react to an item moving back OUT of 'deficiency'
-- (e.g. an inspector correcting a mis-tap) -- the finding it already
-- opened is left exactly as-is; closing it out (voiding, most likely) is
-- a manual action on the corrective actions board, same as any other
-- status change, so that correction is itself audited rather than
-- silently disappearing.
create or replace function public.handle_item_deficiency()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_property_id uuid;
  v_inspection_id uuid;
  v_location_name text;
  v_component_name text;
  v_finding_id uuid;
begin
  if new.status = 'deficiency' and (tg_op = 'INSERT' or old.status is distinct from 'deficiency') then
    select ins.organization_id, ins.property_id, ins.id, pl.name, ct.name
      into v_organization_id, v_property_id, v_inspection_id, v_location_name, v_component_name
    from public.inspection_snapshot_locations l
    join public.inspection_snapshots s on s.id = l.inspection_snapshot_id
    join public.inspections ins on ins.id = s.inspection_id
    join public.property_locations pl on pl.id = l.property_location_id
    left join public.location_components lc on lc.id = new.location_component_id
    left join public.component_types ct on ct.id = lc.component_type_id
    where l.id = new.inspection_snapshot_location_id;

    insert into public.findings (
      organization_id, property_id, inspection_id, inspection_snapshot_item_id,
      title, description, recommendation, location_name, component_name, priority, created_by
    ) values (
      v_organization_id, v_property_id, v_inspection_id, new.id,
      new.title, new.observation, new.recommendation, coalesce(v_location_name, 'Unknown area'),
      v_component_name, new.priority, auth.uid()
    )
    on conflict (inspection_snapshot_item_id) where inspection_snapshot_item_id is not null
    do nothing
    returning id into v_finding_id;

    if v_finding_id is not null then
      insert into public.corrective_actions (finding_id, organization_id, created_by)
      values (v_finding_id, v_organization_id, auth.uid());
    end if;
  end if;

  return new;
end;
$$;

create trigger inspection_snapshot_items_deficiency_trigger
  after insert or update of status on public.inspection_snapshot_items
  for each row execute function public.handle_item_deficiency();

-- The only supported way to change a corrective action's status. Every
-- transition (not just voided, unlike set_inspection_status()'s
-- voided-only scope) goes through here so section 13's "full change
-- history" expectation for this specific compliance-sensitive workflow
-- is actually met -- every status move gets a log_audit_event() row.
create or replace function public.set_corrective_action_status(
  p_corrective_action_id uuid,
  p_new_status text,
  p_reason text default null
)
returns public.corrective_actions
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller_role text;
  v_action public.corrective_actions;
  v_before jsonb;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null then
    raise exception 'not_authenticated';
  end if;

  if p_new_status not in (
    'open', 'assigned', 'access_required', 'vendor_required', 'scheduled', 'in_progress',
    'pending_parts', 'pending_approval', 'completed', 'verified', 'closed', 'voided'
  ) then
    raise exception 'invalid_status';
  end if;

  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role not in ('org_admin', 'portfolio_manager', 'supervisor') then
    raise exception 'insufficient_permission';
  end if;

  if p_new_status = 'voided' and (p_reason is null or trim(p_reason) = '') then
    raise exception 'status_reason_required';
  end if;

  select * into v_action
  from public.corrective_actions
  where id = p_corrective_action_id and organization_id = v_org_id;

  if v_action.id is null then
    raise exception 'corrective_action_not_found';
  end if;

  -- Supervisor sign-off can't be skipped past an unfinished repair --
  -- mirrors 0013's critical-check-requires-admin shape (a targeted
  -- integrity rule enforced in the function, not a generic state
  -- machine).
  if p_new_status = 'verified' and v_action.status <> 'completed' then
    raise exception 'must_be_completed_first';
  end if;

  v_before := to_jsonb(v_action);

  update public.corrective_actions
  set status = p_new_status,
      status_reason = case when p_new_status = 'voided' then p_reason else status_reason end,
      completed_at = case when p_new_status = 'completed' then now() else completed_at end,
      verified_by = case when p_new_status = 'verified' then auth.uid() else verified_by end,
      verified_at = case when p_new_status = 'verified' then now() else verified_at end
  where id = p_corrective_action_id
  returning * into v_action;

  perform public.log_audit_event(
    'corrective_action_status_' || p_new_status, 'corrective_action', p_corrective_action_id,
    v_before, to_jsonb(v_action)
  );

  return v_action;
end;
$$;

revoke all on function public.set_corrective_action_status(uuid, text, text) from public;
grant execute on function public.set_corrective_action_status(uuid, text, text) to authenticated;

-- Assignment/vendor/scheduling/cost/completion-notes edits -- everything
-- on corrective_actions except status. Form-style replace, not a partial
-- patch: the caller (the deficiency detail screen) always reads the
-- current row first and passes every field back, so an omitted parameter
-- unambiguously means "clear this field" rather than "leave it alone."
-- There's exactly one caller today, so this is deliberately simpler than
-- a column-by-column COALESCE-against-null-sentinel scheme would be.
create or replace function public.update_corrective_action_details(
  p_corrective_action_id uuid,
  p_assigned_to uuid default null,
  p_vendor_id uuid default null,
  p_access_notes text default null,
  p_scheduled_date date default null,
  p_target_completion_date date default null,
  p_estimated_cost numeric default null,
  p_actual_cost numeric default null,
  p_completion_notes text default null
)
returns public.corrective_actions
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller_role text;
  v_action public.corrective_actions;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null then
    raise exception 'not_authenticated';
  end if;

  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role not in ('org_admin', 'portfolio_manager', 'supervisor') then
    raise exception 'insufficient_permission';
  end if;

  update public.corrective_actions
  set assigned_to = p_assigned_to,
      vendor_id = p_vendor_id,
      access_notes = p_access_notes,
      scheduled_date = p_scheduled_date,
      target_completion_date = p_target_completion_date,
      estimated_cost = p_estimated_cost,
      actual_cost = p_actual_cost,
      completion_notes = p_completion_notes
  where id = p_corrective_action_id and organization_id = v_org_id
  returning * into v_action;

  if v_action.id is null then
    raise exception 'corrective_action_not_found';
  end if;

  return v_action;
end;
$$;

revoke all on function public.update_corrective_action_details(
  uuid, uuid, uuid, text, date, date, numeric, numeric, text
) from public;
grant execute on function public.update_corrective_action_details(
  uuid, uuid, uuid, text, date, date, numeric, numeric, text
) to authenticated;

-- Priority/repeat-linkage/resident-access edits on the finding itself.
-- Same form-style-replace convention as update_corrective_action_details().
create or replace function public.update_finding_details(
  p_finding_id uuid,
  p_priority text default null,
  p_repeat_of_finding_id uuid default null,
  p_resident_access_required boolean default false
)
returns public.findings
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller_role text;
  v_finding public.findings;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null then
    raise exception 'not_authenticated';
  end if;

  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role not in ('org_admin', 'portfolio_manager', 'supervisor') then
    raise exception 'insufficient_permission';
  end if;

  if p_priority is not null and p_priority not in ('P1', 'P2', 'P3', 'P4') then
    raise exception 'invalid_priority';
  end if;

  update public.findings
  set priority = p_priority,
      repeat_of_finding_id = p_repeat_of_finding_id,
      resident_access_required = p_resident_access_required
  where id = p_finding_id and organization_id = v_org_id
  returning * into v_finding;

  if v_finding.id is null then
    raise exception 'finding_not_found';
  end if;

  return v_finding;
end;
$$;

revoke all on function public.update_finding_details(uuid, text, uuid, boolean) from public;
grant execute on function public.update_finding_details(uuid, text, uuid, boolean) to authenticated;

-- Manual escalation toggle (see this migration's header comment for why
-- this is manual, not time-based). Audited both ways -- clearing a wrong
-- escalation is itself worth a trail entry, same reasoning as
-- set_inspection_status()'s voiding.
create or replace function public.set_finding_escalation(
  p_finding_id uuid,
  p_escalated boolean,
  p_note text default null
)
returns public.findings
language plpgsql security definer
set search_path = public
as $$
declare
  v_org_id uuid;
  v_caller_role text;
  v_finding public.findings;
  v_before jsonb;
begin
  v_org_id := public.current_organization_id();
  if v_org_id is null then
    raise exception 'not_authenticated';
  end if;

  select role into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role not in ('org_admin', 'portfolio_manager', 'supervisor') then
    raise exception 'insufficient_permission';
  end if;

  select * into v_finding from public.findings where id = p_finding_id and organization_id = v_org_id;
  if v_finding.id is null then
    raise exception 'finding_not_found';
  end if;
  v_before := to_jsonb(v_finding);

  update public.findings
  set escalated = p_escalated,
      escalated_at = case when p_escalated then now() else null end,
      escalated_by = case when p_escalated then auth.uid() else null end,
      escalation_note = case when p_escalated then p_note else null end
  where id = p_finding_id
  returning * into v_finding;

  perform public.log_audit_event(
    case when p_escalated then 'escalate_finding' else 'clear_finding_escalation' end,
    'finding', p_finding_id, v_before, to_jsonb(v_finding)
  );

  return v_finding;
end;
$$;

revoke all on function public.set_finding_escalation(uuid, boolean, text) from public;
grant execute on function public.set_finding_escalation(uuid, boolean, text) to authenticated;
