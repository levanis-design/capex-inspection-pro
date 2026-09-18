import { colors } from '@/theme';

/**
 * Shared metadata for the Phase 15 Compliance Tasks feature, in the same
 * spirit as compliance-document-types.ts (Phase 14) and
 * corrective-action-types.ts -- one place so the list screen, the
 * add/edit modal, and any future summary card can't drift out of sync on
 * labels or colors.
 *
 * The task_type and frequency value lists here must match
 * supabase/migrations/0026's check constraints exactly.
 */

export type ComplianceTaskType = 'log_review' | 'vendor_report_review' | 'other';

export const COMPLIANCE_TASK_TYPES: ComplianceTaskType[] = [
  'log_review',
  'vendor_report_review',
  'other',
];

export const COMPLIANCE_TASK_TYPE_LABELS: Record<ComplianceTaskType, string> = {
  log_review: 'Log review',
  vendor_report_review: 'Vendor report review',
  other: 'Other',
};

export type ComplianceTaskFrequency = 'weekly' | 'monthly' | 'quarterly' | 'annual';

export const COMPLIANCE_TASK_FREQUENCIES: ComplianceTaskFrequency[] = [
  'weekly',
  'monthly',
  'quarterly',
  'annual',
];

export const COMPLIANCE_TASK_FREQUENCY_LABELS: Record<ComplianceTaskFrequency, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
};

// How many days each frequency represents, for computing when a task is
// next due. A fixed mapping (not user-configurable) -- same simplicity
// tradeoff as EXPIRING_SOON_WINDOW_DAYS in compliance-document-types.ts.
export const COMPLIANCE_TASK_FREQUENCY_DAYS: Record<ComplianceTaskFrequency, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  annual: 365,
};

// A task due within this many days of today is flagged "Due soon" rather
// than "OK". Originally a single flat window (7 days) regardless of
// frequency, same simplicity tradeoff as compliance-document-types.ts's
// EXPIRING_SOON_WINDOW_DAYS -- but a flat 7-day window is exactly as long
// as the `weekly` frequency itself (Phase 21 bug fix), so a weekly task
// showed "Due soon" the instant it was marked complete: nextDueAt is
// always exactly 7 days out at that moment, and 7 <= 7 is true. Kept as a
// flat 7 days for monthly/quarterly/annual (all comfortably longer than
// the window, so behavior there is unchanged), with a shorter window for
// weekly so a freshly-completed weekly task reads "OK" until it's
// actually close to due again.
export const COMPLIANCE_TASK_DUE_SOON_WINDOW_DAYS: Record<ComplianceTaskFrequency, number> = {
  weekly: 2,
  monthly: 7,
  quarterly: 7,
  annual: 7,
};

export type ComplianceTaskDueStatus = 'ok' | 'due_soon' | 'overdue' | 'never_reviewed';

export const COMPLIANCE_TASK_DUE_STATUS_LABELS: Record<ComplianceTaskDueStatus, string> = {
  ok: 'OK',
  due_soon: 'Due soon',
  overdue: 'Overdue',
  never_reviewed: 'Never reviewed',
};

export const COMPLIANCE_TASK_DUE_STATUS_COLORS: Record<ComplianceTaskDueStatus, string> = {
  ok: colors.success,
  due_soon: colors.warning,
  overdue: colors.danger,
  never_reviewed: colors.danger,
};

/**
 * Derives whether a task is OK, due soon, overdue, or has never been
 * reviewed at all -- computed from the most recent completion's
 * `completed_at` plus the task's `frequency`, the same "derive at read
 * time, don't store a status that can go stale" approach
 * compliance-document-types.ts's computeDisplayStatus() takes for
 * certificate expirations. A task with no completions yet is always
 * `never_reviewed`, treated as more urgent than a merely-overdue one --
 * there's no history to even judge staleness from.
 */
export function computeTaskDueStatus(
  frequency: ComplianceTaskFrequency,
  lastCompletedAt: string | null,
): ComplianceTaskDueStatus {
  if (!lastCompletedAt) return 'never_reviewed';

  const frequencyDays = COMPLIANCE_TASK_FREQUENCY_DAYS[frequency];
  const nextDueAt = new Date(lastCompletedAt).getTime() + frequencyDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  const dueSoonWindowDays = COMPLIANCE_TASK_DUE_SOON_WINDOW_DAYS[frequency];

  if (nextDueAt < now) return 'overdue';
  if (nextDueAt - now <= dueSoonWindowDays * 24 * 60 * 60 * 1000) return 'due_soon';
  return 'ok';
}

// Same pattern as friendlyComplianceDocumentError -- maps a raw
// Postgres/RLS error message to something a non-technical user can act
// on.
const COMPLIANCE_TASK_ERROR_MESSAGES: Record<string, string> = {
  'row-level security policy':
    'Only an organization admin, portfolio manager, or supervisor can manage compliance tasks.',
  compliance_tasks_vendor_id_requires_type:
    'A vendor can only be attached to a "Vendor report review" task.',
  compliance_tasks_vendor_report_requires_vendor_id:
    'Pick a vendor for a "Vendor report review" task.',
  permission_denied: 'You do not have permission to do that.',
};

export function friendlyComplianceTaskError(rawMessage: string): string {
  for (const fragment of Object.keys(COMPLIANCE_TASK_ERROR_MESSAGES)) {
    if (rawMessage.includes(fragment)) return COMPLIANCE_TASK_ERROR_MESSAGES[fragment];
  }
  return 'Something went wrong. Please try again.';
}
