import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

/**
 * Data access for Phase 5D's deficiencies & corrective actions
 * (PRODUCT_SPEC.md section 10 / supabase/migrations/0017). Read paths are
 * plain `.from()` selects (RLS already scopes everything to the caller's
 * own org); every write beyond the initial auto-creation (which happens
 * server-side, in handle_item_deficiency(), the moment an item is marked
 * `deficiency` -- see the walkthrough/review screens) goes through one of
 * 0017's SECURITY DEFINER functions via `.rpc()`, since findings and
 * corrective_actions deliberately have no direct insert/update policy.
 */

export type Finding = {
  id: string;
  organizationId: string;
  propertyId: string | null;
  propertyName: string | null;
  inspectionId: string | null;
  inspectionSnapshotItemId: string | null;
  title: string;
  description: string | null;
  recommendation: string | null;
  locationName: string;
  componentName: string | null;
  priority: string | null;
  repeatOfFindingId: string | null;
  residentAccessRequired: boolean;
  currentStatus: string;
  escalated: boolean;
  escalatedAt: string | null;
  escalationNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CorrectiveAction = {
  id: string;
  findingId: string;
  status: string;
  statusReason: string | null;
  assignedTo: string | null;
  assignedToName: string | null;
  vendorId: string | null;
  vendorName: string | null;
  accessNotes: string | null;
  scheduledDate: string | null;
  targetCompletionDate: string | null;
  completedAt: string | null;
  completionNotes: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  estimatedCost: number | null;
  actualCost: number | null;
  createdAt: string;
  updatedAt: string;
};

export type Vendor = {
  id: string;
  name: string;
  trade: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  status: string;
};

export type AssignableProfile = {
  id: string;
  fullName: string | null;
  email: string;
  role: string;
};

type RawFindingRow = {
  id: string;
  organization_id: string;
  property_id: string | null;
  inspection_id: string | null;
  inspection_snapshot_item_id: string | null;
  title: string;
  description: string | null;
  recommendation: string | null;
  location_name: string;
  component_name: string | null;
  priority: string | null;
  repeat_of_finding_id: string | null;
  resident_access_required: boolean;
  current_status: string;
  escalated: boolean;
  escalated_at: string | null;
  escalation_note: string | null;
  created_at: string;
  updated_at: string;
  properties: { name: string } | { name: string }[] | null;
};

function mapFindingRow(row: RawFindingRow): Finding {
  const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
  return {
    id: row.id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    propertyName: property?.name ?? null,
    inspectionId: row.inspection_id,
    inspectionSnapshotItemId: row.inspection_snapshot_item_id,
    title: row.title,
    description: row.description,
    recommendation: row.recommendation,
    locationName: row.location_name,
    componentName: row.component_name,
    priority: row.priority,
    repeatOfFindingId: row.repeat_of_finding_id,
    residentAccessRequired: row.resident_access_required,
    currentStatus: row.current_status,
    escalated: row.escalated,
    escalatedAt: row.escalated_at,
    escalationNote: row.escalation_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const FINDING_SELECT =
  'id, organization_id, property_id, inspection_id, inspection_snapshot_item_id, title, ' +
  'description, recommendation, location_name, component_name, priority, repeat_of_finding_id, ' +
  'resident_access_required, current_status, escalated, escalated_at, escalation_note, ' +
  'created_at, updated_at, properties(name)';

/**
 * The corrective actions board's data source. `statuses` narrows to a
 * subset (e.g. the board's default "not yet closed out" view); omit it to
 * load everything. Ordered newest-first -- there's no schedule/priority
 * sort in the MVP board, just a filterable list, per PRODUCT_SPEC.md
 * section 6's "Filterable list/board by status."
 */
export async function fetchFindings(
  statuses?: string[],
): Promise<{ findings: Finding[]; error: string | null }> {
  let query = supabase.from('findings').select(FINDING_SELECT).order('created_at', {
    ascending: false,
  });
  if (statuses && statuses.length > 0) {
    query = query.in('current_status', statuses);
  }

  const { data, error } = await query;
  if (error) {
    logger.error('findings', 'Failed to load findings', error);
    return { findings: [], error: 'Could not load deficiencies.' };
  }
  return {
    findings: ((data as unknown as RawFindingRow[] | null) ?? []).map(mapFindingRow),
    error: null,
  };
}

export async function fetchFinding(
  findingId: string,
): Promise<{ finding: Finding | null; error: string | null }> {
  const { data, error } = await supabase
    .from('findings')
    .select(FINDING_SELECT)
    .eq('id', findingId)
    .maybeSingle();

  if (error || !data) {
    logger.error('findings', 'Failed to load finding', error);
    return { finding: null, error: 'Could not load this deficiency.' };
  }
  return { finding: mapFindingRow(data as unknown as RawFindingRow), error: null };
}

type RawCorrectiveActionRow = {
  id: string;
  finding_id: string;
  status: string;
  status_reason: string | null;
  assigned_to: string | null;
  vendor_id: string | null;
  access_notes: string | null;
  scheduled_date: string | null;
  target_completion_date: string | null;
  completed_at: string | null;
  completion_notes: string | null;
  verified_by: string | null;
  verified_at: string | null;
  estimated_cost: number | null;
  actual_cost: number | null;
  created_at: string;
  updated_at: string;
  assigned_profile:
    | { full_name: string | null; email: string }
    | { full_name: string | null; email: string }[]
    | null;
  vendors: { name: string } | { name: string }[] | null;
};

function mapCorrectiveActionRow(row: RawCorrectiveActionRow): CorrectiveAction {
  const assignedProfile = Array.isArray(row.assigned_profile)
    ? row.assigned_profile[0]
    : row.assigned_profile;
  const vendor = Array.isArray(row.vendors) ? row.vendors[0] : row.vendors;
  return {
    id: row.id,
    findingId: row.finding_id,
    status: row.status,
    statusReason: row.status_reason,
    assignedTo: row.assigned_to,
    assignedToName: assignedProfile?.full_name ?? assignedProfile?.email ?? null,
    vendorId: row.vendor_id,
    vendorName: vendor?.name ?? null,
    accessNotes: row.access_notes,
    scheduledDate: row.scheduled_date,
    targetCompletionDate: row.target_completion_date,
    completedAt: row.completed_at,
    completionNotes: row.completion_notes,
    verifiedBy: row.verified_by,
    verifiedAt: row.verified_at,
    estimatedCost: row.estimated_cost,
    actualCost: row.actual_cost,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Every corrective_actions row for one finding, oldest first -- the
 * "attempt history" a repeat/voided-then-reopened case relies on. */
export async function fetchCorrectiveActions(
  findingId: string,
): Promise<{ correctiveActions: CorrectiveAction[]; error: string | null }> {
  const { data, error } = await supabase
    .from('corrective_actions')
    .select(
      'id, finding_id, status, status_reason, assigned_to, vendor_id, access_notes, ' +
        'scheduled_date, target_completion_date, completed_at, completion_notes, verified_by, ' +
        'verified_at, estimated_cost, actual_cost, created_at, updated_at, ' +
        'assigned_profile:profiles!corrective_actions_assigned_to_fkey(full_name, email), vendors(name)',
    )
    .eq('finding_id', findingId)
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('findings', 'Failed to load corrective actions', error);
    return { correctiveActions: [], error: 'Could not load corrective actions.' };
  }
  return {
    correctiveActions: ((data as unknown as RawCorrectiveActionRow[] | null) ?? []).map(
      mapCorrectiveActionRow,
    ),
    error: null,
  };
}

export async function fetchVendors(): Promise<{ vendors: Vendor[]; error: string | null }> {
  const { data, error } = await supabase
    .from('vendors')
    .select('id, name, trade, contact_name, phone, email, status')
    .eq('status', 'active')
    .order('name');

  if (error) {
    logger.error('findings', 'Failed to load vendors', error);
    return { vendors: [], error: 'Could not load vendors.' };
  }
  return {
    vendors: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      trade: row.trade,
      contactName: row.contact_name,
      phone: row.phone,
      email: row.email,
      status: row.status,
    })),
    error: null,
  };
}

export async function createVendor(input: {
  name: string;
  trade: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
}): Promise<{ vendor: Vendor | null; error: string | null }> {
  const { data: userData } = await supabase.auth.getUser();
  const { data: orgData, error: orgError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', userData.user?.id ?? '')
    .single();

  if (orgError || !orgData) {
    logger.error('findings', 'Failed to resolve organization for new vendor', orgError);
    return { vendor: null, error: 'Could not determine your organization.' };
  }

  const { data, error } = await supabase
    .from('vendors')
    .insert({
      organization_id: orgData.organization_id,
      name: input.name,
      trade: input.trade,
      contact_name: input.contactName,
      phone: input.phone,
      email: input.email,
    })
    .select('id, name, trade, contact_name, phone, email, status')
    .single();

  if (error || !data) {
    logger.error('findings', 'Failed to create vendor', error);
    return { vendor: null, error: 'Could not add this vendor.' };
  }

  return {
    vendor: {
      id: data.id,
      name: data.name,
      trade: data.trade,
      contactName: data.contact_name,
      phone: data.phone,
      email: data.email,
      status: data.status,
    },
    error: null,
  };
}

/** Org teammates a corrective action can be assigned to -- every role,
 * not just the three that can manage corrective actions, since the
 * assignee is often the person actually doing the work. */
export async function fetchAssignableProfiles(): Promise<{
  profiles: AssignableProfile[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .order('full_name');

  if (error) {
    logger.error('findings', 'Failed to load assignable profiles', error);
    return { profiles: [], error: 'Could not load teammates.' };
  }
  return {
    profiles: (data ?? []).map((row) => ({
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      role: row.role,
    })),
    error: null,
  };
}

export async function setCorrectiveActionStatus(
  correctiveActionId: string,
  newStatus: string,
  reason?: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('set_corrective_action_status', {
    p_corrective_action_id: correctiveActionId,
    p_new_status: newStatus,
    p_reason: reason ?? null,
  });
  if (error) {
    logger.warn('findings', 'set_corrective_action_status failed', { message: error.message });
    return { error: error.message };
  }
  return { error: null };
}

export async function updateCorrectiveActionDetails(
  correctiveActionId: string,
  details: {
    assignedTo: string | null;
    vendorId: string | null;
    accessNotes: string | null;
    scheduledDate: string | null;
    targetCompletionDate: string | null;
    estimatedCost: number | null;
    actualCost: number | null;
    completionNotes: string | null;
  },
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('update_corrective_action_details', {
    p_corrective_action_id: correctiveActionId,
    p_assigned_to: details.assignedTo,
    p_vendor_id: details.vendorId,
    p_access_notes: details.accessNotes,
    p_scheduled_date: details.scheduledDate,
    p_target_completion_date: details.targetCompletionDate,
    p_estimated_cost: details.estimatedCost,
    p_actual_cost: details.actualCost,
    p_completion_notes: details.completionNotes,
  });
  if (error) {
    logger.warn('findings', 'update_corrective_action_details failed', {
      message: error.message,
    });
    return { error: error.message };
  }
  return { error: null };
}

export async function updateFindingDetails(
  findingId: string,
  details: {
    priority: string | null;
    repeatOfFindingId: string | null;
    residentAccessRequired: boolean;
  },
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('update_finding_details', {
    p_finding_id: findingId,
    p_priority: details.priority,
    p_repeat_of_finding_id: details.repeatOfFindingId,
    p_resident_access_required: details.residentAccessRequired,
  });
  if (error) {
    logger.warn('findings', 'update_finding_details failed', { message: error.message });
    return { error: error.message };
  }
  return { error: null };
}

export async function setFindingEscalation(
  findingId: string,
  escalated: boolean,
  note?: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('set_finding_escalation', {
    p_finding_id: findingId,
    p_escalated: escalated,
    p_note: note ?? null,
  });
  if (error) {
    logger.warn('findings', 'set_finding_escalation failed', { message: error.message });
    return { error: error.message };
  }
  return { error: null };
}
