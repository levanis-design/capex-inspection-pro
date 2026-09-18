import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { AssignableProfile, Vendor } from '@/lib/findings';
import {
  CORRECTIVE_ACTION_STATUSES,
  CORRECTIVE_ACTION_STATUS_LABELS,
} from '@/lib/corrective-action-types';
import { colors, radius, spacing, touchTarget, typography } from '@/theme';

export type CorrectiveActionFormState = {
  status: string;
  statusReason: string;
  assignedTo: string | null;
  vendorId: string | null;
  accessNotes: string;
  scheduledDate: string;
  targetCompletionDate: string;
  estimatedCost: string;
  actualCost: string;
  completionNotes: string;
};

type ManageCorrectiveActionModalProps = {
  visible: boolean;
  form: CorrectiveActionFormState;
  profiles: AssignableProfile[];
  vendors: Vendor[];
  isSubmitting: boolean;
  error: string | null;
  onChange: (patch: Partial<CorrectiveActionFormState>) => void;
  onAddVendor: () => void;
  onCancel: () => void;
  onSave: () => void;
};

/**
 * Edit sheet for one corrective_actions row (Phase 5D). Every field here
 * writes through supabase/migrations/0017's set_corrective_action_status()
 * (status only -- see that function's comment for why every transition,
 * not just voided, is funneled through it) or
 * update_corrective_action_details() (everything else) -- corrective_actions
 * has no direct update policy at all, same "SECURITY DEFINER function is
 * the only write path" shape as EditCheckAssignmentModal's
 * property_check_assignments.
 *
 * Status and details are saved as two separate RPC calls from the parent
 * screen's onSave -- kept as one form/one Save button here since from the
 * person's point of view this is "editing the corrective action," not two
 * separate actions.
 */
export function ManageCorrectiveActionModal({
  visible,
  form,
  profiles,
  vendors,
  isSubmitting,
  error,
  onChange,
  onAddVendor,
  onCancel,
  onSave,
}: ManageCorrectiveActionModalProps) {
  const reasonRequired = form.status === 'voided';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={typography.sectionTitle}>Manage corrective action</Text>

            <Text style={[typography.label, styles.fieldLabel]}>Status</Text>
            <View style={styles.optionRow}>
              {CORRECTIVE_ACTION_STATUSES.map((value) => {
                const isSelected = form.status === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => onChange({ status: value })}
                    style={({ pressed }) => [
                      styles.pill,
                      isSelected && styles.pillSelected,
                      pressed && styles.rowPressed,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: isSelected }}
                  >
                    <Text style={[typography.caption, isSelected && styles.pillTextSelected]}>
                      {CORRECTIVE_ACTION_STATUS_LABELS[value]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {reasonRequired ? (
              <TextField
                label="Reason for voiding (required)"
                value={form.statusReason}
                onChangeText={(text) => onChange({ statusReason: text })}
                multiline
                numberOfLines={2}
                style={styles.multilineInput}
              />
            ) : null}

            <Text style={[typography.label, styles.fieldLabel]}>Assigned to</Text>
            <View style={styles.optionRow}>
              <Pressable
                onPress={() => onChange({ assignedTo: null })}
                style={({ pressed }) => [
                  styles.pill,
                  form.assignedTo === null && styles.pillSelected,
                  pressed && styles.rowPressed,
                ]}
              >
                <Text
                  style={[typography.caption, form.assignedTo === null && styles.pillTextSelected]}
                >
                  Unassigned
                </Text>
              </Pressable>
              {profiles.map((profile) => {
                const isSelected = form.assignedTo === profile.id;
                return (
                  <Pressable
                    key={profile.id}
                    onPress={() => onChange({ assignedTo: profile.id })}
                    style={({ pressed }) => [
                      styles.pill,
                      isSelected && styles.pillSelected,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    <Text style={[typography.caption, isSelected && styles.pillTextSelected]}>
                      {profile.fullName ?? profile.email}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[typography.label, styles.fieldLabel]}>Vendor</Text>
            <View style={styles.optionRow}>
              <Pressable
                onPress={() => onChange({ vendorId: null })}
                style={({ pressed }) => [
                  styles.pill,
                  form.vendorId === null && styles.pillSelected,
                  pressed && styles.rowPressed,
                ]}
              >
                <Text
                  style={[typography.caption, form.vendorId === null && styles.pillTextSelected]}
                >
                  None
                </Text>
              </Pressable>
              {vendors.map((vendor) => {
                const isSelected = form.vendorId === vendor.id;
                return (
                  <Pressable
                    key={vendor.id}
                    onPress={() => onChange({ vendorId: vendor.id })}
                    style={({ pressed }) => [
                      styles.pill,
                      isSelected && styles.pillSelected,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    <Text style={[typography.caption, isSelected && styles.pillTextSelected]}>
                      {vendor.name}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={onAddVendor}
                style={({ pressed }) => [styles.pill, styles.addPill, pressed && styles.rowPressed]}
              >
                <Text style={[typography.caption, styles.addPillText]}>+ Add vendor</Text>
              </Pressable>
            </View>

            <TextField
              label="Access notes"
              value={form.accessNotes}
              onChangeText={(text) => onChange({ accessNotes: text })}
              placeholder="e.g. Roof hatch keypad code, tenant contact"
              multiline
              numberOfLines={2}
              style={styles.multilineInput}
            />

            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <TextField
                  label="Scheduled date"
                  value={form.scheduledDate}
                  onChangeText={(text) => onChange({ scheduledDate: text })}
                  placeholder="YYYY-MM-DD"
                />
              </View>
              <View style={styles.fieldHalf}>
                <TextField
                  label="Target completion"
                  value={form.targetCompletionDate}
                  onChangeText={(text) => onChange({ targetCompletionDate: text })}
                  placeholder="YYYY-MM-DD"
                />
              </View>
            </View>

            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <TextField
                  label="Estimated cost"
                  value={form.estimatedCost}
                  onChangeText={(text) => onChange({ estimatedCost: text })}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.fieldHalf}>
                <TextField
                  label="Actual cost"
                  value={form.actualCost}
                  onChangeText={(text) => onChange({ actualCost: text })}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                />
              </View>
            </View>

            <TextField
              label="Completion notes"
              value={form.completionNotes}
              onChangeText={(text) => onChange({ completionNotes: text })}
              placeholder="What was done to resolve this"
              multiline
              numberOfLines={3}
              style={styles.multilineInput}
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
                  disabled={reasonRequired && !form.statusReason.trim()}
                />
              </View>
            </View>
          </ScrollView>
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
    maxHeight: '90%',
  },
  fieldLabel: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
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
  addPill: {
    borderStyle: 'dashed',
    borderColor: colors.slate,
  },
  addPillText: {
    color: colors.slate,
  },
  rowPressed: {
    opacity: 0.7,
  },
  multilineInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  fieldRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  fieldHalf: {
    flex: 1,
  },
  error: {
    ...typography.body,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  actionButton: {
    flex: 1,
  },
});
