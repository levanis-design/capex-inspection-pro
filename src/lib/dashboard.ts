import {
  CORRECTIVE_ACTION_STATUSES,
  CORRECTIVE_ACTION_TERMINAL_STATUSES,
} from '@/lib/corrective-action-types';
import { computeDisplayStatus } from '@/lib/compliance-document-types';
import { ComplianceTaskFrequency, computeTaskDueStatus } from '@/lib/compliance-task-types';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

/**
 * Phase 8: dashboard & analytics (PRODUCT_SPEC.md section 12). Like
 * reports.ts before it, this fills in a section the spec never actually
 * detailed beyond "portfolio-level counts, filters, aging" -- see
 * PRODUCT_SPEC.md's Phase 8 note for the full design writeup.
 *
 * No new migration -- every metric here is a read-only count over tables
 * that already exist and are already RLS-scoped to the caller's own
 * organization (see migrations 0001-0021). `useCurrentOrganization()`
 * already exposes `propertySlotLimit`, so this module only fetches the
 * "used" side of that ratio, not the limit itself -- the dashboard
 * screen combines both.
 *
 * Every count uses `.select('id', { count: 'exact', head: true })` (same
 * pattern as properties/[id]/index.tsx) rather than fetching full rows --
 * cheap even as the portfolio grows, since Postgres never has to
 * materialize or ship the matching rows themselves.
 *
 * Phase 16 addition: portfolio-wide compliance document/task attention
 * counts, added to this same dashboard rather than a new tab (there's no
 * portfolio-wide compliance list screen -- see properties/[id]/compliance*
 * -- so these two counts are the only cross-property view of compliance
 * risk in the app). Like the per-property attention badges these mirror
 * (properties/[id]/index.tsx), the underlying status is derived at read
 * time (computeDisplayStatus / computeTaskDueStatus) rather than trusted
 * from a stored column, so these two metrics fetch rows and filter
 * client-side instead of using a `count: 'exact', head: true` query.
 */

// Non-terminal statuses shared by findings.current_status and
// corrective_actions.status (they're the same 12-value enum -- see
// supabase/migrations/0017) -- this is what "open" means for both of the
// metrics below that use it.
const OPEN_STATUSES = CORRECTIVE_ACTION_STATUSES.filter(
  (status) => !CORRECTIVE_ACTION_TERMINAL_STATUSES.has(status),
);

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export type PropertyOption = {
  id: string;
  name: string;
};

export type DashboardMetrics = {
  propertiesUsed: number;
  inspections: {
    scheduled: number;
    inProgress: number;
    completed: number;
    postponed: number;
    voided: number;
    overdue: number;
  };
  findings: {
    p1: number;
    p2: number;
    p3: number;
    p4: number;
    unprioritized: number;
    escalated: number;
    totalOpen: number;
  };
  correctiveActions: {
    totalOpen: number;
    overdue: number;
  };
  compliance: {
    documentsAttention: number;
    tasksAttention: number;
  };
};

/**
 * Properties available for the dashboard's filter dropdown. Deliberately
 * active-only -- an archived property can still own historical findings/
 * corrective actions, but it's not a portfolio-health item a manager
 * needs to filter down to day to day, and it keeps the picker short. The
 * "All properties" (no filter) view already covers everything, archived
 * included.
 */
