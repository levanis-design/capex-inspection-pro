import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  EditableAssignment,
  EditCheckAssignmentModal,
} from '@/components/edit-check-assignment-modal';
import { Screen } from '@/components/screen';
import { logger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/theme';

type RawAssignmentRow = {
  id: string;
  status: string;
  status_reason: string | null;
  override_priority: string | null;
  override_department: string | null;
  property_locations: { name: string } | { name: string }[] | null;
  inspection_check_library:
    | {
        name: string;
        critical: boolean;
        default_priority: string | null;
        default_department: string | null;
        photo_required: boolean;
      }
    | {
        name: string;
        critical: boolean;
        default_priority: string | null;
        default_department: string | null;
        photo_required: boolean;
      }[]
    | null;
};

type AssignmentRow = EditableAssignment & { photoRequired: boolean };

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  inactive: 'Inactive',
  not_applicable: 'Not applicable',
  superseded: 'Superseded',
};

// Maps the exception codes raised by set_property_check_assignment_status()
// (see supabase/migrations/0013) to messages a non-technical user can act
// on -- same pattern as every other RPC error map in this app.
const ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: 'We could not confirm your account. Try signing out and back in.',
  insufficient_permission:
    'Only an organization admin or portfolio manager can edit checklist items.',
  invalid_priority: 'Pick a valid priority.',
  invalid_status: 'That status is not recognized.',
  status_reason_required: 'A reason is required for this change.',
  critical_check_requires_admin:
    'This is a critical check — only an organization admin can change its status.',
  assignment_not_found: 'Could not find this checklist item.',
};

function friendlyError(rawMessage: string): string {
  for (const code of Object.keys(ERROR_MESSAGES)) {
    if (rawMessage.includes(code)) return ERROR_MESSAGES[code];
  }
  return 'Something went wrong saving this change. Please try again.';
}

/**
 * Checklist management (Phase 5B-ext): every property_check_assignment
 * for this property, grouped by area, with the status/priority/
 * department editable via set_property_check_assignment_status(). Opened
 * from the property detail screen's "Active checks" stat card.
 *
 * Shows every status, not just active -- an admin reviewing what's been
 * deactivated (and why) is exactly the point of this screen existing.
 */
export default function PropertyChecklistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [assignments, setAssignments] = useState<AssignmentRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editing, setEditing] = useState<AssignmentRow | null>(null);
  const [editStatus, setEditStatus] = useState('active');
  const [editReason, setEditReason] = useState('');
  const [editPriority, setEditPriority] = useState<string | null>(null);
  const [editDepartment, setEditDepartment] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase
      .from('property_check_assignments')
      .select(
        'id, status, status_reason, override_priority, override_department, property_locations(name), inspection_check_library(name, critical, default_priority, default_department, photo_required)',
      )
      .eq('property_id', id);

    if (error) {
      logger.error('property-checklist', 'Failed to load checklist', error);
      setLoadError('Could not load this property’s checklist.');
      return;
    }

    setLoadError(null);
    const rows: AssignmentRow[] = ((data as RawAssignmentRow[] | null) ?? []).map((row) => {
      const location = Array.isArray(row.property_locations)
        ? row.property_locations[0]
        : row.property_locations;
      const check = Array.isArray(row.inspection_check_library)
        ? row.inspection_check_library[0]
        : row.inspection_check_library;
      return {
        id: row.id,
        status: row.status,
        statusReason: row.status_reason,
        overridePriority: row.override_priority,
        overrideDepartment: row.override_department,
        checkName: check?.name ?? 'Unknown check',
        locationName: location?.name ?? 'Unknown area',
        critical: check?.critical ?? false,
        defaultPriority: check?.default_priority ?? null,
        defaultDepartment: check?.default_department ?? null,
        photoRequired: check?.photo_required ?? false,
      };
    });
    rows.sort(
      (a, b) =>
        a.locationName.localeCompare(b.locationName) || a.checkName.localeCompare(b.checkName),
    );
    setAssignments(rows);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function openEditor(assignment: AssignmentRow) {
    setEditing(assignment);
    setEditStatus(assignment.status);
    setEditReason('');
    setEditPriority(assignment.overridePriority);
    setEditDepartment(assignment.overrideDepartment ?? '');
    setEditError(null);
  }

  async function handleSave() {
    if (!editing) return;
    if (editStatus !== 'active' && !editReason.trim()) {
      setEditError('A reason is required.');
      return;
    }

    setIsSaving(true);
    const { error } = await supabase.rpc('set_property_check_assignment_status', {
      p_assignment_id: editing.id,
      p_new_status: editStatus !== editing.status ? editStatus : null,
      p_reason: editStatus !== editing.status ? editReason.trim() : null,
      p_override_priority: editPriority,
      p_override_department: editDepartment.trim() || null,
      p_clear_override_priority: editPriority === null,
      p_clear_override_department: editDepartment.trim() === '',
    });
    setIsSaving(false);

    if (error) {
      logger.warn('property-checklist', 'set_property_check_assignment_status failed', {
        message: error.message,
      });
      setEditError(friendlyError(error.message));
      return;
    }

    setEditing(null);
    load();
  }

  if (assignments === null) {
    return (
      <Screen>
        <View style={styles.centered}>
          {loadError ? (
            <Text style={[typography.body, styles.errorText]}>{loadError}</Text>
          ) : (
            <ActivityIndicator color={colors.slate} />
          )}
        </View>
      </Screen>
    );
  }

  return (
    <Screen noPadding>
      <ScrollView contentContainerStyle={styles.content}>
        {assignments.length === 0 ? (
          <Text style={typography.body}>
            No checklist items yet — set up this property’s areas and components, then generate its
            checklist.
          </Text>
        ) : (
          assignments.map((assignment) => (
            <Pressable
              key={assignment.id}
              onPress={() => openEditor(assignment)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <View style={styles.rowText}>
                <Text style={typography.bodyStrong}>{assignment.checkName}</Text>
                <Text style={typography.caption}>
                  {assignment.locationName}
                  {assignment.critical ? ' · Critical' : ''}
                  {assignment.photoRequired ? ' · Photo required' : ''}
                </Text>
                {assignment.statusReason ? (
                  <Text style={[typography.caption, styles.reasonText]}>
                    {assignment.statusReason}
                  </Text>
                ) : null}
              </View>
              <View
                style={[
                  styles.statusBadge,
                  assignment.status !== 'active' && styles.statusBadgeInactive,
                ]}
              >
                <Text style={typography.caption}>
                  {STATUS_LABELS[assignment.status] ?? assignment.status}
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>

      <EditCheckAssignmentModal
        assignment={editing}
        status={editStatus}
        reason={editReason}
        overridePriority={editPriority}
        overrideDepartment={editDepartment}
        isSubmitting={isSaving}
        error={editError}
        onChangeStatus={setEditStatus}
        onChangeReason={setEditReason}
        onChangePriority={setEditPriority}
        onChangeDepartment={setEditDepartment}
        onCancel={() => setEditing(null)}
        onSave={handleSave}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: colors.danger,
  },
  content: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowText: {
    flex: 1,
    gap: spacing.xs,
  },
  reasonText: {
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  statusBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusBadgeInactive: {
    borderColor: colors.textDisabled,
  },
});
