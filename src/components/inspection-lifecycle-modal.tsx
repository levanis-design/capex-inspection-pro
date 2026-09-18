import { Modal, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { colors, radius, spacing, typography } from '@/theme';

export type InspectionLifecycleAction = 'void' | 'delete';

type InspectionLifecycleModalProps = {
  action: InspectionLifecycleAction | null;
  reason: string;
  isSubmitting: boolean;
  error: string | null;
  onChangeReason: (reason: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

const COPY: Record<
  InspectionLifecycleAction,
  { title: string; body: string; confirmLabel: string }
> = {
  void: {
    title: 'Void this inspection?',
    body: 'The inspection stays on record as voided, with your reason attached, rather than disappearing entirely.',
    confirmLabel: 'Void inspection',
  },
  delete: {
    title: 'Delete this inspection?',
    body: 'This permanently removes the inspection and everything recorded in it -- areas, items, notes, and photos. This cannot be undone.',
    confirmLabel: 'Delete permanently',
  },
};

/**
 * Shared reason-required confirmation for both governed inspection-lifecycle
 * actions (Phase 5B-ext2, migration 0015): set_inspection_status(...,
 * 'voided', ...) and delete_inspection(...). Both require a non-blank
 * reason and both enforce "admin-only once the inspection is past
 * 'scheduled'" server-side -- this modal just surfaces whatever error that
 * produces, same as MarkLocationModal/EditCheckAssignmentModal.
 */
export function InspectionLifecycleModal({
  action,
  reason,
  isSubmitting,
  error,
  onChangeReason,
  onCancel,
  onConfirm,
}: InspectionLifecycleModalProps) {
  if (!action) return null;
  const copy = COPY[action];

  return (
    <Modal visible={action !== null} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={typography.sectionTitle}>{copy.title}</Text>
          <Text style={typography.body}>{copy.body}</Text>
          <TextField
            label="Reason (required)"
            value={reason}
            onChangeText={onChangeReason}
            multiline
            numberOfLines={3}
            style={styles.reasonInput}
            autoFocus
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <View style={styles.actionButton}>
              <Button label="Cancel" variant="secondary" onPress={onCancel} />
            </View>
            <View style={styles.actionButton}>
              <Button
                label={copy.confirmLabel}
                variant="danger"
                onPress={onConfirm}
                loading={isSubmitting}
                disabled={!reason.trim()}
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
    gap: spacing.md,
  },
  reasonInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  error: {
    ...typography.body,
    color: colors.danger,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
  },
});
