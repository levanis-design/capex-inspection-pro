/**
 * Shared inspection-type metadata and status labels for the Phase 5B
 * walkthrough UI. Keeping this in one place means the "start inspection"
 * picker, the list screen, and the walkthrough/review screens can't drift
 * out of sync on what a type/status is called or which types the app
 * currently offers.
 *
 * The set below matches exactly what supabase/migrations/0012's
 * start_inspection() actually supports -- see that migration for the
 * full list of deferred types (preventive_maintenance, follow_up,
 * seasonal, exterior_grounds, move_in, move_out, capital_planning) and
 * why. Don't add a type here until the database can resolve its scope.
 */

export type InspectionType =
  | 'comprehensive'
  | 'roof'
  | 'mechanical'
  | 'common_area'
  | 'fire_life_safety'
  | 'apartment_unit'
  | 'custom';

export type InspectionTypeOption = {
  value: InspectionType;
  label: string;
  description: string;
  requiresLocationSelection: boolean;
};

export const SUPPORTED_INSPECTION_TYPES: InspectionTypeOption[] = [
  {
    value: 'comprehensive',
    label: 'Comprehensive',
    description: 'Every active area on the property.',
    requiresLocationSelection: false,
  },
  {
    value: 'roof',
    label: 'Roof',
    description: 'Roof areas only.',
    requiresLocationSelection: false,
  },
  {
    value: 'mechanical',
    label: 'Mechanical',
    description: 'Boiler rooms and mechanical rooms.',
    requiresLocationSelection: false,
  },
  {
    value: 'common_area',
    label: 'Common area',
    description: 'Entrance, lobby, hallway, and stairwell areas.',
    requiresLocationSelection: false,
  },
  {
    value: 'fire_life_safety',
    label: 'Fire & life safety',
    description:
      'Every area with at least one critical fire/life-safety check, filtered to just those checks.',
    requiresLocationSelection: false,
  },
  {
    value: 'apartment_unit',
    label: 'Apartment / unit',
    description: 'Pick the specific unit(s) to inspect.',
    requiresLocationSelection: true,
  },
  {
    value: 'custom',
    label: 'Custom',
    description: 'Pick the specific areas to inspect.',
    requiresLocationSelection: true,
  },
];

export function inspectionTypeLabel(value: string): string {
  return SUPPORTED_INSPECTION_TYPES.find((t) => t.value === value)?.label ?? value;
}

export const INSPECTION_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  postponed: 'Postponed',
  voided: 'Voided',
};

export const LOCATION_STATUS_LABELS: Record<string, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  complete: 'Complete',
  skipped: 'Skipped',
  inaccessible: 'Inaccessible',
  not_applicable: 'Not applicable',
};

export const ITEM_STATUS_LABELS: Record<string, string> = {
  satisfactory: 'Satisfactory',
  deficiency: 'Deficiency',
  not_applicable: 'Not applicable',
  not_inspected: 'Not inspected',
  pending_verification: 'Pending verification',
};

/** Location statuses that don't require a status_reason (see 0011's
 * inspection_snapshot_location_reason_required constraint) -- every
 * other status does. */
export const LOCATION_STATUSES_WITHOUT_REASON = new Set(['pending', 'in_progress', 'complete']);
