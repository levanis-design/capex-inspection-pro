import { ComplianceTaskFrequency, ComplianceTaskType } from '@/lib/compliance-task-types';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

/**
 * Data layer for the Phase 15 Compliance Tasks feature
 * (supabase/migrations/0026): recurring review tasks (log reviews,
 * vendor report reviews, or anything else an admin wants tracked on a
 * schedule) plus their completion history.
 */

export type ComplianceTask = {
  id: string;
  propertyId: string;
  taskType: ComplianceTaskType;
  title: string;
  description: string | null;
  vendorId: string | null;
  vendorName: string | null;
  frequency: ComplianceTaskFrequency;
  status: 'active' | 'inactive';
  createdAt: string;
  updatedAt: string;
  // Populated by fetchComplianceTasks from the latest completion per
  // task -- not a column on compliance_tasks itself.
  lastCompletedAt: string | null;
};

export type ComplianceTaskCompletion = {
  id: string;
  complianceTaskId: string;
  completedBy: string | null;
  completedByName: string | null;
  completedAt: string;
  notes: string | null;
};

type ComplianceTaskRow = {
  id: string;
  property_id: string;
  task_type: string;
  title: string;
  description: string | null;
  vendor_id: string | null;
  vendors: { name: string } | { name: string }[] | null;
  frequency: string;
  status: string;
  created_at: string;
  updated_at: string;
};

function firstOrNull<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const TASK_SELECT_COLUMNS =
  'id, property_id, task_type, title, description, vendor_id, vendors(name), frequency, status, created_at, updated_at';

/**
 * Loads every active compliance task for a property, plus each one's most
 * recent completion timestamp (a single query per task's completions,
 * ordered and grouped client-side -- this table is never large enough
 * per property to warrant a fancier "latest per group" SQL query).
 */
export async function fetchComplianceTasks(propertyId: string): Promise<{
  tasks: ComplianceTask[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('compliance_tasks')
    .select(TASK_SELECT_COLUMNS)
    .eq('property_id', propertyId)
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('compliance-tasks', 'Failed to load compliance tasks', error);
    return { tasks: [], error: 'Could not load compliance tasks.' };
  }

  const rows = (data ?? []) as ComplianceTaskRow[];
  if (rows.length === 0) return { tasks: [], error: null };

  const taskIds = rows.map((r) => r.id);
  const { data: completionData, error: completionError } = await supabase
    .from('compliance_task_completions')
    .select('compliance_task_id, completed_at')
    .in('compliance_task_id', taskIds)
    .order('completed_at', { ascending: false });

  if (completionError) {
    logger.error('compliance-tasks', 'Failed to load task completions', completionError);
    // Not fatal -- the list still renders, just as "never reviewed"
    // until this reloads successfully.
  }

  const latestCompletionByTask: Record<string, string> = {};
  for (const row of (completionData ?? []) as {
    compliance_task_id: string;
    completed_at: string;
  }[]) {
    if (!latestCompletionByTask[row.compliance_task_id]) {
      latestCompletionByTask[row.compliance_task_id] = row.completed_at;
    }
  }

  const tasks: ComplianceTask[] = rows.map((row) => {
    const vendor = firstOrNull(row.vendors);
    return {
      id: row.id,
      propertyId: row.property_id,
      taskType: row.task_type as ComplianceTaskType,
      title: row.title,
      description: row.description,
      vendorId: row.vendor_id,
      vendorName: vendor?.name ?? null,
      frequency: row.frequency as ComplianceTaskFrequency,
      status: row.status as 'active' | 'inactive',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastCompletedAt: latestCompletionByTask[row.id] ?? null,
    };
  });

  return { tasks, error: null };
}

export type ComplianceTaskInput = {
  taskType: ComplianceTaskType;
  title: string;
  description: string;
  vendorId: string | null;
  frequency: ComplianceTaskFrequency;
};

export async function createComplianceTask(
  organizationId: string,
  propertyId: string,
  input: ComplianceTaskInput,
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('compliance_tasks')
    .insert({
      organization_id: organizationId,
      property_id: propertyId,
      task_type: input.taskType,
      title: input.title.trim(),
      description: input.description.trim() || null,
      vendor_id: input.taskType === 'vendor_report_review' ? input.vendorId : null,
      frequency: input.frequency,
    })
    .select('id')
    .single();

  if (error) {
    logger.error('compliance-tasks', 'Failed to create compliance task', error);
    return { id: null, error: error.message };
  }
  return { id: (data as { id: string }).id, error: null };
}

export async function updateComplianceTask(
  id: string,
  input: ComplianceTaskInput,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('compliance_tasks')
    .update({
      task_type: input.taskType,
      title: input.title.trim(),
      description: input.description.trim() || null,
      vendor_id: input.taskType === 'vendor_report_review' ? input.vendorId : null,
      frequency: input.frequency,
    })
    .eq('id', id);

  if (error) {
    logger.error('compliance-tasks', 'Failed to update compliance task', error);
    return { error: error.message };
  }
  return { error: null };
}

export async function deleteComplianceTask(id: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('compliance_tasks').delete().eq('id', id);
  if (error) {
    logger.error('compliance-tasks', 'Failed to delete compliance task', error);
    return { error: error.message };
  }
  return { error: null };
}

export async function recordComplianceTaskCompletion(
  organizationId: string,
  taskId: string,
  notes: string,
): Promise<{ error: string | null }> {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from('compliance_task_completions').insert({
    compliance_task_id: taskId,
    organization_id: organizationId,
    completed_by: userData.user?.id ?? null,
    notes: notes.trim() || null,
  });

  if (error) {
    logger.error('compliance-tasks', 'Failed to record task completion', error);
    return { error: error.message };
  }
  return { error: null };
}

export async function fetchComplianceTaskCompletions(taskId: string): Promise<{
  completions: ComplianceTaskCompletion[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from('compliance_task_completions')
    .select('id, compliance_task_id, completed_by, completed_at, notes, profiles(full_name)')
    .eq('compliance_task_id', taskId)
    .order('completed_at', { ascending: false });

  if (error) {
    logger.error('compliance-tasks', 'Failed to load task completion history', error);
    return { completions: [], error: 'Could not load this task’s review history.' };
  }

  const rows = (data ?? []) as {
    id: string;
    compliance_task_id: string;
    completed_by: string | null;
    completed_at: string;
    notes: string | null;
    profiles: { full_name: string | null } | { full_name: string | null }[] | null;
  }[];

  const completions: ComplianceTaskCompletion[] = rows.map((row) => {
    const profile = firstOrNull(row.profiles);
    return {
      id: row.id,
      complianceTaskId: row.compliance_task_id,
      completedBy: row.completed_by,
      completedByName: profile?.full_name ?? null,
      completedAt: row.completed_at,
      notes: row.notes,
    };
  });

  return { completions, error: null };
}