export async function fetchDashboardProperties(): Promise<{
  properties: PropertyOption[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('properties')
    .select('id, name')
    .eq('status', 'active')
    .order('name');

  if (error) {
    logger.error('dashboard', 'Failed to load properties for filter', error);
    return { properties: [], error: 'Could not load your properties.' };
  }
  return { properties: (data as PropertyOption[] | null) ?? [], error: null };
}

/**
 * Portfolio-wide (or single-property) compliance attention counts -- see
 * this file's header comment for why these two can't be plain
 * `count: 'exact', head: true` queries like everything else here. Mirrors
 * properties/[id]/index.tsx's own attention-count logic exactly, just
 * without the `.eq('property_id', id)` filter when `propertyId` is null.
 */
async function fetchComplianceAttentionCounts(propertyId?: string | null): Promise<{
  documentsAttention: number;
  tasksAttention: number;
  error: string | null;
}> {
  const documentsQuery = (() => {
    let query = supabase.from('compliance_documents').select('status, expiration_date');
    if (propertyId) query = query.eq('property_id', propertyId);
    return query;
  })();

  const tasksQuery = (() => {
    let query = supabase.from('compliance_tasks').select('id, frequency').eq('status', 'active');
    if (propertyId) query = query.eq('property_id', propertyId);
    return query;
  })();

  const [documentsResult, tasksResult] = await Promise.all([documentsQuery, tasksQuery]);

  if (documentsResult.error || tasksResult.error) {
    logger.error(
      'dashboard',
      'Failed to load compliance attention counts',
      documentsResult.error ?? tasksResult.error,
    );
    return { documentsAttention: 0, tasksAttention: 0, error: 'Could not load your dashboard.' };
  }

  const documentRows =
    (documentsResult.data as { status: string; expiration_date: string | null }[] | null) ?? [];
  const documentsAttention = documentRows.filter((row) => {
    const displayStatus = computeDisplayStatus(row.status, row.expiration_date);
    return displayStatus === 'expired' || displayStatus === 'expiring_soon';
  }).length;

  const taskRows = (tasksResult.data as { id: string; frequency: string }[] | null) ?? [];
  if (taskRows.length === 0) {
    return { documentsAttention, tasksAttention: 0, error: null };
  }

  const { data: completionRows, error: completionsError } = await supabase
    .from('compliance_task_completions')
    .select('compliance_task_id, completed_at')
    .in(
      'compliance_task_id',
      taskRows.map((t) => t.id),
    )
    .order('completed_at', { ascending: false });

  if (completionsError) {
    logger.error('dashboard', 'Failed to load task completions', completionsError);
    // Not fatal -- falls back to treating every task as unreviewed, same
    // fail-open-to-"needs attention" choice as leaving the count visible
    // rather than hiding the whole dashboard over one secondary query.
  }

  const latestByTask: Record<string, string> = {};
  for (const row of (completionRows as { compliance_task_id: string; completed_at: string }[]) ??
    []) {
    if (!latestByTask[row.compliance_task_id])
      latestByTask[row.compliance_task_id] = row.completed_at;
  }

  const tasksAttention = taskRows.filter((task) => {
    const dueStatus = computeTaskDueStatus(
      task.frequency as ComplianceTaskFrequency,
      latestByTask[task.id] ?? null,
    );
    return dueStatus === 'overdue' || dueStatus === 'due_soon' || dueStatus === 'never_reviewed';
  }).length;

  return { documentsAttention, tasksAttention, error: null };
}

/**
 * All portfolio metrics for the dashboard, optionally narrowed to one
 * property. `propertyId` of `null`/`undefined` means "all properties."
 *
 * `corrective_actions` has no `property_id` column of its own (see
 * migration 0017 -- only `organization_id` is denormalized onto it,
 * since every existing RLS check only ever needed the org, not the
 * property). When a property filter is active, its two metrics use
 * PostgREST's embedded-resource filter (`findings!inner(...)` +
 * `.eq('findings.property_id', ...)`) to join out to `findings` for that
 * one column rather than adding a redundant denormalized column just for
 * this screen.
 */
export async function fetchDashboardMetrics(
  propertyId?: string | null,
): Promise<{ metrics: DashboardMetrics | null; error: string | null }> {
  const today = todayDateString();

  const inspectionsBase = () => {
    let query = supabase.from('inspections').select('id', { count: 'exact', head: true });
    if (propertyId) query = query.eq('property_id', propertyId);
    return query;
  };

  const findingsBase = () => {
    let query = supabase.from('findings').select('id', { count: 'exact', head: true });
    if (propertyId) query = query.eq('property_id', propertyId);
    return query;
  };

  const correctiveActionsBase = () => {
    if (propertyId) {
      return supabase
        .from('corrective_actions')
        .select('id, findings!inner(property_id)', { count: 'exact', head: true })
        .eq('findings.property_id', propertyId);
    }
    return supabase.from('corrective_actions').select('id', { count: 'exact', head: true });
  };

  const [
    propertiesResult,
    scheduledResult,
    inProgressResult,
    completedResult,
    postponedResult,
    voidedResult,
    overdueInspectionsResult,
    findingsOpenResult,
    findingsP1Result,
    findingsP2Result,
    findingsP3Result,
    findingsP4Result,
    findingsUnprioritizedResult,
    findingsEscalatedResult,
    correctiveActionsOpenResult,
    correctiveActionsOverdueResult,
    complianceAttentionResult,
  ] = await Promise.all([
    supabase.from('properties').select('id', { count: 'exact', head: true }),
    inspectionsBase().eq('status', 'scheduled'),
    inspectionsBase().eq('status', 'in_progress'),
    inspectionsBase().eq('status', 'completed'),
    inspectionsBase().eq('status', 'postponed'),
    inspectionsBase().eq('status', 'voided'),
    inspectionsBase().in('status', ['scheduled', 'in_progress']).lt('scheduled_date', today),
    findingsBase().in('current_status', OPEN_STATUSES),
    findingsBase().in('current_status', OPEN_STATUSES).eq('priority', 'P1'),
    findingsBase().in('current_status', OPEN_STATUSES).eq('priority', 'P2'),
    findingsBase().in('current_status', OPEN_STATUSES).eq('priority', 'P3'),
    findingsBase().in('current_status', OPEN_STATUSES).eq('priority', 'P4'),
    findingsBase().in('current_status', OPEN_STATUSES).is('priority', null),
    findingsBase().in('current_status', OPEN_STATUSES).eq('escalated', true),
    correctiveActionsBase().in('status', OPEN_STATUSES),
    correctiveActionsBase().in('status', OPEN_STATUSES).lt('target_completion_date', today),
    fetchComplianceAttentionCounts(propertyId),
  ]);

  if (complianceAttentionResult.error) {
    logger.error('dashboard', 'Failed to load dashboard metrics', complianceAttentionResult.error);
    return { metrics: null, error: 'Could not load your dashboard.' };
  }

  const results = [
    propertiesResult,
    scheduledResult,
    inProgressResult,
    completedResult,
    postponedResult,
    voidedResult,
    overdueInspectionsResult,
    findingsOpenResult,
    findingsP1Result,
    findingsP2Result,
    findingsP3Result,
    findingsP4Result,
    findingsUnprioritizedResult,
    findingsEscalatedResult,
    correctiveActionsOpenResult,
    correctiveActionsOverdueResult,
  ];
  const firstError = results.find((r) => r.error)?.error;
  if (firstError) {
    logger.error('dashboard', 'Failed to load dashboard metrics', firstError);
    return { metrics: null, error: 'Could not load your dashboard.' };
  }

  return {
    metrics: {
      propertiesUsed: propertiesResult.count ?? 0,
      inspections: {
        scheduled: scheduledResult.count ?? 0,
        inProgress: inProgressResult.count ?? 0,
        completed: completedResult.count ?? 0,
        postponed: postponedResult.count ?? 0,
        voided: voidedResult.count ?? 0,
        overdue: overdueInspectionsResult.count ?? 0,
      },
      findings: {
        p1: findingsP1Result.count ?? 0,
        p2: findingsP2Result.count ?? 0,
        p3: findingsP3Result.count ?? 0,
        p4: findingsP4Result.count ?? 0,
        unprioritized: findingsUnprioritizedResult.count ?? 0,
        escalated: findingsEscalatedResult.count ?? 0,
        totalOpen: findingsOpenResult.count ?? 0,
      },
      correctiveActions: {
        totalOpen: correctiveActionsOpenResult.count ?? 0,
        overdue: correctiveActionsOverdueResult.count ?? 0,
      },
      compliance: {
        documentsAttention: complianceAttentionResult.documentsAttention,
        tasksAttention: complianceAttentionResult.tasksAttention,
      },
    },
    error: null,
  };
}
