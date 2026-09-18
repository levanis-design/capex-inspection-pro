import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { colors, radius, spacing, touchTarget, typography } from '@/theme';

export type EditableAssignment = {
  id: string;
  status: string;
  statusReason: string | null;
  overridePriority: string | null;
  overrideDepartment: string | null;
  checkName: string;
  locationName: string;
  critical: boolean;
  defaultPriority: string | null;
  defaultDepartment: string | null;
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'not_applicable', label: 'Not applicable' },
  { value: 'superseded', label: 'Superseded' },
];

const PRIORITY_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: 'Use default' },
  { value: 'P1', label: 'P1' },
  { value: 'P2', label: 'P2' },
  { value: 'P3', label: 'P3' },
  { value: 'P4', label: 'P4' },
];

type EditCheckAssignmentModalProps = {
  assignment: EditableAssignment | null;
  status: string;
  reason: string;
  overridePriority: string | null;
  overrideDepartment: string;
  isSubmitting: boolean;
  error: string | null;
  onChangeStatus: (status: string) => void;
  onChangeReason: (reason: string) => void;
  onChangePriority: (priority: string | null) => void;
  onChangeDepartment: (department: string) => void;
  onCancel: () => void;
  onSave: () => void;
};

/**
 * Edit sheet for one property_check_assignment row (Phase 5B-ext,
 * "checklist management"). Backed by
 * supabase/migrations/0013's set_property_check_assignment_status() --
 * property_check_assignments itself has no update policy, so this RPC is
 * the only write path (same "SECURITY DEFINER function is the only
 * write path" pattern as everywhere else in this app).
 *
 * A critical check (see the badge below) additionally requires an
 * org_admin to move it away from Active -- the function enforces that
 * server-side; this modal doesn't try to duplicate that check
 * client-side, it just surfaces the resulting error if it fires.
 */
export function EditCheckAssignmentModal({
  assignment,
  status,
  reason,
  overridePriority,
  overrideDepartment,
  isSubmitting,
  error,
  onChangeStatus,
  onChangeReason,
  onChangePriority,
  onChangeDepartment,
  onCancel,
  onSave,
}: EditCheckAssignmentModalProps) {
  if (!assignment) return null;

  const reasonRequired = status !== 'active';

  return (
    <Modal
      visible={assignment !== null}
      animationType="slide"
      transparent
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={typography.sectionTitle}>{assignment.checkName}</Text>
          <Text style={typography.caption}>
            {assignment.locationName}
            {assignment.critical ? ' · Critical' : ''}
          </Text>

          <Text style={[typography.label, styles.fieldLabel]}>Status</Text>
          <View style={styles.optionRow}>
            {STATUS_OPTIONS.map((option) => {
              const isSelected = status === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => onChangeStatus(option.value)}
                  style={({ pressed }) => [
                    styles.pill,
                    isSelected && styles.pillSelected,
                    pressed && styles.rowPressed,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text style={[typography.caption, isSelected && styles.pillTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {reasonRequired ? (
            <TextField
              label="Reason (required)"
              value={reason}
              onChangeText={onChangeReason}
              multiline
              numberOfLines={2}
              style={styles.reasonInput}
            />
          ) : null}

          <Text style={[typography.label, styles.fieldLabel]}>
            Priority {assignment.defaultPriority ? `(default: ${assignment.defaultPriority})` : ''}
          </Text>
          <View style={styles.optionRow}>
            {PRIORITY_OPTIONS.map((option) => {
              const isSelected = overridePriority === option.value;
              return (
                <Pressable
                  key={option.label}
                  onPress={() => onChangePriority(option.value)}
                  style={({ pressed }) => [
                    styles.pill,
                    isSelected && styles.pillSelected,
                    pressed && styles.rowPressed,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text style={[typography.caption, isSelected && styles.pillTextSelected]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextField
            label={`Department ${assignment.defaultDepartment ? `(default: ${assignment.defaultDepartment})` : ''}`}
            value={overrideDepartment}
            onChangeText={onChangeDepartment}
            placeholder="Leave blank to use the default"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <View style={styles.actionButton}>
              <Button label="Cancel" variant="secondary" onPress={onCancel} />
            </View>
            <View style={styles.actionButton}>
              <Button
                label="Save"
                onPress={onSave}
                loading={isSubmitting}
                disabled={reasonRequired && !reason.trim()}
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    maxHeight: '90%',
  },
  fieldLabel: {
    marginTop: spacing.xs,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  pill: {
    minHeight: touchTarget.minHeight,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSelected: {
    backgroundColor: colors.slate,
    borderColor: colors.slate,
  },
  pillTextSelected: {
    color: colors.textInverse,
    fontWeight: '700',
  },
  rowPressed: {
    opacity: 0.7,
  },
  reasonInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
});
