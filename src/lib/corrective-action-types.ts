/**
 * Shared status/priority metadata for the Phase 5D corrective-actions
 * board + deficiency detail screens, in the same spirit as
 * inspection-types.ts's label/color maps for the walkthrough screens --
 * one place so the board, the detail screen, and any future summary card
 * can't drift out of sync on what a status is called or which color it
 * gets.
 *
 * The 12-value status list matches PRODUCT_SPEC.md section 10 exactly,
 * and supabase/migrations/0017's check constraint on both
 * `findings.current_status` and `corrective_actions.status` --
 * don't add a value here without adding it there too.
 */

export type CorrectiveActionStatus =
  | 'open'
  | 'assigned'
  | 'access_required'
  | 'vendor_required'
  | 'scheduled'
  | 'in_progress'
  | 'pending_parts'
  | 'pending_approval'
  | 'completed'
  | 'verified'
  | 'closed'
  | 'voided';

export const CORRECTIVE_ACTION_STATUSES: CorrectiveActionStatus[] = [
  'open',
  'assigned',
  'access_required',
  'vendor_required',
  'scheduled',
  'in_progress',
  'pending_parts',
  'pending_approval',
  'completed',
  'verified',
  'closed',
  'voided',
];

export const CORRECTIVE_ACTION_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  assigned: 'Assigned',
  access_required: 'Access required',
  vendor_required: 'Vendor required',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  pending_parts: 'Pending parts',
  pending_approval: 'Pending approval',
  completed: 'Completed',
  verified: 'Verified',
  closed: 'Closed',
  voided: 'Voided',
};

// Statuses that mean "this deficiency is no longer active work" -- used
// by the board's default filter and by the overdue-for-completion check
// below (a corrective action past its target date but already resolved
// isn't overdue, it's just done).
export const CORRECTIVE_ACTION_TERMINAL_STATUSES = new Set<CorrectiveActionStatus>([
  'completed',
  'verified',
  'closed',
  'voided',
]);

export const PRIORITY_LABELS: Record<string, string> = {
  P1: 'P1 · Life safety',
  P2: 'P2 · Code / compliance',
  P3: 'P3 · Operational',
  P4: 'P4 · Cosmetic',
};

// Hours by which an unescalated finding of this priority is expected to
// be escalated, per PRODUCT_SPEC.md section 8's priority/response table.
// P3/P4 have no escalation expectation at all -- "normal workflow" in the
// spec's own words -- so they're simply absent here.
export const ESCALATION_THRESHOLD_HOURS: Record<string, number> = {
  P1: 2,
  P2: 24,
};

/**
 * True when a finding's priority carries an escalation expectation, it
 * hasn't been escalated yet, and it's been open longer than that
 * priority's threshold. This is a UI-only computation -- see
 * supabase/migrations/0017's header comment for why automatic,
 * time-based escalation isn't implemented server-side yet (no
 * scheduled-job infrastructure in this project). A manual "Escalate"
 * action on the deficiency detail screen is what actually records it.
 */
export function isOverdueForEscalation(
  priority: string | null,
  createdAt: string,
  escalated: boolean,
): boolean {
  if (escalated || !priority) return false;
  const thresholdHours = ESCALATION_THRESHOLD_HOURS[priority];
  if (!thresholdHours) return false;
  const ageMs = Date.now() - new Date(createdAt).getTime();
  return ageMs > thresholdHours * 60 * 60 * 1000;
}

/**
 * True when a corrective action has a target completion date in the past
 * and hasn't reached a terminal status yet. Also a UI-only computation --
 * there's no stored "overdue" flag, it's always derived from
 * target_completion_date + status at read time.
 */
export function isOverdueForCompletion(
  targetCompletionDate: string | null,
  status: string,
): boolean {
  if (!targetCompletionDate) return false;
  if (CORRECTIVE_ACTION_TERMINAL_STATUSES.has(status as CorrectiveActionStatus)) return false;
  // Date-only comparison (no time-of-day component in target_completion_date).
  return targetCompletionDate < new Date().toISOString().slice(0, 10);
}

// Maps set_corrective_action_status()/update_corrective_action_details()/
// update_finding_details()/set_finding_escalation() exception codes (see
// supabase/migrations/0017) to messages a non-technical user can act on --
// same pattern as every other RPC error map in this app (see
// inspections/[id]/manage.tsx's LIFECYCLE_ERROR_MESSAGES).
export const CORRECTIVE_ACTION_ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'We could not confirm your account. Try signing out and back in.',
  insufficient_permission:
    'Only an organization admin, portfolio manager, or supervisor can manage corrective actions.',
  invalid_status: 'That status is not supported.',
  invalid_priority: 'That priority is not supported.',
  status_reason_required: 'A reason is required to void a corrective action.',
  must_be_completed_first: 'Mark this corrective action completed before verifying it.',
  corrective_action_not_found: 'Could not find this corrective action.',
  finding_not_found: 'Could not find this deficiency.',
};

export function friendlyCorrectiveActionError(rawMessage: string): string {
  for (const code of Object.keys(CORRECTIVE_ACTION_ERROR_MESSAGES)) {
    if (rawMessage.includes(code)) return CORRECTIVE_ACTION_ERROR_MESSAGES[code];
  }
  return 'Something went wrong. Please try again.';
}
