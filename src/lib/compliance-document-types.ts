import { colors } from '@/theme';

/**
 * Shared metadata for the Phase 14 Compliance Documents feature, in the
 * same spirit as inspection-types.ts and corrective-action-types.ts --
 * one place so the list screen, the add/edit modal, and any future
 * summary card can't drift out of sync on labels or colors.
 *
 * The document_type and status value lists here must match
 * supabase/migrations/0025's check constraints exactly.
 */

export type ComplianceDocumentType =
  'boiler_certificate' | 'elevator_certificate' | 'fire_safety_permit' | 'fisp_ll11' | 'other';

export const COMPLIANCE_DOCUMENT_TYPES: ComplianceDocumentType[] = [
  'boiler_certificate',
  'elevator_certificate',
  'fire_safety_permit',
  'fisp_ll11',
  'other',
];

export const COMPLIANCE_DOCUMENT_TYPE_LABELS: Record<ComplianceDocumentType, string> = {
  boiler_certificate: 'Boiler certificate',
  elevator_certificate: 'Elevator certificate',
  fire_safety_permit: 'Fire safety permit',
  fisp_ll11: 'FISP / LL11 filing',
  other: 'Other',
};

// The two stored, non-derivable states -- see migration 0025's header
// comment. 'valid' is the default/rest value; whenever status is 'valid'
// the actually-displayed status is computed from expiration_date instead
// (see computeDisplayStatus below), so the UI never shows the literal
// word "valid" for a document that has in fact expired.
export type ComplianceDocumentStatus = 'valid' | 'pending_renewal' | 'not_applicable';

export const COMPLIANCE_DOCUMENT_STATUSES: ComplianceDocumentStatus[] = [
  'valid',
  'pending_renewal',
  'not_applicable',
];

export const COMPLIANCE_DOCUMENT_STATUS_LABELS: Record<ComplianceDocumentStatus, string> = {
  valid: 'Valid',
  pending_renewal: 'Renewal in progress',
  not_applicable: 'Not applicable',
};

// The display status actually rendered in the UI -- a superset of the
// stored status, with 'valid' expanded into 'valid'/'expiring_soon'/
// 'expired' by comparing expiration_date to today.
export type ComplianceDisplayStatus =
  'valid' | 'expiring_soon' | 'expired' | 'pending_renewal' | 'not_applicable';

export const COMPLIANCE_DISPLAY_STATUS_LABELS: Record<ComplianceDisplayStatus, string> = {
  valid: 'Valid',
  expiring_soon: 'Expiring soon',
  expired: 'Expired',
  pending_renewal: 'Renewal in progress',
  not_applicable: 'Not applicable',
};

export const COMPLIANCE_DISPLAY_STATUS_COLORS: Record<ComplianceDisplayStatus, string> = {
  valid: colors.success,
  expiring_soon: colors.warning,
  expired: colors.danger,
  pending_renewal: colors.info,
  not_applicable: colors.statusNeutral,
};

// A document expiring within this many days is flagged "expiring soon"
// rather than plain "valid" -- gives an admin a heads-up window to start
// a renewal before it lapses. Not configurable per org (yet) -- a single
// reasonable default, same simplicity tradeoff as the fixed P1/P2
// escalation thresholds in corrective-action-types.ts.
export const EXPIRING_SOON_WINDOW_DAYS = 30;

/**
 * Derives the status actually shown in the UI. `status` only overrides
 * the date-based calculation for the two states a date can't express
 * (pending_renewal, not_applicable) -- see migration 0025's header
 * comment for why this is computed here instead of trusting a stored
 * 'valid'/'expired' value that could silently go stale. UI-only, same
 * pattern as isOverdueForEscalation()/isOverdueForCompletion() in
 * corrective-action-types.ts.
 */
export function computeDisplayStatus(
  status: string,
  expirationDate: string | null,
): ComplianceDisplayStatus {
  if (status === 'pending_renewal' || status === 'not_applicable') {
    return status;
  }
  if (!expirationDate) return 'valid';

  const today = new Date().toISOString().slice(0, 10);
  if (expirationDate < today) return 'expired';

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntilExpiration = Math.floor(
    (new Date(expirationDate).getTime() - new Date(today).getTime()) / msPerDay,
  );
  if (daysUntilExpiration <= EXPIRING_SOON_WINDOW_DAYS) return 'expiring_soon';

  return 'valid';
}

// Same pattern as CORRECTIVE_ACTION_ERROR_MESSAGES/friendlyCorrectiveActionError
// in corrective-action-types.ts -- maps a raw Postgres/RLS error message to
// something a non-technical user can act on.
const COMPLIANCE_DOCUMENT_ERROR_MESSAGES: Record<string, string> = {
  'row-level security policy':
    'Only an organization admin, portfolio manager, or supervisor can manage compliance documents.',
  permission_denied: 'You do not have permission to do that.',
};

export function friendlyComplianceDocumentError(rawMessage: string): string {
  for (const fragment of Object.keys(COMPLIANCE_DOCUMENT_ERROR_MESSAGES)) {
    if (rawMessage.includes(fragment)) return COMPLIANCE_DOCUMENT_ERROR_MESSAGES[fragment];
  }
  return 'Something went wrong. Please try again.';
}
