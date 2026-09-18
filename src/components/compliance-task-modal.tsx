import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import {
  COMPLIANCE_TASK_FREQUENCIES,
  COMPLIANCE_TASK_FREQUENCY_LABELS,
  COMPLIANCE_TASK_TYPE_LABELS,
  COMPLIANCE_TASK_TYPES,
  ComplianceTaskFrequency,
  ComplianceTaskType,
} from '@/lib/compliance-task-types';
import { ComplianceTaskInput } from '@/lib/compliance-tasks';
import { Vendor } from '@/lib/findings';
import { colors, radius, spacing, typography } from '@/theme';

type ComplianceTaskModalProps = {
  visible: boolean;
  isEditing: boolean;
  input: ComplianceTaskInput;
  vendors: Vendor[];
  isSubmitting: boolean;
  error: string | null;
  onChange: (input: ComplianceTaskInput) => void;
  onCancel: () => void;
  onSubmit: () => void;
};

/**
 * Add/edit modal for the Phase 15 Compliance Tasks feature, styled
 * consistently with compliance-document-modal.tsx (Phase 14) and
 * manage-corrective-action-modal.tsx's vendor-picker pills. Recording a
 * completion is a separate action/modal on the list screen -- this one
 * only edits the task's own definition (type, title, description,
 * vendor, frequency).
 */
export function ComplianceTaskModal({
  visible,
  isEditing,
  input,
  vendors,
  isSubmitting,
  error,
  onChange,
  onCancel,
  onSubmit,
}: ComplianceTaskModalProps) {
  function set<K extends keyof ComplianceTaskInput>(key: K, value: ComplianceTaskInput[K]) {
    onChange({ ...input, [key]: value });
  }

  const isVendorReportReview = input.taskType === 'vendor_report_review';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
            <Text style={typography.sectionTitle}>
              {isEditing ? 'Edit compliance task' : 'Add compliance task'}
            </Text>

            <Text style={[typography.label, styles.fieldLabel]}>Task type</Text>
            <View style={styles.typeList}>
              {COMPLIANCE_TASK_TYPES.map((type: ComplianceTaskType) => {
                const isSelected = input.taskType === type;
                return (
                  <Pressable
                    key={type}
                    onPress={() => set('taskType', type)}
                    style={({ pressed }) => [
                      styles.typeRow,
                      isSelected && styles.typeRowSelected,
                      pressed && styles.rowPressed,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected }}
                  >
                    <Text style={isSelected ? typography.bodyStrong : typography.body}>
                      {COMPLIANCE_TASK_TYPE_LABELS[type]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {isVendorReportReview ? (
              <>
                <Text style={[typography.label, styles.fieldLabel]}>Vendor</Text>
                {vendors.length === 0 ? (
                  <Text style={[typography.caption, styles.hint]}>
                    No active vendors yet — add one from the Corrective Actions area first.
                  </Text>
                ) : (
                  <View style={styles.vendorList}>
                    {vendors.map((vendor) => {
                      const isSelected = input.vendorId === vendor.id;
                      return (
                        <Pressable
                          key={vendor.id}
                          onPress={() => set('vendorId', vendor.id)}
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
                  </View>
                )}
              </>
            ) : null}

            <TextField
              label="Title"
              value={input.title}
              onChangeText={(text) => set('title', text)}
              placeholder="e.g. Review incident and maintenance logs"
            />
            <TextField
              label="Description (optional)"
              value={input.description}
              onChangeText={(text) => set('description', text)}
              placeholder="What does this review actually involve?"
              multiline
            />

            <Text style={[typography.label, styles.fieldLabel]}>How often</Text>
            <View style={styles.statusRow}>
              {COMPLIANCE_TASK_FREQUENCIES.map((frequency: ComplianceTaskFrequency) => {
                const isSelected = input.frequency === frequency;
                return (
                  <Pressable
                    key={frequency}
                    onPress={() => set('frequency', frequency)}
                    style={({ pressed }) => [
                      styles.pill,
                      isSelected && styles.pillSelected,
                      pressed && styles.rowPressed,
                    ]}
                  >
                    <Text style={[typography.caption, isSelected && styles.pillTextSelected]}>
                      {COMPLIANCE_TASK_FREQUENCY_LABELS[frequency]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.actions}>
            <View style={styles.actionButton}>
              <Button label="Cancel" variant="secondary" onPress={onCancel} />
            </View>
            <View style={styles.actionButton}>
              <Button
                label={isEditing ? 'Save changes' : 'Add task'}
                onPress={onSubmit}
                loading={isSubmitting}
                disabled={!input.title.trim() || (isVendorReportReview && !input.vendorId)}
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
    maxHeight: '90%',
  },
  scroll: {
    gap: spacing.md,
  },
  fieldLabel: {
    marginTop: spacing.sm,
  },
  hint: {
    color: colors.textSecondary,
  },
  typeList: {
    gap: spacing.xs,
  },
  typeRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  typeRowSelected: {
    backgroundColor: colors.background,
    borderColor: colors.slate,
  },
  rowPressed: {
    opacity: 0.6,
  },
  vendorList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  pillSelected: {
    backgroundColor: colors.slate,
    borderColor: colors.slate,
  },
  pillTextSelected: {
    color: colors.textInverse,
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
  },
  actionButton: {
    flex: 1,
  },
});
